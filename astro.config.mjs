// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import AstroPWA from '@vite-pwa/astro';
import tailwindcss from '@tailwindcss/vite';
import sanity from '@sanity/astro';
// Local match workbench (dev): starts API on :4322 — see scripts/match/
import { matchWorkbenchIntegration } from './scripts/match/astro-integration.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const sanityProjectId = process.env.PUBLIC_SANITY_PROJECT_ID?.trim();
const sanityEnabled = Boolean(sanityProjectId);

/** @type {import('astro').AstroIntegration[]} */
const integrations = [
  react(),
  matchWorkbenchIntegration(rootDir),
  sitemap({
    filter: (page) => !page.includes('/match'),
  }),
  AstroPWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon.svg', 'icons/*.png'],
    manifest: {
      id: 'https://fotoarkiv.modkraft.dk/',
      name: 'Modkraft Fotoarkiv',
      short_name: 'Modkraft Fotoarkiv',
      description:
        'Dokumentariske fotografier fra Modkrafts fotoserier og fotoblogs 2012 - 2017',
      lang: 'da',
      dir: 'ltr',
      display: 'standalone',
      orientation: 'any',
      start_url: '/',
      scope: '/',
      theme_color: '#c9505b',
      background_color: '#c9505b',
      icons: [
        {
          src: 'icons/icon-192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: 'icons/icon-512.png',
          sizes: '512x512',
          type: 'image/png',
        },
        {
          src: 'icons/maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    workbox: {
      globDirectory: 'dist',
      // Installable shell only — never precache the photo archive or HTML corpus.
      globPatterns: ['favicon.svg', 'icons/**/*.{png,svg}', '**/*.{js,css}'],
      globIgnores: ['**/media/**', '**/_worker.js', '**/_worker.js/**'],
      navigateFallback: null,
    },
    experimental: {
      directoryAndTrailingSlashHandler: true,
    },
    devOptions: {
      enabled: false,
    },
  }),
];

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
  // Canonical production host. Override with PUBLIC_SITE for staging previews.
  site: process.env.PUBLIC_SITE || 'https://fotoarkiv.modkraft.dk',
  output: 'static',
  redirects: {
    '/fotoserie': '/?view=collections',
  },
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
