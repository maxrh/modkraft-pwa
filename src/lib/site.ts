export const SITE_TITLE = 'Modkraft Fotoarkiv';
export const SITE_DESCRIPTION =
  'Dokumentariske fotografier fra Modkrafts fotoserier og fotoblogs 2012 - 2017';

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
