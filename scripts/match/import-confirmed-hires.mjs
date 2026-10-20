#!/usr/bin/env node
/**
 * Replace confirmed site JPGs with higher-res fotobase files, then mark
 * decisions as `imported` so /match and deep matching skip them.
 *
 * Usage:
 *   node scripts/match/import-confirmed-hires.mjs [--dry-run] [--force]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { preferOriginal } from './fotobase-match-status.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const COLLECTIONS_DIR = path.join(ROOT, 'content', 'photo-collections');
const DECISIONS_PATH = path.join(COLLECTIONS_DIR, 'fotobase-match-decisions.json');
const REPORT_PATH = path.join(COLLECTIONS_DIR, 'fotobase-hires-import-report.json');

const JPEG_QUALITY = 90;

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

function area(meta) {
  const w = meta?.width || 0;
  const h = meta?.height || 0;
  return w * h;
}

async function replaceWithHires(srcPath, destPath) {
  const tmpPath = `${destPath}.hires-tmp.jpg`;
  await sharp(srcPath)
    .rotate()
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(tmpPath);
  const written = await sharp(tmpPath).metadata();
  fs.renameSync(tmpPath, destPath);
  return {
    width: written.width || null,
    height: written.height || null,
  };
}

async function main() {
  if (!fs.existsSync(DECISIONS_PATH)) {
    console.error('Decisions file not found:', DECISIONS_PATH);
    process.exit(1);
  }

  const decisions = JSON.parse(fs.readFileSync(DECISIONS_PATH, 'utf8'));
  const confirmed = Object.entries(decisions).filter(([, d]) => d.status === 'confirmed');
  const alreadyImported = Object.entries(decisions).filter(([, d]) => d.status === 'imported');

  console.log(
    `Confirmed to consider: ${confirmed.length}` +
      (alreadyImported.length ? ` (already imported: ${alreadyImported.length})` : '') +
      (dryRun ? ' [DRY RUN]' : '') +
      (force ? ' [FORCE]' : ''),
  );

  const counts = {
    replaced: 0,
    markedImported: 0,
    skippedAlreadyImported: 0,
    skippedNotLarger: 0,
    missingPath: 0,
    missingSite: 0,
    errors: 0,
  };
  const rows = [];
  /** @type {Map<string, object>} */
  const collectionCache = new Map();
  /** @type {Set<string>} */
  const dirtyCollections = new Set();

  function loadCollection(collectionId) {
    if (collectionCache.has(collectionId)) return collectionCache.get(collectionId);
    const filePath = path.join(COLLECTIONS_DIR, collectionId, 'collection.json');
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    collectionCache.set(collectionId, { filePath, data });
    return collectionCache.get(collectionId);
  }

  const workList = force
    ? [
        ...confirmed,
        ...alreadyImported.filter(([, d]) => d.path),
      ]
    : confirmed;

  for (const [key, decision] of workList) {
    const [collectionId, imageId] = key.split('/');
    const row = {
      key,
      collectionId,
      imageId,
      fotobasePath: decision.path || null,
      action: null,
      reason: null,
      siteBefore: null,
      fotobase: null,
      siteAfter: null,
    };

    try {
      if (!force && decision.status === 'imported') {
        counts.skippedAlreadyImported++;
        row.action = 'skip';
        row.reason = 'already-imported';
        rows.push(row);
        continue;
      }

      if (!decision.path || !fs.existsSync(decision.path)) {
        counts.missingPath++;
        row.action = 'skip';
        row.reason = 'missing-fotobase-path';
        rows.push(row);
        continue;
      }

      const pack = loadCollection(collectionId);
      if (!pack) {
        counts.missingSite++;
        row.action = 'skip';
        row.reason = 'missing-collection';
        rows.push(row);
        continue;
      }

      const img = (pack.data.images || []).find((i) => i.id === imageId);
      if (!img?.filename) {
        counts.missingSite++;
        row.action = 'skip';
        row.reason = 'missing-image';
        rows.push(row);
        continue;
      }

      const sitePath = path.join(COLLECTIONS_DIR, collectionId, 'images', img.filename);
      if (!fs.existsSync(sitePath)) {
        counts.missingSite++;
        row.action = 'skip';
        row.reason = 'missing-site-file';
        rows.push(row);
        continue;
      }

      const siteMeta = await sharp(sitePath).metadata();
      const fotoMeta = await sharp(decision.path).metadata();
      row.siteBefore = {
        width: siteMeta.width || null,
        height: siteMeta.height || null,
        bytes: fs.statSync(sitePath).size,
      };
      row.fotobase = {
        width: fotoMeta.width || null,
        height: fotoMeta.height || null,
        bytes: fs.statSync(decision.path).size,
        ext: path.extname(decision.path).toLowerCase(),
      };

      if (area(fotoMeta) <= area(siteMeta)) {
        counts.skippedNotLarger++;
        row.action = 'skip';
        row.reason = 'not-larger';
        rows.push(row);
        continue;
      }

      if (dryRun) {
        counts.replaced++;
        counts.markedImported++;
        row.action = 'would-replace';
        row.reason = 'dry-run';
        rows.push(row);
        continue;
      }

      const dims = await replaceWithHires(decision.path, sitePath);
      img.width = dims.width;
      img.height = dims.height;
      img.hiresSource = decision.path;
      img.hiresAt = new Date().toISOString();
      dirtyCollections.add(collectionId);

      const paths = preferOriginal(
        decision.paths?.length ? decision.paths : [decision.path],
      );
      decisions[key] = {
        status: 'imported',
        source: 'hires-import',
        at: new Date().toISOString(),
        path: decision.path,
        paths,
      };

      counts.replaced++;
      counts.markedImported++;
      row.action = 'replaced';
      row.siteAfter = dims;
      rows.push(row);
    } catch (err) {
      counts.errors++;
      row.action = 'error';
      row.reason = err instanceof Error ? err.message : String(err);
      rows.push(row);
      console.error(`ERROR ${key}:`, row.reason);
    }
  }

  if (!dryRun) {
    for (const collectionId of dirtyCollections) {
      const pack = collectionCache.get(collectionId);
      if (!pack) continue;
      fs.writeFileSync(pack.filePath, JSON.stringify(pack.data, null, 2) + '\n');
    }
    fs.writeFileSync(DECISIONS_PATH, JSON.stringify(decisions, null, 2) + '\n');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun,
    force,
    counts,
    rows,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');

  console.log('\n=== HIRES IMPORT ===');
  console.log(`Replaced:              ${counts.replaced}`);
  console.log(`Marked imported:       ${counts.markedImported}`);
  console.log(`Skipped not larger:    ${counts.skippedNotLarger}`);
  console.log(`Missing fotobase path: ${counts.missingPath}`);
  console.log(`Missing site:          ${counts.missingSite}`);
  console.log(`Already imported:      ${counts.skippedAlreadyImported}`);
  console.log(`Errors:                ${counts.errors}`);
  console.log(`Collections updated:   ${dirtyCollections.size}`);
  console.log(`Report: ${REPORT_PATH}`);
  if (!dryRun && counts.replaced > 0) {
    console.log('\nNext: node scripts/make-thumbs.mjs');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
