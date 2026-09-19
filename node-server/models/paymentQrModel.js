const { randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const db = require('../config/db');

// One image in memory, not a cache keyed by caller-controlled URLs. Each view
// checks its tiny revision row so replacements work across processes/restarts.
let cachedImage;
let defaultImage;

async function metadata() {
  try {
    const { rows } = await db.query('SELECT version, updated_at FROM payment_qr WHERE id = 1');
    if (!rows[0]) throw new Error('Payment QR record missing');
    return { ready: true, version: rows[0].version, updatedAt: rows[0].updated_at };
  } catch (error) {
    // Safe initial rollout: old code/databases never had a saved replacement.
    if (error.code === '42P01') return { ready: false, version: 'default', updatedAt: null };
    throw error;
  }
}

async function image(meta) {
  if (meta.version === 'default') {
    if (!defaultImage) defaultImage = await readFile(path.join(__dirname, '../assets/upi-qr.jpeg'));
    return { ...meta, bytes: defaultImage };
  }
  if (cachedImage?.version === meta.version) return { ...meta, bytes: cachedImage.bytes };
  const { rows } = await db.query('SELECT image, version, updated_at FROM payment_qr WHERE id = 1');
  if (!rows[0]?.image) throw new Error('Payment QR image missing');
  cachedImage = { version: rows[0].version, bytes: Buffer.from(rows[0].image) };
  return { ready: true, ...cachedImage, updatedAt: rows[0].updated_at };
}

async function replace(bytes, expectedVersion) {
  const version = randomUUID();
  const { rows } = await db.query(`UPDATE payment_qr SET image = $1, version = $2, updated_at = now()
    WHERE id = 1 AND version = $3 RETURNING version, updated_at`, [bytes, version, expectedVersion]);
  if (!rows[0]) return null;
  cachedImage = { version, bytes };
  return { ready: true, version, updatedAt: rows[0].updated_at };
}

module.exports = { metadata, image, replace };
