// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import sanity from '@sanity/astro';
// Local match workbench (dev): starts API on :4322 — see scripts/match/
import { matchWorkbenchIntegration } from './scripts/match/astro-integration.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const sanityProjectId = process.env.PUBLIC_SANITY_PROJECT_ID?.trim();
const sanityEnabled = Boolean(sanityProjectId);

/** @type {import('astro').AstroIntegration[]} */
const integrations = [react(), matchWorkbenchIntegration(rootDir)];

if (sanityEnabled) {
  integrations.push(
    sanity({
      projectId: sanityProjectId,
      dataset: process.env.PUBLIC_SANITY_DATASET || 'production',
      useCdn: false,
      studioBasePath: '/admin',
    }),
  );
}

// https://astro.build/config
export default defineConfig({
  ...(process.env.PUBLIC_SITE ? { site: process.env.PUBLIC_SITE } : {}),
  output: 'static',
  prefetch: {
    prefetchAll: true,
    // hover never fires on touch; tap covers mobile tag-nav clicks
    defaultStrategy: 'tap',
  },
  adapter: cloudflare({
    imageService: 'passthrough',
    platformProxy: {
      enabled: true,
    },
  }),
  integrations,
  vite: {
    // Cast: @tailwindcss/vite may resolve a different Vite Plugin type than Astro's bundled Vite
    plugins: [/** @type {any} */ (tailwindcss())],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, './src'),
      },
    },
  },
});
