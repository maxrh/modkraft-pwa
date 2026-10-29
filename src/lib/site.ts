export const SITE_TITLE = 'Modkraft Fotoarkiv';
export const SITE_DESCRIPTION =
  'Dokumentariske fotografier fra Modkrafts fotoserier og fotoblogs 2012 - 2017';

/** Canonical production origin (no trailing slash). */
export const SITE_URL = 'https://fotoarkiv.modkraft.dk';

/**
 * Default Open Graph image for non-photo pages (home, om, kontakt, …).
 * From /foto/1-marts-vores-kampdag/04 — pages can override with their own `image`.
 */
export const DEFAULT_OG_IMAGE = {
  path: '/media/display/1-marts-vores-kampdag/04-jagtvej-69-1582.webp',
  alt: 'Demonstration på Jagtvej 69, 1. marts — Modkraft Fotoarkiv',
} as const;

/** Developer / agency credit in the site footer. */
export const MONSUN = {
  name: 'MONSUN',
  url: 'https://monsun.dk/',
  address: ['Nørrebrogade 5C, 1. sal th', '2200 København N'],
  cvr: '31640180',
  phone: '+45 3539 7331',
  phoneHref: 'tel:+4535397331',
  email: 'info@monsun.dk',
} as const;

/** Legacy Modkraft news site (archive URL may change later). */
export const MODKRAFT_ARCHIVE = {
  name: 'Modkraft',
  url: 'https://modkraft.dk/',
  blurb:
    'Netavisen Modkraft lukkede i 2017, men er fortsat at finde online – bevaret som historisk arkiv.',
} as const;

export const SITE_LINKS = [
  { href: '/om', label: 'Om' },
  { href: '/kontakt', label: 'Kontakt' },
] as const;
