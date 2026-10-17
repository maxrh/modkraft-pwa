import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { visionTool } from '@sanity/vision';
import { schemaTypes } from './src/sanity/schemaTypes';

const projectId = process.env.PUBLIC_SANITY_PROJECT_ID || 'placeholder';
const dataset = process.env.PUBLIC_SANITY_DATASET || 'production';

export default defineConfig({
  name: 'modkraft',
  title: 'Modkraft',
  projectId,
  dataset,
  plugins: [structureTool(), visionTool()],
  schema: {
    types: schemaTypes,
  },
});
