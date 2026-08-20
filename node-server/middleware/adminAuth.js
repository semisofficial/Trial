const crypto = require("crypto");

const COOKIE_NAME = "semis_admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function configured() {
  return Boolean(
    process.env.ADMIN_PASSWORD &&
    process.env.SESSION_SECRET &&
    process.env.SESSION_SECRET.length >= 32
  );
}

function sign(value) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const a = crypto.createHash("sha256").update(String(left)).digest();
  const b = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

function createSessionToken() {
  const payload = Buffer.from(JSON.stringify({
    exp: Date.now() + SESSION_TTL_MS,
    nonce: crypto.randomBytes(16).toString("base64url"),
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator < 0) return [part, ""];
        try {
          return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
        } catch {
          // A malformed percent-encoded cookie is invalid input, not a server
          // failure. Preserve the name with an unusable empty value.
          return [part.slice(0, separator), ""];
        }
      })
  );
}

function validSession(req) {
  if (!configured()) return false;
  const token = readCookies(req)[COOKIE_NAME];
  if (!token) return false;
  const separator = token.lastIndexOf(".");
  if (separator < 1) return false;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, sign(payload))) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number.isFinite(session.exp) && session.exp > Date.now();
  } catch {
    return false;
  }
}

function cookieOptions() {
  const production = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  return {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  };
}

function requireAdmin(req, res, next) {
  if (!configured()) {
    return res.status(503).json({ success: false, message: "Admin authentication is not configured" });
  }
  if (!validSession(req)) {
    return res.status(401).json({ success: false, message: "Admin authentication required" });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  configured,
  safeEqual,
  createSessionToken,
  validSession,
  cookieOptions,
  requireAdmin,
};
