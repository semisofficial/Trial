const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const sql = fs.readFileSync(path.join(__dirname, '../menu_offers.sql'), 'utf8');

test('migration preserves named legacy categories and creates missing categories', async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE categories(id text PRIMARY KEY, name text NOT NULL); INSERT INTO categories VALUES ('fried', 'Client fried label')");
    await db.exec(sql);
    await db.exec(sql);
    const rows = (await db.query('SELECT id,name FROM categories ORDER BY id')).rows;
    assert.deepEqual(rows, [
      { id: 'fried', name: 'Client fried label' },
      { id: 'frozen', name: 'Frozen Snacks' },
      { id: 'mains', name: 'Biriyani & Curries' },
    ]);
  } finally { await db.close(); }
});
