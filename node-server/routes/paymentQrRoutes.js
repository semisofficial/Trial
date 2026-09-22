const express = require('express');
const path = require('node:path');
const router = express.Router();

// Payment details are repository-owned. No session, upload endpoint or database
// override can replace this image; updates require a reviewed code deployment.
router.get('/image', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.set('Cache-Control', 'public, max-age=0, must-revalidate');
  res.sendFile(path.join(__dirname, '../assets/upi-qr.png'));
});

module.exports = router;
