# Vendored: QRCode for JavaScript

The ten `.js` files beside this notice are copied byte for byte from
`node_modules/qrcode-terminal/vendor/QRCode` of qrcode-terminal 0.11.0
(https://github.com/gtanner/qrcode-terminal), the encoder Expo's own CLI
prints its "scan to open" code with. Nothing in them is changed here; a
fix goes upstream or into `scripts/qr.mjs`, never into these files, and
`scripts/qr.test.mjs` reads their output back with a reader of its own.

Two licences cover them, and both notices ship with them:

- QRCode for JavaScript, Copyright (c) 2009 Kazuhiko Arase
  (http://www.d-project.com/), licensed under the MIT licence
  (http://www.opensource.org/licenses/mit-license.php). The word
  "QR Code" is a registered trademark of DENSO WAVE INCORPORATED
  (http://www.denso-wave.com/qrcode/faqpatent-e.html).
- The Node port and its refactoring, by Gord Tanner and Michael Brooks
  in qrcode-terminal, licensed under the Apache License, Version 2.0.
  `LICENSE-APACHE-2.0.txt` beside this file is that package's LICENSE
  file, byte for byte, with its own note on the QRCode files at the end.

Why vendored rather than installed (14 Oct 2026): this repository has no
package.json and its Action installs nothing (`share-cards.yml`), so the
generator stays a set of plain files that run on a bare checkout. With no
package.json in reach Node loads these as CommonJS, and `qr.mjs` imports
each one's `module.exports` as its default export.
