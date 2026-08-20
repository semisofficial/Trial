require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const inventoryRoutes = require("./routes/inventoryRoutes");
const menuRoutes = require("./routes/menuRoutes");
const orderRoutes = require("./routes/orderRoutes");
const salesRoutes = require("./routes/salesRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const authRoutes = require("./routes/authRoutes");
const { apiLimiter } = require("./middleware/rateLimits");

const app = express();
app.set("trust proxy", 1);

// Explicitly list all authorized dev and production domains in this array.
// To add a new domain WITHOUT a code change, set the ALLOWED_ORIGINS env var
// on the backend deployment (Vercel -> the project -> Settings -> Environment
// Variables) to a comma-separated list extra origins, e.g.
//   ALLOWED_ORIGINS=https://client-preview.vercel.app
// Origins are matched exactly (scheme + host + port), so include https:// and
// a www vs. bare domain separately if you use both.
const DEFAULT_ORIGINS = [
  "https://semiskitchen.vercel.app",
  "https://semiskitchen.in",
  "https://www.semiskitchen.in"
];

function getAllowedOrigins(nodeEnv = process.env.NODE_ENV, extraOrigins = process.env.ALLOWED_ORIGINS) {
  const developmentOrigins = nodeEnv === "production" ? [] : ["http://localhost:5173"];
  const configuredOrigins = (extraOrigins || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(DEFAULT_ORIGINS.concat(developmentOrigins, configuredOrigins))];
}

// Append any extra origins from env (comma-separated), trimming whitespace so
// entries like "https://client-preview.vercel.app" work.
const allowedOrigins = getAllowedOrigins();

// 2. Use a dynamic matching function for multi-domain support
const corsOptions = {
  origin: function (origin, callback) {
    // Allow non-browser requests (like server-to-server, Postman, or mobile tests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    } else {
      return callback(new Error("CORS policy restriction: Domain unauthorized"), false);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"]
};
app.use(cors(corsOptions));

// 3. Explicitly intercept browser security handshake preflight checks.
// (Express 5 / path-to-regexp v8 requires a NAMED splat instead of a bare "*")
app.options("/*splat", cors(corsOptions));

app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
app.use(express.json({ limit: "32kb", strict: true }));
app.use("/api", apiLimiter);

app.use("/api/admin", authRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/invoices", invoiceRoutes);

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Semis Kitchen API is running"
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Endpoint not found" });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const isCorsError = String(err?.message || "").startsWith("CORS policy restriction");
  const status = isCorsError ? 403 : err?.type === "entity.too.large" ? 413 : 500;
  const message = status === 403 ? "Origin not allowed"
    : status === 413 ? "Request body is too large"
    : "Unexpected server error";
  console.error("Request failed:", err?.message || err);
  res.status(status).json({ success: false, message });
});

module.exports = app;
module.exports.getAllowedOrigins = getAllowedOrigins;
