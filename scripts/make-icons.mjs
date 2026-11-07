// Generates icons/icon-192.png and icons/icon-512.png (no image libraries needed).
// Run with: npm run icons
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Shapes are described on a 512 grid and scaled to the output size.
const inRound = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inTri = (x, y, [ax, ay], [bx, by], [cx, cy]) => {
  const d = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = d(x, y, ax, ay, bx, by), d2 = d(x, y, bx, by, cx, cy), d3 = d(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function colorAt(x, y) { // x, y in 0..512
  let c = mix([67, 56, 202], [147, 51, 234], (x + y) / 1024); // indigo -> purple
  if (inRound(x, y, 190, 240, 400, 380, 45) || inTri(x, y, [350, 375], [310, 375], [362, 428])) c = [251, 191, 36];
  if (inRound(x, y, 110, 130, 330, 270, 45) || inTri(x, y, [150, 265], [195, 265], [138, 318])) c = [255, 255, 255];
  for (const dx of [170, 220, 270]) if ((x - dx) ** 2 + (y - 200) ** 2 <= 14 * 14) c = [67, 56, 202];
  return c;
}

fs.mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  const s = 512 / size;
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, png(size, (x, y) => {
    let r = 0, g = 0, b = 0; // 3x3 supersampling for smooth edges
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const [pr, pg, pb] = colorAt((x + (i + 0.5) / 3) * s, (y + (j + 0.5) / 3) * s);
      r += pr; g += pg; b += pb;
    }
    return [Math.round(r / 9), Math.round(g / 9), Math.round(b / 9)];
  }));
  console.log('wrote', file);
}
