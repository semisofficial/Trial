const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { requireAdmin, validSession } = require('../middleware/adminAuth');
const items = require('../models/itemsModel');
const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

router.param('id', (req, res, next, id) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id)) return res.status(400).json({ success: false, message: 'Invalid item identifier' });
  next();
});
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex'); next(); });
router.get('/:id/photo', async (req, res) => {
  const meta = await items.photoMetadata(req.params.id);
  if (!meta || (meta.isDraft && !await validSession(req))) return res.status(404).end();
  if (req.query.v !== meta.revision) {
    return res.redirect(307, `/api/items/${req.params.id}/photo?v=${meta.revision}`);
  }
  res.set('Cache-Control', meta.isDraft ? 'private, no-store' : 'public, max-age=300, must-revalidate');
  res.set('Vary', 'Cookie');
  res.set('ETag', `"${meta.revision}"`);
  if (req.fresh) return res.status(304).end();
  const bytes = await items.photo(req.params.id, meta.revision);
  if (!bytes) return res.status(404).set('Cache-Control', 'no-store').end();
  res.type('webp').send(bytes);
});
router.use(requireAdmin);
const mutations = rateLimit({ windowMs: 15 * 60 * 1000, limit: 80,
  standardHeaders: 'draft-8', legacyHeaders: false, validate: { xForwardedForHeader: false },
  handler: (req, res) => res.status(429).json({ success: false, message: 'Too many item changes. Please try again later.' }),
});
router.get('/', async (req, res) => res.json({ success: true, data: await items.list() }));
router.use(mutations);

router.put('/reorder', async (req,res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key=>!['section','items'].includes(key))
      || !['fried','frozen','mains','combos'].includes(body.section)
      || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 1000
      || body.items.some(item=>!item || typeof item !== 'object' || Array.isArray(item)
        || Object.keys(item).some(key=>!['id','revision'].includes(key))
        || typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(item.id)
        || typeof item.revision !== 'string' || !UUID.test(item.revision))
      || new Set(body.items.map(item=>item.id)).size !== body.items.length) {
    throw items.problem(400,'Supply each item in one menu section exactly once with its current revision.');
  }
  res.json({ success:true, data:await items.reorder(body.section,body.items) });
});

function metadata(body) {
  const allowed = ['name', 'cat', 'unit', 'minQty', 'step', 'isCombo'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) {
    throw items.problem(400, 'Only item name, category, unit, quantities and combo status can be edited here.');
  }
  const cleanText = (value, max) => typeof value === 'string' && value.trim().length > 0
    && value.trim().length <= max && !/[\x00-\x1f\x7f]/.test(value);
  const quantity = value => Number.isFinite(value) && value >= 0.001 && value <= 10000
    && Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6;
  if (!cleanText(body.name, 160) || !cleanText(body.unit, 40)
    || !['fried', 'frozen', 'mains'].includes(body.cat) || !quantity(body.minQty) || !quantity(body.step)
    || typeof body.isCombo !== 'boolean' || (body.isCombo && body.cat !== 'mains')) {
    throw items.problem(400, 'Enter a name, unit, valid category and positive quantities (up to 3 decimal places). Combos must be mains.');
  }
  return { ...body, name: body.name.trim(), unit: body.unit.trim() };
}
function expected(req) {
  const revision = /^"([^"]+)"$/.exec(req.get('If-Match') || '')?.[1];
  if (!revision || !UUID.test(revision)) throw items.problem(400, 'Reload this item before saving.');
  return revision;
}
router.post('/', async (req, res) => res.status(201).json({ success: true, data: await items.create(metadata(req.body)) }));
router.put('/:id', async (req, res) => res.json({ success: true, data: await items.update(req.params.id, metadata(req.body), expected(req)) }));
router.delete('/:id', async (req, res) => {
  await items.retire(req.params.id, expected(req));
  res.json({ success: true });
});

let converting = false;
router.put('/:id/photo', (req, res, next) => {
  if (!['image/png', 'image/jpeg'].includes(req.get('Content-Type')) ||
    (req.get('Content-Encoding') && req.get('Content-Encoding') !== 'identity')) {
    return res.status(415).json({ success: false, message: 'Upload an uncompressed PNG or JPEG file.' });
  }
  next();
}, express.raw({ type: ['image/png', 'image/jpeg'], limit: 3 * 1024 * 1024, inflate: false }), async (req, res) => {
  const revision = expected(req);
  if (converting) return res.status(429).set('Retry-After', '3').json({ success: false, message: 'An image is being processed. Please try again in a moment.' });
  converting = true;
  let bytes;
  try {
    const input = req.body;
    const png = Buffer.isBuffer(input) && input.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = Buffer.isBuffer(input) && input[0] === 255 && input[1] === 216 && input[2] === 255;
    if ((!png && !jpeg) || (png ? 'image/png' : 'image/jpeg') !== req.get('Content-Type')) throw new Error('Invalid type');
    const processor = require('sharp')(input, { failOn: 'warning', limitInputPixels: 12000000 });
    const info = await processor.metadata();
    if ((info.pages || 1) !== 1) throw new Error('Animated image');
    bytes = await processor.rotate().resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 }).toBuffer();
    if (bytes.length > 160 * 1024) throw new Error('Image too detailed');
  } catch { throw items.problem(400, 'Choose a valid, non-animated PNG or JPEG under 12 megapixels. Use a simpler image if it cannot fit the 160 KB saved limit.'); }
  finally { converting = false; }
  res.json({ success: true, data: await items.savePhoto(req.params.id, bytes, revision) });
});

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.publicMessage) return res.status(error.status).json({ success: false, message: error.publicMessage });
  if (['42P01', '42703'].includes(error.code)) return res.status(503).json({ success: false, message: 'Items management needs database setup. Apply items_management.sql and item_ordering.sql.' });
  next(error);
});
module.exports = router;
