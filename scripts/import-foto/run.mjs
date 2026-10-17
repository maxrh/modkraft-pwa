#!/usr/bin/env node
/**
 * Main importer: HTTrack Drupal foto archive → cleaned photo-collections.
 *
 * Usage:
 *   node run.mjs
 *   node run.mjs --source "C:\Users\max\Desktop\modkraft-foto\modkraft-foto\temp.modkraft.dk"
 *   node run.mjs --out "C:\Users\max\Documents\GitHub\modkraft-pwa\content\photo-collections"
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { discoverNodeFiles, parseNodeFile, parseSyrienHub } from './lib/parse-node.mjs';
import { collectionId } from './lib/slug.mjs';
import { buildCleanFilename, copyImage, resolveImagePath } from './lib/images.mjs';
import { normalizeCredit } from './lib/captions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PWA_ROOT = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const args = {
    source: path.resolve(
      'C:\\Users\\max\\Desktop\\modkraft-foto\\modkraft-foto\\temp.modkraft.dk'
    ),
    out: path.join(PWA_ROOT, 'content', 'photo-collections'),
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--source' && argv[i + 1]) args.source = path.resolve(argv[++i]);
    else if (argv[i] === '--out' && argv[i + 1]) args.out = path.resolve(argv[++i]);
  }
  return args;
}

function md5File(filePath) {
  const hash = crypto.createHash('md5');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function ensureUniqueId(baseId, used) {
  if (!used.has(baseId)) {
    used.add(baseId);
    return baseId;
  }
  let n = 2;
  while (used.has(`${baseId}-${n}`)) n++;
  const id = `${baseId}-${n}`;
  used.add(id);
  return id;
}

async function main() {
  const { source: siteRoot, out: outRoot } = parseArgs(process.argv);
  console.log('Source:', siteRoot);
  console.log('Output:', outRoot);

  if (!fs.existsSync(siteRoot)) {
    console.error('Source site root not found:', siteRoot);
    process.exit(1);
  }

  fs.mkdirSync(outRoot, { recursive: true });

  const allHtml = discoverNodeFiles(siteRoot);
  console.log(`Scanning ${allHtml.length} HTML files...`);

  const drafts = [];
  for (const file of allHtml) {
    // Skip listing pages and hub
    const base = path.basename(file).toLowerCase();
    if (
      base === 'syrien.html' ||
      base === 'foto.html' ||
      base === 'fotosalg.html' ||
      base.startsWith('foto') && /^foto[0-9a-f]+\.html$/i.test(base)
    ) {
      continue;
    }

    let parsed;
    try {
      parsed = parseNodeFile(file, siteRoot);
    } catch (err) {
      console.warn('Parse error:', file, err.message);
      continue;
    }
    if (!parsed) continue;
    if (!parsed.images?.length && parsed.sourceType === 'fotoserie') {
      // Still keep empty? Skip empty galleries
      console.warn('No images:', file);
    }
    drafts.push({ ...parsed, htmlFile: file });
  }

  console.log(`Parsed ${drafts.length} collections`);

  // Assign IDs
  const usedIds = new Set();
  const collections = [];
  const missingImages = [];
  const hashMap = new Map(); // md5 -> [{collectionId, filename}]

  for (const draft of drafts) {
    const { id: baseId, slug } = collectionId(draft.publishedAt, draft.title, draft.sourceNid);
    let id = baseId;
    if (usedIds.has(id)) {
      id = ensureUniqueId(`${baseId}-${draft.sourceNid || 'x'}`, usedIds);
    } else {
      usedIds.add(id);
    }

    const destDir = path.join(outRoot, id);
    const imagesDir = path.join(destDir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });

    const photoItems = [];
    const photographers = new Set();

    for (const img of draft.images) {
      const resolved = resolveImagePath(img.src, draft.htmlFile, siteRoot);
      if (!resolved.resolved) {
        missingImages.push({
          collectionId: id,
          sortOrder: img.sortOrder,
          src: img.src,
          reason: resolved.reason,
          attempted: resolved.attempted,
        });
        continue;
      }

      const filename = buildCleanFilename(img.sortOrder, resolved.resolved);
      const destPath = path.join(imagesDir, filename);
      copyImage(resolved.resolved, destPath);

      const hash = md5File(destPath);
      if (!hashMap.has(hash)) hashMap.set(hash, []);
      hashMap.get(hash).push({ collectionId: id, filename });

      const credit = normalizeCredit(img.credit);
      if (credit) photographers.add(credit);

      const itemId = String(img.sortOrder).padStart(2, '0');
      photoItems.push({
        id: itemId,
        sortOrder: img.sortOrder,
        filename,
        originalFilename: path.basename(resolved.resolved),
        width: img.width,
        height: img.height,
        credit,
        caption: img.caption,
        captionSource: img.captionSource,
        sourceResolve: resolved.reason,
      });
    }

    const collection = {
      id,
      sourceNid: draft.sourceNid,
      slug,
      title: draft.title,
      publishedAt: draft.publishedAt,
      modifiedAt: draft.modifiedAt,
      authors: draft.authors,
      photographers: [...photographers],
      prefix: draft.prefix,
      series: draft.series,
      manchet: draft.manchet,
      introMarkdown: draft.introMarkdown,
      tags: draft.tags,
      genre: draft.genre,
      coverImage: photoItems[0]?.id ?? null,
      images: photoItems,
      sourceUrl: draft.sourcePath,
      sourceType: draft.sourceType,
    };

    fs.writeFileSync(
      path.join(destDir, 'collection.json'),
      JSON.stringify(collection, null, 2),
      'utf8'
    );
    fs.writeFileSync(path.join(destDir, 'intro.md'), draft.introMarkdown || '', 'utf8');

    collections.push(collection);
  }

  // Sort by publishedAt
  collections.sort((a, b) => String(a.publishedAt || '').localeCompare(String(b.publishedAt || '')));

  // Series metadata
  const syrienHub = path.join(siteRoot, 'foto', 'fotoblog', 'syrien.html');
  const seriesEntry = parseSyrienHub(syrienHub);
  const seriesList = seriesEntry ? [seriesEntry] : [];
  fs.writeFileSync(path.join(outRoot, '_series.json'), JSON.stringify(seriesList, null, 2), 'utf8');

  // Index
  const index = collections.map((c) => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
    publishedAt: c.publishedAt,
    authors: c.authors,
    photographers: c.photographers,
    prefix: c.prefix,
    series: c.series,
    tags: c.tags,
    genre: c.genre,
    sourceType: c.sourceType,
    imageCount: c.images.length,
    coverImage: c.coverImage
      ? `images/${c.images.find((i) => i.id === c.coverImage)?.filename || ''}`
      : null,
    manchet: c.manchet,
  }));
  fs.writeFileSync(path.join(outRoot, '_index.json'), JSON.stringify(index, null, 2), 'utf8');

  // Validation report
  const dupes = [...hashMap.entries()]
    .filter(([, refs]) => refs.length > 1)
    .map(([hash, refs]) => ({ hash, refs }));

  const spotChecks = buildSpotChecks(collections);

  const report = {
    generatedAt: new Date().toISOString(),
    source: siteRoot,
    totals: {
      collections: collections.length,
      fotoserie: collections.filter((c) => c.sourceType === 'fotoserie').length,
      fotoblog: collections.filter((c) => c.sourceType === 'fotoblog').length,
      imagesCopied: collections.reduce((n, c) => n + c.images.length, 0),
      missingImages: missingImages.length,
      series: seriesList.length,
      md5DuplicateGroups: dupes.length,
    },
    missingImages,
    md5Duplicates: dupes,
    spotChecks,
    collections: collections.map((c) => ({
      id: c.id,
      sourceNid: c.sourceNid,
      sourceType: c.sourceType,
      title: c.title,
      imageCount: c.images.length,
      captioned: c.images.filter((i) => i.caption).length,
      credited: c.images.filter((i) => i.credit).length,
    })),
  };

  const reportPath = path.join(outRoot, 'validation-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n=== Import complete ===');
  console.log(`Collections: ${report.totals.collections} (${report.totals.fotoserie} fotoserie + ${report.totals.fotoblog} fotoblog)`);
  console.log(`Images copied: ${report.totals.imagesCopied}`);
  console.log(`Missing images: ${report.totals.missingImages}`);
  console.log(`MD5 duplicate groups: ${report.totals.md5DuplicateGroups}`);
  console.log(`Series: ${report.totals.series}`);
  console.log('Report:', reportPath);

  // Print spot checks
  for (const [key, check] of Object.entries(spotChecks)) {
    console.log(`\nSpot-check ${key}:`, JSON.stringify(check, null, 2));
  }

  if (missingImages.length) {
    console.warn('\nMissing images (first 20):');
    for (const m of missingImages.slice(0, 20)) {
      console.warn(' -', m.collectionId, m.src, m.reason);
    }
  }

  // Soft fail if counts are way off
  if (collections.length < 90) {
    console.error('ERROR: expected ~99 collections, got', collections.length);
    process.exit(1);
  }
}

function buildSpotChecks(collections) {
  const find = (pred) => collections.find(pred);

  const tilTe = find(
    (c) => c.sourceNid === 20461 || /til-te-med-oproret/.test(c.id) || /Til Te med Oprøret/.test(c.title)
  );
  const istanbul = find(
    (c) => c.sourceNid === 20358 || /istanbul/.test(c.id)
  );
  const roskilde = find(
    (c) => c.sourceNid === 26656 || /roskilde-vibrerer/.test(c.id)
  );
  const maj = find(
    (c) => c.sourceNid === 21822 || /1-maj-2013/.test(c.id)
  );

  return {
    'til-te-med-oproret': tilTe
      ? {
          id: tilTe.id,
          imageCount: tilTe.images.length,
          captioned: tilTe.images.filter((i) => i.caption).length,
          uncaptioned: tilTe.images.filter((i) => !i.caption).map((i) => i.id),
          credits: [...new Set(tilTe.images.map((i) => i.credit))],
          expected: { imageCount: 20, captioned: 17, uncaptioned: ['07', '17', '19'] },
        }
      : { error: 'not found' },
    istanbul: istanbul
      ? {
          id: istanbul.id,
          imageCount: istanbul.images.length,
          captioned: istanbul.images.filter((i) => i.caption).length,
          expected: { imageCount: 17, captioned: 0 },
        }
      : { error: 'not found' },
    'roskilde-vibrerer': roskilde
      ? {
          id: roskilde.id,
          imageCount: roskilde.images.length,
          captioned: roskilde.images.filter((i) => i.caption).length,
          credits: [...new Set(roskilde.images.map((i) => i.credit))],
          sampleCaptions: roskilde.images.filter((i) => i.caption).slice(0, 5).map((i) => ({
            id: i.id,
            caption: i.caption,
            credit: i.credit,
          })),
          resolveReasons: [...new Set(roskilde.images.map((i) => i.sourceResolve))],
          expected: { imageCount: 15 },
        }
      : { error: 'not found' },
    '1-maj-2013': maj
      ? {
          id: maj.id,
          imageCount: maj.images.length,
          photographers: maj.photographers,
          expected: {
            imageCount: 31,
            photographers: ['Mark Knudsen', 'Mette Kramer Kristensen', 'Anders Pedersen'],
          },
        }
      : { error: 'not found' },
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
