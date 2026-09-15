const express = require("express");
const {
  COOKIE_NAME,
  configured,
  safeEqual,
  createSessionToken,
  validSession,
  revokeSession,
  cookieOptions,
  requireAdmin,
} = require("../middleware/adminAuth");
const { adminLoginLimiter } = require("../middleware/rateLimits");

const router = express.Router();
router.use((req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });

router.post("/login", adminLoginLimiter, async (req, res) => {
  if (!configured()) {
    return res.status(503).json({ success: false, message: "Admin authentication is not configured" });
  }
  if (!safeEqual(req.body?.password || "", process.env.ADMIN_PASSWORD)) {
    return res.status(401).json({ success: false, message: "Incorrect passcode" });
  }
  res.cookie(COOKIE_NAME, await createSessionToken(), cookieOptions());
  res.json({ success: true, expiresIn: 12 * 60 * 60 });
});

router.get("/session", async (req, res) => {
  const authenticated = await validSession(req);
  res.status(authenticated ? 200 : 401).json({ success: authenticated });
});

router.post("/logout", requireAdmin, async (req, res) => {
  await revokeSession(req);
  const options = cookieOptions();
  delete options.maxAge;
  res.clearCookie(COOKIE_NAME, options);
  res.json({ success: true });
});

module.exports = router;
