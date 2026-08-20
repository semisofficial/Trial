const { rateLimit } = require("express-rate-limit");
const { validSession } = require("./adminAuth");

function makeLimiter({ windowMs, limit, message, skipAdmin = false, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests,
    skip: (req) => req.method === "OPTIONS" || (skipAdmin && validSession(req)),
    handler: (req, res) => {
      res.status(429).json({ success: false, code: "RATE_LIMITED", message });
    },
  });
}

const apiLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  message: "Too many requests. Please wait a few minutes and try again.",
});

const orderCreationLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: "Too many order attempts. Please wait 15 minutes and try again.",
});

const publicInvoiceLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipAdmin: true,
  message: "Too many invoice requests. Please wait 15 minutes and try again.",
});

const adminLoginLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  message: "Too many login attempts. Please wait 15 minutes and try again.",
});

module.exports = { apiLimiter, orderCreationLimiter, publicInvoiceLimiter, adminLoginLimiter };
