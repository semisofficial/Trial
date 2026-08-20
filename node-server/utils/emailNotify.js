// Admin email notification via Resend.
//
// Fires a simple "new order arrived" email when a customer places an order.
// This replaces the old SSE/realtime event system — the admin no longer needs
// to watch the dashboard; they just get an email.
//
// Configuration lives in env variables (never hardcoded):
//   RESEND_API_KEY  -> your Resend API key (required to send)
//   RESEND_FROM     -> verified sender address (required)
//   ADMIN_EMAIL     -> recipient owned by the restaurant (required)
const { Resend } = require("resend");

async function sendNewOrderNotification() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const recipient = process.env.ADMIN_EMAIL;
  if (!apiKey || !from || !recipient) {
    console.warn("Admin email notification is not fully configured; notification skipped");
    return null;
  }

  const resend = new Resend(apiKey);
  return resend.emails.send({
    from,
    to: recipient,
    subject: "🛎️ New order received",
    html: "<p>A new order has just arrived at <strong>Semi's Kitchen</strong>.</p><p>Please check your admin dashboard to review it.</p>",
  });
}

module.exports = { sendNewOrderNotification };
