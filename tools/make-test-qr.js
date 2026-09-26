'use strict';

const QRCode = require('qrcode');

const text = process.argv[2] || 'HELLO-WATCHER-TEST-123';
const out = process.argv[3] || 'test-qr.png';

QRCode.toFile(out, text, { width: 600, margin: 2 })
  .then(() => console.log(`wrote ${out} with payload: ${text}`))
  .catch((err) => {
    console.error('failed:', err.message);
    process.exit(1);
  });
