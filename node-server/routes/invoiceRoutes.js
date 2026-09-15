const express = require("express");
const router = express.Router();
const { getInvoice, getInvoiceSharePage, getAcceptedInvoiceBatchInfo, getAcceptedInvoicesZip, syncCompletedOrdersToSheet } = require("../controllers/invoiceController");
const { requireAdmin } = require("../middleware/adminAuth");
const { publicInvoiceLimiter } = require("../middleware/rateLimits");

// Apply before authentication/rate limits so failures cannot be cached or indexed.
router.use((req, res, next) => {
  res.set({
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  });
  next();
});

router.get("/batch-info", requireAdmin, getAcceptedInvoiceBatchInfo);
router.get("/batch", requireAdmin, getAcceptedInvoicesZip); // keep above /:orderId
router.post("/sync-sheet", requireAdmin, syncCompletedOrdersToSheet); // keep above /:orderId
router.get("/share/:orderId", publicInvoiceLimiter, getInvoiceSharePage); // keep above /:orderId
router.get("/:orderId", publicInvoiceLimiter, getInvoice);

module.exports = router;
