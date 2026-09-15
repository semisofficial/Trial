const express = require("express");
const { requireAdmin } = require("../middleware/adminAuth");
const db = require("../config/db");
const offers = require("../models/offerModel");
const router = express.Router();
router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.get("/", async (req, res, next) => {
  try { res.json({ success: true, data: await offers.activeOffers(), serverNow: new Date().toISOString() }); } catch (error) { next(error); }
});
router.post("/", requireAdmin, async (req, res, next) => {
  try { res.status(201).json({ success: true, data: await offers.publishOffer(req.body) }); }
  catch (error) {
    if (error.code === "INVALID_ORDER") return res.status(400).json({ success: false, message: error.message });
    next(error);
  }
});
router.put("/:slug/close", requireAdmin, async (req, res, next) => {
  try {
    const result = await db.query("UPDATE offers SET closed=true WHERE slug=$1 RETURNING slug", [req.params.slug]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Offer not found" });
    res.json({ success: true });
  } catch (error) { next(error); }
});
router.get("/:slug", async (req, res, next) => {
  try {
    const offer = await offers.getOffer(req.params.slug);
    if (!offer) return res.status(410).json({ success: false, message: "This offer has closed or is unavailable." });
    res.json({ success: true, data: offer, serverNow: new Date().toISOString() });
  } catch (error) { next(error); }
});
module.exports = router;
