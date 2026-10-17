import { createClient, type SanityClient } from '@sanity/client';

export function isSanityConfigured(): boolean {
  return Boolean(import.meta.env.PUBLIC_SANITY_PROJECT_ID?.trim());
}

export function getSanityClient(): SanityClient | null {
  const projectId = import.meta.env.PUBLIC_SANITY_PROJECT_ID?.trim();
  if (!projectId) return null;

  return createClient({
    projectId,
    dataset: import.meta.env.PUBLIC_SANITY_DATASET || 'production',
    apiVersion: import.meta.env.PUBLIC_SANITY_API_VERSION || '2025-10-01',
    useCdn: true,
    token: import.meta.env.SANITY_API_READ_TOKEN,
  });
}
