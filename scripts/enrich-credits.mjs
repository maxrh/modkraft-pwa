#!/usr/bin/env node
/**
 * Fill missing per-image photographer credits from collection body text
 * (manchet / introMarkdown), with a single-photographer backfill fallback.
 *
 * - Parses bylines: Fotos?: / Fotograf: / trailing Foto: / fotoserie af /
 *   billeder af fotograf / Tak til … for udlån
 * - Writes image.credit when empty
 * - Sets photographers[] from body name when empty (except lender-only "udlån")
 * - Backfills from photographers when that array has exactly one name
 * - Syncs content/photo-collections/_index.json photographers
 */

import fs from 'node:fs';
import path from 'node:path';
import { normalizeCredit } from './import-foto/lib/captions.mjs';

const ROOT = process.cwd();
const COLLECTIONS_DIR = path.join(ROOT, 'content', 'photo-collections');
const INDEX_PATH = path.join(COLLECTIONS_DIR, '_index.json');

/**
 * @returns {{ credit: string | null, isLender: boolean }}
 */
function extractBodyCredit(manchet, introMarkdown) {
  // Strip markdown emphasis so trailing "*Fotos: Name*" still parses as a byline.
  const text = [manchet || '', introMarkdown || '']
    .join('\n')
    .replace(/\*+/g, '');

  // Standalone / line-start Fotos?: Name or Fotograf: Name
  const lineMatch = text.match(/(?:^|\n)\s*Fotos?\s*:\s*(.+?)\s*$/im)
    || text.match(/(?:^|\n)\s*Fotograf(?:en)?\s*:\s*(.+?)\s*$/im);
  if (lineMatch) {
    const credit = normalizeCredit(cleanExtractedName(lineMatch[1]));
    if (credit) return { credit, isLender: false };
  }

  // Inline Fotograf: Name.
  const fotografInline = text.match(/Fotograf:\s*([^.]+)\./i);
  if (fotografInline) {
    const credit = normalizeCredit(cleanExtractedName(fotografInline[1]));
    if (credit) return { credit, isLender: false };
  }

  // Trailing / sentence Foto(s): Name. (last sentence or end of body)
  const fotoInline = text.match(/(?:^|[.!?\n])\s*Fotos?\s*:\s*([^.]+?)(?:\.|$)/im);
  if (fotoInline) {
    const credit = normalizeCredit(cleanExtractedName(fotoInline[1]));
    if (credit) return { credit, isLender: false };
  }

  // "fotoserie af Name"
  const seriesOf = text.match(
    /fotoserie af\s+([A-ZÆØÅ][a-zæøå]+(?:\s+[A-ZÆØÅ][a-zæøå.-]+){0,4})/i,
  );
  if (seriesOf) {
    const credit = normalizeCredit(cleanExtractedName(seriesOf[1]));
    if (credit) return { credit, isLender: false };
  }

  // "billeder af fotograf Name"
  const billederAf = text.match(
    /billeder af fotograf\s+([A-ZÆØÅ][a-zæøå]+(?:\s+[A-ZÆØÅ][a-zæøå.-]+){0,4})/i,
  );
  if (billederAf) {
    const credit = normalizeCredit(cleanExtractedName(billederAf[1]));
    if (credit) return { credit, isLender: false };
  }

  // Lender credit — image credit only, not photographers[]
  const lender = text.match(/Tak til\s+(.+?)\s+for udlån/i);
  if (lender) {
    const credit = normalizeCredit(cleanExtractedName(lender[1]));
    if (credit) return { credit, isLender: true };
  }

  return { credit: null, isLender: false };
}

function cleanExtractedName(raw) {
  return String(raw || '')
    .replace(/\*+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[»«""]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isVagueCredit(name) {
  return /modkrafts?\s+fotograf/i.test(name || '');
}

function main() {
  const dirs = fs
    .readdirSync(COLLECTIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort();

  let imagesFilledFromBody = 0;
  let imagesFilledFromPhotographers = 0;
  let photographersUpdated = 0;
  const remainingMissing = [];
  const filledCollections = [];
  const updatedById = new Map();

  for (const dir of dirs) {
    const filePath = path.join(COLLECTIONS_DIR, dir, 'collection.json');
    if (!fs.existsSync(filePath)) continue;

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const photographers = Array.isArray(data.photographers) ? data.photographers : [];
    const { credit: bodyCredit, isLender } = extractBodyCredit(
      data.manchet,
      data.introMarkdown,
    );

    const usableBodyCredit =
      bodyCredit && !isVagueCredit(bodyCredit) ? bodyCredit : null;

    let changed = false;
    let collectionFilled = 0;

    // Populate empty photographers from a real photographer body byline
    if (usableBodyCredit && !isLender && photographers.length === 0) {
      data.photographers = [usableBodyCredit];
      photographersUpdated++;
      changed = true;
    }

    const nextPhotographers = Array.isArray(data.photographers)
      ? data.photographers
      : [];
    const singlePhotographer =
      nextPhotographers.length === 1 ? nextPhotographers[0] : null;

    for (const img of data.images || []) {
      if ((img.credit || '').trim()) continue;

      if (usableBodyCredit) {
        img.credit = usableBodyCredit;
        imagesFilledFromBody++;
        collectionFilled++;
        changed = true;
        continue;
      }

      if (singlePhotographer) {
        img.credit = singlePhotographer;
        imagesFilledFromPhotographers++;
        collectionFilled++;
        changed = true;
        continue;
      }

      remainingMissing.push({
        collectionId: data.id,
        imageId: img.id,
        photographers: nextPhotographers.length,
      });
    }

    if (changed) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
      filledCollections.push({
        id: data.id,
        filled: collectionFilled,
        credit: usableBodyCredit || singlePhotographer,
        source: usableBodyCredit
          ? isLender
            ? 'body-lender'
            : 'body'
          : 'photographers',
      });
    }

    updatedById.set(data.id, data);
  }

  // Sync photographers on _index.json
  if (fs.existsSync(INDEX_PATH)) {
    const indexList = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    for (const entry of indexList) {
      const updated = updatedById.get(entry.id);
      if (updated) {
        entry.photographers = updated.photographers;
      }
    }
    fs.writeFileSync(INDEX_PATH, JSON.stringify(indexList, null, 2) + '\n', 'utf8');
  }

  const remainingByCollection = new Map();
  for (const row of remainingMissing) {
    remainingByCollection.set(
      row.collectionId,
      (remainingByCollection.get(row.collectionId) || 0) + 1,
    );
  }

  console.log('=== CREDIT ENRICHMENT SUMMARY ===');
  console.log(`Collections scanned:              ${dirs.length}`);
  console.log(`Images filled from body:          ${imagesFilledFromBody}`);
  console.log(`Images filled from photographers: ${imagesFilledFromPhotographers}`);
  console.log(`photographers[] arrays updated:   ${photographersUpdated}`);
  console.log(`Images still missing credit:      ${remainingMissing.length}`);

  if (filledCollections.length) {
    console.log('\n--- FILLED ---');
    for (const row of filledCollections) {
      console.log(
        `  ${row.id}: ${row.filled} image(s) → ${row.credit} (${row.source})`,
      );
    }
  }

  if (remainingByCollection.size) {
    console.log('\n--- STILL MISSING ---');
    for (const [id, count] of [...remainingByCollection.entries()].sort()) {
      console.log(`  ${id}: ${count}`);
    }
  }
}

main();
