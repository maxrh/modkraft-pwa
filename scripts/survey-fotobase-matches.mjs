#!/usr/bin/env node
/**
 * Read-only filename survey: how many site photos have a unique counterpart
 * in the Dropbox fotobase folder.
 *
 * Found = unique basename, a camera number that maps to one frame (photographer
 * suffix allowed), or a unique normalized stem (length >= 8). Does not open
 * image bytes.
 */

import fs from 'node:fs';
import path from 'node:path';

const SITE_ROOT = process.cwd();
const COLLECTIONS_DIR = path.join(SITE_ROOT, 'content', 'photo-collections');
const REPORT_PATH = path.join(COLLECTIONS_DIR, 'fotobase-match-report.json');
const DEFAULT_FOTOBASE = path.join(
  'C:',
  'Users',
  'max',
  'Dropbox',
  'Monsun',
  'Monsun Foto Upload',
  'fotobase',
);

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.tif', '.tiff', '.png', '.webp']);

function fotobaseRoot() {
  const arg = process.argv.find((a) => a.startsWith('--root='));
  if (arg) return arg.slice('--root='.length);
  return process.env.FOTOBASE_ROOT || DEFAULT_FOTOBASE;
}

/** Case/ext-insensitive basename, with Dropbox upload stamps removed. */
function basenameKey(name) {
  let s = path.basename(String(name)).normalize('NFC').toLowerCase();
  s = s.replace(/\.[^.]+$/, '');
  s = s.replace(/-\d{12,}$/, '');
  return s;
}

/**
 * Loose stem for fuzzy equality.
 * Collapses punctuation, strips trailing "kopi" / "0" and upload stamps.
 */
function normalizeStem(name) {
  let s = basenameKey(name);
  s = s.replace(/[^a-z0-9æøå]+/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/(?:\s+kopi)+$/g, '').trim();
  s = s.replace(/(?:\s+0)+$/g, '').trim();
  return s;
}

/** Camera counter such as mg3161 / dsf0416 / img5554 / dsc8635. */
function cameraToken(name) {
  const s = basenameKey(name);
  const m = s.match(/(?:^|[^a-z0-9])((?:mg|dsf|img|dsc))_?(\d{3,5})/);
  if (!m) return null;
  return `${m[1]}${m[2]}`;
}

/** Codes that trail a camera number in fotobase (`_MG_7483_mk.jpg`). Longest first. */
const PHOTOGRAPHER_CODES = ['majag', 'mkk', 'lkm', 'rode', 'mk', 'ap', 'az', 'bb', 'mm', 'gm'];

/** Credit tie-break. Other codes stay unmatched until a basename hit proves them. */
const CREDIT_BY_CODE = {
  mk: 'mark knudsen',
  mkk: 'mette kramer kristensen',
  ap: 'anders pedersen',
};

function trailingCode(name) {
  const s = basenameKey(name);
  const m = s.match(/(?:^|[^a-z0-9])((?:mg|dsf|img|dsc))_?(\d{3,5})(.*)$/);
  if (!m) return '';
  const rest = m[3];
  for (const code of PHOTOGRAPHER_CODES) {
    if (new RegExp(`(?:^|[^a-z0-9])${code}$`).test(rest)) return code;
  }
  return '';
}

function preferOriginal(paths) {
  return [...paths].sort((a, b) => {
    const rank = (p) => {
      const ext = path.extname(p).toLowerCase();
      if (ext === '.tif' || ext === '.tiff') return 0;
      return 1;
    };
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}

/** Group same-token files that only differ by extension. Different suffixes are different frames. */
function cameraFrames(paths) {
  const groups = new Map();
  for (const filePath of paths) {
    const code = trailingCode(filePath);
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(filePath);
  }
  return groups;
}

function pushMap(map, key, value) {
  if (!key) return;
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }
  list.push(value);
}

function walkFotobase(root, byBasename, byStem, byCamera) {
  let files = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`WARN: cannot read ${dir}: ${err.message}`);
      continue;
    }
    for (const entry of entries) {
      if (entry.name === '_NEWSIZES') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXT.has(ext)) continue;
      files++;
      const rec = full;
      pushMap(byBasename, basenameKey(entry.name), rec);
      pushMap(byStem, normalizeStem(entry.name), rec);
      pushMap(byCamera, cameraToken(entry.name), rec);
    }
  }
  return files;
}

function loadSiteImages() {
  const dirs = fs
    .readdirSync(COLLECTIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort();

  const images = [];
  for (const id of dirs) {
    const filePath = path.join(COLLECTIONS_DIR, id, 'collection.json');
    if (!fs.existsSync(filePath)) continue;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const img of data.images || []) {
      images.push({
        collectionId: data.id || id,
        imageId: img.id,
        originalFilename: img.originalFilename || '',
        filename: img.filename || '',
        credit: img.credit || '',
        width: img.width ?? null,
      });
    }
  }
  return images;
}

function asFound(matchClass, paths) {
  const ordered = preferOriginal(paths);
  return {
    matchClass,
    path: ordered[0],
    paths: ordered,
    candidateCount: ordered.length,
  };
}

function classifyCamera(hits, credit) {
  const frames = cameraFrames(hits);
  if (frames.size === 1) {
    return asFound('uniqueCamera', [...frames.values()][0]);
  }

  const wanted = String(credit || '').trim().toLowerCase();
  const picked = [...frames.entries()].filter(
    ([code]) => code && CREDIT_BY_CODE[code] === wanted,
  );
  if (picked.length === 1) {
    return asFound('uniqueCamera', picked[0][1]);
  }

  return { matchClass: 'ambiguous', path: null, paths: [], candidateCount: hits.length };
}

function classify(image, byBasename, byStem, byCamera) {
  const sourceName = image.originalFilename || image.filename;
  const baseHits = byBasename.get(basenameKey(sourceName)) || [];
  if (baseHits.length === 1) {
    return asFound('uniqueBasename', baseHits);
  }

  const token = cameraToken(sourceName);
  const cameraHits = token ? byCamera.get(token) || [] : [];
  if (cameraHits.length > 0) {
    return classifyCamera(cameraHits, image.credit);
  }

  if (baseHits.length > 1) {
    return { matchClass: 'ambiguous', path: null, paths: [], candidateCount: baseHits.length };
  }

  const stem = normalizeStem(sourceName);
  const stemHits = stem ? byStem.get(stem) || [] : [];
  if (stem.length >= 8 && stemHits.length === 1) {
    return asFound('uniqueStem', stemHits);
  }
  if (stemHits.length > 1) {
    return { matchClass: 'ambiguous', path: null, paths: [], candidateCount: stemHits.length };
  }

  return { matchClass: 'none', path: null, paths: [], candidateCount: 0 };
}

function main() {
  const root = fotobaseRoot();
  if (!fs.existsSync(root)) {
    console.error('Fotobase folder not found:', root);
    process.exit(1);
  }

  console.log('Indexing fotobase:', root);
  const byBasename = new Map();
  const byStem = new Map();
  const byCamera = new Map();
  const fotobaseFiles = walkFotobase(root, byBasename, byStem, byCamera);
  console.log(`Fotobase images indexed: ${fotobaseFiles}`);

  const siteImages = loadSiteImages();
  const counts = { uniqueBasename: 0, uniqueCamera: 0, uniqueStem: 0, ambiguous: 0, none: 0 };
  const byCollection = new Map();
  const images = [];

  for (const image of siteImages) {
    const match = classify(image, byBasename, byStem, byCamera);
    counts[match.matchClass]++;
    const row = {
      collectionId: image.collectionId,
      imageId: image.imageId,
      originalFilename: image.originalFilename,
      width: image.width,
      matchClass: match.matchClass,
      path: match.path,
      paths: match.paths,
      candidateCount: match.candidateCount,
    };
    images.push(row);

    let roll = byCollection.get(image.collectionId);
    if (!roll) {
      roll = { found: 0, ambiguous: 0, none: 0, total: 0 };
      byCollection.set(image.collectionId, roll);
    }
    roll.total++;
    if (
      match.matchClass === 'uniqueBasename' ||
      match.matchClass === 'uniqueCamera' ||
      match.matchClass === 'uniqueStem'
    ) {
      roll.found++;
    } else if (match.matchClass === 'ambiguous') {
      roll.ambiguous++;
    } else {
      roll.none++;
    }
  }

  const found = counts.uniqueBasename + counts.uniqueCamera + counts.uniqueStem;
  const collections = [...byCollection.entries()]
    .map(([id, roll]) => ({
      id,
      ...roll,
      foundRate: roll.total ? Math.round((roll.found / roll.total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.foundRate - b.foundRate || b.none - a.none || a.id.localeCompare(b.id));

  const report = {
    generatedAt: new Date().toISOString(),
    fotobaseRoot: root,
    fotobaseFiles,
    siteImages: siteImages.length,
    found,
    foundRate: siteImages.length ? Math.round((found / siteImages.length) * 1000) / 10 : 0,
    counts,
    collections,
    images,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');

  console.log('\n=== FOTOBASE MATCH SURVEY ===');
  console.log(`Site images:        ${siteImages.length}`);
  console.log(`Fotobase images:    ${fotobaseFiles}`);
  console.log(`Found:              ${found} (${report.foundRate}%)`);
  console.log(`  uniqueBasename:   ${counts.uniqueBasename}`);
  console.log(`  uniqueCamera:     ${counts.uniqueCamera}`);
  console.log(`  uniqueStem:       ${counts.uniqueStem}`);
  console.log(`Ambiguous:          ${counts.ambiguous}`);
  console.log(`None:               ${counts.none}`);
  console.log('\n--- LOWEST FOUND RATE (up to 15) ---');
  for (const row of collections.filter((c) => c.found < c.total).slice(0, 15)) {
    console.log(
      `  ${row.foundRate.toString().padStart(5, ' ')}%  ${row.found}/${row.total}  ambiguous ${row.ambiguous}  none ${row.none}  ${row.id}`,
    );
  }
  console.log(`\nReport: ${REPORT_PATH}`);
}

main();
