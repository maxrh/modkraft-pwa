import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import {
  cleanText,
  fieldHtml,
  fieldPlain,
  fieldTerms,
  htmlToMarkdown,
  metaContent,
  normalizePrefix,
  normalizeTags,
  parseAuthors,
} from './html.mjs';
import { isEmptyParagraphText, normalizeCredit, splitCaptionCredit } from './captions.mjs';

/** True when taxonomy vocabulary marks Redaktion = Foto. */
export function isFotoRedaktion($) {
  const links = $('.field-name-taxonomy-vocabulary-1 a').toArray();
  return links.some((el) => {
    const text = cleanText($(el).text());
    const href = String($(el).attr('href') || '');
    return /^foto$/i.test(text) || /redaktion\/foto/i.test(href);
  });
}

function detectSourceType($) {
  const bodyClass = $('body').attr('class') || '';
  if (bodyClass.includes('node-type-fotoblog') || $('.node-fotoblog').length) return 'fotoblog';
  if (bodyClass.includes('node-type-fotoserie') || $('.node-fotoserie').length) return 'fotoserie';

  // Early Foto gallery artikels: node-type-articles + Redaktion Foto + field_fotoserie
  const isArticles =
    bodyClass.includes('node-type-articles') ||
    $('.node-type-articles').length > 0 ||
    $('.node-articles').length > 0;
  if (
    isArticles &&
    isFotoRedaktion($) &&
    $('.field-name-field-fotoserie img').length > 0
  ) {
    return 'artikel-foto';
  }

  if ($('.field-name-field-fotoserie').length) return 'fotoserie';
  return null;
}

function extractNid($, html) {
  const shortlink = $('link[rel="shortlink"]').attr('href') || '';
  const m = shortlink.match(/\/node\/(\d+)/);
  if (m) return Number(m[1]);
  const about = $('.node').attr('about') || '';
  const m2 = about.match(/node\/(\d+)/);
  if (m2) return Number(m2[1]);
  const bodyClass = $('body').attr('class') || '';
  const m3 = bodyClass.match(/page-node-(\d+)/);
  if (m3) return Number(m3[1]);
  const m4 = html.match(/node\/(\d+)/);
  return m4 ? Number(m4[1]) : null;
}

function extractTitle($) {
  const h1 = cleanText($('h1').first().text());
  if (h1) return h1;
  const og = metaContent($, 'meta[property="og:title"]');
  if (og) return og;
  const dc = metaContent($, 'meta[name="dcterms.title"]');
  if (dc) return dc;
  return cleanText($('title').text().replace(/\s*\|\s*Modkraft\s*$/i, ''));
}

function extractAuthors($) {
  const byline = fieldPlain($, 'node-byline');
  if (byline) return parseAuthors(byline);
  const submitted = cleanText($('.submitted').first().text());
  if (submitted) return parseAuthors(submitted);
  const creator = metaContent($, 'meta[name="dcterms.creator"]');
  if (creator) return parseAuthors(creator);
  return [];
}

function extractDates($) {
  const published =
    metaContent($, 'meta[property="article:published_time"]') ||
    metaContent($, 'meta[name="dcterms.date"]') ||
    $('span[property="dc:date"]').attr('content') ||
    null;
  const modified =
    metaContent($, 'meta[property="article:modified_time"]') ||
    metaContent($, 'meta[property="og:updated_time"]') ||
    null;
  return { publishedAt: published, modifiedAt: modified };
}

/**
 * Parse fotoserie images from field_fotoserie (Pattern 1).
 */
function parseFotoserieImages($) {
  const images = [];
  $('.field-name-field-fotoserie .field-item img').each((i, el) => {
    const $img = $(el);
    const src = $img.attr('src') || '';
    const title = $img.attr('title') || '';
    const alt = $img.attr('alt') || '';
    const width = Number($img.attr('width')) || null;
    const height = Number($img.attr('height')) || null;

    const split = splitCaptionCredit(title || alt);
    images.push({
      sortOrder: i + 1,
      src,
      width,
      height,
      credit: normalizeCredit(split.credit),
      caption: split.caption,
      captionSource: title || alt ? 'title' : 'none',
      titleOriginal: title || null,
      altOriginal: alt || null,
    });
  });
  return images;
}

/**
 * Parse fotoblog body: intro paragraphs + interleaved images (Patterns 2 & 3).
 */
function parseFotoblogBody($, defaultCredit) {
  const bodyHtml = fieldHtml($, 'body');
  const $body = cheerio.load(`<div id="body">${bodyHtml}</div>`, { decodeEntities: true });
  const children = $body('#body').children().toArray();

  const introParts = [];
  const images = [];
  let seenImage = false;
  let sortOrder = 0;

  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    const $el = $body(el);
    const tag = el.name?.toLowerCase();
    if (tag !== 'p' && tag !== 'div') {
      if (!seenImage) {
        const t = cleanText($el.text());
        if (t) introParts.push($el.html() || t);
      }
      continue;
    }

    const img = $el.find('img').first();
    if (img.length) {
      seenImage = true;
      sortOrder += 1;
      const src = img.attr('src') || '';
      const title = img.attr('title') || '';
      const alt = img.attr('alt') || '';
      const width = Number(img.attr('width')) || null;
      const height = Number(img.attr('height')) || null;

      // Find next non-empty sibling <p> before next <p> containing <img>
      let captionRaw = null;
      let captionSource = 'none';
      for (let j = i + 1; j < children.length; j++) {
        const next = children[j];
        if (next.name?.toLowerCase() !== 'p') continue;
        const $next = $body(next);
        if ($next.find('img').length) break; // next image — stop
        const text = $next.text();
        if (isEmptyParagraphText(text)) continue;
        captionRaw = text;
        captionSource = 'sibling-p';
        break;
      }

      // Credit from title/alt, or from sibling caption line (Pattern 3)
      let credit = null;
      let caption = null;

      const fromTitle = splitCaptionCredit(title || alt);
      if (fromTitle.credit || fromTitle.caption) {
        credit = fromTitle.credit;
        // title usually credit-only for Syrien; ignore title caption if sibling exists
        if (!captionRaw) caption = fromTitle.caption;
      }

      if (captionRaw) {
        const fromSibling = splitCaptionCredit(captionRaw);
        if (fromSibling.credit) {
          credit = credit || fromSibling.credit;
          caption = fromSibling.caption;
        } else {
          caption = fromSibling.caption;
        }
      }

      if (!credit && defaultCredit) credit = defaultCredit;

      images.push({
        sortOrder,
        src,
        width,
        height,
        credit: normalizeCredit(credit),
        caption,
        captionSource: caption ? captionSource : credit && (title || alt) ? 'title' : 'none',
        titleOriginal: title || null,
        altOriginal: alt || null,
      });
      continue;
    }

    // Non-image paragraph
    if (!seenImage) {
      const html = $el.html() || '';
      const text = cleanText($el.text());
      if (text) introParts.push(html);
    }
  }

  const introHtml = introParts.map((p) => `<p>${p}</p>`).join('');
  return { introHtml, images };
}

/**
 * Parse a single node HTML file into a structured collection draft (before image copy).
 */
export function parseNodeFile(filePath, siteRoot) {
  const html = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(html, { decodeEntities: true });

  const sourceType = detectSourceType($);
  if (!sourceType) return null;

  // Skip listing / hub pages that aren't actual nodes
  if (!$('.node').length && !html.includes('node-type-')) return null;

  const nid = extractNid($, html);
  const title = extractTitle($);
  const { publishedAt, modifiedAt } = extractDates($);
  const authors = extractAuthors($);
  const prefix = normalizePrefix(fieldPlain($, 'field-prefix'));
  const manchetHtml = fieldHtml($, 'field-manchet');
  const manchet = htmlToMarkdown(manchetHtml) || cleanText(fieldPlain($, 'field-manchet')) || null;
  const tags = normalizeTags(fieldTerms($, 'field-emneord'));
  const genre = fieldPlain($, 'field-genre') || null;

  const relPath = path.relative(siteRoot, filePath).replace(/\\/g, '/');

  let introMarkdown = '';
  let images = [];

  if (sourceType === 'fotoserie' || sourceType === 'artikel-foto') {
    const bodyHtml = fieldHtml($, 'body');
    introMarkdown = htmlToMarkdown(bodyHtml);
    images = parseFotoserieImages($);
  } else {
    const defaultCredit = authors[0] || null;
    const { introHtml, images: imgs } = parseFotoblogBody($, defaultCredit);
    introMarkdown = htmlToMarkdown(introHtml);
    images = imgs;

    // Pattern 4: dedupe manchet duplicated as first intro paragraph
    if (manchet && introMarkdown) {
      const firstPara = introMarkdown.split(/\n\n/)[0]?.trim();
      if (firstPara && firstPara === manchet.trim()) {
        introMarkdown = introMarkdown.slice(firstPara.length).replace(/^\n\n/, '').trim();
      }
    }
  }

  // Series key for Syrien posts
  let series = null;
  if (
    sourceType === 'fotoblog' &&
    (relPath.includes('/syrien/') ||
      relPath.includes('/Syrien/') ||
      (prefix && /syrien/i.test(prefix)) ||
      tags.some((t) => t.toLowerCase() === 'syrien'))
  ) {
    // Roskilde is tagged differently; only assign series for Syrien prefix/path
    if (
      relPath.toLowerCase().includes('syrien') ||
      (prefix && /nødhjælp|noedhjaelp|syrien/i.test(prefix))
    ) {
      series = 'noedhjaelp-til-syrien';
    }
  }

  return {
    sourceNid: nid,
    sourceType,
    sourcePath: relPath,
    title,
    publishedAt,
    modifiedAt,
    authors,
    prefix,
    series,
    manchet: manchet || null,
    introMarkdown: introMarkdown || '',
    tags,
    genre,
    images,
  };
}

/**
 * Parse the Syrien hub page for series metadata.
 */
export function parseSyrienHub(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const html = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(html, { decodeEntities: true });

  const topIntro = cleanText($('.fotoblogtop p').last().text());
  const infoBox = $('.fotoblog_infobox_tekst');
  let aboutSeries = '';
  let aboutViomis = '';
  let aboutAuthor = '';

  if (infoBox.length) {
    let section = 'intro';
    const introParas = [];
    const viomisParas = [];
    const authorParas = [];

    infoBox.children().each((_, node) => {
      const $n = $(node);
      const name = node.name?.toLowerCase();
      if (name === 'h4') {
        const t = cleanText($n.text());
        if (/viomis/i.test(t)) section = 'viomis';
        else if (/anders/i.test(t)) section = 'author';
        else section = 'other';
        return;
      }
      if (name !== 'p') return;
      // Preserve links as markdown
      const clone = $n.clone();
      clone.find('a').each((__, a) => {
        const $a = $(a);
        const href = $a.attr('href') || '';
        const text = cleanText($a.text());
        $a.replaceWith(text && href ? `[${text}](${href})` : text);
      });
      // Split on <br> into separate paragraphs
      const html = clone.html() || '';
      const chunks = html
        .split(/<br\s*\/?>/i)
        .map((chunk) => cleanText(cheerio.load(`<div>${chunk}</div>`)('div').text()))
        .filter(Boolean);
      for (const chunk of chunks) {
        if (section === 'intro') introParas.push(chunk);
        else if (section === 'viomis') viomisParas.push(chunk);
        else if (section === 'author') authorParas.push(chunk);
      }
    });
    aboutSeries = introParas.join('\n\n');
    aboutViomis = viomisParas.join('\n\n');
    aboutAuthor = authorParas.join('\n\n');
  }

  return {
    id: 'noedhjaelp-til-syrien',
    title: 'Nødhjælp til Syrien',
    author: 'Anders Birger',
    intro: topIntro || aboutSeries || null,
    aboutSeries: aboutSeries || null,
    aboutViomis: aboutViomis || null,
    aboutAuthor: aboutAuthor || null,
    sourcePath: path.basename(path.dirname(filePath)) === 'fotoblog'
      ? 'foto/fotoblog/syrien.html'
      : 'foto/fotoblog/syrien.html',
  };
}

/**
 * Discover all node HTML files under the site root.
 */
export function discoverNodeFiles(siteRoot) {
  const results = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        // Skip noise
        if (
          ent.name === 'hts-cache' ||
          ent.name === 'styles' ||
          ent.name === 'twitter.com' ||
          ent.name === 'www.facebook.com' ||
          ent.name === '~hts-tmp' ||
          ent.name === 'node_modules'
        ) {
          continue;
        }
        walk(full);
      } else if (ent.isFile() && ent.name.endsWith('.html')) {
        // Skip compressed leftovers
        if (ent.name.endsWith('.html.z')) continue;
        results.push(full);
      }
    }
  }

  walk(siteRoot);
  return results;
}
