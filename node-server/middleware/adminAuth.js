const crypto = require("crypto");
const db = require("../config/db");

const COOKIE_NAME = "semis_admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ACTIVE_SESSIONS = 100;
// Cache only within one HTTP request, so invoice middleware and controllers
// share a lookup without delaying revocation on subsequent requests.
const requestSessions = new WeakMap();

function configured() {
  return Boolean(
    process.env.ADMIN_PASSWORD &&
    process.env.SESSION_SECRET &&
    process.env.SESSION_SECRET.length >= 32
  );
}

function credentialVersion() {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET)
    .update(`admin-session-v2:${process.env.ADMIN_PASSWORD}`).digest("hex");
}

function safeEqual(left, right) {
  const a = crypto.createHash("sha256").update(String(left)).digest();
  const b = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function unavailable(cause) {
  const error = new Error("Staff authentication is temporarily unavailable. Please try again.");
  error.code = "AUTH_UNAVAILABLE";
  error.cause = cause;
  return error;
}

async function createSessionToken() {
  if (!configured()) throw unavailable();
  const token = crypto.randomBytes(32).toString("base64url");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(73425101)");
    const version = credentialVersion();
    // Request-driven cleanup: never keep a timer or a Neon compute awake.
    await client.query("DELETE FROM admin_sessions WHERE expires_at <= now() OR credential_version <> $1", [version]);
    await client.query(`DELETE FROM admin_sessions WHERE token_hash IN
      (SELECT token_hash FROM admin_sessions ORDER BY created_at DESC, token_hash OFFSET $1)`, [MAX_ACTIVE_SESSIONS - 1]);
    await client.query(`INSERT INTO admin_sessions(token_hash, credential_version, expires_at)
      VALUES ($1, $2, now() + interval '12 hours')`, [tokenHash(token), version]);
    await client.query("COMMIT");
    return token;
  } catch (cause) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw unavailable(cause);
  } finally { client?.release(); }
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

async function lookupSession(req) {
  if (!configured()) return false;
  const token = readCookies(req)[COOKIE_NAME];
  if (!/^[A-Za-z0-9_-]{43}$/.test(token || "")) return false;
  try {
    const result = await db.query(`SELECT 1 FROM admin_sessions
      WHERE token_hash = $1 AND credential_version = $2 AND expires_at > now()`,
    [tokenHash(token), credentialVersion()]);
    return result.rowCount === 1;
  } catch (cause) {
    throw unavailable(cause);
  }
}

function validSession(req) {
  if (!requestSessions.has(req)) requestSessions.set(req, lookupSession(req));
  return requestSessions.get(req);
}

async function revokeSession(req) {
  const token = readCookies(req)[COOKIE_NAME];
  if (!/^[A-Za-z0-9_-]{43}$/.test(token || "")) return;
  try {
    await db.query("DELETE FROM admin_sessions WHERE token_hash = $1", [tokenHash(token)]);
    requestSessions.set(req, Promise.resolve(false));
  } catch (cause) { throw unavailable(cause); }
}

function cookieOptions() {
  const production = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  };
}

async function requireAdmin(req, res, next) {
  res.set("Cache-Control", "private, no-store");
  if (!configured()) {
    return res.status(503).json({ success: false, message: "Admin authentication is not configured" });
  }
  if (!await validSession(req)) {
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
  revokeSession,
  cookieOptions,
  requireAdmin,
};
