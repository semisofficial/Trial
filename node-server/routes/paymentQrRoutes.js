const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { requireAdmin } = require('../middleware/adminAuth');
const qr = require('../models/paymentQrModel');
const router = express.Router();
const MAX_UPLOAD_BYTES = 1024 * 1024;
let convertingImage = false;
const unavailable = (res) => res.status(503).set('Cache-Control', 'no-store').json({
  success: false, message: 'Payment QR is temporarily unavailable. Please try again.',
});

router.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
});

router.get('/image', async (req, res) => {
  try {
    const meta = await qr.metadata();
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    res.set('ETag', `"${meta.version}"`);
    if (req.fresh) return res.status(304).end();
    const image = await qr.image(meta);
    // A concurrent save between the revision and image queries may return a
    // newer image: its ETag must describe those exact bytes, not the old row.
    res.set('ETag', `"${image.version}"`);
    res.type('jpeg').send(image.bytes);
  } catch { unavailable(res); }
});

router.get('/', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, data: { ...await qr.metadata(), maxUploadBytes: MAX_UPLOAD_BYTES } });
  } catch { unavailable(res); }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 20,
  standardHeaders: 'draft-8', legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (req, res) => res.status(429).json({ success: false, message: 'Too many QR uploads. Please try again later.' }),
});

router.put('/', requireAdmin, uploadLimiter, (req, res, next) => {
  if (!['image/png', 'image/jpeg'].includes(req.get('Content-Type')?.toLowerCase())) {
    return res.status(415).json({ success: false, message: 'Choose a PNG or JPEG image.' });
  }
  if (req.get('Content-Encoding') && req.get('Content-Encoding') !== 'identity') {
    return res.status(415).json({ success: false, message: 'Compressed uploads are not supported.' });
  }
  next();
}, express.raw({ type: ['image/png', 'image/jpeg'], limit: MAX_UPLOAD_BYTES, inflate: false }), async (req, res) => {
  const expectedVersion = /^"(default|[0-9a-f-]{36})"$/.exec(req.get('If-Match') || '')?.[1];
  if (!expectedVersion) return res.status(400).json({ success: false, message: 'Reload the current QR before saving.' });
  if (convertingImage) return res.status(429).set('Retry-After', '3').json({
    success: false, message: 'Another QR image is being processed. Please try again in a moment.',
  });
  convertingImage = true;
  let bytes;
  try {
    const input = req.body;
    const png = Buffer.isBuffer(input) && input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = Buffer.isBuffer(input) && input[0] === 255 && input[1] === 216 && input[2] === 255;
    if ((!png && !jpeg) || (png ? 'image/png' : 'image/jpeg') !== req.get('Content-Type').toLowerCase()) throw new Error('Format mismatch');
    const sharp = require('sharp');
    const processor = sharp(input, { failOn: 'warning', limitInputPixels: 2048 * 2048 });
    const info = await processor.metadata();
    if (info.width > 2048 || info.height > 2048 || info.width < 128 || info.height < 128 || (info.pages || 1) !== 1) throw new Error('Invalid dimensions');
    // Decode then re-encode pixels: discard filenames, metadata and appended
    // content. Never crop or resize the QR/quiet zone; keep full colour detail.
    bytes = await processor.rotate().flatten({ background: '#ffffff' })
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
    if (bytes.length > 524288) return res.status(400).json({ success: false, message: 'Image is too detailed. Choose a simpler QR image (saved limit 512 KB).' });
  } catch {
    return res.status(400).json({ success: false, message: 'Choose a valid, non-animated PNG or JPEG between 128 and 2048 pixels on each side.' });
  } finally { convertingImage = false; }
  try {
    const meta = await qr.metadata();
    if (!meta.ready) return res.status(503).json({ success: false, message: 'QR uploads need database setup. Ask your developer to apply payment_qr.sql.' });
    const result = await qr.replace(bytes, expectedVersion);
    if (!result) return res.status(409).json({ success: false, message: 'Another admin changed the QR. Reload the current QR before saving.' });
    res.json({ success: true, data: { ...result, maxUploadBytes: MAX_UPLOAD_BYTES } });
  } catch { unavailable(res); }
});

module.exports = router;
