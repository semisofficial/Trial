const { Pool } = require("pg");

const MAX_CONNECTIONS = 2;
const IDLE_CLIENT_TIMEOUT_MS = 30_000;
// Allow enough time for a sleeping Neon compute to wake up. The customer app
// renders its bundled menu while this connection is established.
const CONNECTION_TIMEOUT_MS = 15_000;

function databaseConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");

  let parsedUrl;
  try {
    parsedUrl = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL connection string");
  }

  const hostname = parsedUrl.hostname;
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (process.env.NODE_ENV === "production" && hostname.includes("neon.tech") && !hostname.includes("-pooler")) {
    // Never log the connection URL because it contains database credentials.
    console.warn("DATABASE_URL uses a direct Neon endpoint; use Neon's pooled connection string in Vercel.");
  }

  // pg-connection-string can override the explicit `ssl` object when sslmode
  // appears in the URL, and its `require` semantics are changing in pg v9.
  // Remove URL-level TLS switches and enforce certificate verification below.
  if (!local) {
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) {
      parsedUrl.searchParams.delete(key);
    }
  }

  return {
    connectionString: local ? connectionString : parsedUrl.toString(),
    max: MAX_CONNECTIONS,
    idleTimeoutMillis: IDLE_CLIENT_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    allowExitOnIdle: true,
    ssl: local ? false : { rejectUnauthorized: true },
  };
}

// Warm Vercel instances reuse this small pool. pg releases idle clients after
// 30 seconds; Neon's pooled endpoint shares connections across instances.
const pool = new Pool(databaseConfig());

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client:", err.message);
});

module.exports = pool;
