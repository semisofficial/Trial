const express = require("express");
const router = express.Router();

const controller = require("../controllers/salesController");
const { requireAdmin } = require("../middleware/adminAuth");

router.get("/summary", requireAdmin, controller.getSalesSummary);

module.exports = router;
