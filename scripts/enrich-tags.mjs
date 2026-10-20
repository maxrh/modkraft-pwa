#!/usr/bin/env node
/**
 * Normalize and enrich collection and per-image tags across all photo collections.
 *
 * - Normalizes all raw tags to canonical Danish Title/Sentence Case
 * - Drops meta/noise tags (`fotoserie`, `kalender`)
 * - Enriches all collections (including previously untagged collections)
 * - Normalizes `prefix` casing (e.g. "NØDHJÆLP TIL SYRIEN" -> "Nødhjælp til Syrien")
 * - Fixes known caption typos
 * - Populates a complete, self-contained `tags` array on every single image object in `collection.json`
 *   (combining parent collection canonical tags + image-specific tags from caption/filename)
 * - Updates `content/photo-collections/_index.json` to stay in sync
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const COLLECTIONS_DIR = path.join(ROOT, 'content', 'photo-collections');
const INDEX_PATH = path.join(COLLECTIONS_DIR, '_index.json');

/**
 * Mapping of raw existing tag strings -> array of canonical tags (empty array = drop).
 */
const TAG_MAP = {
  '1. maj': ['1. maj'],
  '1. marts': ['1. marts'],
  '4. okt': ['Velfærd'],
  '8. marts': ['8. marts'],
  Aktivisme: ['Aktivisme'],
  Aktivister: ['Aktivisme'],
  akvarium: ['Akvarium'],
  'anti islamisme': ['Antiracisme'],
  antifacisme: ['Antifascisme'],
  antifascisme: ['Antifascisme'],
  antifascister: ['Antifascisme'],
  antiracisme: ['Antiracisme'],
  'arbejdernes internationale kampdag': ['1. maj', 'Fagbevægelse'],
  asyl: ['Asyl'],
  Asyl: ['Asyl'],
  asylaktivisme: ['Asyl', 'Aktivisme'],
  asylansøgere: ['Asyl', 'Flygtninge'],
  asylpolitik: ['Asyl'],
  amnesty: ['Amnesty'],
  Amnesty: ['Amnesty'],
  anisette: ['Anisette'],
  Anisette: ['Anisette'],
  'bekæmp fattigdom nu': ['Velfærd', 'Socialt'],
  'Berlin Fristeder': ['Berlin', 'Fristeder', 'BZ'],
  'berlin muren': ['Berlinmuren', 'Berlin'],
  'bike wars': ['Bike Wars'],
  blokade: ['Blokade'],
  Blokade: ['Blokade'],
  byhave: ['Byhave 69', 'Jagtvej 69'],
  'byhave 69': ['Byhave 69', 'Jagtvej 69'],
  byhave69: ['Byhave 69', 'Jagtvej 69'],
  bz: ['BZ', 'Fristeder'],
  Bøger: ['Bøger'],
  børnemagt: ['Børnemagt'],
  cairo: ['Cairo'],
  ceta: ['CETA'],
  Christiania: ['Christiania'],
  christiansborg: ['Christiansborg'],
  Christiansborg: ['Christiansborg'],
  COP21: ['COP21', 'Klima'],
  demo: ['Demonstration'],
  Demonstration: ['Demonstration'],
  demonstrationer: ['Demonstration'],
  demonstrartion: ['Demonstration'],
  'den blå planet': ['Den Blå Planet'],
  Denonstration: ['Demonstration'],
  '3F': ['3F', 'Fagbevægelse'],
  FN: ['FN'],
  folketinget: ['Folketingets åbning', 'Christiansborg'],
  fotoudstilling: ['Fotoudstilling'],
  Fotoudstilling: ['Fotoudstilling'],
  Gaza: ['Gaza'],
  'die berliner mauer': ['Berlinmuren', 'Berlin'],
  'die mauer': ['Berlinmuren', 'Berlin'],
  Dong: ['DONG Energy'],
  'Dong Energy': ['DONG Energy'],
  Egypten: ['Egypten'],
  fagforening: ['Fagbevægelse'],
  fagligt: ['Fagbevægelse'],
  feminisme: ['Feminisme'],
  fest: ['Fest'],
  Festival: ['Roskilde Festival', 'Musik'],
  FIFA: ['FIFA'],
  fisk: ['Natur'],
  'flash mob': ['Aktivisme'],
  Flygtninge: ['Flygtninge'],
  'flygtninge er velkommen': ['Refugees Welcome', 'Flygtninge'],
  'flygtningekrisen 2015': ['Flygtninge', 'Asyl'],
  fodbold: ['Fodbold'],
  'Folketingets åbning': ['Folketingets åbning', 'Christiansborg'],
  'folketingsvalg 2015': ['Folketingsvalg'],
  'For Frihed': ['For Frihed'],
  fotoserie: [],
  'Freedom of Movements': ['Asyl', 'Flygtninge'],
  fælledparken: ['Fælledparken'],
  'Goldman Sachs': ['Goldman Sachs'],
  grundlovsdag: ['Grundlovsdag'],
  grækenland: ['Grækenland'],
  hjemløs: ['Hjemløse'],
  hjemløse: ['Hjemløse'],
  Hjemløse: ['Hjemløse'],
  hjemløsedag: ['Hjemløse'],
  hjemløsedagen: ['Hjemløse'],
  humaniora: ['Uddannelse'],
  'hus forbi': ['Hus Forbi'],
  'Hus Forbi': ['Hus Forbi'],
  'imod sexkøb': ['Kvindekamp', 'Feminisme'],
  Internet: ['Digital aktivisme'],
  istanbul: ['Istanbul'],
  Italien: ['Italien'],
  Jazz: ['Jazz', 'Musik'],
  jazz: ['Jazz', 'Musik'],
  'jagtvej 155B': ['BZ', 'Nørrebro'],
  'Jagtvej 69': ['Jagtvej 69'],
  'k-town': ['K-Town', 'Punk'],
  'K-Town': ['K-Town', 'Punk'],
  kalender: [],
  klimademo: ['Klima', 'Demonstration'],
  klimamarch: ['Klima', 'Demonstration'],
  koncert: ['Koncert', 'Musik'],
  Koncert: ['Koncert', 'Musik'],
  Kultur: ['Kultur'],
  Kurdere: ['Kurdistan'],
  Kurdistan: ['Kurdistan'],
  kvindekamp: ['Kvindekamp'],
  københavn: ['København'],
  København: ['København'],
  'kvindernes internationale kampdag': ['8. marts', 'Kvindekamp'],
  'kvinernes internationale kampdag': ['8. marts', 'Kvindekamp'],
  'kämpa malmö': ['Malmø', 'Antifascisme'],
  kämpashowan: ['Malmø', 'Antifascisme'],
  'København for Mangfoldighed og Pegida Danmark': [
    'København for Mangfoldighed',
    'Pegida',
    'Antiracisme',
    'Demonstration',
  ],
  'Københavns Universitet': ['Københavns Universitet', 'Uddannelse'],
  'LGBT+': ['LGBT+'],
  ligeløn: ['Ligeløn'],
  live: [],
  lockout: ['Lockout', 'Fagbevægelse'],
  Malmø: ['Malmø'],
  mayday: ['1. maj'],
  'Ministerrokade 3 februar 2014': ['Regeringen', 'Christiansborg'],
  Modkraft: ['Modkraft'],
  Musik: ['Musik'],
  nedskæringer: ['Nedskæringer', 'Velfærd'],
  nordvest: ['Nordvest', 'København'],
  nødhjælp: ['Nødhjælp'],
  Nørrebro: ['Nørrebro'],
  'out the camps': ['Asyl', 'Flygtninge'],
  'Out of the Camps': ['Asyl', 'Flygtninge'],
  Palæstina: ['Palæstina'],
  pegida: ['Pegida'],
  politibrutalitet: ['Politivold'],
  politivold: ['Politivold'],
  Pumpehuset: ['Pumpehuset'],
  punk: ['Punk', 'Musik'],
  Punk: ['Punk', 'Musik'],
  'Pussy Riot': ['Pussy Riot'],
  'racismefri by': ['Racismefri By', 'Antiracisme'],
  'refugees welcome': ['Refugees Welcome', 'Flygtninge'],
  refugeeswelcome: ['Refugees Welcome', 'Flygtninge'],
  rf14: ['Roskilde Festival', 'Koncert', 'Musik'],
  rf15: ['Roskilde Festival', 'Koncert', 'Musik'],
  romaer: ['Romaer'],
  Roskilde: ['Roskilde Festival'],
  'Roskilde Festival': ['Roskilde Festival', 'Koncert', 'Musik'],
  'Roskilde-Festival': ['Roskilde Festival', 'Koncert', 'Musik'],
  'roskilde festival 2013': ['Roskilde Festival', 'Koncert', 'Musik'],
  'Roskilde Festival 2012': ['Roskilde Festival', 'Koncert', 'Musik'],
  'Roskilde Festival 2014': ['Roskilde Festival', 'Koncert', 'Musik'],
  'Roskilde Festival 2015': ['Roskilde Festival', 'Koncert', 'Musik'],
  Rusland: ['Rusland'],
  rydning: ['Rydning'],
  rødby: ['Rødby'],
  's-sf-r-regering': ['Regeringen'],
  sandholmlejren: ['Sandholmlejren'],
  'Savage Rose': ['Savage Rose'],
  'sjælsmark lejren': ['Sjælsmark'],
  ska: ['Ska', 'Musik'],
  skifergas: ['Skifergas', 'Klima'],
  Socialt: ['Socialt', 'Velfærd'],
  'sort blok': ['Aktivisme', 'Demonstration'],
  'Spids Nøgenhat': ['Spids Nøgenhat'],
  stefanskirken: ['Stefanskirken', 'Nørrebro'],
  Stefanskirken: ['Stefanskirken', 'Nørrebro'],
  studenterbevægelse: ['Studerende', 'Uddannelse'],
  studerende: ['Studerende', 'Uddannelse'],
  støttefest: ['Fest', 'Kultur'],
  SU: ['SU', 'Uddannelse'],
  sultestrejke: ['Sultestrejke'],
  Sultestrejke: ['Sultestrejke'],
  syrien: ['Syrien'],
  Syrien: ['Syrien'],
  taginternettettilbage: ['Digital aktivisme'],
  'the wall': ['Berlinmuren', 'Berlin'],
  thedaywefightback: ['Digital aktivisme'],
  torussiawithlove: ['LGBT+', 'Rusland'],
  TTIP: ['TTIP'],
  turisme: ['Turisme'],
  Turisme: ['Turisme'],
  Tyrkiet: ['Tyrkiet'],
  Uddannelse: ['Uddannelse'],
  Ungdomshuset: ['Ungdomshuset'],
  ungeren: ['Ungdomshuset'],
  Vejlegården: ['Vejlegården'],
  velfærd: ['Velfærd'],
  venstrefløj: ['Venstrefløj'],
  Venstrefløj: ['Venstrefløj'],
  vm14: ['Fodbold'],
  årsdag: ['1. marts'],
  økologi: ['Økologi'],
  Økologi: ['Økologi'],
};

/**
 * Curated collection-level canonical tag additions per collection ID.
 * Ensures every collection (especially the 24 previously untagged ones) has complete, accurate topical tags.
 */
const COLLECTION_EXTRAS = {
  // --- artikel-foto imports (2012) ---
  'intet-glemt-intet-tilgivet': [
    '1. marts',
    'Demonstration',
    'Jagtvej 69',
    'Nørrebro',
    'Rydning',
    'Ungdomshuset',
  ],
  'blokade-mod-vus-lokaler': [
    'Antifascisme',
    'Antiracisme',
    'Blokade',
    'Demonstration',
    'København',
  ],
  '8-marts-2012': ['8. marts', 'Demonstration', 'Feminisme', 'Kvindekamp'],
  'soelleroedgade-tyve-aar-efter': [
    'Antiracisme',
    'Demonstration',
    'Historie',
    'Nørrebro',
    'Venstrefløj',
  ],
  'forandring-nu': [
    'Demonstration',
    'Fagbevægelse',
    'Klima',
    'Velfærd',
  ],
  'ingen-fascister-i-vores-gader': [
    'Aarhus',
    'Antifascisme',
    'Antiracisme',
    'Demonstration',
  ],
  'flere-frie-steder': ['BZ', 'Demonstration', 'Fristeder', 'Nørrebro'],
  'fest-faner-og-fadoel': [
    '1. maj',
    'Antifascisme',
    'Demonstration',
    'Fagbevægelse',
    'Fælledparken',
    'København',
  ],
  'helt-ude-i-hampen': [
    'Aktivisme',
    'Demonstration',
    'København',
    'Rådhuspladsen',
  ],
  'tunge-toner': ['Koncert', 'Kultur', 'Musik', 'Ungdomshuset'],
  'out-of-the-camps': [
    'Asyl',
    'Demonstration',
    'Flygtninge',
    'København',
  ],
  'sultestrejke-i-sigerslev': [
    'Asyl',
    'Flygtninge',
    'Kurdistan',
    'Sultestrejke',
    'Syrien',
  ],
  'syrisk-soergeoptog': [
    'Amnesty',
    'Demonstration',
    'Rusland',
    'Solidaritet',
    'Syrien',
  ],
  'glade-punks-fik-cykelkrig-og-veganske-hotdogs': [
    'Bike Wars',
    'K-Town',
    'Koncert',
    'Musik',
    'Punk',
    'Ungdomshuset',
  ],
  'roskilde-festival-2012': [
    'Koncert',
    'Kultur',
    'Musik',
    'Roskilde Festival',
  ],
  'jazz': ['Jazz', 'Koncert', 'Kultur', 'København', 'Musik'],
  'turisme': ['Italien', 'Kultur', 'Turisme'],
  'pussy-riot': [
    'Demonstration',
    'København',
    'LGBT+',
    'Pussy Riot',
    'Rusland',
    'Solidaritet',
  ],
  'save-fernanda': [
    'Asyl',
    'Demonstration',
    'København',
    'LGBT+',
    'Solidaritet',
  ],
  'billeder-fra-en-sultestrejke': [
    'Asyl',
    'Fotoudstilling',
    'Nørrebro',
    'Stefanskirken',
    'Sultestrejke',
  ],
  '3f-og-vejlegaarden-i-arbejdsretten': [
    '3F',
    'Blokade',
    'Demonstration',
    'Fagbevægelse',
    'Vejlegården',
  ],
  'folketinget-aabner-2012': [
    'Christiansborg',
    'Demonstration',
    'Folketingets åbning',
    'København',
  ],
  'hjemloesedag': ['Hjemløse', 'Hus Forbi', 'København', 'Socialt'],
  'vaelt-regeringen': [
    'Aktivisme',
    'Demonstration',
    'København',
    'Venstrefløj',
  ],
  'savage-rose-i-koncerthuset': [
    'Anisette',
    'Koncert',
    'Kultur',
    'Musik',
    'Savage Rose',
  ],
  'verdensmester-i-oekologi': [
    'Fotoudstilling',
    'Kultur',
    'København',
    'Økologi',
  ],
  'stoette-til-kurdisk-sultestrejke': [
    'Demonstration',
    'Kurdistan',
    'København',
    'Solidaritet',
    'Sultestrejke',
    'Tyrkiet',
  ],
  'solidaritet-med-gaza': [
    'Christiansborg',
    'Demonstration',
    'Gaza',
    'Palæstina',
    'Solidaritet',
  ],

  'ataturk-lufthavn': ['Syrien', 'Nødhjælp', 'Tyrkiet', 'Istanbul', 'VIOMIS'],
  'istanbul-er-en-foelelse-et-indtryk-og-et-afsaet-videre': [
    'Syrien',
    'Nødhjælp',
    'Tyrkiet',
    'Istanbul',
  ],
  'moedet-med-de-syriske-flygtninge': [
    'Syrien',
    'Nødhjælp',
    'Flygtninge',
    'Tyrkiet',
  ],
  'bomber-i-det-fjerne': ['Syrien', 'Nødhjælp', 'Flygtninge', 'Tyrkiet'],
  'livet-aendrer-sig-paa-et-splitsekund': [
    'Syrien',
    'Nødhjælp',
    'Flygtninge',
    'Aleppo',
    'Den Frie Syriske Hær',
  ],
  'til-te-med-oproeret': [
    'Syrien',
    'Nødhjælp',
    'Flygtninge',
    'Tyrkiet',
    'Den Frie Syriske Hær',
  ],
  'antifascistisk-solidaritet-med-graekenland': [
    'Grækenland',
    'Antifascisme',
    'Demonstration',
    'Solidaritet',
  ],
  'die-mauer': ['Berlinmuren', 'Berlin', 'Historie'],
  'ska-bash-i-ungdomshuset': ['Ungdomshuset', 'Koncert', 'Musik', 'Ska'],
  'antifascister-mod-siad': [
    'Antifascisme',
    'Antiracisme',
    'Demonstration',
    'Antifascistisk Aktion',
    'København',
  ],
  'hoejt-humoer-under-su-protester': [
    'SU',
    'Studerende',
    'Uddannelse',
    'Demonstration',
  ],
  'seks-aar-efter': [
    'Jagtvej 69',
    'Ungdomshuset',
    '1. marts',
    'Demonstration',
    'Nørrebro',
  ],
  '8-marts-2013': ['8. marts', 'Kvindekamp', 'Feminisme', 'Ligeløn', 'Demonstration'],
  'laererne-er-de-foerste-hvem-bliver-de-naeste': [
    'Lockout',
    'Fagbevægelse',
    'Uddannelse',
    'Demonstration',
  ],
  'protest-mod-lockout': [
    'Lockout',
    'Fagbevægelse',
    'Uddannelse',
    'Demonstration',
    'København',
  ],
  'laererlockout-uge-2': [
    'Lockout',
    'Fagbevægelse',
    'Uddannelse',
    'Demonstration',
    'København',
  ],
  '1-maj-2013-faner-er-roede-helle-er': [
    '1. maj',
    'Fagbevægelse',
    'Demonstration',
    'Fælledparken',
    'København',
  ],
  'her-er-plads-stop-udvisningerne-til-afghanistan': [
    'Asyl',
    'Flygtninge',
    'Afghanistan',
    'Demonstration',
    'Aktivisme',
  ],
  'pausefisk': ['Akvarium', 'Den Blå Planet', 'Natur'],
  'jagtvej-demo-besaettelse-og-rydning': [
    'BZ',
    'Fristeder',
    'Rydning',
    'Demonstration',
    'Nørrebro',
  ],
  'moskemodstandere-moeder-modstand': [
    'Antifascisme',
    'Antiracisme',
    'Demonstration',
    'Rådhuspladsen',
    'København',
  ],
  'hjemloese-fejrer-grundlovsdag': ['Hjemløse', 'Grundlovsdag', 'Socialt'],
  'valentina-tereshkova': ['Valentina Tereshkova', 'Historie', 'Kvindekamp'],
  'tilbage-paa-tahrir': ['Egypten', 'Cairo', 'Tahrir', 'Demonstration'],
  'opvarming-roskilde-festival-2013': [
    'Roskilde Festival',
    'Koncert',
    'Musik',
    'Kultur',
  ],
  'to-russia-with-love': ['LGBT+', 'Rusland', 'Demonstration', 'Solidaritet'],
  'gadefest-mod-vold-trusler-og-boeller': [
    'Hjemløse',
    'Hus Forbi',
    'Socialt',
    'Fest',
  ],
  'punx-picnic-2013': ['Punk', 'K-Town', 'Koncert', 'Musik', 'Ungdomshuset'],
  'folketinget-aabner-2013': [
    'Folketingets åbning',
    'Christiansborg',
    'Demonstration',
    'Fagbevægelse',
  ],
  'aktion-69': [
    'Jagtvej 69',
    'Ungdomshuset',
    'Aktivisme',
    'Demonstration',
    'Nørrebro',
  ],
  'studenterprotester-mod-fremdriftsreform-paa-universiteterne': [
    'Studerende',
    'Uddannelse',
    'Demonstration',
    'Københavns Universitet',
  ],
  'baalfest-paa-jagtvej-69': [
    'Jagtvej 69',
    'Ungdomshuset',
    'Nørrebro',
    'Aktivisme',
  ],
  'hjemloese-er-hundens-bedste-ven': ['Hjemløse', 'Hus Forbi', 'Socialt'],
  'ding-dong-dynamodemo': [
    'DONG Energy',
    'Goldman Sachs',
    'Demonstration',
    'Aktivisme',
  ],
  'vi-vil-huske-dong-salget': [
    'DONG Energy',
    'Goldman Sachs',
    'Demonstration',
    'Socialdemokraterne',
    'Nørrebro',
  ],
  'ministerrokade': ['Regeringen', 'Christiansborg', 'SF', 'Socialdemokraterne', 'Radikale Venstre'],
  'tag-internettet-tilbage': ['Digital aktivisme', 'Demonstration', 'Aktivisme'],
  '1-marts-vores-kampdag': [
    'Jagtvej 69',
    'Ungdomshuset',
    '1. marts',
    'Rydning',
    'Demonstration',
  ],
  'kvindekampdag-2014-tag-natten-tilbage-kraev-respekt-forbyd-sexkoeb': [
    '8. marts',
    'Kvindekamp',
    'Feminisme',
    'Demonstration',
    'Nørrebro',
  ],
  'kampa-malmo': ['Malmø', 'Antifascisme', 'Demonstration', 'Solidaritet'],
  'protest-mod-politibrutalitet': ['Politivold', 'Demonstration', 'København'],
  'rote-flora': [
    'Rote Flora',
    'Fristeder',
    'BZ',
    'Ungdomshuset',
    'Nørrebro',
    'Demonstration',
  ],
  'newroz-piroz-be': ['Newroz', 'Kurdistan', 'Kultur', 'Rådhuspladsen', 'Christiansborg'],
  'racismefri-by-marts-2014': [
    'Racismefri By',
    'Antiracisme',
    'Demonstration',
    'Vesterbro',
    'Sydhavnen',
  ],
  'aktion-paa-christiania': ['Christiania', 'Aktivisme', 'Fristeder', 'København'],
  'eu-foer-lukketid': ['EU', 'Strasbourg', 'Folkebevægelsen mod EU'],
  '1-maj-fotokavalkade-2014': [
    '1. maj',
    'Fagbevægelse',
    'Demonstration',
    'Fælledparken',
    'København',
  ],
  'byhave-69': ['Byhave 69', 'Jagtvej 69', 'Nørrebro', 'Aktivisme', 'Fristeder'],
  'racismefri-by-maj-2014': ['Racismefri By', 'Antiracisme', 'Antifascisme', 'Demonstration'],
  'grundlovsdag-paa-christiania': ['Christiania', 'Grundlovsdag', 'Fristeder', 'Kultur'],
  'roskilde-festival-koncertfotos': [
    'Roskilde Festival',
    'Koncert',
    'Musik',
    'Kultur',
  ],
  'modkraft-fester': ['Modkraft', 'Fest', 'Kultur'],
  'solidaritet-med-kobane-og-rojava': [
    'Kobane',
    'Rojava',
    'Kurdistan',
    'Syrien',
    'Demonstration',
    'Solidaritet',
    'Christiansborg',
  ],
  'folketinget-aabner-2014': [
    'Folketingets åbning',
    'Christiansborg',
    'Demonstration',
    'Velfærd',
  ],
  'hjemloese-og-hjaelpemidler': ['Hjemløse', 'Hus Forbi', 'Socialt'],
  'for-og-imod-pegida': ['Pegida', 'Antiracisme', 'Demonstration', 'København'],
  'koebenhavn-for-mangfoldighed': [
    'København for Mangfoldighed',
    'Pegida',
    'Antiracisme',
    'Demonstration',
    'København',
  ],
  '8-aars-demo-intet-glemt-intet-tilgivet': [
    'Jagtvej 69',
    'Ungdomshuset',
    '1. marts',
    'Rydning',
    'Demonstration',
    'Nørrebro',
  ],
  '8-marts-2015': [
    '8. marts',
    'Kvindekamp',
    'Feminisme',
    'SUF',
    'Demonstration',
    'København',
  ],
  'skifergasprotester-i-nordjylland': [
    'Skifergas',
    'Klima',
    'Blokade',
    'Aktivisme',
  ],
  'foraar-fest-og-1-maj': [
    '1. maj',
    'Fagbevægelse',
    'Demonstration',
    'Antifascisme',
    'København',
  ],
  'valgfester': ['Folketingsvalg', 'Venstrefløj', 'Enhedslisten', 'Christiansborg'],
  'punx-picnic-2015': ['Punk', 'K-Town', 'Bike Wars', 'Ungdomshuset', 'Kultur'],
  'roskilde-2015-skudt-i-gang': ['Roskilde Festival', 'Koncert', 'Musik', 'Kultur'],
  'roskilde-vibrerer': ['Roskilde Festival', 'Koncert', 'Musik', 'Kultur'],
  'refugeeswelcome': [
    'Refugees Welcome',
    'Flygtninge',
    'Asyl',
    'Demonstration',
    'Christiansborg',
  ],
  'spids-noegenhat-i-pumpehuset': [
    'Spids Nøgenhat',
    'Pumpehuset',
    'Koncert',
    'Musik',
  ],
  'folkevandring-samlede-20-000-deltagere': [
    'Refugees Welcome',
    'Flygtninge',
    'Asyl',
    'Demonstration',
    'København',
  ],
  'hjemloesedagen-2015': ['Hjemløse', 'Socialt', 'Velfærd'],
  'stop-milliardnedskaeringer-paa-uddannelse': [
    'Uddannelse',
    'Nedskæringer',
    'Studerende',
    'Demonstration',
  ],
  'sidste-nat-i-roma-lejren': ['Romaer', 'Malmø', 'Hjemløse', 'Rydning', 'Socialt'],
  'mangfoldig-klimamarch-i-koebenhavn': [
    'Klima',
    'COP21',
    'Demonstration',
    'København',
  ],
  'aktion-mod-id-kontrol': [
    'Flygtninge',
    'Asyl',
    'Aktivisme',
    'Demonstration',
    'København',
  ],
  'close-sjaelsmark': [
    'Sjælsmark',
    'Sandholmlejren',
    'Asyl',
    'Flygtninge',
    'Demonstration',
  ],
  'boernemagt-i-ungdomshuset': [
    'Ungdomshuset',
    'Punk',
    'Koncert',
    'Musik',
    'Børnemagt',
  ],
  'demonstrationer-i-aarhus-odense-og-koebenhavn-udsatte-kraever-respekt-og-vaerdighed-til-alle': [
    'Velfærd',
    'Socialt',
    'Demonstration',
    'Aktivisme',
    'København',
    'Aarhus',
    'Odense',
  ],
  'kvindernes-internationale-kampdag-i-seks-aar': [
    '8. marts',
    'Kvindekamp',
    'Feminisme',
    'Demonstration',
  ],
  'vanessa': ['Kultur', 'Portræt'],
  'demonstration-mod-sexkoeb': [
    '8. marts',
    'Kvindekamp',
    'Feminisme',
    'Demonstration',
  ],
  'aktivister-paa-gaden-for-at-stoette-rydningstruede-fristeder-i-berlin': [
    'Berlin',
    'Fristeder',
    'BZ',
    'Solidaritet',
    'Demonstration',
  ],
  'demonstration-mod-milliardbesparelser-i-kommunerne': [
    'Nedskæringer',
    'Velfærd',
    'Fagbevægelse',
    'Demonstration',
    'København',
  ],
  '1-maj-2016': [
    '1. maj',
    'Fagbevægelse',
    'Demonstration',
    'Antifascisme',
    'København',
  ],
  'ja-til-velfaerd-nej-til-fattigdom': [
    'Velfærd',
    'Nedskæringer',
    'Socialt',
    'Demonstration',
  ],
  'kaempe-protest-mod-su-nedskaeringer': [
    'SU',
    'Uddannelse',
    'Studerende',
    'Nedskæringer',
    'Demonstration',
  ],
  'stop-ttip-og-ceta': ['TTIP', 'CETA', 'EU', 'Demonstration'],
  'blokade-mod-lukning-af-biblioteker-paa-ku-studerende-frygter-for-faerre-boeger-og-laesepladser': [
    'Københavns Universitet',
    'Studerende',
    'Uddannelse',
    'Blokade',
    'Aktivisme',
  ],
  'aleida-guevara': ['Aleida Guevara', 'Cuba', 'Solidaritet', 'Nørrebro'],
  'islamkritikere-gik-gennem-noerrebro-med-hjaelp-fra-politiet': [
    'For Frihed',
    'Pegida',
    'Antiracisme',
    'Antifascisme',
    'Nørrebro',
    'Demonstration',
  ],
  'save-aleppo': [
    'Aleppo',
    'Syrien',
    'Demonstration',
    'Solidaritet',
    'Christiansborg',
  ],
  'stop-politivold': ['Politivold', 'Demonstration', 'Aktivisme'],
  'to-aar-med-protester-mod-for-frihed': [
    'For Frihed',
    'Pegida',
    'Antiracisme',
    'Antifascisme',
    'Demonstration',
  ],
  'aktion-mod-dagpengeregler': [
    'Dagpenge',
    'Velfærd',
    'Fagbevægelse',
    'Aktivisme',
    'Christiansborg',
  ],
};

/**
 * Normalize inconsistent ALL-CAPS or lowercase collection `prefix` values.
 */
const PREFIX_MAP = {
  'NØDHJÆLP TIL SYRIEN': 'Nødhjælp til Syrien',
  GRÆKENLAND: 'Grækenland',
  AKVARIUM: 'Akvarium',
  lockout: 'Lockout',
  demo: 'Demonstration',
  Demo: 'Demonstration',
  asyl: 'Asyl',
  musikfoto: 'Musikfoto',
  fotoudstilling: 'Fotoudstilling',
};

/**
 * Pattern rules matched against each image's `(caption + ' ' + originalFilename)`
 * to extract image-specific tags (bands, artists, politicians, speakers, organizations, venues, cities).
 */
const IMAGE_PATTERNS = [
  // Bands & artists
  { re: /\bSpids Nøgenhat\b|\bLorenzo Woodrose\b/i, tags: ['Spids Nøgenhat'] },
  { re: /\bPussy Riot\b|\bNadya Tolokonnikova\b/i, tags: ['Pussy Riot'] },
  { re: /\bLars H\.U\.G\b/i, tags: ['Lars H.U.G.'] },
  { re: /\bOutcast\b|\bOutkast\b/i, tags: ['Outkast'] },
  { re: /\bDie Antwoord\b/i, tags: ['Die Antwoord'] },
  { re: /\bS!vas\b|\bsivas_/i, tags: ['S!vas'] },
  { re: /\bTimbuktu\b/i, tags: ['Timbuktu'] },
  { re: /\bPatchanka\b/i, tags: ['Patchanka', 'Koncert', 'Musik'] },
  { re: /\bRaske Penge\b/i, tags: ['Raske Penge', 'Koncert', 'Musik'] },
  { re: /\bKlumben\b/i, tags: ['Klumben'] },
  { re: /\bTopgunn\b/i, tags: ['TopGunn'] },
  { re: /\bPonyblod\b/i, tags: ['Ponyblod'] },
  { re: /\bKaka\b/i, tags: ['Kaka'] },
  { re: /\bOkay Funky\b/i, tags: ['Okay Funky'] },
  { re: /\bLiars\b/i, tags: ['Liars'] },
  { re: /\bMamar Kassey\b/i, tags: ['Mamar Kassey'] },
  { re: /\bDamon Albarn\b/i, tags: ['Damon Albarn'] },
  { re: /\bRob Zombie\b/i, tags: ['Rob Zombie'] },
  { re: /\bFuture Islands\b/i, tags: ['Future Islands'] },
  { re: /\bNikolaj Nørlund\b/i, tags: ['Nikolaj Nørlund'] },
  { re: /\bJenny Wilson\b/i, tags: ['Jenny Wilson'] },
  { re: /\bMolly\b/i, tags: ['Molly'] },
  { re: /\bFuture Brown\b/i, tags: ['Future Brown'] },
  { re: /\bNoel Gallagher/i, tags: ["Noel Gallagher's High Flying Birds"] },
  { re: /\bThe War On Drugs\b/i, tags: ['The War on Drugs'] },
  { re: /\bBob Hund\b/i, tags: ['Bob Hund'] },
  { re: /\bGretchen Peters\b/i, tags: ['Gretchen Peters'] },
  { re: /\bFather John Misty\b/i, tags: ['Father John Misty'] },
  { re: /\bDreamers' Circus\b/i, tags: ["Dreamers' Circus"] },
  { re: /\bFat White Family\b/i, tags: ['Fat White Family'] },
  { re: /\bEinstürzende Neubaute/i, tags: ['Einstürzende Neubauten'] },
  { re: /\bPharmakon\b/i, tags: ['Pharmakon'] },
  { re: /\bVon Dü\b/i, tags: ['Von Dü', 'Koncert', 'Musik'] },
  { re: /\bSort Stue\b/i, tags: ['Sort Stue', 'Koncert', 'Musik'] },
  { re: /\bRøde Horn\b/i, tags: ['Røde Horn', 'Musik'] },
  { re: /\bLors Doukaiev\b/i, tags: ['Lors Doukaiev'] },
  { re: /\bGuddommelig Galskab\b/i, tags: ['Guddommelig Galskab'] },
  { re: /\bDårligt Selskab\b/i, tags: ['Dårligt Selskab'] },
  { re: /\bSnafu\b/i, tags: ['Snafu'] },

  // Politicians, speakers & notable people
  { re: /\bJohanne Schmidt-Nielsen\b/i, tags: ['Johanne Schmidt-Nielsen', 'Enhedslisten'] },
  { re: /\bPernille Skipper\b/i, tags: ['Pernille Skipper', 'Enhedslisten'] },
  { re: /\bHelle Thorning-Schmidt\b/i, tags: ['Helle Thorning-Schmidt', 'Socialdemokraterne'] },
  { re: /\bPia Olsen Dyhr\b/i, tags: ['Pia Olsen Dyhr', 'SF'] },
  { re: /\bHolger K\. Nielsen\b/i, tags: ['Holger K. Nielsen', 'SF'] },
  { re: /\bAstrid Kragh?\b/i, tags: ['Astrid Krag', 'SF'] },
  { re: /\bMargrethe Vestager\b/i, tags: ['Margrethe Vestager', 'Radikale Venstre'] },
  { re: /\bAnnette (?:Wilhelmsen|Vilhelmsen)\b/i, tags: ['Annette Vilhelmsen', 'SF'] },
  { re: /\bManu Sareen\b/i, tags: ['Manu Sareen', 'Radikale Venstre'] },
  { re: /\bIda Auken\b/i, tags: ['Ida Auken', 'Radikale Venstre'] },
  { re: /\bKirsten Brosbøl\b/i, tags: ['Kirsten Brosbøl', 'Socialdemokraterne'] },
  { re: /\bMargret(?:he|e) Auken\b/i, tags: ['Margrete Auken', 'SF'] },
  { re: /\bRina Ronja Kari\b/i, tags: ['Rina Ronja Kari', 'Folkebevægelsen mod EU'] },
  { re: /\bChristel Schaldemose\b/i, tags: ['Christel Schaldemose', 'Socialdemokraterne'] },
  { re: /\bPia Kjærsgaard\b/i, tags: ['Pia Kjærsgaard', 'Dansk Folkeparti'] },
  { re: /\bKristian Thulesen Dahl\b/i, tags: ['Kristian Thulesen Dahl', 'Dansk Folkeparti'] },
  { re: /\bFinn Sørensen\b/i, tags: ['Finn Sørensen', 'Enhedslisten'] },
  { re: /\bVictoria Ninosca Risbjerg Velásquez\b/i, tags: ['Victoria Velásquez', 'Enhedslisten'] },
  { re: /\bJakob Sølvhøj\b/i, tags: ['Jakob Sølvhøj', 'Enhedslisten'] },
  { re: /\bMaria Gjerding\b/i, tags: ['Maria Gjerding', 'Enhedslisten'] },
  { re: /\bMikkel Warming\b/i, tags: ['Mikkel Warming', 'Enhedslisten'] },
  { re: /\bPernille Frahm\b/i, tags: ['Pernille Frahm', 'Enhedslisten'] },
  { re: /\bSelahattin Demirtas\b/i, tags: ['Selahattin Demirtaş', 'HDP'] },
  { re: /\bDennis Kristensen\b/i, tags: ['Dennis Kristensen', 'FOA'] },
  { re: /\bAnders Bondo\b/i, tags: ['Anders Bondo Christensen', 'Danmarks Lærerforening'] },
  { re: /\bJan Hoby\b/i, tags: ['Jan Hoby', 'LFS'] },
  { re: /\bKhatera Parwani\b/i, tags: ['Khatera Parwani'] },
  { re: /\bAnne Lise Marstrand-Jørgensen\b/i, tags: ['Anne Lise Marstrand-Jørgensen'] },

  // Organizations, unions, parties & campaigns
  { re: /\bEnhedslistens?\b/i, tags: ['Enhedslisten'] },
  { re: /\bDansk Folkeparti\b/i, tags: ['Dansk Folkeparti'] },
  { re: /\bFolkebevægelsen mod EU\b/i, tags: ['Folkebevægelsen mod EU'] },
  { re: /\bSocialistisk Ungdomsfront\b|\bSUF\b|\bsuf[-_]/i, tags: ['SUF'] },
  { re: /\bFOA\b/i, tags: ['FOA', 'Fagbevægelse'] },
  { re: /\bLFS\b/i, tags: ['LFS', 'Fagbevægelse'] },
  { re: /\bBUPL\b/i, tags: ['BUPL', 'Fagbevægelse'] },
  { re: /\bDanmarks Lærerforening\b/i, tags: ['Danmarks Lærerforening', 'Fagbevægelse'] },
  { re: /\bPROSA\b/i, tags: ['PROSA', 'Fagbevægelse'] },
  { re: /\bDSU\b/i, tags: ['DSU'] },
  { re: /\bAntifascistisk Aktion\b|\bAFA\b|\bafa_1maj/i, tags: ['Antifascistisk Aktion', 'Antifascisme'] },
  { re: /\bForeningen DEMOS\b|\bDemos\b|\bdemos_/i, tags: ['Demos'] },
  { re: /\b8\.?\s*Marts Initi?tativet\b|\b8_?marts_?initiativet/i, tags: ['8. Marts Initiativet'] },
  { re: /natten tilbage|vitarnattentilbage/i, tags: ['Vi tager natten tilbage'] },
  { re: /\bRed Ladies\b|\bredladies/i, tags: ['Red Ladies'] },
  { re: /\bPippi-aktion\b|\bpippiaktion/i, tags: ['Pippi-aktion'] },
  { re: /\bZimbabwe\b/i, tags: ['Zimbabwe', 'Solidaritet'] },
  { re: /\bKøbenhavn for Mangfoldighed\b/i, tags: ['København for Mangfoldighed'] },
  { re: /\bPegida\b/i, tags: ['Pegida'] },
  { re: /\bFor Friheds?\b/i, tags: ['For Frihed'] },
  { re: /\bAntikapitalistisk 1\.?\s*maj\b/i, tags: ['Antikapitalistisk 1. maj'] },
  { re: /\bRevolutionær 1\.?\s*Maj\b/i, tags: ['Revolutionær 1. maj'] },
  { re: /\bAntifascistisk 1\.?\s*Maj\b/i, tags: ['Antifascistisk 1. maj', 'Antifascisme'] },
  { re: /\bFrie Syriske Hær\b|\bFSA\b/i, tags: ['Den Frie Syriske Hær'] },
  { re: /\bVIOMIS\b/i, tags: ['VIOMIS'] },

  // Places, venues & cities in captions/filenames
  { re: /\bChristiansborg\b|\bChrBorg\b/i, tags: ['Christiansborg', 'København'] },
  { re: /\bRådhuspladsen\b/i, tags: ['Rådhuspladsen', 'København'] },
  { re: /\bFælledparken\b/i, tags: ['Fælledparken', 'København'] },
  { re: /\bBlågårds\s*Plads\b/i, tags: ['Blågårds Plads', 'Nørrebro', 'København'] },
  { re: /\bFolkets Park\b/i, tags: ['Folkets Park', 'Nørrebro', 'København'] },
  { re: /\bSankt Hans Torv\b/i, tags: ['Sankt Hans Torv', 'Nørrebro', 'København'] },
  { re: /\bGammel\s*Torv\b/i, tags: ['Gammeltorv', 'København'] },
  { re: /\bVesterbro Torv\b/i, tags: ['Vesterbro', 'København'] },
  { re: /\bIsraels Plads\b/i, tags: ['Israels Plads', 'København'] },
  { re: /\bDronning Louises Bro\b/i, tags: ['Dronning Louises Bro', 'Nørrebro', 'København'] },
  { re: /\bAmalienborg\b/i, tags: ['Amalienborg', 'København'] },
  { re: /\bFinansministeriet\b/i, tags: ['Finansministeriet', 'København'] },
  { re: /\bArbejdermuseet\b/i, tags: ['Arbejdermuseet', 'København'] },
  { re: /\bPumpehuset\b/i, tags: ['Pumpehuset', 'København'] },
  { re: /\bFrederiksberg\b/i, tags: ['Frederiksberg'] },
  { re: /\bNørrebro(?:gade)?\b/i, tags: ['Nørrebro', 'København'] },
  { re: /\bChristianitterne\b/i, tags: ['Christiania'] },
  { re: /\bAarhus\b|\bÅrhus\b/i, tags: ['Aarhus'] },
  { re: /\bOdense\b/i, tags: ['Odense'] },
  { re: /\bAalborg\b/i, tags: ['Aalborg'] },
  { re: /\bMaribo\b/i, tags: ['Maribo'] },
  { re: /\bRødby(?:\s*Havn|havn)?\b/i, tags: ['Rødby'] },
  { re: /\bStrasbourg\b/i, tags: ['Strasbourg'] },
  { re: /\bIstanbul\b/i, tags: ['Istanbul'] },
  { re: /\bAleppo\b/i, tags: ['Aleppo'] },
];

/**
 * Fix known caption typos across the archive.
 */
function cleanCaption(collectionId, img) {
  if (!img.caption) return null;
  let c = img.caption.trim();

  // Stray copy-paste caption "Lig" on 2016-02-05 image 04
  if (
    collectionId ===
      'demonstrationer-i-aarhus-odense-og-koebenhavn-udsatte-kraever-respekt-og-vaerdighed-til-alle' &&
    img.id === '04' &&
    c === 'Lig'
  ) {
    return null;
  }

  c = c
    .replace(/\bInititativet\b/g, 'Initiativet')
    .replace(/\bModdemostranter\b/g, 'Moddemonstranter')
    .replace(/\barrengere\b/g, 'arrangere')
    .replace(/\bpolitkere\b/g, 'politikere')
    .replace(/\bsynlinge\b/g, 'synlige')
    .replace(/\bEinstürzende Neubaute\b/g, 'Einstürzende Neubauten')
    .replace(/\bOutcast\b/g, 'Outkast')
    .replace(/\bLars H\.U\.G$/g, 'Lars H.U.G.')
    .replace(/^Århus$/g, 'Aarhus');

  return c;
}

function sortTagsDa(tagsIterable) {
  return [...new Set(tagsIterable)].sort((a, b) => a.localeCompare(b, 'da'));
}

/** Exact TAG_MAP hit, then case-insensitive key match. */
function mapRawTag(rawTag) {
  if (Object.prototype.hasOwnProperty.call(TAG_MAP, rawTag)) {
    return TAG_MAP[rawTag];
  }
  const lower = rawTag.toLowerCase();
  for (const [key, value] of Object.entries(TAG_MAP)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function enrichImageTags(collectionId, collectionTags, img) {
  const imageTags = new Set(collectionTags);
  const text = `${img.caption || ''} ${img.originalFilename || ''}`;

  for (const rule of IMAGE_PATTERNS) {
    if (rule.re.test(text)) {
      for (const t of rule.tags) {
        imageTags.add(t);
      }
    }
  }

  // Special handling: `2016-02-03-boernemagt-i-ungdomshuset` images 01-04 are the punk band "Lig"
  if (collectionId === 'boernemagt-i-ungdomshuset' && img.caption === 'Lig') {
    imageTags.add('Lig');
  }

  return sortTagsDa(imageTags);
}

function main() {
  const dirs = fs
    .readdirSync(COLLECTIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort();

  const rawCollectionTagsBefore = new Set();
  let untaggedCollectionsBefore = 0;
  let untaggedCollectionsAfter = 0;
  const canonicalCollectionTagCounts = new Map();
  const canonicalImageTagCounts = new Map();
  let totalImagesProcessed = 0;
  let imagesWithExtraTags = 0;
  let captionsFixed = 0;
  let prefixesNormalized = 0;

  const updatedById = new Map();

  for (const dir of dirs) {
    const filePath = path.join(COLLECTIONS_DIR, dir, 'collection.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const oldTags = data.tags || [];
    if (oldTags.length === 0) untaggedCollectionsBefore++;
    for (const t of oldTags) rawCollectionTagsBefore.add(t);

    // 1. Normalize prefix casing if needed
    if (data.prefix && PREFIX_MAP[data.prefix]) {
      data.prefix = PREFIX_MAP[data.prefix];
      prefixesNormalized++;
    }

    // 2. Map existing collection tags + merge COLLECTION_EXTRAS
    const nextCollectionTags = new Set();
    for (const rawTag of oldTags) {
      const mapped = mapRawTag(rawTag);
      if (mapped === undefined) {
        console.warn(`WARN: Unmapped raw tag "${rawTag}" in ${dir}`);
        nextCollectionTags.add(rawTag);
      } else {
        for (const canonical of mapped) nextCollectionTags.add(canonical);
      }
    }

    const extras = COLLECTION_EXTRAS[dir] || [];
    for (const extra of extras) {
      nextCollectionTags.add(extra);
    }

    data.tags = sortTagsDa(nextCollectionTags);
    if (data.tags.length === 0) untaggedCollectionsAfter++;

    for (const t of data.tags) {
      canonicalCollectionTagCounts.set(t, (canonicalCollectionTagCounts.get(t) || 0) + 1);
    }

    // 3. Clean captions and populate complete self-contained `tags` array on every image
    for (const img of data.images) {
      totalImagesProcessed++;
      const cleaned = cleanCaption(dir, img);
      if (cleaned !== (img.caption ?? null)) {
        captionsFixed++;
        img.caption = cleaned;
      }

      img.tags = enrichImageTags(dir, data.tags, img);
      if (img.tags.length > data.tags.length) {
        imagesWithExtraTags++;
      }
      for (const t of img.tags) {
        canonicalImageTagCounts.set(t, (canonicalImageTagCounts.get(t) || 0) + 1);
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    updatedById.set(data.id, data);
  }

  // 4. Sync `_index.json`
  if (fs.existsSync(INDEX_PATH)) {
    const indexList = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    for (const entry of indexList) {
      const updated = updatedById.get(entry.id);
      if (updated) {
        entry.tags = updated.tags;
        entry.prefix = updated.prefix;
      }
    }
    fs.writeFileSync(INDEX_PATH, JSON.stringify(indexList, null, 2) + '\n', 'utf8');
  }

  // 5. Print audit summary
  console.log('=== TAG & METADATA ENRICHMENT SUMMARY ===');
  console.log(`Collections processed:          ${dirs.length}`);
  console.log(`Images processed:               ${totalImagesProcessed}`);
  console.log(`Untagged collections (before):  ${untaggedCollectionsBefore}`);
  console.log(`Untagged collections (after):   ${untaggedCollectionsAfter}`);
  console.log(`Raw collection tags (before):   ${rawCollectionTagsBefore.size}`);
  console.log(`Canonical collection tags:      ${canonicalCollectionTagCounts.size}`);
  console.log(`Total distinct image tags:      ${canonicalImageTagCounts.size}`);
  console.log(`Images with image-specific tags:${imagesWithExtraTags} / ${totalImagesProcessed}`);
  console.log(`Prefixes normalized:            ${prefixesNormalized}`);
  console.log(`Captions fixed:                 ${captionsFixed}`);

  const top20ByPhotoCount = [...canonicalImageTagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'da'))
    .slice(0, 20);

  console.log('\n--- TOP 20 TAGS BY PHOTO COUNT (Top 10 appear in Header Nav) ---');
  for (const [i, [tag, count]] of top20ByPhotoCount.entries()) {
    console.log(`${String(i + 1).padStart(2, ' ')}. ${tag.padEnd(26, ' ')} ${count} fotos`);
  }
}

main();
