/**
 * Astro integration: starts match API on 127.0.0.1:4322 during `astro dev`.
 * Removable with the rest of scripts/match/.
 */

import http from 'node:http';
import { createMatchApi } from './match-api.mjs';

const MATCH_PORT = Number(process.env.MATCH_API_PORT || 4322);

/**
 * @param {string} siteRoot
 * @returns {import('astro').AstroIntegration}
 */
export function matchWorkbenchIntegration(siteRoot) {
  /** @type {import('node:http').Server | null} */
  let server = null;

  function start() {
    if (server) return;
    const api = createMatchApi(siteRoot);

    server = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://127.0.0.1:${MATCH_PORT}`);
      const handled = await api.handle(req, res, url);
      if (!handled) {
        res.statusCode = 404;
        res.end('Not found');
      }
    });

    server.on('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        console.warn(
          `[match-api] port ${MATCH_PORT} in use — assuming already running`,
        );
        server = null;
        return;
      }
      console.error('[match-api]', err);
    });

    server.listen(MATCH_PORT, '127.0.0.1', () => {
      console.log(`[match-api] http://127.0.0.1:${MATCH_PORT}/match-api/status`);
    });
  }

  function stop() {
    server?.close();
    server = null;
  }

  return {
    name: 'modkraft-match-workbench',
    hooks: {
      'astro:server:setup'() {
        start();
      },
      'astro:server:done'() {
        stop();
      },
    },
  };
}
