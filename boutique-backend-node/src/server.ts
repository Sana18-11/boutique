
import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import fs from "fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import path from "path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import crypto from "crypto";
import sharp from "sharp";
import {
  frontendUrl,
  isMailConfigured,
  sendOrderPlacedEmail,
  sendOrderStatusEmail,
  sendPasswordResetEmail,
  type OrderEmailData,
} from "./mailer.js";
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  isWebhookConfigured,
  razorpayKeyId,
  refundRazorpayPayment,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./razorpay.js";


dotenv.config();

/**
 * Parse a FormData boolean field that may arrive as a real boolean
 * (JSON body) or as the strings "true"/"false"/"1"/"0" (multipart FormData).
 * Returns the boolean value, or `undefined` when the field was not sent at all.
 */
function parseBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined; // unrecognised string — caller will handle validation
}

const app = express();

const storageRoot = path.resolve(process.cwd(), "public", "storage");

/** Error whose message is safe to show to the client with the given HTTP status. */
class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Upload allow-lists. The saved file's extension is chosen from the MIME type,
 * never from the uploaded file name, and both must agree, so a file such as
 * `x.html` labelled `image/png` is rejected instead of being served as HTML.
 */
const IMAGE_TYPES: Record<string, { ext: string; names: string[] }> = {
  "image/jpeg": { ext: ".jpg", names: [".jpg", ".jpeg"] },
  "image/png": { ext: ".png", names: [".png"] },
  "image/webp": { ext: ".webp", names: [".webp"] },
  "image/gif": { ext: ".gif", names: [".gif"] },
};

const VIDEO_TYPES: Record<string, { ext: string; names: string[] }> = {
  "video/mp4": { ext: ".mp4", names: [".mp4"] },
  "video/webm": { ext: ".webm", names: [".webm"] },
  "video/quicktime": { ext: ".mov", names: [".mov"] },
};

const uniqueFileName = (ext: string) =>
  `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;

const createUploader = (
  dir: string,
  types: Record<string, { ext: string; names: string[] }>,
  kind: string,
  limits: multer.Options["limits"]
) => {
  fs.mkdirSync(dir, { recursive: true });

  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, dir),
      filename: (_req, file, cb) => cb(null, uniqueFileName(types[file.mimetype].ext)),
    }),
    limits,
    fileFilter: (_req, file, cb) => {
      const type = types[file.mimetype];
      const originalExt = path.extname(file.originalname).toLowerCase();

      if (!type || !type.names.includes(originalExt)) {
        return cb(
          new HttpError(
            422,
            `Only ${Object.values(types)
              .flatMap((t) => t.names)
              .join(", ")} ${kind} files are allowed.`
          )
        );
      }

      cb(null, true);
    },
  });
};

const productUploadDir = path.join(storageRoot, "products");
const videoUploadDir = path.join(storageRoot, "videos");

const uploadProductImages = createUploader(productUploadDir, IMAGE_TYPES, "image", {
  fileSize: 5 * 1024 * 1024,
  files: 10,
});

const uploadVideoFile = createUploader(videoUploadDir, VIDEO_TYPES, "video", {
  fileSize: 1024 * 1024 * 1024, // 1GB limit
  files: 1,
});

/**
 * Resolve a stored relative path (e.g. "products/abc.jpg") to an absolute
 * path, or null when it would point outside the storage folder.
 */
const resolveStoragePath = (relativePath: string): string | null => {
  const resolved = path.resolve(storageRoot, relativePath.replace(/^\/+/, "").replace(/^storage\//i, ""));
  return resolved.startsWith(storageRoot + path.sep) ? resolved : null;
};

/** Best-effort removal of a locally stored file. URLs and paths outside storage are ignored. */
const removeStoredFile = (storedPath: string | null | undefined) => {
  if (typeof storedPath !== "string" || !storedPath.trim() || /^https?:\/\//i.test(storedPath)) {
    return;
  }

  const absolutePath = resolveStoragePath(storedPath.trim());

  if (absolutePath) {
    fs.promises.unlink(absolutePath).catch(() => {
      // Already gone or locked: nothing else to do.
    });
  }
};

/**
 * Process uploaded product images with sharp:
 * - flatten transparency onto #F4EAE2
 * - resize with fit: 'cover', position: 'attention' to 900x1200 (3:4)
 * - save as WebP quality ~80
 */
const normalizeProductImage = async (filePath: string): Promise<string> => {
  const parsed = path.parse(filePath);
  const webpFileName = `${parsed.name}.webp`;
  const webpFilePath = path.join(parsed.dir, webpFileName);

  const inputBuffer = await fs.promises.readFile(filePath);
  await sharp(inputBuffer)
    .flatten({ background: "#F4EAE2" })
    .resize(900, 1200, { fit: "cover", position: "attention" })
    .webp({ quality: 80 })
    .toFile(webpFilePath);

  if (filePath !== webpFilePath && fs.existsSync(filePath)) {
    await fs.promises.unlink(filePath).catch(() => {});
  }

  return `products/${webpFileName}`;
};

/** Delete files multer saved for this request if the request ends in an error response. */
const cleanupUploadsOnFailure = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  res.on("finish", () => {
    if (res.statusCode < 400) return;

    const files: Express.Multer.File[] = [];
    if (req.file) files.push(req.file);
    if (Array.isArray(req.files)) files.push(...req.files);

    for (const file of files) {
      fs.promises.unlink(file.path).catch(() => {});
    }
  });

  next();
};

/** Simple fixed-window, in-memory rate limiter keyed by client IP. */
const rateLimit = ({ windowMs, max, message }: { windowMs: number; max: number; message: string }) => {
  const hits = new Map<string, { count: number; resetAt: number }>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs).unref();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;

    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000).toString());
      return res.status(429).json({ message });
    }

    next();
  };
};

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many sign-in attempts. Please try again in a few minutes.",
});

const contactRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many messages sent. Please try again later.",
});

/** Input limits matching the VARCHAR(255) columns in the schema. */
const MAX_SHORT_TEXT = 255;
const MAX_LONG_TEXT = 5000;
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns the name of the first field whose trimmed string value exceeds its limit, if any. */
const findTooLongField = (fields: Record<string, [unknown, number]>): string | null => {
  for (const [name, [value, limit]] of Object.entries(fields)) {
    if (typeof value === "string" && value.trim().length > limit) {
      return name;
    }
  }

  return null;
};

/** Checks address fields against the Address table's column sizes; returns an error message or null. */
const validateAddressLengths = (fields: {
  name?: unknown;
  phone?: unknown;
  addressLine?: unknown;
  city?: unknown;
  state?: unknown;
  pinCode?: unknown;
  landmark?: unknown;
}): string | null => {
  const tooLong = findTooLongField({
    name: [fields.name, 255],
    phone: [fields.phone, 20],
    "address line": [fields.addressLine, 500],
    city: [fields.city, 100],
    state: [fields.state, 100],
    "pin code": [fields.pinCode, 20],
    landmark: [fields.landmark, 255],
  });

  return tooLong ? `The ${tooLong} is too long.` : null;
};

/** Days from order to expected delivery (same as the Laravel backend and the frontend). */
const DELIVERY_TIMELINE_DAYS = 6;

/** Shipping defaults used when the admin has not set them in store settings. */
const DEFAULT_SHIPPING_FEE = 250;
const DEFAULT_FREE_SHIPPING_THRESHOLD = 10000;

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

export const prisma = new PrismaClient({
  adapter,
});

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  })
);
if (process.env.TRUST_PROXY) {
  // Behind a reverse proxy, use X-Forwarded-For so rate limits see the real client IP.
  app.set("trust proxy", process.env.TRUST_PROXY === "true" ? true : process.env.TRUST_PROXY);
}

/**
 * CORS: only the origins listed in CORS_ORIGINS (comma-separated) may call the API.
 * When it is unset, local development origins are allowed outside production.
 */
const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const defaultAllowedOrigins = [
  "https://boutique-qu1z.vercel.app",
  "https://boutique.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:8443",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8443",
];

const isProduction = process.env.NODE_ENV === "production";

app.use(
  cors({
    origin: (origin, callback) => {
      // Requests without an Origin header (curl, server-to-server, same-origin GETs).
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin) || defaultAllowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      try {
        const parsed = new URL(origin);
        if (
          parsed.hostname.endsWith(".vercel.app") ||
          parsed.hostname === "localhost" ||
          parsed.hostname === "127.0.0.1"
        ) {
          return callback(null, true);
        }
      } catch {
        // ignore invalid URL
      }

      // Development only: this computer, plus private Wi-Fi/LAN addresses
      // (10.x, 172.16–31.x, 192.168.x) so phones on the same network can test.
      if (
        allowedOrigins.length === 0 &&
        !isProduction &&
        /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin)
      ) {
        return callback(null, true);
      }

      callback(null, false);
    },
    credentials: true,
  })
);
// ── Order helpers shared by checkout, payments, cancellation and admin ─────────

type TxClient = Prisma.TransactionClient;

/** Statuses a customer may still cancel from (before the order is packed/shipped). */
const CUSTOMER_CANCELLABLE_STATUSES = ["Pending", "Confirmed"];

/** Unpaid online orders are cancelled after this long so their stock is released. */
const UNPAID_ORDER_TIMEOUT_MINUTES = 30;

/**
 * Move an order to Cancelled and return its stock — once. Returns false when it
 * was already cancelled (e.g. two cancels at the same time), so stock is never
 * returned twice.
 */
const cancelOrderAndRestock = async (
  tx: TxClient,
  orderId: bigint,
  changedBy: bigint | null,
  note: string
): Promise<boolean> => {
  const { count } = await tx.order.updateMany({
    where: { id: orderId, status: { not: "Cancelled" } },
    data: { status: "Cancelled" },
  });

  if (count !== 1) return false;

  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { productId: true, quantity: true },
  });

  for (const item of items) {
    await tx.product.updateMany({
      where: { id: item.productId },
      data: { stock: { increment: item.quantity } },
    });
  }

  await tx.orderStatusHistory.create({
    data: { orderId, changedBy, status: "Cancelled", note },
  });

  return true;
};

type OrderWithDetails = Prisma.OrderGetPayload<{ include: { items: true; statusHistory: true } }>;

/** Price breakdown fields shared by every order response. */
const orderMoneyFields = (order: Prisma.OrderGetPayload<object>) => ({
  subtotal_amount: order.subtotalAmount?.toString() ?? null,
  shipping_amount: order.shippingAmount?.toString() ?? null,
  discount_amount: order.discountAmount?.toString() ?? null,
  coupon_code: order.couponCode,
});

/** Full order as the API returns it (customer, tracking and admin views). */
const formatOrder = (order: OrderWithDetails) => ({
  id: order.id.toString(),
  order_number: order.orderNumber,
  customer_name: order.customerName,
  customer_phone: order.customerPhone,
  customer_address: order.customerAddress,
  ...orderMoneyFields(order),
  total_amount: order.totalAmount.toString(),
  amount: order.totalAmount.toString(),
  status: order.status,
  payment_status: order.paymentStatus,
  expected_delivery_date: order.expectedDeliveryDate,
  created_at: order.createdAt,
  updated_at: order.updatedAt,
  can_cancel: CUSTOMER_CANCELLABLE_STATUSES.includes(order.status),
  items: order.items.map((item) => ({
    id: item.id.toString(),
    order_id: item.orderId.toString(),
    product_id: item.productId.toString(),
    product_name: item.productName,
    quantity: item.quantity,
    price: item.price.toString(),
  })),
  status_history: [...order.statusHistory]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((history) => ({
      id: history.id.toString(),
      order_id: history.orderId.toString(),
      changed_by: history.changedBy?.toString() ?? null,
      status: history.status,
      note: history.note,
      created_at: history.createdAt,
      updated_at: history.updatedAt,
    })),
});

const orderDetailsInclude = {
  items: true,
  statusHistory: { orderBy: { createdAt: "desc" as const } },
};

/** Refund a cancelled order that was paid through Razorpay, and record it. */
const refundIfPaidOnline = async (orderId: bigint) => {
  const order = await prisma.order.findUnique({ where: { id: orderId } });

  if (!order || order.paymentStatus !== "Paid" || !order.razorpayPaymentId) return;

  try {
    await refundRazorpayPayment(order.razorpayPaymentId, Math.round(order.totalAmount.toNumber() * 100));
    await prisma.order.update({ where: { id: orderId }, data: { paymentStatus: "Refunded" } });
  } catch (error) {
    // The order stays cancelled and Paid, which shows the admin a refund is still owed.
    console.error(`Refund for order ${order.orderNumber} failed:`, error);
  }
};

/** Data for order emails, plus the customer's email address. */
const loadOrderForEmail = async (orderId: bigint): Promise<{ to: string; data: OrderEmailData } | null> => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, user: { select: { email: true } } },
  });

  if (!order?.user?.email) return null;

  return {
    to: order.user.email,
    data: {
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      totalAmount: order.totalAmount.toString(),
      status: order.status,
      paymentStatus: order.paymentStatus,
      items: order.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        price: item.price.toString(),
      })),
    },
  };
};

const emailOrderPlaced = async (orderId: bigint) => {
  const loaded = await loadOrderForEmail(orderId).catch(() => null);
  if (loaded) await sendOrderPlacedEmail(loaded.to, loaded.data);
};

const emailOrderStatus = async (orderId: bigint, note: string | null) => {
  const loaded = await loadOrderForEmail(orderId).catch(() => null);
  if (loaded) await sendOrderStatusEmail(loaded.to, loaded.data, note);
};

/**
 * Record a successful Razorpay payment. Idempotent: the checkout callback and
 * the webhook may both report the same payment. Returns the order id when this
 * call is the one that marked it paid.
 */
const markRazorpayOrderPaid = async (razorpayOrderId: string, razorpayPaymentId: string): Promise<bigint | null> => {
  const order = await prisma.order.findUnique({ where: { razorpayOrderId } });
  if (!order) return null;

  const { count } = await prisma.order.updateMany({
    where: { id: order.id, paymentStatus: { not: "Paid" } },
    data: { paymentStatus: "Paid", razorpayPaymentId },
  });

  if (count !== 1) return null;

  // Paid after the unpaid-order timeout already cancelled it: refund rather than
  // keep money for an order whose stock was released.
  if (order.status === "Cancelled") {
    await refundRazorpayPayment(razorpayPaymentId, Math.round(order.totalAmount.toNumber() * 100))
      .then(() => prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "Refunded" } }))
      .catch((error) => console.error("Refund of payment for cancelled order failed:", error));
    return null;
  }

  return order.id;
};

/**
 * Create a Razorpay order for one of our orders and remember its id. Returns
 * what the storefront needs to open the Razorpay Checkout popup.
 */
const startRazorpayPayment = async (orderId: bigint, orderNumber: string, totalAmount: Prisma.Decimal) => {
  const amountPaise = Math.round(totalAmount.toNumber() * 100);

  if (amountPaise < 100) {
    throw new Error(`Razorpay needs at least 100 paise; order ${orderNumber} totals ${amountPaise}.`);
  }

  const razorpayOrder = await createRazorpayOrder(amountPaise, orderNumber, { order_number: orderNumber });

  await prisma.order.update({
    where: { id: orderId },
    data: { razorpayOrderId: razorpayOrder.id },
  });

  return {
    provider: "razorpay",
    key_id: razorpayKeyId,
    razorpay_order_id: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
  };
};

// Razorpay webhook. Registered before express.json() because the signature is
// computed over the exact raw body.
app.post(
  "/api/payments/razorpay/webhook",
  express.raw({ type: "application/json", limit: "100kb" }),
  async (req, res) => {
    if (!isWebhookConfigured) {
      return res.status(503).json({ message: "Webhook is not configured." });
    }

    const signature = req.get("X-Razorpay-Signature") ?? "";

    if (!Buffer.isBuffer(req.body) || !verifyWebhookSignature(req.body, signature)) {
      return res.status(400).json({ message: "Invalid signature." });
    }

    try {
      const event = JSON.parse(req.body.toString("utf8"));
      const payment = event?.payload?.payment?.entity;

      if (event?.event === "payment.captured" && payment?.order_id && payment?.id) {
        const paidOrderId = await markRazorpayOrderPaid(String(payment.order_id), String(payment.id));
        if (paidOrderId) void emailOrderPlaced(paidOrderId);
      }

      // Always 200 for a verified event, so Razorpay does not keep retrying.
      return res.json({ received: true });
    } catch (error) {
      console.error("Razorpay webhook error:", error);
      return res.status(500).json({ message: "Webhook processing failed." });
    }
  }
);

app.use(express.json({ limit: "100kb" }));

app.use(
  "/storage",
  (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(path.join(process.cwd(), "public", "storage"))
);

const PORT = process.env.PORT || 5000;

const authenticateAdmin = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  let adminId: bigint;

  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Administrator authentication required.",
      });
    }

    const token = authHeader.split(" ")[1];
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      throw new Error("JWT_SECRET is not configured.");
    }

    const decoded = jwt.verify(token, secret);

    if (
      typeof decoded === "string" ||
      decoded.role !== "admin" ||
      typeof decoded.id !== "string" ||
      !/^\d+$/.test(decoded.id)
    ) {
      return res.status(403).json({
        message: "Administrator access denied.",
      });
    }

    adminId = BigInt(decoded.id);
  } catch {
    return res.status(401).json({
      message: "Invalid or expired administrator token.",
    });
  }

  // Re-check the database so revoked admin rights take effect immediately,
  // not only when the 12-hour token expires.
  try {
    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { isAdmin: true },
    });

    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        message: "Administrator access denied.",
      });
    }
  } catch (error) {
    return next(error);
  }

  res.locals.adminId = adminId;
  next();
};

const authenticateCustomer = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const token = authHeader.split(" ")[1];
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      throw new Error("JWT_SECRET is not configured.");
    }

    const decoded = jwt.verify(token, secret);

    if (
      typeof decoded === "string" ||
      decoded.role !== "customer" ||
      typeof decoded.id !== "string" ||
      !/^\d+$/.test(decoded.id)
    ) {
      return res.status(403).json({
        message: "Customer access denied.",
      });
    }

    const customerId = BigInt(decoded.id);

    res.locals.customerId = customerId;

    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired user token.",
    });
  }
};

app.get("/", (req, res) => {
  res.send("Yaale Node.js Backend is running!");
});

app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      success: true,
      message: "Yaale backend and database are working!",
    });
  } catch (error) {
    console.error("Health check database error:", error);

    res.status(500).json({
      success: false,
      message: "Database connection failed",
    });
  }
}); 


app.post("/api/admin/login", authRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(422).json({
        message: "Email and password are required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: "insensitive",
        },
        isAdmin: true,
      },
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(422).json({
        message: "The provided administrator credentials are invalid.",
      });
    }

    const secret = process.env.JWT_SECRET;

    if (!secret) {
      throw new Error("JWT_SECRET is not configured.");
    }

    const token = jwt.sign(
      {
        id: user.id.toString(),
        role: "admin",
      },
      secret,
      {
        expiresIn: "12h",
      }
    );

    return res.json({
      token,
      user: {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Admin login API error:", error);

    return res.status(500).json({
      message: "Unable to sign in.",
    });
  }
});

app.post("/api/auth/register", authRateLimit, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      !password
    ) {
      return res.status(422).json({
        message: "Name, email, and password are required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      return res.status(422).json({
        message: "Please enter a valid email address.",
      });
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(422).json({
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
    }

    // bcrypt only uses the first 72 bytes; reject longer passwords rather than silently truncating.
    if (Buffer.byteLength(password, "utf8") > 72) {
      return res.status(422).json({
        message: "Password must be at most 72 characters.",
      });
    }

    const tooLong = findTooLongField({
      name: [name, MAX_SHORT_TEXT],
      email: [email, MAX_SHORT_TEXT],
    });

    if (tooLong) {
      return res.status(422).json({
        message: `The ${tooLong} must be at most ${MAX_SHORT_TEXT} characters.`,
      });
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: "insensitive",
        },
      },
    });

    if (existingUser) {
      return res.status(409).json({
        message: "An account with this email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        password: passwordHash,
        isAdmin: false,
      },
    });

    const secret = process.env.JWT_SECRET;

    if (!secret) {
      throw new Error("JWT_SECRET is not configured.");
    }

    const token = jwt.sign(
      {
        id: user.id.toString(),
        role: "customer",
      },
      secret,
      {
        expiresIn: "12h",
      }
    );

    return res.status(201).json({
      token,
      user: {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    // Two sign-ups with the same email at once: the unique index rejects the second.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({
        message: "An account with this email already exists.",
      });
    }

    console.error("Customer register API error:", error);

    return res.status(500).json({
      message: "Unable to register account.",
    });
  }
});

app.post("/api/auth/login", authRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      !password
    ) {
      return res.status(422).json({
        message: "Email and password are required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: "insensitive",
        },
      },
    });

    if (!user || user.isAdmin || !(await bcrypt.compare(password, user.password))) {
      return res.status(422).json({
        message: "The provided credentials are invalid.",
      });
    }

    const secret = process.env.JWT_SECRET;

    if (!secret) {
      throw new Error("JWT_SECRET is not configured.");
    }

    const token = jwt.sign(
      {
        id: user.id.toString(),
        role: "customer",
      },
      secret,
      {
        expiresIn: "12h",
      }
    );

    return res.json({
      token,
      user: {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Customer login API error:", error);

    return res.status(500).json({
      message: "Unable to sign in.",
    });
  }
});

// ── Passwords ──────────────────────────────────────────────────────────────────

const RESET_TOKEN_MINUTES = 60;
const hashResetToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** Shared checks for a new password; returns an error message or null. */
const validateNewPassword = (password: unknown): string | null => {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (Buffer.byteLength(password, "utf8") > 72) {
    return "Password must be at most 72 characters.";
  }

  return null;
};

const passwordResetRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many password reset requests. Please try again in a few minutes.",
});

// Always answers the same way, whether or not the email has an account, so the
// form cannot be used to find out who is a customer.
app.post("/api/auth/forgot-password", passwordResetRateLimit, async (req, res) => {
  const genericReply = {
    message: "If an account exists for that email, a reset link has been sent.",
  };

  try {
    const { email } = req.body;

    if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim().toLowerCase())) {
      return res.status(422).json({ message: "Please enter a valid email address." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" }, isAdmin: false },
    });

    if (!user) {
      return res.json(genericReply);
    }

    if (!isMailConfigured) {
      console.warn("Password reset requested but SMTP is not configured; no email sent.");
      return res.json(genericReply);
    }

    const token = crypto.randomBytes(32).toString("hex");

    // One active token per email; a new request replaces the old one.
    await prisma.passwordResetToken.upsert({
      where: { email: user.email },
      create: { email: user.email, token: hashResetToken(token), createdAt: new Date() },
      update: { token: hashResetToken(token), createdAt: new Date() },
    });

    const resetUrl = `${frontendUrl}/#reset-password?email=${encodeURIComponent(user.email)}&token=${token}`;
    void sendPasswordResetEmail(user.email, user.name, resetUrl);

    return res.json(genericReply);
  } catch (error) {
    console.error("Forgot password API error:", error);
    return res.status(500).json({ message: "Unable to process the request." });
  }
});

app.post("/api/auth/reset-password", passwordResetRateLimit, async (req, res) => {
  try {
    const { email, token, password } = req.body;

    if (typeof email !== "string" || typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(422).json({ message: "This reset link is invalid. Please request a new one." });
    }

    const passwordError = validateNewPassword(password);
    if (passwordError) {
      return res.status(422).json({ message: passwordError });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const record = await prisma.passwordResetToken.findUnique({ where: { email: normalizedEmail } });
    const expired =
      !record?.createdAt || Date.now() - record.createdAt.getTime() > RESET_TOKEN_MINUTES * 60 * 1000;

    if (
      !record ||
      expired ||
      !crypto.timingSafeEqual(Buffer.from(record.token), Buffer.from(hashResetToken(token)))
    ) {
      return res.status(422).json({ message: "This reset link is invalid or has expired. Please request a new one." });
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" }, isAdmin: false },
    });

    if (!user) {
      return res.status(422).json({ message: "This reset link is invalid. Please request a new one." });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { password: await bcrypt.hash(password, 10) },
      }),
      // Each link works once.
      prisma.passwordResetToken.delete({ where: { email: normalizedEmail } }),
    ]);

    return res.json({ message: "Your password has been reset. You can now sign in." });
  } catch (error) {
    console.error("Reset password API error:", error);
    return res.status(500).json({ message: "Unable to reset the password." });
  }
});

app.put("/api/customer/password", authenticateCustomer, authRateLimit, async (req, res) => {
  try {
    const customerId = res.locals.customerId as bigint;
    const currentPassword = req.body.currentPassword ?? req.body.current_password;
    const newPassword = req.body.password;

    if (typeof currentPassword !== "string" || !currentPassword) {
      return res.status(422).json({ message: "Please enter your current password." });
    }

    const passwordError = validateNewPassword(newPassword);
    if (passwordError) {
      return res.status(422).json({ message: passwordError });
    }

    const user = await prisma.user.findUnique({ where: { id: customerId } });

    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(422).json({ message: "Your current password is incorrect." });
    }

    if (await bcrypt.compare(newPassword, user.password)) {
      return res.status(422).json({ message: "The new password must be different from the current one." });
    }

    await prisma.user.update({
      where: { id: customerId },
      data: { password: await bcrypt.hash(newPassword, 10) },
    });

    return res.json({ message: "Your password has been changed." });
  } catch (error) {
    console.error("Change password API error:", error);
    return res.status(500).json({ message: "Unable to change the password." });
  }
});

app.get("/api/customer/user", authenticateCustomer, async (req, res) => {
  try {
    const customerId = res.locals.customerId as bigint;
    const user = await prisma.user.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        message: "Customer not found.",
      });
    }

    return res.json({
      id: user.id.toString(),
      name: user.name,
      email: user.email,
    });
  } catch (error) {
    console.error("Get customer profile error:", error);
    return res.status(500).json({
      message: "Unable to load your profile.",
    });
  }
});

app.put("/api/customer/user", authenticateCustomer, async (req, res) => {
  try {
    const customerId = res.locals.customerId as bigint;
    const { name, email } = req.body;

    if (typeof name !== "string" || !name.trim() || typeof email !== "string" || !email.trim()) {
      return res.status(422).json({
        message: "Name and email are required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      return res.status(422).json({
        errors: {
          email: ["Please enter a valid email address."],
        },
      });
    }

    const tooLong = findTooLongField({
      name: [name, MAX_SHORT_TEXT],
      email: [email, MAX_SHORT_TEXT],
    });

    if (tooLong) {
      return res.status(422).json({
        errors: {
          [tooLong]: [`The ${tooLong} must be at most ${MAX_SHORT_TEXT} characters.`],
        },
      });
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: "insensitive",
        },
        id: {
          not: customerId,
        },
      },
    });

    if (existingUser) {
      return res.status(422).json({
        errors: {
          email: ["The email has already been taken."],
        },
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: customerId },
      data: {
        name: name.trim(),
        email: normalizedEmail,
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    return res.json({
      id: updatedUser.id.toString(),
      name: updatedUser.name,
      email: updatedUser.email,
    });
  } catch (error) {
    console.error("Update customer profile error:", error);
    return res.status(500).json({
      message: "Unable to update your profile.",
    });
  }
});

const formatProductResponse = (product: {
  id: bigint;
  name: string;
  description: string | null;
  price: Prisma.Decimal;
  originalPrice: Prisma.Decimal | null;
  discount: Prisma.Decimal | null;
  category: string;
  image: string | null;
  badge: string | null;
  fabric: string | null;
  color: string | null;
  length: string | null;
  blouse: string | null;
  occasion: string | null;
  sku: string | null;
  stock: number;
  inStock: boolean;
  isActive: boolean;
  returnExchange: string | null;
  manufacturedBy: string | null;
  marketedBy: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  images: Array<{
    id: bigint;
    productId: bigint;
    image: string;
    createdAt: Date | null;
    updatedAt: Date | null;
  }>;
}) => ({
  id: product.id.toString(),
  name: product.name,
  description: product.description,
  price: product.price.toString(),
  original_price: product.originalPrice?.toString() ?? null,
  discount: product.discount?.toString() ?? null,
  category: product.category,
  image: product.image,
  badge: product.badge,
  fabric: product.fabric,
  color: product.color,
  length: product.length,
  blouse: product.blouse,
  occasion: product.occasion,
  sku: product.sku,
  stock: product.stock,
  in_stock: product.inStock,
  is_active: product.isActive,
  return_exchange: product.returnExchange,
  manufactured_by: product.manufacturedBy,
  marketed_by: product.marketedBy,
  created_at: product.createdAt,
  updated_at: product.updatedAt,
  images: product.images.map((img) => ({
    id: img.id.toString(),
    product_id: img.productId.toString(),
    image: img.image,
    created_at: img.createdAt,
    updated_at: img.updatedAt,
  })),
});

app.get("/api/admin/products", authenticateAdmin, async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      include: {
        images: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json(products.map(formatProductResponse));
  } catch (error) {
    console.error("Get admin products API error:", error);

    return res.status(500).json({
      message: "Unable to fetch products.",
    });
  }
});

app.get("/api/admin/categories", authenticateAdmin, async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json(
      categories.map((category) => ({
        id: category.id.toString(),
        name: category.name,
        description: category.description,
        is_active: category.isActive,
        created_at: category.createdAt,
        updated_at: category.updatedAt,
      }))
    );
  } catch (error) {
    console.error("Get admin categories API error:", error);

    return res.status(500).json({
      message: "Unable to fetch categories.",
    });
  }
});

// ── Offers and coupon codes ────────────────────────────────────────────────────

type OfferRecord = Prisma.OfferGetPayload<object>;

const formatOffer = (offer: OfferRecord) => ({
  id: offer.id.toString(),
  title: offer.title,
  type: offer.type,
  value: offer.value,
  description: offer.description,
  status: offer.status,
  code: offer.code,
  discount_type: offer.discountType,
  discount_value: offer.discountValue?.toString() ?? null,
  min_order_amount: offer.minOrderAmount?.toString() ?? null,
  created_at: offer.createdAt,
  updated_at: offer.updatedAt,
});

/**
 * Reads the coupon fields of an offer form. A code needs a discount type
 * ("percent" or "flat") and value; an empty code removes the coupon. Fields
 * that were not sent are left unchanged (undefined).
 */
const parseCouponFields = (body: Record<string, unknown>):
  | { error: string }
  | { data: { code?: string | null; discountType?: string | null; discountValue?: Prisma.Decimal | null; minOrderAmount?: Prisma.Decimal | null } } => {
  const rawCode = body.code;
  if (rawCode === undefined) return { data: {} };

  if (rawCode === null || (typeof rawCode === "string" && !rawCode.trim())) {
    return { data: { code: null, discountType: null, discountValue: null, minOrderAmount: null } };
  }

  if (typeof rawCode !== "string" || !/^[A-Za-z0-9_-]{3,30}$/.test(rawCode.trim())) {
    return { error: "Coupon code must be 3–30 letters, numbers, - or _." };
  }

  const discountType = body.discountType ?? body.discount_type;
  if (discountType !== "percent" && discountType !== "flat") {
    return { error: "Choose a discount type: percent or flat." };
  }

  const discountValue = Number(body.discountValue ?? body.discount_value);
  if (!Number.isFinite(discountValue) || discountValue <= 0 || (discountType === "percent" && discountValue > 90)) {
    return { error: discountType === "percent" ? "Percent discount must be between 0 and 90." : "Flat discount must be more than 0." };
  }

  const rawMin = body.minOrderAmount ?? body.min_order_amount;
  const minOrder = rawMin === undefined || rawMin === null || rawMin === "" ? null : Number(rawMin);
  if (minOrder !== null && (!Number.isFinite(minOrder) || minOrder < 0)) {
    return { error: "Minimum order amount must be 0 or more." };
  }

  return {
    data: {
      code: rawCode.trim().toUpperCase(),
      discountType,
      discountValue: new Prisma.Decimal(discountValue.toFixed(2)),
      minOrderAmount: minOrder === null ? null : new Prisma.Decimal(minOrder.toFixed(2)),
    },
  };
};

/**
 * Looks up an active coupon and works out its discount on a subtotal.
 * The discount never exceeds the subtotal.
 */
const applyCoupon = async (
  rawCode: unknown,
  subtotal: Prisma.Decimal
): Promise<{ error: string } | { offer: OfferRecord; discount: Prisma.Decimal }> => {
  if (typeof rawCode !== "string" || !rawCode.trim()) {
    return { error: "Please enter a coupon code." };
  }

  const offer = await prisma.offer.findUnique({ where: { code: rawCode.trim().toUpperCase() } });

  if (!offer || offer.status.toLowerCase() !== "active" || !offer.discountType || !offer.discountValue) {
    return { error: "This coupon code is not valid." };
  }

  if (offer.minOrderAmount && subtotal.lessThan(offer.minOrderAmount)) {
    return { error: `This coupon needs an order of at least ₹${offer.minOrderAmount.toNumber().toLocaleString("en-IN")}.` };
  }

  const rawDiscount =
    offer.discountType === "percent"
      ? subtotal.mul(offer.discountValue).div(100).toDecimalPlaces(2)
      : offer.discountValue;

  return { offer, discount: Prisma.Decimal.min(rawDiscount, subtotal) };
};

const couponRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many coupon attempts. Please try again later.",
});

// Preview a coupon's discount at checkout. The order endpoint applies it again
// on the server, so this is only for showing the customer the new total.
app.post("/api/coupons/validate", couponRateLimit, async (req, res) => {
  try {
    const subtotal = Number(req.body.subtotal);

    if (!Number.isFinite(subtotal) || subtotal < 0) {
      return res.status(422).json({ message: "Invalid subtotal." });
    }

    const result = await applyCoupon(req.body.code, new Prisma.Decimal(subtotal.toFixed(2)));

    if ("error" in result) {
      return res.status(422).json({ message: result.error });
    }

    return res.json({
      code: result.offer.code,
      title: result.offer.title,
      discount_amount: result.discount.toFixed(2),
    });
  } catch (error) {
    console.error("Validate coupon API error:", error);
    return res.status(500).json({ message: "Unable to check the coupon." });
  }
});

app.get("/api/admin/offers", authenticateAdmin, async (req, res) => {
  try {
    const offers = await prisma.offer.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json(offers.map(formatOffer));
  } catch (error) {
    console.error("Get admin offers API error:", error);

    return res.status(500).json({
      message: "Unable to fetch offers.",
    });
  }
});

app.get("/api/admin/videos", authenticateAdmin, async (req, res) => {
  try {
    const videos = await prisma.video.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json(
      videos.map((video) => ({
        id: video.id.toString(),
        title: video.title,
        video: video.video,
        poster: video.poster,
        is_active: video.isActive,
        created_at: video.createdAt,
        updated_at: video.updatedAt,
      }))
    );
  } catch (error) {
    console.error("Get admin videos API error:", error);

    return res.status(500).json({
      message: "Unable to fetch videos.",
    });
  }
});

app.post("/api/contact", contactRateLimit, async (req, res) => {
  try {
    const { name, email, mobile, message } = req.body;

    if (typeof name !== "string" || !name.trim()) {
      return res.status(422).json({
        message: "Name is required.",
      });
    }

    if (typeof email !== "string" || !email.trim()) {
      return res.status(422).json({
        message: "Email is required.",
      });
    }

    if (typeof mobile !== "string" || !mobile.trim()) {
      return res.status(422).json({
        message: "Mobile number is required.",
      });
    }

    if (typeof message !== "string" || !message.trim()) {
      return res.status(422).json({
        message: "Message is required.",
      });
    }

    if (!EMAIL_PATTERN.test(email.trim())) {
      return res.status(422).json({
        message: "Please enter a valid email address.",
      });
    }

    const tooLong = findTooLongField({
      name: [name, MAX_SHORT_TEXT],
      email: [email, MAX_SHORT_TEXT],
      mobile: [mobile, 16],
      message: [message, MAX_LONG_TEXT],
    });

    if (tooLong) {
      return res.status(422).json({
        message: `The ${tooLong} is too long.`,
      });
    }

    const contactMessage = await prisma.contactMessage.create({
      data: {
        name: name.trim(),
        email: email.trim(),
        mobile: mobile.trim(),
        message: message.trim(),
      },
    });

    return res.status(201).json({
      id: contactMessage.id.toString(),
      name: contactMessage.name,
      email: contactMessage.email,
      mobile: contactMessage.mobile,
      message: contactMessage.message,
      is_read: contactMessage.isRead,
      created_at: contactMessage.createdAt,
      updated_at: contactMessage.updatedAt,
    });
  } catch (error) {
    console.error("Create contact message API error:", error);

    return res.status(500).json({
      message: "Unable to send your message.",
    });
  }
});

app.get("/api/admin/contact-messages", authenticateAdmin, async (req, res) => {
  try {
    const messages = await prisma.contactMessage.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json(
      messages.map((message) => ({
        id: message.id.toString(),
        name: message.name,
        email: message.email,
        mobile: message.mobile,
        message: message.message,
        is_read: message.isRead,
        created_at: message.createdAt,
        updated_at: message.updatedAt,
      }))
    );
  } catch (error) {
    console.error("Get admin contact messages API error:", error);

    return res.status(500).json({
      message: "Unable to fetch contact messages.",
    });
  }
});

app.put("/api/admin/contact-messages/:id", authenticateAdmin, async (req, res) => {
  try {
    const rawMessageId = req.params.id;

    if (typeof rawMessageId !== "string" || !/^\d+$/.test(rawMessageId)) {
      return res.status(400).json({
        message: "Invalid message ID.",
      });
    }

    const messageId = BigInt(rawMessageId);
    const { isRead, message, name, email, mobile } = req.body;

    const existingMessage = await prisma.contactMessage.findUnique({
      where: { id: messageId },
    });

    if (!existingMessage) {
      return res.status(404).json({
        message: "Contact message not found.",
      });
    }

    if (isRead !== undefined && typeof isRead !== "boolean") {
      return res.status(422).json({
        message: "isRead must be a boolean.",
      });
    }

    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      return res.status(422).json({
        message: "Name must be a non-empty string.",
      });
    }

    if (email !== undefined && (typeof email !== "string" || !email.trim())) {
      return res.status(422).json({
        message: "Email must be a non-empty string.",
      });
    }

    if (mobile !== undefined && (typeof mobile !== "string" || !mobile.trim())) {
      return res.status(422).json({
        message: "Mobile number must be a non-empty string.",
      });
    }

    if (message !== undefined && (typeof message !== "string" || !message.trim())) {
      return res.status(422).json({
        message: "Message must be a non-empty string.",
      });
    }

    const updatedMessage = await prisma.contactMessage.update({
      where: { id: messageId },
      data: {
        isRead: isRead !== undefined ? isRead : undefined,
        name: name !== undefined ? name.trim() : undefined,
        email: email !== undefined ? email.trim() : undefined,
        mobile: mobile !== undefined ? mobile.trim() : undefined,
        message: message !== undefined ? message.trim() : undefined,
      },
    });

    return res.json({
      id: updatedMessage.id.toString(),
      name: updatedMessage.name,
      email: updatedMessage.email,
      mobile: updatedMessage.mobile,
      message: updatedMessage.message,
      is_read: updatedMessage.isRead,
      created_at: updatedMessage.createdAt,
      updated_at: updatedMessage.updatedAt,
    });
  } catch (error) {
    console.error("Update admin contact message API error:", error);

    return res.status(500).json({
      message: "Unable to update contact message.",
    });
  }
});

app.delete("/api/admin/contact-messages/:id", authenticateAdmin, async (req, res) => {
  try {
    const rawMessageId = req.params.id;

    if (typeof rawMessageId !== "string" || !/^\d+$/.test(rawMessageId)) {
      return res.status(400).json({
        message: "Invalid message ID.",
      });
    }

    const messageId = BigInt(rawMessageId);
    const existingMessage = await prisma.contactMessage.findUnique({
      where: { id: messageId },
    });

    if (!existingMessage) {
      return res.status(404).json({
        message: "Contact message not found.",
      });
    }

    await prisma.contactMessage.delete({
      where: { id: messageId },
    });

    return res.json({
      message: "Contact message deleted successfully.",
    });
  } catch (error) {
    console.error("Delete admin contact message API error:", error);

    return res.status(500).json({
      message: "Unable to delete contact message.",
    });
  }
});

app.get("/api/admin/customers", authenticateAdmin, async (req, res) => {
  try {
    const customers = await prisma.user.findMany({
      where: {
        isAdmin: false,
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        addresses: true,
        orders: {
          include: {
            items: true,
          },
        },
      },
    });

    return res.json(
      customers.map((customer) => ({
        id: customer.id.toString(),
        name: customer.name,
        email: customer.email,
        email_verified_at: customer.emailVerifiedAt,
        is_admin: customer.isAdmin,
        created_at: customer.createdAt,
        updated_at: customer.updatedAt,
        address_count: customer.addresses.length,
        order_count: customer.orders.length,
        addresses: customer.addresses.map((address) => ({
          id: address.id.toString(),
          user_id: address.userId.toString(),
          name: address.name,
          phone: address.phone,
          address_line: address.addressLine,
          city: address.city,
          state: address.state,
          pin_code: address.pinCode,
          landmark: address.landmark,
          is_default: address.isDefault,
          created_at: address.createdAt,
          updated_at: address.updatedAt,
        })),
        orders: customer.orders.map((order) => ({
          id: order.id.toString(),
          order_number: order.orderNumber,
          customer_name: order.customerName,
          customer_phone: order.customerPhone,
          customer_address: order.customerAddress,
          total_amount: order.totalAmount.toString(),
          amount: order.totalAmount.toString(),
          status: order.status,
          payment_status: order.paymentStatus,
          expected_delivery_date: order.expectedDeliveryDate,
          created_at: order.createdAt,
          updated_at: order.updatedAt,
          items: order.items.map((item) => ({
            id: item.id.toString(),
            order_id: item.orderId.toString(),
            product_id: item.productId.toString(),
            product_name: item.productName,
            quantity: item.quantity,
            price: item.price.toString(),
          })),
        })),
      }))
    );
  } catch (error) {
    console.error("Get admin customers API error:", error);

    return res.status(500).json({
      message: "Unable to fetch customers.",
    });
  }
});

app.get("/api/admin/customers/:id", authenticateAdmin, async (req, res) => {
  try {
    const rawCustomerId = req.params.id;

    if (typeof rawCustomerId !== "string" || !/^\d+$/.test(rawCustomerId)) {
      return res.status(400).json({
        message: "Invalid customer ID.",
      });
    }

    const customerId = BigInt(rawCustomerId);

    const customer = await prisma.user.findFirst({
      where: {
        id: customerId,
        isAdmin: false,
      },
      include: {
        addresses: {
          orderBy: {
            isDefault: "desc",
          },
        },
        orders: {
          include: {
            items: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    if (!customer) {
      return res.status(404).json({
        message: "Customer not found.",
      });
    }

    return res.json({
      id: customer.id.toString(),
      name: customer.name,
      email: customer.email,
      email_verified_at: customer.emailVerifiedAt,
      is_admin: customer.isAdmin,
      created_at: customer.createdAt,
      updated_at: customer.updatedAt,
      addresses: customer.addresses.map((address) => ({
        id: address.id.toString(),
        user_id: address.userId.toString(),
        name: address.name,
        phone: address.phone,
        address_line: address.addressLine,
        city: address.city,
        state: address.state,
        pin_code: address.pinCode,
        landmark: address.landmark,
        is_default: address.isDefault,
        created_at: address.createdAt,
        updated_at: address.updatedAt,
      })),
      orders: customer.orders.map((order) => ({
        id: order.id.toString(),
        order_number: order.orderNumber,
        customer_name: order.customerName,
        customer_phone: order.customerPhone,
        customer_address: order.customerAddress,
        total_amount: order.totalAmount.toString(),
        amount: order.totalAmount.toString(),
        status: order.status,
        payment_status: order.paymentStatus,
        expected_delivery_date: order.expectedDeliveryDate,
        created_at: order.createdAt,
        updated_at: order.updatedAt,
        items: order.items.map((item) => ({
          id: item.id.toString(),
          order_id: item.orderId.toString(),
          product_id: item.productId.toString(),
          product_name: item.productName,
          quantity: item.quantity,
          price: item.price.toString(),
        })),
      })),
    });
  } catch (error) {
    console.error("Get admin customer detail API error:", error);

    return res.status(500).json({
      message: "Unable to fetch customer details.",
    });
  }
});

const formatStoreSettingsResponse = (settings: {
  id: bigint;
  storeName: string | null;
  storeEmail: string | null;
  storePhone: string | null;
  storeAddress: string | null;
  shippingFee: Prisma.Decimal | number | string | null;
  freeShippingThreshold: Prisma.Decimal | number | string | null;
  returnPolicy: string | null;
  shippingPolicy: string | null;
  privacyPolicy: string | null;
  termsPolicy: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}) => ({
  id: settings.id.toString(),
  store_name: settings.storeName ?? "",
  store_email: settings.storeEmail ?? "",
  store_phone: settings.storePhone ?? "",
  store_address: settings.storeAddress ?? "",
  shipping_fee:
    settings.shippingFee === null || settings.shippingFee === undefined
      ? null
      : Number(settings.shippingFee),
  free_shipping_threshold:
    settings.freeShippingThreshold === null || settings.freeShippingThreshold === undefined
      ? null
      : Number(settings.freeShippingThreshold),
  return_policy: settings.returnPolicy ?? "",
  shipping_policy: settings.shippingPolicy ?? "",
  privacy_policy: settings.privacyPolicy ?? "",
  terms_policy: settings.termsPolicy ?? "",
  created_at: settings.createdAt,
  updated_at: settings.updatedAt,
});

/**
 * Shipping charged on an order subtotal. Uses the admin's store settings, falling
 * back to the defaults when a value is not set. Free when subtotal exceeds the threshold.
 */
const calculateShipping = (
  subtotal: Prisma.Decimal,
  settings: { shippingFee: Prisma.Decimal | null; freeShippingThreshold: Prisma.Decimal | null } | null
): Prisma.Decimal => {
  const fee = settings?.shippingFee ?? new Prisma.Decimal(DEFAULT_SHIPPING_FEE);
  const threshold = settings?.freeShippingThreshold ?? new Prisma.Decimal(DEFAULT_FREE_SHIPPING_THRESHOLD);

  return subtotal.greaterThan(threshold) ? new Prisma.Decimal(0) : fee;
};

// Public, read-only store settings for the storefront (name, contact details, policies, shipping).
app.get("/api/settings", async (_req, res) => {
  try {
    const settings = await prisma.storeSetting.findFirst();

    if (!settings) {
      return res.json({
        store_name: "",
        store_email: "",
        store_phone: "",
        store_address: "",
        shipping_fee: DEFAULT_SHIPPING_FEE,
        free_shipping_threshold: DEFAULT_FREE_SHIPPING_THRESHOLD,
        return_policy: "",
        shipping_policy: "",
        privacy_policy: "",
        terms_policy: "",
        online_payment: isRazorpayConfigured,
      });
    }

    const formatted = formatStoreSettingsResponse(settings);

    return res.json({
      store_name: formatted.store_name,
      store_email: formatted.store_email,
      store_phone: formatted.store_phone,
      store_address: formatted.store_address,
      shipping_fee: formatted.shipping_fee ?? DEFAULT_SHIPPING_FEE,
      free_shipping_threshold: formatted.free_shipping_threshold ?? DEFAULT_FREE_SHIPPING_THRESHOLD,
      return_policy: formatted.return_policy,
      shipping_policy: formatted.shipping_policy,
      privacy_policy: formatted.privacy_policy,
      terms_policy: formatted.terms_policy,
      // Tells checkout whether to open Razorpay or place the order with payment pending.
      online_payment: isRazorpayConfigured,
    });
  } catch (error) {
    console.error("Public store settings API error:", error);

    return res.status(500).json({
      message: "Unable to load store settings.",
    });
  }
});

app.get("/api/admin/store-settings", authenticateAdmin, async (req, res) => {
  try {
    const settings = await prisma.storeSetting.findFirst();

    if (!settings) {
      return res.json({
        id: null,
        store_name: "",
        store_email: "",
        store_phone: "",
        store_address: "",
        shipping_fee: null,
        free_shipping_threshold: null,
        return_policy: "",
        shipping_policy: "",
        privacy_policy: "",
        terms_policy: "",
        created_at: null,
        updated_at: null,
      });
    }

    return res.json(formatStoreSettingsResponse(settings));
  } catch (error) {
    console.error("Get admin store settings API error:", error);

    return res.status(500).json({
      message: "Unable to fetch store settings.",
    });
  }
});

app.put("/api/admin/store-settings", authenticateAdmin, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({
        message: "Store settings payload is required.",
      });
    }

    const requested = req.body as Record<string, unknown>;
    const updateData: Record<string, string | number | null | undefined> = {};

    const parseOptionalString = (key: string) => {
      if (!(key in requested)) {
        return;
      }

      const value = requested[key];

      if (value === null || value === undefined || value === "") {
        updateData[key] = null;
        return;
      }

      if (typeof value !== "string") {
        throw new Error(`${key} must be a string.`);
      }

      const trimmed = value.trim();
      const maxLength = key === "store_phone" ? 50 : key === "store_name" || key === "store_email" ? MAX_SHORT_TEXT : null;

      if (maxLength !== null && trimmed.length > maxLength) {
        throw new Error(`${key} must be at most ${maxLength} characters.`);
      }

      updateData[key] = trimmed || null;
    };

    const parseOptionalDecimal = (key: string, label: string) => {
      if (!(key in requested)) {
        return;
      }

      const value = requested[key];

      if (value === null || value === undefined || value === "") {
        updateData[key] = null;
        return;
      }

      const normalized =
        typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;

      if (!Number.isFinite(normalized) || normalized < 0) {
        throw new Error(`${label} must be a non-negative number.`);
      }

      updateData[key] = normalized;
    };

    parseOptionalString("store_name");
    parseOptionalString("store_email");
    parseOptionalString("store_phone");
    parseOptionalString("store_address");
    parseOptionalString("return_policy");
    parseOptionalString("shipping_policy");
    parseOptionalString("privacy_policy");
    parseOptionalString("terms_policy");
    parseOptionalDecimal("shipping_fee", "shipping_fee");
    parseOptionalDecimal("free_shipping_threshold", "free_shipping_threshold");

    const existingSettings = await prisma.storeSetting.findFirst();

    const dataToSave: Record<string, string | number | null | undefined> = {};

    if (existingSettings) {
      Object.entries(updateData).forEach(([key, value]) => {
        if (value !== undefined) {
          if (key === "store_name") dataToSave.storeName = value;
          else if (key === "store_email") dataToSave.storeEmail = value;
          else if (key === "store_phone") dataToSave.storePhone = value;
          else if (key === "store_address") dataToSave.storeAddress = value;
          else if (key === "return_policy") dataToSave.returnPolicy = value;
          else if (key === "shipping_policy") dataToSave.shippingPolicy = value;
          else if (key === "privacy_policy") dataToSave.privacyPolicy = value;
          else if (key === "terms_policy") dataToSave.termsPolicy = value;
          else if (key === "shipping_fee") dataToSave.shippingFee = value;
          else if (key === "free_shipping_threshold") dataToSave.freeShippingThreshold = value;
        }
      });
    } else {
      if ("store_name" in requested) dataToSave.storeName = updateData.store_name ?? null;
      if ("store_email" in requested) dataToSave.storeEmail = updateData.store_email ?? null;
      if ("store_phone" in requested) dataToSave.storePhone = updateData.store_phone ?? null;
      if ("store_address" in requested) dataToSave.storeAddress = updateData.store_address ?? null;
      if ("return_policy" in requested) dataToSave.returnPolicy = updateData.return_policy ?? null;
      if ("shipping_policy" in requested) dataToSave.shippingPolicy = updateData.shipping_policy ?? null;
      if ("privacy_policy" in requested) dataToSave.privacyPolicy = updateData.privacy_policy ?? null;
      if ("terms_policy" in requested) dataToSave.termsPolicy = updateData.terms_policy ?? null;
      if ("shipping_fee" in requested) dataToSave.shippingFee = updateData.shipping_fee ?? null;
      if ("free_shipping_threshold" in requested) dataToSave.freeShippingThreshold = updateData.free_shipping_threshold ?? null;
    }

    const settings = existingSettings
      ? await prisma.storeSetting.update({
          where: { id: existingSettings.id },
          data: dataToSave,
        })
      : await prisma.storeSetting.create({
          data: dataToSave,
        });

    return res.json(formatStoreSettingsResponse(settings));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update store settings.";

    if (message.includes("must be")) {
      return res.status(422).json({
        message,
      });
    }

    console.error("Update admin store settings API error:", error);

    return res.status(500).json({
      message: "Unable to update store settings.",
    });
  }
});

app.post("/api/admin/categories", authenticateAdmin, async (req, res) => {
  try {
    const { name, description, isActive } = req.body;

    if (typeof name !== "string" || !name.trim()) {
      return res.status(422).json({
        message: "Category name is required.",
      });
    }

    if (isActive !== undefined && typeof isActive !== "boolean") {
      return res.status(422).json({
        message: "isActive must be a boolean.",
      });
    }

    const normalizedName = name.trim();
    const existingCategory = await prisma.category.findUnique({
      where: {
        name: normalizedName,
      },
    });

    if (existingCategory) {
      return res.status(409).json({
        message: "A category with this name already exists.",
      });
    }

    const category = await prisma.category.create({
      data: {
        name: normalizedName,
        description: typeof description === "string" ? description.trim() || null : null,
        isActive: typeof isActive === "boolean" ? isActive : true,
      },
    });

    return res.status(201).json({
      id: category.id.toString(),
      name: category.name,
      description: category.description,
      is_active: category.isActive,
      created_at: category.createdAt,
      updated_at: category.updatedAt,
    });
  } catch (error) {
    console.error("Create admin category API error:", error);

    return res.status(500).json({
      message: "Unable to create category.",
    });
  }
});

app.put("/api/admin/categories/:id", authenticateAdmin, async (req, res) => {
  try {
    const rawCategoryId = req.params.id;

    if (typeof rawCategoryId !== "string" || !/^\d+$/.test(rawCategoryId)) {
      return res.status(400).json({
        message: "Invalid category ID.",
      });
    }

    const categoryId = BigInt(rawCategoryId);
    const { name, description, isActive } = req.body;

    const existingCategory = await prisma.category.findUnique({
      where: { id: categoryId },
    });

    if (!existingCategory) {
      return res.status(404).json({
        message: "Category not found.",
      });
    }

    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      return res.status(422).json({
        message: "Category name must be a non-empty string.",
      });
    }

    if (isActive !== undefined && typeof isActive !== "boolean") {
      return res.status(422).json({
        message: "isActive must be a boolean.",
      });
    }

    if (name !== undefined && name.trim() !== existingCategory.name) {
      const duplicateCategory = await prisma.category.findUnique({
        where: {
          name: name.trim(),
        },
      });

      if (duplicateCategory && duplicateCategory.id !== categoryId) {
        return res.status(409).json({
          message: "A category with this name already exists.",
        });
      }
    }

    const newName = name !== undefined ? name.trim() : undefined;

    // Products store the category by name, so a rename must carry them along;
    // otherwise they keep the old name and drop out of the renamed category.
    const [category] = await prisma.$transaction([
      prisma.category.update({
      where: { id: categoryId },
      data: {
        name: newName,
        description:
          description !== undefined
            ? description === null || description === ""
              ? null
              : description.trim()
            : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
      },
      }),
      prisma.product.updateMany({
        where: {
          category: existingCategory.name,
        },
        data: {
          category: newName ?? existingCategory.name,
        },
      }),
    ]);

    return res.json({
      id: category.id.toString(),
      name: category.name,
      description: category.description,
      is_active: category.isActive,
      created_at: category.createdAt,
      updated_at: category.updatedAt,
    });
  } catch (error) {
    console.error("Update admin category API error:", error);

    return res.status(500).json({
      message: "Unable to update category.",
    });
  }
});

app.delete("/api/admin/categories/:id", authenticateAdmin, async (req, res) => {
  try {
    const rawCategoryId = req.params.id;

    if (typeof rawCategoryId !== "string" || !/^\d+$/.test(rawCategoryId)) {
      return res.status(400).json({
        message: "Invalid category ID.",
      });
    }

    const categoryId = BigInt(rawCategoryId);

    const category = await prisma.category.findUnique({
      where: { id: categoryId },
    });

    if (!category) {
      return res.status(404).json({
        message: "Category not found.",
      });
    }

    const dependentProduct = await prisma.product.findFirst({
      where: {
        category: category.name,
      },
    });

    if (dependentProduct) {
      return res.status(409).json({
        message: "This category is used by one or more products and cannot be deleted.",
      });
    }

    await prisma.category.delete({
      where: { id: categoryId },
    });

    return res.json({
      message: "Category deleted successfully.",
    });
  } catch (error) {
    console.error("Delete admin category API error:", error);

    return res.status(500).json({
      message: "Unable to delete category.",
    });
  }
});

app.post("/api/admin/offers", authenticateAdmin, async (req, res) => {
  try {
    const { title, type, value, description, status } = req.body;

    if (typeof title !== "string" || !title.trim()) {
      return res.status(422).json({
        message: "Offer title is required.",
      });
    }

    if (typeof type !== "string" || !type.trim()) {
      return res.status(422).json({
        message: "Offer type is required.",
      });
    }

    if (typeof value !== "string" || !value.trim()) {
      return res.status(422).json({
        message: "Offer value is required.",
      });
    }

    if (typeof description !== "string" || !description.trim()) {
      return res.status(422).json({
        message: "Offer description is required.",
      });
    }

    if (typeof status !== "string" || !status.trim()) {
      return res.status(422).json({
        message: "Offer status is required.",
      });
    }

    const coupon = parseCouponFields(req.body);
    if ("error" in coupon) {
      return res.status(422).json({ message: coupon.error });
    }

    const offer = await prisma.offer.create({
      data: {
        title: title.trim(),
        type: type.trim(),
        value: value.trim(),
        description: description.trim(),
        status: status.trim(),
        ...coupon.data,
      },
    });

    return res.status(201).json(formatOffer(offer));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ message: "Another offer already uses this coupon code." });
    }

    console.error("Create admin offer API error:", error);

    return res.status(500).json({
      message: "Unable to create offer.",
    });
  }
});

app.post(
  "/api/admin/videos",
  authenticateAdmin,
  cleanupUploadsOnFailure,
  (req, res, next) => {
    uploadVideoFile.single("video")(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            message: "The video file is too large for the server. Maximum supported size is 1GB.",
          });
        }
        if (err instanceof HttpError) {
          return res.status(err.status).json({ message: err.message });
        }
        return res.status(422).json({
          message: "Failed to upload video.",
        });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const { title, poster, isActive } = req.body;
      const file = req.file;

      if (typeof title !== "string" || !title.trim()) {
        return res.status(422).json({
          message: "Video title is required.",
        });
      }

      const videoPath = file
        ? `videos/${file.filename}`
        : typeof req.body.video === "string" && req.body.video.trim()
        ? req.body.video.trim()
        : null;

      if (!videoPath) {
        return res.status(422).json({
          message: "Video file is required.",
        });
      }

      if (poster !== undefined && poster !== null && typeof poster !== "string") {
        return res.status(422).json({
          message: "Poster must be a string or null.",
        });
      }

      const parsedIsActive = parseBool(isActive);
      if (isActive !== undefined && isActive !== null && parsedIsActive === undefined) {
        return res.status(422).json({
          message: "isActive must be a boolean or the string \"true\", \"false\", \"1\", or \"0\".",
        });
      }

      const createdVideo = await prisma.video.create({
        data: {
          title: title.trim(),
          video: videoPath,
          poster: typeof poster === "string" && poster.trim() ? poster.trim() : null,
          isActive: parsedIsActive !== undefined ? parsedIsActive : true,
        },
      });

      return res.status(201).json({
        id: createdVideo.id.toString(),
        title: createdVideo.title,
        video: createdVideo.video,
        poster: createdVideo.poster,
        is_active: createdVideo.isActive,
        created_at: createdVideo.createdAt,
        updated_at: createdVideo.updatedAt,
      });
    } catch (error) {
      console.error("Create admin video API error:", error);

      return res.status(500).json({
        message: "Unable to create video.",
      });
    }
  }
);

app.put("/api/admin/offers/:id", authenticateAdmin, async (req, res) => {
  try {
    const rawOfferId = req.params.id;

    if (typeof rawOfferId !== "string" || !/^\d+$/.test(rawOfferId)) {
      return res.status(400).json({
        message: "Invalid offer ID.",
      });
    }

    const offerId = BigInt(rawOfferId);
    const { title, type, value, description, status } = req.body;

    const existingOffer = await prisma.offer.findUnique({
      where: { id: offerId },
    });

    if (!existingOffer) {
      return res.status(404).json({
        message: "Offer not found.",
      });
    }

    if (title !== undefined && (typeof title !== "string" || !title.trim())) {
      return res.status(422).json({
        message: "Offer title must be a non-empty string.",
      });
    }

    if (type !== undefined && (typeof type !== "string" || !type.trim())) {
      return res.status(422).json({
        message: "Offer type must be a non-empty string.",
      });
    }

    if (value !== undefined && (typeof value !== "string" || !value.trim())) {
      return res.status(422).json({
        message: "Offer value must be a non-empty string.",
      });
    }

    if (description !== undefined && (typeof description !== "string" || !description.trim())) {
      return res.status(422).json({
        message: "Offer description must be a non-empty string.",
      });
    }

    if (status !== undefined && (typeof status !== "string" || !status.trim())) {
      return res.status(422).json({
        message: "Offer status must be a non-empty string.",
      });
    }

    const coupon = parseCouponFields(req.body);
    if ("error" in coupon) {
      return res.status(422).json({ message: coupon.error });
    }

    const updatedOffer = await prisma.offer.update({
      where: { id: offerId },
      data: {
        title: title !== undefined ? title.trim() : undefined,
        type: type !== undefined ? type.trim() : undefined,
        value: value !== undefined ? value.trim() : undefined,
        description: description !== undefined ? description.trim() : undefined,
        status: status !== undefined ? status.trim() : undefined,
        ...coupon.data,
      },
    });

    return res.json(formatOffer(updatedOffer));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ message: "Another offer already uses this coupon code." });
    }

    console.error("Update admin offer API error:", error);

    return res.status(500).json({
      message: "Unable to update offer.",
    });
  }
});

app.delete("/api/admin/offers/:id", authenticateAdmin, async (req, res) => {
  try {
    const rawOfferId = req.params.id;

    if (typeof rawOfferId !== "string" || !/^\d+$/.test(rawOfferId)) {
      return res.status(400).json({
        message: "Invalid offer ID.",
      });
    }

    const offerId = BigInt(rawOfferId);

    const offer = await prisma.offer.findUnique({
      where: { id: offerId },
    });

    if (!offer) {
      return res.status(404).json({
        message: "Offer not found.",
      });
    }

    await prisma.offer.delete({
      where: { id: offerId },
    });

    return res.json({
      message: "Offer deleted successfully.",
    });
  } catch (error) {
    console.error("Delete admin offer API error:", error);

    return res.status(500).json({
      message: "Unable to delete offer.",
    });
  }
});

app.put("/api/admin/videos/:id", authenticateAdmin, async (req, res) => {
  try {
    const rawVideoId = req.params.id;

    if (typeof rawVideoId !== "string" || !/^\d+$/.test(rawVideoId)) {
      return res.status(400).json({
        message: "Invalid video ID.",
      });
    }

    const videoId = BigInt(rawVideoId);
    const { title, video, poster, isActive } = req.body;

    const existingVideo = await prisma.video.findUnique({
      where: { id: videoId },
    });

    if (!existingVideo) {
      return res.status(404).json({
        message: "Video not found.",
      });
    }

    if (title !== undefined && (typeof title !== "string" || !title.trim())) {
      return res.status(422).json({
        message: "Video title must be a non-empty string.",
      });
    }

    if (video !== undefined && (typeof video !== "string" || !video.trim())) {
      return res.status(422).json({
        message: "Video path must be a non-empty string.",
      });
    }

    if (poster !== undefined && poster !== null && typeof poster !== "string") {
      return res.status(422).json({
        message: "Poster must be a string or null.",
      });
    }

    if (isActive !== undefined && typeof isActive !== "boolean") {
      return res.status(422).json({
        message: "isActive must be a boolean.",
      });
    }

    const updatedVideo = await prisma.video.update({
      where: { id: videoId },
      data: {
        title: title !== undefined ? title.trim() : undefined,
        video: video !== undefined ? video.trim() : undefined,
        poster: poster !== undefined ? (typeof poster === "string" && poster.trim() ? poster.trim() : null) : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
      },
    });

    return res.json({
      id: updatedVideo.id.toString(),
      title: updatedVideo.title,
      video: updatedVideo.video,
      poster: updatedVideo.poster,
      is_active: updatedVideo.isActive,
      created_at: updatedVideo.createdAt,
      updated_at: updatedVideo.updatedAt,
    });
  } catch (error) {
    console.error("Update admin video API error:", error);

    return res.status(500).json({
      message: "Unable to update video.",
    });
  }
});

app.delete("/api/admin/videos/:id", authenticateAdmin, async (req, res) => {
  try {
    const rawVideoId = req.params.id;

    if (typeof rawVideoId !== "string" || !/^\d+$/.test(rawVideoId)) {
      return res.status(400).json({
        message: "Invalid video ID.",
      });
    }

    const videoId = BigInt(rawVideoId);

    const video = await prisma.video.findUnique({
      where: { id: videoId },
    });

    if (!video) {
      return res.status(404).json({
        message: "Video not found.",
      });
    }

    await prisma.video.delete({
      where: { id: videoId },
    });

    // Remove the files only after the record is gone. resolveStoragePath keeps
    // deletion inside public/storage (with a separator check, so sibling folders
    // such as public/storage2 are not reachable).
    removeStoredFile(video.video);
    removeStoredFile(video.poster);

    return res.json({
      message: "Video deleted successfully.",
    });
  } catch (error) {
    console.error("Delete admin video API error:", error);

    return res.status(500).json({
      message: "Unable to delete video.",
    });
  }
});

app.post(
  "/api/admin/products",
  authenticateAdmin,
  cleanupUploadsOnFailure,
  uploadProductImages.array("images[]", 10),
  async (req, res) => {
  try {
    const name = req.body.name;
    const description = req.body.description;
    const originalPrice = req.body.originalPrice ?? req.body.original_price;
    const discount = req.body.discount;
    const price = req.body.price ?? (originalPrice !== undefined && discount !== undefined ? Number(originalPrice) * (1 - (Number(discount) || 0) / 100) : req.body.price);
    const category = req.body.category;
    const fabric = req.body.fabric;
    const color = req.body.color;
    const length = req.body.length;
    const blouse = req.body.blouse;
    const occasion = req.body.occasion;
    const sku = req.body.sku;
    const stock = req.body.stock;
    const inStock = req.body.inStock ?? req.body.in_stock;
    const isActive = req.body.isActive ?? req.body.is_active;
    const returnExchange = req.body.returnExchange ?? req.body.return_exchange;
    const manufacturedBy = req.body.manufacturedBy ?? req.body.manufactured_by;
    const marketedBy = req.body.marketedBy ?? req.body.marketed_by;
    const image = req.body.image;
    const badge = req.body.badge;
    const images = req.body.images;

        

    const uploadedFiles = (req.files as Express.Multer.File[] | undefined) ?? [];
    const uploadedImagePaths = await Promise.all(
      uploadedFiles.map(file => normalizeProductImage(file.path))
    );

   

    if (typeof name !== "string" || !name.trim()) {
      return res.status(422).json({
        message: "Product name is required.",
      });
    }

    if (typeof category !== "string" || !category.trim()) {
      return res.status(422).json({
        message: "Product category is required.",
      });
    }

    if (typeof price === "undefined") {
      return res.status(422).json({
        message: "Product price is required.",
      });
    }

    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      return res.status(422).json({
        message: "Product price must be a valid non-negative number.",
      });
    }

    const parsedOriginalPrice = originalPrice === undefined || originalPrice === null
      ? null
      : (() => {
          const value = Number(originalPrice);
          if (!Number.isFinite(value) || value < 0) {
            throw new Error("originalPrice must be a valid non-negative number or null.");
          }
          return new Prisma.Decimal(value.toFixed(2));
        })();

    const parsedDiscount = discount === undefined || discount === null
      ? null
      : (() => {
          const value = Number(discount);
          if (!Number.isFinite(value) || value < 0) {
            throw new Error("discount must be a valid non-negative number or null.");
          }
          return new Prisma.Decimal(value.toFixed(2));
        })();

    const parsedStock = typeof stock === "undefined" ? 0 : Number(stock);
    if (!Number.isInteger(parsedStock) || parsedStock < 0) {
      return res.status(422).json({
        message: "Stock must be a non-negative integer.",
      });
    }

    const parsedInStock = parseBool(inStock);
    if (inStock !== undefined && inStock !== null && parsedInStock === undefined) {
      return res.status(422).json({
        message: "inStock must be a boolean or the string \"true\", \"false\", \"1\", or \"0\".",
      });
    }

    const parsedIsActive = parseBool(isActive);
    if (isActive !== undefined && isActive !== null && parsedIsActive === undefined) {
      return res.status(422).json({
        message: "isActive must be a boolean or the string \"true\", \"false\", \"1\", or \"0\".",
      });
    }

    if (sku !== undefined && sku !== null && (typeof sku !== "string" || !sku.trim())) {
      return res.status(422).json({
        message: "sku must be a non-empty string when provided.",
      });
    }

    if (images !== undefined && !Array.isArray(images)) {
      return res.status(422).json({
        message: "images must be an array of image URLs.",
      });
    }

    const duplicateSku = sku && sku.trim()
      ? await prisma.product.findUnique({
          where: {
            sku: sku.trim(),
          },
        })
      : null;

    if (duplicateSku) {
      return res.status(409).json({
        message: "A product with this SKU already exists.",
      });
    }

    const product = await prisma.product.create({
      data: {
        name: name.trim(),
        description: typeof description === "string" ? description : null,
        price: new Prisma.Decimal(numericPrice.toFixed(2)),
        originalPrice: parsedOriginalPrice,
        discount: parsedDiscount,
        category: category.trim(),
        image: uploadedImagePaths[0] ?? (typeof image === "string" ? image.trim() || null : null),
        badge: typeof badge === "string" ? badge.trim() || null : null,
        fabric: typeof fabric === "string" ? fabric.trim() || null : null,
        color: typeof color === "string" ? color.trim() || null : null,
        length: typeof length === "string" ? length.trim() || null : null,
        blouse: typeof blouse === "string" ? blouse.trim() || null : null,
        occasion: typeof occasion === "string" ? occasion.trim() || null : null,
        sku: sku && sku.trim() ? sku.trim() : null,
        stock: parsedStock,
        inStock: parsedInStock !== undefined ? parsedInStock : true,
        isActive: parsedIsActive !== undefined ? parsedIsActive : true,
        returnExchange: typeof returnExchange === "string" ? returnExchange.trim() || null : null,
        manufacturedBy: typeof manufacturedBy === "string" ? manufacturedBy.trim() || null : null,
        marketedBy: typeof marketedBy === "string" ? marketedBy.trim() || null : null,
        images: uploadedImagePaths.length > 0
  ? {
      create: uploadedImagePaths.map(image => ({ image })),
    }
  : Array.isArray(images)
    ? {
        create: images
          .filter((img: unknown) => typeof img === "string" && img.trim())
          .map((img: string) => ({ image: img.trim() })),
      }
    : undefined,
      },
      include: {
        images: true,
      },
    });

    return res.status(201).json(formatProductResponse(product));
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("originalPrice") ||
        error.message.includes("discount"))
    ) {
      return res.status(422).json({
        message: error.message,
      });
    }

    console.error("Create admin product API error:", error);

    return res.status(500).json({
      message: "Unable to create product.",
    });
  }
});

app.put(
  "/api/admin/products/:id",
  authenticateAdmin,
  cleanupUploadsOnFailure,
  uploadProductImages.array("images[]", 10),
  async (req, res) => {
  try {
    const rawProductId = req.params.id;

    if (typeof rawProductId !== "string" || !/^\d+$/.test(rawProductId)) {
      return res.status(400).json({
        message: "Invalid product ID.",
      });
    }

    const productId = BigInt(rawProductId);
    const existingProduct = await prisma.product.findUnique({
      where: { id: productId },
      include: { images: true },
    });

    if (!existingProduct) {
      return res.status(404).json({
        message: "Product not found.",
      });
    }

    const name = req.body.name;
    const description = req.body.description;
    const originalPrice = req.body.originalPrice ?? req.body.original_price;
    const discount = req.body.discount;
    const price = req.body.price ?? (originalPrice !== undefined && discount !== undefined ? Number(originalPrice) * (1 - (Number(discount) || 0) / 100) : req.body.price);
    const category = req.body.category;
    const fabric = req.body.fabric;
    const color = req.body.color;
    const length = req.body.length;
    const blouse = req.body.blouse;
    const occasion = req.body.occasion;
    const sku = req.body.sku;
    const stock = req.body.stock;
    const inStock = req.body.inStock ?? req.body.in_stock;
    const isActive = req.body.isActive ?? req.body.is_active;
    const returnExchange = req.body.returnExchange ?? req.body.return_exchange;
    const manufacturedBy = req.body.manufacturedBy ?? req.body.manufactured_by;
    const marketedBy = req.body.marketedBy ?? req.body.marketed_by;
    const image = req.body.image;
    const badge = req.body.badge;
    const images = req.body.images;

        const uploadedFiles = (req.files as Express.Multer.File[] | undefined) ?? [];
    const uploadedImagePaths = await Promise.all(
      uploadedFiles.map(file => normalizeProductImage(file.path))
    );

    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      return res.status(422).json({
        message: "Product name must be a non-empty string.",
      });
    }

    if (category !== undefined && (typeof category !== "string" || !category.trim())) {
      return res.status(422).json({
        message: "Product category must be a non-empty string.",
      });
    }

    if (price !== undefined) {
      const numericPrice = Number(price);
      if (!Number.isFinite(numericPrice) || numericPrice < 0) {
        return res.status(422).json({
          message: "Product price must be a valid non-negative number.",
        });
      }
    }

    if (originalPrice !== undefined && originalPrice !== null) {
      const value = Number(originalPrice);
      if (!Number.isFinite(value) || value < 0) {
        return res.status(422).json({
          message: "originalPrice must be a valid non-negative number or null.",
        });
      }
    }

    if (discount !== undefined && discount !== null) {
      const value = Number(discount);
      if (!Number.isFinite(value) || value < 0) {
        return res.status(422).json({
          message: "discount must be a valid non-negative number or null.",
        });
      }
    }

    if (stock !== undefined) {
      const parsedStock = Number(stock);
      if (!Number.isInteger(parsedStock) || parsedStock < 0) {
        return res.status(422).json({
          message: "Stock must be a non-negative integer.",
        });
      }
    }

    const parsedInStock = parseBool(inStock);
    if (inStock !== undefined && inStock !== null && parsedInStock === undefined) {
      return res.status(422).json({
        message: "inStock must be a boolean or the string \"true\", \"false\", \"1\", or \"0\".",
      });
    }

    const parsedIsActive = parseBool(isActive);
    if (isActive !== undefined && isActive !== null && parsedIsActive === undefined) {
      return res.status(422).json({
        message: "isActive must be a boolean or the string \"true\", \"false\", \"1\", or \"0\".",
      });
    }

    if (sku !== undefined && sku !== null && (typeof sku !== "string" || !sku.trim())) {
      return res.status(422).json({
        message: "sku must be a non-empty string when provided.",
      });
    }

    if (images !== undefined && !Array.isArray(images)) {
      return res.status(422).json({
        message: "images must be an array of image URLs.",
      });
    }

    if (sku !== undefined && sku !== null && sku.trim() !== existingProduct.sku) {
      const duplicateSku = await prisma.product.findUnique({
        where: {
          sku: sku.trim(),
        },
      });

      if (duplicateSku && duplicateSku.id !== productId) {
        return res.status(409).json({
          message: "A product with this SKU already exists.",
        });
      }
    }

    const data: Prisma.ProductUpdateInput = {
      name: name !== undefined ? name.trim() : undefined,
      description: description !== undefined ? (description === null || description === "" ? null : description) : undefined,
      price: price !== undefined ? new Prisma.Decimal(Number(price).toFixed(2)) : undefined,
      originalPrice: originalPrice !== undefined ? (originalPrice === null ? null : new Prisma.Decimal(Number(originalPrice).toFixed(2))) : undefined,
      discount: discount !== undefined ? (discount === null ? null : new Prisma.Decimal(Number(discount).toFixed(2))) : undefined,
      category: category !== undefined ? category.trim() : undefined,
      image: uploadedImagePaths[0] ??
  (image !== undefined
    ? (typeof image === "string" && image.trim() ? image.trim() : null)
    : undefined),
      badge: badge !== undefined ? (typeof badge === "string" && badge.trim() ? badge.trim() : null) : undefined,
      fabric: fabric !== undefined ? (typeof fabric === "string" ? fabric.trim() || null : null) : undefined,
      color: color !== undefined ? (typeof color === "string" ? color.trim() || null : null) : undefined,
      length: length !== undefined ? (typeof length === "string" ? length.trim() || null : null) : undefined,
      blouse: blouse !== undefined ? (typeof blouse === "string" ? blouse.trim() || null : null) : undefined,
      occasion: occasion !== undefined ? (typeof occasion === "string" ? occasion.trim() || null : null) : undefined,
      sku: sku !== undefined ? (sku === null || sku.trim() === "" ? null : sku.trim()) : undefined,
      stock: stock !== undefined ? Number(stock) : undefined,
      inStock: parsedInStock !== undefined ? parsedInStock : undefined,
      isActive: parsedIsActive !== undefined ? parsedIsActive : undefined,
      returnExchange: returnExchange !== undefined ? (typeof returnExchange === "string" ? returnExchange.trim() || null : null) : undefined,
      manufacturedBy: manufacturedBy !== undefined ? (typeof manufacturedBy === "string" ? manufacturedBy.trim() || null : null) : undefined,
      marketedBy: marketedBy !== undefined ? (typeof marketedBy === "string" ? marketedBy.trim() || null : null) : undefined,
    };

    const updatedProduct = await prisma.$transaction(async (tx) => {
      if (uploadedImagePaths.length > 0) {
        // New photos replace the gallery so it matches the new main image.
        await tx.productImage.deleteMany({
          where: {
            productId,
          },
        });

        await tx.productImage.createMany({
          data: uploadedImagePaths.map((image) => ({
            productId,
            image,
          })),
        });
      } else if (images !== undefined) {
        await tx.productImage.deleteMany({
          where: {
            productId,
          },
        });

        if (Array.isArray(images) && images.length > 0) {
          await tx.productImage.createMany({
            data: images
              .filter((img: unknown) => typeof img === "string" && img.trim())
              .map((img: string) => ({
                productId,
                image: img.trim(),
              })),
          });
        }
      }

      return await tx.product.update({
        where: { id: productId },
        data,
        include: {
          images: true,
        },
      });
    });

    // Delete image files the product no longer references (old gallery and main image).
    const stillUsed = new Set([
      updatedProduct.image,
      ...updatedProduct.images.map((img) => img.image),
    ]);
    const previouslyUsed = new Set([
      existingProduct.image,
      ...existingProduct.images.map((img) => img.image),
    ]);

    for (const oldPath of previouslyUsed) {
      if (oldPath && !stillUsed.has(oldPath)) {
        removeStoredFile(oldPath);
      }
    }

    return res.json(formatProductResponse(updatedProduct));
  } catch (error) {
    console.error("Update admin product API error:", error);

    return res.status(500).json({
      message: "Unable to update product.",
    });
  }
});

app.patch("/api/admin/products/:id", authenticateAdmin, async (req, res) => {
  try {
    const rawProductId = req.params.id;

    if (typeof rawProductId !== "string" || !/^\d+$/.test(rawProductId)) {
      return res.status(400).json({
        message: "Invalid product ID.",
      });
    }

    const productId = BigInt(rawProductId);
    const existingProduct = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!existingProduct) {
      return res.status(404).json({
        message: "Product not found.",
      });
    }

    const { stock } = req.body;
    const rawInStock = req.body.inStock !== undefined ? req.body.inStock : req.body.in_stock;

    if (stock === undefined && rawInStock === undefined) {
      return res.status(422).json({
        message: "At least one of stock or inStock must be provided.",
      });
    }

    let parsedStock: number | undefined = undefined;
    if (stock !== undefined) {
      parsedStock = Number(stock);
      if (!Number.isInteger(parsedStock) || parsedStock < 0) {
        return res.status(422).json({
          message: "Stock must be a non-negative integer.",
        });
      }
    }

    let parsedInStock: boolean | undefined = undefined;
    if (rawInStock !== undefined && rawInStock !== null) {
      parsedInStock = parseBool(rawInStock);
      if (parsedInStock === undefined) {
        return res.status(422).json({
          message: "inStock must be a boolean or the string \"true\", \"false\", \"1\", or \"0\".",
        });
      }
    }

    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: {
        stock: parsedStock !== undefined ? parsedStock : undefined,
        inStock: parsedInStock !== undefined ? parsedInStock : undefined,
      },
      include: {
        images: true,
      },
    });

    return res.json(formatProductResponse(updatedProduct));
  } catch (error) {
    console.error("Patch admin product inventory API error:", error);

    return res.status(500).json({
      message: "Unable to update product inventory.",
    });
  }
});

app.delete("/api/admin/products/:id", authenticateAdmin, async (req, res) => {
  try {
    const rawProductId = req.params.id;

    if (typeof rawProductId !== "string" || !/^\d+$/.test(rawProductId)) {
      return res.status(400).json({
        message: "Invalid product ID.",
      });
    }

    const productId = BigInt(rawProductId);

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { images: true },
    });

    if (!product) {
      return res.status(404).json({
        message: "Product not found.",
      });
    }

    const relatedOrderItem = await prisma.orderItem.findFirst({
      where: {
        productId,
      },
    });

    if (relatedOrderItem) {
      return res.status(409).json({
        message: "This product is referenced by an order and cannot be deleted. Hide it instead by marking it inactive.",
      });
    }

    await prisma.$transaction(async (tx) => {
      // Wishlist entries are removed with the product, so a customer's wishlist
      // can no longer block the admin from deleting it.
      await tx.wishlist.deleteMany({
        where: {
          productId,
        },
      });

      await tx.productImage.deleteMany({
        where: {
          productId,
        },
      });

      await tx.product.delete({
        where: { id: productId },
      });
    });

    removeStoredFile(product.image);
    for (const img of product.images) {
      removeStoredFile(img.image);
    }

    return res.json({
      message: "Product deleted successfully.",
    });
  } catch (error) {
    console.error("Delete admin product API error:", error);

    return res.status(500).json({
      message: "Unable to delete product.",
    });
  }
});

app.get("/api/addresses", authenticateCustomer, async (req, res) => {
  try {
    const customerId = res.locals.customerId as bigint;

    const addresses = await prisma.address.findMany({
      where: {
        userId: customerId,
      },
      orderBy: {
        isDefault: "desc",
      },
    });

    const formattedAddresses = addresses.map((address) => ({
      id: address.id.toString(),
      user_id: address.userId.toString(),
      name: address.name,
      phone: address.phone,
      address_line: address.addressLine,
      city: address.city,
      state: address.state,
      pin_code: address.pinCode,
      landmark: address.landmark,
      is_default: address.isDefault,
      created_at: address.createdAt,
      updated_at: address.updatedAt,
    }));

    return res.json(formattedAddresses);
  } catch (error) {
    console.error("Get customer addresses API error:", error);

    return res.status(500).json({
      message: "Unable to fetch addresses.",
    });
  }
});

app.post("/api/addresses", authenticateCustomer, async (req, res) => {
  try {
    const customerId = res.locals.customerId as bigint;
    const name = req.body.name;
    const phone = req.body.phone;
    const addressLine = req.body.addressLine ?? req.body.address_line;
    const city = req.body.city;
    const state = req.body.state;
    const pinCode = req.body.pinCode ?? req.body.pin_code;
    const landmark = req.body.landmark;
    const isDefault = req.body.isDefault !== undefined ? req.body.isDefault : req.body.is_default;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof phone !== "string" ||
      !phone.trim() ||
      typeof addressLine !== "string" ||
      !addressLine.trim() ||
      typeof city !== "string" ||
      !city.trim() ||
      typeof state !== "string" ||
      !state.trim() ||
      typeof pinCode !== "string" ||
      !pinCode.trim()
    ) {
      return res.status(422).json({
        message: "Name, phone, address line, city, state, and pin code are required.",
      });
    }

    if (typeof isDefault !== "undefined" && typeof isDefault !== "boolean") {
      return res.status(422).json({
        message: "isDefault must be a boolean.",
      });
    }

    const addressLengthError = validateAddressLengths({ name, phone, addressLine, city, state, pinCode, landmark });

    if (addressLengthError) {
      return res.status(422).json({
        message: addressLengthError,
      });
    }

    const normalizedLandmark = typeof landmark === "string" ? landmark.trim() : null;

    const address = await prisma.$transaction(async (tx) => {
      if (isDefault === true) {
        await tx.address.updateMany({
          where: {
            userId: customerId,
            isDefault: true,
          },
          data: {
            isDefault: false,
          },
        });
      }

      return await tx.address.create({
        data: {
          userId: customerId,
          name: name.trim(),
          phone: phone.trim(),
          addressLine: addressLine.trim(),
          city: city.trim(),
          state: state.trim(),
          pinCode: pinCode.trim(),
          landmark: normalizedLandmark,
          isDefault: Boolean(isDefault),
        },
      });
    });

    return res.status(201).json({
      id: address.id.toString(),
      user_id: address.userId.toString(),
      name: address.name,
      phone: address.phone,
      address_line: address.addressLine,
      city: address.city,
      state: address.state,
      pin_code: address.pinCode,
      landmark: address.landmark,
      is_default: address.isDefault,
      created_at: address.createdAt,
      updated_at: address.updatedAt,
    });
  } catch (error) {
    console.error("Create customer address API error:", error);

    return res.status(500).json({
      message: "Unable to create address.",
    });
  }
});

app.put("/api/addresses/:id", authenticateCustomer, async (req, res) => {
  try {
    const customerId = res.locals.customerId as bigint;
    const rawAddressId = req.params.id;

    if (typeof rawAddressId !== "string" || !/^\d+$/.test(rawAddressId)) {
      return res.status(400).json({
        message: "Invalid address ID.",
      });
    }

    const addressId = BigInt(rawAddressId);
    const name = req.body.name;
    const phone = req.body.phone;
    const addressLine = req.body.addressLine ?? req.body.address_line;
    const city = req.body.city;
    const state = req.body.state;
    const pinCode = req.body.pinCode ?? req.body.pin_code;
    const landmark = req.body.landmark;
    const isDefault = req.body.isDefault !== undefined ? req.body.isDefault : req.body.is_default;

    const existingAddress = await prisma.address.findUnique({
      where: { id: addressId },
    });

    if (!existingAddress) {
      return res.status(404).json({
        message: "Address not found.",
      });
    }

    if (existingAddress.userId !== customerId) {
      return res.status(403).json({
        message: "You are not allowed to update this address.",
      });
    }

    if (
      name !== undefined &&
      (typeof name !== "string" || !name.trim())
    ) {
      return res.status(422).json({
        message: "Name must be a non-empty string.",
      });
    }

    if (
      phone !== undefined &&
      (typeof phone !== "string" || !phone.trim())
    ) {
      return res.status(422).json({
        message: "Phone must be a non-empty string.",
      });
    }

    if (
      addressLine !== undefined &&
      (typeof addressLine !== "string" || !addressLine.trim())
    ) {
      return res.status(422).json({
        message: "Address line must be a non-empty string.",
      });
    }

    if (
      city !== undefined &&
      (typeof city !== "string" || !city.trim())
    ) {
      return res.status(422).json({
        message: "City must be a non-empty string.",
      });
    }

    if (
      state !== undefined &&
      (typeof state !== "string" || !state.trim())
    ) {
      return res.status(422).json({
        message: "State must be a non-empty string.",
      });
    }

    if (
      pinCode !== undefined &&
      (typeof pinCode !== "string" || !pinCode.trim())
    ) {
      return res.status(422).json({
        message: "Pin code must be a non-empty string.",
      });
    }

    if (
      landmark !== undefined &&
      landmark !== null &&
      typeof landmark !== "string"
    ) {
      return res.status(422).json({
        message: "Landmark must be a string or null.",
      });
    }

    if (
      isDefault !== undefined &&
      typeof isDefault !== "boolean"
    ) {
      return res.status(422).json({
        message: "isDefault must be a boolean.",
      });
    }

    const addressLengthError = validateAddressLengths({ name, phone, addressLine, city, state, pinCode, landmark });

    if (addressLengthError) {
      return res.status(422).json({
        message: addressLengthError,
      });
    }

    const updatedAddress = await prisma.$transaction(async (tx) => {
      if (isDefault === true) {
        await tx.address.updateMany({
          where: {
            userId: customerId,
            isDefault: true,
            id: { not: addressId },
          },
          data: {
            isDefault: false,
          },
        });
      }

      return await tx.address.update({
        where: { id: addressId },
        data: {
          name: name !== undefined ? name.trim() : undefined,
          phone: phone !== undefined ? phone.trim() : undefined,
          addressLine: addressLine !== undefined ? addressLine.trim() : undefined,
          city: city !== undefined ? city.trim() : undefined,
          state: state !== undefined ? state.trim() : undefined,
          pinCode: pinCode !== undefined ? pinCode.trim() : undefined,
          landmark: landmark !== undefined ? (landmark === null ? null : landmark.trim()) : undefined,
          isDefault: isDefault !== undefined ? isDefault : undefined,
        },
      });
    });

    return res.json({
      id: updatedAddress.id.toString(),
      user_id: updatedAddress.userId.toString(),
      name: updatedAddress.name,
      phone: updatedAddress.phone,
      address_line: updatedAddress.addressLine,
      city: updatedAddress.city,
      state: updatedAddress.state,
      pin_code: updatedAddress.pinCode,
      landmark: updatedAddress.landmark,
      is_default: updatedAddress.isDefault,
      created_at: updatedAddress.createdAt,
      updated_at: updatedAddress.updatedAt,
    });
  } catch (error) {
    console.error("Update customer address API error:", error);

    return res.status(500).json({
      message: "Unable to update address.",
    });
  }
});

app.put("/api/addresses/:id/default", authenticateCustomer, async (req, res) => {
  try {
    const customerId = res.locals.customerId as bigint;
    const rawAddressId = req.params.id;

    if (typeof rawAddressId !== "string" || !/^\d+$/.test(rawAddressId)) {
      return res.status(400).json({
        message: "Invalid address ID.",
      });
    }

    const addressId = BigInt(rawAddressId);

    const existingAddress = await prisma.address.findUnique({
      where: { id: addressId },
    });

    if (!existingAddress) {
      return res.status(404).json({
        message: "Address not found.",
      });
    }

    if (existingAddress.userId !== customerId) {
      return res.status(403).json({
        message: "You are not allowed to update this address.",
      });
    }

    const updatedAddress = await prisma.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: {
          userId: customerId,
          isDefault: true,
          id: { not: addressId },
        },
        data: {
          isDefault: false,
        },
      });

      return await tx.address.update({
        where: { id: addressId },
        data: {
          isDefault: true,
        },
      });
    });

    return res.json({
      id: updatedAddress.id.toString(),
      user_id: updatedAddress.userId.toString(),
      name: updatedAddress.name,
      phone: updatedAddress.phone,
      address_line: updatedAddress.addressLine,
      city: updatedAddress.city,
      state: updatedAddress.state,
      pin_code: updatedAddress.pinCode,
      landmark: updatedAddress.landmark,
      is_default: updatedAddress.isDefault,
      created_at: updatedAddress.createdAt,
      updated_at: updatedAddress.updatedAt,
    });
  } catch (error) {
    console.error("Set default customer address API error:", error);
    return res.status(500).json({
      message: "Unable to set default address.",
    });
  }
});

app.delete("/api/addresses/:id", authenticateCustomer, async (req, res) => {
  try {
    const customerId = res.locals.customerId as bigint;
    const rawAddressId = req.params.id;

    if (typeof rawAddressId !== "string" || !/^\d+$/.test(rawAddressId)) {
      return res.status(400).json({
        message: "Invalid address ID.",
      });
    }

    const addressId = BigInt(rawAddressId);

    const existingAddress = await prisma.address.findUnique({
      where: { id: addressId },
    });

    if (!existingAddress) {
      return res.status(404).json({
        message: "Address not found.",
      });
    }

    if (existingAddress.userId !== customerId) {
      return res.status(403).json({
        message: "You are not allowed to delete this address.",
      });
    }

    await prisma.address.delete({
      where: { id: addressId },
    });

    return res.json({
      message: "Address deleted successfully.",
    });
  } catch (error) {
    console.error("Delete customer address API error:", error);

    return res.status(500).json({
      message: "Unable to delete address.",
    });
  }
});

app.get("/api/wishlist", authenticateCustomer, async (req, res) => {
  try {
    const customerId = res.locals.customerId as bigint;

    const wishlist = await prisma.wishlist.findMany({
      where: {
        userId: customerId,
      },
      include: {
        product: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const formattedWishlist = wishlist.map((item) => ({
      id: item.id.toString(),
      product_id: item.productId.toString(),
      user_id: item.userId?.toString() ?? null,
      session_id: item.sessionId,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
      product: {
        id: item.product.id.toString(),
        name: item.product.name,
        description: item.product.description,
        price: item.product.price.toString(),
        original_price: item.product.originalPrice?.toString() ?? null,
        discount: item.product.discount?.toString() ?? null,
        category: item.product.category,
        image: item.product.image,
        badge: item.product.badge,
        fabric: item.product.fabric,
        color: item.product.color,
        length: item.product.length,
        blouse: item.product.blouse,
        occasion: item.product.occasion,
        sku: item.product.sku,
        stock: item.product.stock,
        in_stock: item.product.inStock,
        is_active: item.product.isActive,
        return_exchange: item.product.returnExchange,
        manufactured_by: item.product.manufacturedBy,
        marketed_by: item.product.marketedBy,
      },
    }));

    return res.json(formattedWishlist);
  } catch (error) {
    console.error("Get customer wishlist API error:", error);

    return res.status(500).json({
      message: "Unable to fetch wishlist.",
    });
  }
});

app.post("/api/wishlist", authenticateCustomer, async (req, res) => {
  try {
    const customerId = res.locals.customerId as bigint;
    const rawProductId = req.body.productId !== undefined ? String(req.body.productId) : (req.body.product_id !== undefined ? String(req.body.product_id) : null);

    if (!rawProductId || !/^\d+$/.test(rawProductId)) {
      return res.status(400).json({
        message: "Invalid product ID.",
      });
    }

    const targetProductId = BigInt(rawProductId);

    const product = await prisma.product.findUnique({
      where: { id: targetProductId },
    });

    if (!product) {
      return res.status(404).json({
        message: "Product not found.",
      });
    }

    const existingEntry = await prisma.wishlist.findFirst({
      where: {
        userId: customerId,
        productId: targetProductId,
      },
    });

    if (existingEntry) {
      return res.status(409).json({
        message: "Product is already in the wishlist.",
      });
    }

    const item = await prisma.wishlist.create({
      data: {
        productId: targetProductId,
        userId: customerId,
      },
    });

    return res.status(201).json({
      id: item.id.toString(),
      product_id: item.productId.toString(),
      user_id: item.userId?.toString() ?? null,
      session_id: item.sessionId,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
    });
  } catch (error) {
    console.error("Add customer wishlist API error:", error);

    return res.status(500).json({
      message: "Unable to add product to wishlist.",
    });
  }
});

app.delete("/api/wishlist/:productId", authenticateCustomer, async (req, res) => {
  try {
    const customerId = res.locals.customerId as bigint;
    const rawProductId = req.params.productId;

    if (typeof rawProductId !== "string" || !/^\d+$/.test(rawProductId)) {
      return res.status(400).json({
        message: "Invalid product ID.",
      });
    }

    const productId = BigInt(rawProductId);

    const existingEntry = await prisma.wishlist.findFirst({
      where: {
        userId: customerId,
        productId,
      },
    });

    if (!existingEntry) {
      return res.status(404).json({
        message: "Product not found in wishlist.",
      });
    }

    await prisma.wishlist.delete({
      where: { id: existingEntry.id },
    });

    return res.json({
      message: "Product removed from wishlist.",
    });
  } catch (error) {
    console.error("Delete customer wishlist API error:", error);

    return res.status(500).json({
      message: "Unable to remove product from wishlist.",
    });
  }
});

app.delete("/api/wishlist", authenticateCustomer, async (req, res) => {
  try {
    const customerId = res.locals.customerId as bigint;
    const rawProductId = req.body?.productId ?? req.body?.product_id ?? req.query?.productId ?? req.query?.product_id;

    if (!rawProductId || typeof rawProductId !== "string" && typeof rawProductId !== "number" || !/^\d+$/.test(String(rawProductId))) {
      return res.status(400).json({
        message: "Invalid product ID.",
      });
    }

    const productId = BigInt(String(rawProductId));

    const existingEntry = await prisma.wishlist.findFirst({
      where: {
        userId: customerId,
        productId,
      },
    });

    if (!existingEntry) {
      return res.status(404).json({
        message: "Product not found in wishlist.",
      });
    }

    await prisma.wishlist.delete({
      where: { id: existingEntry.id },
    });

    return res.json({
      message: "Product removed from wishlist successfully.",
    });
  } catch (error) {
    console.error("Delete customer wishlist error:", error);
    return res.status(500).json({
      message: "Unable to remove product from wishlist.",
    });
  }
});

app.get("/api/my-orders", authenticateCustomer, async (req, res) => {
  try {
    const customerId = res.locals.customerId as bigint;

    const orders = await prisma.order.findMany({
      where: {
        userId: customerId,
      },
      include: orderDetailsInclude,
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json(orders.map(formatOrder));
  } catch (error) {
    console.error("Get customer orders API error:", error);

    return res.status(500).json({
      message: "Unable to fetch orders.",
    });
  }
});

app.get("/api/my-orders/:id", authenticateCustomer, async (req, res) => {
  try {
    const customerId = res.locals.customerId as bigint;
    const rawOrderId = req.params.id;

    if (!rawOrderId || typeof rawOrderId !== "string" || !rawOrderId.trim()) {
      return res.status(400).json({
        message: "Invalid order ID.",
      });
    }

    const trimmedOrderId = rawOrderId.trim();
    const isNumeric = /^\d+$/.test(trimmedOrderId);

    const order = isNumeric
      ? await prisma.order.findUnique({
          where: { id: BigInt(trimmedOrderId) },
          include: {
            items: true,
            statusHistory: {
              orderBy: { createdAt: "desc" },
            },
          },
        })
      : await prisma.order.findFirst({
          where: { orderNumber: trimmedOrderId },
          include: {
            items: true,
            statusHistory: {
              orderBy: { createdAt: "desc" },
            },
          },
        });

    if (!order) {
      return res.status(404).json({
        message: "Order not found.",
      });
    }

    if (order.userId !== customerId) {
      return res.status(403).json({
        message: "You are not allowed to access this order.",
      });
    }

    return res.json(formatOrder(order));
  } catch (error) {
    console.error("Get customer order detail API error:", error);

    return res.status(500).json({
      message: "Unable to fetch order details.",
    });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const [products, sales] = await Promise.all([
      prisma.product.findMany({
        where: {
          isActive: true,
        },
        include: {
          images: true,
        },
        orderBy: {
          id: "desc",
        },
      }),
      // Units sold per product, ignoring cancelled orders (used for "Best Selling").
      prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        where: { order: { status: { not: "Cancelled" } } },
      }),
    ]);

    const soldByProduct = new Map(sales.map((row) => [row.productId, row._sum.quantity ?? 0]));

    const formattedProducts = products.map((p) => ({
      sold_count: soldByProduct.get(p.id) ?? 0,
      id: p.id.toString(),
      name: p.name,
      description: p.description,
      price: p.price.toString(),
      original_price: p.originalPrice?.toString() ?? null,
      discount: p.discount?.toString() ?? null,
      category: p.category,
      image: p.image,
      badge: p.badge,
      fabric: p.fabric,
      color: p.color,
      length: p.length,
      blouse: p.blouse,
      occasion: p.occasion,
      sku: p.sku,
      stock: p.stock,
      in_stock: p.inStock,
      is_active: p.isActive,
      return_exchange: p.returnExchange,
      manufactured_by: p.manufacturedBy,
      marketed_by: p.marketedBy,
      images: p.images.map((img) => ({
        id: img.id.toString(),
        product_id: img.productId.toString(),
        image: img.image,
      })),
    }));

    res.json(formattedProducts);
  } catch (error) {
    console.error("Products API error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to fetch products",
    });
  }
});

app.get("/api/categories", async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    return res.json(
      categories.map((category) => ({
        id: category.id.toString(),
        name: category.name,
        description: category.description,
        is_active: category.isActive,
        created_at: category.createdAt,
        updated_at: category.updatedAt,
      }))
    );
  } catch (error) {
    console.error("Public categories API error:", error);

    return res.status(500).json({
      message: "Unable to fetch categories.",
    });
  }
});

app.get("/api/offers", async (req, res) => {
  try {
    const offers = await prisma.offer.findMany({
      where: {
        status: {
          equals: "Active",
          mode: "insensitive",
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Active offers, including their coupon code, are public: the storefront shows
    // them so customers can use the code.
    return res.json(offers.map(formatOffer));
  } catch (error) {
    console.error("Public offers API error:", error);

    return res.status(500).json({
      message: "Unable to fetch offers.",
    });
  }
});

app.get("/api/videos", async (req, res) => {
  try {
    const videos = await prisma.video.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json(
      videos.map((video) => ({
        id: video.id.toString(),
        title: video.title,
        video: video.video,
        poster: video.poster,
        is_active: video.isActive,
        created_at: video.createdAt,
        updated_at: video.updatedAt,
      }))
    );
  } catch (error) {
    console.error("Public videos API error:", error);

    return res.status(500).json({
      message: "Unable to fetch videos.",
    });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const rawProductId = req.params.id;

    if (typeof rawProductId !== "string" || !/^\d+$/.test(rawProductId)) {
      return res.status(400).json({
        message: "Invalid product ID.",
      });
    }

    const productId = BigInt(rawProductId);
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        isActive: true,
      },
      include: {
        images: true,
      },
    });

    if (!product) {
      return res.status(404).json({
        message: "Product not found.",
      });
    }

    return res.json({
      id: product.id.toString(),
      name: product.name,
      description: product.description,
      price: product.price.toString(),
      original_price: product.originalPrice?.toString() ?? null,
      discount: product.discount?.toString() ?? null,
      category: product.category,
      image: product.image,
      badge: product.badge,
      fabric: product.fabric,
      color: product.color,
      length: product.length,
      blouse: product.blouse,
      occasion: product.occasion,
      sku: product.sku,
      stock: product.stock,
      in_stock: product.inStock,
      is_active: product.isActive,
      return_exchange: product.returnExchange,
      manufactured_by: product.manufacturedBy,
      marketed_by: product.marketedBy,
      images: product.images.map((img) => ({
        id: img.id.toString(),
        product_id: img.productId.toString(),
        image: img.image,
      })),
    });
  } catch (error) {
    console.error("Public product detail API error:", error);

    return res.status(500).json({
      message: "Unable to fetch product details.",
    });
  }
});

app.get("/api/admin/dashboard", authenticateAdmin, async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const isThisMonth = (date: Date | null) => !!date && date >= monthStart;

    const [products, orders, customers] = await Promise.all([
      prisma.product.findMany({
        select: {
          stock: true,
          createdAt: true,
        },
      }),
      prisma.order.findMany({
        select: {
          status: true,
          totalAmount: true,
          createdAt: true,
        },
      }),
      prisma.user.findMany({
        where: {
          isAdmin: false,
        },
        select: {
          createdAt: true,
        },
      }),
    ]);

    // Cancelled orders are not sales.
    const liveOrders = orders.filter((order) => order.status !== "Cancelled");
    const sumAmounts = (list: typeof orders) =>
      list.reduce((sum, order) => sum.add(order.totalAmount ?? 0), new Prisma.Decimal(0)).toNumber();

    const totalSalesAmount = sumAmounts(liveOrders);
    const monthSalesAmount = sumAmounts(liveOrders.filter((order) => isThisMonth(order.createdAt)));
    const ordersThisMonth = orders.filter((order) => isThisMonth(order.createdAt)).length;
    const productsThisMonth = products.filter((product) => isThisMonth(product.createdAt)).length;
    const customersThisMonth = customers.filter((customer) => isThisMonth(customer.createdAt)).length;
    const pendingOrderCount = orders.filter((order) => (order.status ?? "").toLowerCase() === "pending").length;
    const lowStockCount = products.filter((product) => (product.stock ?? 0) <= 5).length;
    const outOfStockCount = products.filter((product) => (product.stock ?? 0) <= 0).length;
    const rupees = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;

    return res.json({
      total_sarees: {
        count: products.length,
        change: `+${productsThisMonth} this month`,
      },
      total_orders: {
        count: orders.length,
        change: `+${ordersThisMonth} this month`,
      },
      total_sales: {
        amount: totalSalesAmount,
        formatted: rupees(totalSalesAmount),
        change: `${rupees(monthSalesAmount)} this month`,
      },
      pending_orders: {
        count: pendingOrderCount,
        urgent: pendingOrderCount,
        change: pendingOrderCount > 0 ? `${pendingOrderCount} pending` : "All fulfilled",
      },
      low_stock: {
        count: lowStockCount,
        out_of_stock: outOfStockCount,
        change: lowStockCount > 0 ? `${lowStockCount} items low, ${outOfStockCount} out` : "Stock healthy",
      },
      customers: {
        count: customers.length,
        change: `+${customersThisMonth} this month`,
      },
    });
  } catch (error) {
    console.error("Get admin dashboard API error:", error);

    return res.status(500).json({
      message: "Unable to fetch dashboard statistics.",
    });
  }
});

app.get("/api/orders", authenticateAdmin, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      include: {
        items: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const formattedOrders = orders.map((order) => ({
      id: order.id.toString(),
      order_number: order.orderNumber,
      customer_name: order.customerName,
      customer_phone: order.customerPhone,
      customer_address: order.customerAddress,
      ...orderMoneyFields(order),
      total_amount: order.totalAmount.toString(),
      amount: order.totalAmount.toString(),
      status: order.status,
      payment_status: order.paymentStatus,
      expected_delivery_date: order.expectedDeliveryDate,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
      items: order.items.map((item) => ({
        id: item.id.toString(),
        order_id: item.orderId.toString(),
        product_id: item.productId.toString(),
        product_name: item.productName,
        quantity: item.quantity,
        price: item.price.toString(),
      })),
    }));

    res.json(formattedOrders);
  } catch (error) {
    console.error("Orders API error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to fetch orders",
    });
  }
});

class InsufficientStockError extends Error {
  constructor(public readonly productName: string) {
    super(`Insufficient stock for product ${productName}.`);
    this.name = "InsufficientStockError";
  }
}

app.post("/api/orders", authenticateCustomer, async (req, res) => {
  try {
    const customerId = res.locals.customerId as bigint;
    const rawAddressId = req.body.addressId ?? req.body.address_id;
    const { items } = req.body;

    const normalizedAddressId = typeof rawAddressId === "string" || typeof rawAddressId === "number"
      ? String(rawAddressId)
      : null;

    // The delivery details copied onto the order. Either a saved address the
    // customer owns (address_id), or details typed at checkout. Typed details are
    // used for this order only and are NOT saved to the address book here: the
    // checkout saves them separately when the customer ticks "save to account".
    let selectedAddress: {
      name: string;
      phone: string;
      addressLine: string;
      city: string;
      state: string;
      pinCode: string;
      landmark: string | null;
    } | null = null;

    if (normalizedAddressId !== null) {
      if (!/^\d+$/.test(normalizedAddressId)) {
        return res.status(400).json({
          message: "Invalid address ID.",
        });
      }

      const savedAddress = await prisma.address.findUnique({
        where: { id: BigInt(normalizedAddressId) },
      });

      if (!savedAddress) {
        return res.status(404).json({
          message: "Address not found.",
        });
      }

      if (savedAddress.userId !== customerId) {
        return res.status(403).json({
          message: "You are not allowed to create an order for this address.",
        });
      }

      selectedAddress = savedAddress;
    } else {
      const addressLineVal = req.body.addressLine ?? req.body.address_line;
      const cityVal = req.body.city;
      const stateVal = req.body.state;
      const pinCodeVal = req.body.pinCode ?? req.body.pin_code;
      const nameVal = req.body.name ?? req.body.customer_name;
      const phoneVal = req.body.phone ?? req.body.customer_phone;
      const landmarkVal = req.body.landmark;

      const requiredValues = [addressLineVal, cityVal, stateVal, pinCodeVal, nameVal, phoneVal];

      if (!requiredValues.every((value) => typeof value === "string" && value.trim())) {
        return res.status(422).json({
          message: "Name, phone, address line, city, state, and pin code are required.",
        });
      }

      if (landmarkVal !== undefined && landmarkVal !== null && typeof landmarkVal !== "string") {
        return res.status(422).json({
          message: "Landmark must be a string or null.",
        });
      }

      const addressLengthError = validateAddressLengths({
        name: nameVal,
        phone: phoneVal,
        addressLine: addressLineVal,
        city: cityVal,
        state: stateVal,
        pinCode: pinCodeVal,
        landmark: landmarkVal,
      });

      if (addressLengthError) {
        return res.status(422).json({
          message: addressLengthError,
        });
      }

      selectedAddress = {
        name: nameVal.trim(),
        phone: phoneVal.trim(),
        addressLine: addressLineVal.trim(),
        city: cityVal.trim(),
        state: stateVal.trim(),
        pinCode: pinCodeVal.trim(),
        landmark: typeof landmarkVal === "string" && landmarkVal.trim() ? landmarkVal.trim() : null,
      };
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(422).json({
        message: "At least one cart item is required.",
      });
    }

    // Each item costs database work inside the order transaction; cap the size.
    if (items.length > 50) {
      return res.status(422).json({
        message: "An order can contain at most 50 different items.",
      });
    }

    const quantitiesByProduct = new Map<bigint, number>();

    for (const item of items) {
      if (!item || typeof item !== "object") {
        return res.status(422).json({
          message: "Each cart item must be an object.",
        });
      }

      const rawProductId = item.productId !== undefined ? String(item.productId) : (item.product_id !== undefined ? String(item.product_id) : undefined);
      const rawQuantity = item.quantity;

      if (typeof rawProductId !== "string" || !/^\d+$/.test(rawProductId)) {
        return res.status(400).json({
          message: "Invalid product ID.",
        });
      }

      if (!Number.isInteger(rawQuantity) || rawQuantity <= 0) {
        return res.status(422).json({
          message: "Each item quantity must be a positive integer.",
        });
      }

      const productId = BigInt(rawProductId);
      const quantity = Number(rawQuantity);
      const currentQuantity = quantitiesByProduct.get(productId) ?? 0;
      quantitiesByProduct.set(productId, currentQuantity + quantity);
    }

    const productIds = [...quantitiesByProduct.keys()];

    const products = await prisma.product.findMany({
      where: {
        id: {
          in: productIds,
        },
      },
    });

    if (products.length !== productIds.length) {
      return res.status(404).json({
        message: "One or more products were not found.",
      });
    }

    const productMap = new Map(products.map((product) => [product.id, product]));
    let totalAmount = new Prisma.Decimal(0);
    const orderItems = [] as Array<{
      productId: bigint;
      productName: string;
      quantity: number;
      price: Prisma.Decimal;
    }>;

    for (const [productId, quantity] of quantitiesByProduct.entries()) {
      const product = productMap.get(productId);

      if (!product) {
        return res.status(404).json({
          message: "One or more products were not found.",
        });
      }

      // Same rule as the storefront: buyable only when visible, marked in stock, and units remain.
      if (!product.isActive || !product.inStock) {
        return res.status(422).json({
          message: `Product ${product.name} is currently unavailable.`,
        });
      }

      if (product.stock < quantity) {
        return res.status(422).json({
          message: `Insufficient stock for product ${product.name}.`,
        });
      }

      totalAmount = totalAmount.add(product.price.mul(quantity));
      orderItems.push({
        productId,
        productName: product.name,
        quantity,
        price: product.price,
      });
    }

    // Shipping comes from the admin's store settings, so the saved total matches what checkout shows.
    const storeSettings = await prisma.storeSetting.findFirst({
      select: { shippingFee: true, freeShippingThreshold: true },
    });
    const subtotalAmount = totalAmount;
    const shippingAmount = calculateShipping(subtotalAmount, storeSettings);

    // Coupon: checked and calculated here on the server, never taken from the browser.
    const rawCouponCode = req.body.couponCode ?? req.body.coupon_code;
    let discountAmount = new Prisma.Decimal(0);
    let appliedCouponCode: string | null = null;

    if (typeof rawCouponCode === "string" && rawCouponCode.trim()) {
      const coupon = await applyCoupon(rawCouponCode, subtotalAmount);

      if ("error" in coupon) {
        return res.status(422).json({ message: coupon.error });
      }

      discountAmount = coupon.discount;
      appliedCouponCode = coupon.offer.code;
    }

    totalAmount = subtotalAmount.sub(discountAmount).add(shippingAmount);

    // Razorpay's minimum charge is 100 paise (₹1). A coupon can bring the total
    // below that, so refuse such an order instead of failing at payment time.
    if (isRazorpayConfigured && totalAmount.lessThan(1)) {
      return res.status(422).json({
        message: "The order total must be at least ₹1 to pay online. Please remove the coupon or add another item.",
      });
    }

    // Random suffix so two orders in the same millisecond cannot share a number.
    const orderNumber = `ORD-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const customerAddressText = [
      selectedAddress.addressLine,
      selectedAddress.city,
      selectedAddress.state,
      selectedAddress.pinCode,
      selectedAddress.landmark,
    ]
      .filter(Boolean)
      .join(", ");

    const createdOrder = await prisma.$transaction(async (tx) => {
      for (const [productId, quantity] of quantitiesByProduct.entries()) {
        // Conditional decrement: the row is only updated if enough stock is
        // still available at write time. This closes the race where two
        // concurrent orders both pass the earlier stock check and oversell.
        const { count } = await tx.product.updateMany({
          where: {
            id: productId,
            isActive: true,
            inStock: true,
            stock: {
              gte: quantity,
            },
          },
          data: {
            stock: {
              decrement: quantity,
            },
          },
        });

        if (count === 0) {
          // Throwing rolls back every decrement already made in this transaction.
          throw new InsufficientStockError(productMap.get(productId)?.name ?? productId.toString());
        }
      }

      const order = await tx.order.create({
        data: {
          userId: customerId,
          orderNumber,
          customerName: selectedAddress.name,
          customerPhone: selectedAddress.phone,
          customerAddress: customerAddressText,
          totalAmount: new Prisma.Decimal(totalAmount.toFixed(2)),
          subtotalAmount: new Prisma.Decimal(subtotalAmount.toFixed(2)),
          shippingAmount: new Prisma.Decimal(shippingAmount.toFixed(2)),
          discountAmount: new Prisma.Decimal(discountAmount.toFixed(2)),
          couponCode: appliedCouponCode,
          status: "Pending",
          paymentStatus: "Pending",
          expectedDeliveryDate: new Date(Date.now() + DELIVERY_TIMELINE_DAYS * 24 * 60 * 60 * 1000),
        },
      });

      await tx.orderItem.createMany({
        data: orderItems.map((item) => ({
          orderId: order.id,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          price: item.price,
        })),
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: "Pending",
          note: "Order placed.",
        },
      });

      return await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: {
          items: true,
          statusHistory: {
            orderBy: {
              createdAt: "desc",
            },
          },
        },
      });
    });

    // Online payment: open a Razorpay order for the total. The customer pays in
    // the Razorpay popup; /api/payments/razorpay/verify (or the webhook) marks it paid.
    let payment: Record<string, unknown> | null = null;

    if (isRazorpayConfigured) {
      try {
        payment = await startRazorpayPayment(createdOrder.id, createdOrder.orderNumber, createdOrder.totalAmount);
      } catch (error) {
        console.error("Razorpay order creation failed:", error);
        await prisma.$transaction((tx) =>
          cancelOrderAndRestock(tx, createdOrder.id, null, "Online payment could not be started.")
        );
        return res.status(502).json({
          message: "Online payment is unavailable right now. Your order was not placed; please try again shortly.",
        });
      }
    } else {
      // No gateway: the order is placed with payment pending; confirm by email now.
      void emailOrderPlaced(createdOrder.id);
    }

    return res.status(201).json({
      id: createdOrder.id.toString(),
      order_number: createdOrder.orderNumber,
      customer_name: createdOrder.customerName,
      customer_phone: createdOrder.customerPhone,
      customer_address: createdOrder.customerAddress,
      subtotal_amount: subtotalAmount.toFixed(2),
      shipping_amount: shippingAmount.toFixed(2),
      discount_amount: discountAmount.toFixed(2),
      coupon_code: appliedCouponCode,
      payment,
      total_amount: createdOrder.totalAmount.toString(),
      amount: createdOrder.totalAmount.toString(),
      status: createdOrder.status,
      payment_status: createdOrder.paymentStatus,
      expected_delivery_date: createdOrder.expectedDeliveryDate,
      created_at: createdOrder.createdAt,
      updated_at: createdOrder.updatedAt,
      items: createdOrder.items.map((item) => ({
        id: item.id.toString(),
        order_id: item.orderId.toString(),
        product_id: item.productId.toString(),
        product_name: item.productName,
        quantity: item.quantity,
        price: item.price.toString(),
      })),
      status_history: createdOrder.statusHistory.map((history) => ({
        id: history.id.toString(),
        order_id: history.orderId.toString(),
        changed_by: history.changedBy?.toString() ?? null,
        status: history.status,
        note: history.note,
        created_at: history.createdAt,
        updated_at: history.updatedAt,
      })),
    });
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return res.status(422).json({
        message: `Insufficient stock for product ${error.productName}.`,
      });
    }

    console.error("Create checkout order API error:", error);

    return res.status(500).json({
      message: "Unable to create order.",
    });
  }
});

app.put("/api/orders/:id", authenticateAdmin, async (req, res) => {
  try {
    const rawOrderId = req.params.id;

if (typeof rawOrderId !== "string" || !/^\d+$/.test(rawOrderId)) {
  return res.status(400).json({
    message: "Invalid order ID.",
  });
}

const orderId = BigInt(rawOrderId);
    const { note } = req.body;
    const requestedStatus = req.body.status;
    const paymentStatus = req.body.paymentStatus ?? req.body.payment_status;

    const allowedStatuses = [
      "Pending",
      "Confirmed",
      "Packed",
      "Shipped",
      "Out for Delivery",
      "Delivered",
      "Cancelled",
    ];

    // No payment gateway is connected, so the admin records payment by hand.
    const allowedPaymentStatuses = ["Pending", "Paid", "Failed", "Refunded"];

    if (requestedStatus === undefined && paymentStatus === undefined) {
      return res.status(422).json({
        message: "Provide an order status or a payment status.",
      });
    }

    if (requestedStatus !== undefined && !allowedStatuses.includes(requestedStatus)) {
      return res.status(422).json({
        message: "Invalid order status.",
      });
    }

    if (paymentStatus !== undefined && !allowedPaymentStatuses.includes(paymentStatus)) {
      return res.status(422).json({
        message: "Invalid payment status.",
      });
    }

    if (
      note !== undefined &&
      note !== null &&
      (typeof note !== "string" || note.length > 1000)
    ) {
      return res.status(422).json({
        message: "Note must be a string with a maximum of 1000 characters.",
      });
    }

    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!existingOrder) {
      return res.status(404).json({
        message: "Order not found.",
      });
    }

    // A payment-only update keeps the current order status.
    const status: string = requestedStatus ?? existingOrder.status;

    // A cancelled order has already returned its stock. Re-opening it would need
    // that stock reserved again, so it is not allowed; place a new order instead.
    if (existingOrder.status === "Cancelled" && status !== "Cancelled") {
      return res.status(422).json({
        message: "A cancelled order cannot be reopened.",
      });
    }

    let justCancelled = false;

    const updatedOrder = await prisma.$transaction(async (tx) => {
  if (status === "Cancelled") {
    // Returns stock and writes the history entry, once, even if two cancels race.
    justCancelled = await cancelOrderAndRestock(tx, orderId, res.locals.adminId, note || "Cancelled by the store.");

    if (paymentStatus !== undefined) {
      await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus },
      });
    }
  } else {
    await tx.order.update({
      where: { id: orderId },
      data: {
        status,
        ...(paymentStatus !== undefined ? { paymentStatus } : {}),
      },
    });

    if (existingOrder.status !== status) {
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          changedBy: res.locals.adminId,
          status,
          note: note || null,
        },
      });
    }
  }

  return await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: true,
      statusHistory: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
});

    // A paid online order that the store cancels is refunded automatically.
    if (justCancelled) {
      await refundIfPaidOnline(orderId);
    }

    // Tell the customer when the order status changes.
    if (existingOrder.status !== status) {
      void emailOrderStatus(orderId, typeof note === "string" && note.trim() ? note.trim() : null);
    }

    const finalOrder = justCancelled
      ? await prisma.order.findUniqueOrThrow({
          where: { id: orderId },
          include: { items: true, statusHistory: { orderBy: { createdAt: "desc" } } },
        })
      : updatedOrder;

    return res.json(formatOrder(finalOrder));
 } catch (error) {
  console.error("Update order API error:", error);

  return res.status(500).json({
    message: "Unable to update order.",
  });
}
});


// ── Customer order actions: pay, cancel, guest tracking ────────────────────────

/** Loads one of the signed-in customer's orders by numeric id, or sends the error response. */
const loadOwnOrder = async (req: express.Request, res: express.Response) => {
  const rawOrderId = req.params.id;

  if (typeof rawOrderId !== "string" || !/^\d+$/.test(rawOrderId)) {
    res.status(400).json({ message: "Invalid order ID." });
    return null;
  }

  const order = await prisma.order.findUnique({ where: { id: BigInt(rawOrderId) } });

  if (!order || order.userId !== (res.locals.customerId as bigint)) {
    // Same answer for "not found" and "someone else's", so ids cannot be probed.
    res.status(404).json({ message: "Order not found." });
    return null;
  }

  return order;
};

// Called by the storefront after the Razorpay popup reports success.
app.post("/api/payments/razorpay/verify", authenticateCustomer, async (req, res) => {
  try {
    const razorpayOrderId = req.body.razorpay_order_id;
    const razorpayPaymentId = req.body.razorpay_payment_id;
    const signature = req.body.razorpay_signature;

    if (
      typeof razorpayOrderId !== "string" ||
      typeof razorpayPaymentId !== "string" ||
      typeof signature !== "string" ||
      !verifyCheckoutSignature(razorpayOrderId, razorpayPaymentId, signature)
    ) {
      return res.status(400).json({ message: "Payment could not be verified." });
    }

    const order = await prisma.order.findUnique({ where: { razorpayOrderId } });

    if (!order || order.userId !== (res.locals.customerId as bigint)) {
      return res.status(404).json({ message: "Order not found." });
    }

    const paidOrderId = await markRazorpayOrderPaid(razorpayOrderId, razorpayPaymentId);
    if (paidOrderId) void emailOrderPlaced(paidOrderId);

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: orderDetailsInclude });
    return res.json(formatOrder(fresh));
  } catch (error) {
    console.error("Verify Razorpay payment API error:", error);
    return res.status(500).json({ message: "Unable to verify the payment." });
  }
});

// Pay again for an order whose payment popup was closed or failed.
app.post("/api/my-orders/:id/pay", authenticateCustomer, async (req, res) => {
  try {
    if (!isRazorpayConfigured) {
      return res.status(503).json({ message: "Online payment is not available." });
    }

    const order = await loadOwnOrder(req, res);
    if (!order) return;

    if (order.status === "Cancelled" || order.paymentStatus === "Paid" || order.paymentStatus === "Refunded") {
      return res.status(422).json({ message: "This order cannot be paid." });
    }

    const payment = await startRazorpayPayment(order.id, order.orderNumber, order.totalAmount);
    return res.json({ order_number: order.orderNumber, payment });
  } catch (error) {
    console.error("Retry payment API error:", error);
    return res.status(502).json({ message: "Online payment is unavailable right now. Please try again shortly." });
  }
});

// Customers may cancel until the order is packed. Paid orders are refunded.
app.post("/api/my-orders/:id/cancel", authenticateCustomer, async (req, res) => {
  try {
    const order = await loadOwnOrder(req, res);
    if (!order) return;

    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status)) {
      return res.status(422).json({
        message:
          order.status === "Cancelled"
            ? "This order is already cancelled."
            : "This order has already been packed or shipped and can no longer be cancelled. Please contact us.",
      });
    }

    const cancelled = await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction: the store may have packed it meanwhile.
      const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      if (!CUSTOMER_CANCELLABLE_STATUSES.includes(current.status)) return false;
      return cancelOrderAndRestock(tx, order.id, res.locals.customerId as bigint, "Cancelled by the customer.");
    });

    if (!cancelled) {
      return res.status(422).json({ message: "This order can no longer be cancelled." });
    }

    await refundIfPaidOnline(order.id);
    void emailOrderStatus(order.id, "Cancelled at your request.");

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: orderDetailsInclude });
    return res.json(formatOrder(fresh));
  } catch (error) {
    console.error("Customer cancel order API error:", error);
    return res.status(500).json({ message: "Unable to cancel the order." });
  }
});

const trackOrderRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many tracking attempts. Please try again later.",
});

/** Digits only, last 10, so "+91 98765 43210" and "9876543210" match. */
const phoneKey = (phone: string) => phone.replace(/\D/g, "").slice(-10);

// Guest tracking: order number + the phone number used on the order. Returns
// status and items only, no address.
app.get("/api/track-order", trackOrderRateLimit, async (req, res) => {
  try {
    const orderNumber = typeof req.query.order_number === "string" ? req.query.order_number.trim() : "";
    const phone = typeof req.query.phone === "string" ? req.query.phone : "";

    if (!orderNumber || phoneKey(phone).length < 10) {
      return res.status(422).json({ message: "Enter your order number and the 10-digit phone number used on the order." });
    }

    const order = await prisma.order.findUnique({
      where: { orderNumber },
      include: orderDetailsInclude,
    });

    if (!order || phoneKey(order.customerPhone) !== phoneKey(phone)) {
      return res.status(404).json({ message: "No order matches that order number and phone number." });
    }

    const { customer_address: _address, customer_phone: _phone, ...publicOrder } = formatOrder(order);
    return res.json({ ...publicOrder, can_cancel: false });
  } catch (error) {
    console.error("Guest track order API error:", error);
    return res.status(500).json({ message: "Unable to look up the order." });
  }
});

/**
 * Cancel online orders that were never paid, so their stock goes back on sale.
 * Runs every 5 minutes; only touches orders that started a Razorpay payment.
 */
const releaseUnpaidOrders = async () => {
  const cutoff = new Date(Date.now() - UNPAID_ORDER_TIMEOUT_MINUTES * 60 * 1000);

  const stale = await prisma.order.findMany({
    where: {
      razorpayOrderId: { not: null },
      paymentStatus: "Pending",
      status: "Pending",
      createdAt: { lt: cutoff },
    },
    select: { id: true },
    take: 100,
  });

  for (const { id } of stale) {
    await prisma
      .$transaction((tx) => cancelOrderAndRestock(tx, id, null, "Cancelled automatically: payment was not completed."))
      .catch((error) => console.error("Releasing unpaid order failed:", error));
  }
};

if (isRazorpayConfigured) {
  setInterval(() => {
    void releaseUnpaidOrders().catch((error) => console.error("Unpaid order check failed:", error));
  }, 5 * 60 * 1000).unref();
}

// Unknown routes get a JSON 404 instead of Express's HTML page.
app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({
    message: "Not found.",
  });
});

// Final error handler: never send stack traces to the client. Catches upload
// errors, malformed JSON bodies and anything else passed to next(error).
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    // Express recognises error handlers by their four arguments.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: express.NextFunction
  ) => {
    if (res.headersSent) {
      return;
    }

    if (err instanceof HttpError) {
      return res.status(err.status).json({ message: err.message });
    }

    if (err instanceof multer.MulterError) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 422;
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "The uploaded file is too large."
          : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE"
          ? "Too many files, or an unexpected file field."
          : "The upload could not be processed.";

      return res.status(status).json({ message });
    }

    const typed = err as { type?: string; status?: number };

    if (typed?.type === "entity.parse.failed") {
      return res.status(400).json({ message: "The request body is not valid JSON." });
    }

    if (typed?.type === "entity.too.large") {
      return res.status(413).json({ message: "The request body is too large." });
    }

    console.error("Unhandled API error:", err);

    return res.status(500).json({
      message: "Something went wrong.",
    });
  }
);

app.listen(PORT, () => {
  console.log(`Yaale backend running on port ${PORT}`);
});
