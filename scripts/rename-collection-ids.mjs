/**
 * Full rename: drop YYYY-MM-DD- prefixes from collection folder ids.
 * Recurring slug collisions get year (or month+year) appended to the title
 * before slugify, so id = slug = URL segment.
 *
 * Usage:
 *   node scripts/rename-collection-ids.mjs --dry-run
 *   node scripts/rename-collection-ids.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { slugifyTitle } from './import-foto/lib/slug.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const COLLECTIONS_DIR = path.join(ROOT, 'content', 'photo-collections');
const INDEX_PATH = path.join(COLLECTIONS_DIR, '_index.json');
const DECISIONS_PATH = path.join(COLLECTIONS_DIR, 'fotobase-match-decisions.json');
const ENRICH_PATH = path.join(ROOT, 'scripts', 'enrich-tags.mjs');
const THUMBS_DIR = path.join(ROOT, 'public', 'media', 'thumbs');

const DRY = process.argv.includes('--dry-run');

const DA_MONTHS = [
  'januar',
  'februar',
  'marts',
  'april',
  'maj',
  'juni',
  'juli',
  'august',
  'september',
  'oktober',
  'november',
  'december',
];

function readCollection(dirName) {
  const dir = path.join(COLLECTIONS_DIR, dirName);
  const jsonPath = path.join(dir, 'collection.json');
  if (!fs.existsSync(jsonPath)) return null;
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  return { dirName, dir, jsonPath, data };
}

function listCollections() {
  return fs
    .readdirSync(COLLECTIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readCollection(d.name))
    .filter(Boolean)
    .sort((a, b) => a.dirName.localeCompare(b.dirName));
}

function yearOf(col) {
  const pub = String(col.data.publishedAt || '').slice(0, 4);
  if (/^\d{4}$/.test(pub)) return pub;
  const fromId = String(col.data.id || col.dirName).match(/^(\d{4})-/);
  return fromId ? fromId[1] : null;
}

function monthNameOf(col) {
  const pub = String(col.data.publishedAt || '').slice(0, 10);
  const m = pub.match(/^\d{4}-(\d{2})-/);
  if (!m) return null;
  return DA_MONTHS[Number(m[1]) - 1] || null;
}

function titleHasYear(title, year) {
  return new RegExp(`\\b${year}\\b`).test(title);
}

/** Build unique newId for every collection; mutate title/slug on collisions. */
function planRenames(cols) {
  /** @type {Map<string, typeof cols>} */
  const byBaseSlug = new Map();
  for (const col of cols) {
    const base =
      col.data.slug ||
      String(col.data.id || col.dirName).replace(/^\d{4}-\d{2}-\d{2}-/, '');
    if (!byBaseSlug.has(base)) byBaseSlug.set(base, []);
    byBaseSlug.get(base).push(col);
  }

  /** @type {{ oldId: string, newId: string, title: string, titleChanged: boolean, col: any }[]} */
  const plans = [];

  for (const [, group] of byBaseSlug) {
    const needsDisambiguation = group.length > 1;
    const yearCounts = new Map();
    for (const col of group) {
      const y = yearOf(col);
      if (y) yearCounts.set(y, (yearCounts.get(y) || 0) + 1);
    }

    for (const col of group) {
      const oldId = col.data.id || col.dirName;
      const year = yearOf(col);
      let title = col.data.title;
      let titleChanged = false;

      if (needsDisambiguation && year) {
        const sameYearClash = (yearCounts.get(year) || 0) > 1;
        const month = monthNameOf(col);
        const suffix = sameYearClash && month ? `${month} ${year}` : year;
        const already =
          sameYearClash && month
            ? title.toLowerCase().includes(month) && titleHasYear(title, year)
            : titleHasYear(title, year);
        if (!already) {
          title = `${title.replace(/\s+\d{4}\s*$/, '').trim()} ${suffix}`;
          titleChanged = true;
        }
      }

      const newId = slugifyTitle(title);
      plans.push({ oldId, newId, title, titleChanged, col });
    }
  }

  // Abort on duplicate newIds
  const seen = new Map();
  for (const p of plans) {
    if (seen.has(p.newId)) {
      throw new Error(
        `Duplicate newId "${p.newId}" from ${seen.get(p.newId)} and ${p.oldId}`,
      );
    }
    seen.set(p.newId, p.oldId);
  }

  return plans.sort((a, b) => a.oldId.localeCompare(b.oldId));
}

function isGitTracked(relPath) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', relPath], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function renamePath(fromAbs, toAbs, relFromForGit) {
  if (DRY) return;
  if (fs.existsSync(toAbs)) {
    throw new Error(`Target already exists: ${toAbs}`);
  }
  if (relFromForGit && isGitTracked(relFromForGit)) {
    execFileSync('git', ['mv', fromAbs, toAbs], { cwd: ROOT, stdio: 'inherit' });
  } else {
    fs.renameSync(fromAbs, toAbs);
  }
}

function rewriteDecisions(idMap) {
  if (!fs.existsSync(DECISIONS_PATH)) {
    console.log('No decisions file — skip');
    return 0;
  }
  const raw = JSON.parse(fs.readFileSync(DECISIONS_PATH, 'utf8'));
  let changed = 0;
  const next = {};
  for (const [key, value] of Object.entries(raw)) {
    const slash = key.indexOf('/');
    if (slash === -1) {
      next[key] = value;
      continue;
    }
    const oldId = key.slice(0, slash);
    const rest = key.slice(slash + 1);
    const newId = idMap.get(oldId) || oldId;
    const newKey = `${newId}/${rest}`;
    if (newKey !== key) changed++;
    next[newKey] = value;
  }
  if (!DRY) {
    fs.writeFileSync(DECISIONS_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8');
  }
  return changed;
}

function rewriteEnrichTags(idMap) {
  let src = fs.readFileSync(ENRICH_PATH, 'utf8');
  let changed = 0;
  // Longest-first so partial prefix swaps do not corrupt longer keys
  const pairs = [...idMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [oldId, newId] of pairs) {
    if (oldId === newId) continue;
    const needle = `'${oldId}'`;
    const repl = `'${newId}'`;
    if (!src.includes(needle)) continue;
    const count = src.split(needle).length - 1;
    src = src.split(needle).join(repl);
    changed += count;
  }
  if (!DRY && changed) {
    fs.writeFileSync(ENRICH_PATH, src, 'utf8');
  }
  return changed;
}

function rewriteIndex(idMap, titleMap) {
  if (!fs.existsSync(INDEX_PATH)) {
    console.log('No _index.json — skip');
    return 0;
  }
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  let changed = 0;
  for (const row of index) {
    const oldId = row.id;
    const newId = idMap.get(oldId);
    if (newId && newId !== oldId) {
      row.id = newId;
      row.slug = newId;
      changed++;
    }
    if (titleMap.has(oldId)) {
      row.title = titleMap.get(oldId);
    }
  }
  if (!DRY) {
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n', 'utf8');
  }
  return changed;
}

function main() {
  console.log(DRY ? '=== DRY RUN ===' : '=== APPLYING RENAME ===');
  const cols = listCollections();
  console.log(`Collections: ${cols.length}`);

  const plans = planRenames(cols);
  const changing = plans.filter((p) => p.oldId !== p.newId || p.titleChanged);
  console.log(`Rows with title or id change: ${changing.length}`);

  for (const p of changing) {
    const bits = [];
    if (p.titleChanged) bits.push(`title→"${p.title}"`);
    if (p.oldId !== p.newId) bits.push(`${p.oldId} → ${p.newId}`);
    console.log(`  ${bits.join(' | ')}`);
  }

  const idMap = new Map(plans.map((p) => [p.oldId, p.newId]));
  const titleMap = new Map(
    plans.filter((p) => p.titleChanged).map((p) => [p.oldId, p.title]),
  );

  // Two-phase rename to avoid collisions (A→tmp→B not needed if all newIds unique
  // and no newId equals another oldId that still needs renaming).
  const newIds = new Set(plans.map((p) => p.newId));
  const stagingNeeded = plans.some(
    (p) => p.oldId !== p.newId && newIds.has(p.oldId) && idMap.get(p.oldId) !== p.oldId,
  );
  // Staging if some destination equals another's current name
  const destIsOtherOld = plans.some(
    (p) =>
      p.oldId !== p.newId &&
      plans.some((q) => q.oldId === p.newId && q.oldId !== q.newId),
  );

  if (destIsOtherOld || stagingNeeded) {
    console.log('Using staging renames to avoid path collisions');
  }

  // Update JSON first (while folders still at old paths), then rename folders.
  for (const p of plans) {
    if (p.oldId === p.newId && !p.titleChanged) continue;
    const data = { ...p.col.data, id: p.newId, slug: p.newId, title: p.title };
    if (!DRY) {
      fs.writeFileSync(p.col.jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    }
  }

  const toRename = plans.filter((p) => p.oldId !== p.newId);

  if (destIsOtherOld) {
    // Phase 1: old → __tmp__old
    for (const p of toRename) {
      const from = path.join(COLLECTIONS_DIR, p.oldId);
      const tmp = path.join(COLLECTIONS_DIR, `__tmp__${p.oldId}`);
      const rel = path.relative(ROOT, from).replace(/\\/g, '/');
      console.log(`stage ${p.oldId}`);
      if (fs.existsSync(from)) renamePath(from, tmp, rel);
    }
    // Phase 2: __tmp__old → new
    for (const p of toRename) {
      const tmp = path.join(COLLECTIONS_DIR, `__tmp__${p.oldId}`);
      const to = path.join(COLLECTIONS_DIR, p.newId);
      console.log(`commit ${p.oldId} → ${p.newId}`);
      if (fs.existsSync(tmp)) renamePath(tmp, to, null);
    }
  } else {
    for (const p of toRename) {
      const from = path.join(COLLECTIONS_DIR, p.oldId);
      const to = path.join(COLLECTIONS_DIR, p.newId);
      const rel = path.relative(ROOT, from).replace(/\\/g, '/');
      console.log(`mv ${p.oldId} → ${p.newId}`);
      if (fs.existsSync(from)) renamePath(from, to, rel);
    }
  }

  // Thumbs
  if (fs.existsSync(THUMBS_DIR)) {
    for (const p of toRename) {
      const from = path.join(THUMBS_DIR, p.oldId);
      const to = path.join(THUMBS_DIR, p.newId);
      if (!fs.existsSync(from)) continue;
      console.log(`thumbs ${p.oldId} → ${p.newId}`);
      if (!DRY) {
        if (fs.existsSync(to)) {
          console.warn(`  skip thumbs — target exists: ${p.newId}`);
        } else {
          fs.renameSync(from, to);
        }
      }
    }
  }

  const decChanged = rewriteDecisions(idMap);
  console.log(`Decisions keys rewritten: ${decChanged}`);

  const enrichChanged = rewriteEnrichTags(idMap);
  console.log(`enrich-tags.mjs key replacements: ${enrichChanged}`);

  const indexChanged = rewriteIndex(idMap, titleMap);
  console.log(`_index.json rows updated: ${indexChanged}`);

  // Persist mapping for debugging
  const mapPath = path.join(COLLECTIONS_DIR, 'id-rename-map.json');
  const mapObj = Object.fromEntries(plans.map((p) => [p.oldId, p.newId]));
  if (!DRY) {
    fs.writeFileSync(mapPath, JSON.stringify(mapObj, null, 2) + '\n', 'utf8');
  }
  console.log(DRY ? 'Dry-run complete (no writes).' : `Done. Map written to ${mapPath}`);
}

main();
