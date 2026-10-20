import fs from 'node:fs';
import path from 'node:path';
import { cleanImageStem } from './slug.mjs';

/**
 * Resolve an img src from HTTrack HTML to an absolute file path on disk.
 *
 * Prefers sites/default/files/<name>.
 * Falls back to styles/large/public/<name> when that is what the HTML points to
 * and no root original exists (e.g. Roskilde Vibrerer).
 */
export function resolveImagePath(src, htmlFilePath, siteRoot) {
  if (!src) return { resolved: null, reason: 'empty-src' };

  // Strip query string (?itok=...)
  let clean = src.split('?')[0];
  // Decode %20 etc.
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // keep as-is
  }

  // Absolute http(s) URLs pointing at temp.modkraft.dk files
  const absMatch = clean.match(
    /^https?:\/\/(?:temp\.)?modkraft\.dk\/(sites\/default\/files\/.+)$/i
  );
  if (absMatch) {
    const candidate = path.join(siteRoot, absMatch[1].replace(/\//g, path.sep));
    if (fs.existsSync(candidate)) {
      return { resolved: candidate, reason: 'absolute-url' };
    }
  }

  // Relative path from the HTML file
  const htmlDir = path.dirname(htmlFilePath);
  let relativeCandidate = path.normalize(path.join(htmlDir, clean.replace(/\//g, path.sep)));

  // If path goes through styles/<preset>/public/, try root files first
  const stylesMatch = relativeCandidate.match(
    /[\\/]sites[\\/]default[\\/]files[\\/]styles[\\/]([^\\/]+)[\\/]public[\\/](.+)$/i
  );

  if (stylesMatch) {
    const styleName = stylesMatch[1].toLowerCase();
    const fileName = stylesMatch[2];
    const rootOriginal = path.join(siteRoot, 'sites', 'default', 'files', fileName);

    // Prefer root original when available (exact style derivative name)
    if (fs.existsSync(rootOriginal)) {
      return { resolved: rootOriginal, reason: 'root-from-style' };
    }

    // Style filenames often append a short hex token before the extension
    // e.g. _MG_552651d6.jpg → _MG_5526.jpg. Try fixed lengths (greedy {4,}
    // would eat digits that belong to the camera counter).
    for (let len = 4; len <= 8; len++) {
      const re = new RegExp(`([a-f0-9]{${len}})(\\.[^.]+)$`, 'i');
      const stripped = fileName.replace(re, '$2');
      if (stripped === fileName) continue;
      const alt = path.join(siteRoot, 'sites', 'default', 'files', stripped);
      if (fs.existsSync(alt)) {
        return { resolved: alt, reason: 'root-stripped-hash' };
      }
    }

    // Prefer larger style presets over blogbar/thumbnail derivatives when present
    const preferredStyles = ['large', 'span-8', 'blogbar_span8', styleName];
    for (const pref of preferredStyles) {
      const candidate = path.join(
        siteRoot,
        'sites',
        'default',
        'files',
        'styles',
        pref,
        'public',
        fileName,
      );
      if (fs.existsSync(candidate)) {
        return {
          resolved: candidate,
          reason:
            pref === 'large'
              ? 'style-large-fallback'
              : pref === 'span-8'
                ? 'style-span8-fallback'
                : `style-${pref}-fallback`,
        };
      }
    }

    if (fs.existsSync(relativeCandidate)) {
      return { resolved: relativeCandidate, reason: `style-${styleName}-fallback` };
    }

    return { resolved: null, reason: 'style-missing', attempted: relativeCandidate };
  }

  if (fs.existsSync(relativeCandidate)) {
    return { resolved: relativeCandidate, reason: 'relative' };
  }

  // Try joining against siteRoot if src contains sites/default/files
  const filesIdx = clean.toLowerCase().indexOf('sites/default/files/');
  if (filesIdx >= 0) {
    const rest = clean.slice(filesIdx);
    const candidate = path.join(siteRoot, rest.replace(/\//g, path.sep));
    if (fs.existsSync(candidate)) {
      return { resolved: candidate, reason: 'site-root-join' };
    }
  }

  // Basename lookup in files root (last resort)
  const base = path.basename(clean);
  const basenameCandidate = path.join(siteRoot, 'sites', 'default', 'files', base);
  if (fs.existsSync(basenameCandidate)) {
    return { resolved: basenameCandidate, reason: 'basename' };
  }

  return { resolved: null, reason: 'not-found', attempted: relativeCandidate };
}

export function buildCleanFilename(sortOrder, originalPath) {
  const base = path.basename(originalPath);
  const ext = path.extname(base).toLowerCase() || '.jpg';
  const stem = cleanImageStem(base);
  const nn = String(sortOrder).padStart(2, '0');
  return `${nn}-${stem}${ext}`;
}

export function copyImage(srcPath, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
}
