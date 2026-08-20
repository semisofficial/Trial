const express = require("express");
const router = express.Router();
const { getInvoice, getInvoiceSharePage, getAcceptedInvoiceBatchInfo, getAcceptedInvoicesZip, syncCompletedOrdersToSheet } = require("../controllers/invoiceController");
const { requireAdmin } = require("../middleware/adminAuth");
const { publicInvoiceLimiter } = require("../middleware/rateLimits");

router.get("/batch-info", requireAdmin, getAcceptedInvoiceBatchInfo);
router.get("/batch", requireAdmin, getAcceptedInvoicesZip); // keep above /:orderId
router.post("/sync-sheet", requireAdmin, syncCompletedOrdersToSheet); // keep above /:orderId
router.get("/share/:orderId", publicInvoiceLimiter, getInvoiceSharePage); // keep above /:orderId
router.get("/:orderId", publicInvoiceLimiter, getInvoice);

module.exports = router;
