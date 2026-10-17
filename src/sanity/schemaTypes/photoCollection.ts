import { defineArrayMember, defineField, defineType } from 'sanity';

export const photoCollection = defineType({
  name: 'photoCollection',
  title: 'Photo Collection',
  type: 'document',
  fields: [
    defineField({
      name: 'legacyId',
      title: 'Legacy ID',
      type: 'string',
      description: 'Matches content/photo-collections folder id (YYYY-MM-DD-slug)',
    }),
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title' } }),
    defineField({ name: 'publishedAt', title: 'Published at', type: 'datetime' }),
    defineField({
      name: 'authors',
      title: 'Authors',
      type: 'array',
      of: [{ type: 'string' }],
    }),
    defineField({
      name: 'photographers',
      title: 'Photographers',
      type: 'array',
      of: [{ type: 'string' }],
    }),
    defineField({ name: 'prefix', title: 'Series prefix', type: 'string' }),
    defineField({ name: 'series', title: 'Series id', type: 'string' }),
    defineField({ name: 'manchet', title: 'Manchet', type: 'text', rows: 4 }),
    defineField({ name: 'introMarkdown', title: 'Intro (markdown)', type: 'text', rows: 8 }),
    defineField({
      name: 'tags',
      title: 'Tags',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
    }),
    defineField({ name: 'genre', title: 'Genre', type: 'string' }),
    defineField({
      name: 'images',
      title: 'Images',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'photoImage',
          fields: [
            defineField({ name: 'id', type: 'string', title: 'ID' }),
            defineField({ name: 'sortOrder', type: 'number', title: 'Sort order' }),
            defineField({ name: 'image', type: 'image', title: 'Image', options: { hotspot: true } }),
            defineField({ name: 'credit', type: 'string', title: 'Credit' }),
            defineField({ name: 'caption', type: 'text', title: 'Caption', rows: 3 }),
            defineField({
              name: 'tags',
              title: 'Tags',
              type: 'array',
              of: [{ type: 'string' }],
              options: { layout: 'tags' },
            }),
          ],
          preview: {
            select: { title: 'caption', subtitle: 'credit', media: 'image' },
            prepare({ title, subtitle, media }) {
              return {
                title: title || 'Photo',
                subtitle,
                media,
              };
            },
          },
        }),
      ],
    }),
  ],
  preview: {
    select: { title: 'title', subtitle: 'legacyId' },
  },
});
