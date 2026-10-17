#!/usr/bin/env node
/**
 * Re-validate an already-imported photo-collections folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', '..', 'content', 'photo-collections');

function main() {
  const reportPath = path.join(OUT, 'validation-report.json');
  if (!fs.existsSync(reportPath)) {
    console.error('No validation-report.json — run `npm run import` first.');
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const index = JSON.parse(fs.readFileSync(path.join(OUT, '_index.json'), 'utf8'));
  const series = JSON.parse(fs.readFileSync(path.join(OUT, '_series.json'), 'utf8'));

  let ok = true;
  const checks = [];

  function check(name, pass, detail) {
    checks.push({ name, pass, detail });
    if (!pass) ok = false;
    console.log(pass ? '✓' : '✗', name, detail || '');
  }

  check('99 collections', index.length === 99, `got ${index.length}`);
  check(
    '92 fotoserie',
    report.totals.fotoserie === 92,
    `got ${report.totals.fotoserie}`
  );
  check(
    '7 fotoblog',
    report.totals.fotoblog === 7,
    `got ${report.totals.fotoblog}`
  );
  check('1 series entry', series.length === 1, `got ${series.length}`);
  check('0 missing images', report.totals.missingImages === 0, `got ${report.totals.missingImages}`);

  const sc = report.spotChecks || {};
  if (sc['til-te-med-oproret'] && !sc['til-te-med-oproret'].error) {
    const t = sc['til-te-med-oproret'];
    check('til-te imageCount=20', t.imageCount === 20, `got ${t.imageCount}`);
    check('til-te captioned=17', t.captioned === 17, `got ${t.captioned}`);
  } else {
    check('til-te spot-check', false, 'missing');
  }

  if (sc['roskilde-vibrerer'] && !sc['roskilde-vibrerer'].error) {
    const r = sc['roskilde-vibrerer'];
    check('roskilde imageCount=15', r.imageCount === 15, `got ${r.imageCount}`);
  } else {
    check('roskilde spot-check', false, 'missing');
  }

  if (sc['1-maj-2013'] && !sc['1-maj-2013'].error) {
    const m = sc['1-maj-2013'];
    check('1-maj imageCount=31', m.imageCount === 31, `got ${m.imageCount}`);
    const photos = new Set(m.photographers || []);
    check(
      '1-maj multi-photographers',
      photos.has('Mark Knudsen') &&
        photos.has('Mette Kramer Kristensen') &&
        photos.has('Anders Pedersen'),
      [...photos].join(', ')
    );
  }

  // Verify every collection folder has matching image files
  let orphanMismatch = 0;
  for (const entry of index) {
    const dir = path.join(OUT, entry.id);
    const col = JSON.parse(fs.readFileSync(path.join(dir, 'collection.json'), 'utf8'));
    for (const img of col.images) {
      if (!fs.existsSync(path.join(dir, 'images', img.filename))) {
        orphanMismatch++;
        console.warn('Missing file:', entry.id, img.filename);
      }
    }
  }
  check('all referenced images exist on disk', orphanMismatch === 0, `missing ${orphanMismatch}`);

  console.log(ok ? '\nAll checks passed.' : '\nSome checks failed.');
  process.exit(ok ? 0 : 1);
}

main();
