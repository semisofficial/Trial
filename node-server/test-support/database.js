const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// No .env, network database, or filesystem database is used by these tests.
function testDatabase() {
  const database = new PGlite();
  const queries = [];
  let unavailable = false;
  const query = async (sql, parameters) => {
    if (unavailable) throw new Error('Simulated private database failure');
    queries.push(sql);
    const result = await database.query(sql, parameters);
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  require.cache[require.resolve('../config/db')] = { exports: pool };
  require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } };
  return {
    database, pool, query, queries,
    setUnavailable(value) { unavailable = value; },
    async schema() {
      await database.exec(fs.readFileSync(path.join(__dirname, '../menu_offers.sql'), 'utf8'));
      const security = path.join(__dirname, '../security_hardening.sql');
      if (fs.existsSync(security)) await database.exec(fs.readFileSync(security, 'utf8'));
    },
    close: () => database.close(),
  };
}

module.exports = { testDatabase };
