import { createContext, useContext, useState, useEffect, useRef, type FormEvent } from 'react'
import brownCottonSareeImg from './assets/brown-cotton-saree.webp'
import semiSilkSareeImg from './assets/semi-silk-saree.webp'
import yaaleLogoTransparent from './assets/yaale-logo-transparent.png'
import yaaleLogoTrimmed from './assets/yaale-logo-trimmed.png'
import yaaleLogoJpeg from './assets/yaale-logo.jpeg'
import heroBigImg from './assets/hero-big.webp'
import heroSmallImg from './assets/hero-small.webp'

interface GsapMatchMedia {
  add: (query: string, callback: () => void) => void
  revert: () => void
}

interface GsapInstance {
  matchMedia: () => GsapMatchMedia
  fromTo: (
    targets: Element | Element[] | NodeListOf<Element>,
    fromVars: Record<string, string | number | boolean>,
    toVars: Record<string, string | number | boolean>
  ) => void
  set: (
    targets: Element | Element[] | NodeListOf<Element>,
    vars: Record<string, string | number | boolean>
  ) => void
}

declare global {
  interface Window {
    gsap: GsapInstance
  }
}

// ── Types ──────────────────────────────────────────────────────────────────
type Page = 'home' | 'shop' | 'product' | 'cart' | 'wishlist' | 'account' | 'account-sign-in' | 'checkout' | 'order-success' | 'order-tracking' | 'about' | 'contact' | 'admin-login' | 'admin-dashboard' | 'reset-password'
// 'ALL' or any category name. Category names come from the admin's categories,
// so they are not fixed in the code.
type ShopCategoryFilter = string

const normalizeCategory = (category: string) => category.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
const CONTACT_ADDRESS = '10/2A, Thirumalai Gounder St, Palakarath Thottam, Salem, Ellampilai - 637502'
const CONTACT_MAP_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(CONTACT_ADDRESS)}`
const INSTAGRAM_URL = 'https://www.instagram.com/yaale_sarees?stkn=dXVoZHI2dDhobmwy&utm_source=qr'
const DEFAULT_CONTACT_EMAIL = 'hello@yaale.in'
const DEFAULT_CONTACT_PHONE = '+91 98765 43210'

// Backend address.
const PROD_API_URL = 'https://boutique-oldj.onrender.com'

const API_BASE_URL = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD
    ? PROD_API_URL
    : `${window.location.protocol}//${window.location.hostname}:5000`)
).replace(/\/+$/, '')

// Shipping defaults; must match DEFAULT_SHIPPING_FEE / DEFAULT_FREE_SHIPPING_THRESHOLD in the backend.
const DEFAULT_SHIPPING_FEE = 250
const DEFAULT_FREE_SHIPPING_THRESHOLD = 10000

/** Shipping for a subtotal, using the store settings when set. Mirrors the backend's calculateShipping. */
const calculateShipping = (subtotal: number, settings: StoreSettingsForm): number => {
  const parse = (value: string, fallback: number) => {
    const n = value.trim() === '' ? NaN : Number(value)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
  const fee = parse(settings.shipping_fee, DEFAULT_SHIPPING_FEE)
  const threshold = parse(settings.free_shipping_threshold, DEFAULT_FREE_SHIPPING_THRESHOLD)
  return subtotal > threshold ? 0 : fee
}

const storeSettingsFromApi = (data: Record<string, unknown>): StoreSettingsForm => ({
  store_name: String(data.store_name ?? ''),
  store_email: String(data.store_email ?? ''),
  store_phone: String(data.store_phone ?? ''),
  store_address: String(data.store_address ?? ''),
  shipping_fee: data.shipping_fee == null ? '' : String(data.shipping_fee),
  free_shipping_threshold: data.free_shipping_threshold == null ? '' : String(data.free_shipping_threshold),
  return_policy: String(data.return_policy ?? ''),
  shipping_policy: String(data.shipping_policy ?? ''),
  privacy_policy: String(data.privacy_policy ?? ''),
  terms_policy: String(data.terms_policy ?? ''),
  online_payment: data.online_payment === true,
})

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void, on: (event: string, cb: (response: any) => void) => void }
  }
}

/** Loads Razorpay's Checkout script once, when it is first needed. */
const loadRazorpayScript = () => new Promise<boolean>(resolve => {
  if (window.Razorpay) return resolve(true)
  const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay]')
  const script = existing ?? document.createElement('script')
  script.addEventListener('load', () => resolve(true))
  script.addEventListener('error', () => resolve(false))
  if (!existing) {
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.dataset.razorpay = 'true'
    document.body.appendChild(script)
  }
})

/**
 * Opens the Razorpay popup for an order and, after payment, has the backend
 * verify it. Resolves 'paid', or 'pending' if the customer closed the popup or
 * the payment failed (the order stays reserved for 30 minutes and can be paid again).
 */
const payWithRazorpay = async (
  payment: RazorpayPaymentStart,
  orderNumber: string,
  token: string,
  prefill: { name?: string, email?: string, contact?: string }
): Promise<{ status: 'paid' | 'pending', message?: string }> => {
  if (!(await loadRazorpayScript()) || !window.Razorpay) {
    return { status: 'pending', message: 'The payment window could not be loaded. You can pay from My Orders.' }
  }

  return new Promise(resolve => {
    let settled = false
    // Reason for the latest failed attempt, shown if the customer then closes the popup.
    let lastFailure = ''
    const finish = (result: { status: 'paid' | 'pending', message?: string }) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const checkout = new window.Razorpay!({
      key: payment.key_id,
      order_id: payment.razorpay_order_id,
      amount: payment.amount,
      currency: payment.currency,
      name: 'Yaale',
      description: `Order ${orderNumber}`,
      prefill,
      theme: { color: '#7A0C32' },
      handler: async (response: { razorpay_order_id: string, razorpay_payment_id: string, razorpay_signature: string }) => {
        try {
          const verify = await fetch(`${API_BASE_URL}/api/payments/razorpay/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(response),
          })
          const data = await verify.json().catch(() => ({}))
          finish(verify.ok && data.payment_status === 'Paid'
            ? { status: 'paid' }
            : { status: 'pending', message: data.message || 'We could not confirm the payment yet. If money was taken, it will show as paid shortly.' })
        } catch {
          finish({ status: 'pending', message: 'We could not confirm the payment yet. If money was taken, it will show as paid shortly.' })
        }
      },
      modal: {
        ondismiss: () => finish({
          status: 'pending',
          message: lastFailure
            ? `Payment failed: ${lastFailure} Your order is held for 30 minutes; you can try again from My Orders.`
            : 'Payment was cancelled. Your order is held for 30 minutes; you can pay from My Orders.',
        }),
      },
    })

    // Razorpay keeps the popup open after a failure so the customer can try another
    // method; remember why it failed for the message shown when they close it.
    checkout.on('payment.failed', (response: { error?: { description?: string, reason?: string } }) => {
      const description = response?.error?.description?.trim()
      lastFailure = description ? (description.endsWith('.') ? description : `${description}.`) : 'The bank declined the payment.'
    })
    checkout.open()
  })
}
const productImageUrl = (image: unknown) => {
  if (typeof image !== 'string' || !image.trim()) return ''

  const path = image.trim()
  if (path.includes('brown-cotton-saree')) return brownCottonSareeImg
  if (path.includes('semi-silk-saree')) return semiSilkSareeImg
  if (path.includes('yaale-logo')) return yaaleLogoTransparent

  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|data:)/i.test(path)) {
    if (path.includes('localhost:5000/storage/')) {
      return path.replace(/http:\/\/localhost:5000\/storage\//, `${API_BASE_URL}/storage/`)
    }
    return path
  }

  const storagePath = path.replace(/^\/+/, '').replace(/^storage\//i, '')
  return storagePath ? `${API_BASE_URL}/storage/${storagePath}` : ''
}

/**
 * Convert a product from the API into the frontend's Product shape. The API sends
 * ids as strings ("9"); they are converted to numbers here, once, so every
 * comparison (cart, wishlist, admin lists) works with the same type.
 */
const mapApiProduct = (p: any): Product => ({
  id: Number(p.id),
  name: p.name,
  category: p.category,
  price: Number(p.price),
  originalPrice: p.original_price !== null && p.original_price !== undefined ? Number(p.original_price) : undefined,
  discount: p.discount !== null && p.discount !== undefined ? Number(p.discount) : 0,
  stock: Number(p.stock) || 0,
  image: productImageUrl(p.image),
  images: Array.isArray(p.images)
    ? p.images
        .map((img: any) => productImageUrl(typeof img === 'string' ? img : img?.image))
        .filter(Boolean)
    : [],
  badge: p.badge ?? undefined,
  fabric: p.fabric ?? '',
  color: p.color ?? '',
  sku: p.sku ?? '',
  length: p.length ?? '',
  blouse: p.blouse ?? '',
  occasion: p.occasion ?? '',
  inStock: Boolean(p.in_stock),
  isActive: p.is_active === undefined ? true : Boolean(p.is_active),
  soldCount: Number(p.sold_count) || 0,
  description: p.description ?? undefined,
  returnExchange: p.return_exchange ?? undefined,
  manufacturedBy: p.manufactured_by ?? undefined,
  marketedBy: p.marketed_by ?? undefined,
})

/** Expiry time (ms since epoch) from a JWT's `exp` claim, or null if it cannot be read. */
const tokenExpiryMs = (token: string | undefined | null): number | null => {
  try {
    const payload = token?.split('.')[1]
    if (!payload) return null
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof json.exp === 'number' ? json.exp * 1000 : null
  } catch {
    return null
  }
}

/** Badge colours for an order's payment status. */
const paymentStatusColor = (status: string | null | undefined) => ({
  Paid: 'bg-green-50 text-green-700',
  Failed: 'bg-red-50 text-red-700',
  Refunded: 'bg-blue-50 text-blue-700',
}[status ?? ''] ?? 'bg-yellow-50 text-yellow-700')

/** A product can be bought only when it is marked in stock AND has units left. */
const isPurchasable = (p: Pick<Product, 'inStock' | 'stock'>) => p.inStock && (p.stock ?? 0) > 0

const getProductMainImage = (p: Partial<Product> | null | undefined): string => {
  if (!p) return yaaleLogoTransparent
  if (p.image) {
    const url = productImageUrl(p.image)
    if (url) return url
  }
  if (Array.isArray(p.images) && p.images.length > 0) {
    for (const img of p.images) {
      const url = productImageUrl(typeof img === 'string' ? img : (img as any)?.image)
      if (url) return url
    }
  }
  return yaaleLogoTransparent
}

interface Product {
  id: number
  name: string
  category: string
  price: number
  originalPrice?: number
  discount?: number
stock?: number
  image: string
  images?: string[]
  video?: string
  badge?: 'NEW' | 'SALE' | 'BESTSELLER'
  fabric: string
  color: string
  sku: string
  length?: string
blouse?: string
occasion?: string
  inStock: boolean
  isActive?: boolean
  /** Units sold in orders that were not cancelled (for "Best Selling"). */
  soldCount?: number
  description?: string
  returnExchange?: string
  manufacturedBy?: string
  marketedBy?: string
}

interface CartItem extends Product { qty: number }

interface EditorialVideo {
  id: number
  title: string
  src: string
  poster: string
}

interface AdminCategory {
  id: number
  name: string
  description: string
  is_active: boolean
  products_count: number
}

interface AdminCustomer {
  name: string
  email: string | null
  phone: string
  orders: number
  spend: number | string
  joined_at: string | null
  is_active: boolean | null
}

interface AdminAuthSession {
  token: string
  user: { id: number; name: string; email: string }
}

interface AdminDashboardStats {
  total_sarees: { count: number; change: string }
  total_orders: { count: number; change: string }
  total_sales: { amount: number; formatted: string; change: string }
  pending_orders: { count: number; urgent: number; change: string }
  low_stock: { count: number; out_of_stock: number; change: string }
  customers: { count: number; change: string }
}

interface CustomerAuthSession {
  token: string
  user: { id: number; name: string; email: string }
}

interface CustomerAddress {
  id: number
  user_id: number
  name: string
  phone: string
  address_line: string
  city: string
  state: string
  pin_code: string
  landmark: string | null
  is_default: boolean
  created_at?: string
  updated_at?: string
}

interface CustomerOrderItem {
  id: number
  product_id: number
  product_name: string
  quantity: number
  price: number | string
  product?: Product | null
}

interface CustomerOrderStatusEvent {
  id: number
  status: string
  note: string | null
  created_at: string
  changed_by: number | null
}

interface CustomerOrder {
  id: number
  order_number: string
  customer_name: string
  customer_phone: string
  customer_address: string
  total_amount: number | string
  payment_status: string
  status: string
  created_at: string
  expected_delivery_date?: string | null
  subtotal_amount?: string | null
  shipping_amount?: string | null
  discount_amount?: string | null
  coupon_code?: string | null
  /** True while the customer may still cancel (Pending or Confirmed). */
  can_cancel?: boolean
  items: CustomerOrderItem[]
  status_history: CustomerOrderStatusEvent[]
}

/** What the backend returns to open the Razorpay Checkout popup. */
interface RazorpayPaymentStart {
  provider: 'razorpay'
  key_id: string
  razorpay_order_id: string
  amount: number
  currency: string
}

/** The order just placed, shown on the success page. */
interface PlacedOrder {
  id: string
  order_number: string
  total_amount: string
  payment_status: string
}

interface StoreSettingsForm {
  store_name: string
  store_email: string
  store_phone: string
  store_address: string
  shipping_fee: string
  free_shipping_threshold: string
  return_policy: string
  shipping_policy: string
  privacy_policy: string
  terms_policy: string
  /** Read-only: true when the backend has Razorpay keys, so checkout takes payment online. */
  online_payment?: boolean
}

const EMPTY_STORE_SETTINGS: StoreSettingsForm = {
  store_name: '',
  store_email: '',
  store_phone: '',
  store_address: '',
  shipping_fee: '',
  free_shipping_threshold: '',
  return_policy: '',
  shipping_policy: '',
  privacy_policy: '',
  terms_policy: '',
}

type OfferType = 'Discount' | 'Coupon' | 'Banner' | 'Promotion'
type OfferStatus = 'Active' | 'Scheduled' | 'Paused'

interface AdminOffer {
  id: number
  title: string
  type: OfferType
  value: string
  description: string
  status: OfferStatus
  /** Coupon code customers enter at checkout; null for banner-only offers. */
  code?: string | null
  discount_type?: 'percent' | 'flat' | null
  discount_value?: string | null
  min_order_amount?: string | null
}

interface OfferForm {
  title: string
  type: OfferType
  value: string
  description: string
  status: OfferStatus
  code: string
  discount_type: 'percent' | 'flat'
  discount_value: string
  min_order_amount: string
}

const EMPTY_OFFER_FORM: OfferForm = {
  title: '', type: 'Discount', value: '', description: '', status: 'Active',
  code: '', discount_type: 'percent', discount_value: '', min_order_amount: '',
}

// ── Data ───────────────────────────────────────────────────────────────────

interface ProductsStore {
  products: Product[]
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>
  productsLoading: boolean
  productsError: string
  refreshProducts: () => Promise<void>
  videos: EditorialVideo[]
  setVideos: React.Dispatch<React.SetStateAction<EditorialVideo[]>>
  videosLoading: boolean
  videosError: string
  setVideosError: React.Dispatch<React.SetStateAction<string>>
}

const ProductsContext = createContext<ProductsStore | null>(null)
const StoreSettingsContext = createContext<StoreSettingsForm>(EMPTY_STORE_SETTINGS)

function useProductsStore() {
  const store = useContext(ProductsContext)
  if (!store) throw new Error('useProductsStore must be used inside ProductsContext')
  return store
}

// ── Sub-components ─────────────────────────────────────────────────────────
function AnnouncementBar() {
  const [couponText, setCouponText] = useState('')

  // Show active coupon offers, e.g. "USE CODE FESTIVE10 — 10% off".
  useEffect(() => {
    let active = true
    fetch(`${API_BASE_URL}/api/offers`, { headers: { Accept: 'application/json' } })
      .then(response => response.ok ? response.json() : [])
      .then((offers: AdminOffer[]) => {
        if (!active || !Array.isArray(offers)) return
        const coupons = offers
          .filter(offer => offer.code)
          .map(offer => `USE CODE ${offer.code} — ${offer.title.toUpperCase()}`)
        setCouponText(coupons.join(' • '))
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  const message = ['PAN INDIA DELIVERY', 'SECURE ONLINE PAYMENT', couponText, 'EXCLUSIVELY HANDCRAFTED']
    .filter(Boolean)
    .join(' • ')

  return (
    <div className="announcement-bar" aria-label="Store announcement">
      <div className="announcement-bar-track">
        <span>{message}</span>
        <span aria-hidden="true">{message}</span>
      </div>
    </div>
  )
}

function Header({ page, setPage, cartCount, wishlistCount, customerSession, onCustomerLogout }: {
  page: Page
  setPage: (p: Page) => void
  cartCount: number
  wishlistCount: number
  customerSession: CustomerAuthSession | null
  onCustomerLogout: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', fn)
    return () => window.removeEventListener('scroll', fn)
  }, [])

  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  const navLinks: { label: string; href: Page }[] = [
    { label: 'Home', href: 'home' },
    { label: 'Shop', href: 'shop' },
    { label: 'About', href: 'about' },
    { label: 'Contact', href: 'contact' },
  ]

  return (
    <header className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? 'bg-[#E8C9CF]/95 backdrop-blur-md shadow-sm' : 'bg-[#E8C9CF]'} border-b border-border`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-[1fr_auto_1fr] items-center min-h-[88px] py-2">
        {/* Left cell: Hamburger menu on mobile, Desktop nav Home & Shop on desktop */}
        <div className="flex items-center justify-start md:justify-end">
          <button
            className="md:hidden flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-[#f0e9dd] text-[#063737] transition-colors hover:bg-[#F4EAE2] cursor-pointer"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
          >
            <span className="flex flex-col items-center gap-1.5">
              <span className="block h-0.5 w-4 rounded-full bg-current" />
              <span className="block h-0.5 w-4 rounded-full bg-current" />
              <span className="block h-0.5 w-4 rounded-full bg-current" />
            </span>
          </button>
          <nav className="hidden md:flex items-center gap-8 pr-10">
            <button
              onClick={() => setPage('home')}
              className={`text-sm tracking-widest uppercase font-light transition-colors duration-200 cursor-pointer ${page === 'home' ? 'text-[#063737]' : 'text-[#063737] hover:text-[#A25524]'}`}
            >
              Home
            </button>
            <button
              onClick={() => setPage('shop')}
              className={`text-sm tracking-widest uppercase font-light transition-colors duration-200 cursor-pointer ${page === 'shop' ? 'text-[#063737]' : 'text-[#063737] hover:text-[#A25524]'}`}
            >
              Shop
            </button>
          </nav>
        </div>

        {/* Center cell: Logo */}
        <div className="flex items-center justify-center">
          <button onClick={() => setPage('home')} className="flex items-center leading-none cursor-pointer" aria-label="Yaale home">
            <img src={yaaleLogoTrimmed} alt="Yaale, Soulful Weaves" className="h-[clamp(34px,10vw,48px)] md:h-14 w-auto object-contain" />
          </button>
        </div>

        {/* Right cell: About and Contact on desktop, 3 tightly-grouped icons on mobile & desktop */}
        <div className="flex items-center justify-end md:justify-between">
          <nav className="hidden md:flex items-center gap-8 pl-10">
            <button
              onClick={() => setPage('about')}
              className={`text-sm tracking-widest uppercase font-light transition-colors duration-200 cursor-pointer ${page === 'about' ? 'text-[#063737]' : 'text-[#063737] hover:text-[#A25524]'}`}
            >
              About
            </button>
            <button
              onClick={() => setPage('contact')}
              className={`text-sm tracking-widest uppercase font-light transition-colors duration-200 cursor-pointer ${page === 'contact' ? 'text-[#063737]' : 'text-[#063737] hover:text-[#A25524]'}`}
            >
              Contact
            </button>
          </nav>

          {/* Icons: Wishlist, Bag, Account - tightly grouped with gap-1 to gap-2, 44px tap targets */}
          <div className="flex items-center gap-1 sm:gap-2">
            <button onClick={() => setPage(customerSession ? 'wishlist' : 'account-sign-in')} className="relative flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center p-2 text-[#063737] hover:text-[#A25524] transition-colors cursor-pointer" aria-label="Wishlist">
              <HeartIcon />
              {wishlistCount > 0 && <span className="absolute top-1 right-1 w-4 h-4 bg-[#A25524] text-[#F4EAE2] text-[9px] rounded-full flex items-center justify-center font-medium shadow-xs">{wishlistCount}</span>}
            </button>
            <button onClick={() => setPage('cart')} className="relative flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center p-2 text-[#063737] hover:text-[#A25524] transition-colors cursor-pointer" aria-label="Cart">
              <BagIcon />
              {cartCount > 0 && <span className="absolute top-1 right-1 w-4 h-4 bg-[#A25524] text-[#F4EAE2] text-[9px] rounded-full flex items-center justify-center font-medium shadow-xs">{cartCount}</span>}
            </button>
            <button onClick={() => setPage(customerSession ? 'account' : 'account-sign-in')} className="relative flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center p-2 text-[#063737] hover:text-[#A25524] transition-colors cursor-pointer" aria-label="Account">
              <UserIcon />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer (slides in from right, w-[85vw] max-w-[360px] h-[100dvh], with bg-black/40 backdrop) */}
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-[60] flex justify-end">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Side Drawer Panel */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation Menu"
            className="relative z-10 w-[85vw] max-w-[360px] h-[100dvh] bg-cream shadow-2xl flex flex-col justify-between overflow-y-auto pb-[calc(2.5rem+env(safe-area-inset-bottom))]"
          >
            <div>
              {/* Drawer Header: Title + X button aligned with px-[clamp(16px,6vw,24px)] */}
              <div className="flex items-center justify-between px-[clamp(16px,6vw,24px)] pt-5 pb-4 border-b border-border">
                <h2 className="font-serif text-3xl text-charcoal">Menu</h2>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center p-2 text-charcoal cursor-pointer"
                  aria-label="Close menu"
                >
                  <XIcon />
                </button>
              </div>

              {/* Navigation Menu Rows */}
              <div className="px-[clamp(16px,6vw,24px)]">
                {[
                  { label: 'Home', href: 'home' },
                  { label: 'New Arrivals', href: 'shop' },
                  { label: 'Shop All', href: 'shop' },
                  { label: 'Festive Edits', href: 'shop' },
                  { label: 'Best Sellers', href: 'shop' },
                  { label: 'Sale', href: 'shop' },
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={() => { setPage(item.href as Page); setMenuOpen(false) }}
                    className="mobile-menu-row flex h-14 w-full items-center justify-between border-b border-border text-left text-[14px] sm:text-[15px] tracking-[0.18em] uppercase text-charcoal cursor-pointer"
                  >
                    <span className="shrink-0">{item.label}</span>
                    <span className="shrink-0 ml-auto flex items-center pr-1 text-warm-gray text-xl select-none" aria-hidden="true">›</span>
                  </button>
                ))}

                {/* Account Section: vertical list with divider above it */}
                <div className="pt-2">
                  <div className="flex flex-col py-1">
                    {customerSession ? (
                      <>
                        <button
                          onClick={() => { setPage('account'); setMenuOpen(false) }}
                          className="mobile-account-row flex items-center gap-4 py-3 text-left cursor-pointer min-h-[44px]"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-charcoal text-charcoal">
                            <UserIcon />
                          </span>
                          <span className="font-serif text-[15px] sm:text-[16px] text-charcoal font-normal">My Account</span>
                        </button>
                        <button
                          onClick={() => { onCustomerLogout(); setMenuOpen(false) }}
                          className="mobile-account-row flex items-center gap-4 py-3 text-left cursor-pointer min-h-[44px]"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-wine text-wine">
                            <UserIcon />
                          </span>
                          <span className="font-serif text-[15px] sm:text-[16px] text-wine font-normal">Sign Out</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => { setPage('account-sign-in'); setMenuOpen(false) }}
                          className="mobile-account-row flex items-center gap-4 py-3 text-left cursor-pointer min-h-[44px]"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-charcoal text-charcoal">
                            <UserIcon />
                          </span>
                          <span className="font-serif text-[15px] sm:text-[16px] text-charcoal font-normal">Sign In</span>
                        </button>
                        <button
                          onClick={() => { setPage('account'); setMenuOpen(false) }}
                          className="mobile-account-row flex items-center gap-4 py-3 text-left cursor-pointer min-h-[44px]"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-charcoal text-charcoal">
                            <UserIcon />
                          </span>
                          <span className="font-serif text-[15px] sm:text-[16px] text-charcoal font-normal">Create an Account</span>
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => { setPage(customerSession ? 'wishlist' : 'account-sign-in'); setMenuOpen(false) }}
                      className="mobile-account-row flex items-center gap-4 py-3 text-left cursor-pointer min-h-[44px]"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-charcoal text-charcoal">
                        <HeartIcon size={16} />
                      </span>
                      <span className="font-serif text-[15px] sm:text-[16px] text-charcoal font-normal">
                        My Wish List {wishlistCount > 0 ? `(${wishlistCount})` : ''}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}

function ProductCard({ p, onAdd, onWishlist, wishlist, onClick, shopCard = false }: {
  p: Product, onAdd: (p: Product) => void, onWishlist: (id: number) => void, wishlist: number[], onClick: (p: Product) => void, shopCard?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const [popping, setPopping] = useState(false)
  const [imgSrc, setImgSrc] = useState(() => getProductMainImage(p))
  const cardRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setImgSrc(getProductMainImage(p))
  }, [p.image, p.images])

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!shopCard || window.innerWidth < 768 || !cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left - rect.width / 2
    const y = e.clientY - rect.top - rect.height / 2
    const tiltX = -(y / (rect.height / 2)) * 4
    const tiltY = (x / (rect.width / 2)) * 4
    cardRef.current.style.setProperty('--tilt-x', `${tiltX.toFixed(2)}deg`)
    cardRef.current.style.setProperty('--tilt-y', `${tiltY.toFixed(2)}deg`)
  }

  const handleMouseLeave = () => {
    setHovered(false)
    if (cardRef.current) {
      cardRef.current.style.setProperty('--tilt-x', '0deg')
      cardRef.current.style.setProperty('--tilt-y', '0deg')
      cardRef.current.style.transform = ''
    }
    if (imageRef.current) {
      imageRef.current.style.transform = ''
    }
  }

  const inWish = wishlist.includes(p.id)

  return (
    <div
      ref={cardRef}
      className={`group cursor-pointer product-card-motion transition-all duration-300 will-change-transform ${shopCard ? 'shop-product-card' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className={`relative overflow-hidden bg-[#f0e9dd] ${shopCard ? 'shop-product-frame rounded-[20px]' : 'rounded-3xl'}`} style={shopCard ? { aspectRatio: '3 / 4' } : { aspectRatio: '3 / 4' }} onClick={() => onClick(p)}>
        <img ref={imageRef} src={imgSrc} alt={p.name} loading="lazy" onError={() => setImgSrc(brownCottonSareeImg)}
          className={`shop-product-image h-full w-full object-cover transition-transform duration-700 ease-out ${hovered ? 'scale-[1.06]' : 'scale-100'}`} />
        <div className="absolute inset-0 bg-charcoal/0 group-hover:bg-charcoal/10 transition-colors duration-300 rounded-[20px]" />

        {p.badge && (
          <span className={`absolute left-3 top-[14px] text-[10px] tracking-[0.15em] uppercase px-2.5 py-1 rounded-full font-medium ${
            p.badge === 'SALE' ? 'bg-wine text-white' :
            p.badge === 'BESTSELLER' ? 'bg-charcoal text-champagne' :
            'bg-champagne text-charcoal'}`}>{p.badge}</span>
        )}

        <button
          type="button"
          className={`wishlist-btn absolute grid place-items-center ${shopCard ? 'top-[14px] right-[14px] h-10 w-10 border-0 bg-transparent shadow-none' : 'top-3 right-3 h-8 w-8 rounded-full border border-transparent bg-white/80 text-warm-gray hover:bg-white hover:text-wine'} transition-transform duration-200 ${inWish ? 'is-active text-wine' : 'text-white'} hover:scale-[1.15]`}
          data-product-id={String(p.id)}
          data-active={String(inWish)}
          onClick={e => {
            e.preventDefault()
            e.stopPropagation()
            if (shopCard) {
              setPopping(true)
              window.setTimeout(() => setPopping(false), 180)
            }
            onWishlist(p.id)
          }}
          style={shopCard ? { filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.45))', ['--heart-scale' as any]: popping ? '1.3' : '1' } : undefined}
          aria-label={inWish ? 'Remove from wishlist' : 'Add to wishlist'}
        >
          <HeartIcon filled={inWish} size={shopCard ? 24 : 14} />
        </button>

        {isPurchasable(p) && (
          <div className={`absolute inset-x-0 bottom-0 p-3 transition-all duration-300 ${hovered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
            <button onClick={e => { e.stopPropagation(); onAdd(p) }}
              className="quick-add w-full bg-charcoal/90 backdrop-blur-sm text-champagne text-xs tracking-widest uppercase py-2.5 rounded-2xl hover:bg-charcoal transition-colors">
              Add to Bag
            </button>
          </div>
        )}
        {!isPurchasable(p) && (
          <div className="absolute inset-x-3 bottom-3">
            <div className="w-full bg-warm-gray/70 backdrop-blur-sm text-white text-xs tracking-widest uppercase py-2.5 rounded-2xl text-center">
              Out of Stock
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 px-1" onClick={() => onClick(p)}>
        <p className="text-xs text-gold tracking-widest uppercase">
          {p.category}
        </p>

        <h3 className={`font-serif mt-0.5 leading-tight ${shopCard ? 'text-[1.0625rem]' : 'text-base'} text-charcoal`}>
          <span className={shopCard ? 'inline-block pb-[2px] relative after:absolute after:bottom-0 after:left-0 after:h-[1.5px] after:w-full after:origin-left after:scale-x-0 after:bg-[#C9A227] after:transition-transform after:duration-300 group-hover:after:scale-x-100' : ''}>{p.name}</span>
        </h3>

        <div className="mt-1 flex items-center gap-2">
          {p.originalPrice && p.originalPrice > p.price ? (
            <>
              <span className="text-xs text-[#75645D]/80 line-through">
                ₹{p.originalPrice.toLocaleString('en-IN')}
              </span>

              <span className="text-sm font-semibold text-charcoal">
                ₹{p.price.toLocaleString('en-IN')}
              </span>
            </>
          ) : (
            <span className="text-sm font-semibold text-charcoal">
              ₹{p.price.toLocaleString('en-IN')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}


// ── Pages ──────────────────────────────────────────────────────────────────
const HERO_QUOTES = [
  '“Every thread remembers the hands that wove it.”',
  '“Slow cloth for a life well lived.”',
  '“Some stories are woven, not written.”',
  '“Draped in tradition, worn in your own way.”',
]

function HeroQuoteCard({ reducedMotion }: { reducedMotion: boolean }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [quoteIndex, setQuoteIndex] = useState(0)
  const [isFadingOut, setIsFadingOut] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isHeroVisible, setIsHeroVisible] = useState(true)
  const [isTabVisible, setIsTabVisible] = useState(true)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const isFirstMount = useRef(true)

  // IntersectionObserver to observe if quote card is on screen
  useEffect(() => {
    if (!cardRef.current || reducedMotion) return
    const el = cardRef.current
    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0]
        if (entry) {
          setIsHeroVisible(entry.isIntersecting)
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [reducedMotion])

  // Track tab visibility
  useEffect(() => {
    if (reducedMotion) return
    const handleVisibility = () => {
      setIsTabVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [reducedMotion])

  // Mouse tilt on desktop (pointer: fine, min-width: 768px)
  useEffect(() => {
    if (reducedMotion) return

    const isDesktopPointer = () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 768px) and (pointer: fine)').matches

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDesktopPointer() || !cardRef.current) return
      const rect = cardRef.current.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const distX = e.clientX - centerX
      const distY = e.clientY - centerY

      if (Math.abs(distX) < 450 && Math.abs(distY) < 450) {
        const tiltY = Math.max(-4, Math.min(4, (distX / (rect.width * 1.5)) * 4))
        const tiltX = Math.max(-4, Math.min(4, (-distY / (rect.height * 1.5)) * 4))
        setTilt({ x: tiltX, y: tiltY })
      } else {
        setTilt({ x: 0, y: 0 })
      }
    }

    const handleMouseLeave = () => {
      setTilt({ x: 0, y: 0 })
    }

    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    document.addEventListener('mouseleave', handleMouseLeave)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [reducedMotion])

  // Rotate quotes every 6 seconds when not paused
  useEffect(() => {
    if (reducedMotion) return

    if (isHovered || isFocused || !isHeroVisible || !isTabVisible) {
      return
    }

    const interval = setInterval(() => {
      setIsFadingOut(true)
      setTimeout(() => {
        isFirstMount.current = false
        setQuoteIndex(prev => (prev + 1) % HERO_QUOTES.length)
        setIsFadingOut(false)
      }, 400)
    }, 6000)

    return () => clearInterval(interval)
  }, [reducedMotion, isHovered, isFocused, isHeroVisible, isTabVisible])

  const activeQuote = HERO_QUOTES[quoteIndex]
  const words = activeQuote.split(' ')

  if (reducedMotion) {
    return (
      <div
        ref={cardRef}
        className="absolute max-md:top-[2%] max-md:left-0 max-md:w-[48%] max-md:max-w-[200px] max-md:p-[clamp(10px,2.5vw,16px)] md:left-[2%] md:sm:left-[5%] md:top-[8%] md:sm:top-[10%] md:max-w-[240px] md:px-5 md:py-4 z-10 rounded-2xl bg-[#FBF6F2] shadow-[0_12px_30px_rgba(6,55,55,0.12)]"
      >
        <p className="font-serif text-[clamp(13px,4vw,17px)] md:text-[20px] leading-snug text-[#063737]">
          {HERO_QUOTES[0]}
        </p>
        <p className="mt-1.5 md:mt-2 text-[clamp(10px,2.8vw,12px)] md:text-[12px] text-[#75645D]">
          Yaalé, soulful weaves
        </p>
      </div>
    )
  }

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false)
        setTilt({ x: 0, y: 0 })
      }}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      tabIndex={0}
      aria-label={`${activeQuote} Yaalé, soulful weaves`}
      className="hero-quote-card absolute max-md:top-[2%] max-md:left-0 max-md:w-[48%] max-md:max-w-[200px] md:left-[2%] md:sm:left-[5%] md:top-[8%] md:sm:top-[10%] md:max-w-[240px] z-10 rounded-2xl outline-none"
      style={{
        transform: tilt.x || tilt.y
          ? `perspective(800px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`
          : 'perspective(800px) rotateX(0deg) rotateY(0deg)',
        transition: isHovered
          ? 'transform 0.15s ease-out'
          : 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}
    >
      {/* Floating drift wrapper */}
      <div className="hero-quote-float w-full rounded-2xl bg-[#FBF6F2] max-md:p-[clamp(10px,2.5vw,16px)] md:px-5 md:py-4 shadow-[0_12px_30px_rgba(6,55,55,0.12)]">
        {/* Responsive CSS Grid to reserve height of longest quote */}
        <div className="grid grid-cols-1 grid-rows-1">
          {/* Invisible height sizers */}
          <div
            className="invisible col-start-1 row-start-1 select-none pointer-events-none font-serif text-[clamp(13px,4vw,17px)] md:text-[20px] leading-snug"
            aria-hidden="true"
          >
            {HERO_QUOTES[0]}
            <p className="mt-1.5 md:mt-2 text-[clamp(10px,2.8vw,12px)] md:text-[12px]">
              Yaalé, soulful weaves
            </p>
          </div>
          <div
            className="invisible col-start-1 row-start-1 select-none pointer-events-none font-serif text-[clamp(13px,4vw,17px)] md:text-[20px] leading-snug"
            aria-hidden="true"
          >
            {HERO_QUOTES[3]}
            <p className="mt-1.5 md:mt-2 text-[clamp(10px,2.8vw,12px)] md:text-[12px]">
              Yaalé, soulful weaves
            </p>
          </div>

          {/* Active quote container */}
          <div
            className={`col-start-1 row-start-1 transition-opacity duration-400 ease-out ${
              isFadingOut ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <span className="sr-only">{activeQuote}</span>

            {/* Word-by-word visual reveal */}
            <p
              className="font-serif text-[clamp(13px,4vw,17px)] md:text-[20px] leading-snug text-[#063737]"
              aria-hidden="true"
            >
              {words.map((word, wIdx) => {
                const staggerDelay = isFirstMount.current
                  ? 0.45 + wIdx * 0.06
                  : 0.05 + wIdx * 0.06
                return (
                  <span
                    key={`${quoteIndex}-${wIdx}`}
                    className={`hero-quote-word inline-block ${
                      wIdx < words.length - 1 ? 'mr-[0.26em]' : ''
                    }`}
                    style={{
                      animationDelay: `${staggerDelay}s`,
                    }}
                  >
                    {word}
                  </span>
                )
              })}
            </p>

            {/* Attribution */}
            <p
              key={`attr-${quoteIndex}`}
              className="hero-quote-attribution mt-1.5 md:mt-2 text-[clamp(10px,2.8vw,12px)] md:text-[12px] text-[#75645D]"
              style={{
                animationDelay: `${
                  (isFirstMount.current ? 0.45 : 0.05) + words.length * 0.06 + 0.1
                }s`,
              }}
            >
              Yaalé, soulful weaves
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function HomePage({ setPage, setSelectedProduct, onAdd, onWishlist, wishlist, onCategorySelect }: { setPage: (p: Page) => void, setSelectedProduct: (p: Product) => void, onAdd: (p: Product) => void, onWishlist: (id: number) => void, wishlist: number[], onCategorySelect: (category: Exclude<ShopCategoryFilter, 'ALL'>) => void }) {
  const { products, videos, videosLoading, videosError } = useProductsStore()
  const videoRailRef = useRef<HTMLDivElement>(null)
  const homeRowRef = useRef<HTMLDivElement>(null)
  const videoRefs = useRef<Record<number, HTMLVideoElement | null>>({})
  const scrollFrameRef = useRef<number | null>(null)
  const [activeVideo, setActiveVideo] = useState(0)

   const bestSellers = products.filter(p => p.badge === 'BESTSELLER' || p.id <= 4).slice(0, 4)
   const [reducedMotion, setReducedMotion] = useState(false)
   const [homeMarqueePaused, setHomeMarqueePaused] = useState(false)
   const [homeMarqueeReady, setHomeMarqueeReady] = useState(false)
   const homeSectionRef = useRef<HTMLElement | null>(null)

   useEffect(() => {
     const media = window.matchMedia('(prefers-reduced-motion: reduce)')
     const updateMotionPreference = () => setReducedMotion(media.matches)
     updateMotionPreference()
     media.addEventListener?.('change', updateMotionPreference)
     return () => media.removeEventListener?.('change', updateMotionPreference)
   }, [])

   useEffect(() => {
     const markReady = () => setHomeMarqueeReady(true)
     if (document.readyState === 'complete') {
       markReady()
       return
     }
     window.addEventListener('load', markReady)
     return () => window.removeEventListener('load', markReady)
   }, [])

   useEffect(() => {
     if (!homeSectionRef.current || reducedMotion) return

     const section = homeSectionRef.current
     const observer = new IntersectionObserver((entries) => {
       const isVisible = entries.some(entry => entry.isIntersecting)
       setHomeMarqueePaused(!isVisible)
     }, { threshold: 0.2 })

     observer.observe(section)
     return () => observer.disconnect()
   }, [reducedMotion])

   useEffect(() => {
     const row = homeRowRef.current
     if (!row || reducedMotion || !homeMarqueeReady || bestSellers.length === 0) return

     const cards = row.querySelectorAll<HTMLElement>('.home-best-seller-card')
     if (!cards.length || !window.gsap) return

     const media = window.gsap.matchMedia()
     media.add('(min-width: 768px)', () => {
       window.gsap.fromTo(cards, { autoAlpha: 0, x: 60 }, { autoAlpha: 1, x: 0, duration: 0.55, ease: 'power3.out', stagger: 0.08 })
     })
     media.add('(max-width: 767px)', () => {
       window.gsap.fromTo(cards, { autoAlpha: 0, x: 24 }, { autoAlpha: 1, x: 0, duration: 0.45, ease: 'power3.out', stagger: 0.07 })
     })

     return () => media.revert()
   }, [bestSellers.length, reducedMotion, homeMarqueeReady])

   const homeMarqueeProducts = reducedMotion ? bestSellers : [...bestSellers, ...bestSellers]

   const goToVideo = (index: number) => {
    if (!videos.length) return
    const nextIndex = (index + videos.length) % videos.length
    const rail = videoRailRef.current
    const card = rail?.children[nextIndex] as HTMLElement | undefined
    if (rail && card) {
      rail.scrollTo({
        left: card.offsetLeft - (rail.clientWidth - card.offsetWidth) / 2,
        behavior: 'smooth',
      })
    }
    setActiveVideo(nextIndex)
  }

   useEffect(() => {
     if (!videos.length) return

     Object.entries(videoRefs.current).forEach(([index, video]) => {
       if (!video) return
       const numericIndex = Number(index)
       const shouldPlay = numericIndex === activeVideo

       if (shouldPlay) {
         video.muted = true
         video.loop = true
         video.playsInline = true
         void video.play().catch(() => {})
       } else {
         video.pause()
         video.currentTime = 0
       }
     })
   }, [activeVideo, videos])

   return (
    <div>
      {/* Hero */}
      <section className="yaale-hero overflow-hidden bg-[#F4EAE2]">
        <div className="mx-auto grid max-w-7xl items-center gap-8 md:gap-10 px-4 sm:px-6 md:px-10 py-10 sm:py-12 lg:grid-cols-2 lg:gap-14 lg:py-[70px]">
          <div>
            <h1 className="font-serif text-[clamp(2.15rem,8.5vw,2.75rem)] leading-[1.04] tracking-[-0.01em] text-[#063737] sm:text-6xl lg:text-[4.75rem]">
              Handwoven sarees, made to be passed down.
            </h1>
            <p className="mb-7 sm:mb-9 mt-4 sm:mt-6 max-w-[460px] text-[clamp(15px,3.8vw,16px)] leading-relaxed text-[#75645D] sm:text-lg">
              Kanjivaram silks, soft cottons and everyday handlooms, picked directly from weavers across South India.
            </p>
            <div className="max-md:flex max-md:flex-nowrap max-md:gap-3 md:flex md:flex-wrap md:gap-4 w-full md:w-auto">
              <button onClick={() => setPage('shop')}
                className="hero-btn-primary flex-1 min-w-0 md:flex-none md:w-auto min-h-[44px] flex items-center justify-center rounded-full bg-[#063737] max-md:px-3 max-md:py-3.5 max-md:text-[clamp(10px,3vw,12px)] max-md:tracking-[0.12em] md:px-8 md:py-4 md:text-[13px] font-medium uppercase md:tracking-[0.16em] text-white transition-colors duration-300 whitespace-nowrap text-center">
                Shop sarees
              </button>
              <button onClick={() => setPage('about')}
                className="hero-btn-secondary flex-1 min-w-0 md:flex-none md:w-auto min-h-[44px] flex items-center justify-center rounded-full border border-[#063737] bg-transparent max-md:px-3 max-md:py-3.5 max-md:text-[clamp(10px,3vw,12px)] max-md:tracking-[0.12em] md:px-8 md:py-4 md:text-[13px] font-medium uppercase md:tracking-[0.16em] text-[#063737] transition-colors duration-300 whitespace-nowrap text-center">
                Our weavers
              </button>
            </div>
          </div>

          <div className="relative mx-auto max-md:h-auto max-md:aspect-[4/5] w-full max-w-[560px] md:h-[560px] lg:h-[600px]">
            <div className="absolute right-0 top-0 h-[93%] w-[66%] rounded-b-[18px] rounded-t-full overflow-hidden">
              <img
                src={heroBigImg}
                alt="Woman wearing a red Kanjivaram silk saree with gold zari"
                loading="eager"
                fetchPriority="high"
                decoding="async"
                width={370}
                height={560}
                className="h-full w-full object-cover object-[50%_15%]"
              />
            </div>
            <div className="absolute bottom-0 left-0 h-[50%] w-[41%] rounded-[18px] border-4 sm:border-8 border-[#F4EAE2] bg-[#F4EAE2] overflow-hidden">
              <img
                src={heroSmallImg}
                alt="Woman wearing a dark cotton saree with a red border"
                loading="eager"
                decoding="async"
                width={230}
                height={300}
                className="h-full w-full object-cover object-[50%_25%]"
              />
            </div>
            <HeroQuoteCard reducedMotion={reducedMotion} />
          </div>
        </div>
      </section>

      {/* Category Cards */}
      <section className="py-14 sm:py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="text-center mb-10 sm:mb-14">
          <p className="text-gold text-xs tracking-[0.35em] uppercase mb-3">Collections</p>
          <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl text-charcoal">Shop by Category</h2>
        </div>
        <div className="flex gap-3 overflow-x-auto px-1 pb-4 snap-x snap-mandatory sm:gap-6 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0">
          {[
            {
              title: 'Soft Silk Sarees',
              desc: 'Elegant traditional silk, woven for royalty.',
              img: 'https://images.unsplash.com/photo-1597897569252-9df44c7de0db?w=900&h=1200&fit=crop&auto=format',
              fallback: 'https://images.unsplash.com/photo-1597897569252-9df44c7de0db?w=900&h=1200&fit=crop&auto=format',
              cat: 'Soft Silk',
            },
            {
              title: 'Cotton Sarees',
              desc: 'Light, breathable, and timelessly graceful.',
              img: brownCottonSareeImg,
              fallback: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=900&h=1200&fit=crop&auto=format',
              cat: 'Cotton',
            },
            {
              title: 'Semi Silk Sarees',
              desc: 'A refined blend of tradition and modernity.',
              img: semiSilkSareeImg,
              fallback: 'https://images.unsplash.com/photo-1618489335755-e3aa2b16cd7a?w=900&h=1200&fit=crop&auto=format',
              cat: 'Semi Silk',
            },
          ].map(c => (
            <div key={c.cat} className="group relative w-[160px] sm:w-[220px] md:w-auto flex-shrink-0 snap-start cursor-pointer md:flex-shrink" onClick={() => { onCategorySelect(c.cat as Exclude<ShopCategoryFilter, 'ALL'>); setPage('shop') }}>
              <div className="relative mx-auto aspect-square w-full max-w-[430px] overflow-hidden rounded-full">
                <img
                  src={c.img}
                  alt={c.title}
                  style={{ objectPosition: 'center 20%' }}
                  onError={(e) => {
                    const target = e.currentTarget
                    if (target.src !== c.fallback) {
                      target.src = c.fallback
                    } else {
                      target.style.opacity = '0'
                    }
                  }}
                  className="absolute inset-0 h-full w-full object-cover object-center scale-[1.05] group-hover:scale-[1.08] transition-transform duration-700"
                />
                <div className="absolute inset-0 rounded-full bg-gradient-to-t from-charcoal/90 via-charcoal/15 to-transparent pointer-events-none" />
                <div className="absolute inset-x-0 bottom-0 p-3 text-center sm:p-5 md:p-7 pointer-events-none">
                  <h3 className="font-serif text-sm sm:text-lg md:text-2xl text-white tracking-wide">{c.title}</h3>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* New Arrivals */}
      <section className="py-16 bg-cream">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-12 flex flex-col items-center justify-between gap-5 sm:flex-row sm:items-end">
            <div className="text-center sm:text-left">
              <p className="text-gold text-xs tracking-[0.35em] uppercase mb-3">Just In</p>
              <h2 className="font-serif text-4xl sm:text-5xl text-charcoal mb-3">New Arrivals</h2>
              <p className="text-warm-gray font-light">Discover the latest additions to our curated collection.</p>
            </div>
            <button onClick={() => setPage('shop')}
              className="text-xs tracking-widest uppercase text-gold border-b border-gold/40 pb-0.5 hover:border-[#4a3a32] transition-colors">
              View All Sarees
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {products.slice(0, 8).map(p => (
              <ProductCard key={p.id} p={p} onAdd={onAdd} onWishlist={onWishlist} wishlist={wishlist} onClick={() => {
  setSelectedProduct(p)
  setPage('product')
}} />
            ))}
          </div>
        </div>
      </section>

      {/* Editorial video stories */}
      <section className="bg-ivory py-12 sm:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-7 flex items-end justify-between gap-4 sm:mb-10">
            <div>
              <p className="text-gold text-xs tracking-[0.35em] uppercase mb-2">From the studio</p>
              <h2 className="font-serif text-3xl sm:text-5xl text-charcoal">Festive Edit</h2>
            </div>
            <span className="hidden text-xs tracking-widest uppercase text-warm-gray sm:block">Swipe to explore</span>
          </div>
          <div ref={videoRailRef} onScroll={event => {
            if (scrollFrameRef.current !== null) return
            scrollFrameRef.current = window.requestAnimationFrame(() => {
              scrollFrameRef.current = null
              const rail = videoRailRef.current
              if (!rail || !rail.children.length) return
              const center = rail.scrollLeft + rail.clientWidth / 2
              const closest = Array.from(rail.children).reduce((best, _, index) => {
                const card = rail.children[index] as HTMLElement
                const bestCard = rail.children[best] as HTMLElement
                return Math.abs(card.offsetLeft + card.offsetWidth / 2 - center) < Math.abs(bestCard.offsetLeft + bestCard.offsetWidth / 2 - center) ? index : best
              }, 0)
              setActiveVideo(current => current === closest ? current : closest)
            })
          }} className="flex touch-pan-x snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain scroll-smooth px-[16vw] py-8 sm:gap-6 sm:px-[calc(50%-130px)] sm:scroll-px-[calc(50%-130px)] md:px-[calc(50%-145px)] md:scroll-px-[calc(50%-145px)]">
            {videosLoading ? (
              <p className="py-8 text-sm text-warm-gray">Loading videos...</p>
            ) : videosError ? (
              <p className="py-8 text-sm text-warm-gray">{videosError}</p>
            ) : videos.length === 0 ? (
              <p className="py-8 text-sm text-warm-gray">No videos available.</p>
            ) : videos.map((video, index) => (
              <article key={video.id} className={`relative flex-shrink-0 snap-center overflow-hidden rounded-[4px] bg-charcoal aspect-[9/14] w-[72vw] transition-[transform,opacity,box-shadow] duration-300 ease-out sm:w-[270px] md:w-[300px] ${index === activeVideo ? 'scale-100 opacity-100 shadow-[0_22px_45px_rgba(44,35,32,0.2)]' : 'scale-[0.88] opacity-80 shadow-[0_12px_26px_rgba(44,35,32,0.12)]'}`}>
                <video
                  ref={(element) => {
                    videoRefs.current[index] = element
                  }}
                  src={video.src}
                  poster={video.poster}
                  muted
                  loop
                  autoPlay
                  preload="metadata"
                  playsInline
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-charcoal/75 via-transparent to-transparent" />
                <h3 className="absolute inset-x-5 bottom-5 font-serif text-2xl text-white">{video.title}</h3>
              </article>
            ))}
          </div>
          {videos.length > 0 && !videosLoading && !videosError && (
            <div className="relative mt-4 mb-6 md:mt-1 md:mb-0 flex items-center justify-center gap-3 md:gap-4">
              <button
                onClick={() => goToVideo(activeVideo - 1)}
                className="flex h-10 w-10 md:h-9 md:w-9 min-h-[40px] min-w-[40px] items-center justify-center rounded-full bg-white text-charcoal shadow-sm transition-transform active:scale-95 cursor-pointer"
                aria-label="Previous video"
              >
                &#8592;
              </button>
              <div className="flex items-center gap-2 md:gap-1.5">
                {videos.map((video, index) => (
                  <button
                    key={video.id}
                    onClick={() => goToVideo(index)}
                    className={`video-indicator-dot cursor-pointer transition-all duration-300 rounded-full ${
                      index === activeVideo
                        ? 'bg-[#063737] w-[22px] h-[10px] md:h-2 md:w-2 md:bg-charcoal'
                        : 'bg-[#cfc5bd] w-[10px] h-[10px] md:h-2 md:w-2'
                    }`}
                    aria-label={`Go to video ${index + 1}`}
                  />
                ))}
              </div>
              <button
                onClick={() => goToVideo(activeVideo + 1)}
                className="flex h-10 w-10 md:h-9 md:w-9 min-h-[40px] min-w-[40px] items-center justify-center rounded-full bg-white text-charcoal shadow-sm transition-transform active:scale-95 cursor-pointer"
                aria-label="Next video"
              >
                &#8594;
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Featured Banner */}
      <section className="relative h-[70vh] min-h-[480px] overflow-hidden my-20 mx-4 sm:mx-8 lg:mx-16 rounded-3xl bg-charcoal">
        <img src="https://images.unsplash.com/photo-1618489335755-e3aa2b16cd7a?w=1600&h=900&fit=crop&auto=format"
          alt="Featured collection" className="absolute inset-0 w-full h-full object-cover opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-l from-charcoal/80 via-charcoal/30 to-transparent" />
        <div className="relative h-full flex flex-col justify-center items-end max-w-7xl mx-auto px-8 sm:px-16 text-right">
          <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-4 font-light">Featured Collection</p>
          <h2 className="font-serif text-4xl sm:text-5xl lg:text-6xl text-white leading-tight mb-6 max-w-xl">
            Crafted for <em className="text-champagne not-italic">Celebrations</em>
          </h2>
          <p className="text-white/60 font-light mb-8 max-w-sm">Bridal silks and festive weaves for every cherished occasion.</p>
          <button onClick={() => setPage('shop')}
            className="border border-champagne text-champagne px-8 py-3.5 rounded-full text-xs tracking-[0.25em] uppercase hover:bg-[#b8966a] hover:text-charcoal transition-all duration-300">
            Explore the Collection
          </button>
        </div>
      </section>

      {/* Best Sellers */}
      <section ref={homeSectionRef} className="py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-12">
          <div>
            <p className="text-gold text-xs tracking-[0.35em] uppercase mb-3">Most Loved</p>
            <h2 className="font-serif text-4xl sm:text-5xl text-charcoal">Best Sellers</h2>
          </div>
          <button onClick={() => setPage('shop')}
            className="text-xs tracking-widest uppercase text-gold border-b border-gold/40 pb-0.5 hover:border-[#4a3a32] transition-colors hidden sm:block">
            View All
          </button>
        </div>

        {reducedMotion ? (
          <div ref={homeRowRef} className="home-best-sellers-row flex gap-5 overflow-x-auto pb-3" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', scrollSnapType: 'x mandatory', touchAction: 'pan-y' }}>
            {bestSellers.map(p => (
              <div key={p.id} className="home-best-seller-card flex-shrink-0" style={{ width: 'clamp(260px, 28vw, 320px)', flex: '0 0 auto', scrollSnapAlign: 'start' }}>
                <ProductCard p={p} onAdd={onAdd} onWishlist={onWishlist} wishlist={wishlist} onClick={() => setPage('product')} />
              </div>
            ))}
          </div>
        ) : (
          <div
            ref={homeRowRef}
            className={`home-products-marquee ${homeMarqueePaused ? 'is-paused' : ''}`}
            onMouseEnter={() => setHomeMarqueePaused(true)}
            onMouseLeave={() => setHomeMarqueePaused(false)}
            onTouchStart={() => setHomeMarqueePaused(true)}
            onTouchEnd={() => setHomeMarqueePaused(false)}
            aria-label="Best sellers product marquee"
          >
            <div className="home-products-marquee-track" role="list" aria-live="polite">
              {homeMarqueeProducts.map((p, index) => (
                <div
                  key={`${p.id}-${index}`}
                  className="home-best-seller-card"
                  aria-hidden={index >= bestSellers.length}
                  tabIndex={index >= bestSellers.length ? -1 : 0}
                >
                  <ProductCard p={p} onAdd={onAdd} onWishlist={onWishlist} wishlist={wishlist} onClick={() => setPage('product')} />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Testimonials / Brand strip */}
      <section className="bg-charcoal py-10 md:py-16 px-3 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="max-md:grid max-md:grid-cols-3 max-md:gap-2 sm:grid sm:grid-cols-3 sm:gap-10 text-center">
            {[
              { label: '2000+', sub: 'Handpicked Sarees' },
              { label: '15,000+', sub: 'Happy Customers' },
              { label: 'Pan India', sub: 'Delivery' },
            ].map(s => (
              <div key={s.label} className="px-1 sm:px-2">
                <p className="font-serif text-[clamp(18px,6vw,26px)] md:text-4xl text-champagne mb-1 md:mb-2">{s.label}</p>
                <p className="text-white/50 text-[clamp(9px,2.6vw,11px)] md:text-xs tracking-[0.1em] md:tracking-widest uppercase font-light px-1 sm:px-2 leading-tight break-words">{s.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer setPage={setPage} />
    </div>
  )
}

function ShopPage({ setPage, setSelectedProduct, onAdd, onWishlist, wishlist, filter, setFilter }: { setPage: (p: Page) => void, setSelectedProduct: (p: Product) => void, onAdd: (p: Product) => void, onWishlist: (id: number) => void, wishlist: number[], filter: ShopCategoryFilter, setFilter: React.Dispatch<React.SetStateAction<ShopCategoryFilter>> }) {
  const { products } = useProductsStore()
  const [filterOpen, setFilterOpen] = useState(false)
  const [priceRange, setPriceRange] = useState('All Prices')
  const [sort, setSort] = useState('Newest')
  const [search, setSearch] = useState('')

  // Every search word must appear somewhere in the saree's name, category, fabric,
  // colour, occasion, SKU or description ("red silk" finds red silk sarees).
  const searchWords = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const matchesSearch = (p: Product) => {
    if (searchWords.length === 0) return true
    const haystack = [p.name, p.category, p.fabric, p.color, p.occasion, p.sku, p.description]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
    return searchWords.every(word => haystack.includes(word))
  }
  const [apiCategories, setApiCategories] = useState<string[]>([])

  // Active categories set up by the admin.
  useEffect(() => {
    let active = true
    fetch(`${API_BASE_URL}/api/categories`, { headers: { Accept: 'application/json' } })
      .then(response => response.ok ? response.json() : [])
      .then(data => {
        if (active && Array.isArray(data)) {
          setApiCategories(data.map((c: { name?: unknown }) => String(c.name ?? '')).filter(Boolean))
        }
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  // Admin categories plus any category a product uses, without duplicates.
  const categoryOptions = (() => {
    const seen = new Map<string, string>()
    for (const name of [...apiCategories, ...products.map(p => p.category)]) {
      const key = normalizeCategory(name ?? '')
      if (key && !seen.has(key)) seen.set(key, name.trim())
    }
    return ['ALL', ...seen.values()]
  })()

  const filtered = (filter === 'ALL' ? products : products.filter(p => normalizeCategory(p.category) === normalizeCategory(filter)))
    .filter(matchesSearch)
    .filter(p => priceRange === 'All Prices' ||
      (priceRange === 'Under ₹5,000' && p.price < 5000) ||
      (priceRange === '₹5,000 - ₹10,000' && p.price >= 5000 && p.price <= 10000) ||
      (priceRange === 'Above ₹10,000' && p.price > 10000))
    .slice()
    .sort((a, b) => {
      if (sort === 'Price: Low to High') return a.price - b.price
      if (sort === 'Price: High to Low') return b.price - a.price
      if (sort === 'Best Selling') return (b.soldCount ?? 0) - (a.soldCount ?? 0) || b.id - a.id
      return b.id - a.id // Newest: ids increase as sarees are added
    })

  useEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>('.shop-product-card')
    if (!cards.length || !window.gsap) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const media = window.gsap.matchMedia()

    if (reducedMotion) {
      window.gsap.set(cards, { autoAlpha: 1, x: 0 })
      return () => media.revert()
    }

    media.add('(min-width: 768px)', () => {
      window.gsap.fromTo(cards, { autoAlpha: 0, x: 60 }, { autoAlpha: 1, x: 0, duration: 0.55, ease: 'power3.out', stagger: 0.08 })
    })

    media.add('(max-width: 767px)', () => {
      window.gsap.fromTo(cards, { autoAlpha: 0, x: 24 }, { autoAlpha: 1, x: 0, duration: 0.45, ease: 'power3.out', stagger: 0.07 })
    })

    return () => media.revert()
  }, [filtered.length])
  return (
    <div className="min-h-screen bg-ivory">
      <div className="bg-cream py-14 px-6 text-center">
        <p className="text-warm-gray text-xs tracking-widest uppercase mb-3">
          <button onClick={() => setPage('home')} className="hover:text-gold">Home</button>
          <span className="mx-2">/</span>Sarees
        </p>
        <h1 className="font-serif text-5xl text-charcoal">Sarees</h1>
        <p className="text-warm-gray font-light mt-3 max-w-md mx-auto">Curated drapes for every woman, every occasion.</p>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-6">
          <label htmlFor="shop-search" className="sr-only">Search sarees</label>
          <input
            id="shop-search"
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search by name, fabric, colour or occasion"
            className="w-full rounded-full border border-border bg-white px-5 py-3 text-sm text-charcoal outline-none transition focus:border-champagne"
          />
        </div>
        <div className="relative flex flex-wrap items-center justify-between gap-4 mb-10">
          <div className="relative">
            <button onClick={() => setFilterOpen(open => !open)} aria-expanded={filterOpen} aria-label="Open saree filters"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-cream px-4 py-2 text-xs tracking-widest uppercase text-charcoal transition-colors hover:bg-cream">
              <FilterIcon />
              Filter
              {(filter !== 'ALL' || priceRange !== 'All Prices') && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-wine px-1 text-[9px] text-white">{Number(filter !== 'ALL') + Number(priceRange !== 'All Prices')}</span>}
            </button>

            {filterOpen && (
              <div className="absolute left-0 top-12 z-20 w-[min(300px,calc(100vw-2rem))] rounded-2xl border border-border bg-white p-5 shadow-[0_18px_45px_rgba(44,35,32,0.12)]">
                <div className="mb-5">
                  <p className="mb-2 text-[10px] tracking-[0.2em] uppercase text-warm-gray">Category</p>
                  <div className="grid grid-cols-2 gap-2">
                    {categoryOptions.map(category => (
                      <button key={category} onClick={() => setFilter(category)}
                        className={`rounded-xl px-3 py-2 text-left text-xs transition-colors ${normalizeCategory(filter) === normalizeCategory(category) ? 'bg-charcoal text-champagne' : 'bg-cream text-warm-gray hover:bg-cream'}`}>
                        {category === 'ALL' ? 'All Sarees' : category}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[10px] tracking-[0.2em] uppercase text-warm-gray">Price</p>
                  <select value={priceRange} onChange={event => setPriceRange(event.target.value)} className="w-full rounded-xl border border-border bg-cream px-3 py-2 text-xs text-charcoal outline-none">
                    <option>All Prices</option>
                    <option>Under ₹5,000</option>
                    <option>₹5,000 - ₹10,000</option>
                    <option>Above ₹10,000</option>
                  </select>
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                  <button onClick={() => { setFilter('ALL'); setPriceRange('All Prices') }} className="text-xs uppercase tracking-wider text-warm-gray hover:text-charcoal">Clear</button>
                  <button onClick={() => setFilterOpen(false)} className="rounded-full bg-charcoal px-4 py-2 text-xs uppercase tracking-wider text-champagne">Apply</button>
                </div>
              </div>
            )}
          </div>
          <select value={sort} onChange={e => setSort(e.target.value)}
            className="text-xs tracking-wider bg-cream border border-border rounded-full px-4 py-2 text-charcoal outline-none cursor-pointer">
            <option>Newest</option>
            <option>Price: Low to High</option>
            <option>Price: High to Low</option>
            <option>Best Selling</option>
          </select>
        </div>

        <div className="mb-4 flex items-center justify-end gap-3 md:hidden" />

        <div className="relative">
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-warm-gray">
              {searchWords.length > 0
                ? `No sarees match "${search.trim()}".`
                : filter === 'ALL' ? 'No sarees found.' : `No sarees found in ${filter}.`}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
              {filtered.map(p => (
                <div key={p.id} className="shop-product-card w-full">
                  <ProductCard
                    p={p}
                    onAdd={onAdd}
                    onWishlist={onWishlist}
                    wishlist={wishlist}
                    shopCard={true}
                    onClick={() => {
                      setSelectedProduct(p)
                      setPage('product')
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <Footer setPage={setPage} />
    </div>
  )
}

function ProductPage({ setPage, product, onAdd, onWishlist, wishlist }: {
  setPage: (p: Page) => void
  product: Product | null
  onAdd: (p: Product, qty?: number) => void
  onWishlist: (id: number) => void
  wishlist: number[]
}) {
  const { productsLoading } = useProductsStore()
// No fallback to another product: showing the wrong saree is worse than "not found".
const p = product

const [qty, setQty] = useState(1)
const [addedToBag, setAddedToBag] = useState(false)
const [heartPop, setHeartPop] = useState(false)
const [pincode, setPincode] = useState('')
const [delivery, setDelivery] = useState<string | null>(null)
const [openSection, setOpenSection] = useState<string | null>('Product Description')

// Build deduplicated image list
const mainImg = p ? getProductMainImage(p) : ''
const [selectedImage, setSelectedImage] = useState(mainImg)

// Reset the gallery and quantity when a different saree is opened (or it loads after a refresh).
useEffect(() => {
  setSelectedImage(mainImg)
  setQty(1)
  setDelivery(null)
}, [p?.id])

if (!p) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6 text-center">
      {productsLoading ? (
        <p className="text-sm text-warm-gray">Loading saree...</p>
      ) : (
        <>
          <p className="font-serif text-2xl text-charcoal">This saree is no longer available.</p>
          <button onClick={() => setPage('shop')} className="rounded-full bg-charcoal px-6 py-3 text-xs uppercase tracking-widest text-champagne">Browse Sarees</button>
        </>
      )}
    </div>
  )
}

const maxQty = Math.max(1, p.stock ?? 1)

const inWish = wishlist.includes(p.id)

  const rawImages: string[] = []
  if (p.image) {
    const u = productImageUrl(p.image)
    if (u) rawImages.push(u)
  }
  if (Array.isArray(p.images)) {
    for (const img of p.images) {
      const u = productImageUrl(typeof img === 'string' ? img : (img as any)?.image)
      if (u && !rawImages.includes(u)) rawImages.push(u)
    }
  }
  const allImages = rawImages.filter(u => !u.includes('yaale-logo'))

  const checkDelivery = () => {
    // Indian PIN codes are 6 digits and never start with 0. Delivery is pan-India,
    // so every valid PIN gets the standard estimate.
    if (/^[1-9]\d{5}$/.test(pincode.trim())) {
      setDelivery(`We deliver to ${pincode.trim()}. Estimated delivery by ${new Date(Date.now() + DELIVERY_TIMELINE_DAYS * 864e5).toDateString()}.`)
    } else {
      setDelivery('Please enter a valid 6-digit pincode.')
    }
  }

  const sections = [
    { title: 'Product Description', content: p.description || 'This exquisite Kanjivaram Zari Silk saree is woven by master artisans in Tamil Nadu. The rich zari borders and intricate motifs make it ideal for weddings and festive occasions.' },
    { title: 'Fabric & Care', content: 'Pure Kanjivaram Silk. Dry clean only. Store in a muslin cloth. Keep away from direct sunlight and moisture.' },
    { title: 'Shipping Information', content: 'We deliver across India in 5-7 working days. Express delivery available in select cities. Tracking updates sent via WhatsApp and Email.' },
    { title: 'Return & Exchange', content: p.returnExchange || 'All sales are final. We do not accept returns or exchanges. Please review product details carefully before purchase.' },
    { title: 'Manufactured & Marketed By', content: `Manufactured by: ${p.manufacturedBy || 'Yaale Artisans'}\nMarketed by: ${p.marketedBy || 'Yaale'}` },
    { title: 'Contact Us', content: 'Have a question about this saree, delivery, or styling? Our boutique team is happy to help.' },
  ]

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-main)' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '40px 24px 0' }}>

        {/* Breadcrumb */}
        <p className="text-warm-gray text-xs tracking-widest uppercase mb-8">
          <button onClick={() => setPage('home')} className="hover:text-gold transition-colors">Home</button>
          <span className="mx-2">/</span>
          <button onClick={() => setPage('shop')} className="hover:text-gold transition-colors">Sarees</button>
          <span className="mx-2">/</span>{p.name}
        </p>

        {/* Two-column layout */}
        <div className="pd-grid">

          {/* LEFT: Sticky Gallery */}
          <div className="pd-gallery-col">
            <div className="pd-main-wrap">
              <img
                src={selectedImage || mainImg}
                alt={p.name}
                className="pd-main-img"
                onError={(e) => { (e.target as HTMLImageElement).src = yaaleLogoTransparent }}
              />
            </div>

            {allImages.length > 1 && (
              <div className="pd-thumbs">
                {allImages.map((img, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelectedImage(img)}
                    className={`pd-thumb-btn${selectedImage === img ? ' pd-thumb-active' : ''}`}
                  >
                    <img
                      src={img}
                      alt={`${p.name} view ${i + 1}`}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none' }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT: Details */}
          <div className="pd-detail-col">

            <span className="text-xs tracking-widest uppercase" style={{ color: 'var(--gold)' }}>{p.category}</span>
            <h1 className="font-serif text-3xl sm:text-4xl mt-2 mb-1" style={{ color: 'var(--text-main)' }}>{p.name}</h1>
            <p className="text-xs tracking-wider mb-5" style={{ color: 'var(--text-muted)' }}>SKU: {p.sku}</p>

            {/* Price */}
            <div className="flex items-center gap-3 mb-6">
              <span className="text-2xl font-semibold" style={{ color: 'var(--maroon)' }}>&#8377;{p.price.toLocaleString('en-IN')}</span>
              {p.originalPrice && <>
                <span className="text-base line-through" style={{ color: 'var(--text-muted)' }}>&#8377;{p.originalPrice.toLocaleString('en-IN')}</span>
                <span className="text-xs px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: 'var(--red)' }}>
                  {Math.round((1 - p.price / p.originalPrice!) * 100)}% OFF
                </span>
              </>}
            </div>

            {/* Specs */}
            <div className="rounded-2xl p-5 mb-6 grid grid-cols-2 gap-4 text-sm" style={{ backgroundColor: 'var(--bg-soft)' }}>
              {[
                ['Fabric', p.fabric],
                ['Color', p.color],
                ['Length', p.length || 'Not specified'],
                ['Blouse', p.blouse || 'Not specified'],
                ['Occasion', p.occasion || 'Not specified'],
                ['Availability', isPurchasable(p) ? 'In Stock' : 'Out of Stock'],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-xs tracking-wider uppercase mb-0.5" style={{ color: 'var(--text-muted)' }}>{k}</p>
                  <p className="font-medium" style={{ color: 'var(--text-main)' }}>{v}</p>
                </div>
              ))}
            </div>

            {/* Desktop: Qty + Heart then CTA Buttons (>= md - completely untouched) */}
            <div className="hidden md:block">
              <div className="flex items-center gap-4 mb-5">
                <div className="flex items-center rounded-full overflow-hidden" style={{ border: '1px solid var(--line)' }}>
                  <button onClick={() => setQty(q => Math.max(1, q - 1))} className="px-4 py-2.5 text-lg transition-colors" style={{ color: 'var(--text-muted)' }}>&#8722;</button>
                  <span className="px-3 text-sm font-medium" style={{ color: 'var(--text-main)' }}>{qty}</span>
                  <button onClick={() => setQty(q => Math.min(maxQty, q + 1))} disabled={qty >= maxQty} aria-label="Increase quantity" className="px-4 py-2.5 text-lg transition-colors disabled:opacity-40" style={{ color: 'var(--text-muted)' }}>+</button>
                </div>
                {/* Heart icon — no circle on desktop */}
                <button
                  type="button"
                  className="wishlist-btn"
                  data-product-id={String(p.id)}
                  data-active={String(inWish)}
                  onClick={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    setHeartPop(true)
                    setTimeout(() => setHeartPop(false), 350)
                    onWishlist(p.id)
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '4px',
                    cursor: 'pointer',
                    transform: heartPop ? 'scale(1.35)' : 'scale(1)',
                    transition: 'transform 0.2s cubic-bezier(0.34,1.56,0.64,1)',
                  }}
                  aria-label={inWish ? 'Remove from wishlist' : 'Add to wishlist'}
                >
                  <svg width="26" height="26" viewBox="0 0 24 24"
                    fill={inWish ? '#7A0C32' : 'none'}
                    stroke="#7A0C32"
                    strokeWidth="1.8"
                  >
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                </button>
              </div>

              <div className="flex gap-3 mb-6">
                <button
                  onClick={() => { onAdd(p, qty); setAddedToBag(true); setTimeout(() => setAddedToBag(false), 2000) }}
                  disabled={!isPurchasable(p)}
                  className="flex-1 text-xs tracking-widest uppercase rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ height: '52px', backgroundColor: 'var(--bg-dark)', color: 'var(--text-on-dark)' }}
                >
                  {!isPurchasable(p) ? 'Out of Stock' : addedToBag ? 'Added to Bag \u2713' : 'Add to Bag'}
                </button>
                <button
                  onClick={() => { onAdd(p, qty); setPage('checkout') }}
                  disabled={!isPurchasable(p)}
                  className="flex-1 text-xs tracking-widest uppercase rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ height: '52px', backgroundColor: 'var(--maroon)', color: 'var(--text-on-dark)' }}
                >
                  Buy Now
                </button>
              </div>
            </div>

            {/* Mobile: Fluid layout (< md) */}
            <div className="md:hidden flex flex-col gap-3.5 mb-6">
              {/* Quantity selector */}
              <div className="flex items-center">
                <div className="flex items-center rounded-full overflow-hidden" style={{ border: '1px solid var(--line)' }}>
                  <button onClick={() => setQty(q => Math.max(1, q - 1))} className="px-4 py-2 min-h-[44px] min-w-[44px] text-lg flex items-center justify-center transition-colors" style={{ color: 'var(--text-muted)' }}>&#8722;</button>
                  <span className="px-3 text-sm font-medium" style={{ color: 'var(--text-main)' }}>{qty}</span>
                  <button onClick={() => setQty(q => Math.min(maxQty, q + 1))} disabled={qty >= maxQty} aria-label="Increase quantity" className="px-4 py-2 min-h-[44px] min-w-[44px] text-lg flex items-center justify-center transition-colors disabled:opacity-40" style={{ color: 'var(--text-muted)' }}>+</button>
                </div>
              </div>

              {/* Heart (fixed 48px round) + Add to Bag (flex-1 min-w-0) */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="wishlist-btn h-12 w-12 shrink-0 rounded-full flex items-center justify-center border border-[#EAD6D5] bg-[#FBF6F2] transition-colors"
                  data-product-id={String(p.id)}
                  data-active={String(inWish)}
                  onClick={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    setHeartPop(true)
                    setTimeout(() => setHeartPop(false), 350)
                    onWishlist(p.id)
                  }}
                  style={{
                    transform: heartPop ? 'scale(1.2)' : 'scale(1)',
                    transition: 'transform 0.2s cubic-bezier(0.34,1.56,0.64,1)',
                  }}
                  aria-label={inWish ? 'Remove from wishlist' : 'Add to wishlist'}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24"
                    fill={inWish ? '#7A0C32' : 'none'}
                    stroke="#7A0C32"
                    strokeWidth="1.8"
                  >
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                </button>
                <button
                  onClick={() => { onAdd(p, qty); setAddedToBag(true); setTimeout(() => setAddedToBag(false), 2000) }}
                  disabled={!isPurchasable(p)}
                  className="flex-1 min-w-0 text-xs tracking-widest uppercase rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 font-medium"
                  style={{ height: '52px', backgroundColor: 'var(--bg-dark)', color: 'var(--text-on-dark)' }}
                >
                  {!isPurchasable(p) ? 'Out of Stock' : addedToBag ? 'Added to Bag \u2713' : 'Add to Bag'}
                </button>
              </div>

              {/* Buy Now (full-width row under it) */}
              <button
                onClick={() => { onAdd(p, qty); setPage('checkout') }}
                disabled={!isPurchasable(p)}
                className="w-full text-xs tracking-widest uppercase rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 font-medium"
                style={{ height: '52px', backgroundColor: 'var(--maroon)', color: 'var(--text-on-dark)' }}
              >
                Buy Now
              </button>
            </div>

            {/* Check Delivery */}
            <div className="pd-info-block mb-4">
              <p className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--text-muted)' }}>Check Delivery</p>
              <div className="flex gap-2">
                <input
                  value={pincode}
                  onChange={e => setPincode(e.target.value.replace(/\D/, '').slice(0, 6))}
                  placeholder="Enter 6-digit pincode"
                  className="flex-1 rounded-full px-4 py-2 text-sm outline-none bg-transparent"
                  style={{ border: '1px solid var(--line)', color: 'var(--text-main)' }}
                />
                <button
                  onClick={checkDelivery}
                  className="px-5 py-2 rounded-full text-xs tracking-wider transition-colors"
                  style={{ backgroundColor: 'var(--bg-dark)', color: 'var(--text-on-dark)' }}
                >
                  Check
                </button>
              </div>
              {delivery && <p className="text-xs mt-2 font-medium" style={{ color: 'var(--maroon)' }}>{delivery}</p>}
            </div>

            {/* Secure Payment */}
            <div className="pd-info-block mb-6">
              <p className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--text-muted)' }}>Secure Payment</p>
              <div className="flex flex-wrap gap-2 mb-2">
                {['UPI', 'Credit / Debit Card', 'Net Banking', 'Wallets'].map(m => (
                  <span key={m} className="text-xs px-3 py-1.5 rounded-full" style={{ backgroundColor: 'var(--bg-soft)', color: 'var(--text-main)' }}>{m}</span>
                ))}
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Cash on Delivery is <strong>not available</strong>.</p>
            </div>

            {/* Accordion Sections */}
            <div className="pd-accordions">
              {sections.map(s => (
                <div key={s.title} className="yaale-accordion-item">
                  <button
                    onClick={() => setOpenSection(openSection === s.title ? null : s.title)}
                    className="yaale-accordion-btn"
                  >
                    <span>{s.title}</span>
                    <span className={`yaale-accordion-icon${openSection === s.title ? ' open' : ''}`}>+</span>
                  </button>
                  <div className={`yaale-accordion-content${openSection === s.title ? ' open' : ''}`}>
                    <p className="whitespace-pre-line">{s.content}</p>
                    {s.title === 'Contact Us' && (
                      <button
                        onClick={() => setPage('contact')}
                        className="mt-4 rounded-full px-5 py-2.5 text-xs tracking-widest uppercase transition-colors"
                        style={{ backgroundColor: 'var(--maroon)', color: 'var(--text-on-dark)' }}
                      >
                        Open Contact Page
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

          </div>{/* end detail col */}
        </div>{/* end pd-grid */}
      </div>
      <Footer setPage={setPage} />
    </div>
  )
}

function CartPage({ cart, setCart, setPage }: { cart: CartItem[], setCart: React.Dispatch<React.SetStateAction<CartItem[]>>, setPage: (p: Page) => void }) {
  const storeSettings = useContext(StoreSettingsContext)
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0)
  const shipping = calculateShipping(subtotal, storeSettings)
  const total = subtotal + shipping

  const { products } = useProductsStore()
  // Latest stock from the shop list (the bag keeps a copy from when it was added).
  const stockFor = (item: CartItem) => products.find(p => p.id === item.id)?.stock ?? item.stock ?? Infinity

  const updateQty = (id: number, qty: number) => {
    if (qty === 0) setCart(c => c.filter(i => i.id !== id))
    else setCart(c => c.map(i => i.id === id ? { ...i, qty: Math.min(qty, Math.max(1, stockFor(i))) } : i))
  }

  if (cart.length === 0) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-ivory text-center px-6">
      <BagIcon />
      <p className="font-serif text-3xl text-charcoal">Your bag is empty.</p>
      <button onClick={() => setPage('shop')}
        className="bg-charcoal text-champagne px-8 py-3.5 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal transition-colors">
        Explore Sarees
      </button>
    </div>
  )

  return (
    <div className="min-h-screen bg-ivory">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="font-serif text-4xl text-charcoal mb-10">Shopping Bag</h1>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            {cart.map(item => (
              <div key={item.id} className="bg-white rounded-3xl p-3.5 sm:p-5 flex gap-3.5 sm:gap-5 border border-border">
                <div className="w-20 sm:w-24 h-28 sm:h-32 rounded-2xl overflow-hidden flex-shrink-0 bg-[#f0e9dd]">
                  <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gold tracking-widest uppercase truncate">{item.category}</p>
                  <h3 className="font-serif text-base sm:text-lg text-charcoal mt-0.5 break-words">{item.name}</h3>
                  <p className="text-warm-gray text-sm mt-1">₹{item.price.toLocaleString('en-IN')}</p>
                  <div className="flex flex-wrap items-center gap-3 mt-3">
                    <div className="flex items-center border border-border rounded-full">
                      <button onClick={() => updateQty(item.id, item.qty - 1)} className="px-3 py-1 min-h-[36px] min-w-[36px] flex items-center justify-center text-warm-gray hover:text-charcoal">−</button>
                      <span className="px-2 text-sm font-medium">{item.qty}</span>
                      <button onClick={() => updateQty(item.id, item.qty + 1)} disabled={item.qty >= stockFor(item)} aria-label="Increase quantity" className="px-3 py-1 min-h-[36px] min-w-[36px] flex items-center justify-center text-warm-gray hover:text-charcoal disabled:opacity-40">+</button>
                    </div>
                    <button onClick={() => updateQty(item.id, 0)} className="text-xs text-warm-gray hover:text-wine tracking-wider uppercase py-1.5 transition-colors">Remove</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-cream rounded-3xl p-6 h-fit">
            <h2 className="font-serif text-2xl text-charcoal mb-6">Order Summary</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-warm-gray">Subtotal</span><span className="font-medium">₹{subtotal.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between"><span className="text-warm-gray">Shipping</span><span className="font-medium">{shipping === 0 ? 'Free' : `₹${shipping}`}</span></div>
              <div className="border-t border-border pt-3 flex justify-between text-base font-medium">
                <span>Total</span><span>₹{total.toLocaleString('en-IN')}</span>
              </div>
            </div>
            <button onClick={() => setPage('checkout')}
              className="w-full mt-6 bg-charcoal text-champagne py-3.5 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal transition-colors">
              Proceed to Checkout
            </button>
            <p className="text-center text-xs text-warm-gray mt-3">Secure Online Payment Only · No COD</p>
          </div>
        </div>
      </div>
      <Footer setPage={setPage} />
    </div>
  )
}

function WishlistPage({
  wishlist,
  isLoading,
  onWishlist,
  onAdd,
  setPage,
  setSelectedProduct
}: {
  wishlist: number[],
  isLoading: boolean,
  onWishlist: (id: number) => void,
  onAdd: (p: Product) => void,
  setPage: (p: Page) => void,
  setSelectedProduct: (p: Product) => void
}) {
  const { products } = useProductsStore()
  const items = products.filter(p => wishlist.includes(p.id))

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-ivory text-warm-gray" role="status">
      Loading wishlist...
    </div>
  )

  if (items.length === 0) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-ivory text-center px-6">
      <HeartIcon size={40} />
      <p className="font-serif text-3xl text-charcoal">Your wishlist is waiting<br />for something beautiful.</p>
      <button onClick={() => setPage('shop')}
        className="bg-charcoal text-champagne px-8 py-3.5 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal transition-colors">
        Explore Sarees
      </button>
    </div>
  )

  return (
    <div className="min-h-screen bg-ivory">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="font-serif text-3xl sm:text-4xl text-charcoal mb-8 sm:mb-10">Wishlist <span className="text-gold text-2xl font-light">({items.length})</span></h1>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
          {items.map(p => (
            <ProductCard
              key={p.id}
              p={p}
              onAdd={onAdd}
              onWishlist={onWishlist}
              wishlist={wishlist}
              onClick={() => {
                setSelectedProduct(p)
                setPage('product')
              }}
            />
          ))}
        </div>
      </div>
      <Footer setPage={setPage} />
    </div>
  )
}

function CheckoutPage({
  setPage,
  cart,
  setCart,
  setLastOrderNumber,
  onOrderPlaced,
  customerToken,
  customerEmail,
}: {
  setPage: (p: Page) => void
  cart: CartItem[]
  setCart: (c: CartItem[] | ((curr: CartItem[]) => CartItem[])) => void
  setLastOrderNumber: (orderNumber: string) => void
  onOrderPlaced: (order: PlacedOrder, notice?: string) => void
  customerToken: string | null
  customerEmail?: string
}) {
  const [step, setStep] = useState(1)
  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([])
  const [savedAddressesLoading, setSavedAddressesLoading] = useState(false)
  const [selectedAddressId, setSelectedAddressId] = useState<number | 'new' | null>(null)
  const [saveToAccount, setSaveToAccount] = useState(true)
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    landmark: '',
    city: '',
    state: '',
    pin: '',
  })
  const [stepError, setStepError] = useState('')
  const [isPlacingOrder, setIsPlacingOrder] = useState(false)
  const placingOrderRef = useRef(false)
  const storeSettings = useContext(StoreSettingsContext)
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0)
  const shipping = calculateShipping(subtotal, storeSettings)

  // Coupon: previewed here, applied again by the backend when the order is placed.
  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string, discount: number } | null>(null)
  const [couponError, setCouponError] = useState('')
  const [couponLoading, setCouponLoading] = useState(false)
  const discount = appliedCoupon?.discount ?? 0
  const orderTotal = Math.max(0, subtotal - discount) + shipping

  const applyCouponCode = async () => {
    const code = couponInput.trim()
    if (!code) return
    setCouponLoading(true)
    setCouponError('')
    try {
      const response = await fetch(`${API_BASE_URL}/api/coupons/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code, subtotal }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'This coupon code is not valid.')
      setAppliedCoupon({ code: data.code, discount: Number(data.discount_amount) || 0 })
      setCouponInput('')
    } catch (error) {
      setAppliedCoupon(null)
      setCouponError(error instanceof Error ? error.message : 'This coupon code is not valid.')
    } finally {
      setCouponLoading(false)
    }
  }

  const update =(k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!customerToken) {
      setSelectedAddressId('new')
      return
    }

    let active = true
    setSavedAddressesLoading(true)

    fetch(`${API_BASE_URL}/api/addresses`, {
      headers: {
        Authorization: `Bearer ${customerToken}`,
        Accept: 'application/json',
      },
    })
      .then(res => res.json())
      .then(data => {
        if (!active || !Array.isArray(data)) return
        setSavedAddresses(data as CustomerAddress[])
        if (data.length > 0) {
          const defaultAddress = data.find((a: CustomerAddress) => a.is_default) || data[0]
          setSelectedAddressId(defaultAddress.id)
          setForm({
            name: defaultAddress.name,
            phone: defaultAddress.phone,
            address: defaultAddress.address_line,
            landmark: defaultAddress.landmark || '',
            city: defaultAddress.city,
            state: defaultAddress.state,
            pin: defaultAddress.pin_code,
          })
        } else {
          setSelectedAddressId('new')
        }
      })
      .catch(() => {
        if (active) setSelectedAddressId('new')
      })
      .finally(() => {
        if (active) setSavedAddressesLoading(false)
      })

    return () => {
      active = false
    }
  }, [customerToken])

  const handleSelectAddress = (addr: CustomerAddress) => {
    setSelectedAddressId(addr.id)
    setForm({
      name: addr.name,
      phone: addr.phone,
      address: addr.address_line,
      landmark: addr.landmark || '',
      city: addr.city,
      state: addr.state,
      pin: addr.pin_code,
    })
    setStepError('')
  }

  const handleSelectNewAddress = () => {
    setSelectedAddressId('new')
    setForm({
      name: '',
      phone: '',
      address: '',
      landmark: '',
      city: '',
      state: '',
      pin: '',
    })
    setStepError('')
  }

  const handleContinueToReview = async () => {
    setStepError('')

    const name = form.name.trim()
    const phone = form.phone.trim()
    const address = form.address.trim()
    const city = form.city.trim()
    const state = form.state.trim()
    const pin = form.pin.trim()
    const landmark = form.landmark.trim()

    if (!name || !phone || !address || !city || !state || !pin) {
      setStepError('Please complete all required delivery details.')
      return
    }

    if (phone.length < 7) {
      setStepError('Please enter a valid phone number.')
      return
    }

    // When logged-in customer enters a new address and wants to save it to their account
    if (customerToken && (selectedAddressId === 'new' || savedAddresses.length === 0) && saveToAccount) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/addresses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${customerToken}`,
          },
          body: JSON.stringify({
            name,
            phone,
            address_line: address,
            landmark: landmark || null,
            city,
            state,
            pin_code: pin,
            is_default: savedAddresses.length === 0,
          }),
        })
        const savedData = await response.json().catch(() => ({}))
        if (response.ok && savedData?.id) {
          setSavedAddresses(prev => {
            const exists = prev.some(a => a.id === savedData.id)
            return exists ? prev : [savedData as CustomerAddress, ...prev]
          })
          setSelectedAddressId(savedData.id)
        }
      } catch (err) {
        // Backend OrderController will also attempt to auto-save upon order creation
        console.warn('Address auto-save request note:', err)
      }
    }

    setStep(2)
  }

  const placeOrder = async () => {
    const name = form.name.trim()
    const phone = form.phone.trim()
    const address = form.address.trim()
    const city = form.city.trim()
    const state = form.state.trim()
    const pin = form.pin.trim()
    const landmark = form.landmark.trim()

    if (!name || !phone || !address || !city || !state || !pin) {
      alert('Please fill in all delivery details.')
      setStep(1)
      return
    }

    if (cart.length === 0) {
      alert('Your cart is empty.')
      setPage('cart')
      return
    }

    if (!customerToken) {
      alert('Please sign in to place your order.')
      setPage('account-sign-in')
      return
    }

    if (placingOrderRef.current) return
    placingOrderRef.current = true
    setIsPlacingOrder(true)

    const fullAddress = landmark
      ? `${address}, Near ${landmark}, ${city}, ${state} - ${pin}`
      : `${address}, ${city}, ${state} - ${pin}`

    // Use the saved address by id when the delivery details still match it,
    // so the backend does not need the typed copy. Edited details are sent as typed.
    const selectedSavedAddress = savedAddresses.find(a => String(a.id) === String(selectedAddressId))
    const matchesSavedAddress = !!selectedSavedAddress &&
      selectedSavedAddress.name === name &&
      selectedSavedAddress.phone === phone &&
      selectedSavedAddress.address_line === address &&
      (selectedSavedAddress.landmark || '') === landmark &&
      selectedSavedAddress.city === city &&
      selectedSavedAddress.state === state &&
      selectedSavedAddress.pin_code === pin

    try {
      const response = await fetch(`${API_BASE_URL}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(customerToken ? { Authorization: `Bearer ${customerToken}` } : {}),
        },
        body: JSON.stringify({
          ...(matchesSavedAddress ? { address_id: selectedSavedAddress!.id } : {}),
          customer_name: name,
          customer_phone: phone,
          customer_address: fullAddress,
          address_line: address,
          landmark: landmark || null,
          city,
          state,
          pin_code: pin,
          ...(appliedCoupon ? { coupon_code: appliedCoupon.code } : {}),
          items: cart.map(item => ({
            product_id: item.id,
            product_name: item.name,
            quantity: item.qty,
            price: item.price,
          })),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        console.error('ORDER ERROR:', data)
        const errorMsg = data.errors
          ? Object.values(data.errors as Record<string, string[]>).flat().join('\n')
          : data.message || 'Failed to place order'
        alert(errorMsg)
        return
      }

      // The order exists and its stock is reserved, so the bag is emptied now,
      // whatever happens in the payment popup.
      setCart([])
      try {
        localStorage.removeItem(CART_STORAGE_KEY)
      } catch {
        // ignore storage errors
      }

      const placed: PlacedOrder = {
        id: String(data.id),
        order_number: data.order_number,
        total_amount: String(data.total_amount),
        payment_status: data.payment_status,
      }
      setLastOrderNumber(data.order_number)

      let notice: string | undefined
      if (data.payment?.provider === 'razorpay') {
        const result = await payWithRazorpay(data.payment as RazorpayPaymentStart, data.order_number, customerToken, {
          name,
          email: customerEmail,
          contact: phone,
        })
        placed.payment_status = result.status === 'paid' ? 'Paid' : 'Pending'
        notice = result.message
      }

      onOrderPlaced(placed, notice)
      setPage('order-success')
    } catch (error) {
      console.error('Error placing order:', error)
      alert('Unable to connect to the server. Please try again.')
    } finally {
      placingOrderRef.current = false
      setIsPlacingOrder(false)
    }
  }

  return (
    <div className="min-h-screen bg-ivory">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="font-serif text-4xl text-charcoal mb-2">Checkout</h1>
        {/* Steps */}
        <div className="flex items-center gap-3 mb-10">
          {['Delivery', 'Review', 'Payment'].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-all ${step > i + 1 ? 'bg-wine text-white' : step === i + 1 ? 'bg-charcoal text-champagne' : 'bg-cream text-warm-gray'}`}>
                {step > i + 1 ? '✓' : i + 1}
              </div>
              <span className={`text-xs tracking-wider uppercase ${step === i + 1 ? 'text-charcoal font-medium' : 'text-warm-gray'}`}>{s}</span>
              {i < 2 && <div className="w-8 h-px bg-cream mx-1" />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="bg-white rounded-3xl border border-border p-6 sm:p-8">
            <h2 className="font-serif text-2xl text-charcoal mb-6">Delivery Address</h2>

            {/* If logged in customer has saved addresses */}
            {customerToken && savedAddresses.length > 0 && (
              <div className="mb-8">
                <p className="text-xs uppercase tracking-wider text-warm-gray mb-3 font-medium">Select a Saved Address</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  {savedAddresses.map(addr => {
                    const isSelected = selectedAddressId === addr.id
                    return (
                      <div
                        key={addr.id}
                        onClick={() => handleSelectAddress(addr)}
                        className={`cursor-pointer rounded-2xl border p-4 transition-all text-left ${isSelected ? 'border-charcoal bg-cream/30 ring-1 ring-charcoal' : 'border-border hover:border-champagne bg-white'}`}
                      >
                        <div className="flex justify-between items-start gap-2 mb-1.5">
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="checkout-selected-address"
                              checked={isSelected}
                              onChange={() => handleSelectAddress(addr)}
                              className="accent-charcoal"
                            />
                            <p className="text-sm font-medium text-charcoal">{addr.name}</p>
                          </div>
                          {addr.is_default && (
                            <span className="bg-cream text-gold text-[10px] px-2 py-0.5 rounded-full font-medium border border-gold/20">
                              Default
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-warm-gray leading-relaxed pl-6">
                          {addr.address_line}{addr.landmark ? `, Near ${addr.landmark}` : ''}
                        </p>
                        <p className="text-xs text-warm-gray pl-6">
                          {addr.city}, {addr.state} - {addr.pin_code}
                        </p>
                        <p className="text-xs text-warm-gray pl-6 mt-1">
                          Phone: <span className="text-charcoal">{addr.phone}</span>
                        </p>
                      </div>
                    )
                  })}
                </div>

                <button
                  type="button"
                  onClick={handleSelectNewAddress}
                  className={`text-xs px-4 py-2 rounded-full border transition-all uppercase tracking-wider ${selectedAddressId === 'new' ? 'bg-charcoal text-champagne border-charcoal' : 'border-border text-warm-gray hover:border-charcoal hover:text-charcoal'}`}
                >
                  + Deliver to a different address
                </button>
              </div>
            )}

            {savedAddressesLoading && (
              <p className="text-xs text-warm-gray mb-4">Loading your saved addresses...</p>
            )}

            {/* Address Form (shown when entering new address or user has no saved addresses) */}
            {(selectedAddressId === 'new' || savedAddresses.length === 0) && (
              <div className="pt-2 border-t border-border mt-4">
                {savedAddresses.length > 0 && (
                  <p className="text-xs uppercase tracking-wider text-warm-gray mb-4 font-medium">New Address Details</p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">
                      Full Name <span className="text-wine">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={e => update('name', e.target.value)}
                      placeholder="e.g. Priya Sharma"
                      className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">
                      Mobile Number <span className="text-wine">*</span>
                    </label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={e => update('phone', e.target.value)}
                      placeholder="e.g. 9876543210"
                      className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent transition-colors"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">
                      Full Address (House / Flat / Street) <span className="text-wine">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.address}
                      onChange={e => update('address', e.target.value)}
                      placeholder="e.g. 42, Anna Nagar West"
                      className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent transition-colors"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">
                      Landmark <span className="text-warm-gray/60 font-normal">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      value={form.landmark}
                      onChange={e => update('landmark', e.target.value)}
                      placeholder="e.g. Near Shanthi Colony Signal"
                      className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">
                      City <span className="text-wine">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.city}
                      onChange={e => update('city', e.target.value)}
                      placeholder="e.g. Chennai"
                      className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">
                      State <span className="text-wine">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.state}
                      onChange={e => update('state', e.target.value)}
                      placeholder="e.g. Tamil Nadu"
                      className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent transition-colors"
                    />
                  </div>
                  <div className="sm:col-span-2 sm:max-w-xs">
                    <label className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">
                      PIN Code <span className="text-wine">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.pin}
                      onChange={e => update('pin', e.target.value)}
                      placeholder="e.g. 600040"
                      className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent transition-colors"
                    />
                  </div>
                </div>

                {customerToken && (
                  <label className="flex items-center gap-2.5 mt-4 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={saveToAccount}
                      onChange={e => setSaveToAccount(e.target.checked)}
                      className="w-4 h-4 rounded text-charcoal accent-charcoal focus:ring-champagne"
                    />
                    <span className="text-xs text-charcoal">Save this address to my account for future orders</span>
                  </label>
                )}
              </div>
            )}

            {stepError && (
              <p role="alert" className="mt-4 text-xs text-wine font-medium">
                {stepError}
              </p>
            )}

            <button
              type="button"
              onClick={handleContinueToReview}
              className="mt-8 bg-charcoal text-champagne px-10 py-3.5 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal/90 transition-colors"
            >
              Continue to Review
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="bg-white rounded-3xl border border-border p-6 sm:p-8">
            <h2 className="font-serif text-2xl text-charcoal mb-6">Order Review</h2>

            {/* Shipping Address Snapshot Card */}
            <div className="border border-border rounded-2xl p-4 bg-cream/30 text-sm mb-6">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] tracking-[0.2em] uppercase text-gold font-medium">Shipping To</span>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="text-xs text-warm-gray hover:text-charcoal underline underline-offset-4"
                >
                  Change
                </button>
              </div>
              <p className="font-medium text-charcoal">
                {form.name} <span className="text-xs text-warm-gray font-normal">({form.phone})</span>
              </p>
              <p className="text-xs text-warm-gray mt-1 leading-relaxed">
                {form.address}{form.landmark ? `, Near ${form.landmark}` : ''}, {form.city}, {form.state} - {form.pin}
              </p>
            </div>

            <div className="space-y-4 mb-6">
              {cart.map(item => (
                <div key={item.id} className="flex gap-4 items-center">
                  <div className="w-16 h-20 rounded-2xl overflow-hidden bg-[#f0e9dd] flex-shrink-0">
                    <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-sm text-charcoal">{item.name}</p>
                    <p className="text-xs text-warm-gray">Qty: {item.qty}</p>
                  </div>
                  <p className="font-medium text-sm">₹{(item.price * item.qty).toLocaleString('en-IN')}</p>
                </div>
              ))}
            </div>

            {/* Coupon */}
            <div className="mb-4">
              {appliedCoupon ? (
                <div className="flex items-center justify-between rounded-2xl bg-green-50 px-4 py-3 text-sm text-green-800">
                  <span>Coupon <strong>{appliedCoupon.code}</strong> applied</span>
                  <button type="button" onClick={() => setAppliedCoupon(null)} className="text-xs underline underline-offset-4">Remove</button>
                </div>
              ) : (
                <form
                  className="flex gap-2"
                  onSubmit={event => { event.preventDefault(); void applyCouponCode() }}
                >
                  <input
                    value={couponInput}
                    onChange={event => { setCouponInput(event.target.value.toUpperCase()); setCouponError('') }}
                    placeholder="Coupon code"
                    aria-label="Coupon code"
                    maxLength={30}
                    className="flex-1 rounded-full border border-border bg-white px-4 py-2.5 text-sm uppercase tracking-wider outline-none focus:border-champagne"
                  />
                  <button type="submit" disabled={couponLoading || !couponInput.trim()} className="rounded-full border border-charcoal px-5 py-2.5 text-xs uppercase tracking-widest text-charcoal disabled:opacity-50">
                    {couponLoading ? 'Checking...' : 'Apply'}
                  </button>
                </form>
              )}
              {couponError && <p role="alert" className="mt-2 text-xs text-wine">{couponError}</p>}
            </div>

            <div className="border-t border-border pt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-warm-gray">Subtotal</span><span>₹{subtotal.toLocaleString('en-IN')}</span></div>
              {discount > 0 && (
                <div className="flex justify-between text-green-700"><span>Discount ({appliedCoupon?.code})</span><span>−₹{discount.toLocaleString('en-IN')}</span></div>
              )}
              <div className="flex justify-between"><span className="text-warm-gray">Shipping</span><span>{shipping === 0 ? 'Free' : `₹${shipping}`}</span></div>
              <div className="flex justify-between font-medium text-base pt-2 border-t border-border"><span>Total</span><span>₹{orderTotal.toLocaleString('en-IN')}</span></div>
            </div>

            <div className="flex gap-3 mt-8">
              <button onClick={() => setStep(1)} className="border border-border text-warm-gray px-6 py-3.5 rounded-full text-xs tracking-widest uppercase hover:border-charcoal hover:text-charcoal transition-colors">Back</button>
              <button onClick={() => setStep(3)} className="bg-charcoal text-champagne px-10 py-3.5 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal/90 transition-colors">Continue to Payment</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="bg-white rounded-3xl border border-border p-6 sm:p-8">
            <h2 className="font-serif text-2xl text-charcoal mb-6">Payment</h2>
            <div className="mb-6 flex justify-between rounded-2xl border border-border px-4 py-3 text-sm">
              <span className="text-warm-gray">Amount to pay</span>
              <span className="font-medium text-charcoal">₹{orderTotal.toLocaleString('en-IN')}</span>
            </div>
            <div className="bg-cream rounded-2xl p-4 mb-6 text-center">
              <p className="text-xs text-warm-gray">Online Payment Only · No Cash on Delivery</p>
              {storeSettings.online_payment ? (
                <p className="mt-2 text-xs text-warm-gray">
                  You will pay securely through Razorpay: UPI, credit or debit card, net banking or wallets.
                </p>
              ) : (
                <p className="mt-2 text-xs text-warm-gray">
                  No payment is taken on this page. Your order is placed with payment pending,
                  and we will contact you to complete payment.
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(2)} disabled={isPlacingOrder} className="border border-border text-warm-gray px-6 py-3.5 rounded-full text-xs tracking-widest uppercase hover:border-charcoal hover:text-charcoal transition-colors disabled:opacity-50">Back</button>
              <button onClick={placeOrder} disabled={isPlacingOrder}
                className="flex-1 bg-champagne text-charcoal py-3.5 rounded-full text-xs tracking-widest uppercase font-semibold hover:bg-charcoal hover:text-champagne transition-colors disabled:opacity-60">
                {isPlacingOrder
                  ? (storeSettings.online_payment ? 'Opening Payment...' : 'Placing Order...')
                  : (storeSettings.online_payment ? `Pay ₹${orderTotal.toLocaleString('en-IN')}` : 'Place Order')}
              </button>
            </div>
          </div>
        )}
      </div>
      <Footer setPage={setPage} />
    </div>
  )
}

function OrderSuccessPage({
  setPage,
  orderNumber,
  placedOrder,
  notice,
  customerToken,
  customerEmail,
  onPaid,
}: {
  setPage: (p: Page) => void
  orderNumber: string
  placedOrder: PlacedOrder | null
  notice?: string
  customerToken: string | null
  customerEmail?: string
  onPaid: () => void
}) {
  const orderNo = placedOrder?.order_number ?? orderNumber
  const paymentStatus = placedOrder?.payment_status ?? 'Pending'
  const storeSettings = useContext(StoreSettingsContext)
  const [paying, setPaying] = useState(false)
  const [payMessage, setPayMessage] = useState(notice ?? '')

  useEffect(() => { setPayMessage(notice ?? '') }, [notice])

  // Pay again after the Razorpay popup was closed or the payment failed.
  const payNow = async () => {
    if (!placedOrder || !customerToken) return
    setPaying(true)
    setPayMessage('')
    try {
      const response = await fetch(`${API_BASE_URL}/api/my-orders/${placedOrder.id}/pay`, {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${customerToken}` },
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Online payment is unavailable right now.')
      const result = await payWithRazorpay(data.payment, orderNo, customerToken, { email: customerEmail })
      if (result.status === 'paid') onPaid()
      else setPayMessage(result.message ?? '')
    } catch (error) {
      setPayMessage(error instanceof Error ? error.message : 'Online payment is unavailable right now.')
    } finally {
      setPaying(false)
    }
  }

  const awaitingOnlinePayment = storeSettings.online_payment && paymentStatus !== 'Paid'

  return (
    <div className="min-h-screen bg-ivory flex flex-col items-center justify-center px-6 text-center">
      <div className="w-20 h-20 rounded-full bg-cream flex items-center justify-center mb-6 border border-champagne">
        <span className="text-wine text-3xl">{awaitingOnlinePayment ? '!' : '✓'}</span>
      </div>
      <p className="text-gold text-xs tracking-widest uppercase mb-3">{awaitingOnlinePayment ? 'Payment Pending' : 'Order Confirmed'}</p>
      <h1 className="font-serif text-4xl sm:text-5xl text-charcoal mb-4">
        {awaitingOnlinePayment ? 'Almost there.' : 'Thank you for your order.'}
      </h1>
      <p className="text-warm-gray font-light mb-6 max-w-sm">
        {awaitingOnlinePayment
          ? 'Your order is reserved for 30 minutes. Complete the payment to confirm it.'
          : "Your saree is being prepared with care. We'll email you as your order progresses."}
      </p>
      {payMessage && <p role="status" className="mb-6 max-w-sm text-sm text-wine">{payMessage}</p>}
      {awaitingOnlinePayment && placedOrder && (
        <button onClick={() => { void payNow() }} disabled={paying}
          className="mb-8 rounded-full bg-wine px-8 py-3 text-xs uppercase tracking-widest text-white disabled:opacity-60">
          {paying ? 'Opening Payment...' : `Pay ₹${Number(placedOrder.total_amount).toLocaleString('en-IN')} Now`}
        </button>
      )}
      <div className="bg-white rounded-3xl border border-border p-6 mb-10 w-full max-w-sm text-sm">
        <div className="space-y-3">
          {[['Order Number', orderNo], ['Order Date', new Date().toDateString()], ['Payment Status', paymentStatus], ['Est. Delivery', new Date(Date.now() + DELIVERY_TIMELINE_DAYS * 864e5).toDateString()]].map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="text-warm-gray">{k}</span>
              <span className="font-medium text-charcoal">{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 justify-center">
        <button onClick={() => setPage('order-tracking')} className="border border-charcoal text-charcoal px-6 py-3 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal hover:text-champagne transition-all">Track Order</button>
        <button onClick={() => setPage('home')} className="bg-charcoal text-champagne px-6 py-3 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal transition-colors">Continue Shopping</button>
      </div>
    </div>
  )
}

const DELIVERY_TIMELINE_DAYS = 6

function formatExpectedDeliveryDate(order: CustomerOrder | { expected_delivery_date?: string | null; created_at?: string; status?: string }): string {
  if (order.status === 'Cancelled') {
    return 'Not yet available.'
  }

  const rawDate = order.expected_delivery_date
  if (rawDate) {
    const parsed = new Date(rawDate.includes('T') ? rawDate : `${rawDate}T00:00:00`)
    if (!isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    }
  }

  if (order.created_at) {
    const created = new Date(order.created_at)
    if (!isNaN(created.getTime())) {
      const estimated = new Date(created.getTime() + DELIVERY_TIMELINE_DAYS * 24 * 60 * 60 * 1000)
      return estimated.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    }
  }

  return 'Not yet available.'
}

function OrderTrackingPage({
  setPage,
  orderNumber,
  customerSession,
}: {
  setPage: (p: Page) => void
  orderNumber: string
  customerSession: CustomerAuthSession | null
}) {
  const [order, setOrder] = useState<CustomerOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Tracking without an account: order number + the phone used on the order.
  const [guestOrderNumber, setGuestOrderNumber] = useState(orderNumber)
  const [guestPhone, setGuestPhone] = useState('')
  const [guestLoading, setGuestLoading] = useState(false)
  const [guestError, setGuestError] = useState('')

  const lookUpGuestOrder = async () => {
    setGuestLoading(true)
    setGuestError('')
    try {
      const params = new URLSearchParams({ order_number: guestOrderNumber.trim(), phone: guestPhone })
      const response = await fetch(`${API_BASE_URL}/api/track-order?${params}`, { headers: { Accept: 'application/json' } })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Unable to find that order.')
      setOrder(data as CustomerOrder)
    } catch (lookupError) {
      setGuestError(lookupError instanceof Error ? lookupError.message : 'Unable to find that order.')
    } finally {
      setGuestLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    setOrder(null)
    setError('')

    if (!customerSession || !orderNumber) {
      setLoading(false)
      return () => { active = false }
    }

    setLoading(true)
    const fetchOrder = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/my-orders/${encodeURIComponent(orderNumber)}`,
          { headers: { Authorization: `Bearer ${customerSession.token}`, Accept: 'application/json' } },
        )
        const data = await response.json().catch(() => ({}))

        if (!response.ok) {
          throw new Error(response.status === 404
            ? 'This order could not be found in your account.'
            : data.message || 'Unable to load order tracking.')
        }

        if (active) setOrder(data as CustomerOrder)
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : 'Unable to load order tracking.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void fetchOrder()
    return () => { active = false }
  }, [customerSession?.token, orderNumber])

  const history = [...(order?.status_history ?? [])]
    .sort((first, second) => new Date(first.created_at).getTime() - new Date(second.created_at).getTime())

  const formatOrderDate = (value?: string) => value
    ? new Date(value).toLocaleString('en-IN')
    : '—'

  return (
    <div className="min-h-screen bg-ivory">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
        <h1 className="font-serif text-4xl text-charcoal mb-2">Track Order</h1>
        <p className="text-warm-gray font-light mb-10">{orderNumber ? `Order #${orderNumber}` : 'Your order tracking details'}</p>

        {loading ? (
          <p role="status" className="bg-white rounded-3xl border border-border p-8 text-sm text-warm-gray">Loading order details...</p>
        ) : !customerSession && !order ? (
          <div className="bg-white rounded-3xl border border-border p-8">
            <form className="space-y-4" onSubmit={event => { event.preventDefault(); void lookUpGuestOrder() }}>
              <p className="text-sm text-charcoal">Enter your order number and the phone number used on the order.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="track-order-number" className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">Order Number</label>
                  <input id="track-order-number" value={guestOrderNumber} onChange={event => setGuestOrderNumber(event.target.value)} placeholder="ORD-..." required className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent" />
                </div>
                <div>
                  <label htmlFor="track-order-phone" className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">Phone Number</label>
                  <input id="track-order-phone" type="tel" value={guestPhone} onChange={event => setGuestPhone(event.target.value)} autoComplete="tel" required className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent" />
                </div>
              </div>
              {guestError && <p role="alert" className="text-sm text-red-700">{guestError}</p>}
              <div className="flex flex-wrap items-center gap-4">
                <button type="submit" disabled={guestLoading} className="bg-charcoal text-champagne px-8 py-3 rounded-full text-xs tracking-widest uppercase disabled:opacity-60">
                  {guestLoading ? 'Looking Up...' : 'Track Order'}
                </button>
                <button type="button" onClick={() => setPage('account-sign-in')} className="text-xs text-warm-gray underline underline-offset-4 hover:text-charcoal">Or sign in to see all your orders</button>
              </div>
            </form>
          </div>
        ) : error ? (
          <div role="alert" className="bg-white rounded-3xl border border-border p-8">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={() => setPage('account')} className="mt-5 border border-charcoal text-charcoal px-6 py-3 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal hover:text-champagne transition-all">My Orders</button>
          </div>
        ) : !order ? (
          <div className="bg-white rounded-3xl border border-border p-8">
            <p className="text-sm text-warm-gray">Select an order from My Orders to view its tracking details.</p>
            <button onClick={() => setPage('account')} className="mt-5 border border-charcoal text-charcoal px-6 py-3 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal hover:text-champagne transition-all">My Orders</button>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-3xl border border-border p-8 mb-6">
              <h2 className="font-serif text-2xl text-charcoal mb-6">Order Details</h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5 text-sm">
                <div>
                  <dt className="text-xs tracking-wider uppercase text-warm-gray">Order Number</dt>
                  <dd className="mt-1 font-medium text-charcoal">{order.order_number}</dd>
                </div>
                <div>
                  <dt className="text-xs tracking-wider uppercase text-warm-gray">Order Date</dt>
                  <dd className="mt-1 text-charcoal">{formatOrderDate(order.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs tracking-wider uppercase text-warm-gray">Payment Status</dt>
                  <dd className="mt-1 text-charcoal">{order.payment_status}</dd>
                </div>
                <div>
                  <dt className="text-xs tracking-wider uppercase text-warm-gray">Order Total</dt>
                  <dd className="mt-1 font-medium text-charcoal">₹{Number(order.total_amount).toLocaleString('en-IN')}</dd>
                </div>
                <div>
                  <dt className="text-xs tracking-wider uppercase text-warm-gray">Expected Delivery Date</dt>
                  <dd className="mt-1 font-medium text-charcoal">{formatExpectedDeliveryDate(order)}</dd>
                </div>
                {/* Guest tracking does not return the address. */}
                {order.customer_address && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs tracking-wider uppercase text-warm-gray">Shipping Address</dt>
                    <dd className="mt-1 leading-relaxed text-charcoal">{order.customer_address}</dd>
                  </div>
                )}
              </dl>

              <div className="border-t border-border mt-6 pt-6">
                <h3 className="font-serif text-xl text-charcoal mb-4">Purchased Sarees</h3>
                <div className="space-y-4">
                  {order.items.map(item => (
                    <div key={item.id} className="flex items-center gap-4">
                      {item.product?.image && (
                        <img src={productImageUrl(item.product.image)} alt={item.product_name} className="h-16 w-14 rounded-xl object-cover bg-[#f0e9dd]" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-charcoal">{item.product_name}</p>
                        <p className="mt-1 text-xs text-warm-gray">Quantity: {item.quantity}</p>
                      </div>
                      <p className="shrink-0 text-sm text-charcoal">₹{(Number(item.price) * item.quantity).toLocaleString('en-IN')}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-3xl border border-border p-8 mb-6">
              <h2 className="font-serif text-2xl text-charcoal mb-6">Order Status</h2>
              {history.length === 0 ? (
                <p className="text-sm text-warm-gray">No status updates are available yet.</p>
              ) : (
                <div className="relative">
                  {history.map((event, index) => (
                    <div key={event.id} className="flex gap-4 pb-6 last:pb-0 relative">
                      <div className="flex flex-col items-center">
                        <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 z-10 ${index === history.length - 1 ? 'bg-wine border-wine' : 'bg-white border-champagne'}`} />
                        {index < history.length - 1 && <div className="w-0.5 flex-1 mt-1 bg-cream" style={{ minHeight: '28px' }} />}
                      </div>
                      <div className="pb-2">
                        <p className="text-sm font-medium text-charcoal">{event.status}</p>
                        <p className="text-xs text-gold mt-0.5">{formatOrderDate(event.created_at)}</p>
                        {event.note && <p className="text-xs text-warm-gray mt-1">{event.note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <button onClick={() => setPage('home')}
          className="bg-charcoal text-champagne px-8 py-3.5 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal transition-colors">
          Continue Shopping
        </button>
      </div>
      <Footer setPage={setPage} />
    </div>
  )
}

function AccountPage({ setPage, customerSession, onCustomerLoginSuccess, onCustomerProfileUpdated, onCustomerLogout, onTrackOrder, isSignIn }: {
  setPage: (p: Page) => void
  customerSession: CustomerAuthSession | null
  onCustomerLoginSuccess: (session: CustomerAuthSession) => void
  onCustomerProfileUpdated: (user: CustomerAuthSession['user']) => void
  onCustomerLogout: () => void
  onTrackOrder: (orderNumber: string) => void
  isSignIn: boolean
}) {
  const [tab, setTab] = useState('Profile')
  const [myOrders, setMyOrders] = useState<CustomerOrder[]>([])
  const [myOrdersLoading, setMyOrdersLoading] = useState(true)
  const [myOrdersError, setMyOrdersError] = useState('')
  const [registration, setRegistration] = useState({ name: '', email: '', password: '', password_confirmation: '' })
  const [registrationMessage, setRegistrationMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [registrationLoading, setRegistrationLoading] = useState(false)
  const [login, setLogin] = useState({ email: '', password: '' })
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [profileDraft, setProfileDraft] = useState({ name: customerSession?.user.name ?? '', email: customerSession?.user.email ?? '' })
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const storeSettings = useContext(StoreSettingsContext)

  // Change password (signed in)
  const [passwordDraft, setPasswordDraft] = useState({ current: '', next: '', confirm: '' })
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handlePasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!customerSession) return
    if (passwordDraft.next !== passwordDraft.confirm) {
      setPasswordMessage({ type: 'error', text: 'The new passwords do not match.' })
      return
    }
    setPasswordSaving(true)
    setPasswordMessage(null)
    try {
      const response = await fetch(`${API_BASE_URL}/api/customer/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${customerSession.token}` },
        body: JSON.stringify({ current_password: passwordDraft.current, password: passwordDraft.next }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Unable to change your password.')
      setPasswordDraft({ current: '', next: '', confirm: '' })
      setPasswordMessage({ type: 'success', text: data.message || 'Your password has been changed.' })
    } catch (error) {
      setPasswordMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unable to change your password.' })
    } finally {
      setPasswordSaving(false)
    }
  }

  // Forgot password (signed out)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSending, setForgotSending] = useState(false)
  const [forgotMessage, setForgotMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleForgotPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setForgotSending(true)
    setForgotMessage(null)
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Unable to send the reset link.')
      setForgotMessage({ type: 'success', text: data.message || 'If an account exists for that email, a reset link has been sent.' })
    } catch (error) {
      setForgotMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unable to send the reset link.' })
    } finally {
      setForgotSending(false)
    }
  }

  // Cancel an order / pay for an unpaid one
  const [orderActionId, setOrderActionId] = useState<number | null>(null)
  const [orderActionMessage, setOrderActionMessage] = useState<Record<number, string>>({})

  const replaceOrder = (updated: CustomerOrder) =>
    setMyOrders(current => current.map(order => String(order.id) === String(updated.id) ? { ...order, ...updated } : order))

  const cancelMyOrder = async (order: CustomerOrder) => {
    if (!customerSession) return
    const refundNote = order.payment_status === 'Paid' ? ' Your payment will be refunded to the original method.' : ''
    if (!window.confirm(`Cancel order ${order.order_number}?${refundNote}`)) return
    setOrderActionId(order.id)
    setOrderActionMessage(current => ({ ...current, [order.id]: '' }))
    try {
      const response = await fetch(`${API_BASE_URL}/api/my-orders/${order.id}/cancel`, {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${customerSession.token}` },
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Unable to cancel this order.')
      replaceOrder(data as CustomerOrder)
    } catch (error) {
      setOrderActionMessage(current => ({ ...current, [order.id]: error instanceof Error ? error.message : 'Unable to cancel this order.' }))
    } finally {
      setOrderActionId(null)
    }
  }

  const payMyOrder = async (order: CustomerOrder) => {
    if (!customerSession) return
    setOrderActionId(order.id)
    setOrderActionMessage(current => ({ ...current, [order.id]: '' }))
    try {
      const response = await fetch(`${API_BASE_URL}/api/my-orders/${order.id}/pay`, {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${customerSession.token}` },
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Online payment is unavailable right now.')
      const result = await payWithRazorpay(data.payment, order.order_number, customerSession.token, {
        name: order.customer_name,
        email: customerSession.user.email,
        contact: order.customer_phone,
      })
      if (result.status === 'paid') replaceOrder({ ...order, payment_status: 'Paid' })
      else setOrderActionMessage(current => ({ ...current, [order.id]: result.message ?? '' }))
    } catch (error) {
      setOrderActionMessage(current => ({ ...current, [order.id]: error instanceof Error ? error.message : 'Online payment is unavailable right now.' }))
    } finally {
      setOrderActionId(null)
    }
  }

  const [addresses, setAddresses] = useState<CustomerAddress[]>([])
  const [addressesLoading, setAddressesLoading] = useState(false)
  const [addressesError, setAddressesError] = useState('')
  const [addressFeedback, setAddressFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false)
  const [editingAddress, setEditingAddress] = useState<CustomerAddress | null>(null)
  const [addressForm, setAddressForm] = useState({
    name: '',
    phone: '',
    address_line: '',
    landmark: '',
    city: '',
    state: '',
    pin_code: '',
    is_default: false,
  })
  const [addressFormError, setAddressFormError] = useState('')
  const [isSavingAddress, setIsSavingAddress] = useState(false)
  const [addressActionId, setAddressActionId] = useState<number | null>(null)
  const savingAddressLockRef = useRef(false)

  const handleCustomerLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginLoading(true)
    setLoginError('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(login),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const errors = data.errors
          ? Object.values(data.errors as Record<string, string[]>).flat().join(' ')
          : ''
        throw new Error(errors || data.message || 'Unable to sign in. Please check your details.')
      }

      onCustomerLoginSuccess(data as CustomerAuthSession)
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Unable to sign in. Please try again.')
    } finally {
      setLoginLoading(false)
    }
  }

  const handleRegistration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setRegistrationLoading(true)
    setRegistrationMessage(null)

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(registration),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const errors = data.errors
          ? Object.values(data.errors as Record<string, string[]>).flat().join(' ')
          : ''
        throw new Error(errors || data.message || 'Unable to create your account. Please try again.')
      }

      setRegistration({ name: '', email: '', password: '', password_confirmation: '' })
      onCustomerLoginSuccess(data as CustomerAuthSession)
    } catch (error) {
      setRegistrationMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to create your account. Please try again.',
      })
    } finally {
      setRegistrationLoading(false)
    }
  }

  const handleProfileUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!customerSession) return

    setProfileSaving(true)
    setProfileMessage(null)

    try {
      const response = await fetch(`${API_BASE_URL}/api/customer/user`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${customerSession.token}`,
        },
        body: JSON.stringify(profileDraft),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const errors = data.errors
          ? Object.values(data.errors as Record<string, string[]>).flat().join(' ')
          : ''
        throw new Error(errors || data.message || 'Unable to update your profile.')
      }

      const updatedUser = data as CustomerAuthSession['user']
      setProfileDraft({ name: updatedUser.name, email: updatedUser.email })
      onCustomerProfileUpdated(updatedUser)
      setProfileMessage({ type: 'success', text: 'Your profile has been updated.' })
    } catch (error) {
      setProfileMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to update your profile.',
      })
    } finally {
      setProfileSaving(false)
    }
  }

  useEffect(() => {
    if (!customerSession) {
      setProfileDraft({ name: '', email: '' })
      return
    }

    let active = true
    setProfileLoading(true)
    setProfileMessage(null)

    const loadProfile = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/customer/user`, {
          headers: { Authorization: `Bearer ${customerSession.token}`, Accept: 'application/json' },
        })
        const data = await response.json().catch(() => ({}))

        if (!response.ok) throw new Error(data.message || 'Unable to load your profile.')
        if (active) setProfileDraft({ name: data.name, email: data.email })
      } catch (error) {
        if (active) {
          setProfileMessage({
            type: 'error',
            text: error instanceof Error ? error.message : 'Unable to load your profile.',
          })
        }
      } finally {
        if (active) setProfileLoading(false)
      }
    }

    void loadProfile()
    return () => { active = false }
  }, [customerSession?.token])

  useEffect(() => {
    let active = true
    setMyOrdersError('')

    if (!customerSession) {
      setMyOrders([])
      setMyOrdersLoading(false)
      return () => { active = false }
    }

    setMyOrdersLoading(true)
    const fetchMyOrders = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/my-orders`, {
          headers: { Authorization: `Bearer ${customerSession.token}`, Accept: 'application/json' },
        })

        if (response.status === 401 || response.status === 403) {
          if (active) {
            setMyOrdersError('Your session has expired. Please sign in again.')
            setMyOrders([])
          }
          onCustomerLogout()
          return
        }

        const data = await response.json().catch(() => ({}))

        if (!response.ok) throw new Error(data.message || 'Unable to load your orders.')
        if (!Array.isArray(data)) throw new Error('The order response was invalid.')
        if (active) setMyOrders(data as CustomerOrder[])
      } catch (fetchError) {
        if (active) {
          setMyOrdersError(fetchError instanceof Error ? fetchError.message : 'Unable to load your orders.')
          setMyOrders([])
        }
      }

      if (active) setMyOrdersLoading(false)
    }

    void fetchMyOrders()
    return () => { active = false }
  }, [customerSession?.token])

  useEffect(() => {
    let active = true
    setAddressesError('')

    if (!customerSession) {
      setAddresses([])
      setAddressesLoading(false)
      return () => { active = false }
    }

    setAddressesLoading(true)
    const fetchAddresses = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/addresses`, {
          headers: {
            Authorization: `Bearer ${customerSession.token}`,
            Accept: 'application/json',
          },
        })
        const data = await response.json().catch(() => ({}))

        if (!response.ok) throw new Error(data.message || 'Unable to load your saved addresses.')
        if (!Array.isArray(data)) throw new Error('Invalid address response.')
        if (active) setAddresses(data as CustomerAddress[])
      } catch (err) {
        if (active) {
          setAddressesError(err instanceof Error ? err.message : 'Unable to load saved addresses.')
          setAddresses([])
        }
      } finally {
        if (active) setAddressesLoading(false)
      }
    }

    void fetchAddresses()
    return () => { active = false }
  }, [customerSession?.token])

  const handleOpenAddAddress = () => {
    setEditingAddress(null)
    setAddressForm({
      name: customerSession?.user?.name ?? '',
      phone: '',
      address_line: '',
      landmark: '',
      city: '',
      state: '',
      pin_code: '',
      is_default: addresses.length === 0,
    })
    setAddressFormError('')
    setIsAddressModalOpen(true)
  }

  const handleOpenEditAddress = (addr: CustomerAddress) => {
    setEditingAddress(addr)
    setAddressForm({
      name: addr.name,
      phone: addr.phone,
      address_line: addr.address_line,
      landmark: addr.landmark ?? '',
      city: addr.city,
      state: addr.state,
      pin_code: addr.pin_code,
      is_default: addr.is_default,
    })
    setAddressFormError('')
    setIsAddressModalOpen(true)
  }

  const handleSaveAddress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!customerSession) return

    setAddressFormError('')

    const name = addressForm.name.trim()
    const phone = addressForm.phone.trim()
    const addressLine = addressForm.address_line.trim()
    const city = addressForm.city.trim()
    const state = addressForm.state.trim()
    const pinCode = addressForm.pin_code.trim()
    const landmark = addressForm.landmark.trim()

    if (!name || !phone || !addressLine || !city || !state || !pinCode) {
      setAddressFormError('Please fill in all required fields.')
      return
    }

    if (phone.length < 7) {
      setAddressFormError('Please enter a valid phone number.')
      return
    }

    // Prevent duplicate in-flight submissions
    if (savingAddressLockRef.current) return
    savingAddressLockRef.current = true
    setIsSavingAddress(true)

    try {
      const isEditing = Boolean(editingAddress)
      const url = isEditing
        ? `${API_BASE_URL}/api/addresses/${editingAddress!.id}`
        : `${API_BASE_URL}/api/addresses`

      const response = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${customerSession.token}`,
        },
        body: JSON.stringify({
          name,
          phone,
          address_line: addressLine,
          city,
          state,
          pin_code: pinCode,
          landmark: landmark || null,
          is_default: addressForm.is_default,
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const errorText = data.errors
          ? Object.values(data.errors as Record<string, string[]>).flat().join(' ')
          : data.message || 'Failed to save address.'
        throw new Error(errorText)
      }

      // Refresh address list to sync default states
      const listResponse = await fetch(`${API_BASE_URL}/api/addresses`, {
        headers: {
          Authorization: `Bearer ${customerSession.token}`,
          Accept: 'application/json',
        },
      })
      const listData = await listResponse.json().catch(() => [])
      if (Array.isArray(listData)) {
        setAddresses(listData as CustomerAddress[])
      }

      setIsAddressModalOpen(false)
      setAddressFeedback({
        type: 'success',
        message: isEditing ? 'Address updated successfully.' : 'Address saved successfully.',
      })
      setTimeout(() => setAddressFeedback(null), 4000)
    } catch (err) {
      setAddressFormError(err instanceof Error ? err.message : 'Unable to save address. Please try again.')
    } finally {
      savingAddressLockRef.current = false
      setIsSavingAddress(false)
    }
  }

  const handleSetDefaultAddress = async (id: number) => {
    if (!customerSession || addressActionId) return
    setAddressActionId(id)

    try {
      const response = await fetch(`${API_BASE_URL}/api/addresses/${id}/default`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${customerSession.token}`,
          Accept: 'application/json',
        },
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Failed to set default address.')

      setAddresses(prev =>
        prev.map(a => ({
          ...a,
          is_default: a.id === id,
        }))
      )
      setAddressFeedback({ type: 'success', message: 'Default address updated.' })
      setTimeout(() => setAddressFeedback(null), 3000)
    } catch (err) {
      setAddressFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to set default address.',
      })
    } finally {
      setAddressActionId(null)
    }
  }

  const handleDeleteAddress = async (id: number) => {
    if (!customerSession || addressActionId) return

    if (!window.confirm('Are you sure you want to delete this saved address?')) {
      return
    }

    setAddressActionId(id)

    try {
      const response = await fetch(`${API_BASE_URL}/api/addresses/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${customerSession.token}`,
          Accept: 'application/json',
        },
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Failed to delete address.')

      // Refresh list to properly reflect any new default promotion
      const listResponse = await fetch(`${API_BASE_URL}/api/addresses`, {
        headers: {
          Authorization: `Bearer ${customerSession.token}`,
          Accept: 'application/json',
        },
      })
      const listData = await listResponse.json().catch(() => [])
      if (Array.isArray(listData)) {
        setAddresses(listData as CustomerAddress[])
      } else {
        setAddresses(prev => prev.filter(a => a.id !== id))
      }

      setAddressFeedback({ type: 'success', message: 'Address removed successfully.' })
      setTimeout(() => setAddressFeedback(null), 3000)
    } catch (err) {
      setAddressFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to delete address.',
      })
    } finally {
      setAddressActionId(null)
    }
  }

  const tabs = ['Profile', 'My Orders', 'Track Orders', 'Wishlist', 'Addresses']
  return (
    <div className="min-h-screen bg-ivory">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="font-serif text-4xl text-charcoal mb-10">{customerSession ? 'My Account' : isSignIn ? 'Sign In' : 'Create an Account'}</h1>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <nav className="space-y-1">
            {customerSession && tabs.map(t => (
              <button key={t} onClick={() => t === 'Wishlist' ? setPage('wishlist') : setTab(t)}
                className={`w-full text-left px-4 py-3 rounded-2xl text-sm transition-all ${tab === t ? 'bg-charcoal text-champagne' : 'text-warm-gray hover:bg-cream hover:text-charcoal'}`}>
                {t}
              </button>
            ))}
            {customerSession ? (
              <button onClick={onCustomerLogout} className="w-full text-left px-4 py-3 rounded-2xl text-sm text-wine hover:bg-cream transition-all">Logout</button>
            ) : (
              <>
                <button onClick={() => setPage('account-sign-in')} className="w-full text-left px-4 py-3 rounded-2xl text-sm text-warm-gray hover:bg-cream hover:text-charcoal transition-all">Sign In</button>
                <button onClick={() => setPage('account')} className="w-full text-left px-4 py-3 rounded-2xl text-sm text-warm-gray hover:bg-cream hover:text-charcoal transition-all">Create an Account</button>
              </>
            )}
          </nav>
          <div className="md:col-span-3 bg-white rounded-3xl border border-border p-8">
            {tab === 'Profile' && (
              <div>
                {customerSession ? (
                  <>
                    <h2 className="font-serif text-2xl text-charcoal mb-6">Profile</h2>
                    <form className="space-y-4" onSubmit={handleProfileUpdate}>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="customer-profile-name" className="text-xs tracking-wider uppercase text-warm-gray block mb-1">Full Name</label>
                          <input id="customer-profile-name" value={profileDraft.name} onChange={event => setProfileDraft(current => ({ ...current, name: event.target.value }))} autoComplete="name" maxLength={255} required disabled={profileLoading || profileSaving} className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent disabled:opacity-60" />
                        </div>
                        <div>
                          <label htmlFor="customer-profile-email" className="text-xs tracking-wider uppercase text-warm-gray block mb-1">Email</label>
                          <input id="customer-profile-email" type="email" value={profileDraft.email} onChange={event => setProfileDraft(current => ({ ...current, email: event.target.value }))} autoComplete="email" maxLength={255} required disabled={profileLoading || profileSaving} className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent disabled:opacity-60" />
                        </div>
                      </div>
                      {profileMessage && <p role={profileMessage.type === 'error' ? 'alert' : 'status'} className={`text-sm ${profileMessage.type === 'error' ? 'text-red-700' : 'text-green-700'}`}>{profileMessage.text}</p>}
                      <button type="submit" disabled={profileLoading || profileSaving} className="mt-2 bg-charcoal text-champagne px-8 py-3 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal transition-colors disabled:opacity-60">
                        {profileLoading ? 'Loading Profile...' : profileSaving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </form>

                    <h3 className="font-serif text-xl text-charcoal mt-10 mb-4">Change Password</h3>
                    <form className="space-y-4" onSubmit={handlePasswordChange}>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {([
                          ['current', 'Current Password', 'current-password'],
                          ['next', 'New Password', 'new-password'],
                          ['confirm', 'Confirm New Password', 'new-password'],
                        ] as const).map(([key, label, autoComplete]) => (
                          <div key={key}>
                            <label htmlFor={`password-${key}`} className="text-xs tracking-wider uppercase text-warm-gray block mb-1">{label}</label>
                            <input
                              id={`password-${key}`}
                              type="password"
                              value={passwordDraft[key]}
                              onChange={event => setPasswordDraft(current => ({ ...current, [key]: event.target.value }))}
                              autoComplete={autoComplete}
                              minLength={key === 'current' ? undefined : 8}
                              maxLength={72}
                              required
                              disabled={passwordSaving}
                              className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent disabled:opacity-60"
                            />
                          </div>
                        ))}
                      </div>
                      {passwordMessage && <p role={passwordMessage.type === 'error' ? 'alert' : 'status'} className={`text-sm ${passwordMessage.type === 'error' ? 'text-red-700' : 'text-green-700'}`}>{passwordMessage.text}</p>}
                      <button type="submit" disabled={passwordSaving} className="bg-charcoal text-champagne px-8 py-3 rounded-full text-xs tracking-widest uppercase disabled:opacity-60">
                        {passwordSaving ? 'Saving...' : 'Change Password'}
                      </button>
                    </form>
                  </>
                ) : isSignIn ? (
                  <>
                    <h2 className="font-serif text-2xl text-charcoal mb-6">Sign In</h2>
                    <form className="space-y-4" onSubmit={handleCustomerLogin}>
                      <div>
                        <label htmlFor="customer-login-email" className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">Email Address</label>
                        <input id="customer-login-email" type="email" value={login.email} onChange={event => setLogin(current => ({ ...current, email: event.target.value }))} autoComplete="email" required className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent" />
                      </div>
                      <div>
                        <label htmlFor="customer-login-password" className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">Password</label>
                        <input id="customer-login-password" type="password" value={login.password} onChange={event => setLogin(current => ({ ...current, password: event.target.value }))} autoComplete="current-password" required className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent" />
                      </div>
                      {loginError && <p role="alert" className="text-sm text-red-700">{loginError}</p>}
                      <div className="flex flex-wrap items-center gap-4">
                        <button type="submit" disabled={loginLoading} className="mt-2 bg-charcoal text-champagne px-8 py-3 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal transition-colors disabled:opacity-60">
                          {loginLoading ? 'Signing In...' : 'Sign In'}
                        </button>
                        <button type="button" onClick={() => { setForgotOpen(open => !open); setForgotEmail(login.email); setForgotMessage(null) }} className="mt-2 text-xs text-warm-gray underline underline-offset-4 hover:text-charcoal">
                          Forgot password?
                        </button>
                      </div>
                    </form>

                    {forgotOpen && (
                      <form className="mt-8 space-y-4 rounded-2xl border border-border p-5" onSubmit={handleForgotPassword}>
                        <p className="text-sm text-charcoal">Enter your email and we'll send you a link to set a new password.</p>
                        <div>
                          <label htmlFor="forgot-email" className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">Email Address</label>
                          <input id="forgot-email" type="email" value={forgotEmail} onChange={event => setForgotEmail(event.target.value)} autoComplete="email" required className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent" />
                        </div>
                        {forgotMessage && <p role={forgotMessage.type === 'error' ? 'alert' : 'status'} className={`text-sm ${forgotMessage.type === 'error' ? 'text-red-700' : 'text-green-700'}`}>{forgotMessage.text}</p>}
                        <button type="submit" disabled={forgotSending} className="border border-charcoal text-charcoal px-6 py-2.5 rounded-full text-xs tracking-widest uppercase disabled:opacity-60">
                          {forgotSending ? 'Sending...' : 'Send Reset Link'}
                        </button>
                      </form>
                    )}
                  </>
                ) : (
                  <>
                    <h2 className="font-serif text-2xl text-charcoal mb-6">Create an Account</h2>
                    <form className="space-y-4" onSubmit={handleRegistration}>
                  {[
                    { label: 'Full Name', name: 'name', type: 'text', autoComplete: 'name' },
                    { label: 'Email Address', name: 'email', type: 'email', autoComplete: 'email' },
                    { label: 'Password', name: 'password', type: 'password', autoComplete: 'new-password' },
                    { label: 'Confirm Password', name: 'password_confirmation', type: 'password', autoComplete: 'new-password' },
                  ].map(field => (
                    <div key={field.name}>
                      <label htmlFor={`registration-${field.name}`} className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">{field.label}</label>
                      <input
                        id={`registration-${field.name}`}
                        name={field.name}
                        type={field.type}
                        value={registration[field.name as keyof typeof registration]}
                        onChange={event => setRegistration(current => ({ ...current, [field.name]: event.target.value }))}
                        required
                        autoComplete={field.autoComplete}
                        minLength={field.name.startsWith('password') ? 8 : undefined}
                        className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent"
                      />
                    </div>
                  ))}
                  {registrationMessage && (
                    <p role={registrationMessage.type === 'error' ? 'alert' : 'status'} className={`text-sm ${registrationMessage.type === 'error' ? 'text-red-700' : 'text-green-700'}`}>
                      {registrationMessage.text}
                    </p>
                  )}
                  <button type="submit" disabled={registrationLoading} className="mt-2 bg-charcoal text-champagne px-8 py-3 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal transition-colors disabled:opacity-60">
                    {registrationLoading ? 'Creating Account...' : 'Create Account'}
                  </button>
                    </form>
                  </>
                )}
              </div>
            )}
            {tab === 'My Orders' && (
              <div>
                <h2 className="font-serif text-2xl text-charcoal mb-6">My Orders</h2>
                {myOrdersLoading ? (
                  <p role="status" className="text-sm text-warm-gray">Loading your orders...</p>
                ) : myOrdersError ? (
                  <p role="alert" className="text-sm text-red-700">{myOrdersError}</p>
                ) : myOrders.length === 0 ? (
                  <p className="text-sm text-warm-gray">You have no orders yet.</p>
                ) : (
                  <div className="space-y-4">
                    {myOrders.map(order => (
                      <article key={order.id} className="border border-border rounded-2xl p-4 sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-charcoal">Order #{order.order_number}</p>
                            <p className="mt-1 text-xs text-warm-gray">{new Date(order.created_at).toLocaleString('en-IN')}</p>
                          </div>
                          <span className="bg-cream text-wine text-xs px-3 py-1 rounded-full">{order.status}</span>
                        </div>
                        <div className="mt-4 space-y-2">
                          {order.items.map(item => (
                            <div key={item.id} className="flex justify-between gap-4 text-sm">
                              <span className="text-charcoal">{item.product_name} × {item.quantity}</span>
                              <span className="shrink-0 text-charcoal">₹{(Number(item.price) * item.quantity).toLocaleString('en-IN')}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 border-t border-border pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-xs tracking-wider uppercase text-warm-gray">Expected Delivery Date</p>
                            <p className="mt-1 font-medium text-charcoal">{formatExpectedDeliveryDate(order)}</p>
                          </div>
                          <div>
                            <p className="text-xs tracking-wider uppercase text-warm-gray">Payment</p>
                            <p className="mt-1 text-charcoal">{order.payment_status}</p>
                          </div>
                          <div>
                            <p className="text-xs tracking-wider uppercase text-warm-gray">Total</p>
                            <p className="mt-1 font-medium text-charcoal">₹{Number(order.total_amount).toLocaleString('en-IN')}</p>
                            {Number(order.discount_amount) > 0 && (
                              <p className="mt-0.5 text-xs text-green-700">Includes −₹{Number(order.discount_amount).toLocaleString('en-IN')} ({order.coupon_code})</p>
                            )}
                          </div>
                          <div className="sm:col-span-2">
                            <p className="text-xs tracking-wider uppercase text-warm-gray">Shipping Address</p>
                            <p className="mt-1 leading-relaxed text-charcoal">{order.customer_address}</p>
                          </div>
                        </div>
                        {orderActionMessage[order.id] && <p role="alert" className="mt-3 text-sm text-wine">{orderActionMessage[order.id]}</p>}
                        <div className="mt-4 flex flex-wrap gap-3">
                          <button onClick={() => onTrackOrder(order.order_number)} className="border border-charcoal text-charcoal px-6 py-2.5 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal hover:text-champagne transition-all">
                            Track Order
                          </button>
                          {storeSettings.online_payment && order.status !== 'Cancelled' && order.payment_status === 'Pending' && (
                            <button onClick={() => { void payMyOrder(order) }} disabled={orderActionId !== null} className="bg-wine text-white px-6 py-2.5 rounded-full text-xs tracking-widest uppercase disabled:opacity-60">
                              {orderActionId === order.id ? 'Opening...' : 'Pay Now'}
                            </button>
                          )}
                          {order.can_cancel && (
                            <button onClick={() => { void cancelMyOrder(order) }} disabled={orderActionId !== null} className="text-xs tracking-widest uppercase text-wine underline underline-offset-4 disabled:opacity-60">
                              {orderActionId === order.id ? 'Cancelling...' : 'Cancel Order'}
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
)}
            {tab === 'Track Orders' && (
              <div>
                <h2 className="font-serif text-2xl text-charcoal mb-6">Track Your Order</h2>
                {myOrdersLoading ? (
                  <p role="status" className="text-sm text-warm-gray">Loading your orders...</p>
                ) : myOrdersError ? (
                  <p role="alert" className="text-sm text-red-700">{myOrdersError}</p>
                ) : myOrders.length === 0 ? (
                  <p className="text-sm text-warm-gray">There are no orders to track yet.</p>
                ) : (
                  <div className="space-y-3">
                    {myOrders.map(order => (
                      <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 border border-border rounded-2xl p-4">
                        <div>
                          <p className="text-sm font-medium text-charcoal">Order #{order.order_number}</p>
                          <p className="mt-1 text-xs text-warm-gray">{order.status} · {new Date(order.created_at).toLocaleDateString('en-IN')}</p>
                        </div>
                        <button onClick={() => onTrackOrder(order.order_number)} className="border border-charcoal text-charcoal px-6 py-2.5 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal hover:text-champagne transition-all">Track Order</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {tab === 'Addresses' && (
              <div>
                <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
                  <h2 className="font-serif text-2xl text-charcoal">Saved Addresses</h2>
                  {addresses.length > 0 && (
                    <button
                      type="button"
                      onClick={handleOpenAddAddress}
                      className="border border-border text-charcoal px-5 py-2.5 rounded-full text-xs tracking-widest uppercase hover:border-charcoal hover:bg-cream transition-all"
                    >
                      + Add Address
                    </button>
                  )}
                </div>

                {addressFeedback && (
                  <div
                    role={addressFeedback.type === 'error' ? 'alert' : 'status'}
                    className={`p-4 rounded-2xl mb-6 text-xs font-medium border ${
                      addressFeedback.type === 'success'
                        ? 'bg-green-50 text-green-800 border-green-200'
                        : 'bg-red-50 text-red-800 border-red-200'
                    }`}
                  >
                    {addressFeedback.message}
                  </div>
                )}

                {addressesLoading && (
                  <div className="py-8 text-center text-sm text-warm-gray" role="status">
                    Loading your saved addresses...
                  </div>
                )}

                {addressesError && !addressesLoading && (
                  <div role="alert" className="p-4 rounded-2xl bg-red-50 text-red-800 border border-red-200 text-xs mb-4">
                    {addressesError}
                  </div>
                )}

                {!addressesLoading && addresses.length === 0 && (
                  <div className="text-center py-12 px-4 border border-dashed border-border rounded-3xl bg-cream/30">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-cream flex items-center justify-center text-warm-gray">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <p className="font-serif text-lg text-charcoal mb-1">No Saved Addresses</p>
                    <p className="text-xs text-warm-gray max-w-sm mx-auto mb-6">
                      You haven't saved any delivery addresses yet. Add an address now to enjoy faster checkout.
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenAddAddress}
                      className="bg-charcoal text-champagne px-8 py-3 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal/90 transition-colors"
                    >
                      + Add Address
                    </button>
                  </div>
                )}

                {!addressesLoading && addresses.length > 0 && (
                  <div className="space-y-4">
                    {addresses.map(addr => (
                      <div
                        key={addr.id}
                        className="border border-border rounded-2xl p-5 hover:border-champagne/60 transition-colors bg-white"
                      >
                        <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
                          <div className="flex items-center gap-2.5">
                            <p className="font-medium text-sm text-charcoal">{addr.name}</p>
                            {addr.is_default && (
                              <span className="bg-cream text-gold text-xs px-2.5 py-0.5 rounded-full font-medium border border-gold/20">
                                Default
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs">
                            {!addr.is_default && (
                              <button
                                type="button"
                                onClick={() => handleSetDefaultAddress(addr.id)}
                                disabled={addressActionId === addr.id}
                                className="text-warm-gray hover:text-charcoal transition-colors underline-offset-4 hover:underline disabled:opacity-50"
                              >
                                Set as Default
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleOpenEditAddress(addr)}
                              disabled={addressActionId === addr.id}
                              className="text-warm-gray hover:text-charcoal transition-colors underline-offset-4 hover:underline disabled:opacity-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteAddress(addr.id)}
                              disabled={addressActionId === addr.id}
                              className="text-wine hover:text-red-700 transition-colors underline-offset-4 hover:underline disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        <p className="text-sm text-warm-gray leading-relaxed">
                          {addr.address_line}
                          {addr.landmark && `, Near ${addr.landmark}`}
                        </p>
                        <p className="text-sm text-warm-gray mt-0.5">
                          {addr.city}, {addr.state} - {addr.pin_code}
                        </p>
                        <p className="text-xs text-warm-gray mt-2 flex items-center gap-1.5">
                          <span className="uppercase tracking-wider text-[10px] text-warm-gray/70">Phone:</span>
                          <span className="text-charcoal font-medium">{addr.phone}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add / Edit Address Modal */}
                {isAddressModalOpen && (
                  <div
                    className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-charcoal/60 p-3 sm:p-6 backdrop-blur-[2px]"
                    onClick={() => !isSavingAddress && setIsAddressModalOpen(false)}
                  >
                    <section
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="address-modal-title"
                      className="my-auto w-full max-w-lg overflow-hidden rounded-3xl border border-border bg-ivory shadow-[0_18px_50px_rgba(30,21,16,0.28)]"
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="flex items-start justify-between gap-4 border-b border-border bg-white px-6 py-5">
                        <div>
                          <p className="text-[10px] tracking-[0.24em] uppercase text-gold">
                            {editingAddress ? 'Update address' : 'New shipping address'}
                          </p>
                          <h2 id="address-modal-title" className="mt-1 font-serif text-2xl text-charcoal">
                            {editingAddress ? 'Edit Address' : 'Add New Address'}
                          </h2>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsAddressModalOpen(false)}
                          disabled={isSavingAddress}
                          className="rounded-full border border-border px-3.5 py-1.5 text-xs text-warm-gray transition hover:border-charcoal hover:text-charcoal disabled:opacity-50"
                        >
                          Close
                        </button>
                      </div>

                      <form onSubmit={handleSaveAddress} className="p-6 space-y-4">
                        {addressFormError && (
                          <div role="alert" className="p-3 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-700">
                            {addressFormError}
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">
                              Full Name <span className="text-wine">*</span>
                            </label>
                            <input
                              type="text"
                              required
                              value={addressForm.name}
                              onChange={e => setAddressForm(f => ({ ...f, name: e.target.value }))}
                              placeholder="e.g. Priya Sharma"
                              className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-white transition-colors"
                            />
                          </div>
                          <div>
                            <label className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">
                              Phone Number <span className="text-wine">*</span>
                            </label>
                            <input
                              type="tel"
                              required
                              value={addressForm.phone}
                              onChange={e => setAddressForm(f => ({ ...f, phone: e.target.value }))}
                              placeholder="e.g. 9876543210"
                              className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-white transition-colors"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">
                            Address Line (House No, Building, Street) <span className="text-wine">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            value={addressForm.address_line}
                            onChange={e => setAddressForm(f => ({ ...f, address_line: e.target.value }))}
                            placeholder="e.g. 42, Anna Nagar West"
                            className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-white transition-colors"
                          />
                        </div>

                        <div>
                          <label className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">
                            Landmark <span className="text-warm-gray/60 font-normal">(Optional)</span>
                          </label>
                          <input
                            type="text"
                            value={addressForm.landmark}
                            onChange={e => setAddressForm(f => ({ ...f, landmark: e.target.value }))}
                            placeholder="e.g. Near Shanthi Colony Signal"
                            className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-white transition-colors"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">
                              City <span className="text-wine">*</span>
                            </label>
                            <input
                              type="text"
                              required
                              value={addressForm.city}
                              onChange={e => setAddressForm(f => ({ ...f, city: e.target.value }))}
                              placeholder="e.g. Chennai"
                              className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-white transition-colors"
                            />
                          </div>
                          <div>
                            <label className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">
                              State <span className="text-wine">*</span>
                            </label>
                            <input
                              type="text"
                              required
                              value={addressForm.state}
                              onChange={e => setAddressForm(f => ({ ...f, state: e.target.value }))}
                              placeholder="e.g. Tamil Nadu"
                              className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-white transition-colors"
                            />
                          </div>
                          <div>
                            <label className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">
                              PIN Code <span className="text-wine">*</span>
                            </label>
                            <input
                              type="text"
                              required
                              value={addressForm.pin_code}
                              onChange={e => setAddressForm(f => ({ ...f, pin_code: e.target.value }))}
                              placeholder="e.g. 600040"
                              className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-white transition-colors"
                            />
                          </div>
                        </div>

                        <label className="flex items-center gap-2.5 pt-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={addressForm.is_default}
                            onChange={e => setAddressForm(f => ({ ...f, is_default: e.target.checked }))}
                            className="w-4 h-4 rounded text-charcoal accent-charcoal focus:ring-champagne"
                          />
                          <span className="text-xs text-charcoal">Set as default address</span>
                        </label>

                        <div className="flex gap-3 pt-4 border-t border-border">
                          <button
                            type="button"
                            onClick={() => setIsAddressModalOpen(false)}
                            disabled={isSavingAddress}
                            className="border border-border text-warm-gray px-6 py-3 rounded-full text-xs tracking-widest uppercase hover:border-charcoal hover:text-charcoal transition-all disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={isSavingAddress}
                            className="flex-1 bg-charcoal text-champagne py-3 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal/90 transition-colors disabled:opacity-60"
                          >
                            {isSavingAddress ? 'Saving Address...' : editingAddress ? 'Update Address' : 'Save Address'}
                          </button>
                        </div>
                      </form>
                    </section>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <Footer setPage={setPage} />
    </div>
  )
}

// The reset link's "?email=…&token=…" is read once when the page loads; the app
// then rewrites the URL to "#reset-password", so the token does not linger in history.
const INITIAL_HASH_QUERY = new URLSearchParams(window.location.hash.split('?')[1] ?? '')

function ResetPasswordPage({ setPage }: { setPage: (p: Page) => void }) {
  const [email] = useState(() => INITIAL_HASH_QUERY.get('email') ?? '')
  const [token] = useState(() => INITIAL_HASH_QUERY.get('token') ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const linkMissing = !email || !token

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password !== confirm) {
      setMessage({ type: 'error', text: 'The passwords do not match.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, token, password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Unable to reset your password.')
      setMessage({ type: 'success', text: data.message || 'Your password has been reset. You can now sign in.' })
      setPassword('')
      setConfirm('')
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unable to reset your password.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-ivory">
      <div className="max-w-md mx-auto px-4 sm:px-6 py-16">
        <h1 className="font-serif text-4xl text-charcoal mb-2">Set a New Password</h1>
        {linkMissing ? (
          <div className="mt-8 bg-white rounded-3xl border border-border p-8">
            <p className="text-sm text-warm-gray">This reset link is incomplete. Request a new one from the sign-in page.</p>
            <button onClick={() => setPage('account-sign-in')} className="mt-5 bg-charcoal text-champagne px-8 py-3 rounded-full text-xs tracking-widest uppercase">Go to Sign In</button>
          </div>
        ) : message?.type === 'success' ? (
          <div className="mt-8 bg-white rounded-3xl border border-border p-8">
            <p role="status" className="text-sm text-green-700">{message.text}</p>
            <button onClick={() => setPage('account-sign-in')} className="mt-5 bg-charcoal text-champagne px-8 py-3 rounded-full text-xs tracking-widest uppercase">Sign In</button>
          </div>
        ) : (
          <form className="mt-8 space-y-4 bg-white rounded-3xl border border-border p-8" onSubmit={submit}>
            <p className="text-sm text-warm-gray">For {email}</p>
            <div>
              <label htmlFor="reset-password" className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">New Password</label>
              <input id="reset-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={72} required className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent" />
            </div>
            <div>
              <label htmlFor="reset-password-confirm" className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">Confirm New Password</label>
              <input id="reset-password-confirm" type="password" value={confirm} onChange={event => setConfirm(event.target.value)} autoComplete="new-password" minLength={8} maxLength={72} required className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent" />
            </div>
            {message && <p role="alert" className="text-sm text-red-700">{message.text}</p>}
            <button type="submit" disabled={saving} className="bg-charcoal text-champagne px-8 py-3 rounded-full text-xs tracking-widest uppercase disabled:opacity-60">
              {saving ? 'Saving...' : 'Set Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function AboutPage({ setPage }: { setPage: (p: Page) => void }) {
  return (
    <div className="min-h-screen bg-ivory">
      <div className="relative h-72 overflow-hidden bg-charcoal">
        <img src="https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=1600&h=600&fit=crop&auto=format" alt="About" className="absolute inset-0 w-full h-full object-cover opacity-50" />
        <div className="relative h-full flex flex-col justify-center items-center text-center">
          <p className="text-champagne text-xs tracking-widest uppercase mb-3">Our Story</p>
          <h1 className="font-serif text-5xl text-white">About Us</h1>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <p className="font-serif text-2xl text-charcoal leading-relaxed mb-8">
          "Yaale was born from a deep love for India's textile heritage — every saree a story, every weave a legacy."
        </p>
        <p className="text-warm-gray font-light leading-relaxed mb-6">
          Founded in Salem, we work directly with weavers from Tamil Nadu to bring you authentic, handcrafted sarees of uncompromising quality. Every piece in our collection is curated with care, ensuring that the age-old traditions of Indian weaving reach women across the country.
        </p>
        <p className="text-warm-gray font-light leading-relaxed mb-12">
          We believe luxury isn't about price — it's about intentionality. Our sarees are made to be worn at moments that matter, cherished for generations, and passed on as heirlooms.
        </p>
        <button onClick={() => setPage('shop')}
          className="bg-charcoal text-champagne px-10 py-4 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal transition-colors">
          Shop Our Collection
        </button>
      </div>
      <Footer setPage={setPage} />
    </div>
  )
}

function ContactPage({ setPage, storeSettings }: { setPage: (p: Page) => void, storeSettings: StoreSettingsForm }) {
  const [form, setForm] = useState({ name: '', email: '', mobile: '', message: '' })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const submissionInProgress = useRef(false)
  const contactAddress = storeSettings.store_address.trim() || CONTACT_ADDRESS
  const contactEmail = storeSettings.store_email.trim() || DEFAULT_CONTACT_EMAIL
  const contactPhone = storeSettings.store_phone.trim() || DEFAULT_CONTACT_PHONE

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submissionInProgress.current) return

    submissionInProgress.current = true
    setIsSubmitting(true)
    setFeedback(null)

    try {
      const response = await fetch(`${API_BASE_URL}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const errors = data.errors
          ? Object.values(data.errors as Record<string, string[]>).flat().join(' ')
          : ''
        throw new Error(errors || data.message || 'Unable to send your message. Please try again.')
      }

      setForm({ name: '', email: '', mobile: '', message: '' })
      setFeedback({ type: 'success', message: data.message || 'Your message has been sent successfully.' })
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unable to send your message. Please try again.',
      })
    } finally {
      submissionInProgress.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-ivory">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-14">
          <p className="text-gold text-xs tracking-widest uppercase mb-3">Get in Touch</p>
          <h1 className="font-serif text-5xl text-charcoal">Contact Us</h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <div className="bg-white rounded-3xl border border-border p-8">
            <h2 className="font-serif text-2xl text-charcoal mb-6">Send a Message</h2>
            <form className="space-y-4" onSubmit={handleSubmit}>
              {[
                { label: 'Your Name', name: 'name', type: 'text' },
                { label: 'Email Address', name: 'email', type: 'email' },
                { label: 'Mobile Number', name: 'mobile', type: 'tel' },
              ].map(field => (
                <div key={field.name}>
                  <label htmlFor={`contact-${field.name}`} className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">{field.label}</label>
                  <input
                    id={`contact-${field.name}`}
                    name={field.name}
                    type={field.type}
                    value={form[field.name as keyof typeof form]}
                    onChange={event => setForm(current => ({ ...current, [field.name]: event.target.value }))}
                    required
                    autoComplete={field.name === 'name' ? 'name' : field.name === 'email' ? 'email' : 'tel'}
                    pattern={field.name === 'mobile' ? '[+]?[1-9][0-9]{9,14}' : undefined}
                    maxLength={field.name === 'mobile' ? 16 : undefined}
                    className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent transition-colors"
                  />
                </div>
              ))}
              <div>
                <label htmlFor="contact-message" className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">Message</label>
                <textarea
                  id="contact-message"
                  name="message"
                  rows={4}
                  value={form.message}
                  onChange={event => setForm(current => ({ ...current, message: event.target.value }))}
                  required
                  className="w-full border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-champagne bg-transparent transition-colors resize-none"
                />
              </div>
              {feedback && (
                <p role={feedback.type === 'error' ? 'alert' : 'status'} className={`text-sm ${feedback.type === 'error' ? 'text-red-700' : 'text-green-700'}`}>
                  {feedback.message}
                </p>
              )}
              <button type="submit" disabled={isSubmitting} className="w-full bg-charcoal text-champagne py-3.5 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal transition-colors">
                {isSubmitting ? 'Sending...' : 'Send Message'}
              </button>
            </form>
          </div>
          <div className="space-y-6">
            <div className="bg-cream rounded-3xl p-8">
              <h3 className="font-serif text-xl text-charcoal mb-4">Find Us</h3>
              <div className="space-y-3 text-sm text-warm-gray font-light">
                <p>📍 <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contactAddress)}`} target="_blank" rel="noreferrer" className="hover:underline">{contactAddress}</a></p>
                <p>📞 {contactPhone}</p>
                <p>✉ {contactEmail}</p>
                <p>⏰ Mon–Sat: 10AM–7PM</p>
              </div>
            </div>
            <div className="bg-cream rounded-3xl p-8">
              <h3 className="font-serif text-xl text-charcoal mb-4">Follow Us</h3>
              <div className="flex gap-3">
                <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" className="bg-charcoal text-champagne px-5 py-2.5 rounded-full text-xs tracking-widest uppercase hover:bg-charcoal transition-colors">Instagram</a>
                <a href="https://wa.me/919150130613" target="_blank" rel="noreferrer" className="bg-[#25d366] text-white px-5 py-2.5 rounded-full text-xs tracking-widest uppercase hover:opacity-80 transition-opacity">WhatsApp</a>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer setPage={setPage} />
    </div>
  )
}

function AdminLoginPage({ setPage, onLoginSuccess }: { setPage: (p: Page) => void, onLoginSuccess: (session: AdminAuthSession, rememberMe: boolean) => void }) {
  const [email, setEmail] = useState(() => localStorage.getItem('yaale_admin_remembered_email') ?? '')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(() => !!localStorage.getItem('yaale_admin_remembered_email'))
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  const login = async () => {
    setLoginLoading(true)
    setLoginError('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const errors = data.errors ? Object.values(data.errors as Record<string, string[]>).flat().join('\n') : ''
        setLoginError(errors || data.message || 'Unable to sign in.')
        return
      }

      if (rememberMe) {
        localStorage.setItem('yaale_admin_remembered_email', email)
      } else {
        localStorage.removeItem('yaale_admin_remembered_email')
      }

      onLoginSuccess(data as AdminAuthSession, rememberMe)
    } catch (error) {
      console.error('Admin sign-in error:', error)
      setLoginError('Unable to reach the admin service.')
    } finally {
      setLoginLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-charcoal flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <p className="font-serif text-3xl text-champagne">Yaale</p>
          <p className="text-warm-gray text-xs tracking-widest uppercase mt-2">Admin Portal</p>
        </div>
        <div className="bg-charcoal rounded-3xl border border-[#4a3a32] p-8">
          <h1 className="font-serif text-2xl text-white mb-6">Sign In</h1>
          <div className="space-y-4">
            <div>
              <label className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full bg-charcoal border border-[#4a3a32] rounded-2xl px-4 py-3 text-sm text-white outline-none focus:border-champagne transition-colors" />
            </div>
            <div>
              <label className="text-xs tracking-wider uppercase text-warm-gray block mb-1.5">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                className="w-full bg-charcoal border border-[#4a3a32] rounded-2xl px-4 py-3 text-sm text-white outline-none focus:border-champagne transition-colors" />
            </div>
            <label className="flex items-center gap-2 text-xs text-warm-gray cursor-pointer select-none">
              <input
                type="checkbox"
                id="admin-remember-me"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                className="w-4 h-4 accent-champagne cursor-pointer"
              />
              Remember me
            </label>
          </div>
          {loginError && <p role="alert" className="mt-4 whitespace-pre-line text-sm text-[#f3a3a3]">{loginError}</p>}
          <button onClick={login} disabled={loginLoading || !email || !password}
            className="w-full mt-6 bg-champagne text-charcoal py-3.5 rounded-full text-xs tracking-widest uppercase font-semibold hover:bg-charcoal hover:text-champagne transition-colors disabled:opacity-50">
            {loginLoading ? 'Signing In...' : 'Login'}
          </button>
        </div>
        <button onClick={() => setPage('home')} className="w-full text-center mt-6 text-xs text-warm-gray hover:text-champagne tracking-wider uppercase">
          ← Back to Store
        </button>
      </div>
    </div>
  )
}

function AdminDashboardPage({ setPage, adminSession, onLogout, globalStoreSettings, setGlobalStoreSettings }: { setPage: (p: Page) => void, adminSession: AdminAuthSession | null, onLogout: () => void, globalStoreSettings: StoreSettingsForm, setGlobalStoreSettings: (settings: StoreSettingsForm) => void }) {
  const { refreshProducts: refreshStorefrontProducts, videos, setVideos, videosLoading, videosError, setVideosError } = useProductsStore()

  // The admin works on its own product list from /api/admin/products, which includes
  // hidden (inactive) products. The storefront list only has active ones.
  const [products, setProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [productsError, setProductsError] = useState('')

  const refreshProducts = async () => {
    if (!adminSession?.token) {
      setProducts([])
      setProductsLoading(false)
      return
    }

    setProductsLoading(true)
    setProductsError('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/products`, {
        headers: { Authorization: `Bearer ${adminSession.token}`, Accept: 'application/json' },
      })
      const data = await response.json().catch(() => ({}))

      if (response.status === 401 || response.status === 403) {
        onLogout()
        return
      }

      if (!response.ok) throw new Error(data.message || 'Failed to load products')
      if (!Array.isArray(data)) throw new Error('The products response was invalid')

      setProducts(data.map(mapApiProduct))
    } catch (error) {
      console.error('Error fetching admin products:', error)
      setProductsError(error instanceof Error ? error.message : 'Failed to load products')
    } finally {
      setProductsLoading(false)
    }
  }

  useEffect(() => {
    void refreshProducts()
  }, [adminSession?.token])

  // Changes made here (new, edited, hidden or deleted sarees) should show on the
  // storefront when the admin leaves the dashboard.
  useEffect(() => () => { void refreshStorefrontProducts().catch(() => {}) }, [])
  const [tab, setTab] = useState('Dashboard')
  const [editingProduct, setEditingProduct] = useState<(Product & {
  imageFile?: File | null
}) | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [orders, setOrders] = useState<any[]>([])
const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [orderStatusNotes, setOrderStatusNotes] = useState<Record<number, string>>({})
  const [orderStatusSavingId, setOrderStatusSavingId] = useState<number | null>(null)
  const [orderStatusErrors, setOrderStatusErrors] = useState<Record<number, string>>({})
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [categoriesError, setCategoriesError] = useState('')
  const [customers, setCustomers] = useState<AdminCustomer[]>([])
  const [customersLoading, setCustomersLoading] = useState(true)
  const [customersError, setCustomersError] = useState('')
  const [offers, setOffers] = useState<AdminOffer[]>([])
  const [offersLoading, setOffersLoading] = useState(true)
  const [offersError, setOffersError] = useState('')
  const [offerDialog, setOfferDialog] = useState<'add' | 'edit' | 'delete' | null>(null)
  const [selectedOffer, setSelectedOffer] = useState<AdminOffer | null>(null)
  const [offerForm, setOfferForm] = useState<OfferForm>(EMPTY_OFFER_FORM)
  const [offerActionError, setOfferActionError] = useState('')
  const [offerActionLoading, setOfferActionLoading] = useState(false)
  const [storeSettings, setStoreSettings] = useState<StoreSettingsForm>(EMPTY_STORE_SETTINGS)
  const [savedStoreSettings, setSavedStoreSettings] = useState<StoreSettingsForm>(EMPTY_STORE_SETTINGS)
  const [storeSettingsLoading, setStoreSettingsLoading] = useState(false)
  const [storeSettingsSaving, setStoreSettingsSaving] = useState(false)
  const [storeSettingsError, setStoreSettingsError] = useState('')
  const [storeSettingsMessage, setStoreSettingsMessage] = useState('')
  const [inboxMessages, setInboxMessages] = useState<Array<{ id: number; name: string; email: string; mobile: string; message: string; is_read: boolean; created_at: string | null }>>([])
  const [selectedInboxMessage, setSelectedInboxMessage] = useState<Array<{ id: number; name: string; email: string; mobile: string; message: string; is_read: boolean; created_at: string | null }>[number] | null>(null)
  const [inboxLoading, setInboxLoading] = useState(false)
  const [inboxError, setInboxError] = useState('')
  const [inventoryStockDrafts, setInventoryStockDrafts] = useState<Record<number, string>>({})
  const [inventoryErrors, setInventoryErrors] = useState<Record<number, string>>({})
  const [inventorySavingId, setInventorySavingId] = useState<number | null>(null)
  const [categoryDialog, setCategoryDialog] = useState<'add' | 'edit' | 'delete' | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<AdminCategory | null>(null)
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' })
  const [categoryActionError, setCategoryActionError] = useState('')
  const [categoryActionLoading, setCategoryActionLoading] = useState(false)
  const [deleteConfirmProduct, setDeleteConfirmProduct] = useState<Product | null>(null)
  const [deleteInProgress, setDeleteInProgress] = useState(false)
  const [deleteActionError, setDeleteActionError] = useState('')
  const [dashboardStats, setDashboardStats] = useState<AdminDashboardStats | null>(null)
  const [dashboardStatsLoading, setDashboardStatsLoading] = useState(true)
  const [dashboardStatsError, setDashboardStatsError] = useState('')

  const loadDashboardStats = async () => {
    if (!adminSession?.token) {
      setDashboardStats(null)
      setDashboardStatsLoading(false)
      return
    }

    setDashboardStatsLoading(true)
    setDashboardStatsError('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/dashboard`, {
        headers: {
          Authorization: `Bearer ${adminSession.token}`,
          Accept: 'application/json',
        },
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Failed to load dashboard stats')
      setDashboardStats(data as AdminDashboardStats)
    } catch (err) {
      console.warn('Dashboard stats error:', err)
      setDashboardStatsError(err instanceof Error ? err.message : 'Failed to load stats')
    } finally {
      setDashboardStatsLoading(false)
    }
  }

  useEffect(() => {
    void loadDashboardStats()
  }, [adminSession?.token])

  useEffect(() => {
    if (tab === 'Dashboard') {
      void loadDashboardStats()
    }
  }, [tab])

  useEffect(() => {
    if (!selectedOrder) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedOrder(null)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedOrder])

  useEffect(() => {
    if (!categoryDialog || categoryActionLoading) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCategoryDialog(null)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [categoryDialog, categoryActionLoading])

  useEffect(() => {
    if (!deleteConfirmProduct || deleteInProgress) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDeleteConfirmProduct(null)
        setDeleteActionError('')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleteConfirmProduct, deleteInProgress])

useEffect(() => {
    if (!adminSession) {
      setOrders([])
      setOrdersError('')
      setOrdersLoading(false)
      return
    }

    const fetchOrders = async () => {
      setOrdersLoading(true)
      setOrdersError('')

      try {
        const response = await fetch(`${API_BASE_URL}/api/orders`, {
          headers: { Authorization: `Bearer ${adminSession.token}`, Accept: 'application/json' },
        })

        const data = await response.json().catch(() => ({}))

        if (!response.ok) {
          throw new Error(data.message || 'Failed to fetch orders')
        }

        if (!Array.isArray(data)) throw new Error('The orders response was invalid.')
        setOrders(data)
      } catch (error) {
        console.error('FETCH ORDERS ERROR:', error)
        setOrdersError(error instanceof Error ? error.message : 'Failed to load orders.')
      } finally {
        setOrdersLoading(false)
      }
    }

    fetchOrders()
  }, [adminSession?.token])

  // Payment is recorded by hand (no gateway is connected), so the admin can set it here.
  const updateOrderPayment = async (order: any, paymentStatus: string) => {
    setOrderStatusSavingId(order.id)
    setOrderStatusErrors(current => ({ ...current, [order.id]: '' }))

    try {
      const response = await fetch(`${API_BASE_URL}/api/orders/${order.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${adminSession?.token ?? ''}`,
        },
        body: JSON.stringify({ payment_status: paymentStatus }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) throw new Error(data.message || 'Failed to update payment status.')

      setOrders(current => current.map(currentOrder => currentOrder.id === order.id ? { ...currentOrder, ...data } : currentOrder))
      setSelectedOrder((current: any) => current?.id === order.id ? { ...current, ...data } : current)
      void loadDashboardStats()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update payment status.'
      setOrderStatusErrors(current => ({ ...current, [order.id]: message }))
    } finally {
      setOrderStatusSavingId(null)
    }
  }

  const updateOrderStatus = async (order: any, status: string) => {
    setOrderStatusSavingId(order.id)
    setOrderStatusErrors(current => ({ ...current, [order.id]: '' }))

    try {
      const response = await fetch(`${API_BASE_URL}/api/orders/${order.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${adminSession?.token ?? ''}`,
        },
        body: JSON.stringify({ status, note: orderStatusNotes[order.id] || null }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const errors = data.errors
          ? Object.values(data.errors as Record<string, string[]>).flat().join(' ')
          : ''
        throw new Error(errors || data.message || 'Failed to update order status.')
      }

      setOrders(current => current.map(currentOrder => currentOrder.id === order.id
        ? { ...currentOrder, ...data }
        : currentOrder))
      setSelectedOrder((current: any) => current?.id === order.id ? { ...current, ...data } : current)
      setOrderStatusNotes(current => ({ ...current, [order.id]: '' }))
      void loadDashboardStats()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update order status.'
      setOrderStatusErrors(current => ({ ...current, [order.id]: message }))
    } finally {
      setOrderStatusSavingId(null)
    }
  }


  const [newSaree, setNewSaree] = useState({
    name: 'Mysore Silk Elegance', sku: 'SS-010', category: 'Soft Silk', price: '18500',
    discount: '10', fabric: 'Pure Silk', color: 'Rose Gold', length: '5.5m',
    blouse: 'Yes', occasion: 'Wedding', stock: '12',
    description: 'Handwoven saree crafted with a regal sheen, delicate zari detailing and rich festive elegance.',
    returnExchange: 'Returns and exchanges are accepted within 7 days of delivery for unused items with original packaging.',
    manufacturedBy: 'Yaale Artisans, Chennai',
    marketedBy: 'Yaale, Chennai',
    images: [] as string[],
imageFiles: [] as File[],
  })
  const [newVideo, setNewVideo] = useState({ title: 'Festive Edit', videoFile: null as File | null })
  const [videoUploading, setVideoUploading] = useState(false)
  const [deletingVideoId, setDeletingVideoId] = useState<number | null>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const sidebarItems = ['Dashboard', 'Sarees', 'Categories', 'Inventory', 'Orders', 'Customers', 'Offers', 'Settings', 'Inbox']
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const totalSalesAmount = orders.reduce((sum, o) => {
    if (o.status === 'Cancelled') return sum
    const amt = Number(o.amount ?? o.total_amount ?? 0)
    return sum + (Number.isFinite(amt) ? amt : 0)
  }, 0)

  const pendingOrdersCount = orders.filter(o => o.status === 'Pending').length
  const lowStockCount = products.filter(p => (p.stock ?? 0) <= 5).length

  const stats = [
    {
      label: 'Total Sarees',
      value: String(dashboardStats?.total_sarees?.count ?? products.length),
      change: dashboardStats?.total_sarees?.change ?? (products.length > 0 ? `+${products.length} in collection` : '0 this month'),
      color: 'text-[#063737]',
      accentBg: 'bg-[#063737]/10',
    },
    {
      label: 'Total Orders',
      value: String(dashboardStats?.total_orders?.count ?? orders.length),
      change: dashboardStats?.total_orders?.change ?? (orders.length > 0 ? `+${orders.length} total` : '0 this week'),
      color: 'text-[#8b263e]',
      accentBg: 'bg-[#8b263e]/10',
    },
    {
      label: 'Total Sales',
      value: dashboardStats?.total_sales?.formatted ?? (totalSalesAmount >= 100000 ? `₹${(totalSalesAmount / 100000).toFixed(1)}L` : `₹${totalSalesAmount.toLocaleString('en-IN')}`),
      change: dashboardStats?.total_sales?.change ?? (totalSalesAmount > 0 ? `₹${totalSalesAmount.toLocaleString('en-IN')} total` : '₹0 this month'),
      color: 'text-[#9e571c]',
      accentBg: 'bg-[#9e571c]/10',
    },
    {
      label: 'Pending Orders',
      value: String(dashboardStats?.pending_orders?.count ?? pendingOrdersCount),
      change: dashboardStats?.pending_orders?.change ?? (pendingOrdersCount > 0 ? `${pendingOrdersCount} pending` : 'All fulfilled'),
      color: 'text-[#c25e00]',
      accentBg: 'bg-[#c25e00]/10',
    },
    {
      label: 'Low Stock',
      value: String(dashboardStats?.low_stock?.count ?? lowStockCount),
      change: dashboardStats?.low_stock?.change ?? (lowStockCount > 0 ? `${lowStockCount} items low` : 'Stock healthy'),
      color: 'text-[#b91c1c]',
      accentBg: 'bg-[#b91c1c]/10',
    },
    {
      label: 'Customers',
      value: String(dashboardStats?.customers?.count ?? customers.length),
      change: dashboardStats?.customers?.change ?? (customers.length > 0 ? `+${customers.length} total` : '0 new'),
      color: 'text-[#1e3a8a]',
      accentBg: 'bg-[#1e3a8a]/10',
    },
  ]

 

  const statusColor: Record<string, string> = {
    Shipped: 'bg-blue-50 text-blue-700', Packed: 'bg-amber-50 text-amber-700',
    Confirmed: 'bg-green-50 text-green-700', Pending: 'bg-orange-50 text-orange-700',
    Delivered: 'bg-emerald-50 text-emerald-700', Cancelled: 'bg-red-50 text-red-700',
  }

  const loadCategories = async () => {
    setCategoriesLoading(true)
    setCategoriesError('')

    try {
      if (!adminSession?.token) return
      // Admin list includes draft (inactive) categories; the public one does not.
      const response = await fetch(`${API_BASE_URL}/api/admin/categories`, {
        headers: { Authorization: `Bearer ${adminSession.token}`, Accept: 'application/json' },
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.message || 'Failed to load categories')
      }

      if (!Array.isArray(data)) {
        throw new Error('The categories response was invalid')
      }

      setCategories(data)
    } catch (error) {
      console.error('Error fetching categories:', error)
      setCategoriesError(error instanceof Error ? error.message : 'Failed to load categories')
    } finally {
      setCategoriesLoading(false)
    }
  }

  useEffect(() => {
    void loadCategories()
  }, [adminSession?.token])

  const loadOffers = async () => {
    setOffersLoading(true)
    setOffersError('')

    try {
      if (!adminSession?.token) return
      // Admin list includes scheduled and paused offers; the public one only has active ones.
      const response = await fetch(`${API_BASE_URL}/api/admin/offers`, {
        headers: { Authorization: `Bearer ${adminSession.token}`, Accept: 'application/json' },
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) throw new Error(data.message || 'Failed to load offers')
      if (!Array.isArray(data)) throw new Error('The offers response was invalid')

      setOffers(data)
    } catch (error) {
      console.error('Error fetching offers:', error)
      setOffersError(error instanceof Error ? error.message : 'Failed to load offers')
    } finally {
      setOffersLoading(false)
    }
  }

  useEffect(() => {
    void loadOffers()
  }, [adminSession?.token])

  useEffect(() => {
    const loadCustomers = async () => {
      if (!adminSession) {
        setCustomers([])
        setCustomersLoading(false)
        return
      }

      try {
        const response = await fetch(`${API_BASE_URL}/api/admin/customers`, {
          headers: { Authorization: `Bearer ${adminSession.token}`, Accept: 'application/json' },
        })
        const data = await response.json().catch(() => ({}))

        if (!response.ok) {
          throw new Error(data.message || 'Failed to load customers')
        }

        if (!Array.isArray(data)) {
          throw new Error('The customers response was invalid')
        }

        const mappedCustomers = Array.isArray(data)
          ? data.map((customer: any) => ({
              name: String(customer.name ?? ''),
              email: customer.email ?? '',
              phone: typeof customer.phone === 'string' && customer.phone
                ? customer.phone
                : Array.isArray(customer.addresses) && customer.addresses.length > 0
                  ? String(customer.addresses[0]?.phone ?? '')
                  : '',
              orders: Number(customer.order_count ?? customer.orders?.length ?? 0),
              spend: Number(customer.spend ?? customer.orders?.reduce((sum: number, order: any) => sum + Number(order.total_amount ?? order.amount ?? 0), 0) ?? 0),
              joined_at: customer.created_at ?? customer.joined_at ?? null,
              is_active: customer.is_active ?? true,
            }))
          : []

        setCustomers(mappedCustomers)
      } catch (error) {
        console.error('Error fetching customers:', error)
        setCustomersError(error instanceof Error ? error.message : 'Failed to load customers')
      } finally {
        setCustomersLoading(false)
      }
    }

    void loadCustomers()
  }, [adminSession?.token])

  const loadStoreSettings = async () => {
    if (!adminSession) {
      setStoreSettingsError('Sign in with an administrator account to manage settings.')
      setStoreSettingsLoading(false)
      return
    }

    setStoreSettingsLoading(true)
    setStoreSettingsError('')
    setStoreSettingsMessage('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/store-settings`, {
        headers: { 'Authorization': `Bearer ${adminSession.token}`, 'Accept': 'application/json' },
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) throw new Error(data.message || 'Unable to load store settings.')

      const settings = storeSettingsFromApi(data)
      setStoreSettings(settings)
      setSavedStoreSettings(settings)
      setGlobalStoreSettings(settings)
    } catch (error) {
      console.error('Error loading store settings:', error)
      setStoreSettingsError(error instanceof Error ? error.message : 'Unable to load store settings.')
    } finally {
      setStoreSettingsLoading(false)
    }
  }

  const loadInboxMessages = async () => {
    if (!adminSession) {
      setInboxError('Sign in with an administrator account to view messages.')
      return
    }

    setInboxLoading(true)
    setInboxError('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/contact-messages`, {
        headers: {
          'Authorization': `Bearer ${adminSession.token}`,
          'Accept': 'application/json',
        },
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.message || 'Unable to load messages.')
      }

      if (!Array.isArray(data)) {
        throw new Error('The inbox response was invalid.')
      }

      setInboxMessages(data.map((message: any) => ({
        id: Number(message.id),
        name: String(message.name ?? ''),
        email: String(message.email ?? ''),
        mobile: String(message.mobile ?? ''),
        message: String(message.message ?? ''),
        is_read: Boolean(message.is_read),
        created_at: typeof message.created_at === 'string' ? message.created_at : null,
      })))
    } catch (error) {
      console.error('Error loading inbox messages:', error)
      setInboxError(error instanceof Error ? error.message : 'Unable to load messages.')
    } finally {
      setInboxLoading(false)
    }
  }

  const markMessageAsRead = async (messageId: number) => {
    if (!adminSession) return

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/contact-messages/${messageId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${adminSession.token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.message || 'Unable to update message status.')
      }

      setInboxMessages(current => current.map(message =>
        message.id === messageId ? { ...message, is_read: true } : message,
      ))
    } catch (error) {
      console.error('Error marking message as read:', error)
      setInboxError(error instanceof Error ? error.message : 'Unable to update message status.')
    }
  }

  useEffect(() => {
    if (tab === 'Settings') void loadStoreSettings()
  }, [tab, adminSession?.token])

  useEffect(() => {
    if (tab === 'Inbox') void loadInboxMessages()
  }, [tab, adminSession?.token])

  const cancelStoreSettings = () => {
    setStoreSettings(savedStoreSettings)
    setStoreSettingsError('')
    setStoreSettingsMessage('')
  }

  const saveStoreSettings = async () => {
    if (!adminSession) {
      setStoreSettingsError('Sign in with an administrator account to save settings.')
      return
    }

    const shippingFee = storeSettings.shipping_fee.trim() === '' ? null : Number(storeSettings.shipping_fee)
    const freeShippingThreshold = storeSettings.free_shipping_threshold.trim() === '' ? null : Number(storeSettings.free_shipping_threshold)
    if ((shippingFee !== null && (!Number.isFinite(shippingFee) || shippingFee < 0)) ||
        (freeShippingThreshold !== null && (!Number.isFinite(freeShippingThreshold) || freeShippingThreshold < 0))) {
      setStoreSettingsError('Shipping amounts must be valid numbers of 0 or more.')
      setStoreSettingsMessage('')
      return
    }

    setStoreSettingsSaving(true)
    setStoreSettingsError('')
    setStoreSettingsMessage('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/store-settings`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${adminSession.token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          ...storeSettings,
          shipping_fee: shippingFee,
          free_shipping_threshold: freeShippingThreshold,
        }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const validationErrors = data.errors ? Object.values(data.errors as Record<string, string[]>).flat().join('\n') : ''
        throw new Error(validationErrors || data.message || 'Unable to save store settings.')
      }

      const saved = storeSettingsFromApi(data)
      setStoreSettings(saved)
      setSavedStoreSettings(saved)
      setGlobalStoreSettings(saved)
      setStoreSettingsMessage('Settings saved successfully.')
    } catch (error) {
      console.error('Error saving store settings:', error)
      setStoreSettingsError(error instanceof Error ? error.message : 'Unable to save store settings.')
    } finally {
      setStoreSettingsSaving(false)
    }
  }

  const settingsActionButtons = () => (
    <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-5">
      <button type="button" onClick={cancelStoreSettings} disabled={storeSettingsSaving || storeSettingsLoading} className="text-xs tracking-[0.22em] uppercase text-warm-gray hover:text-charcoal disabled:opacity-40">Cancel</button>
      <button type="button" onClick={saveStoreSettings} disabled={storeSettingsSaving || storeSettingsLoading || !adminSession} className="rounded-full bg-charcoal px-6 py-3 text-[10px] tracking-[0.24em] uppercase text-champagne transition hover:bg-charcoal disabled:cursor-not-allowed disabled:opacity-40">{storeSettingsSaving ? 'Saving...' : 'Save Changes'}</button>
    </div>
  )

  const categoryApiError = (data: { message?: string; errors?: Record<string, string[]> }, fallback: string) =>
    data.errors
      ? Object.values(data.errors).flat().join('\n')
      : data.message || fallback

  const addCategory = async () => {
    setSelectedCategory(null)
    setCategoryForm({ name: '', description: '' })
    setCategoryActionError('')
    setCategoryDialog('add')
  }

  const editCategory = async (category: AdminCategory) => {
    setSelectedCategory(category)
    setCategoryForm({ name: category.name, description: category.description })
    setCategoryActionError('')
    setCategoryDialog('edit')
  }

  const deleteCategory = async (category: AdminCategory) => {
    setSelectedCategory(category)
    setCategoryActionError('')
    setCategoryDialog('delete')
  }

  const saveCategory = async () => {
    if (!categoryForm.name.trim() || !categoryForm.description.trim()) {
      setCategoryActionError('Category name and description are required.')
      return
    }

    setCategoryActionLoading(true)
    setCategoryActionError('')

    try {
      const isEditing = categoryDialog === 'edit' && selectedCategory
      const response = await fetch(
        isEditing
          ? `${API_BASE_URL}/api/admin/categories/${selectedCategory.id}`
          : `${API_BASE_URL}/api/admin/categories`,
        {
          method: isEditing ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${adminSession?.token ?? ''}`,
          },
          body: JSON.stringify({
            name: categoryForm.name,
            description: categoryForm.description,
          }),
        }
      )
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setCategoryActionError(categoryApiError(data, isEditing ? 'Failed to update category' : 'Failed to add category'))
        return
      }

      setCategoryDialog(null)
      setSelectedCategory(null)
      await loadCategories()
    } catch (error) {
      console.error('Error saving category:', error)
      setCategoryActionError('Something went wrong while saving the category')
    } finally {
      setCategoryActionLoading(false)
    }
  }

  const confirmDeleteCategory = async () => {
    if (!selectedCategory) return

    setCategoryActionLoading(true)
    setCategoryActionError('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/categories/${selectedCategory.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${adminSession?.token ?? ''}`,
          'Accept': 'application/json',
        },
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setCategoryActionError(categoryApiError(data, 'Failed to delete category'))
        return
      }

      setCategoryDialog(null)
      setSelectedCategory(null)
      await loadCategories()
    } catch (error) {
      console.error('Error deleting category:', error)
      setCategoryActionError('Something went wrong while deleting the category')
    } finally {
      setCategoryActionLoading(false)
    }
  }

  const offerApiError = (data: { message?: string; errors?: Record<string, string[]> }, fallback: string) =>
    data.errors ? Object.values(data.errors).flat().join('\n') : data.message || fallback

  const openAddOffer = () => {
    setSelectedOffer(null)
    setOfferForm(EMPTY_OFFER_FORM)
    setOfferActionError('')
    setOfferDialog('add')
  }

  const openEditOffer = (offer: AdminOffer) => {
    setSelectedOffer(offer)
    setOfferForm({
      title: offer.title, type: offer.type, value: offer.value, description: offer.description, status: offer.status,
      code: offer.code ?? '', discount_type: offer.discount_type ?? 'percent',
      discount_value: offer.discount_value ?? '', min_order_amount: offer.min_order_amount ?? '',
    })
    setOfferActionError('')
    setOfferDialog('edit')
  }

  const openDeleteOffer = (offer: AdminOffer) => {
    setSelectedOffer(offer)
    setOfferActionError('')
    setOfferDialog('delete')
  }

  const saveOffer = async () => {
    if (!offerForm.title.trim() || !offerForm.value.trim() || !offerForm.description.trim()) {
      setOfferActionError('Title, offer value or code, and description are required.')
      return
    }

    setOfferActionLoading(true)
    setOfferActionError('')

    try {
      const editing = offerDialog === 'edit' && selectedOffer
      const response = await fetch(
        editing ? `${API_BASE_URL}/api/admin/offers/${selectedOffer.id}` : `${API_BASE_URL}/api/admin/offers`,
        {
          method: editing ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${adminSession?.token ?? ''}`,
          },
          body: JSON.stringify(offerForm),
        }
      )
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setOfferActionError(offerApiError(data, editing ? 'Failed to update offer' : 'Failed to add offer'))
        return
      }

      setOfferDialog(null)
      setSelectedOffer(null)
      await loadOffers()
    } catch (error) {
      console.error('Error saving offer:', error)
      setOfferActionError('Something went wrong while saving the offer')
    } finally {
      setOfferActionLoading(false)
    }
  }

  const confirmDeleteOffer = async () => {
    if (!selectedOffer) return

    setOfferActionLoading(true)
    setOfferActionError('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/offers/${selectedOffer.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${adminSession?.token ?? ''}`,
          'Accept': 'application/json',
        },
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setOfferActionError(offerApiError(data, 'Failed to delete offer'))
        return
      }

      setOfferDialog(null)
      setSelectedOffer(null)
      await loadOffers()
    } catch (error) {
      console.error('Error deleting offer:', error)
      setOfferActionError('Something went wrong while deleting the offer')
    } finally {
      setOfferActionLoading(false)
    }
  }

  const saveInventoryStock = async (product: Product, rawStock: string) => {
    const trimmedStock = rawStock.trim()
    const stock = Number(trimmedStock)

    if (!trimmedStock || !Number.isInteger(stock) || stock < 0) {
      setInventoryErrors(current => ({ ...current, [product.id]: 'Enter a whole number of 0 or more.' }))
      return
    }

    if (stock === (product.stock ?? 0)) {
      setInventoryErrors(current => {
        const next = { ...current }
        delete next[product.id]
        return next
      })
      setInventoryStockDrafts(current => {
        const next = { ...current }
        delete next[product.id]
        return next
      })
      return
    }

    setInventorySavingId(product.id)
    setInventoryErrors(current => {
      const next = { ...current }
      delete next[product.id]
      return next
    })

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/products/${product.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${adminSession?.token ?? ''}`,
        },
        body: JSON.stringify({ stock, inStock: stock > 0 }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const validationMessage = data.errors
          ? Object.values(data.errors as Record<string, string[]>).flat().join(' ')
          : data.message || 'Failed to update stock.'
        setInventoryErrors(current => ({ ...current, [product.id]: validationMessage }))
        return
      }

      await refreshProducts()
      setInventoryStockDrafts(current => {
        const next = { ...current }
        delete next[product.id]
        return next
      })
    } catch (error) {
      console.error('Error updating inventory stock:', error)
      setInventoryErrors(current => ({
        ...current,
        [product.id]: error instanceof Error ? error.message : 'Something went wrong while updating stock.',
      }))
    } finally {
      setInventorySavingId(null)
    }
  }

   const updateSareeField = (
  field: keyof typeof newSaree,
  value: string | File | string[] | File[] | null
) => {
  setNewSaree(prev => ({
    ...prev,
    [field]: value,
  }))
}

  const handleSareePhotos = (files: FileList | null) => {
  if (!files || files.length === 0) return

  const selectedFiles = Array.from(files)

  updateSareeField('imageFiles', selectedFiles)

  selectedFiles.forEach(file => {
    const reader = new FileReader()

    reader.onload = () => {
      setNewSaree(prev => ({
        ...prev,
        images: [...prev.images, String(reader.result)],
      }))
    }

    reader.readAsDataURL(file)
  })
}


  const handleEditorialVideo = (file: File | undefined) => {
    if (!file) return
    setNewVideo(current => ({ ...current, videoFile: file }))
  }

  const saveEditorialVideo = async () => {
    if (!newVideo.videoFile || videoUploading) return

    setVideoUploading(true)

    try {
      const formData = new FormData()
      formData.append('title', newVideo.title || 'Festive Edit')
      formData.append('video', newVideo.videoFile)

      const response = await fetch(`${API_BASE_URL}/api/admin/videos`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminSession?.token ?? ''}`,
          Accept: 'application/json',
        },
        body: formData,
      })
      const responseData = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (response.status === 413) {
          alert(responseData.message || 'The video file is too large for the server. Maximum supported size is 1GB.')
          return
        }
        const validationErrors = responseData.errors
          ? Object.entries(responseData.errors as Record<string, string[]>).map(([field, messages]) =>
              `${field}: ${Array.isArray(messages) ? messages.join(', ') : String(messages)}`
            ).join('\n')
          : ''
        alert(validationErrors || responseData.message || 'Failed to upload video')
        return
      }

      const storageUrl = (path: string | null) => path
        ? path.startsWith('http')
          ? path
          : `${API_BASE_URL}/storage/${path.replace(/^\/+/, '')}`
        : ''

      setVideos(current => [...current, {
        id: responseData.id,
        title: responseData.title,
        src: storageUrl(responseData.video),
        poster: storageUrl(responseData.poster) || products[0]?.image || '',
      }])
      setVideosError('')
      setNewVideo({ title: 'Festive Edit', videoFile: null })
      if (videoInputRef.current) videoInputRef.current.value = ''
      setSuccessMessage('Video uploaded successfully!')
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (error) {
      console.error('Error uploading video:', error)
      alert('Something went wrong while uploading the video')
    } finally {
      setVideoUploading(false)
    }
  }

  const deleteEditorialVideo = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this video?')) return

    setDeletingVideoId(id)

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/videos/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${adminSession?.token ?? ''}`,
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        alert(errorData.message || 'Failed to delete video')
        return
      }

      setVideos(current => current.filter(video => video.id !== id))
      setVideosError('')
      setSuccessMessage('Video deleted successfully!')
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (error) {
      console.error('Error deleting video:', error)
      alert('Something went wrong while deleting the video')
    } finally {
      setDeletingVideoId(null)
    }
  }

  const saveSaree = async () => {
  const originalPrice =
    Number(newSaree.price.replace(/[^0-9.]/g, '')) || 0

  const discount =
    Number(newSaree.discount.replace(/[^0-9.]/g, '')) || 0

  const stock =
    Number(newSaree.stock.replace(/[^0-9]/g, '')) || 0

  if (!newSaree.name || !originalPrice || !newSaree.category) {
    alert('Please fill the required fields')
    return
  }

  try {
    const calculatedPrice = originalPrice * (1 - discount / 100)
    const formData = new FormData()

    formData.append('name', newSaree.name)
    formData.append('sku', newSaree.sku || '')
    formData.append('category', newSaree.category)
    formData.append('price', String(calculatedPrice))
    formData.append('originalPrice', String(originalPrice))
    formData.append('discount', String(discount))
    formData.append('stock', String(stock))
    formData.append('fabric', newSaree.fabric || '')
    formData.append('length', newSaree.length)
    formData.append('blouse', newSaree.blouse)
    formData.append('occasion', newSaree.occasion)
    formData.append('color', newSaree.color || '')
    formData.append('description', newSaree.description || '')
    formData.append('badge', 'NEW')
    formData.append('returnExchange', newSaree.returnExchange || '')
    formData.append('manufacturedBy', newSaree.manufacturedBy || '')
    formData.append('marketedBy', newSaree.marketedBy || '')
    formData.append('inStock', stock > 0 ? 'true' : 'false')
    formData.append('isActive', 'true')

    if (newSaree.imageFiles.length > 0) {
      newSaree.imageFiles.forEach((file) => {
        formData.append('images[]', file)
      })
    }

    const response = await fetch(
      `${API_BASE_URL}/api/admin/products`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminSession?.token ?? ''}`,
          Accept: 'application/json',
        },
        body: formData,
      }
    )

   if (!response.ok) {
  const errorData = await response.json()
  console.error('SAVE SAREE ERROR:', errorData)

  alert(
    errorData.errors
      ? JSON.stringify(errorData.errors, null, 2)
      : errorData.message || 'Failed to save saree'
  )

  return
}

 

    const createdProduct = await response.json()

    const mappedProduct: Product = mapApiProduct(createdProduct)

    setProducts(current => [mappedProduct, ...current])
    setShowAddForm(false)

    setSuccessMessage('Saree added successfully!')

setTimeout(() => {
  setSuccessMessage('')
}, 3000)
  } catch (error) {
    console.error('Error saving saree:', error)
    alert('Something went wrong while saving the saree')
  }
}

const confirmDeleteSaree = (product: Product) => {
  setDeleteConfirmProduct(product)
  setDeleteActionError('')
}

const deleteSaree = async () => {
  if (!deleteConfirmProduct || deleteInProgress) return
  setDeleteInProgress(true)
  setDeleteActionError('')

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/admin/products/${deleteConfirmProduct.id}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${adminSession?.token ?? ''}`,
          Accept: 'application/json',
        },
      }
    )

    const responseData = await response.json().catch(() => ({}))

    if (!response.ok) {
      const msg = responseData.message || 'Failed to delete saree'
      console.error('Delete failed:', responseData)
      setDeleteActionError(msg)
      setDeleteInProgress(false)
      return
    }

    const deletedId = deleteConfirmProduct.id
    setProducts(current =>
      current.filter(product => product.id !== deletedId)
    )
    setDeleteConfirmProduct(null)
    setDeleteActionError('')
    setSuccessMessage('Saree deleted successfully!')
    void loadDashboardStats()
    void refreshStorefrontProducts().catch(() => {})
    setTimeout(() => {
      setSuccessMessage('')
    }, 4000)

  } catch (error) {
    console.error('Error deleting saree:', error)
    setDeleteActionError(error instanceof Error ? error.message : 'Something went wrong while deleting the saree')
  } finally {
    setDeleteInProgress(false)
  }
}

const editSaree = (product: Product) => {
  setEditingProduct(product)
}

const updateSaree = async () => {
  if (!editingProduct) return

  try {
    // Build FormData with camelCase field names for the Node backend
    const formData = new FormData()

    formData.append('name', editingProduct.name)
    formData.append('sku', editingProduct.sku ?? '')
    formData.append('category', editingProduct.category)

    const originalPrice = editingProduct.originalPrice ?? 0
    const discount = editingProduct.discount ?? 0
    // Selling price derived from originalPrice and discount percentage
    const sellingPrice = originalPrice * (1 - discount / 100)
    formData.append('price', String(sellingPrice))
    formData.append('originalPrice', String(originalPrice))
    formData.append('discount', String(discount))

    formData.append('stock', String(editingProduct.stock ?? 0))
    formData.append('fabric', editingProduct.fabric ?? '')
    formData.append('length', editingProduct.length ?? '')
    formData.append('blouse', editingProduct.blouse ?? '')
    formData.append('occasion', editingProduct.occasion ?? '')
    formData.append('color', editingProduct.color ?? '')
    formData.append('description', editingProduct.description ?? '')
    formData.append('returnExchange', editingProduct.returnExchange ?? '')
    formData.append('manufacturedBy', editingProduct.manufacturedBy ?? '')
    formData.append('marketedBy', editingProduct.marketedBy ?? '')
    formData.append('inStock', editingProduct.inStock ? 'true' : 'false')
    // Sends the product's own visibility (set by the "Visible in shop" checkbox),
    // so saving an edit never un-hides a hidden product by accident.
    formData.append('isActive', editingProduct.isActive === false ? 'false' : 'true')

    // Only attach a new image when the user has selected one
    if (editingProduct.imageFile) {
      formData.append('images[]', editingProduct.imageFile)
    }

    const response = await fetch(
      `${API_BASE_URL}/api/admin/products/${editingProduct.id}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${adminSession?.token ?? ''}`,
          Accept: 'application/json',
        },
        body: formData,
      }
    )

    if (!response.ok) {
      const errorData = await response.json()
      console.error(errorData)
      alert('Failed to update saree')
      return
    }

    // Node API response (formatProductResponse) uses snake_case for some fields
    const updatedProduct = await response.json()

    const mappedUpdate = mapApiProduct(updatedProduct)

    setProducts(current =>
      current.map(product =>
        product.id === mappedUpdate.id
          ? { ...product, ...mappedUpdate, image: mappedUpdate.image || product.image }
          : product
      )
    )

    setEditingProduct(null)

    setSuccessMessage('Saree updated successfully!')

    setTimeout(() => {
      setSuccessMessage('')
    }, 3000)

  } catch (error) {
    console.error('Error updating saree:', error)
    alert('Something went wrong while updating the saree')
  }
}

  return (
    <div className="min-h-screen bg-ivory flex flex-col lg:flex-row">
      {/* Mobile top bar */}
      <div className="lg:hidden bg-[#063737] px-4 py-3 flex items-center justify-between shadow-md z-30 sticky top-0">
        <div>
          <p className="font-serif text-lg text-[#e8d5b0]">Yaale</p>
          <p className="text-[#a89070] text-[9px] tracking-widest uppercase leading-tight">Admin Panel</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[#c9a96e] text-xs font-medium">{tab}</span>
          <button
            onClick={() => setSidebarOpen(true)}
            className="ml-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-[#e8d5b0] hover:bg-white/20 transition-colors"
            aria-label="Open menu"
          >
            <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
              <path d="M1 1h16M1 7h16M1 13h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile sidebar drawer overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile sidebar drawer */}
      <div className={`fixed inset-y-0 left-0 z-50 w-72 bg-[#063737] flex flex-col transform transition-transform duration-300 ease-in-out lg:hidden ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <div>
            <p className="font-serif text-xl text-[#e8d5b0]">Yaale</p>
            <p className="text-[#a89070] text-[9px] tracking-widest uppercase mt-0.5">Admin Panel</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-[#e8d5b0] hover:bg-white/20"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {sidebarItems.map(item => (
            <button key={item} onClick={() => { setTab(item); setSidebarOpen(false) }}
              className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all ${tab === item ? 'bg-[#c9a96e]/25 text-[#e8d5b0] border border-[#c9a96e]/30' : 'text-[#c8b89a] hover:bg-white/10 hover:text-[#e8d5b0]'}`}>
              {item}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-white/10 space-y-2">
          <button onClick={() => { setPage('home'); setSidebarOpen(false) }} className="w-full text-left px-4 py-3 rounded-xl text-sm text-[#c8b89a] hover:bg-white/10 hover:text-[#e8d5b0] transition-all">
            ← View Store
          </button>
          <button onClick={() => { onLogout(); setSidebarOpen(false) }} className="w-full text-left px-4 py-3 rounded-xl text-sm text-[#e57373] hover:bg-white/10 transition-all">
            Logout
          </button>
        </div>
      </div>

      {/* Desktop Sidebar */}
      <aside className="w-64 bg-[#063737] flex-shrink-0 flex flex-col hidden lg:flex min-h-screen sticky top-0 max-h-screen overflow-y-auto">
        <div className="px-6 py-6 border-b border-white/10">
          <p className="font-serif text-2xl text-[#e8d5b0]">Yaale</p>
          <p className="text-[#a89070] text-[9px] tracking-widest uppercase mt-1">Admin Panel</p>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {sidebarItems.map(item => (
            <button key={item} onClick={() => setTab(item)}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${tab === item ? 'bg-[#c9a96e]/25 text-[#e8d5b0] border border-[#c9a96e]/30' : 'text-[#c8b89a] hover:bg-white/10 hover:text-[#e8d5b0]'}`}>
              {item}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-white/10 space-y-2">
          <button onClick={() => setPage('home')} className="w-full text-left px-4 py-2.5 rounded-xl text-sm text-[#c8b89a] hover:bg-white/10 hover:text-[#e8d5b0] transition-all">
            ← View Store
          </button>
          <button onClick={onLogout} className="w-full text-left px-4 py-2.5 rounded-xl text-sm text-[#e57373] hover:bg-white/10 transition-all font-medium">
            Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="p-4 sm:p-8">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="font-serif text-2xl sm:text-3xl text-[#1a2e2e] font-semibold">{tab}</h1>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setTab('Inbox')}
                className="relative flex h-9 w-9 items-center justify-center rounded-full bg-[#063737] text-[#e8d5b0] transition-colors hover:bg-[#063737]/80"
                aria-label="Open inbox"
              >
                <EnvelopeIcon />
                {inboxMessages.filter(message => !message.is_read).length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-4 h-4 rounded-full bg-red-600 px-1 text-[9px] leading-4 text-white flex items-center justify-center">
                    {Math.min(inboxMessages.filter(message => !message.is_read).length, 9)}
                  </span>
                )}
              </button>
              <div className="w-9 h-9 rounded-full bg-[#063737] flex items-center justify-center">
                <span className="text-[#e8d5b0] text-sm font-semibold">A</span>
              </div>
            </div>
          </div>

          {/* Global success message */}
          {successMessage && (
            <div className="mb-5 flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 px-5 py-3.5">
              <span className="text-green-600 text-lg">✓</span>
              <p className="text-sm font-medium text-green-800">{successMessage}</p>
            </div>
          )}

          {/* Global error message */}
          {errorMessage && (
            <div className="mb-5 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-3.5">
              <span className="text-red-600 text-lg">✕</span>
              <p className="text-sm font-medium text-red-800">{errorMessage}</p>
              <button onClick={() => setErrorMessage('')} className="ml-auto text-red-400 hover:text-red-600 text-xs">Dismiss</button>
            </div>
          )}

          {tab === 'Dashboard' && (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-8">
                {stats.map(s => (
                  <div key={s.label} className="bg-white rounded-2xl border border-[#e8ddd5] p-4 sm:p-5 shadow-sm">
                    <p className="text-[10px] tracking-widest uppercase text-[#7a6a62] mb-2 font-medium">{s.label}</p>
                    <p className={`font-serif text-2xl sm:text-3xl ${s.color} mb-1 font-semibold`}>{s.value}</p>
                    <p className="text-xs text-[#9b7e55] font-medium">{s.change}</p>
                  </div>
                ))}
              </div>

              {/* Recent Orders */}
              <div className="bg-white rounded-2xl border border-[#e8ddd5] overflow-hidden shadow-sm">
                <div className="flex items-center justify-between px-6 py-5 border-b border-[#f0e8e0]">
                  <h2 className="font-serif text-xl text-[#1a2e2e] font-semibold">Recent Orders</h2>
                  <button
                    onClick={() => setTab('Orders')}
                    className="text-xs tracking-wider text-[#c9a96e] uppercase border-b border-[#c9a96e]/40 font-medium hover:text-[#b8924a]"
                  >
                    View All
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px]">
                    <thead>
                      <tr className="text-[10px] tracking-widest uppercase text-[#5a4a42] bg-[#faf6f1] font-semibold">
                        {['Order ID', 'Customer', 'Product', 'Amount', 'Payment', 'Status', 'Date'].map(h => (
                          <th key={h} className="text-left px-4 py-3 font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {orders.length === 0 && !ordersLoading && (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-[#7a6a62]">No orders yet.</td></tr>
                      )}
                      {orders.map((o, i) => (
                        <tr key={o.id} className={`border-t border-[#f0e8e0] text-sm ${i % 2 === 0 ? '' : 'bg-[#faf6f1]/50'}`}>
                          <td className="px-4 py-3 text-[#c9a96e] font-semibold">#{o.id}</td>
                          <td className="px-4 py-3 text-[#2d2018] font-medium">{o.customer_name}</td>
                          <td className="px-4 py-3 text-[#4a3828]">{o.product}</td>
                          <td className="px-4 py-3 font-semibold text-[#1a2e2e]">
                            ₹{Number(o.amount ?? o.total_amount ?? 0).toLocaleString('en-IN')}
                          </td>
                          <td className="px-4 py-3"><span className={`${paymentStatusColor(o.payment_status)} text-xs px-2.5 py-1 rounded-full font-medium`}>{o.payment_status}</span></td>
                          <td className="px-4 py-3"><span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColor[o.status] ?? 'bg-gray-50 text-gray-700'}`}>{o.status}</span></td>
                          <td className="px-4 py-3 text-[#7a6a62]">
                            {o.created_at
                              ? new Date(o.created_at).toLocaleDateString('en-IN')
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {tab === 'Inbox' && (
            <div className="space-y-4">
              <div className="rounded-3xl border border-border bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-[#f0e9e0] pb-4">
                  <div>
                    <p className="text-[10px] tracking-[0.28em] uppercase text-gold">Messages</p>
                    <h2 className="mt-2 font-serif text-2xl text-charcoal">Inbox</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTab('Dashboard')}
                    className="text-xs tracking-[0.22em] uppercase text-warm-gray hover:text-charcoal"
                  >
                    Back
                  </button>
                </div>

                <div className="space-y-3 pt-5">
                  {inboxLoading && (
                    <div className="rounded-2xl border border-[#f0e9e0] bg-ivory p-4 text-sm text-warm-gray">
                      Loading messages...
                    </div>
                  )}

                  {!inboxLoading && inboxError && (
                    <div className="rounded-2xl border border-[#f0e9e0] bg-ivory p-4 text-sm text-wine">
                      {inboxError}
                    </div>
                  )}

                  {!inboxLoading && !inboxError && inboxMessages.length === 0 && (
                    <div className="rounded-2xl border border-[#f0e9e0] bg-ivory p-4 text-sm text-warm-gray">
                      No customer messages yet.
                    </div>
                  )}

                  {!inboxLoading && !inboxError && inboxMessages.map(message => (
                    <div
                      key={message.id}
                      onClick={() => setSelectedInboxMessage(message)}
                      className={`flex cursor-pointer items-start justify-between gap-4 rounded-2xl border p-4 transition-colors ${message.is_read ? 'border-[#f0e9e0] bg-ivory' : 'border-champagne/40 bg-ivory'}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-charcoal text-xs font-semibold text-champagne">
                          {String(message.name || 'C').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-charcoal">{message.name}</p>
                          <p className="mt-1 text-[11px] tracking-[0.18em] uppercase text-warm-gray">{message.email} · {message.mobile}</p>
                          <p className="mt-2 text-sm text-warm-gray">{message.message}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-[10px] uppercase tracking-[0.2em] text-warm-gray">
                          {message.created_at ? new Date(message.created_at).toLocaleDateString('en-IN') : '—'}
                        </span>
                        {!message.is_read && (
                          <button
                            type="button"
                            onClick={event => {
                              event.stopPropagation()
                              void markMessageAsRead(message.id)
                            }}
                            className="text-[10px] uppercase tracking-[0.2em] text-gold hover:text-charcoal"
                          >
                            Mark as read
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedInboxMessage && (
                <div
                  className="fixed inset-0 z-[80] flex items-center justify-center bg-charcoal/50 p-4"
                  onClick={() => setSelectedInboxMessage(null)}
                >
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="inbox-message-title"
                    className="w-full max-w-2xl rounded-[28px] border border-border bg-cream p-6 shadow-[0_18px_40px_rgba(44,35,32,0.18)]"
                    onClick={event => event.stopPropagation()}
                  >
                    <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
                      <div>
                        <p className="text-[10px] tracking-[0.28em] uppercase text-gold">Customer Message</p>
                        <h3 id="inbox-message-title" className="mt-2 font-serif text-2xl text-charcoal">{selectedInboxMessage.name}</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedInboxMessage(null)}
                        className="text-xs tracking-[0.22em] uppercase text-warm-gray hover:text-charcoal"
                      >
                        Close
                      </button>
                    </div>

                    <div className="mt-6 space-y-5 text-sm text-charcoal">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <p className="text-[10px] tracking-[0.24em] uppercase text-warm-gray mb-1">Email</p>
                          <p>{selectedInboxMessage.email}</p>
                        </div>
                        <div>
                          <p className="text-[10px] tracking-[0.24em] uppercase text-warm-gray mb-1">Phone</p>
                          <p>{selectedInboxMessage.mobile}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] tracking-[0.24em] uppercase text-warm-gray mb-1">Date</p>
                        <p>{selectedInboxMessage.created_at ? new Date(selectedInboxMessage.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] tracking-[0.24em] uppercase text-warm-gray mb-2">Message</p>
                        <p className="whitespace-pre-wrap leading-7 text-gold">{selectedInboxMessage.message}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'Sarees' && (
            <div className="space-y-6">
               {/* EDIT SAREE FORM */}
    {editingProduct && (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-charcoal/60 p-4">
        <div role="dialog" aria-modal="true" aria-labelledby="edit-saree-title" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-border bg-cream p-6 shadow-[0_18px_40px_rgba(44,35,32,0.18)]">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-[10px] tracking-[0.32em] uppercase text-gold">Edit</p>
              <h2 id="edit-saree-title" className="font-serif text-2xl text-charcoal mt-2">Saree Details</h2>
            </div>
            <button onClick={() => setEditingProduct(null)} className="text-warm-gray hover:text-charcoal text-xs tracking-widest uppercase">Close</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <label className="block">
              <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Saree Name</span>
              <input
                value={editingProduct.name}
                onChange={event => setEditingProduct({ ...editingProduct, name: event.target.value })}
                className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">SKU</span>
              <input
                value={editingProduct.sku}
                onChange={event => setEditingProduct({ ...editingProduct, sku: event.target.value })}
                className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Category</span>
              <input
                value={editingProduct.category}
                onChange={event => setEditingProduct({ ...editingProduct, category: event.target.value })}
                className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Original Price</span>
              <input
                type="number"
                value={editingProduct.originalPrice ?? ''}
                onChange={event => setEditingProduct({ ...editingProduct, originalPrice: Number(event.target.value) })}
                className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Discount (%)</span>
              <input
                type="number"
                value={editingProduct.discount ?? ''}
                onChange={event => setEditingProduct({ ...editingProduct, discount: Number(event.target.value) })}
                className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Fabric</span>
              <input
                value={editingProduct.fabric}
                onChange={event => setEditingProduct({ ...editingProduct, fabric: event.target.value })}
                className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Color</span>
              <input
                value={editingProduct.color}
                onChange={event => setEditingProduct({ ...editingProduct, color: event.target.value })}
                className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Stock Quantity</span>
              <input
                type="number"
                value={editingProduct.stock ?? ''}
                onChange={event => setEditingProduct({ ...editingProduct, stock: Number(event.target.value) })}
                className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne"
              />
            </label>

            <label className="block md:col-span-2">
              <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Saree Photo</span>
              <div>
  <label className="mb-2 block text-sm font-medium text-warm-gray">
    Saree Photo
  </label>

  <input
    type="file"
    accept="image/*"
    onChange={e => {
      const file = e.target.files?.[0]
      if (!file) return

      const imageUrl = URL.createObjectURL(file)

      setEditingProduct({
        ...editingProduct,
        imageFile: file,
        image: imageUrl,
      })
    }}
    className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal"
  />

  {editingProduct.image && (
    <img
      src={editingProduct.image}
      alt="Saree preview"
      className="mt-3 h-32 w-28 rounded-xl object-cover border border-border"
    />
  )}
</div>
             
            </label>

            <div className="md:col-span-2">
              <label className="block">
                <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Product Description</span>
                <textarea
                  rows={4}
                  value={editingProduct.description ?? ''}
                  onChange={event => setEditingProduct({ ...editingProduct, description: event.target.value })}
                  className="w-full resize-none rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne"
                />
              </label>
            </div>

            {[
              ['Return & Exchange', 'returnExchange'],
              ['Manufactured By', 'manufacturedBy'],
              ['Marketed By', 'marketedBy'],
            ].map(([label, field]) => (
              <label key={label} className="block md:col-span-2">
                <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">{label}</span>
                <textarea
                  rows={field === 'returnExchange' ? 3 : 2}
                  value={String(editingProduct[field as keyof typeof editingProduct] ?? '')}
                  onChange={event =>
                    setEditingProduct({
                      ...editingProduct,
                      [field as keyof typeof editingProduct]: event.target.value,
                    })
                  }
                  className="w-full resize-none rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne"
                />
              </label>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm text-charcoal">
              <input
                type="checkbox"
                checked={editingProduct.isActive !== false}
                onChange={event => setEditingProduct({ ...editingProduct, isActive: event.target.checked })}
                className="accent-wine"
              />
              Visible in shop
            </label>
            <label className="flex items-center gap-2 text-sm text-charcoal">
              <input
                type="checkbox"
                checked={editingProduct.inStock}
                onChange={event => setEditingProduct({ ...editingProduct, inStock: event.target.checked })}
                className="accent-wine"
              />
              Available to buy (also needs stock above 0)
            </label>
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
            <button onClick={() => setEditingProduct(null)} className="text-xs tracking-[0.22em] uppercase text-warm-gray hover:text-charcoal">Cancel</button>
            <button onClick={updateSaree} className="rounded-full bg-charcoal px-6 py-3 text-[10px] tracking-[0.24em] uppercase text-champagne transition hover:bg-charcoal">Save Changes</button>
          </div>
        </div>
      </div>
    )}

              {showAddForm && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-charcoal/60 p-4">
                  <div role="dialog" aria-modal="true" aria-labelledby="add-saree-title" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-border bg-cream p-6 shadow-[0_18px_40px_rgba(44,35,32,0.18)]">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <p className="text-[10px] tracking-[0.32em] uppercase text-gold">Add New</p>
                      <h2 id="add-saree-title" className="font-serif text-2xl text-charcoal mt-2">Saree Details</h2>
                    </div>
                    <button onClick={() => setShowAddForm(false)} className="text-warm-gray hover:text-charcoal text-xs tracking-widest uppercase">Close</button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {[
                      ['Saree Name', 'name'], ['SKU', 'sku'], ['Category', 'category'], ['Price', 'price'],
                      ['Discount (%)', 'discount'], ['Fabric', 'fabric'], ['Color', 'color'],
                      ['Saree Length', 'length'], ['Blouse Included', 'blouse'], ['Occasion', 'occasion'], ['Stock Quantity', 'stock'],
                    ].map(([label, field]) => (
                      <label key={label} className="block">
                        <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">{label}</span>
                        <input value={String(newSaree[field as keyof typeof newSaree] ?? '')} onChange={event => updateSareeField(field as keyof typeof newSaree, event.target.value)} className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne" />
                      </label>
                    ))}

                    <label className="block md:col-span-2">
  <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">
    Saree Photos
  </span>

  <input
    type="file"
    accept="image/*"
    multiple
    onChange={event => handleSareePhotos(event.target.files)}
    className="w-full rounded-2xl border border-dashed border-champagne bg-white px-4 py-3 text-sm text-charcoal outline-none file:mr-4 file:rounded-full file:border-0 file:bg-cream file:px-4 file:py-2 file:text-xs file:text-charcoal"
  />

  {newSaree.images.length > 0 && (
    <div className="mt-3 flex flex-wrap gap-3">
      {newSaree.images.map((image, index) => (
        <img
          key={index}
          src={image}
          alt={`Selected saree ${index + 1}`}
          className="h-28 w-24 rounded-xl object-cover"
        />
      ))}
    </div>
  )}
</label>
                    

                    {[
                      ['Return & Exchange', 'returnExchange'],
                      ['Manufactured By', 'manufacturedBy'],
                      ['Marketed By', 'marketedBy'],
                    ].map(([label, field]) => (
                      <label key={label} className="block md:col-span-2">
                        <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">{label}</span>
                        <textarea
  rows={field === 'returnExchange' ? 3 : 2}
  value={String(newSaree[field as keyof typeof newSaree] ?? '')}
  onChange={event =>
    updateSareeField(
      field as keyof typeof newSaree,
      event.target.value
    )
  }
  className="w-full resize-none rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne"
/>
                      </label>
                    ))}

                    <div className="md:col-span-2 flex flex-wrap items-center gap-4 pt-2">
                      <label className="flex items-center gap-2 text-sm text-charcoal">
                        <input type="checkbox" defaultChecked className="accent-wine" />
                        Featured
                      </label>
                      <label className="flex items-center gap-2 text-sm text-charcoal">
                        <input type="checkbox" defaultChecked className="accent-wine" />
                        New Arrival
                      </label>
                    </div>
                  </div>

                  <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
                    <button onClick={() => setShowAddForm(false)} className="text-xs tracking-[0.22em] uppercase text-warm-gray hover:text-charcoal">Cancel</button>
                    <button onClick={saveSaree} className="rounded-full bg-charcoal px-6 py-3 text-[10px] tracking-[0.24em] uppercase text-champagne transition hover:bg-charcoal">Save Saree</button>
                  </div>
                  </div>
                </div>
              )}

              <div className="rounded-[28px] border border-border bg-white p-6">
                <div className="mb-5">
                  <p className="text-[10px] tracking-[0.32em] uppercase text-gold">Homepage Stories</p>
                  <h2 className="font-serif text-2xl text-charcoal mt-2">Upload Editorial Video</h2>
                  <p className="mt-1 text-sm text-warm-gray">Uploaded videos appear in the Festive Edit rail on the customer homepage.</p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
                  <label className="block">
                    <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Story Title</span>
                    <input value={newVideo.title} onChange={event => setNewVideo(current => ({ ...current, title: event.target.value }))}
                      className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none focus:border-champagne" />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Video File</span>
                    <input ref={videoInputRef} type="file" accept="video/mp4,video/webm,video/quicktime" onChange={event => handleEditorialVideo(event.target.files?.[0])}
                      className="w-full rounded-2xl border border-dashed border-champagne bg-white px-4 py-3 text-sm text-charcoal outline-none file:mr-4 file:rounded-full file:border-0 file:bg-cream file:px-4 file:py-2 file:text-xs file:text-charcoal" />
                  </label>
                  <button onClick={saveEditorialVideo} disabled={!newVideo.videoFile || videoUploading}
                    className="rounded-full bg-charcoal px-6 py-3 text-[10px] tracking-[0.24em] uppercase text-champagne transition hover:bg-charcoal disabled:cursor-not-allowed disabled:opacity-40">
                    {videoUploading ? 'Uploading...' : 'Add Video'}
                  </button>
                </div>
                <div className="mt-5 border-t border-border pt-4">
                  {videosLoading ? (
                    <p className="text-sm text-warm-gray">Loading videos...</p>
                  ) : videosError ? (
                    <p className="text-sm text-warm-gray">{videosError}</p>
                  ) : videos.length === 0 ? (
                    <p className="text-sm text-warm-gray">No videos uploaded.</p>
                  ) : (
                    <div className="divide-y divide-[#f0e9e0]">
                      {videos.map(video => (
                        <div key={video.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                          <span className="truncate text-charcoal">{video.title}</span>
                          <button
                            onClick={() => deleteEditorialVideo(video.id)}
                            disabled={deletingVideoId === video.id}
                            className="shrink-0 text-xs text-wine hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {deletingVideoId === video.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-[#e8ddd5] overflow-hidden shadow-sm">
                <div className="flex items-center justify-between px-6 py-5 border-b border-[#f0e8e0]">
                  <h2 className="font-serif text-xl text-[#1a2e2e] font-semibold">All Sarees</h2>
                  <button onClick={() => setShowAddForm(true)} className="bg-[#063737] hover:bg-[#063737]/90 text-[#e8d5b0] px-5 py-2.5 rounded-full text-xs font-semibold tracking-wider uppercase transition-colors shadow-sm">+ Add Saree</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px]">
                    <thead>
                      <tr className="text-[11px] tracking-wider uppercase text-[#3a2c26] bg-[#faf6f1] font-semibold border-b border-[#e8ddd5]">
                        {['Product', 'SKU', 'Category', 'Price', 'Stock', 'Status', 'Actions'].map(h => (
                          <th key={h} className="text-left px-4 py-3.5 font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {productsLoading ? (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-[#7a6a62]">Loading sarees...</td></tr>
                      ) : productsError ? (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-red-700">{productsError}</td></tr>
                      ) : products.length === 0 ? (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-[#7a6a62]">No sarees found in catalogue.</td></tr>
                      ) : products.map(p => (
                        <tr key={p.id} className="border-t border-[#f0e8e0] text-sm hover:bg-[#faf6f1]/50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-12 rounded-xl overflow-hidden bg-[#f0e9dd] flex-shrink-0 border border-[#e8ddd5]">
                               <img
  src={p.images?.find(image => image.trim()) || p.image}
  alt=""
  className="w-full h-full object-cover"
  onError={event => {
    const image = event.currentTarget
    if (p.image && image.src !== p.image) {
      image.src = p.image
      return
    }
    image.style.display = 'none'
  }}
/>
                              </div>
                              <span className="font-medium text-[#1a2e2e]">{p.name}</span>
                              {p.isActive === false && (
                                <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-800 font-medium">Hidden</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs font-mono font-medium text-[#5a4a42]">{p.sku || '—'}</td>
                          <td className="px-4 py-3 text-[#3a2e28] font-medium">{p.category}</td>
                          <td className="px-4 py-3 font-semibold text-[#1a2e2e]">₹{p.price.toLocaleString('en-IN')}</td>
                          <td className="px-4 py-3 font-medium text-[#1a2e2e]">{p.stock ?? 0}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${isPurchasable(p) ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                              {isPurchasable(p) ? 'In Stock' : 'Out of Stock'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => editSaree(p)}
                                className="text-xs font-semibold text-[#8b5a2b] hover:text-[#5a3a1b] hover:underline"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => confirmDeleteSaree(p)}
                                className="text-xs font-semibold text-red-700 hover:text-red-900 hover:underline"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === 'Inventory' && (
            <div className="bg-white rounded-2xl border border-[#e8ddd5] overflow-hidden shadow-sm">
              <div className="px-6 py-5 border-b border-[#f0e8e0]">
                <h2 className="font-serif text-xl text-[#1a2e2e] font-semibold">Inventory Management</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr className="text-[11px] tracking-wider uppercase text-[#3a2c26] bg-[#faf6f1] font-semibold border-b border-[#e8ddd5]">
                      {['Saree', 'SKU', 'Category', 'Stock', 'Price', 'Status'].map(h => (
                        <th key={h} className="text-left px-4 py-3.5 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {productsLoading ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-[#7a6a62]">Loading inventory...</td>
                      </tr>
                    ) : productsError ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-red-700">{productsError}</td>
                      </tr>
                    ) : products.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-[#7a6a62]">No inventory products found.</td>
                      </tr>
                    ) : products.map(p => {
                      const stock = p.stock ?? 0
                      const stockStatus = stock === 0 ? 'OUT OF STOCK' : stock <= 5 ? 'LOW STOCK' : 'IN STOCK'
                      const sc = {
                        'IN STOCK': 'bg-green-50 text-green-800 border border-green-200',
                        'LOW STOCK': 'bg-amber-50 text-amber-800 border border-amber-200',
                        'OUT OF STOCK': 'bg-red-50 text-red-800 border border-red-200'
                      }[stockStatus]
                      return (
                        <tr key={p.id} className="border-t border-[#f0e8e0] text-sm hover:bg-[#faf6f1]/50 transition-colors">
                          <td className="px-4 py-3 font-medium text-[#1a2e2e]">{p.name}</td>
                          <td className="px-4 py-3 text-xs font-mono font-medium text-[#5a4a42]">{p.sku || '—'}</td>
                          <td className="px-4 py-3 text-[#3a2e28] font-medium">{p.category}</td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              aria-label={`Stock for ${p.name}`}
                              value={inventoryStockDrafts[p.id] ?? String(stock)}
                              disabled={inventorySavingId !== null}
                              onChange={event => {
                                setInventoryStockDrafts(current => ({ ...current, [p.id]: event.target.value }))
                                setInventoryErrors(current => {
                                  const next = { ...current }
                                  delete next[p.id]
                                  return next
                                })
                              }}
                              onBlur={event => { void saveInventoryStock(p, event.currentTarget.value) }}
                              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
                              className="w-20 border border-[#d6c7bc] rounded-lg px-2.5 py-1 text-center text-sm font-semibold text-[#1a2e2e] outline-none focus:border-[#063737] disabled:opacity-60 bg-white"
                            />
                            {inventoryErrors[p.id] && <p role="alert" className="mt-1 max-w-40 text-xs text-red-700 font-medium">{inventoryErrors[p.id]}</p>}
                            {inventorySavingId === p.id && <p className="mt-1 text-xs text-[#8a6840]">Saving...</p>}
                          </td>
                          <td className="px-4 py-3 font-semibold text-[#1a2e2e]">₹{p.price.toLocaleString('en-IN')}</td>
                          <td className="px-4 py-3"><span className={`text-xs px-2.5 py-1 rounded-full font-medium ${sc}`}>{stockStatus}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'Orders' && (
            <div className="bg-white rounded-2xl border border-[#e8ddd5] overflow-hidden shadow-sm">
              <div className="px-6 py-5 border-b border-[#f0e8e0]">
                <h2 className="font-serif text-xl text-[#1a2e2e] font-semibold">All Orders</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px]">
                  <thead>
                    <tr className="text-[11px] tracking-wider uppercase text-[#3a2c26] bg-[#faf6f1] font-semibold border-b border-[#e8ddd5]">
                      {['Order ID', 'Customer', 'Product', 'Amount', 'Payment', 'Status', 'Date', 'Action'].map(h => (
                        <th key={h} className="text-left px-4 py-3.5 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
  {ordersLoading ? (
    <tr>
      <td
        colSpan={8}
        className="px-4 py-8 text-center text-sm text-[#7a6a62]"
      >
        Loading orders...
      </td>
    </tr>
  ) : ordersError ? (
    <tr>
      <td colSpan={8} role="alert" className="px-4 py-8 text-center text-sm text-red-700">
        {ordersError}
      </td>
    </tr>
  ) : orders.length === 0 ? (
    <tr>
      <td
        colSpan={8}
        className="px-4 py-8 text-center text-sm text-[#7a6a62]"
      >
        No orders found.
      </td>
    </tr>
  ) : (
    orders.map((o, i) => (
      <tr
        key={o.id}
        className={`border-t border-[#f0e8e0] text-sm hover:bg-[#faf6f1]/50 transition-colors ${
          i % 2 === 0 ? '' : 'bg-[#faf6f1]/30'
        }`}
      >
        <td className="px-4 py-3 text-[#8b5a2b] font-semibold">
          {o.order_number}
        </td>

        <td className="px-4 py-3 font-medium text-[#1a2e2e]">
          {o.customer_name}
        </td>

        <td className="px-4 py-3 text-[#3a2e28]">
        {o.items?.[0]
  ? `${o.items[0].product_name} × ${o.items[0].quantity}`
  : '—'}
        </td>

        <td className="px-4 py-3 font-semibold text-[#1a2e2e]">
         ₹{Number(o.total_amount ?? o.amount ?? 0).toLocaleString('en-IN')}
        </td>

        <td className="px-4 py-3">
          <span className={`${paymentStatusColor(o.payment_status)} text-xs px-2.5 py-1 rounded-full font-medium`}>
            {o.payment_status}
          </span>
        </td>

        <td className="px-4 py-3">
          <div className="min-w-36 space-y-1.5">
            <select
              value={o.status}
              disabled={orderStatusSavingId !== null}
              onChange={event => { void updateOrderStatus(o, event.target.value) }}
              className="w-full text-xs border border-[#d6c7bc] rounded-full px-3 py-1.5 outline-none font-medium text-[#1a2e2e] bg-white disabled:opacity-60"
            >
              {[
                'Pending',
                'Confirmed',
                'Packed',
                'Shipped',
                'Out for Delivery',
                'Delivered',
                'Cancelled',
              ].map(status => <option key={status}>{status}</option>)}
            </select>
            <input
              type="text"
              maxLength={1000}
              aria-label={`Optional status note for order ${o.order_number}`}
              placeholder="Optional note"
              value={orderStatusNotes[o.id] ?? ''}
              disabled={orderStatusSavingId !== null}
              onChange={event => setOrderStatusNotes(current => ({ ...current, [o.id]: event.target.value }))}
              className="w-full rounded-lg border border-[#d6c7bc] px-2.5 py-1 text-[11px] text-[#1a2e2e] outline-none focus:border-[#063737] disabled:opacity-60 bg-white"
            />
            {orderStatusSavingId === o.id && <p className="text-[11px] text-[#8a6840]">Saving...</p>}
            {orderStatusErrors[o.id] && <p role="alert" className="text-[11px] text-red-700 font-medium">{orderStatusErrors[o.id]}</p>}
          </div>
        </td>

        <td className="px-4 py-3 text-[#5a4a42]">
          {new Date(o.created_at).toLocaleDateString('en-IN')}
        </td>

        <td className="px-4 py-3">
          <button
            onClick={() => setSelectedOrder(o)}
            className="text-xs font-semibold text-[#063737] hover:underline px-2.5 py-1 rounded-full bg-[#063737]/10 hover:bg-[#063737]/20 transition-colors"
          >
            View
          </button>
        </td>
      </tr>
    ))
  )}
</tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'Customers' && (
            <div className="bg-white rounded-2xl border border-[#e8ddd5] overflow-hidden shadow-sm">
              <div className="px-6 py-5 border-b border-[#f0e8e0]">
                <h2 className="font-serif text-xl text-[#1a2e2e] font-semibold">Customers</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px]">
                  <thead>
                    <tr className="text-[11px] tracking-wider uppercase text-[#3a2c26] bg-[#faf6f1] font-semibold border-b border-[#e8ddd5]">
                      {['Name', 'Email', 'Phone', 'Orders', 'Joined', 'Status'].map(h => (
                        <th key={h} className="text-left px-4 py-3.5 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {customersLoading ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[#7a6a62]">Loading customers...</td></tr>
                    ) : customersError ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-red-700">{customersError}</td></tr>
                    ) : customers.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[#7a6a62]">No customers found.</td></tr>
                    ) : customers.map(c => (
                      <tr key={c.phone || c.email} className="border-t border-[#f0e8e0] text-sm hover:bg-[#faf6f1]/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-[#1a2e2e]">{c.name}</td>
                        <td className="px-4 py-3 text-[#5a4a42]">{c.email || '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#5a4a42]">{c.phone || '—'}</td>
                        <td className="px-4 py-3 font-medium text-[#1a2e2e]">{c.orders}</td>
                        <td className="px-4 py-3 text-[#5a4a42]">{c.joined_at ? new Date(c.joined_at).toLocaleDateString('en-IN') : '—'}</td>
                        <td className="px-4 py-3">{c.is_active === null ? '—' : <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${c.is_active ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>{c.is_active ? 'Active' : 'Inactive'}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'Categories' && (
            <div className="space-y-5">
              <div className="bg-white rounded-2xl border border-[#e8ddd5] p-5 sm:p-6 shadow-sm">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="font-serif text-xl text-[#1a2e2e] font-semibold">Category Library</h2>
                  <button onClick={addCategory} className="rounded-full bg-[#063737] hover:bg-[#063737]/90 px-5 py-2.5 text-xs font-semibold tracking-wider uppercase text-[#e8d5b0] transition-colors shadow-sm">+ Add Category</button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {categoriesLoading ? (
                    <p className="text-sm text-[#7a6a62]">Loading categories...</p>
                  ) : categoriesError ? (
                    <p className="text-sm text-red-700">{categoriesError}</p>
                  ) : categories.length === 0 ? (
                    <p className="text-sm text-[#7a6a62]">No categories found.</p>
                  ) : categories.map(category => (
                    <div key={category.id} className="rounded-2xl border border-[#e8ddd5] bg-[#faf6f1] p-5 shadow-sm">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div>
                          <p className="text-[10px] tracking-[0.24em] uppercase text-[#8b5a2b] font-semibold">Category</p>
                          <h3 className="font-serif text-2xl text-[#1a2e2e] font-semibold mt-1">{category.name}</h3>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] tracking-[0.16em] uppercase font-semibold ${category.is_active ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
                          {category.is_active ? 'Active' : 'Draft'}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed text-[#5a4a42]">{category.description || 'No description provided.'}</p>
                      <div className="mt-5 flex items-center justify-between border-t border-[#e8ddd5] pt-4 text-sm">
                        <span className="text-[#1a2e2e] font-medium">{category.products_count} products</span>
                        <div className="flex gap-3">
                          <button onClick={() => editCategory(category)} className="text-xs font-semibold text-[#8b5a2b] hover:text-[#5a3a1b] hover:underline">Edit</button>
                          <button onClick={() => deleteCategory(category)} className="text-xs font-semibold text-red-700 hover:text-red-900 hover:underline">Delete</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'Settings' && (
            <div className="space-y-5">
              {!adminSession && (
                <div role="alert" className="rounded-3xl border border-border bg-white p-6 text-sm text-wine">
                  Sign in with an administrator account to view or change store settings.
                  <button onClick={() => setPage('admin-login')} className="ml-2 text-gold hover:underline">Sign in</button>
                </div>
              )}
              {storeSettingsLoading && <p className="px-2 py-4 text-sm text-warm-gray">Loading store settings...</p>}
              {storeSettingsError && <p role="alert" className="rounded-3xl border border-border bg-white p-4 text-sm text-wine">{storeSettingsError}</p>}
              {storeSettingsMessage && <p role="status" className="rounded-3xl border border-border bg-white p-4 text-sm text-green-700">{storeSettingsMessage}</p>}

              <div className="rounded-[28px] border border-border bg-white p-5 sm:p-6">
                <div className="mb-5">
                  <p className="text-[10px] tracking-[0.32em] uppercase text-gold">Store</p>
                  <h2 className="mt-2 font-serif text-2xl text-charcoal">Store Information</h2>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Store Name</span>
                    <input value={storeSettings.store_name} onChange={event => setStoreSettings(current => ({ ...current, store_name: event.target.value }))} disabled={!adminSession || storeSettingsLoading} className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne disabled:opacity-60" />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Store Email</span>
                    <input type="email" value={storeSettings.store_email} onChange={event => setStoreSettings(current => ({ ...current, store_email: event.target.value }))} disabled={!adminSession || storeSettingsLoading} className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne disabled:opacity-60" />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Phone</span>
                    <input type="tel" value={storeSettings.store_phone} onChange={event => setStoreSettings(current => ({ ...current, store_phone: event.target.value }))} disabled={!adminSession || storeSettingsLoading} className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne disabled:opacity-60" />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Address</span>
                    <textarea rows={3} value={storeSettings.store_address} onChange={event => setStoreSettings(current => ({ ...current, store_address: event.target.value }))} disabled={!adminSession || storeSettingsLoading} className="w-full resize-none rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne disabled:opacity-60" />
                  </label>
                </div>
                {settingsActionButtons()}
              </div>

              <div className="rounded-[28px] border border-border bg-white p-5 sm:p-6">
                <div className="mb-5">
                  <p className="text-[10px] tracking-[0.32em] uppercase text-gold">Delivery</p>
                  <h2 className="mt-2 font-serif text-2xl text-charcoal">Shipping Settings</h2>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Shipping Fee</span>
                    <input type="number" min="0" step="0.01" value={storeSettings.shipping_fee} onChange={event => setStoreSettings(current => ({ ...current, shipping_fee: event.target.value }))} disabled={!adminSession || storeSettingsLoading} className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne disabled:opacity-60" />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Free-Shipping Threshold</span>
                    <input type="number" min="0" step="0.01" value={storeSettings.free_shipping_threshold} onChange={event => setStoreSettings(current => ({ ...current, free_shipping_threshold: event.target.value }))} disabled={!adminSession || storeSettingsLoading} className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne disabled:opacity-60" />
                  </label>
                </div>
                {settingsActionButtons()}
              </div>

              <div className="rounded-[28px] border border-border bg-white p-5 sm:p-6">
                <div className="mb-5">
                  <p className="text-[10px] tracking-[0.32em] uppercase text-gold">Customer Terms</p>
                  <h2 className="mt-2 font-serif text-2xl text-charcoal">Store Policies</h2>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {[
                    ['Return Policy', 'return_policy'],
                    ['Shipping Policy', 'shipping_policy'],
                    ['Privacy Policy', 'privacy_policy'],
                    ['Terms & Conditions', 'terms_policy'],
                  ].map(([label, field]) => (
                    <label key={field} className="block">
                      <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">{label}</span>
                      <textarea rows={5} value={String(storeSettings[field as keyof StoreSettingsForm] ?? '')} onChange={event => setStoreSettings(current => ({ ...current, [field]: event.target.value }))} disabled={!adminSession || storeSettingsLoading} className="w-full resize-y rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne disabled:opacity-60" />
                    </label>
                  ))}
                </div>
                {settingsActionButtons()}
              </div>

              <div className="rounded-[28px] border border-border bg-white p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-[10px] tracking-[0.32em] uppercase text-gold">Secure Access</p>
                    <h2 className="mt-2 font-serif text-2xl text-charcoal">Admin Account</h2>
                    {adminSession ? (
                      <div className="mt-3 text-sm text-warm-gray">
                        <p className="text-charcoal">{adminSession.user.name}</p>
                        <p>{adminSession.user.email}</p>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-warm-gray">No administrator is signed in.</p>
                    )}
                  </div>
                  {adminSession && <button onClick={onLogout} className="rounded-full bg-charcoal px-5 py-3 text-[10px] tracking-[0.24em] uppercase text-champagne transition hover:bg-charcoal">Sign Out</button>}
                </div>
              </div>
            </div>
          )}

          {tab === 'Offers' && (
            <div className="space-y-5">
              <div className="bg-white rounded-2xl border border-[#e8ddd5] p-5 sm:p-6 shadow-sm">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="font-serif text-xl text-[#1a2e2e] font-semibold">Offer Center</h2>
                  <button onClick={openAddOffer} className="rounded-full bg-[#063737] hover:bg-[#063737]/90 px-5 py-2.5 text-xs font-semibold tracking-wider uppercase text-[#e8d5b0] transition-colors shadow-sm">+ Add Offer</button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {offersLoading ? (
                    <p className="text-sm text-[#7a6a62]">Loading offers...</p>
                  ) : offersError ? (
                    <p className="text-sm text-red-700">{offersError}</p>
                  ) : offers.length === 0 ? (
                    <p className="text-sm text-[#7a6a62]">No offers found.</p>
                  ) : offers.map(offer => (
                    <div key={offer.id} className="rounded-2xl border border-[#e8ddd5] bg-[#faf6f1] p-5 shadow-sm">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <span className="rounded-full bg-wine/10 border border-wine/20 px-2.5 py-1 text-[10px] tracking-[0.18em] uppercase text-wine font-semibold">{offer.type}</span>
                        <span className="text-[10px] tracking-[0.18em] uppercase text-[#8b5a2b] font-semibold">{offer.status}</span>
                      </div>
                      <h3 className="font-serif text-2xl text-[#1a2e2e] font-semibold">{offer.title}</h3>
                      <p className="mt-2 text-xl font-semibold text-[#8b5a2b]">{offer.value}</p>
                      <p className="mt-2 text-sm leading-relaxed text-[#5a4a42]">{offer.description}</p>
                      <div className="mt-5 flex items-center justify-between border-t border-[#e8ddd5] pt-4 text-sm">
                        <span className="text-[#1a2e2e] font-medium">{offer.status}</span>
                        <div className="flex gap-3">
                          <button onClick={() => openEditOffer(offer)} className="text-xs font-semibold text-[#8b5a2b] hover:text-[#5a3a1b] hover:underline">Edit</button>
                          <button onClick={() => openDeleteOffer(offer)} className="text-xs font-semibold text-red-700 hover:text-red-900 hover:underline">Delete</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!['Dashboard', 'Sarees', 'Inventory', 'Orders', 'Customers', 'Categories', 'Offers', 'Settings', 'Inbox'].includes(tab) && (
            <div className="bg-white rounded-2xl border border-[#e8ddd5] p-16 text-center shadow-sm">
              <p className="font-serif text-2xl text-[#1a2e2e] font-semibold mb-2">{tab}</p>
              <p className="text-[#7a6a62] font-light">This section is coming soon.</p>
            </div>
          )}
        </div>

        {successMessage && (
          <div className="fixed bottom-6 right-6 z-[9999] flex items-center gap-3 rounded-xl bg-wine px-6 py-4 text-white shadow-lg">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-wine">
              ✓
            </div>

            <span className="font-medium">
              {successMessage}
            </span>
          </div>
        )}

      </main>

      {categoryDialog && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-charcoal/60 p-4"
          onClick={() => { if (!categoryActionLoading) setCategoryDialog(null) }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-dialog-title"
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[28px] border border-border bg-cream p-6 shadow-[0_18px_40px_rgba(44,35,32,0.18)]"
            onClick={event => event.stopPropagation()}
          >
            <p className="text-[10px] tracking-[0.32em] uppercase text-gold">
              {categoryDialog === 'delete' ? 'Confirm' : categoryDialog === 'edit' ? 'Edit' : 'New'}
            </p>
            <h2 id="category-dialog-title" className="mt-2 font-serif text-2xl text-charcoal">
              {categoryDialog === 'delete' ? 'Delete Category' : categoryDialog === 'edit' ? 'Edit Category' : 'Add Category'}
            </h2>

            {categoryDialog === 'delete' ? (
              <p className="mt-4 text-sm leading-relaxed text-warm-gray">
                Are you sure you want to delete <span className="font-medium text-charcoal">{selectedCategory?.name}</span>?
              </p>
            ) : (
              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Category Name</span>
                  <input
                    autoFocus
                    value={categoryForm.name}
                    onChange={event => setCategoryForm(current => ({ ...current, name: event.target.value }))}
                    className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Description</span>
                  <textarea
                    rows={3}
                    value={categoryForm.description}
                    onChange={event => setCategoryForm(current => ({ ...current, description: event.target.value }))}
                    className="w-full resize-none rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne"
                  />
                </label>
              </div>
            )}

            {categoryActionError && (
              <p role="alert" className="mt-4 whitespace-pre-line text-sm text-wine">{categoryActionError}</p>
            )}

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-5">
              <button
                type="button"
                onClick={() => setCategoryDialog(null)}
                disabled={categoryActionLoading}
                className="text-xs tracking-[0.22em] uppercase text-warm-gray hover:text-charcoal disabled:opacity-40"
              >
                Cancel
              </button>
              {categoryDialog === 'delete' ? (
                <button
                  type="button"
                  onClick={confirmDeleteCategory}
                  disabled={categoryActionLoading}
                  className="rounded-full bg-wine px-6 py-3 text-[10px] tracking-[0.24em] uppercase text-white transition hover:bg-wine disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {categoryActionLoading ? 'Deleting...' : 'Confirm Delete'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={saveCategory}
                  disabled={categoryActionLoading}
                  className="rounded-full bg-charcoal px-6 py-3 text-[10px] tracking-[0.24em] uppercase text-champagne transition hover:bg-charcoal disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {categoryActionLoading ? 'Saving...' : categoryDialog === 'edit' ? 'Save Changes' : 'Save'}
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {offerDialog && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-charcoal/60 p-4"
          onClick={() => { if (!offerActionLoading) setOfferDialog(null) }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="offer-dialog-title"
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[28px] border border-border bg-cream p-6 shadow-[0_18px_40px_rgba(44,35,32,0.18)]"
            onClick={event => event.stopPropagation()}
          >
            <p className="text-[10px] tracking-[0.32em] uppercase text-gold">
              {offerDialog === 'delete' ? 'Confirm' : offerDialog === 'edit' ? 'Edit' : 'New'}
            </p>
            <h2 id="offer-dialog-title" className="mt-2 font-serif text-2xl text-charcoal">
              {offerDialog === 'delete' ? 'Delete Offer' : offerDialog === 'edit' ? 'Edit Offer' : 'Add Offer'}
            </h2>

            {offerDialog === 'delete' ? (
              <p className="mt-4 text-sm leading-relaxed text-warm-gray">
                Are you sure you want to delete <span className="font-medium text-charcoal">{selectedOffer?.title}</span>?
              </p>
            ) : (
              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Title</span>
                  <input value={offerForm.title} onChange={event => setOfferForm(current => ({ ...current, title: event.target.value }))} className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne" />
                </label>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Type</span>
                    <select value={offerForm.type} onChange={event => setOfferForm(current => ({ ...current, type: event.target.value as OfferType }))} className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none focus:border-champagne">
                      {(['Discount', 'Coupon', 'Banner', 'Promotion'] as const).map(type => <option key={type}>{type}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Offer Value or Code</span>
                    <input value={offerForm.value} onChange={event => setOfferForm(current => ({ ...current, value: event.target.value }))} className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne" />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Description</span>
                  <textarea rows={3} value={offerForm.description} onChange={event => setOfferForm(current => ({ ...current, description: event.target.value }))} className="w-full resize-none rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none transition focus:border-champagne" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-[10px] tracking-[0.2em] uppercase text-warm-gray">Status</span>
                  <select value={offerForm.status} onChange={event => setOfferForm(current => ({ ...current, status: event.target.value as OfferStatus }))} className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-charcoal outline-none focus:border-champagne">
                    {(['Active', 'Scheduled', 'Paused'] as const).map(status => <option key={status}>{status}</option>)}
                  </select>
                </label>
                <fieldset className="rounded-2xl border border-border p-4">
                  <legend className="px-1 text-[10px] tracking-[0.2em] uppercase text-warm-gray">Coupon code (optional)</legend>
                  <p className="mb-3 text-xs text-warm-gray">Customers enter this code at checkout. Leave it empty for a banner-only offer. It works only while the offer is Active.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs text-warm-gray">Code</span>
                      <input value={offerForm.code} maxLength={30} placeholder="FESTIVE10" onChange={event => setOfferForm(current => ({ ...current, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') }))} className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm uppercase outline-none focus:border-champagne" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-warm-gray">Discount type</span>
                      <select value={offerForm.discount_type} disabled={!offerForm.code} onChange={event => setOfferForm(current => ({ ...current, discount_type: event.target.value as 'percent' | 'flat' }))} className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-champagne disabled:opacity-50">
                        <option value="percent">Percent off (%)</option>
                        <option value="flat">Flat amount off (₹)</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-warm-gray">{offerForm.discount_type === 'percent' ? 'Percent (1–90)' : 'Amount (₹)'}</span>
                      <input type="number" min="0" step="0.01" value={offerForm.discount_value} disabled={!offerForm.code} onChange={event => setOfferForm(current => ({ ...current, discount_value: event.target.value }))} className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-champagne disabled:opacity-50" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-warm-gray">Minimum order (₹, optional)</span>
                      <input type="number" min="0" step="1" value={offerForm.min_order_amount} disabled={!offerForm.code} onChange={event => setOfferForm(current => ({ ...current, min_order_amount: event.target.value }))} className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-champagne disabled:opacity-50" />
                    </label>
                  </div>
                </fieldset>
              </div>
            )}

            {offerActionError && <p role="alert" className="mt-4 whitespace-pre-line text-sm text-wine">{offerActionError}</p>}

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-5">
              <button type="button" onClick={() => setOfferDialog(null)} disabled={offerActionLoading} className="text-xs tracking-[0.22em] uppercase text-warm-gray hover:text-charcoal disabled:opacity-40">Cancel</button>
              {offerDialog === 'delete' ? (
                <button type="button" onClick={confirmDeleteOffer} disabled={offerActionLoading} className="rounded-full bg-wine px-6 py-3 text-[10px] tracking-[0.24em] uppercase text-white transition hover:bg-wine disabled:cursor-not-allowed disabled:opacity-40">{offerActionLoading ? 'Deleting...' : 'Confirm Delete'}</button>
              ) : (
                <button type="button" onClick={saveOffer} disabled={offerActionLoading} className="rounded-full bg-charcoal px-6 py-3 text-[10px] tracking-[0.24em] uppercase text-champagne transition hover:bg-charcoal disabled:cursor-not-allowed disabled:opacity-40">{offerActionLoading ? 'Saving...' : offerDialog === 'edit' ? 'Save Changes' : 'Save'}</button>
              )}
            </div>
          </section>
        </div>
      )}

      {selectedOrder && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-charcoal/60 p-3 sm:p-6"
          onClick={() => setSelectedOrder(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-details-title"
            className="my-auto w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-ivory shadow-[0_18px_50px_rgba(30,21,16,0.28)]"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border bg-white px-5 py-5 sm:px-7">
              <div className="min-w-0">
                <p className="text-[10px] tracking-[0.24em] uppercase text-gold">Order details</p>
                <h2 id="order-details-title" className="mt-1 break-all font-serif text-2xl text-charcoal">
                  {selectedOrder.order_number}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="shrink-0 rounded-full border border-border px-3 py-2 text-xs text-warm-gray transition hover:border-[#4a3a32] hover:text-charcoal"
                aria-label="Close order details"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 gap-x-8 gap-y-5 px-5 py-6 sm:grid-cols-2 sm:px-7">
              <div>
                <p className="text-[10px] tracking-[0.18em] uppercase text-warm-gray">Customer</p>
                <p className="mt-1 break-words text-sm font-medium text-charcoal">{selectedOrder.customer_name || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] tracking-[0.18em] uppercase text-warm-gray">Phone</p>
                <p className="mt-1 break-words text-sm text-charcoal">{selectedOrder.customer_phone || '—'}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-[10px] tracking-[0.18em] uppercase text-warm-gray">Delivery address</p>
                <p className="mt-1 break-words text-sm leading-relaxed text-charcoal">{selectedOrder.customer_address || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] tracking-[0.18em] uppercase text-warm-gray">Order amount</p>
                <p className="mt-1 text-lg font-medium text-charcoal">
                  ₹{Number(selectedOrder.total_amount ?? selectedOrder.amount ?? 0).toLocaleString('en-IN')}
                </p>
                {selectedOrder.subtotal_amount != null && (
                  <p className="mt-1 text-xs text-warm-gray">
                    Items ₹{Number(selectedOrder.subtotal_amount).toLocaleString('en-IN')}
                    {Number(selectedOrder.discount_amount) > 0 && ` − ₹${Number(selectedOrder.discount_amount).toLocaleString('en-IN')} (${selectedOrder.coupon_code})`}
                    {` + shipping ₹${Number(selectedOrder.shipping_amount ?? 0).toLocaleString('en-IN')}`}
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] tracking-[0.18em] uppercase text-warm-gray">Payment</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs ${paymentStatusColor(selectedOrder.payment_status)}`}>
                    {selectedOrder.payment_status || '—'}
                  </span>
                  <select
                    aria-label="Change payment status"
                    value={selectedOrder.payment_status || 'Pending'}
                    disabled={orderStatusSavingId === selectedOrder.id}
                    onChange={event => { void updateOrderPayment(selectedOrder, event.target.value) }}
                    className="rounded-full border border-border bg-white px-3 py-1 text-xs text-charcoal outline-none focus:border-champagne disabled:opacity-60"
                  >
                    {['Pending', 'Paid', 'Failed', 'Refunded'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                {orderStatusErrors[selectedOrder.id] && (
                  <p role="alert" className="mt-1 text-xs text-wine">{orderStatusErrors[selectedOrder.id]}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <p className="text-[10px] tracking-[0.18em] uppercase text-warm-gray">Order status</p>
                <span className="mt-1 inline-flex rounded-full bg-cream px-3 py-1 text-xs text-wine">
                  {selectedOrder.status || '—'}
                </span>
              </div>
              <div className="sm:col-span-2 border-t border-border pt-5">
                <h3 className="font-serif text-lg text-charcoal">Status history</h3>
                {[...(selectedOrder.status_history ?? [])]
                  .sort((first, second) => new Date(first.created_at).getTime() - new Date(second.created_at).getTime())
                  .map((event: { id: number; status: string; note?: string | null; created_at: string }) => (
                    <div key={event.id} className="mt-4 border-l-2 border-champagne pl-4">
                      <p className="text-sm font-medium text-charcoal">{event.status}</p>
                      <p className="mt-1 text-xs text-gold">{new Date(event.created_at).toLocaleString('en-IN')}</p>
                      {event.note && <p className="mt-1 text-sm text-warm-gray">{event.note}</p>}
                    </div>
                  ))}
                {(!selectedOrder.status_history || selectedOrder.status_history.length === 0) && (
                  <p className="mt-3 text-sm text-warm-gray">No status history recorded.</p>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Delete Saree Confirmation Modal */}
      {deleteConfirmProduct && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!deleteInProgress) {
              setDeleteConfirmProduct(null)
              setDeleteActionError('')
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-saree-title"
            className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl border border-[#e8ddd5] bg-[#faf6f1] p-6 sm:p-7 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </div>
              <div>
                <p className="text-[10px] tracking-[0.28em] uppercase text-red-700 font-semibold">Confirm Deletion</p>
                <h2 id="delete-saree-title" className="font-serif text-2xl text-[#1a2e2e] font-semibold mt-0.5">
                  Delete Saree
                </h2>
              </div>
            </div>

            <div className="mt-5 rounded-2xl bg-white border border-[#e8ddd5] p-4 flex items-center gap-3.5 shadow-sm">
              {deleteConfirmProduct.image ? (
                <img
                  src={deleteConfirmProduct.image}
                  alt=""
                  className="h-16 w-14 shrink-0 rounded-xl object-cover border border-[#e8ddd5]"
                />
              ) : (
                <div className="h-16 w-14 shrink-0 rounded-xl bg-[#f0e8e0] flex items-center justify-center text-[10px] text-[#7a6a62]">
                  No photo
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-[#1a2e2e] text-sm truncate">{deleteConfirmProduct.name}</p>
                <p className="text-xs text-[#5a4a42] mt-0.5">SKU: <span className="font-semibold text-[#1a2e2e]">{deleteConfirmProduct.sku || '—'}</span> · {deleteConfirmProduct.category}</p>
                <p className="text-xs text-[#9b7e55] font-semibold mt-0.5">₹{deleteConfirmProduct.price.toLocaleString('en-IN')}</p>
              </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-[#5a4a42]">
              Are you sure you want to permanently delete <strong className="text-[#1a2e2e]">"{deleteConfirmProduct.name}"</strong>? This will remove the saree from the store catalogue and Neon database. <span className="text-red-700 font-medium">This action cannot be undone.</span>
            </p>

            {deleteActionError && (
              <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-800 font-medium leading-relaxed" role="alert">
                {deleteActionError}
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-[#e8ddd5] pt-5">
              <button
                type="button"
                onClick={() => {
                  setDeleteConfirmProduct(null)
                  setDeleteActionError('')
                }}
                disabled={deleteInProgress}
                className="rounded-full px-5 py-2.5 text-xs font-semibold tracking-wider uppercase text-[#5a4a42] hover:bg-[#ede3da] hover:text-[#1a2e2e] disabled:opacity-40 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteSaree}
                disabled={deleteInProgress}
                className="rounded-full bg-red-700 px-6 py-2.5 text-xs font-semibold tracking-wider uppercase text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-sm"
              >
                {deleteInProgress ? 'Deleting...' : 'Delete Saree'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function Footer({ setPage }: { setPage: (p: Page) => void }) {
  const storeSettings = useContext(StoreSettingsContext)
  const footerAddress = storeSettings.store_address.trim() || CONTACT_ADDRESS
  const footerPhone = storeSettings.store_phone.trim() || DEFAULT_CONTACT_PHONE
  const footerEmail = storeSettings.store_email.trim() || DEFAULT_CONTACT_EMAIL

  return (
    <footer className="bg-charcoal text-white mt-0">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-10 md:py-16">
        {/* Mobile footer layout (< md) */}
        <div className="md:hidden flex flex-col gap-8">
          {/* Brand block */}
          <div>
            <img
              src={yaaleLogoJpeg}
              alt="Yaale, Soulful Weaves"
              className="mb-3 h-[clamp(72px,22vw,110px)] w-[clamp(72px,22vw,110px)] object-contain object-left"
            />
            <p className="text-white/50 text-xs sm:text-sm font-light leading-relaxed">
              Handpicked sarees from India's finest weavers. Crafted for moments that matter.
            </p>
            <address className="mt-2.5 text-xs sm:text-sm text-white/60 font-light leading-relaxed not-italic">
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(footerAddress)}`} target="_blank" rel="noreferrer">
                {footerAddress.split(',').map((line, index, lines) => (
                  <span key={`${line}-${index}`}>
                    {line.trim()}
                    {index < lines.length - 1 && <><br /></>}
                  </span>
                ))}
              </a>
            </address>
            <div className="mt-2 space-y-0.5 text-xs sm:text-sm text-white/60 font-light">
              <p>{footerPhone}</p>
              <p>{footerEmail}</p>
            </div>
            <button
              onClick={() => setPage('admin-login')}
              className="mt-3 inline-flex items-center text-[10px] tracking-[0.25em] uppercase text-champagne hover:text-[#f2d8a3] transition-colors"
            >
              Admin
            </button>
          </div>

          {/* Shop and Customer Care 2-col grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 max-[360px]:grid-cols-1">
            <div>
              <p className="text-champagne text-xs tracking-widest uppercase mb-3 font-medium">Shop</p>
              <div className="flex flex-col gap-2.5">
                {['Soft Silk Sarees', 'Cotton Sarees', 'Semi Silk Sarees', 'New Arrivals'].map(l => (
                  <button key={l} onClick={() => setPage('shop')} className="text-left text-xs sm:text-sm text-white/50 hover:text-champagne transition-colors font-light py-0.5">{l}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-champagne text-xs tracking-widest uppercase mb-3 font-medium">Customer Care</p>
              <div className="flex flex-col gap-2.5">
                {['Contact Us', 'Order Tracking', 'Shipping Policy', 'No Refund Policy'].map(l => (
                  <button key={l} onClick={() => setPage('contact')} className="text-left text-xs sm:text-sm text-white/50 hover:text-champagne transition-colors font-light py-0.5">{l}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Follow Us */}
          <div>
            <p className="text-champagne text-xs tracking-widest uppercase mb-3 font-medium">Follow Us</p>
            <div className="flex flex-wrap gap-4">
              <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-xs sm:text-sm text-white/50 hover:text-champagne transition-colors font-light">Instagram</a>
              <a href="https://wa.me/919150130613" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-xs sm:text-sm text-white/50 hover:text-champagne transition-colors font-light">WhatsApp</a>
            </div>
          </div>
        </div>

        {/* Desktop footer layout (>= md - 100% untouched) */}
        <div className="hidden md:grid md:grid-cols-4 gap-10">
          <div>
            <img src={yaaleLogoJpeg} alt="Yaale, Soulful Weaves" className="mb-4 h-[136px] w-[136px] object-contain object-left" />
            <p className="text-white/50 text-sm font-light leading-relaxed">Handpicked sarees from India's finest weavers. Crafted for moments that matter.</p>
            <address className="mt-3 text-sm text-white/60 font-light leading-relaxed not-italic">
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(footerAddress)}`} target="_blank" rel="noreferrer">
                {footerAddress.split(',').map((line, index, lines) => (
                  <span key={`${line}-${index}`}>
                    {line.trim()}
                    {index < lines.length - 1 && <><br /></>}
                  </span>
                ))}
              </a>
            </address>
            <div className="mt-3 space-y-1 text-sm text-white/60 font-light">
              <p>{footerPhone}</p>
              <p>{footerEmail}</p>
            </div>
            <button onClick={() => setPage('admin-login')} className="mt-4 inline-flex items-center text-[10px] tracking-[0.25em] uppercase text-champagne hover:text-[#f2d8a3] transition-colors">
              Admin
            </button>
          </div>
          <div>
            <p className="text-champagne text-xs tracking-widest uppercase mb-5">Shop</p>
            <div className="space-y-3">
              {['Soft Silk Sarees', 'Cotton Sarees', 'Semi Silk Sarees', 'New Arrivals'].map(l => (
                <button key={l} onClick={() => setPage('shop')} className="block text-sm text-white/50 hover:text-champagne transition-colors font-light">{l}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-champagne text-xs tracking-widest uppercase mb-5">Customer Care</p>
            <div className="space-y-3">
              {['Contact Us', 'Order Tracking', 'Shipping Policy', 'No Refund Policy'].map(l => (
                <button key={l} onClick={() => setPage('contact')} className="block text-sm text-white/50 hover:text-champagne transition-colors font-light">{l}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-champagne text-xs tracking-widest uppercase mb-5">Follow Us</p>
            <div className="flex flex-col gap-3">
              <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-champagne transition-colors font-light">Instagram</a>
              <a href="https://wa.me/919150130613" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-champagne transition-colors font-light">WhatsApp</a>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-charcoal px-5 sm:px-8 py-5 md:py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-center">
          <p className="text-white/30 text-xs">© 2026 Yaale. All Rights Reserved.</p>
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-2">
            {['Privacy Policy', 'Terms', 'Shipping', 'No Refund Policy'].map(l => (
              <button key={l} className="text-white/30 text-xs hover:text-white/60 transition-colors">{l}</button>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}

// ── Icon primitives ────────────────────────────────────────────────────────
function HeartIcon({ filled = false, size = 18 }: { filled?: boolean, size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}
function BagIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  )
}
function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}
function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}
function XIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
function EnvelopeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" />
      <path d="m5 7 7 5 7-5" />
    </svg>
  )
}
function ArrowRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  )
}
function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  )
}

// ── Root App ───────────────────────────────────────────────────────────────
const ADMIN_SESSION_KEY = 'yaale_admin_session'
const CUSTOMER_SESSION_KEY = 'yaale_customer_session'
const CART_STORAGE_KEY = 'yaale_cart'

export default function App() {
  const [page, setPageState] = useState<Page>('home')
  const [shopFilter, setShopFilter] = useState<ShopCategoryFilter>('ALL')
  const [adminSession, setAdminSession] = useState<AdminAuthSession | null>(() => {
    // Check localStorage first (Remember Me), then sessionStorage (current session)
    const stored = localStorage.getItem(ADMIN_SESSION_KEY) ?? sessionStorage.getItem(ADMIN_SESSION_KEY)
    if (!stored) return null

    try {
      return JSON.parse(stored) as AdminAuthSession
    } catch {
      localStorage.removeItem(ADMIN_SESSION_KEY)
      sessionStorage.removeItem(ADMIN_SESSION_KEY)
      return null
    }
  })
  const [customerSession, setCustomerSession] = useState<CustomerAuthSession | null>(() => {
    const storedSession = sessionStorage.getItem(CUSTOMER_SESSION_KEY)
    if (!storedSession) return null

    try {
      return JSON.parse(storedSession) as CustomerAuthSession
    } catch {
      sessionStorage.removeItem(CUSTOMER_SESSION_KEY)
      return null
    }
  })
  const [products, setProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [productsError, setProductsError] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [videos, setVideos] = useState<EditorialVideo[]>([])
  const [videosLoading, setVideosLoading] = useState(true)
  const [videosError, setVideosError] = useState('')
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const storedCart = localStorage.getItem(CART_STORAGE_KEY)
      if (!storedCart) return []

      const parsedCart: unknown = JSON.parse(storedCart)
      if (!Array.isArray(parsedCart)) return []

      return parsedCart
        // Older saved carts may hold string ids ("9") from before ids were normalised.
        .map(item => (item && typeof item === 'object' && typeof (item as any).id === 'string' && /^\d+$/.test((item as any).id))
          ? { ...item, id: Number((item as any).id) }
          : item)
        .filter((item): item is CartItem => {
        if (typeof item !== 'object' || item === null) return false

        const cartItem = item as Partial<CartItem>
        return typeof cartItem.id === 'number'
          && Number.isInteger(cartItem.qty)
          && (cartItem.qty ?? 0) > 0
          && typeof cartItem.name === 'string'
          && typeof cartItem.price === 'number'
          && Number.isFinite(cartItem.price)
          && typeof cartItem.category === 'string'
          && typeof cartItem.image === 'string'
          && typeof cartItem.fabric === 'string'
          && typeof cartItem.color === 'string'
          && typeof cartItem.sku === 'string'
          && typeof cartItem.inStock === 'boolean'
      })
    } catch {
      return []
    }
  })
  const [lastOrderNumber, setLastOrderNumber] = useState('')
  const [lastPlacedOrder, setLastPlacedOrder] = useState<PlacedOrder | null>(null)
  const [lastOrderNotice, setLastOrderNotice] = useState<string | undefined>(undefined)
  const [wishlist, setWishlist] = useState<number[]>([])
  const [wishlistLoading, setWishlistLoading] = useState(true)
  const [wishlistToast, setWishlistToast] = useState<string | null>(null)
  const [storeSettings, setStoreSettings] = useState<StoreSettingsForm>(EMPTY_STORE_SETTINGS)


  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart))
    } catch (error) {
      console.error('Unable to persist cart:', error)
    }
  }, [cart])

  // Pages that need a signed-in customer. Visiting one while signed out goes to
  // sign-in first, then returns to that page after a successful sign-in.
  const pageAfterSignInRef = useRef<Page | null>(null)
  const guardPage = (requested: Page, signedIn: boolean): Page => {
    if (!signedIn && (requested === 'wishlist' || requested === 'checkout')) {
      pageAfterSignInRef.current = requested
      return 'account-sign-in'
    }
    return requested
  }

  // A product id from the URL waits here until the product list has loaded.
  const pendingProductIdRef = useRef<number | null>(null)
  const [pendingProductTick, setPendingProductTick] = useState(0)

  const setPage = (nextPage: Page) => {
    const destination = guardPage(nextPage, !!customerSession)
    if (destination === page) return
    window.history.pushState({ page: destination }, '', `#${destination}`)
    setPageState(destination)
  }

  useEffect(() => {
    const loadPublicStoreSettings = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/settings`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        })
        const data = await response.json().catch(() => ({}))

        if (!response.ok) throw new Error(data.message || 'Unable to load store settings.')
        setStoreSettings(storeSettingsFromApi(data))
      } catch (error) {
        console.error('Error loading public store settings:', error)
      }
    }

    void loadPublicStoreSettings()
  }, [])

  useEffect(() => {
    if (!customerSession) return

    let active = true
    void fetch(`${API_BASE_URL}/api/customer/user`, {
      headers: { Authorization: `Bearer ${customerSession.token}`, Accept: 'application/json' },
    }).then(response => {
      if (active && (response.status === 401 || response.status === 403)) {
        sessionStorage.removeItem(CUSTOMER_SESSION_KEY)
        setCustomerSession(null)
      }
    }).catch(() => undefined)

    return () => { active = false }
  }, [customerSession?.token])

  // Sign out when a login token expires (12 hours), instead of letting every
  // request fail silently. Also runs on page load for a token saved earlier.
  useEffect(() => {
    const expiresAt = tokenExpiryMs(adminSession?.token)
    if (!adminSession || expiresAt === null) return

    const remaining = expiresAt - Date.now()
    if (remaining <= 0) {
      expireAdminSession()
      return
    }

    // setTimeout cannot wait longer than ~24.8 days; tokens last 12 hours.
    const timer = window.setTimeout(() => { expireAdminSession() }, Math.min(remaining, 2 ** 31 - 1))
    return () => window.clearTimeout(timer)
  }, [adminSession?.token])

  useEffect(() => {
    const expiresAt = tokenExpiryMs(customerSession?.token)
    if (!customerSession || expiresAt === null) return

    const remaining = expiresAt - Date.now()
    if (remaining <= 0) {
      expireCustomerSession()
      return
    }

    const timer = window.setTimeout(() => { expireCustomerSession() }, Math.min(remaining, 2 ** 31 - 1))
    return () => window.clearTimeout(timer)
  }, [customerSession?.token])

  const handleAdminLoginSuccess = (session: AdminAuthSession, rememberMe: boolean) => {
    if (rememberMe) {
      localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session))
      sessionStorage.removeItem(ADMIN_SESSION_KEY)
    } else {
      sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session))
      localStorage.removeItem(ADMIN_SESSION_KEY)
    }
    setAdminSession(session)
    setPage('admin-dashboard')
  }

  // Save hearts tapped while signed out to the account, then forget the local copy.
  const mergeGuestWishlist = async (token: string) => {
    const guestIds = getGuestWishlist()
    if (guestIds.length === 0) return

    await Promise.all(guestIds.map(productId =>
      fetch(`${API_BASE_URL}/api/wishlist`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId }),
      }).catch(() => undefined) // 409 "already in wishlist" and removed products are fine to skip
    ))
    setGuestWishlist([])
  }

  const handleCustomerLoginSuccess = async (session: CustomerAuthSession) => {
    setWishlist([])
    setWishlistLoading(true)
    await mergeGuestWishlist(session.token)
    sessionStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify(session))
    // Setting the session reloads the wishlist from the server, now including the merged items.
    setCustomerSession(session)

    const returnTo = pageAfterSignInRef.current
    pageAfterSignInRef.current = null
    const destination = returnTo ?? 'account'
    window.history.pushState({ page: destination }, '', `#${destination}`)
    setPageState(destination)
  }

  const openCustomerOrder = (orderNumber: string) => {
    setLastOrderNumber(orderNumber)
    setPage('order-tracking')
  }

  const handleCustomerProfileUpdated = (user: CustomerAuthSession['user']) => {
    if (!customerSession) return

    const updatedSession = { ...customerSession, user }
    sessionStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify(updatedSession))
    setCustomerSession(updatedSession)
  }

  const logoutCustomer = async () => {
    const session = customerSession
    sessionStorage.removeItem(CUSTOMER_SESSION_KEY)
    setWishlist([])
    setWishlistLoading(false)
    setCustomerSession(null)
    setPage('account-sign-in')

    // Node JWT authentication is stateless; session cleared above
  }

  // Expired logins are cleared quietly; the visitor is only moved to a sign-in page
  // when they are on a page that needs the login.
  // These run from timers set hours earlier, so they read the current page from a
  // ref; the `page` variable captured at that time would be out of date.
  const expireAdminSession = () => {
    localStorage.removeItem(ADMIN_SESSION_KEY)
    sessionStorage.removeItem(ADMIN_SESSION_KEY)
    setAdminSession(null)
    if (pageRef.current === 'admin-dashboard') {
      window.history.pushState({ page: 'admin-login' }, '', '#admin-login')
      setPageState('admin-login')
    }
  }

  const expireCustomerSession = () => {
    sessionStorage.removeItem(CUSTOMER_SESSION_KEY)
    setCustomerSession(null)
    if (pageRef.current === 'account') {
      window.history.pushState({ page: 'account-sign-in' }, '', '#account-sign-in')
      setPageState('account-sign-in')
    }
    // wishlist and checkout redirect to sign-in through guardPage.
  }

  const logoutAdmin = async () => {
    // Node JWT authentication is stateless; session cleared below

    localStorage.removeItem(ADMIN_SESSION_KEY)
    sessionStorage.removeItem(ADMIN_SESSION_KEY)
    setAdminSession(null)
    setPage('admin-login')
  }

  const addToCart = (p: Product, qty = 1) => {
    if (!isPurchasable(p)) return
    // Never put more in the bag than is in stock; the order would be rejected anyway.
    const limit = p.stock ?? Infinity
    setCart(c => {
      const ex = c.find(i => i.id === p.id)
      return ex
        ? c.map(i => i.id === p.id ? { ...i, ...p, qty: Math.min(limit, i.qty + qty) } : i)
        : [...c, { ...p, qty: Math.min(limit, qty) }]
    })
  }

  const syncWishlistButtons = (productId: number, active: boolean) => {
    const buttons = document.querySelectorAll<HTMLButtonElement>(`.wishlist-btn[data-product-id="${productId}"]`)
    buttons.forEach(button => {
      button.dataset.active = String(active)
      button.setAttribute('aria-label', active ? 'Remove from wishlist' : 'Add to wishlist')
      button.classList.toggle('is-active', active)
      const icon = button.querySelector('svg')
      if (icon) {
        icon.setAttribute('fill', active ? '#7A0C32' : 'none')
        icon.setAttribute('stroke', '#fff')
      }
    })
  }

  const showWishlistToast = (message: string) => {
    setWishlistToast(message)
    window.clearTimeout((showWishlistToast as any)._timer)
    ;(showWishlistToast as any)._timer = window.setTimeout(() => setWishlistToast(null), 1800)
  }

  const getGuestWishlist = () => {
    try {
      const raw = window.localStorage.getItem('yaale_guest_wishlist')
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : []
    } catch (error) {
      console.error('Unable to read guest wishlist:', error)
      return []
    }
  }

  const setGuestWishlist = (ids: number[]) => {
    try {
      window.localStorage.setItem('yaale_guest_wishlist', JSON.stringify(ids))
    } catch (error) {
      console.error('Unable to persist guest wishlist:', error)
    }
  }

  const toggleWishlist = async (id: number) => {
    const isWishlisted = wishlist.includes(id)
    const nextState = !isWishlisted

    syncWishlistButtons(id, nextState)
    setWishlist(prev => nextState ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter(item => item !== id))

    if (!customerSession) {
      const guestWishlist = getGuestWishlist()
      const nextGuestWishlist = guestWishlist.includes(id)
        ? guestWishlist.filter(item => item !== id)
        : [...guestWishlist, id]
      setGuestWishlist(nextGuestWishlist)
      showWishlistToast(nextState ? 'Added to wishlist' : 'Removed')
      return
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${customerSession.token}`,
      Accept: 'application/json',
    }

    try {
      const response = await fetch(
        nextState
          ? `${API_BASE_URL}/api/wishlist`
          : `${API_BASE_URL}/api/wishlist/${id}`,
        {
          method: nextState ? 'POST' : 'DELETE',
          headers: nextState ? { ...headers, 'Content-Type': 'application/json' } : headers,
          body: nextState ? JSON.stringify({ product_id: id }) : undefined,
        }
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        console.error('Wishlist request failed:', response.status, response.statusText, errorText)
        throw new Error(errorText || 'Wishlist request failed')
      }

      if (nextState) {
        setWishlist(prev => (prev.includes(id) ? prev : [...prev, id]))
      } else {
        setWishlist(prev => prev.filter(item => item !== id))
      }

      showWishlistToast(nextState ? 'Added to wishlist' : 'Removed')
    } catch (error) {
      console.error('Wishlist error:', error)
      syncWishlistButtons(id, isWishlisted)
      setWishlist(prev => isWishlisted ? [...new Set([...prev, id])] : prev.filter(item => item !== id))
    }
  }

  useEffect(() => {
    const handleWishlistDelegation = (event: Event) => {
      const target = event.target as HTMLElement | null
      const button = target?.closest('.wishlist-btn') as HTMLButtonElement | null
      if (!button) return
      event.preventDefault()
      event.stopPropagation()
      const productId = Number(button.dataset.productId)
      if (!Number.isFinite(productId)) return
      void toggleWishlist(productId)
    }

    document.addEventListener('click', handleWishlistDelegation, true)
    return () => document.removeEventListener('click', handleWishlistDelegation, true)
  }, [toggleWishlist])

  // Read "#page" or "#product/<id>" from the URL. The product id lets a refreshed
  // or shared product link open the right saree.
  const parseHash = (): { page: Page, productId: number | null } => {
    const validPages: Page[] = ['home', 'shop', 'product', 'cart', 'wishlist', 'account', 'account-sign-in', 'checkout', 'order-success', 'order-tracking', 'about', 'contact', 'admin-login', 'admin-dashboard', 'reset-password']
    const [rawPage, rawId] = window.location.hash.slice(1).split('?')[0].split('/')
    const requested = validPages.includes(rawPage as Page) ? rawPage as Page : 'home'
    const productId = requested === 'product' && /^\d+$/.test(rawId ?? '') ? Number(rawId) : null
    return { page: requested, productId }
  }

  const customerSessionRef = useRef(customerSession)
  customerSessionRef.current = customerSession
  const pageRef = useRef(page)
  pageRef.current = page

  useEffect(() => {
    const { page: requestedPage, productId } = parseHash()
    const startingPage = guardPage(requestedPage, !!customerSession)
    if (productId !== null) pendingProductIdRef.current = productId
    setPageState(startingPage)
    window.history.replaceState({ page: startingPage }, '', productId !== null && startingPage === 'product' ? `#product/${productId}` : `#${startingPage}`)

    const handlePopState = () => {
      const { page: previousPage, productId: previousProductId } = parseHash()
      if (previousProductId !== null) {
        pendingProductIdRef.current = previousProductId
        setPendingProductTick(t => t + 1)
      }
      // Read the session through a ref: this listener is registered once and would
      // otherwise keep the session from the first render.
      setPageState(guardPage(previousPage, !!customerSessionRef.current))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Keep the open saree's id in the URL.
  useEffect(() => {
    if (page === 'product' && selectedProduct && window.location.hash !== `#product/${selectedProduct.id}`) {
      window.history.replaceState({ page }, '', `#product/${selectedProduct.id}`)
    }
  }, [page, selectedProduct?.id])

const refreshProducts = async () => {
  setProductsLoading(true)
  setProductsError('')

  try {
    const response = await fetch(`${API_BASE_URL}/api/products`)
    if (!response.ok) {
      throw new Error('Failed to fetch products')
    }

    const data = await response.json()
    if (!Array.isArray(data)) {
      throw new Error('The products response was invalid')
    }

    const mappedProducts: Product[] = data.map(mapApiProduct)

    setProducts(mappedProducts)
  } catch (error) {
    console.error('Error fetching products:', error)
    setProductsError(error instanceof Error ? error.message : 'Failed to fetch products')
    throw error
  } finally {
    setProductsLoading(false)
  }
}

useEffect(() => {
  void refreshProducts().catch(() => {})
}, [customerSession])

useEffect(() => {
  const loadVideos = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/videos`)
      if (!response.ok) {
        throw new Error('Unable to load videos.')
      }

      const data = await response.json()
      if (!Array.isArray(data)) {
        throw new Error('Unable to load videos.')
      }

      const storageUrl = (path: string | null | undefined) => {
        if (!path) return ''
        if (/^https?:\/\//i.test(path)) return path
        return `${API_BASE_URL}/storage/${path.replace(/^\/+/, '')}`
      }

      const mappedVideos: EditorialVideo[] = data.map((video: {
        id: number
        title: string
        video: string
        poster?: string | null
      }) => ({
        id: video.id,
        title: video.title,
        src: storageUrl(video.video),
        poster: storageUrl(video.poster),
      }))

      setVideos(current => {
        const fetchedIds = new Set(mappedVideos.map(video => video.id))
        return [...mappedVideos, ...current.filter(video => !fetchedIds.has(video.id))]
      })
    } catch (error) {
      console.error('Error fetching videos:', error)
      setVideosError(error instanceof Error ? error.message : 'Unable to load videos.')
    } finally {
      setVideosLoading(false)
    }
  }

  loadVideos()
}, [])

useEffect(() => {
  let active = true

  const loadWishlist = async () => {
    if (!customerSession) {
      // Signed out: show the hearts saved in this browser (merged on sign-in).
      setWishlist(getGuestWishlist())
      setWishlistLoading(false)
      return
    }

    setWishlistLoading(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api/wishlist`, {
        headers: {
          Authorization: `Bearer ${customerSession.token}`,
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error('Failed to load wishlist')
      }

      const data = await response.json()
      if (active) setWishlist(data.map((item: { product_id: number }) => Number(item.product_id)))
    } catch (error) {
      console.error('Failed to load wishlist:', error)
    } finally {
      if (active) setWishlistLoading(false)
    }
  }

  void loadWishlist()
  return () => { active = false }
}, [customerSession?.token])

useEffect(() => {
  if (!customerSession && (page === 'wishlist' || page === 'checkout')) setPage(page)
}, [customerSession, page])

// Open the saree named in the URL once products have loaded.
useEffect(() => {
  const id = pendingProductIdRef.current
  if (id === null || productsLoading) return
  pendingProductIdRef.current = null
  setSelectedProduct(products.find(p => p.id === id) ?? null)
}, [products, productsLoading, pendingProductTick])

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }) }, [page])

  const isAdmin = page === 'admin-login' || page === 'admin-dashboard'

  return (
    <ProductsContext.Provider value={{ products, setProducts, productsLoading, productsError, refreshProducts, videos, setVideos, videosLoading, videosError, setVideosError }}>
      <StoreSettingsContext.Provider value={storeSettings}>
      <div className="min-h-screen">
      {!isAdmin && (
        <>
          <AnnouncementBar />
          <Header page={page} setPage={setPage} cartCount={cart.reduce((s, i) => s + i.qty, 0)} wishlistCount={wishlist.length} customerSession={customerSession} onCustomerLogout={logoutCustomer} />
        </>
      )}

      <div key={page} className="page-transition">
        {page === 'home' && ( <HomePage setPage={setPage} setSelectedProduct={setSelectedProduct}
    onAdd={addToCart}
    onWishlist={toggleWishlist}
    wishlist={wishlist}
    onCategorySelect={setShopFilter}
  />
)}
        {page === 'shop' && (
  <ShopPage
    setPage={setPage}
    setSelectedProduct={setSelectedProduct}
    onAdd={addToCart}
    onWishlist={toggleWishlist}
    wishlist={wishlist}
    filter={shopFilter}
    setFilter={setShopFilter}
  />
)}
{page === 'product' && (
  <ProductPage
    setPage={setPage}
    product={selectedProduct}
    onAdd={addToCart}
    onWishlist={toggleWishlist}
    wishlist={wishlist}
  />
)}
        {page === 'cart' && <CartPage cart={cart} setCart={setCart} setPage={setPage} />}
        {page === 'wishlist' && <WishlistPage wishlist={wishlist} isLoading={wishlistLoading} onWishlist={toggleWishlist} onAdd={addToCart} setPage={setPage} setSelectedProduct={setSelectedProduct} />}
        {page === 'checkout' && (
          <CheckoutPage
            setPage={setPage}
            cart={cart}
            setCart={setCart}
            setLastOrderNumber={setLastOrderNumber}
            onOrderPlaced={(order, notice) => { setLastPlacedOrder(order); setLastOrderNotice(notice) }}
            customerToken={customerSession?.token ?? null}
            customerEmail={customerSession?.user.email}
          />
        )}
        {page === 'order-success' && (
  <OrderSuccessPage
    setPage={setPage}
    orderNumber={lastOrderNumber}
    placedOrder={lastPlacedOrder}
    notice={lastOrderNotice}
    customerToken={customerSession?.token ?? null}
    customerEmail={customerSession?.user.email}
    onPaid={() => {
      setLastPlacedOrder(current => current ? { ...current, payment_status: 'Paid' } : current)
      setLastOrderNotice(undefined)
    }}
  />
)}
        {page === 'order-tracking' && <OrderTrackingPage setPage={setPage} orderNumber={lastOrderNumber} customerSession={customerSession} />}
        {(page === 'account' || page === 'account-sign-in') && (
          <AccountPage
            setPage={setPage}
            customerSession={customerSession}
            onCustomerLoginSuccess={handleCustomerLoginSuccess}
            onCustomerProfileUpdated={handleCustomerProfileUpdated}
            onCustomerLogout={logoutCustomer}
            onTrackOrder={openCustomerOrder}
            isSignIn={page === 'account-sign-in'}
          />
        )}
        {page === 'about' && <AboutPage setPage={setPage} />}
        {page === 'reset-password' && <ResetPasswordPage setPage={setPage} />}
        {page === 'contact' && <ContactPage setPage={setPage} storeSettings={storeSettings} />}
        {page === 'admin-login' && <AdminLoginPage setPage={setPage} onLoginSuccess={handleAdminLoginSuccess} />}
        {page === 'admin-dashboard' && <AdminDashboardPage setPage={setPage} adminSession={adminSession} onLogout={logoutAdmin} globalStoreSettings={storeSettings} setGlobalStoreSettings={setStoreSettings} />}
      </div>
      </div>
      </StoreSettingsContext.Provider>
    </ProductsContext.Provider>
  )
}
