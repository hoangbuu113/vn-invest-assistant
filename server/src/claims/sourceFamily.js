export const SOURCE_FAMILIES = Object.freeze({
  OFFICIAL_SBV: 'OFFICIAL_SBV',
  OFFICIAL_NSO: 'OFFICIAL_NSO',
  OFFICIAL_CUSTOMS: 'OFFICIAL_CUSTOMS',
  ISSUER_IR: 'ISSUER_IR',
  CAFEF: 'CAFEF',
  COINDESK: 'COINDESK',
  ALPHA_VANTAGE: 'ALPHA_VANTAGE',
  REUTERS: 'REUTERS',
  MARKET_DATA: 'MARKET_DATA',
  SECONDARY_REPUBLISHER: 'SECONDARY_REPUBLISHER',
  UNKNOWN: 'UNKNOWN'
});

export const DEPENDENCY_GROUPS = Object.freeze({
  OFFICIAL_SBV: 'OFFICIAL_SBV',
  OFFICIAL_NSO: 'OFFICIAL_NSO',
  OFFICIAL_CUSTOMS: 'OFFICIAL_CUSTOMS',
  ISSUER_IR: 'ISSUER_IR',
  CAFEF: 'CAFEF',
  COINDESK: 'COINDESK',
  ALPHA_VANTAGE: 'ALPHA_VANTAGE',
  REUTERS: 'REUTERS',
  MARKET_DATA: 'MARKET_DATA',
  UNKNOWN_DEPENDENCY: 'UNKNOWN_DEPENDENCY'
});

const INDEPENDENT_PRIMARY_FAMILIES = new Set([
  SOURCE_FAMILIES.OFFICIAL_SBV,
  SOURCE_FAMILIES.OFFICIAL_NSO,
  SOURCE_FAMILIES.OFFICIAL_CUSTOMS,
  SOURCE_FAMILIES.ISSUER_IR,
  SOURCE_FAMILIES.CAFEF,
  SOURCE_FAMILIES.COINDESK,
  SOURCE_FAMILIES.ALPHA_VANTAGE,
  SOURCE_FAMILIES.REUTERS,
  SOURCE_FAMILIES.MARKET_DATA
]);

const INDEPENDENT_DEPENDENCY_GROUPS = new Set([
  DEPENDENCY_GROUPS.OFFICIAL_SBV,
  DEPENDENCY_GROUPS.OFFICIAL_NSO,
  DEPENDENCY_GROUPS.OFFICIAL_CUSTOMS,
  DEPENDENCY_GROUPS.ISSUER_IR,
  DEPENDENCY_GROUPS.CAFEF,
  DEPENDENCY_GROUPS.COINDESK,
  DEPENDENCY_GROUPS.ALPHA_VANTAGE,
  DEPENDENCY_GROUPS.REUTERS,
  DEPENDENCY_GROUPS.MARKET_DATA
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
 * Detects explicit syndication or primary source attribution in text.
 * Covers both Vietnamese and English phrasing (e.g. "Theo GSO", "According to NSO").
 */
export function detectSyndicatedOrigin(text = '') {
  const norm = normalizeText(text);
  if (!norm) return null;

  // 1. NSO / GSO attribution
  if (
    /(?:theo|nguồn[:\s]+|trích từ[:\s]+|according to|data from|cited by|citing|reported by)\s*(?:gso|nso|tổng cục thống kê|cục thống kê|general statistics office|statistics authority|cơ quan thống kê)/i.test(
      norm
    )
  ) {
    return DEPENDENCY_GROUPS.OFFICIAL_NSO;
  }

  // 2. SBV attribution
  if (
    /(?:theo|nguồn[:\s]+|trích từ[:\s]+|according to|data from|announced by)\s*(?:sbv|ngân hàng nhà nước|state bank of vietnam|central bank)/i.test(
      norm
    )
  ) {
    return DEPENDENCY_GROUPS.OFFICIAL_SBV;
  }

  // 3. Customs attribution
  if (
    /(?:theo|nguồn[:\s]+|trích từ[:\s]+|according to|data from)\s*(?:hải quan|tổng cục hải quan|cục hải quan|vietnam customs|customs authority)/i.test(
      norm
    )
  ) {
    return DEPENDENCY_GROUPS.OFFICIAL_CUSTOMS;
  }

  // 4. CafeF / CafeBiz syndication
  if (/(?:theo|nguồn[:\s]+|trích từ[:\s]+)\s*(?:cafef|cafebiz)/i.test(norm)) {
    return DEPENDENCY_GROUPS.CAFEF;
  }

  // 5. Reuters syndication
  if (/(?:theo|nguồn[:\s]+|trích từ[:\s]+)\s*(?:reuters)/i.test(norm)) {
    return DEPENDENCY_GROUPS.REUTERS;
  }

  // 6. CoinDesk syndication
  if (/(?:theo|nguồn[:\s]+|trích từ[:\s]+)\s*(?:coindesk)/i.test(norm)) {
    return DEPENDENCY_GROUPS.COINDESK;
  }

  return null;
}

/**
 * Classifies an evidence source into a deterministic publisher source family.
 * Represents publisher/channel identity, NOT necessarily evidence dependency.
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
    normSourceId.includes('thống kê') ||
    normPub.includes('tổng cục thống kê') ||
    normPub.includes('thống kê quốc gia') ||
    normPub.includes('general statistics office') ||
    normPub.includes('national statistics office')
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

  // 9. Market Exchanges & Financial Market Data
  if (
    host.includes('hsx.vn') ||
    host.includes('hose.vn') ||
    host.includes('hnx.vn') ||
    host.includes('vsd.vn') ||
    host.includes('ssc.gov.vn') ||
    host.includes('finance.yahoo.com') ||
    host.includes('tradingeconomics.com') ||
    host.includes('vietstock.vn') ||
    normSourceId.includes('hose') ||
    normSourceId.includes('hnx') ||
    normSourceId.includes('upcom') ||
    normSourceId.includes('vsd') ||
    normSourceId.includes('ssc') ||
    normSourceId.includes('yahoo') ||
    normSourceId.includes('trading economics') ||
    normSourceId.includes('vietstock') ||
    normPub.includes('sở giao dịch') ||
    normPub.includes('chứng khoán') ||
    normPub.includes('yahoo finance') ||
    normPub.includes('trading economics')
  ) {
    return SOURCE_FAMILIES.MARKET_DATA;
  }

  // 10. Secondary republisher / syndication detection
  const syndicatedOrigin = detectSyndicatedOrigin(combinedNarrative);
  if (syndicatedOrigin) {
    return SOURCE_FAMILIES.SECONDARY_REPUBLISHER;
  }

  return SOURCE_FAMILIES.UNKNOWN;
}

/**
 * Returns whether a publisher source family is considered an independent primary entity.
 * Note: Publisher diversity alone does not establish evidence independence.
 */
export function isFamilyIndependent(family) {
  return INDEPENDENT_PRIMARY_FAMILIES.has(family);
}

/**
 * Returns whether a dependency group qualifies as genuinely independent evidence.
 * UNKNOWN_DEPENDENCY and secondary republishers never count as independent.
 */
export function isDependencyIndependent(dependencyGroup) {
  return Boolean(
    dependencyGroup &&
    dependencyGroup !== DEPENDENCY_GROUPS.UNKNOWN_DEPENDENCY &&
    INDEPENDENT_DEPENDENCY_GROUPS.has(dependencyGroup)
  );
}

/**
 * Deterministically resolves the underlying dependency group for an evidence item
 * in the context of a specific claim.
 *
 * Epistemic rules:
 * - If the matched statement explicitly attributes an official authority (e.g. "According to NSO"),
 *   its dependency is mapped to that authority (e.g. OFFICIAL_NSO).
 * - For official numeric facts (e.g. national CPI YoY, SBV central FX, Customs trade balance),
 *   secondary media reporting that metric derives from the official authority, collapsing to
 *   the corresponding official dependency group.
 * - Primary official observations map to their respective official dependency group.
 * - If dependency cannot be positively established, returns UNKNOWN_DEPENDENCY.
 */
export function resolveClaimDependency({
  publisherFamily = SOURCE_FAMILIES.UNKNOWN,
  subject = '',
  claimType = '',
  url = '',
  sourceId = '',
  publisher = '',
  title = '',
  summary = '',
  text = '',
  snippet = ''
} = {}) {
  const normFamily =
    publisherFamily || classifySourceFamily({ url, sourceId, publisher, title, summary, text });

  // 1. Direct official observation and market sources
  if (normFamily === SOURCE_FAMILIES.OFFICIAL_NSO) return DEPENDENCY_GROUPS.OFFICIAL_NSO;
  if (normFamily === SOURCE_FAMILIES.OFFICIAL_SBV) return DEPENDENCY_GROUPS.OFFICIAL_SBV;
  if (normFamily === SOURCE_FAMILIES.OFFICIAL_CUSTOMS) return DEPENDENCY_GROUPS.OFFICIAL_CUSTOMS;
  if (normFamily === SOURCE_FAMILIES.ISSUER_IR) return DEPENDENCY_GROUPS.ISSUER_IR;
  if (normFamily === SOURCE_FAMILIES.MARKET_DATA) return DEPENDENCY_GROUPS.MARKET_DATA;

  // 2. Claim-specific explicit attribution in snippet or text
  const narrative = `${snippet} ${title} ${summary} ${text}`;
  const attributed = detectSyndicatedOrigin(narrative);
  if (attributed) {
    return attributed;
  }

  // 3. Conservative official numeric facts policy:
  // Secondary media reporting national official figures derive from the respective official release.
  const normSubject = normalizeText(subject);
  if (normSubject.startsWith('vn.macro.cpi') || normSubject.startsWith('vn.macro.gdp') || normSubject.startsWith('vn.macro.iip')) {
    return DEPENDENCY_GROUPS.OFFICIAL_NSO;
  }
  if (normSubject.startsWith('vn.monetary.fx.sbv') || normSubject.startsWith('vn.monetary.policy')) {
    return DEPENDENCY_GROUPS.OFFICIAL_SBV;
  }
  if (normSubject.startsWith('vn.trade.goods')) {
    return DEPENDENCY_GROUPS.OFFICIAL_CUSTOMS;
  }
  if (
    normSubject.startsWith('vn.market.') ||
    normSubject.startsWith('global.intermarket.') ||
    normSubject.startsWith('vn.monetary.fx.usd_vnd') ||
    normSubject.startsWith('vn.monetary.fx.commercial')
  ) {
    return DEPENDENCY_GROUPS.MARKET_DATA;
  }

  // 4. Recognized original media reporting non-official independent events
  if (normFamily === SOURCE_FAMILIES.CAFEF) return DEPENDENCY_GROUPS.CAFEF;
  if (normFamily === SOURCE_FAMILIES.COINDESK) return DEPENDENCY_GROUPS.COINDESK;
  if (normFamily === SOURCE_FAMILIES.ALPHA_VANTAGE) return DEPENDENCY_GROUPS.ALPHA_VANTAGE;
  if (normFamily === SOURCE_FAMILIES.REUTERS) return DEPENDENCY_GROUPS.REUTERS;

  return DEPENDENCY_GROUPS.UNKNOWN_DEPENDENCY;
}

/**
 * Backward compatibility alias for resolveDependencyGroup.
 */
export function resolveDependencyGroup(params = {}) {
  return resolveClaimDependency(params);
}

/**
 * Collapses an array of evidence items into independent dependency groups.
 * Tracks publisher diversity (sourceFamilies) separately from true evidence
 * independence (independentDependencyGroups).
 *
 * @param {Array} evidenceItems
 * @param {Object} context - Optional claim context { subject, claimType }
 * @returns {Object} { sourceCount, independentSourceCount, sourceFamilies, dependencyGroups, independentFamilies }
 */
export function aggregateEvidenceSources(evidenceItems = [], context = {}) {
  if (!Array.isArray(evidenceItems) || evidenceItems.length === 0) {
    return {
      sourceCount: 0,
      independentSourceCount: 0,
      sourceFamilies: [],
      dependencyGroups: [],
      independentFamilies: []
    };
  }

  const allPublisherFamilies = new Set();
  const allDependencyGroups = new Set();
  const independentDependencyGroups = new Set();

  for (const item of evidenceItems) {
    if (!item) continue;
    const directFamily = item.sourceFamily || classifySourceFamily(item);
    allPublisherFamilies.add(directFamily);

    const depGroup =
      item.dependencyGroup ||
      resolveClaimDependency({
        publisherFamily: directFamily,
        subject: item.subject || context.subject || item.factId,
        claimType: item.claimType || context.claimType,
        url: item.url,
        sourceId: item.sourceId || item.source,
        publisher: item.publisher,
        title: item.title,
        summary: item.summary || item.excerpt,
        text: item.text,
        snippet: item.snippet || ''
      });

    allDependencyGroups.add(depGroup);

    if (isDependencyIndependent(depGroup)) {
      independentDependencyGroups.add(depGroup);
    }
  }

  return {
    sourceCount: evidenceItems.length,
    independentSourceCount: independentDependencyGroups.size,
    sourceFamilies: Array.from(allPublisherFamilies).sort(),
    dependencyGroups: Array.from(allDependencyGroups).sort(),
    independentFamilies: Array.from(independentDependencyGroups).sort()
  };
}
