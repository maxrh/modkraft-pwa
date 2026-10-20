/**
 * Shared EXIF helpers for match surveys (no pixel decode).
 */

import path from 'node:path';
import sharp from 'sharp';
import exifReader from 'exif-reader';

export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.tif', '.tiff', '.png', '.webp']);

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

export function normalizeText(value) {
  return String(value || '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function formatDateTimeOriginal(value) {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
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

/** Calendar day YYYY-MM-DD from DateTimeOriginal string. */
export function calendarDay(dto) {
  if (!dto) return null;
  const m = String(dto).match(/^(\d{4}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function dayToNumber(day) {
  if (!day) return null;
  const m = String(day).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function roundNum(value, digits = 6) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(Math.round(n * 10 ** digits) / 10 ** digits);
}

export function exposureKey(meta) {
  if (!meta) return '';
  return [
    roundNum(meta.exposureTime),
    roundNum(meta.fNumber),
    roundNum(meta.iso, 0),
    roundNum(meta.focalLength),
  ].join('|');
}

export function joinKey(meta) {
  if (!meta?.dateTimeOriginal) return null;
  const make = normalizeText(meta.make);
  const model = normalizeText(meta.model);
  if (!make && !model) return null;
  return `${meta.dateTimeOriginal}|${make}|${model}`;
}

export async function readExifMeta(filePath) {
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

/** Trailing photographer code on fotobase filenames. */
const PHOTOGRAPHER_CODES = ['majag', 'mkk', 'lkm', 'rode', 'macak', 'mk', 'ap', 'az', 'bb', 'mm', 'gm', 'al'];

export const CREDIT_BY_CODE = {
  mk: 'mark knudsen',
  mkk: 'mette kramer kristensen',
  ap: 'anders pedersen',
  bb: 'brian berg',
  lkm: 'lars kristian møller',
  az: 'anders zøllner',
  al: 'anders lund',
};

export function trailingCode(name) {
  const s = path.basename(String(name)).normalize('NFC').toLowerCase().replace(/\.[^.]+$/, '');
  for (const code of PHOTOGRAPHER_CODES) {
    if (new RegExp(`(?:^|[^a-z0-9])${code}$`).test(s)) return code;
  }
  return '';
}

export function creditToCode(credit) {
  const wanted = normalizeText(credit);
  if (!wanted) return '';
  for (const [code, name] of Object.entries(CREDIT_BY_CODE)) {
    if (wanted === name || wanted.includes(name)) return code;
  }
  // loose: mette / mark / anders pedersen
  if (wanted.includes('mette') && wanted.includes('kramer')) return 'mkk';
  if (wanted.includes('mark') && wanted.includes('knudsen')) return 'mk';
  if (wanted.includes('anders') && wanted.includes('pedersen')) return 'ap';
  if (wanted.includes('brian') && wanted.includes('berg')) return 'bb';
  return '';
}

export function folderDatePrefix(dirPath) {
  const name = path.basename(dirPath);
  const m = name.match(/^(\d{8})/);
  return m ? m[1] : null;
}

export function folderPrefixToDay(prefix) {
  if (!prefix || prefix.length !== 8) return null;
  return `${prefix.slice(0, 4)}-${prefix.slice(4, 6)}-${prefix.slice(6, 8)}`;
}
