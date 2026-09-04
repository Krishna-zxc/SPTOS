/**
 * Generates the PWA's PNG icons from the same glyph as favicon.svg.
 *
 * Chrome will not offer to install an app whose manifest has no 192px and 512px
 * PNG icon, and the PRD's budget (§13) rules out pulling in an image toolchain
 * for two files. So this writes them directly: a tiny PNG encoder over Node's
 * own zlib, drawn at 4x and box-filtered down for antialiasing.
 *
 *   node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SUPERSAMPLE = 4;
const TEAL = [15, 118, 110];
const MIST = [248, 250, 252];

/** A square RGB canvas with the few primitives the glyph needs. */
function canvas(size) {
  const px = new Uint8Array(size * size * 3);
  const unit = size / 64; // the glyph is authored in a 64x64 box

  const put = (x, y, [r, g, b]) => {
    const i = (y * size + x) * 3;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  };

  const roundRect = (rx, ry, rw, rh, radius, colour) => {
    const [x0, y0, w, h, r] = [rx * unit, ry * unit, rw * unit, rh * unit, radius * unit];
    for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y += 1) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x += 1) {
        const dx = Math.max(x0 + r - x, x - (x0 + w - 1 - r), 0);
        const dy = Math.max(y0 + r - y, y - (y0 + h - 1 - r), 0);
        if (dx * dx + dy * dy <= r * r) put(x, y, colour);
      }
    }
  };

  const disc = (cx, cy, radius, colour) => {
    const [x0, y0, r] = [cx * unit, cy * unit, radius * unit];
    for (let y = Math.floor(y0 - r); y <= Math.ceil(y0 + r); y += 1) {
      for (let x = Math.floor(x0 - r); x <= Math.ceil(x0 + r); x += 1) {
        if ((x - x0) ** 2 + (y - y0) ** 2 <= r * r) put(x, y, colour);
      }
    }
  };

  return { px, size, roundRect, disc };
}

/** The bus, head-on — identical geometry to favicon.svg. */
function draw(c) {
  c.roundRect(0, 0, 64, 64, 14, TEAL);
  c.roundRect(16, 13, 32, 32, 6, MIST);
  c.roundRect(20, 18, 24, 11, 2.5, TEAL);
  c.disc(24, 36, 3, TEAL);
  c.disc(40, 36, 3, TEAL);
  c.roundRect(18, 46, 6, 5, 2, MIST);
  c.roundRect(40, 46, 6, 5, 2, MIST);
}

/** Box filter from `SUPERSAMPLE`x down to the requested size. */
function downsample(source, size) {
  const out = Buffer.alloc(size * size * 3);
  const n = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const totals = [0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const i = ((y * SUPERSAMPLE + sy) * source.size + (x * SUPERSAMPLE + sx)) * 3;
          totals[0] += source.px[i];
          totals[1] += source.px[i + 1];
          totals[2] += source.px[i + 2];
        }
      }
      const o = (y * size + x) * 3;
      out[o] = Math.round(totals[0] / n);
      out[o + 1] = Math.round(totals[1] / n);
      out[o + 2] = Math.round(totals[2] / n);
    }
  }
  return out;
}

/* ── Minimal PNG container ───────────────────────────────────────────────── */

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, payload) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(rgb, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour, no alpha
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(PUBLIC_DIR, { recursive: true });
for (const size of [192, 512]) {
  const big = canvas(size * SUPERSAMPLE);
  draw(big);
  const file = path.join(PUBLIC_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(downsample(big, size), size));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
