const express = require("express");

const router = express.Router();

const menuController = require("../controllers/menuController");
const { requireAdmin } = require("../middleware/adminAuth");
router.get("/admin", requireAdmin, menuController.getAdminMenu);

router.get("/", menuController.getMenu);

module.exports = router;
