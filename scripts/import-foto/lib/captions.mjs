import { decode as heDecode } from 'he';

/**
 * Split a string that may contain "Foto: Name" / "FOTO: NAME" into caption + credit.
 * Handles:
 *   "Foto: Mark Knudsen"
 *   "Morgenmad hos FOA. Foto: Mark Knudsen"
 *   "Lars H.U.G FOTO: ANDERS BIRGER"
 *   "Pharmakon - FOTO: ANDERS BIRGER"
 *   '"Fuck regeringen" Foto: Mette Kramer Kristensen'
 */
export function splitCaptionCredit(raw) {
  if (raw == null) return { caption: null, credit: null };
  let text = heDecode(String(raw)).replace(/\u00a0/g, ' ').trim();
  if (!text) return { caption: null, credit: null };

  // Match trailing Foto:/FOTO: credit (case-insensitive)
  const match = text.match(/^(.*?)(?:^|[\s.\-–—]+)(?:Foto|FOTO)\s*:\s*(.+?)\.?\s*$/i);
  if (match) {
    let caption = match[1].replace(/[\s.\-–—]+$/g, '').trim();
    let credit = match[2].replace(/\.+$/, '').trim();
    // Clean leading/trailing dashes or quotes leftovers on caption
    caption = caption.replace(/^[\s\-–—]+|[\s\-–—]+$/g, '').trim();
    if (!caption) caption = null;
    if (!credit) credit = null;
    return { caption, credit };
  }

  // Credit-only starting with Foto:
  const creditOnly = text.match(/^(?:Foto|FOTO)\s*:\s*(.+?)\.?\s*$/i);
  if (creditOnly) {
    return { caption: null, credit: creditOnly[1].replace(/\.+$/, '').trim() || null };
  }

  return { caption: text, credit: null };
}

/** Normalize photographer credit casing: "ANDERS BIRGER" -> "Anders Birger" when all-caps. */
export function normalizeCredit(credit) {
  if (!credit) return null;
  let c = credit.replace(/\/Monsun$/i, '').trim();
  if (!c) return null;
  // Title-case if entire string is uppercase
  if (c === c.toUpperCase() && /[A-ZÆØÅ]/.test(c)) {
    c = c
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return c;
}

export function isEmptyParagraphText(text) {
  if (text == null) return true;
  const t = heDecode(String(text))
    .replace(/\u00a0/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  return t.length === 0;
}
