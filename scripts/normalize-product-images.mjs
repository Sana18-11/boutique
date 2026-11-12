#!/usr/bin/env node
/**
 * scripts/normalize-product-images.mjs
 *
 * One-off script to normalize product images:
 * - Flattens any transparency onto #F4EAE2
 * - Resizes with fit: 'cover', position: 'attention' to 900x1200 (3:4)
 * - Encodes as WebP at quality ~80
 * - Writes new files with '.normalized.webp' extension without overwriting originals
 * - Prints a before/after size report
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Try backend sharp first, then global/root sharp
let sharp;
try {
  const backendSharpPath = path.resolve(rootDir, 'boutique-backend-node', 'node_modules', 'sharp');
  sharp = (await import(backendSharpPath)).default;
} catch {
  try {
    sharp = (await import('sharp')).default;
  } catch (err) {
    console.error('Error: "sharp" is required to run this script. Run "npm install --prefix boutique-backend-node sharp".');
    process.exit(1);
  }
}

const targetDirs = [
  path.resolve(rootDir, 'public', 'storage', 'products'),
  path.resolve(rootDir, 'boutique-backend-node', 'public', 'storage', 'products'),
].filter(dir => fs.existsSync(dir));

if (targetDirs.length === 0) {
  console.log('No public/storage/products directory found.');
  process.exit(0);
}

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

console.log('========================================================================');
console.log('       YAALE PRODUCT IMAGE NORMALIZATION REPORT (900x1200 WebP)         ');
console.log('========================================================================\n');

for (const dir of targetDirs) {
  console.log(`Directory: ${path.relative(rootDir, dir)}\n`);
  const files = fs.readdirSync(dir).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) && !f.includes('.normalized.');
  });

  if (files.length === 0) {
    console.log('  No eligible images found in this directory.\n');
    continue;
  }

  let totalBefore = 0;
  let totalAfter = 0;

  for (const file of files) {
    const srcPath = path.join(dir, file);
    const parsed = path.parse(file);
    const destPath = path.join(dir, `${parsed.name}.normalized.webp`);

    const statBefore = fs.statSync(srcPath);
    totalBefore += statBefore.size;

    try {
      const buffer = fs.readFileSync(srcPath);
      await sharp(buffer)
        .flatten({ background: '#F4EAE2' })
        .resize(900, 1200, { fit: 'cover', position: 'attention' })
        .webp({ quality: 80 })
        .toFile(destPath);

      const statAfter = fs.statSync(destPath);
      totalAfter += statAfter.size;

      const diffPct = (((statAfter.size - statBefore.size) / statBefore.size) * 100).toFixed(1);
      const sign = Number(diffPct) > 0 ? '+' : '';
      console.log(`  ✓ ${file.padEnd(35)} : ${formatBytes(statBefore.size).padStart(9)} -> ${formatBytes(statAfter.size).padStart(9)} (${sign}${diffPct}%)`);
    } catch (err) {
      console.error(`  ✗ Failed to process ${file}: ${err.message}`);
    }
  }

  console.log('\n  -------------------------------------------------------------');
  console.log(`  Total Before : ${formatBytes(totalBefore)}`);
  console.log(`  Total After  : ${formatBytes(totalAfter)}`);
  const totalDiffPct = (((totalAfter - totalBefore) / totalBefore) * 100).toFixed(1);
  console.log(`  Net Savings  : ${formatBytes(totalBefore - totalAfter)} (${totalDiffPct}%)`);
  console.log('  -------------------------------------------------------------\n');
}

console.log('Done. Note: Original images were kept intact; new normalized files saved with .normalized.webp.\n');

