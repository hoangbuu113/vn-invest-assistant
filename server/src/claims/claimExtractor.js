import {
  CLAIM_TYPES,
  CLAIM_AUTHORITY_LEVELS,
  CLAIM_STATUS,
  createMarketClaim
} from './claimModel.js';
import { classifySourceFamily } from './sourceFamily.js';

const EPSILON_PERCENT = 0.02;
const EPSILON_CURRENCY = 1.0;

function parseVietnameseNumber(str) {
  if (!str) return null;
  const clean = str.replace(/\s+/g, '').replace(',', '.');
  const val = parseFloat(clean);
  return Number.isFinite(val) ? val : null;
}

function parseCurrencyNumber(str) {
  if (!str) return null;
  // Handle 25.450 or 25,450 VND -> 25450
  const digitsOnly = str.replace(/[^\d]/g, '');
  const val = parseInt(digitsOnly, 10);
  return Number.isFinite(val) ? val : null;
}

/**
 * Extracts a deterministic claim from an official or market observation.
 */
export function extractClaimsFromObservation(obs) {
  if (!obs || typeof obs !== 'object') return [];
  if (obs.status === 'unavailable' || obs.value === null || !Number.isFinite(obs.value)) {
    return [];
  }

  const factId = obs.factId || obs.id;
  const sourceFamily = classifySourceFamily({
    url: obs.provenance?.documentUrl || obs.provenance?.url,
    sourceId: obs.source,
    publisher: obs.provenance?.authority
  });

  const refPeriod = obs.referenceTime || null;
  const publishedAt = obs.publishedAt || obs.observedAt || null;
  const revisionMarker = obs.revisionMarker || null;

  // 1. CPI YoY
  if (factId === 'vn.macro.cpi.yoy') {
    const claim = createMarketClaim({
      claimType: CLAIM_TYPES.MACRO_NUMERIC,
      subject: 'vn.macro.cpi.yoy',
      predicate: 'EQUALS',
      numericValue: obs.value,
      unit: '%',
      referencePeriod: refPeriod,
      scope: 'monthly_yoy',
      methodology: obs.methodologyVersion || 'official_nso',
      revisionMarker,
      authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
      supportStatus: CLAIM_STATUS.SUPPORTED,
      publishedAt
    });
    return [{ claim, evidence: { evidenceId: obs.observationId, evidenceType: 'observation', sourceFamily } }];
  }

  // 2. SBV Central USD/VND Rate
  if (factId === 'vn.monetary.fx.sbv_central.usd_vnd') {
    const claim = createMarketClaim({
      claimType: CLAIM_TYPES.MONETARY_NUMERIC,
      subject: 'vn.monetary.fx.sbv_central.usd_vnd',
      predicate: 'EQUALS',
      numericValue: obs.value,
      unit: 'VND',
      referencePeriod: refPeriod,
      scope: 'central_rate',
      methodology: obs.methodologyVersion || 'official_sbv',
      revisionMarker,
      authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
      supportStatus: CLAIM_STATUS.SUPPORTED,
      publishedAt
    });
    return [{ claim, evidence: { evidenceId: obs.observationId, evidenceType: 'observation', sourceFamily } }];
  }

  // 3. Vietnam Customs Trade Exports
  if (factId === 'vn.trade.goods.exports.month_usd') {
    const claim = createMarketClaim({
      claimType: CLAIM_TYPES.TRADE_NUMERIC,
      subject: 'vn.trade.goods.exports.month_usd',
      predicate: 'EQUALS',
      numericValue: obs.value,
      unit: 'USD',
      referencePeriod: refPeriod,
      scope: 'monthly',
      methodology: obs.methodologyVersion || 'official_customs',
      revisionMarker,
      authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
      supportStatus: CLAIM_STATUS.SUPPORTED,
      publishedAt
    });
    return [{ claim, evidence: { evidenceId: obs.observationId, evidenceType: 'observation', sourceFamily } }];
  }

  // 4. Vietnam Customs Trade Imports
  if (factId === 'vn.trade.goods.imports.month_usd') {
    const claim = createMarketClaim({
      claimType: CLAIM_TYPES.TRADE_NUMERIC,
      subject: 'vn.trade.goods.imports.month_usd',
      predicate: 'EQUALS',
      numericValue: obs.value,
      unit: 'USD',
      referencePeriod: refPeriod,
      scope: 'monthly',
      methodology: obs.methodologyVersion || 'official_customs',
      revisionMarker,
      authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
      supportStatus: CLAIM_STATUS.SUPPORTED,
      publishedAt
    });
    return [{ claim, evidence: { evidenceId: obs.observationId, evidenceType: 'observation', sourceFamily } }];
  }

  // 5. Vietnam Customs Trade Balance
  if (factId === 'vn.trade.goods.balance.month_usd') {
    const claim = createMarketClaim({
      claimType: CLAIM_TYPES.TRADE_NUMERIC,
      subject: 'vn.trade.goods.balance.month_usd',
      predicate: 'EQUALS',
      numericValue: obs.value,
      unit: 'USD',
      referencePeriod: refPeriod,
      scope: 'monthly',
      methodology: obs.methodologyVersion || 'derived_customs',
      revisionMarker,
      authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
      supportStatus: CLAIM_STATUS.SUPPORTED,
      publishedAt
    });
    return [{ claim, evidence: { evidenceId: obs.observationId, evidenceType: 'observation', sourceFamily } }];
  }

  // General Market Observation Fallback
  const claimType =
    obs.pillar === 'macro'
      ? CLAIM_TYPES.MACRO_NUMERIC
      : obs.pillar === 'monetary'
      ? CLAIM_TYPES.MONETARY_NUMERIC
      : CLAIM_TYPES.MARKET_EVENT;

  const claim = createMarketClaim({
    claimType,
    subject: factId,
    predicate: 'EQUALS',
    numericValue: obs.value,
    unit: obs.unit || '',
    referencePeriod: refPeriod,
    scope: 'market_quote',
    methodology: obs.methodologyVersion || 'v1.3',
    revisionMarker,
    authorityLevel: obs.authorityLevel || CLAIM_AUTHORITY_LEVELS.MARKET_REFERENCE,
    supportStatus: CLAIM_STATUS.SUPPORTED,
    publishedAt
  });

  return [{ claim, evidence: { evidenceId: obs.observationId, evidenceType: 'observation', sourceFamily } }];
}

/**
 * Deterministically extracts candidate claims from article text.
 * Strictly conservative: returns empty array if no explicit verifiable statement exists.
 */
export function extractClaimsFromArticle(article) {
  if (!article || typeof article !== 'object') return [];

  const articleId = article.id || article.articleId || article.url;
  const title = article.title || '';
  const summary = article.summary || article.excerpt || '';
  const text = article.text || article.content || '';
  const combined = `${title}\n${summary}\n${text}`;
  const publishedAt = article.publishedAt || null;

  const sourceFamily = classifySourceFamily({
    url: article.url,
    sourceId: article.sourceId || article.source,
    publisher: article.publisher,
    title,
    summary,
    text
  });

  const extracted = [];

  // Default publication year/month if available
  let pubYear = '2026';
  if (publishedAt) {
    const d = new Date(publishedAt);
    if (!Number.isNaN(d.getTime())) {
      pubYear = d.getFullYear().toString();
    }
  }

  // 1. Exact Monthly CPI YoY
  // e.g. "CPI tháng 8 tăng 4.89%", "CPI tháng 08/2026 tăng 4,89% so với cùng kỳ"
  const cpiMonthlyRegex = /(?:cpi|chỉ số giá tiêu dùng)\s+tháng\s+(1[0-2]|0?[1-9])(?:\s*(?:năm|\/|-)\s*(\d{4}))?[^\d\n\r%]{0,50}?(?:tăng|đạt|ở mức)\s*(\d+(?:[\.,]\d+)?)\s*%/gi;
  for (const match of combined.matchAll(cpiMonthlyRegex)) {
    const month = match[1].padStart(2, '0');
    const year = match[2] || pubYear;
    const value = parseVietnameseNumber(match[3]);
    if (value !== null) {
      const claim = createMarketClaim({
        claimType: CLAIM_TYPES.MACRO_NUMERIC,
        subject: 'vn.macro.cpi.yoy',
        predicate: 'EQUALS',
        numericValue: value,
        unit: '%',
        referencePeriod: `${year}-${month}`,
        scope: 'monthly_yoy',
        authorityLevel: CLAIM_AUTHORITY_LEVELS.FINANCIAL_MEDIA,
        supportStatus: CLAIM_STATUS.SINGLE_SOURCE,
        publishedAt
      });
      extracted.push({ claim, evidence: { evidenceId: articleId, evidenceType: 'article', sourceFamily } });
    }
  }

  // 2. Cumulative / YTD CPI average
  // e.g. "CPI bình quân 8 tháng tăng 3.2%"
  const cpiYtdRegex = /(?:cpi|chỉ số giá tiêu dùng)\s+(?:bình quân|tính chung|lũy kế)\s+(\d{1,2})\s+tháng(?:\s*(?:năm|\/|-)\s*(\d{4}))?[^\d\n\r%]{0,50}?(?:tăng|đạt|ở mức)\s*(\d+(?:[\.,]\d+)?)\s*%/gi;
  for (const match of combined.matchAll(cpiYtdRegex)) {
    const monthsCount = match[1];
    const year = match[2] || pubYear;
    const value = parseVietnameseNumber(match[3]);
    if (value !== null) {
      const claim = createMarketClaim({
        claimType: CLAIM_TYPES.MACRO_NUMERIC,
        subject: 'vn.macro.cpi.ytd_average',
        predicate: 'EQUALS',
        numericValue: value,
        unit: '%',
        referencePeriod: `${year}-M${monthsCount}`,
        scope: 'ytd_cumulative',
        authorityLevel: CLAIM_AUTHORITY_LEVELS.FINANCIAL_MEDIA,
        supportStatus: CLAIM_STATUS.SINGLE_SOURCE,
        publishedAt
      });
      extracted.push({ claim, evidence: { evidenceId: articleId, evidenceType: 'article', sourceFamily } });
    }
  }

  // 3. SBV Central Exchange Rate
  // e.g. "Tỷ giá trung tâm ngày hôm nay ở mức 25.240 VND/USD"
  const centralFxRegex = /(?:tỷ giá trung tâm|tỷ giá trung tâm của sbv|ngân hàng nhà nước công bố tỷ giá trung tâm)[^\d\n\r]{0,50}?(?:ở mức|là|đạt)\s*(\d{2,3}[\.,]\d{3})/gi;
  for (const match of combined.matchAll(centralFxRegex)) {
    const value = parseCurrencyNumber(match[1]);
    if (value !== null) {
      const refPeriod = publishedAt ? publishedAt.slice(0, 10) : 'current';
      const claim = createMarketClaim({
        claimType: CLAIM_TYPES.MONETARY_NUMERIC,
        subject: 'vn.monetary.fx.sbv_central.usd_vnd',
        predicate: 'EQUALS',
        numericValue: value,
        unit: 'VND',
        referencePeriod: refPeriod,
        scope: 'central_rate',
        authorityLevel: CLAIM_AUTHORITY_LEVELS.FINANCIAL_MEDIA,
        supportStatus: CLAIM_STATUS.SINGLE_SOURCE,
        publishedAt
      });
      extracted.push({ claim, evidence: { evidenceId: articleId, evidenceType: 'article', sourceFamily } });
    }
  }

  // 4. Commercial Bank Exchange Rate
  // e.g. "Tỷ giá USD tại Vietcombank niêm yết ở mức 25.480 VND"
  const commercialFxRegex = /(?:tỷ giá\s+(?:usd\s+tại|tại các ngân hàng thương mại|vcb|vietcombank))[^\d\n\r]{0,50}?(?:ở mức|niêm yết|là|đạt)\s*(\d{2,3}[\.,]\d{3})/gi;
  for (const match of combined.matchAll(commercialFxRegex)) {
    const value = parseCurrencyNumber(match[1]);
    if (value !== null) {
      const refPeriod = publishedAt ? publishedAt.slice(0, 10) : 'current';
      const claim = createMarketClaim({
        claimType: CLAIM_TYPES.MONETARY_NUMERIC,
        subject: 'vn.monetary.fx.commercial.usd_vnd',
        predicate: 'EQUALS',
        numericValue: value,
        unit: 'VND',
        referencePeriod: refPeriod,
        scope: 'commercial_rate',
        authorityLevel: CLAIM_AUTHORITY_LEVELS.FINANCIAL_MEDIA,
        supportStatus: CLAIM_STATUS.SINGLE_SOURCE,
        publishedAt
      });
      extracted.push({ claim, evidence: { evidenceId: articleId, evidenceType: 'article', sourceFamily } });
    }
  }

  return extracted;
}

/**
 * Checks whether an evidence item (observation or article) semantically supports a specific claim.
 * Conservative: Citation membership alone is insufficient. Exact semantic match is required.
 */
export function doesEvidenceSupportClaim(evidenceItem, claim) {
  if (!evidenceItem || !claim) return false;

  // Direct claimId or subject link
  if (evidenceItem.claimId && (evidenceItem.claimId === claim.claimId || evidenceItem.claimId === claim.id)) {
    return true;
  }
  if (evidenceItem.subject && evidenceItem.subject === claim.subject) {
    if (evidenceItem.referencePeriod && claim.referencePeriod && evidenceItem.referencePeriod !== claim.referencePeriod) {
      return false;
    }
    if (evidenceItem.numericValue !== undefined && evidenceItem.numericValue !== null && claim.numericValue !== null) {
      const tolerance = claim.unit === '%' ? EPSILON_PERCENT : EPSILON_CURRENCY;
      if (Math.abs(Number(evidenceItem.numericValue) - Number(claim.numericValue)) > tolerance) {
        return false;
      }
    }
    return true;
  }

  // If evidenceItem is an Observation
  if (evidenceItem.factId || evidenceItem.observationId) {
    if (evidenceItem.factId !== claim.subject) return false;

    // Reference period check
    if (evidenceItem.referenceTime && claim.referencePeriod) {
      if (evidenceItem.referenceTime !== claim.referencePeriod) return false;
    }

    // Numeric value check
    if (claim.numericValue !== null) {
      const tolerance = claim.unit === '%' ? EPSILON_PERCENT : EPSILON_CURRENCY;
      if (Math.abs(Number(evidenceItem.value) - Number(claim.numericValue)) > tolerance) {
        return false;
      }
    }

    // Revision check if both specified
    if (evidenceItem.revisionMarker && claim.revisionMarker) {
      if (evidenceItem.revisionMarker !== claim.revisionMarker) return false;
    }

    return true;
  }

  // If evidenceItem is an Article
  const extractedFromArticle = extractClaimsFromArticle(evidenceItem);
  for (const { claim: articleClaim } of extractedFromArticle) {
    if (articleClaim.subject === claim.subject && articleClaim.scope === claim.scope) {
      if (!claim.referencePeriod || articleClaim.referencePeriod === claim.referencePeriod) {
        const tolerance = claim.unit === '%' ? EPSILON_PERCENT : EPSILON_CURRENCY;
        if (Math.abs(Number(articleClaim.numericValue) - Number(claim.numericValue)) <= tolerance) {
          return true;
        }
      }
    }
  }

  return false;
}
