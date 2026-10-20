#!/usr/bin/env node
/**
 * Standalone match API (also started automatically by the Vite plugin).
 *
 *   node scripts/match/match-server.mjs
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMatchApi } from './match-api.mjs';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.env.MATCH_API_PORT || 4322);
const api = createMatchApi(siteRoot);

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  const handled = await api.handle(req, res, url);
  if (!handled) {
    res.statusCode = 404;
    res.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Match API listening on http://127.0.0.1:${port}/match-api/status`);
});
