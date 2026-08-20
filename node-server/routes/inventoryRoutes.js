const express = require("express");
const router = express.Router();

const controller = require("../controllers/inventoryController");
const { requireAdmin } = require("../middleware/adminAuth");

router.get("/", controller.getInventory);

router.put("/:id", requireAdmin, controller.updateInventory);

module.exports = router;
