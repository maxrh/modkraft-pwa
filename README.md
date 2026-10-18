# modkraft-pwa

Modkraft archive site — Astro 5, Tailwind CSS v4, shadcn/ui, Cloudflare Workers, and optional Sanity Studio.

## Stack

- **Astro 5** (`output: 'static'`) with `@astrojs/cloudflare`
- **Tailwind CSS v4** + **shadcn/ui** (React islands)
- **Photo archive** from `content/photo-collections/` via Astro Content Layer
- **Sanity** (`@sanity/astro`) — schemas ready; Studio at `/admin` only when `PUBLIC_SANITY_PROJECT_ID` is set

## Quick start

```bash
npm install
cp .env.example .env   # optional
npm run dev
```

Open [http://localhost:4321](http://localhost:4321).

### Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Astro dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Build + `wrangler dev` |
| `npm run check` | `astro check` |
| `npm run link:media` | Recreate `public/media/photo-collections` junction |
| `npm run thumbs` | Generate 640px WebP mosaic thumbnails into `public/media/thumbs/` (runs automatically before dev/build; only new or changed images) |
| `npm run import:foto` | Re-run photo importer |

Images are served via a directory junction (`public/media/photo-collections` → `content/photo-collections`) so the ~422 MB archive is not duplicated on disk.

## Routes

- `/` — frontpage mosaic of all photos
- `/soeg?q=` — search (SSR) across titles, captions, credits, tags, photographers
- `/foto/[collectionId]/[imageId]` — photo detail with collection context and siblings
- `/samling` / `/samling/[id]` — collection index and hubs
- `/serie/[id]` — multi-part series hub
- `/t/[tag]` — tag-filtered mosaic (slug URL, e.g. `/t/noedhjaelp`)
- `/admin` — Sanity Studio (when configured)

## Sanity (optional)

1. Create a project at [sanity.io/manage](https://www.sanity.io/manage)
2. Set in `.env`:

```env
PUBLIC_SANITY_PROJECT_ID=yourProjectId
PUBLIC_SANITY_DATASET=production
```

3. Restart `npm run dev` — Studio is at `/admin`
4. Enable CORS for your local and production origins in the Sanity project settings

Schemas live in `src/sanity/schemaTypes/` (`siteSettings`, `photoCollection`). Photo data stays local until you choose to migrate.

## Deploy (Cloudflare Workers)

```bash
npm run build
npx wrangler deploy
```

Requires a Cloudflare account and Wrangler login (`npx wrangler login`).

## Photo collections

```
content/photo-collections/
  _index.json
  _series.json
  YYYY-MM-DD-slug/
    collection.json
    intro.md
    images/
```

Re-import from the HTTrack dump:

```bash
cd scripts/import-foto
npm install
npm run import
npm run validate
```

Source dump (read-only): `C:\Users\max\Desktop\modkraft-foto\modkraft-foto\temp.modkraft.dk`
