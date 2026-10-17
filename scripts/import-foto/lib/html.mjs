import { decode as heDecode } from 'he';
import * as cheerio from 'cheerio';

/** Strip Drupal wrapper noise and convert a field HTML blob to clean markdown-ish plain text paragraphs. */
export function htmlToMarkdown(html) {
  if (!html || !String(html).trim()) return '';
  const $ = cheerio.load(`<div id="root">${html}</div>`, { decodeEntities: true });
  const root = $('#root');

  // Remove empty paragraphs and scripts
  root.find('script, style, iframe').remove();

  // Convert links to markdown
  root.find('a').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    const text = $a.text().trim();
    if (text && href && !href.startsWith('#')) {
      $a.replaceWith(`[${text}](${href})`);
    } else {
      $a.replaceWith(text);
    }
  });

  // Bold / italic
  root.find('strong, b').each((_, el) => {
    const t = $(el).text().trim();
    $(el).replaceWith(t ? `**${t}**` : '');
  });
  root.find('em, i').each((_, el) => {
    const t = $(el).text().trim();
    $(el).replaceWith(t ? `*${t}*` : '');
  });

  const parts = [];
  root.contents().each((_, node) => {
    if (node.type === 'tag') {
      const name = node.name?.toLowerCase();
      if (name === 'p' || name === 'div') {
        const text = cleanText($(node).text());
        if (text) parts.push(text);
      } else if (name === 'h2' || name === 'h3' || name === 'h4') {
        const text = cleanText($(node).text());
        if (text) parts.push(`### ${text}`);
      } else if (name === 'br') {
        // skip
      } else if (name === 'ul' || name === 'ol') {
        $(node)
          .find('li')
          .each((__, li) => {
            const text = cleanText($(li).text());
            if (text) parts.push(`- ${text}`);
          });
      } else {
        const text = cleanText($(node).text());
        if (text) parts.push(text);
      }
    } else if (node.type === 'text') {
      const text = cleanText(node.data);
      if (text) parts.push(text);
    }
  });

  // Deduplicate consecutive identical paragraphs
  const deduped = [];
  for (const p of parts) {
    if (deduped.length && deduped[deduped.length - 1] === p) continue;
    deduped.push(p);
  }
  return deduped.join('\n\n').trim();
}

export function cleanText(s) {
  if (s == null) return '';
  return heDecode(String(s))
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim();
}

export function metaContent($, selector) {
  const el = $(selector).first();
  if (!el.length) return null;
  return el.attr('content') || null;
}

export function fieldText($, fieldName) {
  const sel = `.field-name-${fieldName} .field-item`;
  const items = $(sel);
  if (!items.length) return null;
  // For single-value text fields take first item's text/html
  return items.first();
}

export function fieldHtml($, fieldName) {
  const item = fieldText($, fieldName);
  if (!item || !item.length) return '';
  return item.html() || '';
}

export function fieldPlain($, fieldName) {
  const item = fieldText($, fieldName);
  if (!item || !item.length) return '';
  return cleanText(item.text());
}

export function fieldTerms($, fieldName) {
  const terms = [];
  $(`.field-name-${fieldName} .field-item a, .field-name-${fieldName} .field-item`).each((_, el) => {
    const t = cleanText($(el).text());
    if (t && !terms.includes(t)) terms.push(t);
  });
  return terms;
}

export function parseAuthors(byline) {
  if (!byline) return [];
  let text = cleanText(byline).replace(/^Af\s+/i, '');
  if (!text) return [];
  // Split on " og " and commas
  const parts = text
    .split(/\s+og\s+|,\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts;
}

/** Normalize generic prefix labels we don't want to keep. */
export function normalizePrefix(prefix) {
  if (!prefix) return null;
  const p = cleanText(prefix);
  if (!p) return null;
  const lower = p.toLowerCase();
  if (lower === 'fotoserie' || lower === 'foto') return null;
  return p;
}

const DROP_TAGS = new Set(['foto', 'fotoblog']);

export function normalizeTags(tags) {
  return (tags || []).filter((t) => t && !DROP_TAGS.has(t.toLowerCase()));
}
