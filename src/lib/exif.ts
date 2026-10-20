import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import exifReader from 'exif-reader';

/**
 * Read camera model from a site archive JPEG (build-time only).
 * Returns a short display string like "Canon EOS 5D Mark II", or null.
 */
export async function readCameraModel(
  collectionId: string,
  filename: string,
): Promise<string | null> {
  const filePath = path.join(
    process.cwd(),
    'content',
    'photo-collections',
    collectionId,
    'images',
    filename,
  );
  if (!fs.existsSync(filePath)) return null;

  try {
    const meta = await sharp(filePath).metadata();
    if (!meta.exif) return null;
    const parsed = exifReader(meta.exif);
    const image = (parsed.Image || {}) as Record<string, unknown>;
    const make = cleanExifString(image.Make);
    const model = cleanExifString(image.Model);
    if (!model && !make) return null;
    if (model && make && !model.toLowerCase().includes(make.toLowerCase().split(/\s+/)[0])) {
      return `${make} ${model}`;
    }
    return model || make;
  } catch {
    return null;
  }
}

function cleanExifString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).replace(/\0/g, '').trim();
  return s || null;
}
