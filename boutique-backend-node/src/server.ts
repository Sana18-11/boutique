
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

const productUploadDir = path.join(process.cwd(), "public", "storage", "products");

fs.mkdirSync(productUploadDir, { recursive: true });

const productStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, productUploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`;
    cb(null, uniqueName);
  },
});

const uploadProductImages = multer({
  storage: productStorage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 10,
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed."));
    }

    cb(null, true);
  },
});

const videoUploadDir = path.join(process.cwd(), "public", "storage", "videos");

fs.mkdirSync(videoUploadDir, { recursive: true });

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, videoUploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`;
    cb(null, uniqueName);
  },
});

const uploadVideoFile = multer({
  storage: videoStorage,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB limit
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("video/")) {
      return cb(new Error("Only video files are allowed."));
    }

    cb(null, true);
  },
});

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
app.use(cors());
app.use(express.json());

app.use(
  "/storage",
  express.static(path.join(process.cwd(), "public", "storage"))
);

const PORT = process.env.PORT || 5000;

const authenticateAdmin = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
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

    res.locals.adminId = BigInt(decoded.id);

    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired administrator token.",
    });
  }
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
    res.status(500).json({
      success: false,
      message: "Database connection failed",
    });
  }
});


app.post("/api/admin/login", async (req, res) => {
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

app.post("/api/auth/register", async (req, res) => {
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
    console.error("Customer register API error:", error);

    return res.status(500).json({
      message: "Unable to register account.",
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
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

app.get("/api/admin/offers", authenticateAdmin, async (req, res) => {
  try {
    const offers = await prisma.offer.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json(
      offers.map((offer) => ({
        id: offer.id.toString(),
        title: offer.title,
        type: offer.type,
        value: offer.value,
        description: offer.description,
        status: offer.status,
        created_at: offer.createdAt,
        updated_at: offer.updatedAt,
      }))
    );
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

app.post("/api/contact", async (req, res) => {
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

    const category = await prisma.category.update({
      where: { id: categoryId },
      data: {
        name: name !== undefined ? name.trim() : undefined,
        description:
          description !== undefined
            ? description === null || description === ""
              ? null
              : description.trim()
            : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
      },
    });

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

    const offer = await prisma.offer.create({
      data: {
        title: title.trim(),
        type: type.trim(),
        value: value.trim(),
        description: description.trim(),
        status: status.trim(),
      },
    });

    return res.status(201).json({
      id: offer.id.toString(),
      title: offer.title,
      type: offer.type,
      value: offer.value,
      description: offer.description,
      status: offer.status,
      created_at: offer.createdAt,
      updated_at: offer.updatedAt,
    });
  } catch (error) {
    console.error("Create admin offer API error:", error);

    return res.status(500).json({
      message: "Unable to create offer.",
    });
  }
});

app.post(
  "/api/admin/videos",
  authenticateAdmin,
  (req, res, next) => {
    uploadVideoFile.single("video")(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            message: "The video file is too large for the server. Maximum supported size is 1GB.",
          });
        }
        return res.status(422).json({
          message: err.message || "Failed to upload video.",
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

    const updatedOffer = await prisma.offer.update({
      where: { id: offerId },
      data: {
        title: title !== undefined ? title.trim() : undefined,
        type: type !== undefined ? type.trim() : undefined,
        value: value !== undefined ? value.trim() : undefined,
        description: description !== undefined ? description.trim() : undefined,
        status: status !== undefined ? status.trim() : undefined,
      },
    });

    return res.json({
      id: updatedOffer.id.toString(),
      title: updatedOffer.title,
      type: updatedOffer.type,
      value: updatedOffer.value,
      description: updatedOffer.description,
      status: updatedOffer.status,
      created_at: updatedOffer.createdAt,
      updated_at: updatedOffer.updatedAt,
    });
  } catch (error) {
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

    if (typeof video.video === "string" && !/^https?:\/\//i.test(video.video)) {
      const storagePath = path.join(process.cwd(), "public", "storage", video.video.replace(/^\/+/, ""));
      if (fs.existsSync(storagePath)) {
        const allowedPrefix = path.join(process.cwd(), "public", "storage");
        const normalizedStoragePath = path.resolve(storagePath);
        const normalizedAllowedPrefix = path.resolve(allowedPrefix);

        if (normalizedStoragePath.startsWith(normalizedAllowedPrefix)) {
          try {
            fs.unlinkSync(normalizedStoragePath);
          } catch {
            // Ignore file deletion errors; the DB record is still removed safely.
          }
        }
      }
    }

    await prisma.video.delete({
      where: { id: videoId },
    });

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
    const uploadedImagePaths = uploadedFiles.map(
      file => `products/${file.filename}`
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
    const uploadedImagePaths = uploadedFiles.map(
      file => `products/${file.filename}`
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
            if (images !== undefined) {
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
        message: "This product is referenced by an order and cannot be deleted.",
      });
    }

    const relatedWishlist = await prisma.wishlist.findFirst({
      where: {
        productId,
      },
    });

    if (relatedWishlist) {
      return res.status(409).json({
        message: "This product is currently in a wishlist and cannot be deleted.",
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.productImage.deleteMany({
        where: {
          productId,
        },
      });

      await tx.product.delete({
        where: { id: productId },
      });
    });

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

    return res.json(formattedOrders);
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

    return res.json({
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
      status_history: order.statusHistory.map((history) => ({
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
    console.error("Get customer order detail API error:", error);

    return res.status(500).json({
      message: "Unable to fetch order details.",
    });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
      },
      include: {
        images: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const formattedProducts = products.map((p) => ({
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

    return res.json(
      offers.map((offer) => ({
        id: offer.id.toString(),
        title: offer.title,
        type: offer.type,
        value: offer.value,
        description: offer.description,
        status: offer.status,
        created_at: offer.createdAt,
        updated_at: offer.updatedAt,
      }))
    );
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
    const [productCount, orderCount, customerCount, products, orders] = await Promise.all([
      prisma.product.count(),
      prisma.order.count(),
      prisma.user.count({
        where: {
          isAdmin: false,
        },
      }),
      prisma.product.findMany({
        select: {
          stock: true,
        },
      }),
      prisma.order.findMany({
        select: {
          status: true,
          totalAmount: true,
        },
      }),
    ]);

    const totalSalesAmount = orders.reduce((sum, order) => sum + Number(order.totalAmount ?? 0), 0);
    const pendingOrderCount = orders.filter((order) => (order.status ?? "").toLowerCase() === "pending").length;
    const lowStockCount = products.filter((product) => (product.stock ?? 0) <= 5).length;
    const outOfStockCount = products.filter((product) => (product.stock ?? 0) <= 0).length;

    return res.json({
      total_sarees: {
        count: productCount,
        change: productCount > 0 ? `+${productCount} in collection` : "0 this month",
      },
      total_orders: {
        count: orderCount,
        change: orderCount > 0 ? `+${orderCount} total` : "0 this week",
      },
      total_sales: {
        amount: totalSalesAmount,
        formatted: `₹${totalSalesAmount.toLocaleString("en-IN")}`,
        change: totalSalesAmount > 0 ? `₹${totalSalesAmount.toLocaleString("en-IN")} total` : "₹0 this month",
      },
      pending_orders: {
        count: pendingOrderCount,
        urgent: pendingOrderCount,
        change: pendingOrderCount > 0 ? `${pendingOrderCount} pending` : "All fulfilled",
      },
      low_stock: {
        count: lowStockCount,
        out_of_stock: outOfStockCount,
        change: lowStockCount > 0 ? `${lowStockCount} items low` : "Stock healthy",
      },
      customers: {
        count: customerCount,
        change: customerCount > 0 ? `+${customerCount} total` : "0 new",
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

app.post("/api/orders", authenticateCustomer, async (req, res) => {
  try {
    const customerId = res.locals.customerId as bigint;
    const rawAddressId = req.body.addressId ?? req.body.address_id;
    const { items } = req.body;

    const normalizedAddressId = typeof rawAddressId === "string" || typeof rawAddressId === "number"
      ? String(rawAddressId)
      : null;

    let selectedAddress: any = null;

    if (normalizedAddressId && /^\d+$/.test(normalizedAddressId)) {
      selectedAddress = await prisma.address.findUnique({
        where: { id: BigInt(normalizedAddressId) },
      });

      if (selectedAddress && selectedAddress.userId !== customerId) {
        return res.status(403).json({
          message: "You are not allowed to create an order for this address.",
        });
      }
    }

    if (!selectedAddress) {
      const addressLineVal = req.body.addressLine ?? req.body.address_line ?? req.body.customer_address;
      const cityVal = req.body.city;
      const stateVal = req.body.state;
      const pinCodeVal = req.body.pinCode ?? req.body.pin_code;
      const nameVal = req.body.name ?? req.body.customer_name;
      const phoneVal = req.body.phone ?? req.body.customer_phone;
      const landmarkVal = req.body.landmark;

      if (addressLineVal && cityVal && stateVal && pinCodeVal && nameVal && phoneVal) {
        selectedAddress = await prisma.address.create({
          data: {
            userId: customerId,
            name: String(nameVal).trim(),
            phone: String(phoneVal).trim(),
            addressLine: String(addressLineVal).trim(),
            city: String(cityVal).trim(),
            state: String(stateVal).trim(),
            pinCode: String(pinCodeVal).trim(),
            landmark: landmarkVal ? String(landmarkVal).trim() : null,
            isDefault: false,
          },
        });
      } else {
        return res.status(400).json({
          message: "Invalid address ID or incomplete address details.",
        });
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(422).json({
        message: "At least one cart item is required.",
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

      if (!product.isActive) {
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

    const orderNumber = `ORD-${Date.now()}-${customerId.toString().slice(-6)}`;
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
        await tx.product.update({
          where: { id: productId },
          data: {
            stock: {
              decrement: quantity,
            },
          },
        });
      }

      const order = await tx.order.create({
        data: {
          userId: customerId,
          orderNumber,
          customerName: selectedAddress.name,
          customerPhone: selectedAddress.phone,
          customerAddress: customerAddressText,
          totalAmount: new Prisma.Decimal(totalAmount.toFixed(2)),
          status: "Pending",
          paymentStatus: "Pending",
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

    return res.status(201).json({
      id: createdOrder.id.toString(),
      order_number: createdOrder.orderNumber,
      customer_name: createdOrder.customerName,
      customer_phone: createdOrder.customerPhone,
      customer_address: createdOrder.customerAddress,
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
    const { status, note } = req.body;

    const allowedStatuses = [
      "Pending",
      "Confirmed",
      "Packed",
      "Shipped",
      "Out for Delivery",
      "Delivered",
      "Cancelled",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(422).json({
        message: "Invalid order status.",
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

    const updatedOrder = await prisma.$transaction(async (tx) => {
  await tx.order.update({
    where: { id: orderId },
    data: { status },
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

    return res.json({
      id: updatedOrder.id.toString(),
      order_number: updatedOrder.orderNumber,
      customer_name: updatedOrder.customerName,
      customer_phone: updatedOrder.customerPhone,
      customer_address: updatedOrder.customerAddress,
      total_amount: updatedOrder.totalAmount.toString(),
      amount: updatedOrder.totalAmount.toString(),
      status: updatedOrder.status,
      payment_status: updatedOrder.paymentStatus,
      expected_delivery_date: updatedOrder.expectedDeliveryDate,
      created_at: updatedOrder.createdAt,
      updated_at: updatedOrder.updatedAt,
      items: updatedOrder.items.map((item) => ({
        id: item.id.toString(),
        order_id: item.orderId.toString(),
        product_id: item.productId.toString(),
        product_name: item.productName,
        quantity: item.quantity,
        price: item.price.toString(),
      })),
      status_history: updatedOrder.statusHistory.map((history) => ({
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
  console.error("Update order API error:", error);

  return res.status(500).json({
    message: "Unable to update order.",
  });
}
});


app.listen(PORT, () => {
  console.log(`Yaale backend running on port ${PORT}`);
});
