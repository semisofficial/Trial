const express = require("express");
const {
  COOKIE_NAME,
  configured,
  safeEqual,
  createSessionToken,
  validSession,
  cookieOptions,
  requireAdmin,
} = require("../middleware/adminAuth");
const { adminLoginLimiter } = require("../middleware/rateLimits");

const router = express.Router();

router.post("/login", adminLoginLimiter, (req, res) => {
  if (!configured()) {
    return res.status(503).json({ success: false, message: "Admin authentication is not configured" });
  }
  if (!safeEqual(req.body?.password || "", process.env.ADMIN_PASSWORD)) {
    return res.status(401).json({ success: false, message: "Incorrect passcode" });
  }
  res.cookie(COOKIE_NAME, createSessionToken(), cookieOptions());
  res.json({ success: true, expiresIn: 12 * 60 * 60 });
});

router.get("/session", (req, res) => {
  res.status(validSession(req) ? 200 : 401).json({ success: validSession(req) });
});

router.post("/logout", requireAdmin, (req, res) => {
  const options = cookieOptions();
  delete options.maxAge;
  res.clearCookie(COOKIE_NAME, options);
  res.json({ success: true });
});

module.exports = router;
