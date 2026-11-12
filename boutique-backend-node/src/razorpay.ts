// Load .env before reading settings below (imports run before server.ts calls dotenv.config()).
import "dotenv/config";
import crypto from "crypto";

/**
 * Razorpay payments over its REST API (no SDK needed).
 *
 * Settings (.env):
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET   from the Razorpay dashboard (test keys start rzp_test_)
 *   RAZORPAY_WEBHOOK_SECRET                optional; set it when you add the webhook
 *                                          (URL: <backend>/api/payments/razorpay/webhook,
 *                                          events: payment.captured, payment.failed)
 *
 * When the keys are not set, checkout falls back to "payment pending".
 */

const keyId = process.env.RAZORPAY_KEY_ID ?? "";
const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";

export const isRazorpayConfigured = Boolean(keyId && keySecret);
export const razorpayKeyId = keyId;

const authHeader = () => `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

const razorpayRequest = async <T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> => {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  const data = (await response.json().catch(() => ({}))) as T & { error?: { description?: string } };

  if (!response.ok) {
    throw new Error(`Razorpay ${method} ${path} failed (${response.status}): ${data?.error?.description ?? "unknown error"}`);
  }

  return data;
};

/** Create a Razorpay order. Amount is in paise (₹1 = 100). */
export const createRazorpayOrder = (amountPaise: number, receipt: string, notes: Record<string, string>) =>
  razorpayRequest<{ id: string; amount: number; currency: string; status: string }>("POST", "/orders", {
    amount: amountPaise,
    currency: "INR",
    receipt: receipt.slice(0, 40),
    notes,
  });

/** Refund a captured payment in full (amount in paise). */
export const refundRazorpayPayment = (paymentId: string, amountPaise: number) =>
  razorpayRequest<{ id: string; status: string }>("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, {
    amount: amountPaise,
  });

const safeEqualHex = (expected: string, received: string) => {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/** Checks the signature Razorpay Checkout returns after a successful payment. */
export const verifyCheckoutSignature = (razorpayOrderId: string, razorpayPaymentId: string, signature: string) => {
  if (!keySecret) return false;

  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  return safeEqualHex(expected, signature);
};

/** Checks a webhook's X-Razorpay-Signature against the exact raw request body. */
export const verifyWebhookSignature = (rawBody: Buffer, signature: string) => {
  if (!webhookSecret) return false;

  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
};

export const isWebhookConfigured = Boolean(webhookSecret);