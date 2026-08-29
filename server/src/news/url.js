/**
 * URL normalization and security validation for news articles.
 */

const STRIPPED_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_source_platform',
  'utm_creative_format',
  'utm_marketing_tactic',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid'
]);

/**
 * Validates and normalizes an article URL.
 * Rejects non-http(s) schemes and credential-bearing URLs.
 * Strips tracking parameters and sorts semantic query parameters deterministically.
 * @param {string} rawUrl
 * @returns {string|null} Normalized URL or null if invalid/rejected
 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);

    // 1. Allowed protocols: http and https only
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    // 2. Reject credential-bearing URLs
    if (parsed.username || parsed.password) {
      return null;
    }

    // 3. Lowercase scheme and host
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();

    // 4. Remove default ports
    if ((parsed.protocol === 'http:' && parsed.port === '80') ||
        (parsed.protocol === 'https:' && parsed.port === '443')) {
      parsed.port = '';
    }

    // 5. Remove URL fragment
    parsed.hash = '';

    // 6. Strip tracking params and preserve semantic params
    const keptParams = [];
    for (const [key, value] of parsed.searchParams.entries()) {
      const lowerKey = key.toLowerCase();
      if (!STRIPPED_PARAMS.has(lowerKey) && !lowerKey.startsWith('utm_')) {
        keptParams.push([key, value]);
      }
    }

    // 7. Sort retained query params deterministically by key, then value
    keptParams.sort((a, b) => {
      const cmp = a[0].localeCompare(b[0]);
      if (cmp !== 0) return cmp;
      return a[1].localeCompare(b[1]);
    });

    parsed.search = '';
    for (const [k, v] of keptParams) {
      parsed.searchParams.append(k, v);
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

