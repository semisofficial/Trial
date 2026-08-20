const express = require("express");
const router = express.Router();

const controller = require("../controllers/orderController");
const { requireAdmin } = require("../middleware/adminAuth");
const { orderCreationLimiter } = require("../middleware/rateLimits");

router.get("/", requireAdmin, controller.getOrders);
router.post("/", orderCreationLimiter, controller.createOrder);
router.get("/archived", requireAdmin, controller.getArchivedOrders);
router.post("/archive", requireAdmin, controller.archiveOrders);
router.delete("/paid-synced", requireAdmin, controller.deletePaidSyncedOrders); // keep above /:id
router.put("/:id/status", requireAdmin, controller.updateOrderStatus);
router.put("/:id/payment", requireAdmin, controller.updatePaymentStatus);
router.delete("/:id", requireAdmin, controller.deleteOrder);

module.exports = router;
