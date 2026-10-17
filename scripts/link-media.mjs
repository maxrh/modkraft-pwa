import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'content', 'photo-collections');
const publicMedia = path.join(root, 'public', 'media');
const linkPath = path.join(publicMedia, 'photo-collections');

if (!fs.existsSync(target)) {
  console.warn('[link-media] content/photo-collections not found — skipping');
  process.exit(0);
}

fs.mkdirSync(publicMedia, { recursive: true });

function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

if (fs.existsSync(linkPath) || isLink(linkPath)) {
  const stat = fs.lstatSync(linkPath);
  if (stat.isSymbolicLink() || (process.platform === 'win32' && stat.isDirectory())) {
    // Already linked (junction looks like a directory on Windows)
    try {
      const resolved = fs.realpathSync(linkPath);
      if (resolved === fs.realpathSync(target)) {
        console.log('[link-media] public/media/photo-collections already linked');
        process.exit(0);
      }
    } catch {
      // fall through and recreate
    }
  }
  fs.rmSync(linkPath, { recursive: true, force: true });
}

const type = process.platform === 'win32' ? 'junction' : 'dir';
fs.symlinkSync(target, linkPath, type);
console.log(`[link-media] linked public/media/photo-collections -> content/photo-collections (${type})`);
