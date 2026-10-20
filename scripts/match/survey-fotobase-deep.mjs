#!/usr/bin/env node
/**
 * Deep folder EXIF survey: match remaining gaps only inside fotobase folders
 * already proven by confirmed/keep decisions (+ same-YYYYMMDD siblings).
 * Ignores folder titles and filenames; numbered files match via EXIF.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  IMAGE_EXT,
  preferOriginal,
  joinKey,
  exposureKey,
  readExifMeta,
  calendarDay,
  dayToNumber,
  trailingCode,
  creditToCode,
  folderDatePrefix,
  folderPrefixToDay,
} from './exif-utils.mjs';
import { fotobaseRoot } from './fotobase-match-status.mjs';

const SITE_ROOT = process.cwd();
const COLLECTIONS_DIR = path.join(SITE_ROOT, 'content', 'photo-collections');
const DECISIONS_PATH = path.join(COLLECTIONS_DIR, 'fotobase-match-decisions.json');
const FILENAME_REPORT = path.join(COLLECTIONS_DIR, 'fotobase-match-report.json');
const EXIF_REPORT = path.join(COLLECTIONS_DIR, 'fotobase-exif-report.json');
const REPORT_PATH = path.join(COLLECTIONS_DIR, 'fotobase-deep-report.json');

const FOUND_FN = new Set(['uniqueBasename', 'uniqueCamera', 'uniqueStem']);

function decisionKey(collectionId, imageId) {
  return `${collectionId}/${imageId}`;
}

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
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

function recoverRejectPaths(decisions, fnReport, exifReport) {
  const fnByKey = new Map();
  for (const row of fnReport.images || []) {
    fnByKey.set(decisionKey(row.collectionId, row.imageId), row);
  }
  const exByKey = new Map();
  for (const row of exifReport.images || []) {
    exByKey.set(decisionKey(row.collectionId, row.imageId), row);
  }

  let updated = 0;
  for (const [key, d] of Object.entries(decisions)) {
    if (d.status !== 'rejected') continue;
    if (d.path) continue;
    const fn = fnByKey.get(key);
    const ex = exByKey.get(key);
    let pathFound = null;
    let paths = [];
    if (fn && FOUND_FN.has(fn.matchClass) && fn.path) {
      pathFound = fn.path;
      paths = preferOriginal(fn.paths?.length ? fn.paths : [fn.path]);
    } else if (ex && ex.matchClass === 'found' && ex.path) {
      pathFound = ex.path;
      paths = preferOriginal(ex.paths?.length ? ex.paths : [ex.path]);
    }
    if (pathFound) {
      d.path = pathFound;
      d.paths = paths;
      updated++;
    }
  }
  return updated;
}

function listSiblingFolders(seedDir) {
  const prefix = folderDatePrefix(seedDir);
  if (!prefix) return [];
  const parent = path.dirname(seedDir);
  let entries;
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return [];
  }
  const siblings = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '_NEWSIZES') continue;
    if (!entry.name.startsWith(prefix)) continue;
    const full = path.join(parent, entry.name);
    if (path.resolve(full) === path.resolve(seedDir)) continue;
    siblings.push(full);
  }
  return siblings;
}

async function indexFolder(dir, unavailable, byJoinKey) {
  let files = 0;
  let withExif = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`WARN: cannot read ${dir}: ${err.message}`);
    return { files: 0, withExif: 0 };
  }

  for (const entry of entries) {
    if (entry.name === '_NEWSIZES' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) continue;
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXT.has(ext)) continue;
    files++;
    if (unavailable.has(path.resolve(full))) continue;

    const meta = await readExifMeta(full);
    if (meta.error || meta.noExif) continue;
    const key = joinKey(meta);
    if (!key) continue;
    withExif++;
    pushMap(byJoinKey, key, {
      path: full,
      exposure: exposureKey(meta),
      code: trailingCode(entry.name),
      day: calendarDay(meta.dateTimeOriginal),
      folder: dir,
    });
  }
  return { files, withExif };
}

function groupFrames(candidates) {
  const byExposure = new Map();
  for (const cand of candidates) {
    pushMap(byExposure, cand.exposure || '', cand);
  }
  const frames = [];
  for (const [exposure, cands] of byExposure) {
    const paths = preferOriginal(cands.map((c) => c.path));
    const primary = cands.find((c) => c.path === paths[0]) || cands[0];
    frames.push({
      exposure,
      path: paths[0],
      paths,
      candidateCount: paths.length,
      code: primary.code || '',
      folder: primary.folder,
      day: primary.day,
      cands,
    });
  }
  return frames;
}

function exposureMatchScore(siteExp, frameExp) {
  if (!siteExp || !frameExp) return 0;
  return siteExp === frameExp ? 2 : 0;
}

function pickFrame(siteMeta, frames, credit) {
  if (!frames.length) return null;
  let list = frames;
  const siteExp = exposureKey(siteMeta);
  if (siteExp) {
    const narrowed = list.filter((f) => f.exposure === siteExp);
    if (narrowed.length === 1) return { frame: narrowed[0], score: 2 };
    if (narrowed.length > 1) list = narrowed;
  }

  const wanted = creditToCode(credit);
  if (wanted) {
    const byCode = list.filter((f) => f.code === wanted);
    if (byCode.length === 1) {
      return { frame: byCode[0], score: exposureMatchScore(siteExp, byCode[0].exposure) + 1 };
    }
    if (byCode.length > 1) list = byCode;
  }

  if (list.length === 1) {
    return { frame: list[0], score: exposureMatchScore(siteExp, list[0].exposure) };
  }
  return null; // ambiguous
}

function dayInWindow(day, minDay, maxDay) {
  const n = dayToNumber(day);
  const lo = dayToNumber(minDay);
  const hi = dayToNumber(maxDay);
  if (n == null || lo == null || hi == null) return true; // no guard if incomplete
  const dayMs = 24 * 60 * 60 * 1000;
  return n >= lo - dayMs && n <= hi + dayMs;
}

async function buildDateWindow(collectionId, confirmedPaths) {
  const days = [];
  for (const filePath of confirmedPaths) {
    const meta = await readExifMeta(filePath);
    const day = calendarDay(meta.dateTimeOriginal);
    if (day) {
      days.push(day);
      continue;
    }
    const prefix = folderDatePrefix(path.dirname(filePath));
    const fromFolder = folderPrefixToDay(prefix);
    if (fromFolder) days.push(fromFolder);
  }
  if (!days.length) return { minDay: null, maxDay: null };
  days.sort();
  return { minDay: days[0], maxDay: days[days.length - 1] };
}

async function main() {
  const root = fotobaseRoot();
  if (!fs.existsSync(root)) {
    console.error('Fotobase folder not found:', root);
    process.exit(1);
  }

  const decisions = loadJson(DECISIONS_PATH, {});
  const fnReport = loadJson(FILENAME_REPORT, { images: [] });
  const exifReport = loadJson(EXIF_REPORT, { images: [] });

  const recovered = recoverRejectPaths(decisions, fnReport, exifReport);
  if (recovered > 0) {
    saveJson(DECISIONS_PATH, decisions);
    console.log(`Recovered reject paths: ${recovered}`);
  }

  /** @type {Map<string, { seeds: Set<string>, used: Set<string>, blacklist: Set<string>, confirmedPaths: string[] }>} */
  const byCollection = new Map();

  for (const [key, d] of Object.entries(decisions)) {
    const [collectionId, imageId] = key.split('/');
    if (!collectionId || !imageId) continue;
    if (!byCollection.has(collectionId)) {
      byCollection.set(collectionId, {
        seeds: new Set(),
        used: new Set(),
        blacklist: new Set(),
        confirmedPaths: [],
      });
    }
    const pack = byCollection.get(collectionId);
    if (
      (d.status === 'confirmed' || d.status === 'keep' || d.status === 'imported') &&
      d.path
    ) {
      const resolved = path.resolve(d.path);
      pack.seeds.add(path.dirname(resolved));
      pack.used.add(resolved);
      for (const p of d.paths || [d.path]) pack.used.add(path.resolve(p));
      pack.confirmedPaths.push(resolved);
    }
    if (d.status === 'rejected' && d.path) {
      pack.blacklist.add(path.resolve(d.path));
      for (const p of d.paths || []) pack.blacklist.add(path.resolve(p));
    }
  }

  // Global unavailable = all used + all blacklists
  const globalUnavailable = new Set();
  for (const pack of byCollection.values()) {
    for (const p of pack.used) globalUnavailable.add(p);
    for (const p of pack.blacklist) globalUnavailable.add(p);
  }

  const collections = [...byCollection.keys()].sort();
  console.log(`Seeded collections: ${collections.length}`);

  const imagesOut = [];
  const counts = { found: 0, ambiguous: 0, noExif: 0, none: 0, outOfWindow: 0 };
  let foldersIndexed = 0;
  let filesIndexed = 0;
  let filesWithExif = 0;

  /** Pending assignments before one-file-one-image resolution */
  const pending = [];

  for (const collectionId of collections) {
    const pack = byCollection.get(collectionId);
    const searchDirs = new Set(pack.seeds);
    for (const seed of pack.seeds) {
      for (const sib of listSiblingFolders(seed)) searchDirs.add(sib);
    }

    const unavailable = new Set([...globalUnavailable]);
    const byJoinKey = new Map();
    for (const dir of searchDirs) {
      foldersIndexed++;
      const stats = await indexFolder(dir, unavailable, byJoinKey);
      filesIndexed += stats.files;
      filesWithExif += stats.withExif;
    }

    const window = await buildDateWindow(collectionId, pack.confirmedPaths);
    const metaPath = path.join(COLLECTIONS_DIR, collectionId, 'collection.json');
    if (!fs.existsSync(metaPath)) continue;
    const collection = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

    for (const img of collection.images || []) {
      const key = decisionKey(collectionId, img.id);
      const decision = decisions[key];
      if (
        decision?.status === 'confirmed' ||
        decision?.status === 'keep' ||
        decision?.status === 'imported'
      ) {
        continue;
      }
      if (decision?.status === 'skipped') continue;

      const sitePath = path.join(COLLECTIONS_DIR, collectionId, 'images', img.filename);
      const rowBase = {
        collectionId,
        imageId: img.id,
        originalFilename: img.originalFilename || '',
        filename: img.filename || '',
        width: img.width ?? null,
      };

      if (!fs.existsSync(sitePath)) {
        counts.noExif++;
        imagesOut.push({
          ...rowBase,
          matchClass: 'noExif',
          path: null,
          paths: [],
          candidateCount: 0,
          folder: null,
        });
        continue;
      }

      const siteMeta = await readExifMeta(sitePath);
      const jk = joinKey(siteMeta);
      if (!jk || siteMeta.noExif || siteMeta.error) {
        counts.noExif++;
        imagesOut.push({
          ...rowBase,
          matchClass: 'noExif',
          path: null,
          paths: [],
          candidateCount: 0,
          folder: null,
        });
        continue;
      }

      const siteDay = calendarDay(siteMeta.dateTimeOriginal);
      if (window.minDay && window.maxDay && siteDay && !dayInWindow(siteDay, window.minDay, window.maxDay)) {
        counts.outOfWindow++;
        counts.none++;
        imagesOut.push({
          ...rowBase,
          matchClass: 'none',
          path: null,
          paths: [],
          candidateCount: 0,
          folder: null,
          note: 'outOfWindow',
        });
        continue;
      }

      const candidates = (byJoinKey.get(jk) || []).filter(
        (c) => !unavailable.has(path.resolve(c.path)),
      );
      // Also filter blacklist for this collection
      const filtered = candidates.filter(
        (c) => !pack.blacklist.has(path.resolve(c.path)),
      );

      if (!filtered.length) {
        counts.none++;
        imagesOut.push({
          ...rowBase,
          matchClass: 'none',
          path: null,
          paths: [],
          candidateCount: 0,
          folder: null,
        });
        continue;
      }

      // If reject stores path, exclude that exact suggestion (already in blacklist)
      const frames = groupFrames(filtered);
      const picked = pickFrame(siteMeta, frames, img.credit);
      if (!picked) {
        counts.ambiguous++;
        const allPaths = preferOriginal(frames.flatMap((f) => f.paths));
        imagesOut.push({
          ...rowBase,
          matchClass: 'ambiguous',
          path: null,
          paths: allPaths,
          candidateCount: allPaths.length,
          folder: null,
        });
        continue;
      }

      pending.push({
        collectionId,
        imageId: img.id,
        rowBase,
        frame: picked.frame,
        score: picked.score,
        siteMeta,
      });
    }
  }

  // Resolve one-file-one-image conflicts
  const byFile = new Map();
  for (const item of pending) {
    const resolved = path.resolve(item.frame.path);
    pushMap(byFile, resolved, item);
  }

  const assigned = new Map(); // image key -> item
  const conflictLosers = new Set();

  for (const [, items] of byFile) {
    if (items.length === 1) {
      assigned.set(decisionKey(items[0].collectionId, items[0].imageId), items[0]);
      continue;
    }
    items.sort(
      (a, b) =>
        b.score - a.score ||
        String(a.imageId).localeCompare(String(b.imageId), undefined, { numeric: true }),
    );
    const winner = items[0];
    assigned.set(decisionKey(winner.collectionId, winner.imageId), winner);
    for (let i = 1; i < items.length; i++) {
      conflictLosers.add(decisionKey(items[i].collectionId, items[i].imageId));
      counts.ambiguous++;
      imagesOut.push({
        ...items[i].rowBase,
        matchClass: 'ambiguous',
        path: null,
        paths: preferOriginal(items[i].frame.paths),
        candidateCount: items[i].frame.paths.length,
        folder: items[i].frame.folder,
        note: 'fileConflict',
      });
    }
  }

  for (const [key, item] of assigned) {
    if (conflictLosers.has(key)) continue;
    counts.found++;
    imagesOut.push({
      ...item.rowBase,
      matchClass: 'found',
      path: item.frame.path,
      paths: item.frame.paths,
      candidateCount: item.frame.paths.length,
      folder: item.frame.folder,
    });
  }

  imagesOut.sort(
    (a, b) =>
      a.collectionId.localeCompare(b.collectionId) ||
      String(a.imageId).localeCompare(String(b.imageId), undefined, { numeric: true }),
  );

  // Per-collection rollups for found only (deep candidates)
  const byColl = new Map();
  for (const row of imagesOut) {
    let roll = byColl.get(row.collectionId);
    if (!roll) {
      roll = { found: 0, ambiguous: 0, noExif: 0, none: 0, total: 0 };
      byColl.set(row.collectionId, roll);
    }
    roll.total++;
    if (row.matchClass === 'found') roll.found++;
    else if (row.matchClass === 'ambiguous') roll.ambiguous++;
    else if (row.matchClass === 'noExif') roll.noExif++;
    else roll.none++;
  }

  const collectionsOut = [...byColl.entries()]
    .map(([id, roll]) => ({
      id,
      ...roll,
      foundRate: roll.total ? Math.round((roll.found / roll.total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.found - a.found || a.id.localeCompare(b.id));

  const report = {
    generatedAt: new Date().toISOString(),
    fotobaseRoot: root,
    seededCollections: collections.length,
    foldersIndexed,
    filesIndexed,
    filesWithExif,
    rejectPathsRecovered: recovered,
    siteCandidates: imagesOut.length,
    found: counts.found,
    counts: {
      found: counts.found,
      ambiguous: counts.ambiguous,
      noExif: counts.noExif,
      none: counts.none,
      outOfWindow: counts.outOfWindow,
    },
    collections: collectionsOut,
    images: imagesOut,
  };

  saveJson(REPORT_PATH, report);

  console.log('\n=== DEEP FOLDER EXIF SURVEY ===');
  console.log(`Collections:        ${collections.length}`);
  console.log(`Folders indexed:    ${foldersIndexed}`);
  console.log(`Files indexed:      ${filesIndexed} (${filesWithExif} with EXIF)`);
  console.log(`Site candidates:    ${imagesOut.length}`);
  console.log(`Found:              ${counts.found}`);
  console.log(`Ambiguous:          ${counts.ambiguous}`);
  console.log(`No EXIF:            ${counts.noExif}`);
  console.log(`None:               ${counts.none} (outOfWindow ${counts.outOfWindow})`);
  console.log(`\nReport: ${REPORT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
