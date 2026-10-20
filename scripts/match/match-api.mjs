/**
 * HTTP handlers for /match-api/* (Vite middleware or standalone server).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { createMatchStore, fotobaseRoot } from './fotobase-match-status.mjs';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.tif', '.tiff', '.png', '.webp']);

/**
 * @param {string} siteRoot absolute path to repo root
 */
export function createMatchApi(siteRoot) {
  const collectionsDir = path.join(siteRoot, 'content', 'photo-collections');
  const store = createMatchStore({
    collectionsDir,
    filenameReportPath: path.join(collectionsDir, 'fotobase-match-report.json'),
    exifReportPath: path.join(collectionsDir, 'fotobase-exif-report.json'),
    deepReportPath: path.join(collectionsDir, 'fotobase-deep-report.json'),
    decisionsPath: path.join(collectionsDir, 'fotobase-match-decisions.json'),
  });

  const cacheDir = path.join(siteRoot, '.match-cache');

  function assertUnderFotobase(filePath) {
    const root = path.resolve(fotobaseRoot());
    const resolved = path.resolve(filePath);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (resolved !== root && !resolved.startsWith(rootWithSep)) {
      throw new Error('Path outside fotobase');
    }
    return resolved;
  }

  function sendJson(res, status, body) {
    const json = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(json);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw ? JSON.parse(raw) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });
  }

  async function handleFotobaseImage(res, filePath) {
    const resolved = assertUnderFotobase(filePath);
    if (!fs.existsSync(resolved)) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const hash = crypto.createHash('sha1').update(resolved).digest('hex');
    const cachePath = path.join(cacheDir, `${hash}.jpg`);

    if (!fs.existsSync(cachePath)) {
      await sharp(resolved)
        .rotate()
        .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(cachePath);
    }

    const buf = fs.readFileSync(cachePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(buf);
  }

  async function readFotobaseMeta(filePath) {
    const resolved = assertUnderFotobase(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error('Not found');
    }
    const meta = await sharp(resolved).metadata();
    return {
      path: resolved,
      width: meta.width ?? null,
      height: meta.height ?? null,
      format: meta.format ?? null,
    };
  }

  function listFotobase(dirParam) {
    const root = path.resolve(fotobaseRoot());
    const dir = dirParam ? assertUnderFotobase(dirParam) : root;
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new Error('Not a directory');
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const dirs = [];
    const images = [];

    for (const entry of entries) {
      if (entry.name === '_NEWSIZES' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        dirs.push({ name: entry.name, path: full });
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!IMAGE_EXT.has(ext)) continue;
        images.push({
          name: entry.name,
          path: full,
          // Relative path only — UI prefixes http://127.0.0.1:4322 (Cloudflare swallows /match-api on :4321).
          previewUrl: `/match-api/fotobase-image?path=${encodeURIComponent(full)}`,
        });
      }
    }

    dirs.sort((a, b) => a.name.localeCompare(b.name));
    images.sort((a, b) => a.name.localeCompare(b.name));

    const rel =
      dir === root ? '' : path.relative(root, dir).split(path.sep).join('/');

    return {
      root,
      dir,
      relative: rel,
      parent: dir === root ? null : path.dirname(dir),
      dirs,
      images,
    };
  }

  /**
   * @returns {Promise<boolean>} true if handled
   */
  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/match-api')) return false;

    try {
      if (url.pathname === '/match-api/status' && req.method === 'GET') {
        const root = fotobaseRoot();
        sendJson(res, 200, {
          ok: true,
          fotobaseRoot: root,
          fotobaseExists: fs.existsSync(root),
        });
        return true;
      }

      if (url.pathname === '/match-api/collections' && req.method === 'GET') {
        sendJson(res, 200, { collections: store.getCollectionSummaries() });
        return true;
      }

      const collMatch = url.pathname.match(/^\/match-api\/collection\/([^/]+)$/);
      if (collMatch && req.method === 'GET') {
        const id = decodeURIComponent(collMatch[1]);
        const detail = store.getCollectionDetail(id);
        if (!detail) {
          sendJson(res, 404, { error: 'Collection not found' });
          return true;
        }
        sendJson(res, 200, detail);
        return true;
      }

      if (url.pathname === '/match-api/fotobase' && req.method === 'GET') {
        const dir = url.searchParams.get('dir') || '';
        sendJson(res, 200, listFotobase(dir || null));
        return true;
      }

      if (url.pathname === '/match-api/fotobase-image' && req.method === 'GET') {
        const filePath = url.searchParams.get('path');
        if (!filePath) {
          sendJson(res, 400, { error: 'path required' });
          return true;
        }
        await handleFotobaseImage(res, filePath);
        return true;
      }

      if (url.pathname === '/match-api/fotobase-meta' && req.method === 'GET') {
        const filePath = url.searchParams.get('path');
        if (!filePath) {
          sendJson(res, 400, { error: 'path required' });
          return true;
        }
        sendJson(res, 200, await readFotobaseMeta(filePath));
        return true;
      }

      if (url.pathname === '/match-api/decision' && req.method === 'POST') {
        const body = await readBody(req);
        if (body.clear) {
          store.clearDecision(body.collectionId, body.imageId);
          sendJson(res, 200, { ok: true, cleared: true });
          return true;
        }
        const entry = store.setDecision({
          collectionId: body.collectionId,
          imageId: body.imageId,
          status: body.status,
          path: body.path,
          paths: body.paths,
        });
        sendJson(res, 200, { ok: true, decision: entry });
        return true;
      }

      sendJson(res, 404, { error: 'Unknown match-api route' });
      return true;
    } catch (err) {
      console.error('[match-api]', err);
      sendJson(res, 500, { error: err.message || String(err) });
      return true;
    }
  }

  return { handle, store };
}
