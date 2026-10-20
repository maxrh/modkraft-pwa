#!/usr/bin/env node
/**
 * Read-only EXIF survey: match site photos the filename survey missed
 * by DateTimeOriginal + camera (Make/Model), with exposure tie-break.
 *
 * Input: fotobase-match-report.json rows with matchClass none|ambiguous.
 * Does not decode pixels — only sharp.metadata() + exif-reader.
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import exifReader from 'exif-reader';

const SITE_ROOT = process.cwd();
const COLLECTIONS_DIR = path.join(SITE_ROOT, 'content', 'photo-collections');
const FILENAME_REPORT = path.join(COLLECTIONS_DIR, 'fotobase-match-report.json');
const REPORT_PATH = path.join(COLLECTIONS_DIR, 'fotobase-exif-report.json');
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

const SELF_TEST_SITE = path.join(
  COLLECTIONS_DIR,
  '2017-01-10-aktion-mod-dagpengeregler',
  'images',
  '01-mg-7483.jpg',
);
const SELF_TEST_FOTO = path.join(
  DEFAULT_FOTOBASE,
  'aktivisme',
  '20170119_dagpengeaktion_prosa_min_a-kasse_01',
  '_MG_7483_mk.jpg',
);

function fotobaseRoot() {
  const arg = process.argv.find((a) => a.startsWith('--root='));
  if (arg) return arg.slice('--root='.length);
  return process.env.FOTOBASE_ROOT || DEFAULT_FOTOBASE;
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

function normalizeText(value) {
  return String(value || '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function formatDateTimeOriginal(value) {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // EXIF times are often timezone-less; exif-reader treats them as UTC.
    const y = value.getUTCFullYear();
    const mo = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    const h = String(value.getUTCHours()).padStart(2, '0');
    const mi = String(value.getUTCMinutes()).padStart(2, '0');
    const s = String(value.getUTCSeconds()).padStart(2, '0');
    return `${y}:${mo}:${d} ${h}:${mi}:${s}`;
  }
  const s = String(value).trim();
  if (!s) return null;
  const m = s.match(
    /^(\d{4})[:\-.](\d{2})[:\-.](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
  );
  if (m) return `${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  return s;
}

function roundNum(value, digits = 6) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(Math.round(n * 10 ** digits) / 10 ** digits);
}

function exposureKey(meta) {
  if (!meta) return '';
  return [
    roundNum(meta.exposureTime),
    roundNum(meta.fNumber),
    roundNum(meta.iso, 0),
    roundNum(meta.focalLength),
  ].join('|');
}

function joinKey(meta) {
  if (!meta?.dateTimeOriginal) return null;
  const make = normalizeText(meta.make);
  const model = normalizeText(meta.model);
  if (!make && !model) return null;
  return `${meta.dateTimeOriginal}|${make}|${model}`;
}

async function readExifMeta(filePath) {
  let metadata;
  try {
    metadata = await sharp(filePath).metadata();
  } catch (err) {
    return { error: err.message };
  }
  if (!metadata.exif) return { noExif: true };

  let parsed;
  try {
    parsed = exifReader(metadata.exif);
  } catch (err) {
    return { error: err.message };
  }

  const image = parsed.Image || {};
  const photo = parsed.Photo || {};
  const dateTimeOriginal = formatDateTimeOriginal(photo.DateTimeOriginal);
  if (!dateTimeOriginal) return { noExif: true };

  const iso =
    photo.ISOSpeedRatings ??
    photo.PhotographicSensitivity ??
    photo.ISO ??
    null;

  return {
    dateTimeOriginal,
    make: image.Make || '',
    model: image.Model || '',
    exposureTime: photo.ExposureTime ?? null,
    fNumber: photo.FNumber ?? null,
    iso: Array.isArray(iso) ? iso[0] : iso,
    focalLength: photo.FocalLength ?? null,
  };
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

async function walkFotobase(root, byJoinKey) {
  let files = 0;
  let withExif = 0;
  let errors = 0;
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

      const meta = await readExifMeta(full);
      if (meta.error) {
        errors++;
        continue;
      }
      if (meta.noExif) continue;
      const key = joinKey(meta);
      if (!key) continue;
      withExif++;
      pushMap(byJoinKey, key, {
        path: full,
        exposure: exposureKey(meta),
      });

      if (files % 500 === 0) {
        console.log(`  indexed ${files} fotobase files (${withExif} with EXIF)...`);
      }
    }
  }

  return { files, withExif, errors };
}

function groupFrames(candidates) {
  const byExposure = new Map();
  for (const cand of candidates) {
    const exp = cand.exposure || '';
    pushMap(byExposure, exp, cand.path);
  }

  const frames = [];
  for (const [exposure, paths] of byExposure) {
    const ordered = preferOriginal(paths);
    frames.push({
      exposure,
      path: ordered[0],
      paths: ordered,
      candidateCount: ordered.length,
    });
  }
  return frames;
}

function asFound(frame) {
  return {
    matchClass: 'found',
    path: frame.path,
    paths: frame.paths,
    candidateCount: frame.candidateCount,
  };
}

function classify(siteMeta, candidates) {
  if (!siteMeta || siteMeta.noExif || siteMeta.error || !joinKey(siteMeta)) {
    return { matchClass: 'noExif', path: null, paths: [], candidateCount: 0 };
  }
  if (!candidates.length) {
    return { matchClass: 'none', path: null, paths: [], candidateCount: 0 };
  }

  let frames = groupFrames(candidates);
  if (frames.length === 1) return asFound(frames[0]);

  const siteExp = exposureKey(siteMeta);
  if (siteExp) {
    const narrowed = frames.filter((f) => f.exposure === siteExp);
    if (narrowed.length === 1) return asFound(narrowed[0]);
    if (narrowed.length > 1) frames = narrowed;
  }

  const allPaths = preferOriginal(frames.flatMap((f) => f.paths));
  return {
    matchClass: 'ambiguous',
    path: null,
    paths: allPaths,
    candidateCount: allPaths.length,
  };
}

function loadCandidates() {
  if (!fs.existsSync(FILENAME_REPORT)) {
    console.error('Filename report not found:', FILENAME_REPORT);
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(FILENAME_REPORT, 'utf8'));
  const rows = (report.images || []).filter(
    (row) => row.matchClass === 'none' || row.matchClass === 'ambiguous',
  );

  const filenameByKey = new Map();
  for (const row of rows) {
    const collectionPath = path.join(COLLECTIONS_DIR, row.collectionId, 'collection.json');
    if (!filenameByKey.has(row.collectionId)) {
      if (!fs.existsSync(collectionPath)) continue;
      const data = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));
      const map = new Map();
      for (const img of data.images || []) {
        map.set(img.id, img.filename || '');
      }
      filenameByKey.set(row.collectionId, map);
    }
    const filename = filenameByKey.get(row.collectionId)?.get(row.imageId) || '';
    row.filename = filename;
    row.sitePath = filename
      ? path.join(COLLECTIONS_DIR, row.collectionId, 'images', filename)
      : null;
  }

  return {
    filenameFound: report.found ?? 0,
    siteImagesTotal: report.siteImages ?? report.images?.length ?? 0,
    rows,
  };
}

async function selfTest() {
  console.log('Self-test: dagpenge pair join keys...');
  for (const p of [SELF_TEST_SITE, SELF_TEST_FOTO]) {
    if (!fs.existsSync(p)) {
      console.error('Self-test file missing:', p);
      process.exit(1);
    }
  }
  const site = await readExifMeta(SELF_TEST_SITE);
  const foto = await readExifMeta(SELF_TEST_FOTO);
  const siteKey = joinKey(site);
  const fotoKey = joinKey(foto);
  if (!siteKey || !fotoKey || siteKey !== fotoKey) {
    console.error('Self-test FAILED');
    console.error('  site key:', siteKey);
    console.error('  foto key:', fotoKey);
    process.exit(1);
  }
  console.log('Self-test OK:', siteKey);
}

async function main() {
  const root = fotobaseRoot();
  if (!fs.existsSync(root)) {
    console.error('Fotobase folder not found:', root);
    process.exit(1);
  }

  await selfTest();

  const { filenameFound, siteImagesTotal, rows } = loadCandidates();
  console.log(`Candidates from filename report: ${rows.length} (none|ambiguous)`);

  console.log('Indexing fotobase EXIF:', root);
  const byJoinKey = new Map();
  const indexStats = await walkFotobase(root, byJoinKey);
  console.log(
    `Fotobase images indexed: ${indexStats.files} (${indexStats.withExif} with joinable EXIF, ${indexStats.errors} read errors)`,
  );

  const counts = { found: 0, ambiguous: 0, noExif: 0, none: 0 };
  const byCollection = new Map();
  const images = [];

  let processed = 0;
  for (const row of rows) {
    processed++;
    if (processed % 200 === 0) {
      console.log(`  scanned ${processed}/${rows.length} site candidates...`);
    }

    let match;
    if (!row.sitePath || !fs.existsSync(row.sitePath)) {
      match = { matchClass: 'noExif', path: null, paths: [], candidateCount: 0 };
    } else {
      const siteMeta = await readExifMeta(row.sitePath);
      const key = joinKey(siteMeta);
      const candidates = key ? byJoinKey.get(key) || [] : [];
      match = classify(siteMeta, candidates);
    }

    counts[match.matchClass]++;
    images.push({
      collectionId: row.collectionId,
      imageId: row.imageId,
      originalFilename: row.originalFilename,
      filename: row.filename,
      width: row.width,
      matchClass: match.matchClass,
      path: match.path,
      paths: match.paths,
      candidateCount: match.candidateCount,
    });

    let roll = byCollection.get(row.collectionId);
    if (!roll) {
      roll = { found: 0, ambiguous: 0, noExif: 0, none: 0, total: 0 };
      byCollection.set(row.collectionId, roll);
    }
    roll.total++;
    roll[match.matchClass]++;
  }

  const collections = [...byCollection.entries()]
    .map(([id, roll]) => ({
      id,
      ...roll,
      foundRate: roll.total ? Math.round((roll.found / roll.total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.foundRate - b.foundRate || b.none - a.none || a.id.localeCompare(b.id));

  const combinedFound = filenameFound + counts.found;
  const combinedRate = siteImagesTotal
    ? Math.round((combinedFound / siteImagesTotal) * 1000) / 10
    : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    fotobaseRoot: root,
    fotobaseFiles: indexStats.files,
    fotobaseWithExif: indexStats.withExif,
    siteCandidates: rows.length,
    siteImagesTotal,
    filenameFound,
    found: counts.found,
    foundRate: rows.length ? Math.round((counts.found / rows.length) * 1000) / 10 : 0,
    combinedFound,
    combinedFoundRate: combinedRate,
    counts,
    collections,
    images,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');

  console.log('\n=== FOTOBASE EXIF SURVEY ===');
  console.log(`Site candidates:    ${rows.length}`);
  console.log(`Fotobase images:    ${indexStats.files}`);
  console.log(`Found (EXIF-only):  ${counts.found} (${report.foundRate}%)`);
  console.log(`Ambiguous:          ${counts.ambiguous}`);
  console.log(`No EXIF:            ${counts.noExif}`);
  console.log(`None:               ${counts.none}`);
  console.log(
    `Combined coverage:  ${combinedFound}/${siteImagesTotal} (${combinedRate}%)  [filename ${filenameFound} + EXIF ${counts.found}]`,
  );
  console.log(`\nReport: ${REPORT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
