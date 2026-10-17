import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';

const photoImageSchema = z.object({
  id: z.string(),
  sortOrder: z.number(),
  filename: z.string(),
  originalFilename: z.string().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  credit: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  captionSource: z.string().nullable().optional(),
  sourceResolve: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
});

const photoCollections = defineCollection({
  loader: glob({
    pattern: '*/collection.json',
    base: './content/photo-collections',
    generateId: ({ data, entry }) => {
      if (typeof data.id === 'string' && data.id.length > 0) return data.id;
      return entry.replace(/\/collection\.json$/, '');
    },
  }),
  schema: z.object({
    id: z.string(),
    sourceNid: z.number().nullable().optional(),
    slug: z.string(),
    title: z.string(),
    publishedAt: z.string(),
    modifiedAt: z.string().nullable().optional(),
    authors: z.array(z.string()).default([]),
    photographers: z.array(z.string()).default([]),
    prefix: z.string().nullable().optional(),
    series: z.string().nullable().optional(),
    manchet: z.string().nullable().optional(),
    introMarkdown: z.string().nullable().optional(),
    tags: z.array(z.string()).default([]),
    genre: z.string().nullable().optional(),
    coverImage: z.string().nullable().optional(),
    images: z.array(photoImageSchema),
    sourceUrl: z.string().nullable().optional(),
    sourceType: z.string().nullable().optional(),
  }),
});

const photoSeries = defineCollection({
  loader: file('./content/photo-collections/_series.json'),
  schema: z.object({
    id: z.string(),
    title: z.string(),
    author: z.string(),
    intro: z.string(),
    aboutSeries: z.string().optional(),
    aboutViomis: z.string().optional(),
    aboutAuthor: z.string().optional(),
    sourcePath: z.string().optional(),
  }),
});

export const collections = { photoCollections, photoSeries };
