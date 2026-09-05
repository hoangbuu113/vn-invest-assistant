export const SOURCE_FAMILIES = Object.freeze({
  OFFICIAL_SBV: 'OFFICIAL_SBV',
  OFFICIAL_NSO: 'OFFICIAL_NSO',
  OFFICIAL_CUSTOMS: 'OFFICIAL_CUSTOMS',
  ISSUER_IR: 'ISSUER_IR',
  CAFEF: 'CAFEF',
  COINDESK: 'COINDESK',
  ALPHA_VANTAGE: 'ALPHA_VANTAGE',
  REUTERS: 'REUTERS',
  SECONDARY_REPUBLISHER: 'SECONDARY_REPUBLISHER',
  UNKNOWN: 'UNKNOWN'
});

const INDEPENDENT_PRIMARY_FAMILIES = new Set([
  SOURCE_FAMILIES.OFFICIAL_SBV,
  SOURCE_FAMILIES.OFFICIAL_NSO,
  SOURCE_FAMILIES.OFFICIAL_CUSTOMS,
  SOURCE_FAMILIES.ISSUER_IR,
  SOURCE_FAMILIES.CAFEF,
  SOURCE_FAMILIES.COINDESK,
  SOURCE_FAMILIES.ALPHA_VANTAGE,
  SOURCE_FAMILIES.REUTERS
]);

function normalizeText(val) {
  return typeof val === 'string' ? val.trim().toLowerCase() : '';
}

function extractHostname(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Detects syndication or attribution in title or excerpt (e.g. "Theo CafeF", "Nguồn: CafeF").
 */
export function detectSyndicatedOrigin(text = '') {
  const norm = normalizeText(text);
  if (!norm) return null;

  if (/(?:theo|nguồn[:\s]+|trích từ[:\s]+)\s*(?:cafef|cafebiz)/i.test(norm)) {
    return SOURCE_FAMILIES.CAFEF;
  }
  if (/(?:theo|nguồn[:\s]+|trích từ[:\s]+)\s*(?:reuters)/i.test(norm)) {
    return SOURCE_FAMILIES.REUTERS;
  }
  if (/(?:theo|nguồn[:\s]+|trích từ[:\s]+)\s*(?:coindesk)/i.test(norm)) {
    return SOURCE_FAMILIES.COINDESK;
  }
  if (/(?:theo|nguồn[:\s]+|trích từ[:\s]+)\s*(?:sbv|ngân hàng nhà nước)/i.test(norm)) {
    return SOURCE_FAMILIES.OFFICIAL_SBV;
  }
  if (/(?:theo|nguồn[:\s]+|trích từ[:\s]+)\s*(?:gso|tổng cục thống kê|cục thống kê)/i.test(norm)) {
    return SOURCE_FAMILIES.OFFICIAL_NSO;
  }
  if (/(?:theo|nguồn[:\s]+|trích từ[:\s]+)\s*(?:hải quan|tổng cục hải quan)/i.test(norm)) {
    return SOURCE_FAMILIES.OFFICIAL_CUSTOMS;
  }
  return null;
}

/**
 * Classifies an evidence source into a deterministic source family.
 */
export function classifySourceFamily({
  url = '',
  sourceId = '',
  publisher = '',
  title = '',
  summary = '',
  text = ''
} = {}) {
  const host = extractHostname(url);
  const normSourceId = normalizeText(sourceId);
  const normPub = normalizeText(publisher);
  const combinedNarrative = `${title} ${summary} ${text}`;

  // 1. Official Vietnam State Bank
  if (
    host.includes('sbv.gov.vn') ||
    normSourceId.includes('sbv') ||
    normPub.includes('ngân hàng nhà nước') ||
    normPub.includes('state bank of vietnam')
  ) {
    return SOURCE_FAMILIES.OFFICIAL_SBV;
  }

  // 2. Official National Statistics Office (GSO / NSO)
  if (
    host.includes('gso.gov.vn') ||
    normSourceId.includes('gso') ||
    normSourceId.includes('nso') ||
    normPub.includes('tổng cục thống kê') ||
    normPub.includes('general statistics office')
  ) {
    return SOURCE_FAMILIES.OFFICIAL_NSO;
  }

  // 3. Official Vietnam Customs
  if (
    host.includes('customs.gov.vn') ||
    normSourceId.includes('customs') ||
    normPub.includes('hải quan') ||
    normPub.includes('vietnam customs')
  ) {
    return SOURCE_FAMILIES.OFFICIAL_CUSTOMS;
  }

  // 4. Issuer IR disclosures
  if (
    normSourceId.includes('issuer') ||
    normSourceId.includes('corporate_ir') ||
    normPub.includes('quan hệ cổ đông') ||
    normPub.includes('investor relations')
  ) {
    return SOURCE_FAMILIES.ISSUER_IR;
  }

  // 5. CafeF
  if (
    host.includes('cafef.vn') ||
    normSourceId === 'cafef' ||
    normPub === 'cafef'
  ) {
    return SOURCE_FAMILIES.CAFEF;
  }

  // 6. CoinDesk
  if (
    host.includes('coindesk.com') ||
    normSourceId === 'coindesk' ||
    normPub === 'coindesk'
  ) {
    return SOURCE_FAMILIES.COINDESK;
  }

  // 7. Alpha Vantage
  if (
    host.includes('alphavantage.co') ||
    normSourceId.includes('alphavantage') ||
    normPub.includes('alpha vantage')
  ) {
    return SOURCE_FAMILIES.ALPHA_VANTAGE;
  }

  // 8. Reuters
  if (
    host.includes('reuters.com') ||
    normSourceId === 'reuters' ||
    normPub === 'reuters'
  ) {
    return SOURCE_FAMILIES.REUTERS;
  }

  // 9. Secondary republisher / syndication detection
  const syndicatedOrigin = detectSyndicatedOrigin(combinedNarrative);
  if (syndicatedOrigin) {
    return SOURCE_FAMILIES.SECONDARY_REPUBLISHER;
  }

  return SOURCE_FAMILIES.UNKNOWN;
}

/**
 * Returns whether a source family is considered an independent primary entity.
 * SECONDARY_REPUBLISHER and UNKNOWN never count as independent.
 */
export function isFamilyIndependent(family) {
  return INDEPENDENT_PRIMARY_FAMILIES.has(family);
}

/**
 * Resolves the underlying dependency group for an evidence item.
 * If an item is a SECONDARY_REPUBLISHER syndicating from CafeF, its dependency
 * group is CAFEF, preventing it from acting as an independent source while also
 * ensuring it doesn't form a second distinct group.
 */
export function resolveDependencyGroup({
  family,
  url = '',
  sourceId = '',
  publisher = '',
  title = '',
  summary = '',
  text = ''
} = {}) {
  const normFamily = family || classifySourceFamily({ url, sourceId, publisher, title, summary, text });
  if (normFamily === SOURCE_FAMILIES.SECONDARY_REPUBLISHER) {
    const origin = detectSyndicatedOrigin(`${title} ${summary} ${text}`);
    if (origin) return origin;
  }
  return normFamily;
}

/**
 * Collapses an array of evidence items into independent source families.
 * Returns { sourceCount, independentSourceCount, sourceFamilies, independentFamilies }.
 */
export function aggregateEvidenceSources(evidenceItems = []) {
  if (!Array.isArray(evidenceItems) || evidenceItems.length === 0) {
    return {
      sourceCount: 0,
      independentSourceCount: 0,
      sourceFamilies: [],
      independentFamilies: []
    };
  }

  const allFamilies = new Set();
  const independentGroups = new Set();

  for (const item of evidenceItems) {
    if (!item) continue;
    const directFamily = item.sourceFamily || classifySourceFamily(item);
    allFamilies.add(directFamily);

    const depGroup = resolveDependencyGroup({
      family: directFamily,
      url: item.url,
      sourceId: item.sourceId || item.source,
      publisher: item.publisher,
      title: item.title,
      summary: item.summary || item.excerpt,
      text: item.text
    });

    if (isFamilyIndependent(depGroup)) {
      independentGroups.add(depGroup);
    }
  }

  return {
    sourceCount: evidenceItems.length,
    independentSourceCount: independentGroups.size,
    sourceFamilies: Array.from(allFamilies).sort(),
    independentFamilies: Array.from(independentGroups).sort()
  };
}
