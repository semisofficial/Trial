const { randomUUID } = require('node:crypto');
const db = require('../config/db');

const FIELDS = `m.id, m.name, m.category_id AS cat, m.unit, m.min_qty AS "minQty",
  m.step_qty AS step, m.is_combo AS "isCombo", m.is_draft AS "isDraft",
  m.item_revision::text AS revision,
  CASE WHEN p.menu_item_id IS NOT NULL THEN '/api/items/' || m.id || '/photo?v=' || p.revision::text
    ELSE m.image END AS img`;
const JOIN = 'FROM menu_items m LEFT JOIN item_photos p ON p.menu_item_id=m.id';
const shape = row => row && ({ ...row, minQty: Number(row.minQty), step: Number(row.step) });
function problem(status, message) { return Object.assign(new Error(message), { status, publicMessage: message }); }

async function list(client = db) {
  return (await client.query(`SELECT ${FIELDS} ${JOIN} WHERE NOT m.retired ORDER BY m.category_id, m.is_combo DESC, m.display_order, m.name, m.id`)).rows.map(shape);
}
async function get(client, id) {
  return shape((await client.query(`SELECT ${FIELDS} ${JOIN} WHERE m.id=$1 AND NOT m.retired`, [id])).rows[0]);
}
async function transaction(fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Serialize catalog membership edits with reorder validation (including inserts).
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('semis-items-catalog',0))");
    const result = await fn(client); await client.query('COMMIT'); return result;
  }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function locked(client, id, revision) {
  const { rows } = await client.query(`SELECT category_id, stock_group_id, item_revision::text AS revision
    FROM menu_items WHERE id=$1 AND NOT retired FOR UPDATE`, [id]);
  if (!rows[0]) throw problem(404, 'Item not found. Reload the list.');
  if (rows[0].revision !== revision) throw problem(409, 'Another admin changed this item. Reload it before saving.');
  return rows[0];
}
async function create(input) {
  return transaction(async client => {
    const id = `item-${randomUUID()}`;
    await client.query(`INSERT INTO menu_items(id, category_id, name, unit, min_qty, step_qty,
      is_combo, is_draft, default_price, seasonal, image, stock_group_id, display_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true,0,false,'',$1,
        (SELECT COALESCE(MAX(display_order),0)+1 FROM menu_items WHERE category_id=$2 AND is_combo=$7))`,
    [id, input.cat, input.name, input.unit, input.minQty, input.step, input.isCombo]);
    await client.query('INSERT INTO inventory(menu_item_id,selling_price,stock,available) VALUES ($1,0,0,false)', [id]);
    return get(client, id);
  });
}
async function update(id, input, revision) {
  return transaction(async client => {
    const old = await locked(client, id, revision);
    if (old.category_id !== input.cat && (old.category_id === 'mains' || input.cat === 'mains')) {
      const siblings = await client.query(`SELECT 1 FROM menu_items WHERE id<>$1 AND
        COALESCE(stock_group_id,id)=$2 LIMIT 1`, [id, old.stock_group_id || id]);
      if ((old.stock_group_id && old.stock_group_id !== id) || siblings.rowCount) {
        throw problem(400, 'A linked snack cannot change to or from mains. Keep its category or create a separate item.');
      }
    }
    await client.query(`UPDATE menu_items SET name=$2, category_id=$3, unit=$4, min_qty=$5,
      step_qty=$6, display_order=CASE WHEN category_id<>$3 OR is_combo<>$7
        THEN (SELECT COALESCE(MAX(display_order),0)+1 FROM menu_items WHERE category_id=$3 AND is_combo=$7)
        ELSE display_order END,
      is_combo=$7, item_revision=gen_random_uuid() WHERE id=$1`,
    [id, input.name, input.cat, input.unit, input.minQty, input.step, input.isCombo]);
    return get(client, id);
  });
}
async function retire(id, revision) {
  return transaction(async client => {
    await locked(client, id, revision);
    await client.query('UPDATE menu_items SET retired=true, item_revision=gen_random_uuid() WHERE id=$1', [id]);
    await client.query('DELETE FROM item_photos WHERE menu_item_id=$1', [id]);
    photoCache.delete(id);
  });
}
async function savePhoto(id, bytes, revision) {
  return transaction(async client => {
    await locked(client, id, revision);
    await client.query(`INSERT INTO item_photos(menu_item_id,image) VALUES ($1,$2)
      ON CONFLICT(menu_item_id) DO UPDATE SET image=excluded.image, revision=gen_random_uuid()`, [id, bytes]);
    await client.query('UPDATE menu_items SET item_revision=gen_random_uuid() WHERE id=$1', [id]);
    photoCache.delete(id);
    return get(client, id);
  });
}

// Fixed-size LRU: at most 50 * 160 KiB = 7.82 MiB. Metadata is checked on reads;
// menu JSON never includes image bytes and replacements invalidate this cache.
const photoCache = new Map();
async function photoMetadata(id) {
  return (await db.query(`SELECT p.revision::text AS revision, m.is_draft AS "isDraft"
    ${JOIN} WHERE m.id=$1 AND NOT m.retired AND p.menu_item_id IS NOT NULL`, [id])).rows[0];
}
async function photo(id, revision) {
  const cached = photoCache.get(id);
  if (cached?.revision === revision) { photoCache.delete(id); photoCache.set(id, cached); return cached.bytes; }
  const { rows } = await db.query('SELECT image FROM item_photos WHERE menu_item_id=$1 AND revision=$2::uuid', [id, revision]);
  if (!rows[0]) return null;
  const bytes = Buffer.from(rows[0].image);
  photoCache.delete(id);
  photoCache.set(id, { revision, bytes });
  if (photoCache.size > 50) photoCache.delete(photoCache.keys().next().value);
  return bytes;
}
const CHATTIPATHIRI = new Set(['mc-chattipathiri-1kg','mc-chattipathiri-1-5kg','mc-chattipathiri-2kg']);
async function reorder(section, entries) {
  return transaction(async client => {
    const cat = section === 'combos' ? 'mains' : section;
    const combo = section === 'combos';
    const { rows } = await client.query(`SELECT id,item_revision::text AS revision FROM menu_items
      WHERE NOT retired AND category_id=$1 AND is_combo=$2 ORDER BY id FOR UPDATE`, [cat,combo]);
    const current = new Map(rows.map(row=>[row.id,row.revision]));
    if (rows.length !== entries.length || entries.some(row=>current.get(row.id)!==row.revision)) {
      throw problem(409,'Items changed in another session. Reload the list before reordering.');
    }
    const weights = entries.map((row,index)=>CHATTIPATHIRI.has(row.id)?index:-1).filter(i=>i>=0);
    if (weights.length && weights.at(-1)-weights[0]+1 !== weights.length) {
      throw problem(400,'Move Chattipathiri weight options together as one card.');
    }
    const positions = entries.map((row,index)=>CHATTIPATHIRI.has(row.id)?weights[0]:index);
    await client.query(`UPDATE menu_items m SET display_order=ordered.position, item_revision=gen_random_uuid()
      FROM unnest($1::text[],$2::bigint[]) AS ordered(id,position) WHERE m.id=ordered.id`,
      [entries.map(row=>row.id),positions]);
    return list(client);
  });
}
module.exports = { list, create, update, retire, savePhoto, photoMetadata, photo, problem, reorder };
