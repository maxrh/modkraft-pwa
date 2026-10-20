/**
 * Merge filename + EXIF survey reports with manual decisions.
 * Used only by the local match workbench API.
 */

import fs from 'node:fs';
import path from 'node:path';

const FOUND_FN = new Set(['uniqueBasename', 'uniqueCamera', 'uniqueStem']);

export const DEFAULT_FOTOBASE = path.join(
  'C:',
  'Users',
  'max',
  'Dropbox',
  'Monsun',
  'Monsun Foto Upload',
  'fotobase',
);

export function fotobaseRoot() {
  return process.env.FOTOBASE_ROOT || DEFAULT_FOTOBASE;
}

export function preferOriginal(paths) {
  return [...paths].sort((a, b) => {
    const rank = (p) => {
      const ext = path.extname(p).toLowerCase();
      if (ext === '.tif' || ext === '.tiff') return 0;
      return 1;
    };
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}

function decisionKey(collectionId, imageId) {
  return `${collectionId}/${imageId}`;
}

/**
 * @param {object} opts
 * @param {string} opts.collectionsDir
 * @param {string} opts.filenameReportPath
 * @param {string} opts.exifReportPath
 * @param {string} [opts.deepReportPath]
 * @param {string} opts.decisionsPath
 */
const DATE_FOLDER_RADIUS_DAYS = 2;
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.tif', '.tiff', '.png', '.webp']);

/** Collection event day from id prefix or publishedAt (YYYY-MM-DD). */
export function collectionEventDay(collectionId, meta) {
  const fromId = String(collectionId || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (fromId) return `${fromId[1]}-${fromId[2]}-${fromId[3]}`;
  const pub = String(meta?.publishedAt || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(pub)) return pub;
  return null;
}

function dayToYyyymmdd(day) {
  const m = String(day || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}`;
}

/** Inclusive ±radius calendar days as YYYYMMDD folder prefixes. */
export function datePrefixesAround(day, radius = DATE_FOLDER_RADIUS_DAYS) {
  const m = String(day || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return [];
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dayMs = 24 * 60 * 60 * 1000;
  const out = [];
  for (let i = -radius; i <= radius; i++) {
    const d = new Date(base + i * dayMs);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    out.push(`${y}${mo}${dd}`);
  }
  return out;
}

export function createMatchStore(opts) {
  const {
    collectionsDir,
    filenameReportPath,
    exifReportPath,
    deepReportPath = null,
    decisionsPath,
  } = opts;

  /** @type {{ mtime: number, data: any } | null} */
  let filenameCache = null;
  /** @type {{ mtime: number, data: any } | null} */
  let exifCache = null;
  /** @type {{ mtime: number, data: any } | null} */
  let deepCache = null;
  /** @type {{ root: string, foldersByPrefix: Map<string, { path: string, name: string }[]> } | null} */
  let datedFolderIndex = null;

  function readJsonCached(filePath, cache) {
    const st = fs.statSync(filePath);
    const mtime = st.mtimeMs;
    if (cache && cache.mtime === mtime) return { cache, data: cache.data };
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { cache: { mtime, data }, data };
  }

  function loadFilenameReport() {
    if (!fs.existsSync(filenameReportPath)) {
      return { images: [], fotobaseRoot: fotobaseRoot() };
    }
    const next = readJsonCached(filenameReportPath, filenameCache);
    filenameCache = next.cache;
    return next.data;
  }

  function loadExifReport() {
    if (!fs.existsSync(exifReportPath)) {
      return { images: [] };
    }
    const next = readJsonCached(exifReportPath, exifCache);
    exifCache = next.cache;
    return next.data;
  }

  function loadDeepReport() {
    if (!deepReportPath || !fs.existsSync(deepReportPath)) {
      return { images: [] };
    }
    const next = readJsonCached(deepReportPath, deepCache);
    deepCache = next.cache;
    return next.data;
  }

  function loadDecisions() {
    if (!fs.existsSync(decisionsPath)) return {};
    try {
      return JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));
    } catch {
      return {};
    }
  }

  function saveDecisions(decisions) {
    fs.writeFileSync(decisionsPath, JSON.stringify(decisions, null, 2) + '\n');
  }

  function loadCollectionMeta(collectionId) {
    const filePath = path.join(collectionsDir, collectionId, 'collection.json');
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  function listCollectionIds() {
    return fs
      .readdirSync(collectionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
      .map((d) => d.name)
      .sort();
  }

  /** Index fotobase dirs whose basename starts with YYYYMMDD (cached per process). */
  function getDatedFolderIndex() {
    const root = path.resolve(fotobaseRoot());
    if (datedFolderIndex && datedFolderIndex.root === root) return datedFolderIndex;

    /** @type {Map<string, { path: string, name: string }[]>} */
    const foldersByPrefix = new Map();

    function walk(dir, depth) {
      if (depth > 5) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === '_NEWSIZES') {
          continue;
        }
        const full = path.join(dir, entry.name);
        const m = entry.name.match(/^(\d{8})/);
        if (m) {
          const prefix = m[1];
          let list = foldersByPrefix.get(prefix);
          if (!list) {
            list = [];
            foldersByPrefix.set(prefix, list);
          }
          list.push({ path: full, name: entry.name });
        }
        walk(full, depth + 1);
      }
    }

    walk(root, 0);
    datedFolderIndex = { root, foldersByPrefix };
    return datedFolderIndex;
  }

  function countImagesInDir(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    let n = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) n++;
    }
    return n;
  }

  /**
   * Fotobase folders whose name starts with a YYYYMMDD near the collection date.
   * @returns {{ path: string, name: string, count: number, reason: 'date', datePrefix: string }[]}
   */
  function foldersNearCollectionDate(collectionId, meta) {
    const day = collectionEventDay(collectionId, meta);
    if (!day) return [];
    const prefixes = datePrefixesAround(day, DATE_FOLDER_RADIUS_DAYS);
    const { foldersByPrefix } = getDatedFolderIndex();
    const seen = new Set();
    const out = [];
    for (const prefix of prefixes) {
      for (const folder of foldersByPrefix.get(prefix) || []) {
        const resolved = path.resolve(folder.path);
        if (seen.has(resolved)) continue;
        seen.add(resolved);
        out.push({
          path: folder.path,
          name: folder.name,
          count: countImagesInDir(folder.path),
          reason: /** @type {const} */ ('date'),
          datePrefix: prefix,
        });
      }
    }
    out.sort(
      (a, b) =>
        b.datePrefix.localeCompare(a.datePrefix) ||
        b.count - a.count ||
        a.name.localeCompare(b.name),
    );
    return out;
  }

  function samePath(a, b) {
    if (!a || !b) return false;
    return path.resolve(a) === path.resolve(b);
  }

  function suggestionMatchesReject(suggestion, decision) {
    if (!suggestion?.path || decision?.status !== 'rejected') return false;
    if (!decision.path) return true; // no path yet → hide all (legacy)
    if (samePath(suggestion.path, decision.path)) return true;
    for (const p of decision.paths || []) {
      if (samePath(suggestion.path, p)) return true;
    }
    return false;
  }

  function suggestionFromReports(fnRow, exifRow, deepRow) {
    if (fnRow && FOUND_FN.has(fnRow.matchClass) && fnRow.path) {
      const paths = preferOriginal(fnRow.paths?.length ? fnRow.paths : [fnRow.path]);
      return {
        path: paths[0],
        paths,
        source: 'filename',
        matchClass: fnRow.matchClass,
      };
    }
    if (exifRow && exifRow.matchClass === 'found' && exifRow.path) {
      const paths = preferOriginal(exifRow.paths?.length ? exifRow.paths : [exifRow.path]);
      return {
        path: paths[0],
        paths,
        source: 'exif',
        matchClass: 'found',
      };
    }
    if (deepRow && deepRow.matchClass === 'found' && deepRow.path) {
      const paths = preferOriginal(deepRow.paths?.length ? deepRow.paths : [deepRow.path]);
      return {
        path: paths[0],
        paths,
        source: 'deep',
        matchClass: 'found',
      };
    }
    return null;
  }

  /**
   * @returns {{ status: string, path: string|null, paths: string[], suggestion: object|null, decision: object|null, source: string|null }}
   */
  function resolveImage(collectionId, imageId, fnRow, exifRow, deepRow, decision) {
    let suggestion = suggestionFromReports(fnRow, exifRow, deepRow);

    if (decision?.status === 'imported' && decision.path) {
      return {
        status: 'imported',
        path: decision.path,
        paths: preferOriginal(decision.paths?.length ? decision.paths : [decision.path]),
        suggestion: null,
        decision,
        source: 'imported',
      };
    }

    if (decision?.status === 'confirmed' && decision.path) {
      return {
        status: 'matched',
        path: decision.path,
        paths: preferOriginal(decision.paths?.length ? decision.paths : [decision.path]),
        suggestion,
        decision,
        source: 'confirmed',
      };
    }

    if (decision?.status === 'keep' && decision.path) {
      return {
        status: 'matched',
        path: decision.path,
        paths: preferOriginal(decision.paths?.length ? decision.paths : [decision.path]),
        suggestion,
        decision,
        source: 'keep',
      };
    }

    if (decision?.status === 'skipped') {
      return {
        status: 'skipped',
        path: null,
        paths: [],
        suggestion: null,
        decision,
        source: null,
      };
    }

    if (decision?.status === 'rejected') {
      if (suggestion && suggestionMatchesReject(suggestion, decision)) {
        // Drop the rejected path; try deep-only if FN/EXIF was the reject.
        if (suggestion.source !== 'deep' && deepRow?.matchClass === 'found' && deepRow.path) {
          const paths = preferOriginal(deepRow.paths?.length ? deepRow.paths : [deepRow.path]);
          const deepSug = {
            path: paths[0],
            paths,
            source: 'deep',
            matchClass: 'found',
          };
          if (!suggestionMatchesReject(deepSug, decision)) {
            suggestion = deepSug;
          } else {
            suggestion = null;
          }
        } else {
          suggestion = null;
        }
      }
      if (suggestion) {
        return {
          status: 'suggested',
          path: suggestion.path,
          paths: suggestion.paths,
          suggestion,
          decision,
          source: suggestion.source,
        };
      }
      return {
        status: 'rejected',
        path: null,
        paths: [],
        suggestion: null,
        decision,
        source: null,
      };
    }

    if (suggestion) {
      return {
        status: 'suggested',
        path: suggestion.path,
        paths: suggestion.paths,
        suggestion,
        decision: decision || null,
        source: suggestion.source,
      };
    }

    return {
      status: 'unmatched',
      path: null,
      paths: [],
      suggestion: null,
      decision: decision || null,
      source: null,
    };
  }

  function buildIndex() {
    const fn = loadFilenameReport();
    const ex = loadExifReport();
    const deep = loadDeepReport();
    const decisions = loadDecisions();

    /** @type {Map<string, any>} */
    const fnByKey = new Map();
    for (const row of fn.images || []) {
      fnByKey.set(decisionKey(row.collectionId, row.imageId), row);
    }
    /** @type {Map<string, any>} */
    const exByKey = new Map();
    for (const row of ex.images || []) {
      exByKey.set(decisionKey(row.collectionId, row.imageId), row);
    }
    /** @type {Map<string, any>} */
    const deepByKey = new Map();
    for (const row of deep.images || []) {
      deepByKey.set(decisionKey(row.collectionId, row.imageId), row);
    }

    return { fn, ex, deep, decisions, fnByKey, exByKey, deepByKey };
  }

  function getCollectionSummaries() {
    const { decisions, fnByKey, exByKey, deepByKey } = buildIndex();
    const ids = listCollectionIds();
    const summaries = [];

    for (const id of ids) {
      const meta = loadCollectionMeta(id);
      if (!meta) continue;
      const images = meta.images || [];
      let matched = 0;
      let imported = 0;
      let suggested = 0;
      let unmatched = 0;
      let skipped = 0;

      for (const img of images) {
        const key = decisionKey(id, img.id);
        const resolved = resolveImage(
          id,
          img.id,
          fnByKey.get(key),
          exByKey.get(key),
          deepByKey.get(key),
          decisions[key],
        );
        if (resolved.status === 'matched') matched++;
        else if (resolved.status === 'imported') imported++;
        else if (resolved.status === 'suggested') suggested++;
        else if (resolved.status === 'skipped') skipped++;
        else unmatched++; // includes rejected — still a gap
      }

      summaries.push({
        id,
        title: meta.title || id,
        photographers: meta.photographers || [],
        total: images.length,
        matched,
        imported,
        suggested,
        unmatched,
        skipped,
        gaps: unmatched,
      });
    }

    summaries.sort((a, b) => b.gaps - a.gaps || b.suggested - a.suggested || a.id.localeCompare(b.id));
    return summaries;
  }

  function getCollectionDetail(collectionId) {
    const meta = loadCollectionMeta(collectionId);
    if (!meta) return null;

    const { decisions, fnByKey, exByKey, deepByKey } = buildIndex();
    const pathOwners = new Map();

    const images = (meta.images || [])
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((img) => {
        const key = decisionKey(collectionId, img.id);
        const resolved = resolveImage(
          collectionId,
          img.id,
          fnByKey.get(key),
          exByKey.get(key),
          deepByKey.get(key),
          decisions[key],
        );

        if (resolved.path) {
          const owners = pathOwners.get(resolved.path) || [];
          owners.push(img.id);
          pathOwners.set(resolved.path, owners);
        }

        return {
          imageId: img.id,
          filename: img.filename,
          originalFilename: img.originalFilename || '',
          credit: img.credit || null,
          width: img.width ?? null,
          height: img.height ?? null,
          siteHref: `/foto/${collectionId}/${img.id}`,
          siteSrc: `/media/photo-collections/${collectionId}/images/${img.filename}`,
          siteThumb: `/media/thumbs/${collectionId}/${String(img.filename).replace(/\.[^.]+$/, '')}.webp`,
          status: resolved.status,
          path: resolved.path,
          paths: resolved.paths,
          source: resolved.source,
          suggestion: resolved.suggestion,
          decision: resolved.decision,
        };
      });

    const duplicatePaths = [...pathOwners.entries()]
      .filter(([, owners]) => owners.length > 1)
      .map(([p, owners]) => ({ path: p, imageIds: owners }));

    /** @type {Map<string, number>} */
    const folderCounts = new Map();
    for (const img of images) {
      if (!img.path) continue;
      const dir = path.dirname(img.path);
      folderCounts.set(dir, (folderCounts.get(dir) || 0) + 1);
    }
    const matchedFolders = [...folderCounts.entries()]
      .map(([dir, count]) => ({
        path: dir,
        name: path.basename(dir),
        count,
        reason: /** @type {const} */ ('matched'),
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const dateFolders = foldersNearCollectionDate(collectionId, meta);
    const matchedResolved = new Set(matchedFolders.map((f) => path.resolve(f.path)));
    const dateOnly = dateFolders.filter((f) => !matchedResolved.has(path.resolve(f.path)));

    // Matched-path folders first, then date neighbors (for gap browsing).
    const suggestedFolders = [...matchedFolders, ...dateOnly];

    const defaultFotobaseDir =
      matchedFolders[0]?.path ?? dateOnly[0]?.path ?? null;

    return {
      id: collectionId,
      title: meta.title || collectionId,
      photographers: meta.photographers || [],
      collectionDay: collectionEventDay(collectionId, meta),
      images,
      duplicatePaths,
      defaultFotobaseDir,
      suggestedFolders,
    };
  }

  function setDecision({ collectionId, imageId, status, path: filePath, paths, source }) {
    if (!['confirmed', 'keep', 'rejected', 'skipped', 'imported'].includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }
    const decisions = loadDecisions();
    const key = decisionKey(collectionId, imageId);
    const entry = {
      status,
      source: source || 'manual',
      at: new Date().toISOString(),
    };
    if (status === 'confirmed' || status === 'keep' || status === 'imported') {
      if (!filePath) throw new Error(`${status} requires path`);
      entry.path = filePath;
      entry.paths = paths?.length ? preferOriginal(paths) : [filePath];
    }
    if (status === 'rejected' && filePath) {
      entry.path = filePath;
      entry.paths = paths?.length ? preferOriginal(paths) : [filePath];
    }
    decisions[key] = entry;
    saveDecisions(decisions);
    return entry;
  }

  function clearDecision(collectionId, imageId) {
    const decisions = loadDecisions();
    const key = decisionKey(collectionId, imageId);
    delete decisions[key];
    saveDecisions(decisions);
  }

  return {
    fotobaseRoot,
    loadDecisions,
    getCollectionSummaries,
    getCollectionDetail,
    setDecision,
    clearDecision,
    buildIndex,
  };
}
