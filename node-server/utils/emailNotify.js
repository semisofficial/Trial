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
const { claimAdminEmailAttempt } = require("./notificationBudget");

async function sendNewOrderNotification() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const recipient = process.env.ADMIN_EMAIL;
  if (!apiKey || !from || !recipient) {
    console.warn("Admin email notification is not fully configured; notification skipped");
    return null;
  }

  if (!await claimAdminEmailAttempt()) {
    console.warn("Admin email rate budget reached; order remains available in the dashboard");
    return { skipped: true };
  }
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from,
    to: recipient,
    subject: "🛎️ New order received",
    html: "<p>A new order has arrived at <strong>Semi's Kitchen</strong>.</p><p>Please check your admin dashboard for all pending orders. Notifications for orders arriving close together may be grouped.</p>",
  });
  if (result.error) throw new Error("Admin email provider rejected the notification");
  return result;
}

module.exports = { sendNewOrderNotification };
