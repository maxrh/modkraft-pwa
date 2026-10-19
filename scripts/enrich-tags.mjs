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
  '4. maj': ['4. maj'],
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
  asylaktivisme: ['Asyl', 'Aktivisme'],
  asylansøgere: ['Asyl', 'Flygtninge'],
  asylpolitik: ['Asyl'],
  'bekæmp fattigdom nu': ['Velfærd', 'Socialt'],
  'Berlin Fristeder': ['Berlin', 'Fristeder', 'BZ'],
  'berlin muren': ['Berlinmuren', 'Berlin'],
  'bike wars': ['Bike Wars'],
  blokade: ['Blokade'],
  byhave: ['Byhave 69', 'Jagtvej 69'],
  'byhave 69': ['Byhave 69', 'Jagtvej 69'],
  byhave69: ['Byhave 69', 'Jagtvej 69'],
  bz: ['BZ', 'Fristeder'],
  Bøger: ['Bøger'],
  børnemagt: ['Børnemagt'],
  cairo: ['Cairo'],
  ceta: ['CETA'],
  Christiania: ['Christiania'],
  COP21: ['COP21', 'Klima'],
  demo: ['Demonstration'],
  Demonstration: ['Demonstration'],
  demonstrationer: ['Demonstration'],
  'den blå planet': ['Den Blå Planet'],
  Denonstration: ['Demonstration'],
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
  hjemløsedagen: ['Hjemløse'],
  humaniora: ['Uddannelse'],
  'hus forbi': ['Hus Forbi'],
  'imod sexkøb': ['Kvindekamp', 'Feminisme'],
  Internet: ['Digital aktivisme'],
  istanbul: ['Istanbul'],
  'jagtvej 155B': ['BZ', 'Nørrebro'],
  'Jagtvej 69': ['Jagtvej 69'],
  'k-town': ['K-Town', 'Punk'],
  kalender: [],
  klimademo: ['Klima', 'Demonstration'],
  klimamarch: ['Klima', 'Demonstration'],
  koncert: ['Koncert', 'Musik'],
  Kultur: ['Kultur'],
  Kurdere: ['Kurdistan'],
  kvindekamp: ['Kvindekamp'],
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
  ligeløn: ['Ligeløn'],
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
  pegida: ['Pegida'],
  politibrutalitet: ['Politivold'],
  politivold: ['Politivold'],
  Pumpehuset: ['Pumpehuset'],
  punk: ['Punk', 'Musik'],
  'racismefri by': ['Racismefri By', 'Antiracisme'],
  'refugees welcome': ['Refugees Welcome', 'Flygtninge'],
  refugeeswelcome: ['Refugees Welcome', 'Flygtninge'],
  rf14: ['Roskilde Festival', 'Koncert', 'Musik'],
  rf15: ['Roskilde Festival', 'Koncert', 'Musik'],
  romaer: ['Romaer'],
  Roskilde: ['Roskilde Festival'],
  'Roskilde Festival': ['Roskilde Festival', 'Koncert', 'Musik'],
  'roskilde festival 2013': ['Roskilde Festival', 'Koncert', 'Musik'],
  'Roskilde Festival 2014': ['Roskilde Festival', 'Koncert', 'Musik'],
  'Roskilde Festival 2015': ['Roskilde Festival', 'Koncert', 'Musik'],
  rydning: ['Rydning'],
  rødby: ['Rødby'],
  's-sf-r-regering': ['Regeringen'],
  sandholmlejren: ['Sandholmlejren'],
  'sjælsmark lejren': ['Sjælsmark'],
  ska: ['Ska', 'Musik'],
  skifergas: ['Skifergas', 'Klima'],
  Socialt: ['Socialt', 'Velfærd'],
  'Spids Nøgenhat': ['Spids Nøgenhat'],
  studenterbevægelse: ['Studerende', 'Uddannelse'],
  studerende: ['Studerende', 'Uddannelse'],
  støttefest: ['Fest', 'Kultur'],
  SU: ['SU', 'Uddannelse'],
  syrien: ['Syrien'],
  taginternettettilbage: ['Digital aktivisme'],
  'the wall': ['Berlinmuren', 'Berlin'],
  thedaywefightback: ['Digital aktivisme'],
  torussiawithlove: ['LGBT+', 'Rusland'],
  TTIP: ['TTIP'],
  Tyrkiet: ['Tyrkiet'],
  Uddannelse: ['Uddannelse'],
  Ungdomshuset: ['Ungdomshuset'],
  ungeren: ['Ungdomshuset'],
  velfærd: ['Velfærd'],
  venstrefløj: ['Venstrefløj'],
  vm14: ['Fodbold'],
  årsdag: ['1. marts'],
};

/**
 * Curated collection-level canonical tag additions per collection ID.
 * Ensures every collection (especially the 24 previously untagged ones) has complete, accurate topical tags.
 */
const COLLECTION_EXTRAS = {
  '2012-11-28-ataturk-lufthavn': ['Syrien', 'Nødhjælp', 'Tyrkiet', 'Istanbul', 'VIOMIS'],
  '2012-11-29-istanbul-er-en-foelelse-et-indtryk-og-et-afsaet-videre': [
    'Syrien',
    'Nødhjælp',
    'Tyrkiet',
    'Istanbul',
  ],
  '2012-12-02-moedet-med-de-syriske-flygtninge': [
    'Syrien',
    'Nødhjælp',
    'Flygtninge',
    'Tyrkiet',
  ],
  '2012-12-06-bomber-i-det-fjerne': ['Syrien', 'Nødhjælp', 'Flygtninge', 'Tyrkiet'],
  '2012-12-10-livet-aendrer-sig-paa-et-splitsekund': [
    'Syrien',
    'Nødhjælp',
    'Flygtninge',
    'Aleppo',
    'Den Frie Syriske Hær',
  ],
  '2012-12-11-til-te-med-oproeret': [
    'Syrien',
    'Nødhjælp',
    'Flygtninge',
    'Tyrkiet',
    'Den Frie Syriske Hær',
  ],
  '2013-01-22-antifascistisk-solidaritet-med-graekenland': [
    'Grækenland',
    'Antifascisme',
    'Demonstration',
    'Solidaritet',
  ],
  '2013-02-05-die-mauer': ['Berlinmuren', 'Berlin', 'Historie'],
  '2013-02-19-ska-bash-i-ungdomshuset': ['Ungdomshuset', 'Koncert', 'Musik', 'Ska'],
  '2013-02-24-antifascister-mod-siad': [
    'Antifascisme',
    'Antiracisme',
    'Demonstration',
    'Antifascistisk Aktion',
    'København',
  ],
  '2013-03-01-hoejt-humoer-under-su-protester': [
    'SU',
    'Studerende',
    'Uddannelse',
    'Demonstration',
  ],
  '2013-03-04-seks-aar-efter': [
    'Jagtvej 69',
    'Ungdomshuset',
    '1. marts',
    'Demonstration',
    'Nørrebro',
  ],
  '2013-03-11-8-marts': ['8. marts', 'Kvindekamp', 'Feminisme', 'Ligeløn', 'Demonstration'],
  '2013-03-20-laererne-er-de-foerste-hvem-bliver-de-naeste': [
    'Lockout',
    'Fagbevægelse',
    'Uddannelse',
    'Demonstration',
  ],
  '2013-04-09-protest-mod-lockout': [
    'Lockout',
    'Fagbevægelse',
    'Uddannelse',
    'Demonstration',
    'København',
  ],
  '2013-04-15-laererlockout-uge-2': [
    'Lockout',
    'Fagbevægelse',
    'Uddannelse',
    'Demonstration',
    'København',
  ],
  '2013-05-02-1-maj-2013-faner-er-roede-helle-er': [
    '1. maj',
    'Fagbevægelse',
    'Demonstration',
    'Fælledparken',
    'København',
  ],
  '2013-05-06-her-er-plads-stop-udvisningerne-til-afghanistan': [
    'Asyl',
    'Flygtninge',
    'Afghanistan',
    'Demonstration',
    'Aktivisme',
  ],
  '2013-05-08-pausefisk': ['Akvarium', 'Den Blå Planet', 'Natur'],
  '2013-05-13-jagtvej-demo-besaettelse-og-rydning': [
    'BZ',
    'Fristeder',
    'Rydning',
    'Demonstration',
    'Nørrebro',
  ],
  '2013-05-30-moskemodstandere-moeder-modstand': [
    'Antifascisme',
    'Antiracisme',
    'Demonstration',
    'Rådhuspladsen',
    'København',
  ],
  '2013-06-06-hjemloese-fejrer-grundlovsdag': ['Hjemløse', 'Grundlovsdag', 'Socialt'],
  '2013-06-14-valentina-tereshkova': ['Valentina Tereshkova', 'Historie', 'Kvindekamp'],
  '2013-07-01-tilbage-paa-tahrir': ['Egypten', 'Cairo', 'Tahrir', 'Demonstration'],
  '2013-07-03-opvarming-roskilde-festival-2013': [
    'Roskilde Festival',
    'Koncert',
    'Musik',
    'Kultur',
  ],
  '2013-08-21-to-russia-with-love': ['LGBT+', 'Rusland', 'Demonstration', 'Solidaritet'],
  '2013-08-26-gadefest-mod-vold-trusler-og-boeller': [
    'Hjemløse',
    'Hus Forbi',
    'Socialt',
    'Fest',
  ],
  '2013-09-19-punx-picnic': ['Punk', 'K-Town', 'Koncert', 'Musik', 'Ungdomshuset'],
  '2013-10-01-folketinget-aabner': [
    'Folketingets åbning',
    'Christiansborg',
    'Demonstration',
    'Fagbevægelse',
  ],
  '2013-11-18-aktion-69': [
    'Jagtvej 69',
    'Ungdomshuset',
    'Aktivisme',
    'Demonstration',
    'Nørrebro',
  ],
  '2013-11-27-studenterprotester-mod-fremdriftsreform-paa-universiteterne': [
    'Studerende',
    'Uddannelse',
    'Demonstration',
    'Københavns Universitet',
  ],
  '2013-12-02-baalfest-paa-jagtvej-69': [
    'Jagtvej 69',
    'Ungdomshuset',
    'Nørrebro',
    'Aktivisme',
  ],
  '2013-12-19-hjemloese-er-hundens-bedste-ven': ['Hjemløse', 'Hus Forbi', 'Socialt'],
  '2014-01-29-ding-dong-dynamodemo': [
    'DONG Energy',
    'Goldman Sachs',
    'Demonstration',
    'Aktivisme',
  ],
  '2014-02-01-vi-vil-huske-dong-salget': [
    'DONG Energy',
    'Goldman Sachs',
    'Demonstration',
    'Socialdemokraterne',
    'Nørrebro',
  ],
  '2014-02-04-ministerrokade': ['Regeringen', 'Christiansborg', 'SF', 'Socialdemokraterne', 'Radikale Venstre'],
  '2014-02-12-tag-internettet-tilbage': ['Digital aktivisme', 'Demonstration', 'Aktivisme'],
  '2014-03-03-1-marts-vores-kampdag': [
    'Jagtvej 69',
    'Ungdomshuset',
    '1. marts',
    'Rydning',
    'Demonstration',
  ],
  '2014-03-10-kvindekampdag-2014-tag-natten-tilbage-kraev-respekt-forbyd-sexkoeb': [
    '8. marts',
    'Kvindekamp',
    'Feminisme',
    'Demonstration',
    'Nørrebro',
  ],
  '2014-03-17-kampa-malmo': ['Malmø', 'Antifascisme', 'Demonstration', 'Solidaritet'],
  '2014-03-17-protest-mod-politibrutalitet': ['Politivold', 'Demonstration', 'København'],
  '2014-03-17-rote-flora': [
    'Rote Flora',
    'Fristeder',
    'BZ',
    'Ungdomshuset',
    'Nørrebro',
    'Demonstration',
  ],
  '2014-03-21-newroz-piroz-be': ['Newroz', 'Kurdistan', 'Kultur', 'Rådhuspladsen', 'Christiansborg'],
  '2014-03-24-racismefri-by': [
    'Racismefri By',
    'Antiracisme',
    'Demonstration',
    'Vesterbro',
    'Sydhavnen',
  ],
  '2014-04-21-aktion-paa-christiania': ['Christiania', 'Aktivisme', 'Fristeder', 'København'],
  '2014-04-23-eu-foer-lukketid': ['EU', 'Strasbourg', 'Folkebevægelsen mod EU'],
  '2014-05-02-1-maj-fotokavalkade-2014': [
    '1. maj',
    'Fagbevægelse',
    'Demonstration',
    'Fælledparken',
    'København',
  ],
  '2014-05-05-byhave-69': ['Byhave 69', 'Jagtvej 69', 'Nørrebro', 'Aktivisme', 'Fristeder'],
  '2014-05-12-racismefri-by': ['Racismefri By', 'Antiracisme', 'Antifascisme', 'Demonstration'],
  '2014-06-10-grundlovsdag-paa-christiania': ['Christiania', 'Grundlovsdag', 'Fristeder', 'Kultur'],
  '2014-06-20-nordvest-hyldes-i-ny-bog-om-det-vilde-og-kaotiske-gadeliv': [
    'Nordvest',
    'København',
    'Kultur',
    'Bøger',
  ],
  '2014-06-27-elsker-fodbold-hader-fifa': ['Fodbold', 'FIFA', 'Demonstration', 'Aktivisme'],
  '2014-07-05-roskilde-festival-koncertfotos': [
    'Roskilde Festival',
    'Koncert',
    'Musik',
    'Kultur',
  ],
  '2014-09-17-modkraft-fester': ['Modkraft', 'Fest', 'Kultur'],
  '2014-10-01-solidaritet-med-kobane-og-rojava': [
    'Kobane',
    'Rojava',
    'Kurdistan',
    'Syrien',
    'Demonstration',
    'Solidaritet',
    'Christiansborg',
  ],
  '2014-10-08-folketinget-aabner': [
    'Folketingets åbning',
    'Christiansborg',
    'Demonstration',
    'Velfærd',
  ],
  '2014-12-09-hjemloese-og-hjaelpemidler': ['Hjemløse', 'Hus Forbi', 'Socialt'],
  '2015-01-20-for-og-imod-pegida': ['Pegida', 'Antiracisme', 'Demonstration', 'København'],
  '2015-01-27-koebenhavn-for-mangfoldighed': [
    'København for Mangfoldighed',
    'Pegida',
    'Antiracisme',
    'Demonstration',
    'København',
  ],
  '2015-03-02-8-aars-demo-intet-glemt-intet-tilgivet': [
    'Jagtvej 69',
    'Ungdomshuset',
    '1. marts',
    'Rydning',
    'Demonstration',
    'Nørrebro',
  ],
  '2015-03-12-8-marts-2015': [
    '8. marts',
    'Kvindekamp',
    'Feminisme',
    'SUF',
    'Demonstration',
    'København',
  ],
  '2015-04-07-skifergasprotester-i-nordjylland': [
    'Skifergas',
    'Klima',
    'Blokade',
    'Aktivisme',
  ],
  '2015-05-05-foraar-fest-og-1-maj': [
    '1. maj',
    'Fagbevægelse',
    'Demonstration',
    'Antifascisme',
    'København',
  ],
  '2015-06-19-valgfester': ['Folketingsvalg', 'Venstrefløj', 'Enhedslisten', 'Christiansborg'],
  '2015-06-30-punx-picnic': ['Punk', 'K-Town', 'Bike Wars', 'Ungdomshuset', 'Kultur'],
  '2015-07-02-roskilde-2015-skudt-i-gang': ['Roskilde Festival', 'Koncert', 'Musik', 'Kultur'],
  '2015-07-04-roskilde-vibrerer': ['Roskilde Festival', 'Koncert', 'Musik', 'Kultur'],
  '2015-09-08-flygtninge-i-roedby-havn': ['Flygtninge', 'Asyl', 'Rødby', 'Syrien'],
  '2015-09-14-refugeeswelcome': [
    'Refugees Welcome',
    'Flygtninge',
    'Asyl',
    'Demonstration',
    'Christiansborg',
  ],
  '2015-09-25-demonstration-stop-undertrykkelsen-af-kurderne-i-tyrkiet': [
    'Kurdistan',
    'Tyrkiet',
    'Demonstration',
    'Solidaritet',
    'Christiansborg',
  ],
  '2015-10-03-spids-noegenhat-i-pumpehuset': [
    'Spids Nøgenhat',
    'Pumpehuset',
    'Koncert',
    'Musik',
  ],
  '2015-10-07-folkevandring-samlede-20-000-deltagere': [
    'Refugees Welcome',
    'Flygtninge',
    'Asyl',
    'Demonstration',
    'København',
  ],
  '2015-10-22-hjemloesedagen-2015': ['Hjemløse', 'Socialt', 'Velfærd'],
  '2015-10-30-stop-milliardnedskaeringer-paa-uddannelse': [
    'Uddannelse',
    'Nedskæringer',
    'Studerende',
    'Demonstration',
  ],
  '2015-11-04-sidste-nat-i-roma-lejren': ['Romaer', 'Malmø', 'Hjemløse', 'Rydning', 'Socialt'],
  '2015-12-01-mangfoldig-klimamarch-i-koebenhavn': [
    'Klima',
    'COP21',
    'Demonstration',
    'København',
  ],
  '2016-01-09-aktion-mod-id-kontrol': [
    'Flygtninge',
    'Asyl',
    'Aktivisme',
    'Demonstration',
    'København',
  ],
  '2016-01-27-close-sjaelsmark': [
    'Sjælsmark',
    'Sandholmlejren',
    'Asyl',
    'Flygtninge',
    'Demonstration',
  ],
  '2016-02-03-boernemagt-i-ungdomshuset': [
    'Ungdomshuset',
    'Punk',
    'Koncert',
    'Musik',
    'Børnemagt',
  ],
  '2016-02-05-demonstrationer-i-aarhus-odense-og-koebenhavn-udsatte-kraever-respekt-og-vaerdighed-til-alle': [
    'Velfærd',
    'Socialt',
    'Demonstration',
    'Aktivisme',
    'København',
    'Aarhus',
    'Odense',
  ],
  '2016-03-08-kvindernes-internationale-kampdag-i-seks-aar': [
    '8. marts',
    'Kvindekamp',
    'Feminisme',
    'Demonstration',
  ],
  '2016-03-08-vanessa': ['Kultur', 'Portræt'],
  '2016-03-09-demonstration-mod-sexkoeb': [
    '8. marts',
    'Kvindekamp',
    'Feminisme',
    'Demonstration',
  ],
  '2016-03-10-aktivister-paa-gaden-for-at-stoette-rydningstruede-fristeder-i-berlin': [
    'Berlin',
    'Fristeder',
    'BZ',
    'Solidaritet',
    'Demonstration',
  ],
  '2016-03-11-demonstration-mod-milliardbesparelser-i-kommunerne': [
    'Nedskæringer',
    'Velfærd',
    'Fagbevægelse',
    'Demonstration',
    'København',
  ],
  '2016-05-03-1-maj-2016': [
    '1. maj',
    'Fagbevægelse',
    'Demonstration',
    'Antifascisme',
    'København',
  ],
  '2016-05-05-markering-af-danmarks-befrielse': [
    '4. maj',
    'Antifascisme',
    'Antiracisme',
    'Vesterbro',
    'København',
  ],
  '2016-10-10-ja-til-velfaerd-nej-til-fattigdom': [
    'Velfærd',
    'Nedskæringer',
    'Socialt',
    'Demonstration',
  ],
  '2016-10-14-kaempe-protest-mod-su-nedskaeringer': [
    'SU',
    'Uddannelse',
    'Studerende',
    'Nedskæringer',
    'Demonstration',
  ],
  '2016-10-28-stop-ttip-og-ceta': ['TTIP', 'CETA', 'EU', 'Demonstration'],
  '2016-11-16-blokade-mod-lukning-af-biblioteker-paa-ku-studerende-frygter-for-faerre-boeger-og-laesepladser': [
    'Københavns Universitet',
    'Studerende',
    'Uddannelse',
    'Blokade',
    'Aktivisme',
  ],
  '2016-11-29-aleida-guevara': ['Aleida Guevara', 'Cuba', 'Solidaritet', 'Nørrebro'],
  '2016-12-05-islamkritikere-gik-gennem-noerrebro-med-hjaelp-fra-politiet': [
    'For Frihed',
    'Pegida',
    'Antiracisme',
    'Antifascisme',
    'Nørrebro',
    'Demonstration',
  ],
  '2016-12-16-save-aleppo': [
    'Aleppo',
    'Syrien',
    'Demonstration',
    'Solidaritet',
    'Christiansborg',
  ],
  '2016-12-19-stop-politivold': ['Politivold', 'Demonstration', 'Aktivisme'],
  '2017-01-09-to-aar-med-protester-mod-for-frihed': [
    'For Frihed',
    'Pegida',
    'Antiracisme',
    'Antifascisme',
    'Demonstration',
  ],
  '2017-01-10-aktion-mod-dagpengeregler': [
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
      '2016-02-05-demonstrationer-i-aarhus-odense-og-koebenhavn-udsatte-kraever-respekt-og-vaerdighed-til-alle' &&
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
  if (collectionId === '2016-02-03-boernemagt-i-ungdomshuset' && img.caption === 'Lig') {
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
      const mapped = TAG_MAP[rawTag];
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
