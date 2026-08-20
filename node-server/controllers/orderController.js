const orderModel = require("../models/orderModel");
const { sendInvoiceNotification, sendDeclineNotification } = require("../utils/whatsappNotify");
const { sendNewOrderNotification } = require("../utils/emailNotify");

// Meta/WhatsApp notifications are paused by default. The integration code is
// intentionally retained and can be re-enabled later by setting this exact
// environment variable to "true" in the backend deployment.
const WHATSAPP_NOTIFICATIONS_ENABLED =
  process.env.WHATSAPP_NOTIFICATIONS_ENABLED === "true";
const ADMIN_EMAIL_TIMEOUT_MS = 5_000;

async function waitForAdminEmail() {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error("Admin email notification timed out after 5 seconds");
      error.code = "EMAIL_TIMEOUT";
      reject(error);
    }, ADMIN_EMAIL_TIMEOUT_MS);
    timeoutId.unref?.();
  });

  try {
    return await Promise.race([sendNewOrderNotification(), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

const getOrders = async (req, res) => {
  try {
    const orders = await orderModel.getOrders();
    res.json({ success: true, data: orders });
  } catch (err) {
    console.error("❌ Failed to fetch orders:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch orders" });
  }
};

const createOrder = async (req, res) => {
  try {
    const { customer, items } = req.body;
    const orderMode = customer?.mode === "Pickup" ? "Pickup" : "Delivery";

    const order = await orderModel.createOrder({
      customer, items, orderMode, notes: customer?.notes,
    });

    // Notify the admin by email that a new order arrived. Awaiting the send
    // makes sure it completes before this serverless function returns (a
    // fire-and-forget call could be killed mid-flight) — but a send failure
    // never fails the order itself, it's only logged.
    try {
      await waitForAdminEmail();
    } catch (err) {
      console.error("❌ Failed to send admin new-order email:", err.message);
    }

    res.status(201).json({ success: true, data: order });
  } catch (err) {
    console.error("❌ Failed to create order:", err.message);
    const status = err.code === "INSUFFICIENT_STOCK" ? 409 : err.code === "INVALID_ORDER" ? 400 : 500;
    res.status(status).json({
      success: false,
      code: err.code || "ORDER_CREATION_FAILED",
      message: status === 500 ? "Failed to create order" : err.message,
    });
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const order = await orderModel.updateOrderStatus(id, status);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    // Automatic WhatsApp notifications on genuine status transitions only
    // (guarded by previousStatus, same pattern as the sales-summary block
    // above) — so re-accepting/re-declining an already-accepted/declined
    // order doesn't re-send the message. These are awaited (not
    // fire-and-forget) so the send actually completes before this
    // serverless function returns, rather than risking being killed
    // mid-flight — but a WhatsApp failure never fails the status update
    // itself, it's only logged.
    if (WHATSAPP_NOTIFICATIONS_ENABLED && status === "accepted" && order.previousStatus !== "accepted") {
      if (!order.customer_phone) {
        console.warn(`⚠️ Order ${order.id} has no phone on file — skipped WhatsApp invoice notification`);
      } else if (!process.env.PUBLIC_API_BASE_URL) {
        console.warn("⚠️ PUBLIC_API_BASE_URL not set — skipped WhatsApp invoice notification");
      } else {
        try {
          const invoiceUrl = `${process.env.PUBLIC_API_BASE_URL}/api/invoices/${order.id}?token=${encodeURIComponent(order.invoice_share_token)}`;
          await sendInvoiceNotification(order.customer_phone, order.customer_name || "Customer", invoiceUrl, order.total);
        } catch (err) {
          console.error(`❌ Failed to send accepted-order WhatsApp notification for ${order.id}:`, err.message);
        }
      }
    } else if (WHATSAPP_NOTIFICATIONS_ENABLED && status === "declined" && order.previousStatus !== "declined") {
      if (!order.customer_phone) {
        console.warn(`⚠️ Order ${order.id} has no phone on file — skipped WhatsApp decline notification`);
      } else {
        try {
          await sendDeclineNotification(order.customer_phone, order.customer_name || "Customer");
        } catch (err) {
          console.error(`❌ Failed to send declined-order WhatsApp notification for ${order.id}:`, err.message);
        }
      }
    }

    res.json({ success: true, data: order });
  } catch (err) {
    console.error("❌ Failed to update order:", err.message);
    const statusCode = err.code === "INSUFFICIENT_STOCK" ? 409
      : ["INVALID_ORDER", "INVALID_STATUS_TRANSITION"].includes(err.code) ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      code: err.code,
      message: statusCode === 500 ? "Failed to update order" : err.message,
    });
  }
};

const updatePaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentStatus } = req.body;
    if (!["paid", "unpaid"].includes(paymentStatus)) {
      return res.status(400).json({ success: false, message: "Payment status must be paid or unpaid" });
    }
    const order = await orderModel.updatePaymentStatus(id, paymentStatus);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    res.json({ success: true, data: order });
  } catch (err) {
    console.error("❌ Failed to update payment status:", err.message);
    res.status(500).json({ success: false, message: "Failed to update payment status" });
  }
};

const deleteOrder = async (req, res) => {
  try {
    const deleted = await orderModel.deleteOrder(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: "Order not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to delete order:", err.message);
    res.status(500).json({ success: false, message: "Failed to delete order" });
  }
};

const getArchivedOrders = async (req, res) => {
  try {
    const orders = await orderModel.getArchivedOrders();
    res.json({ success: true, data: orders });
  } catch (err) {
    console.error("❌ Failed to fetch archived orders:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch archived orders" });
  }
};

const archiveOrders = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) {
      return res.status(400).json({ success: false, message: "Between 1 and 200 order IDs are required" });
    }
    const cleanIds = [...new Set(ids.map((id) => typeof id === "string" ? id.trim() : ""))];
    if (cleanIds.some((id) => !id || id.length > 128)) {
      return res.status(400).json({ success: false, message: "One or more order IDs are invalid" });
    }
    const archived = await orderModel.archiveOrders(cleanIds);
    res.json({ success: true, data: archived });
  } catch (err) {
    console.error("❌ Failed to archive orders:", err.message);
    res.status(500).json({ success: false, message: "Failed to archive orders" });
  }
};

// DELETE /api/orders/paid-synced -> permanently removes orders that are
// completed, paid, and already confirmed synced to the Google Sheet. Meant
// as a manual DB-size cleanup action (see /admin's Invoices tab) — the sheet
// is the durable record for these once synced, so the DB copy is disposable.
const deletePaidSyncedOrders = async (req, res) => {
  try {
    const deletedCount = await orderModel.deletePaidSyncedOrders();
    res.json({ success: true, deletedCount });
  } catch (err) {
    console.error("❌ Failed to delete paid+synced orders:", err.message);
    res.status(500).json({ success: false, message: "Failed to delete paid+synced orders" });
  }
};

module.exports = { getOrders, createOrder, updateOrderStatus, updatePaymentStatus, deleteOrder, getArchivedOrders, archiveOrders, deletePaidSyncedOrders };
