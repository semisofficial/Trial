// Atomic migration runner for local SQL files.
// Usage:
//   node migrate.js
//   node migrate.js menu_update.sql

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const backendDir = path.resolve(__dirname);
const requestedName = process.argv[2] || "sales_summary.sql";
const sqlFile = path.resolve(backendDir, requestedName);
const insideBackend = sqlFile.startsWith(`${backendDir}${path.sep}`);

if (!insideBackend || path.extname(sqlFile).toLowerCase() !== ".sql") {
  console.error("Migration must be a .sql file inside node-server.");
  process.exit(1);
}

if (!fs.existsSync(sqlFile) || !fs.statSync(sqlFile).isFile()) {
  console.error(`Migration file not found: ${path.basename(sqlFile)}`);
  process.exit(1);
}

const sql = fs.readFileSync(sqlFile, "utf8").trim();
if (!sql) {
  console.error(`Migration file is empty: ${path.basename(sqlFile)}`);
  process.exit(1);
}

async function run() {
  // Reuse the application's tested SSL, timeout, and pool configuration.
  const db = require("./config/db");
  const client = await db.connect();
  const filename = path.basename(sqlFile);

  try {
    console.log(`Applying ${filename} atomically...`);
    await client.query("BEGIN");
    // node-postgres uses PostgreSQL's simple query protocol for an unparameterized
    // SQL string, so a migration may safely contain multiple statements and
    // dollar-quoted function bodies without fragile semicolon splitting.
    await client.query(sql);
    await client.query("COMMIT");
    console.log(`Migration complete: ${filename}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`Migration rolled back: ${filename}`);
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.end();
  }
}

run().catch((err) => {
  console.error("Migration could not start:", err.message);
  process.exitCode = 1;
});
