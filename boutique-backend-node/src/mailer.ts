// Load .env before reading settings below (imports run before server.ts calls dotenv.config()).
import "dotenv/config";
import nodemailer from "nodemailer";

/**
 * Outgoing email over SMTP (Gmail, Zoho or any mail host).
 *
 * Settings (.env):
 *   SMTP_HOST, SMTP_PORT (465 = SSL, 587 = STARTTLS), SMTP_USER, SMTP_PASS
 *   MAIL_FROM     e.g. "Yaale <orders@yaale.in>" (defaults to SMTP_USER)
 *   FRONTEND_URL  storefront address used in links (default http://localhost:5173)
 *
 * When SMTP is not configured, emails are skipped with a log line, so the shop
 * keeps working; sending never throws into the request that triggered it.
 */

const smtpPort = Number(process.env.SMTP_PORT ?? 587);

export const isMailConfigured = Boolean(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
);

const transporter = isMailConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

const mailFrom = process.env.MAIL_FROM || process.env.SMTP_USER || "";

export const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

/** Escape text for safe use inside the HTML email body. */
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const layout = (title: string, bodyHtml: string) => `
<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px;color:#2c2320">
  <h1 style="font-size:22px;color:#7A0C32;margin:0 0 16px">Yaale</h1>
  <h2 style="font-size:18px;margin:0 0 16px">${escapeHtml(title)}</h2>
  ${bodyHtml}
  <p style="font-size:12px;color:#8a7d75;margin-top:32px">This is an automated email from Yaale.</p>
</div>`;

const sendMail = async (to: string, subject: string, text: string, html: string) => {
  if (!transporter) {
    console.info(`[mail skipped: SMTP not configured] to=${to} subject="${subject}"`);
    return;
  }

  try {
    await transporter.sendMail({ from: mailFrom, to, subject, text, html });
  } catch (error) {
    console.error(`[mail failed] to=${to} subject="${subject}":`, error);
  }
};

const rupees = (amount: string | number) => `₹${Number(amount).toLocaleString("en-IN")}`;

export type OrderEmailData = {
  orderNumber: string;
  customerName: string;
  totalAmount: string;
  status: string;
  paymentStatus: string;
  items: Array<{ productName: string; quantity: number; price: string }>;
};

export const sendOrderPlacedEmail = (to: string, order: OrderEmailData) => {
  const lines = order.items.map((item) => `${item.productName} × ${item.quantity} — ${rupees(item.price)}`);
  const trackUrl = `${frontendUrl}/#order-tracking`;

  return sendMail(
    to,
    `Order ${order.orderNumber} received`,
    [
      `Hi ${order.customerName},`,
      ``,
      `Thank you for your order ${order.orderNumber}.`,
      ...lines,
      `Total: ${rupees(order.totalAmount)} (payment ${order.paymentStatus.toLowerCase()})`,
      ``,
      `Track your order: ${trackUrl}`,
    ].join("\n"),
    layout(
      `Order ${order.orderNumber} received`,
      `<p>Hi ${escapeHtml(order.customerName)},</p>
       <p>Thank you for your order. Here is what you bought:</p>
       <ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
       <p><strong>Total: ${escapeHtml(rupees(order.totalAmount))}</strong> (payment ${escapeHtml(order.paymentStatus.toLowerCase())})</p>
       <p><a href="${escapeHtml(trackUrl)}">Track your order</a></p>`
    )
  );
};

export const sendOrderStatusEmail = (to: string, order: OrderEmailData, note: string | null) =>
  sendMail(
    to,
    `Order ${order.orderNumber}: ${order.status}`,
    [
      `Hi ${order.customerName},`,
      ``,
      `Your order ${order.orderNumber} is now: ${order.status}.`,
      note ? `Note: ${note}` : ``,
      ``,
      `Track your order: ${frontendUrl}/#order-tracking`,
    ].join("\n"),
    layout(
      `Your order is ${order.status}`,
      `<p>Hi ${escapeHtml(order.customerName)},</p>
       <p>Your order <strong>${escapeHtml(order.orderNumber)}</strong> is now <strong>${escapeHtml(order.status)}</strong>.</p>
       ${note ? `<p>${escapeHtml(note)}</p>` : ""}
       <p><a href="${escapeHtml(`${frontendUrl}/#order-tracking`)}">Track your order</a></p>`
    )
  );

export const sendPasswordResetEmail = (to: string, name: string, resetUrl: string) =>
  sendMail(
    to,
    "Reset your Yaale password",
    [
      `Hi ${name},`,
      ``,
      `Use this link to set a new password. It expires in 60 minutes:`,
      resetUrl,
      ``,
      `If you did not ask for this, you can ignore this email.`,
    ].join("\n"),
    layout(
      "Reset your password",
      `<p>Hi ${escapeHtml(name)},</p>
       <p>Use the button below to set a new password. The link expires in 60 minutes.</p>
       <p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#2c2320;color:#f3e3c3;padding:12px 20px;border-radius:999px;text-decoration:none">Set a new password</a></p>
       <p style="font-size:13px;color:#8a7d75">If you did not ask for this, you can ignore this email.</p>`
    )
  );