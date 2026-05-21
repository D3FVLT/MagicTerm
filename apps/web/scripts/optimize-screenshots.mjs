#!/usr/bin/env node
// Optimizes the static screenshots used on the marketing site.
// PNG → WebP at quality 82, max 1800px wide. Run with: node scripts/optimize-screenshots.mjs
import { readdir, stat } from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'public', 'screenshots');

const TARGETS = ['vaults.png', 'vaults-midnight.png', 'terminal.png', 'sftp.png', 'snippets.png'];

async function fmt(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

for (const file of TARGETS) {
  const src = join(ROOT, file);
  const dst = join(ROOT, basename(file, extname(file)) + '.webp');
  const before = (await stat(src)).size;
  await sharp(src)
    .resize({ width: 1800, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(dst);
  const after = (await stat(dst)).size;
  console.log(`${file.padEnd(28)} ${(await fmt(before)).padStart(10)}  →  ${await fmt(after)}`);
}
