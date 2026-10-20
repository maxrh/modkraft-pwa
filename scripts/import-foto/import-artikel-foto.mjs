#!/usr/bin/env node
/**
 * Incremental import: Foto-redaktion artikels with field_fotoserie galleries
 * from a secondary HTTrack mirror (modkraft-foto2) into existing photo-collections.
 *
 * Does not wipe existing folders or _series.json. Merges into _index.json.
 *
 * Usage:
 *   node import-artikel-foto.mjs
 *   node import-artikel-foto.mjs --source "C:\...\modkraft-foto2\temp.modkraft.dk"
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseNodeFile } from './lib/parse-node.mjs';
import { collectionId } from './lib/slug.mjs';
import { buildCleanFilename, copyImage, resolveImagePath } from './lib/images.mjs';
import { normalizeCredit } from './lib/captions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PWA_ROOT = path.resolve(__dirname, '..', '..');
const require = createRequire(path.join(PWA_ROOT, 'package.json'));
const sharp = require('sharp');

async function probeSize(filePath) {
  try {
    const meta = await sharp(filePath).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

function parseArgs(argv) {
  const args = {
    source: path.resolve(
      'C:\\Users\\max\\Desktop\\modkraft-foto\\modkraft-foto2\\temp.modkraft.dk',
    ),
    out: path.join(PWA_ROOT, 'content', 'photo-collections'),
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--source' && argv[i + 1]) args.source = path.resolve(argv[++i]);
    else if (argv[i] === '--out' && argv[i + 1]) args.out = path.resolve(argv[++i]);
  }
  return args;
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

function discoverArtikelFiles(siteRoot) {
  const artikelDir = path.join(siteRoot, 'artikel');
  const results = [];
  if (!fs.existsSync(artikelDir)) return results;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith('.html') && !ent.name.endsWith('.html.z')) {
        results.push(full);
      }
    }
  }
  walk(artikelDir);
  return results;
}

function loadExisting(outRoot) {
  const byNid = new Set();
  const usedIds = new Set();
  const indexPath = path.join(outRoot, '_index.json');
  let index = [];
  if (fs.existsSync(indexPath)) {
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch {
      index = [];
    }
  }

  for (const d of fs.readdirSync(outRoot, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('_')) continue;
    usedIds.add(d.name);
    const metaPath = path.join(outRoot, d.name, 'collection.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.sourceNid != null) byNid.add(Number(meta.sourceNid));
      if (meta.id) usedIds.add(meta.id);
    } catch {
      // skip
    }
  }

  return { byNid, usedIds, index };
}

function indexEntry(c) {
  return {
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
  };
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

  const { byNid, usedIds, index: existingIndex } = loadExisting(outRoot);
  const files = discoverArtikelFiles(siteRoot);
  console.log(`Scanning ${files.length} artikel HTML files...`);

  const imported = [];
  const skipped = { notArtikelFoto: 0, noImages: 0, existingNid: 0 };
  const missingImages = [];

  for (const file of files) {
    let parsed;
    try {
      parsed = parseNodeFile(file, siteRoot);
    } catch (err) {
      console.warn('Parse error:', file, err.message);
      continue;
    }
    if (!parsed || parsed.sourceType !== 'artikel-foto') {
      skipped.notArtikelFoto++;
      continue;
    }
    if (!parsed.images?.length) {
      skipped.noImages++;
      continue;
    }
    if (parsed.sourceNid != null && byNid.has(Number(parsed.sourceNid))) {
      skipped.existingNid++;
      continue;
    }

    const { id: baseId, slug } = collectionId(
      parsed.publishedAt,
      parsed.title,
      parsed.sourceNid,
    );
    let id = baseId;
    if (usedIds.has(id)) {
      id = ensureUniqueId(`${baseId}-${parsed.sourceNid || 'x'}`, usedIds);
    } else {
      usedIds.add(id);
    }

    const destDir = path.join(outRoot, id);
    const imagesDir = path.join(destDir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });

    const photoItems = [];
    const photographers = new Set();

    for (const img of parsed.images) {
      const resolved = resolveImagePath(img.src, file, siteRoot);
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

      // Prefer real file pixels — HTML attrs are often blogbar thumb sizes (140px).
      const probed = await probeSize(destPath);
      const credit = normalizeCredit(img.credit);
      if (credit) photographers.add(credit);

      const itemId = String(img.sortOrder).padStart(2, '0');
      photoItems.push({
        id: itemId,
        sortOrder: img.sortOrder,
        filename,
        originalFilename: path.basename(resolved.resolved),
        width: probed.width ?? img.width,
        height: probed.height ?? img.height,
        credit,
        caption: img.caption,
        captionSource: img.captionSource,
        sourceResolve: resolved.reason,
      });
    }

    if (!photoItems.length) {
      fs.rmSync(destDir, { recursive: true, force: true });
      skipped.noImages++;
      continue;
    }

    const collection = {
      id,
      sourceNid: parsed.sourceNid,
      slug,
      title: parsed.title,
      publishedAt: parsed.publishedAt,
      modifiedAt: parsed.modifiedAt,
      authors: parsed.authors,
      photographers: [...photographers],
      prefix: parsed.prefix,
      series: parsed.series,
      manchet: parsed.manchet,
      introMarkdown: parsed.introMarkdown,
      tags: parsed.tags,
      genre: parsed.genre,
      coverImage: photoItems[0]?.id ?? null,
      images: photoItems,
      sourceUrl: parsed.sourcePath,
      sourceType: 'artikel-foto',
    };

    fs.writeFileSync(
      path.join(destDir, 'collection.json'),
      JSON.stringify(collection, null, 2) + '\n',
      'utf8',
    );
    fs.writeFileSync(path.join(destDir, 'intro.md'), parsed.introMarkdown || '', 'utf8');

    if (parsed.sourceNid != null) byNid.add(Number(parsed.sourceNid));
    imported.push(collection);
    console.log(`+ ${id}  (${photoItems.length} images)  ${collection.title}`);
  }

  // Merge index
  const byId = new Map(existingIndex.map((e) => [e.id, e]));
  for (const c of imported) byId.set(c.id, indexEntry(c));
  const mergedIndex = [...byId.values()].sort((a, b) =>
    String(a.publishedAt || '').localeCompare(String(b.publishedAt || '')),
  );
  fs.writeFileSync(
    path.join(outRoot, '_index.json'),
    JSON.stringify(mergedIndex, null, 2) + '\n',
    'utf8',
  );

  const report = {
    generatedAt: new Date().toISOString(),
    source: siteRoot,
    imported: imported.length,
    skipped,
    imagesCopied: imported.reduce((n, c) => n + c.images.length, 0),
    missingImages: missingImages.length,
    missingImageDetails: missingImages.slice(0, 50),
    collections: imported.map((c) => ({
      id: c.id,
      sourceNid: c.sourceNid,
      title: c.title,
      imageCount: c.images.length,
      credited: c.images.filter((i) => i.credit).length,
    })),
  };
  const reportPath = path.join(outRoot, 'validation-artikel-foto-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log('\n=== Artikel-foto import complete ===');
  console.log(`Imported: ${report.imported}`);
  console.log(`Images copied: ${report.imagesCopied}`);
  console.log(`Missing images: ${report.missingImages}`);
  console.log(`Skipped:`, skipped);
  console.log(`Index entries: ${mergedIndex.length}`);
  console.log('Report:', reportPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
