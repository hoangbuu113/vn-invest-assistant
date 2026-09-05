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
  MARKET_DATA: 'MARKET_DATA',
  INDEPENDENT_RESEARCH: 'INDEPENDENT_RESEARCH',
  CAFEF: 'CAFEF',
  COINDESK: 'COINDESK',
  ALPHA_VANTAGE: 'ALPHA_VANTAGE',
  REUTERS: 'REUTERS',
  UNKNOWN_DEPENDENCY: 'UNKNOWN_DEPENDENCY'
});

const INDEPENDENT_PRIMARY_FAMILIES = new Set([
  SOURCE_FAMILIES.OFFICIAL_SBV,
  SOURCE_FAMILIES.OFFICIAL_NSO,
  SOURCE_FAMILIES.OFFICIAL_CUSTOMS,
  SOURCE_FAMILIES.ISSUER_IR,
  SOURCE_FAMILIES.MARKET_DATA
]);

export const INDEPENDENT_DEPENDENCY_GROUPS = Object.freeze(new Set([
  DEPENDENCY_GROUPS.OFFICIAL_SBV,
  DEPENDENCY_GROUPS.OFFICIAL_NSO,
  DEPENDENCY_GROUPS.OFFICIAL_CUSTOMS,
  DEPENDENCY_GROUPS.ISSUER_IR,
  DEPENDENCY_GROUPS.MARKET_DATA,
  DEPENDENCY_GROUPS.INDEPENDENT_RESEARCH
]));

export const CANONICAL_OFFICIAL_NSO_METRICS = Object.freeze(new Set([
  'vn.macro.cpi.yoy',
  'vn.macro.core_cpi.yoy',
  'vn.macro.gdp.real.quarter_yoy',
  'vn.macro.iip.month_yoy',
  'vn.macro.retail.month_yoy',
  'vn.macro.fdi.disbursed.month_usd'
]));

export const CANONICAL_OFFICIAL_SBV_METRICS = Object.freeze(new Set([
  'vn.monetary.fx.sbv_central.usd_vnd',
  'vn.monetary.rate.overnight',
  'vn.monetary.rate.refinancing',
  'vn.monetary.rate.discount',
  'vn.monetary.credit.growth.ytd',
  'vn.monetary.m2.growth.ytd'
]));

export const CANONICAL_OFFICIAL_CUSTOMS_METRICS = Object.freeze(new Set([
  'vn.trade.goods.exports.month_usd',
  'vn.trade.goods.imports.month_usd',
  'vn.trade.goods.balance.month_usd'
]));

export const CANONICAL_MARKET_METRICS = Object.freeze(new Set([
  'vn.market.vnindex.close',
  'vn.market.vn30.close',
  'vn.market.hnx.close',
  'vn.market.upcom.close',
  'vn.monetary.fx.usd_vnd',
  'vn.monetary.fx.commercial.usd_vnd',
  'global.intermarket.dxy.quote',
  'global.intermarket.brent.futures',
  'global.intermarket.sp500.close'
]));

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
  scope = '',
  methodology = '',
  isPrimaryResearch = false,
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

  // 1. Direct official observation and verified primary publisher
  if (normFamily === SOURCE_FAMILIES.OFFICIAL_NSO) return DEPENDENCY_GROUPS.OFFICIAL_NSO;
  if (normFamily === SOURCE_FAMILIES.OFFICIAL_SBV) return DEPENDENCY_GROUPS.OFFICIAL_SBV;
  if (normFamily === SOURCE_FAMILIES.OFFICIAL_CUSTOMS) return DEPENDENCY_GROUPS.OFFICIAL_CUSTOMS;
  if (normFamily === SOURCE_FAMILIES.ISSUER_IR) return DEPENDENCY_GROUPS.ISSUER_IR;
  if (normFamily === SOURCE_FAMILIES.MARKET_DATA) return DEPENDENCY_GROUPS.MARKET_DATA;

  // 2. Explicit independent primary research / survey
  if (
    isPrimaryResearch === true ||
    methodology === 'independent_survey' ||
    methodology === 'primary_research'
  ) {
    return DEPENDENCY_GROUPS.INDEPENDENT_RESEARCH;
  }

  // 3. Claim-specific localized attribution scoping:
  // Inspect ONLY localized claim text (snippet or title), NEVER the full article body text.
  // This prevents cross-claim contamination from other paragraphs in the same article.
  const localText = snippet && typeof snippet === 'string' && snippet.trim()
    ? snippet.trim()
    : (title && typeof title === 'string' ? title.trim() : '');

  if (localText) {
    const attributed = detectSyndicatedOrigin(localText);
    if (attributed) {
      return attributed;
    }

    // Explicit corporate disclosure / announcement attribution in localized text
    if (
      /(?:theo|nguồn[:\s]+|trích từ[:\s]+|công bố của|thông báo từ|đại diện|hđqt|bctc|nghị quyết)\s*(?:doanh nghiệp|công ty|tập đoàn|báo cáo tài chính|ban lãnh đạo)/i.test(localText) ||
      /(?:công bố|thông báo|ban hành)\s+(?:phương án|kế hoạch|nghị quyết|bctc|tái cấu trúc|kết quả kinh doanh)/i.test(localText)
    ) {
      if (
        claimType === 'CORPORATE_EVENT' ||
        (typeof subject === 'string' && (subject.startsWith('vn.issuer.') || subject.startsWith('corporate.')))
      ) {
        return DEPENDENCY_GROUPS.ISSUER_IR;
      }
    }
  }

  // 4. Strict canonical metric allowlists:
  // Guard against private estimates, surveys, forecasts, and alternative methodologies
  const normMethodology = normalizeText(methodology);
  const normScope = normalizeText(scope);
  const isAlternativeOrSurvey =
    normMethodology === 'survey' ||
    normMethodology === 'forecast' ||
    normMethodology === 'private_estimate' ||
    normMethodology === 'bank_forecast' ||
    normScope === 'private_survey' ||
    normScope === 'forecast' ||
    normScope === 'estimate';

  const normSubject = normalizeText(subject);

  if (!isAlternativeOrSurvey && normSubject) {
    if (CANONICAL_OFFICIAL_NSO_METRICS.has(normSubject)) {
      return DEPENDENCY_GROUPS.OFFICIAL_NSO;
    }
    if (CANONICAL_OFFICIAL_SBV_METRICS.has(normSubject)) {
      return DEPENDENCY_GROUPS.OFFICIAL_SBV;
    }
    if (CANONICAL_OFFICIAL_CUSTOMS_METRICS.has(normSubject)) {
      return DEPENDENCY_GROUPS.OFFICIAL_CUSTOMS;
    }
    if (CANONICAL_MARKET_METRICS.has(normSubject)) {
      return DEPENDENCY_GROUPS.MARKET_DATA;
    }
  }

  // 5. Corporate actions and events collapse to issuer IR dependency
  if (
    claimType === 'CORPORATE_EVENT' ||
    (normSubject && (normSubject.startsWith('vn.issuer.') || normSubject.startsWith('corporate.')))
  ) {
    return DEPENDENCY_GROUPS.ISSUER_IR;
  }

  // 6. Fallback: Unknown underlying origin
  // Commercial media (Reuters, CafeF, CoinDesk, AlphaVantage) without positively established provenance
  // MUST resolve to UNKNOWN_DEPENDENCY (isIndependent = false)
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
 * @param {Object} context - Optional claim context { subject, claimType, scope, methodology, isPrimaryResearch }
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
        scope: item.scope || context.scope,
        methodology: item.methodology || context.methodology,
        isPrimaryResearch: item.isPrimaryResearch || context.isPrimaryResearch,
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
