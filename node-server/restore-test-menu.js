// Explicit local test-data recovery. Never called by the application or deploy.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function readCatalog() {
  return (await import(pathToFileURL(path.resolve(__dirname, '../semis-kitchen/src/menuSnapshot.js')).href)).default;
}

function assertTestTarget(target, confirmation, environment, fileEnvironment) {
  if ([environment, fileEnvironment].includes('production')) throw new Error('Test-menu recovery is disabled in production.');
  if (confirmation !== target) throw new Error('Preview first, then confirm the exact disposable test target with --confirm-test-target=HOST:PORT/DATABASE.');
}

function testConnectionTarget(connectionString) {
  const url = new URL(connectionString);
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
    throw new Error('Use a PostgreSQL connection URL with an explicit hostname and database.');
  }
  // pg accepts query-string host/database/port/options overrides. Reject them
  // so the operator sees and confirms exactly the target we will connect to.
  for (const key of url.searchParams.keys()) {
    if (!['sslmode', 'channel_binding'].includes(key)) {
      throw new Error('Unsupported connection parameter. Use the standard pooled URL without connection-target overrides.');
    }
  }
  url.port ||= '5432'; // Do not inherit a different PGPORT from the shell.
  // Match pg's database-path decoding (reserved escapes remain literal).
  const target = `${decodeURIComponent(url.hostname)}:${url.port}${decodeURI(url.pathname)}`;
  return { target, connectionString: url.toString() };
}

async function tableExists(db, name) {
  return Boolean((await db.query('SELECT to_regclass($1) AS name', [name])).rows[0].name);
}

async function recoverTestMenu(db, migration) {
  const catalog = await readCatalog();
  const exec = (sql) => db.exec ? db.exec(sql) : db.query(sql);
  let inserted = 0;
  await db.query('BEGIN');
  try {
    for (const table of ['customers', 'orders']) {
      if (await tableExists(db, table)) {
        // Prevent an order being created between the safety check and recovery.
        await db.query(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);
        if ((await db.query(`SELECT 1 FROM ${table} LIMIT 1`)).rows.length) {
          throw new Error('Recovery refused: this database contains customer or order data. Use a disposable empty test database or clone the populated branch instead.');
        }
      }
    }
    await exec(migration);
    for (const item of catalog) {
      const result = await db.query(`INSERT INTO menu_items
        (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price,is_combo)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
        WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id=$1 OR (category_id=$2 AND lower(name)=lower($3)))
        ON CONFLICT DO NOTHING RETURNING id`,
      [item.id, item.cat, item.name, item.unit, item.minQty, item.step, Boolean(item.seasonal), item.img || '', item.price, Boolean(item.isCombo)]);
      inserted += result.rows.length;
    }
    // Adds inventory for new rows and links later-imported snacks to existing
    // shared owners without overwriting established manual counts or prices.
    await exec(migration);
    await db.query('COMMIT');
    return { inserted };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const envArg = args.find((arg) => arg.startsWith('--env='))?.slice(6) || '.env';
  const envPath = path.resolve(__dirname, envArg);
  if (!envPath.startsWith(__dirname + path.sep) || !path.basename(envPath).startsWith('.env')) {
    throw new Error('Choose an .env file inside node-server.');
  }
  // Read only DATABASE_URL from the explicitly selected file. Do not silently
  // inherit a different target from a shell or modify any .env file.
  const config = require('dotenv').parse(fs.readFileSync(envPath));
  if (!config.DATABASE_URL) throw new Error('The selected file has no DATABASE_URL.');
  const { target, connectionString } = testConnectionTarget(config.DATABASE_URL);
  const apply = args.includes('--apply');
  if (apply) assertTestTarget(target, args.find((arg) => arg.startsWith('--confirm-test-target='))?.slice(22), process.env.NODE_ENV, config.NODE_ENV);
  process.env.DATABASE_URL = connectionString;
  const pool = require('./config/db');
  let client;
  try {
    client = await pool.connect();
    console.log(`Target: ${target} (credentials hidden)`);
    if (!apply) {
      await client.query('BEGIN READ ONLY');
      const current = await tableExists(client, 'menu_items') ? (await client.query('SELECT id,category_id,name,image FROM menu_items')).rows : [];
      const missing = (await readCatalog()).filter((item) => !current.some((row) => row.id === item.id || (row.category_id === item.cat && row.name.toLowerCase() === item.name.toLowerCase())));
      console.log(`Current menu: ${current.length} items; ${current.filter((row) => row.image).length} photo references. Missing snapshot items: ${missing.length}.`);
      console.log('Preview only. No changes. Snapshot prices are TEST defaults, not verified client prices.');
      console.log('Confirm this is a disposable TEST branch in Neon before using --apply and --confirm-test-target=HOST:PORT/DATABASE.');
      await client.query('COMMIT');
    } else {
      const result = await recoverTestMenu(client, fs.readFileSync(path.join(__dirname, 'menu_offers.sql'), 'utf8'));
      console.log(`Test-menu recovery complete: ${result.inserted} snapshot items inserted. Existing prices and images preserved. Restart the local backend and refresh the page.`);
    }
  } finally { client?.release(); await pool.end(); }
}

if (require.main === module) main().catch((error) => {
  console.error((error.message || error.code || 'Unable to connect to the selected database. Check network access and the selected URL.').replace(/postgres(?:ql)?:\/\/\S+/gi, '[connection string hidden]'));
  process.exitCode = 1;
});
module.exports = { assertTestTarget, testConnectionTarget, recoverTestMenu };
