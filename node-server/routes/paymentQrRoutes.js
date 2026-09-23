const express = require('express');
const path = require('node:path');
const router = express.Router();

// Repository-owned image only. No staff write route or database override.
router.get('/image', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '../assets/payment-qr-2026-09-23.jpeg'), { cacheControl: false });
});

module.exports = router;
