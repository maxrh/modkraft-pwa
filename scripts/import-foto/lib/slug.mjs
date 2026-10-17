/**
 * Build a URL-safe slug from a Danish title.
 * Keeps meaning by transliterating æøå, then kebab-casing.
 */
export function slugifyTitle(title) {
  if (!title) return 'untitled';
  let s = String(title).normalize('NFC');
  s = s
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/Ø/g, 'oe')
    .replace(/å/g, 'aa')
    .replace(/Å/g, 'aa')
    .replace(/ü/g, 'u')
    .replace(/Ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/Ö/g, 'o')
    .replace(/ä/g, 'a')
    .replace(/Ä/g, 'a')
    .replace(/é/g, 'e')
    .replace(/É/g, 'e')
    .replace(/á/g, 'a')
    .replace(/à/g, 'a')
    .replace(/è/g, 'e')
    .replace(/ê/g, 'e')
    .replace(/ë/g, 'e')
    .replace(/ï/g, 'i')
    .replace(/í/g, 'i')
    .replace(/ñ/g, 'n')
    .replace(/ç/g, 'c');

  s = s
    .toLowerCase()
    .replace(/[''`´"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  return s || 'untitled';
}

/** Format ISO date as YYYY-MM-DD for folder prefix. */
export function datePrefix(iso) {
  if (!iso) return '0000-00-00';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '0000-00-00';
  }
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

export function collectionId(publishedAt, title, nid) {
  const date = datePrefix(publishedAt);
  const slug = slugifyTitle(title);
  return { id: `${date}-${slug}`, slug, date };
}

/** Sanitize an original image filename stem for use in cleaned filenames. */
export function cleanImageStem(originalFilename) {
  let stem = originalFilename.replace(/\.[^.]+$/, '');
  stem = decodeURIComponent(stem);
  stem = stem
    .replace(/æ/gi, 'ae')
    .replace(/ø/gi, 'oe')
    .replace(/å/gi, 'aa')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 80);
  return stem || 'image';
}
