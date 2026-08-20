// Long-running server entry point for local development, Render, or Railway.
// Vercel continues to use the serverless function at /api/index.js.
require("dotenv").config();

const app = require("./app");
const db = require("./config/db");

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

// Avoid stale keep-alive sockets when Render's proxy reuses connections.
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; finishing active requests`);
  server.close(async () => {
    try {
      await db.end();
      process.exit(0);
    } catch (error) {
      console.error("Failed to close the database pool cleanly:", error.message);
      process.exit(1);
    }
  });
  // Render's configured shutdown window is 30 seconds.
  setTimeout(() => process.exit(1), 25_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
