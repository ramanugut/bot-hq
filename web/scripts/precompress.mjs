// After `vite build`: write .br and .gz copies of the text files in dist/, so the server sends small files
// without compressing on every request (the EC2 server is small; Caddy in front does not compress).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dist = new URL('../dist/', import.meta.url).pathname;
const TEXT = /\.(?:js|mjs|css|html|svg|json|webmanifest|txt)$/;
let files = 0;
let before = 0;
let after = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!TEXT.test(entry.name)) continue;
    const data = fs.readFileSync(full);
    if (data.length < 1024) continue;
    const br = zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
    const gz = zlib.gzipSync(data, { level: 9 });
    fs.writeFileSync(`${full}.br`, br);
    fs.writeFileSync(`${full}.gz`, gz);
    files++;
    before += data.length;
    after += br.length;
  }
}

walk(dist);
console.log(`precompressed ${files} files: ${(before / 1024).toFixed(0)} kB -> ${(after / 1024).toFixed(0)} kB (brotli)`);
