import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const WIDTH = 640;
const QUALITY = 72;
const CONCURRENCY = 6;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'content', 'photo-collections');
const outRoot = path.join(root, 'public', 'media', 'thumbs');

async function mtime(file) {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

async function collectJobs() {
  const jobs = [];
  const collections = await fs.readdir(sourceRoot, { withFileTypes: true });
  for (const dir of collections) {
    if (!dir.isDirectory()) continue;
    const imagesDir = path.join(sourceRoot, dir.name, 'images');
    let files;
    try {
      files = await fs.readdir(imagesDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!/\.(jpe?g|png|webp|gif)$/i.test(file)) continue;
      const input = path.join(imagesDir, file);
      const output = path.join(outRoot, dir.name, `${path.parse(file).name}.webp`);
      const [inTime, outTime] = await Promise.all([mtime(input), mtime(output)]);
      if (outTime !== null && inTime !== null && outTime >= inTime) continue;
      jobs.push({ input, output });
    }
  }
  return jobs;
}

async function run() {
  const jobs = await collectJobs();
  if (jobs.length === 0) {
    console.log('[make-thumbs] all thumbnails up to date');
    return;
  }

  console.log(`[make-thumbs] generating ${jobs.length} thumbnails (${WIDTH}px WebP)...`);
  let done = 0;
  let failed = 0;
  let next = 0;

  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        await fs.mkdir(path.dirname(job.output), { recursive: true });
        await sharp(job.input, { limitInputPixels: false })
          .rotate()
          .resize({ width: WIDTH, withoutEnlargement: true })
          .webp({ quality: QUALITY })
          .toFile(job.output);
      } catch (error) {
        failed++;
        console.warn(`[make-thumbs] failed: ${path.relative(root, job.input)} — ${error.message}`);
      }
      done++;
      if (done % 200 === 0) console.log(`[make-thumbs] ${done}/${jobs.length}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`[make-thumbs] done: ${done - failed} generated, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run();
