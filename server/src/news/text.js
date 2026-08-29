/**
 * Plain-text normalization and entity decoding for news content.
 */

const NAMED_ENTITIES = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
  '&mdash;': '—',
  '&ndash;': '–',
  '&ldquo;': '"',
  '&rdquo;': '"',
  '&lsquo;': "'",
  '&rsquo;': "'",
  '&hellip;': '...'
};

/**
 * Decodes standard XML and HTML entities.
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  if (!text || typeof text !== 'string') return '';

  let res = text;

  // Named entities
  for (const [entity, replacement] of Object.entries(NAMED_ENTITIES)) {
    res = res.replaceAll(entity, replacement);
  }

  // Hexadecimal numeric entities e.g. &#x2014;
  res = res.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    try {
      const code = parseInt(hex, 16);
      return String.fromCodePoint(code);
    } catch {
      return '';
    }
  });

  // Decimal numeric entities e.g. &#8217;
  res = res.replace(/&#([0-9]+);/g, (_, dec) => {
    try {
      const code = parseInt(dec, 10);
      return String.fromCodePoint(code);
    } catch {
      return '';
    }
  });

  return res;
}

/**
 * Strips HTML tags, decodes entities, and collapses whitespace into plain text.
 * @param {string} text
 * @returns {string}
 */
export function cleanPlainText(text) {
  if (!text || typeof text !== 'string') return '';

  return decodeEntities(text)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

