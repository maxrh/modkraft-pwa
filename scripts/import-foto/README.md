# Photo archive importer

Parses the HTTrack mirror of `temp.modkraft.dk` foto content into cleaned, CMS-agnostic **photo-collections**.

## Source

```
C:\Users\max\Desktop\modkraft-foto\modkraft-foto\temp.modkraft.dk
```

## Output

```
modkraft-pwa/content/photo-collections/
  _index.json
  _series.json
  validation-report.json
  YYYY-MM-DD-slug/
    collection.json
    intro.md
    images/
```

## Usage

```bash
cd scripts/import-foto
npm install
npm run import
npm run validate
```

Options:

```bash
node run.mjs --source "path/to/temp.modkraft.dk" --out "path/to/content/photo-collections"
```

## Caption rules

See the project plan. Handles fotoserie `title` credits, Syrien sibling-`<p>` captions, Roskilde inline `FOTO:` lines, and `styles/large` fallbacks when originals are missing.
