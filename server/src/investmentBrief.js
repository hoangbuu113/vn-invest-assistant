import { createHash } from 'node:crypto';

import { getAssetAnalysis } from './analysis.js';
import { calculatePortfolioComposition } from './composition.js';
import { getMarketHistory } from './market.js';
import { getPersonalizedNewsFeed, getNewsFeed } from './news.js';
import { cleanPlainText } from './news/text.js';
import { getOpportunities } from './opportunities.js';
import { getPortfolioPerformance } from './performance.js';
import { getPortfolioOverview } from './portfolio.js';
import { getVietnamRegime } from './regime.js';
import {
  getAssets,
  getHoldings,
  getInvestorProfile,
  getWatchlist
} from './supabase.js';
import {
  AI_BRIEF_MODEL,
  AI_BRIEF_PROMPT_VERSION,
  AI_BRIEF_REASONING_EFFORT,
  AI_BRIEF_SCHEMA_VERSION,
  BRIEF_SECTION_KEYS,
  generateOpenAiBrief
} from './ai/openai.js';

export const AI_BRIEF_METHODOLOGY_VERSION = 'ai-brief-v1';
export const AI_BRIEF_CACHE_TTL_MS = 15 * 60 * 1000;
export const AI_BRIEF_COOLDOWN_MS = 60 * 1000;
export const AI_BRIEF_DEFAULT_DAILY_LIMIT = 20;
export const AI_BRIEF_MAX_PACKET_CHARS = 32_000;

const MAX_NEWS_ITEMS = 5;
const MAX_CANDIDATES_PER_COHORT = 3;
const MAX_TOTAL_STATEMENTS = 18;
const MAX_TOTAL_PROSE_CHARS = 4_000;

function requireNow(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Investment brief requires one valid shared request Date');
  }
  return now;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeReason(error, fallback) {
  const code = nonEmptyString(error?.code ?? error?.reason);
  return code && /^[A-Z0-9_:-]{1,100}$/.test(code) ? code : fallback;
}

function safeProvenance(value, fallbackService) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    service: nonEmptyString(source.service) || fallbackService,
    sourceId: nonEmptyString(source.sourceId),
    source: nonEmptyString(source.source),
    provider: nonEmptyString(source.provider),
    methodologyVersion: nonEmptyString(source.methodologyVersion)
  };
}

function sanitizeUntrustedText(value, maxLength) {
  return cleanPlainText(typeof value === 'string' ? value : '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\b(system|developer|assistant|user)\s*:/gi, '$1 —')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function timestampValue(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function latestTimestamp(values) {
  const valid = values.map(timestampValue).filter(Boolean).sort();
  return valid.length > 0 ? valid[valid.length - 1] : null;
}

function slug(value) {
  return String(value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function addEvidenceFactory(evidence) {
  const ids = new Set();
  return ({ id, domain, label, value, unit = null, status = 'available', asOf = null, provenance }) => {
    if (ids.has(id)) throw new Error(`Duplicate investment brief evidence id: ${id}`);
    ids.add(id);
    evidence.push({
      id,
      domain,
      label,
      value,
      unit,
      status,
      asOf,
      provenance: safeProvenance(provenance, domain)
    });
  };
}

function sourceStatusEvidence(addEvidence, domain, status, reason, asOf, provenance) {
  addEvidence({
    id: `${domain}.status`,
    domain,
    label: `Trạng thái dữ liệu ${domain}`,
    value: status,
    status,
    asOf,
    provenance
  });
  if (reason) {
    addEvidence({
      id: `${domain}.reason`,
      domain,
      label: `Lý do trạng thái ${domain}`,
      value: reason,
      status,
      asOf,
      provenance
    });
  }
}

function addPortfolioEvidence({ addEvidence, portfolio, composition, portfolioAsOf }) {
  const summary = portfolio.summary || {};
  const provenance = { service: 'portfolio-overview', methodologyVersion: 'deterministic' };
  const summaryFields = [
    ['cashAvailable', 'Tiền mặt khả dụng', 'VND'],
    ['totalCostBasis', 'Tổng giá vốn', 'VND'],
    ['pricedCostBasis', 'Giá vốn có thể so sánh', 'VND'],
    ['totalMarketValue', 'Giá trị thị trường tài sản đã định giá', 'VND'],
    ['totalUnrealizedPnL', 'Lãi lỗ chưa thực hiện', 'VND'],
    ['totalUnrealizedPnLPercent', 'Tỷ lệ lãi lỗ chưa thực hiện', 'percent'],
    ['totalPortfolioValue', 'Tổng giá trị danh mục', 'VND'],
    ['valuationStatus', 'Trạng thái định giá danh mục', null],
    ['pnlCoverageStatus', 'Mức bao phủ lãi lỗ', null]
  ];
  for (const [field, label, unit] of summaryFields) {
    addEvidence({
      id: `portfolio.${field}`,
      domain: 'portfolio',
      label,
      value: summary[field] ?? null,
      unit,
      status: summary[field] === null || summary[field] === undefined ? 'unavailable' : 'available',
      asOf: portfolioAsOf,
      provenance
    });
  }
  addEvidence({
    id: 'portfolio.holdingsCount',
    domain: 'portfolio',
    label: 'Số tài sản đang nắm giữ',
    value: Array.isArray(portfolio.holdings) ? portfolio.holdings.length : 0,
    unit: 'count',
    asOf: portfolioAsOf,
    provenance
  });

  const compositionProvenance = { service: 'portfolio-composition', methodologyVersion: 'deterministic' };
  const compositionFields = [
    ['valuationCoverageLevel', 'Mức bao phủ định giá cơ cấu', null],
    ['allocationBasis', 'Cơ sở phân bổ', null],
    ['cashWeightPct', 'Tỷ trọng tiền mặt', 'percent'],
    ['pricedAssetsWeightPct', 'Tỷ trọng tài sản đã định giá', 'percent'],
    ['top3HoldingsWeightPct', 'Tỷ trọng các khoản nắm giữ lớn nhất', 'percent']
  ];
  for (const [field, label, unit] of compositionFields) {
    addEvidence({
      id: `composition.${field}`,
      domain: 'composition',
      label,
      value: composition?.[field] ?? null,
      unit,
      status: composition?.[field] === null || composition?.[field] === undefined ? 'unavailable' : 'available',
      asOf: portfolioAsOf,
      provenance: compositionProvenance
    });
  }
  if (composition?.largestHolding) {
    for (const [field, label, unit] of [
      ['symbol', 'Mã tài sản có tỷ trọng lớn nhất', null],
      ['name', 'Tên tài sản có tỷ trọng lớn nhất', null],
      ['marketValue', 'Giá trị tài sản có tỷ trọng lớn nhất', 'VND'],
      ['weightPct', 'Tỷ trọng tài sản lớn nhất', 'percent']
    ]) {
      addEvidence({
        id: `composition.largestHolding.${field}`,
        domain: 'composition',
        label,
        value: composition.largestHolding[field] ?? null,
        unit,
        status: composition.largestHolding[field] === null || composition.largestHolding[field] === undefined
          ? 'unavailable'
          : 'available',
        asOf: portfolioAsOf,
        provenance: compositionProvenance
      });
    }
  }
}

function addPerformanceEvidence({ addEvidence, performance }) {
  const asOf = nonEmptyString(performance?.period?.endDate);
  const provenance = {
    service: 'portfolio-performance',
    methodologyVersion: nonEmptyString(performance?.methodology?.methodologyVersion) || 'deterministic'
  };
  sourceStatusEvidence(
    addEvidence,
    'performance',
    nonEmptyString(performance?.status) || 'unavailable',
    safeReason({ reason: performance?.twr?.reason }, null),
    asOf,
    provenance
  );
  const fields = [
    ['period.range', performance?.period?.range, 'Khoảng đánh giá hiệu suất', null, performance?.status],
    ['twr.returnPct', performance?.twr?.returnPct, 'Biến động danh mục theo TWR', 'percent', performance?.twr?.status],
    ['mwr.annualizedReturnPct', performance?.mwr?.annualizedReturnPct, 'Hiệu suất dòng tiền theo MWR', 'percent', performance?.mwr?.status],
    ['pnl.realizedPnlDuringPeriod', performance?.pnl?.realizedPnlDuringPeriod, 'Lãi lỗ đã thực hiện trong kỳ', 'VND', performance?.pnl?.status],
    ['pnl.unrealizedPnlAtEnd', performance?.pnl?.unrealizedPnlAtEnd, 'Lãi lỗ chưa thực hiện cuối kỳ', 'VND', performance?.pnl?.status],
    ['pnl.totalAccountingPnlAtEnd', performance?.pnl?.totalAccountingPnlAtEnd, 'Tổng lãi lỗ kế toán cuối kỳ', 'VND', performance?.pnl?.status],
    ['drawdown.currentDrawdownPct', performance?.drawdown?.currentDrawdownPct, 'Mức sụt giảm hiện tại của danh mục', 'percent', performance?.drawdown?.status],
    ['drawdown.maxDrawdownPct', performance?.drawdown?.maxDrawdownPct, 'Mức sụt giảm lớn nhất của danh mục', 'percent', performance?.drawdown?.status]
  ];
  for (const [suffix, value, label, unit, status] of fields) {
    addEvidence({
      id: `performance.${suffix}`,
      domain: 'performance',
      label,
      value: value ?? null,
      unit,
      status: nonEmptyString(status) || (value === null || value === undefined ? 'unavailable' : 'available'),
      asOf,
      provenance
    });
  }
}

function addRegimeEvidence({ addEvidence, regime }) {
  const inflation = regime?.inflation || {};
  const money = regime?.moneyMarket || {};
  const breadth = regime?.marketBreadth || {};

  const inflationProvenance = safeProvenance(inflation.provenance, 'vietnam-regime-inflation');
  sourceStatusEvidence(
    addEvidence,
    'regime.inflation',
    nonEmptyString(inflation.status) || 'unavailable',
    safeReason(inflation, null),
    nonEmptyString(inflation.referencePeriod),
    inflationProvenance
  );
  for (const [field, label, unit] of [
    ['referencePeriod', 'Kỳ tham chiếu CPI', null],
    ['publishedAt', 'Ngày công bố CPI', null],
    ['headlineCpiYoYPct', 'CPI toàn phần so với cùng kỳ', 'percent'],
    ['threeMonthDeltaPp', 'Thay đổi CPI so với ba tháng trước', 'percentage_point']
  ]) {
    addEvidence({
      id: `regime.inflation.${field}`,
      domain: 'regime.inflation',
      label,
      value: inflation[field] ?? null,
      unit,
      status: inflation[field] === null || inflation[field] === undefined ? 'unavailable' : (inflation.status || 'available'),
      asOf: nonEmptyString(inflation.referencePeriod),
      provenance: inflationProvenance
    });
  }

  const moneyProvenance = safeProvenance(money.provenance, 'vietnam-regime-money-market');
  sourceStatusEvidence(
    addEvidence,
    'regime.moneyMarket',
    nonEmptyString(money.status) || 'unavailable',
    safeReason(money, null),
    nonEmptyString(money.referenceWeekEnd),
    moneyProvenance
  );
  for (const [field, label, unit] of [
    ['referenceWeekStart', 'Đầu tuần tham chiếu lãi suất liên ngân hàng', null],
    ['referenceWeekEnd', 'Cuối tuần tham chiếu lãi suất liên ngân hàng', null],
    ['vndOvernightRatePct', 'Lãi suất qua đêm VND', 'percent'],
    ['latest4WeekMeanPct', 'Bình quân lãi suất giai đoạn gần nhất', 'percent'],
    ['previous4WeekMeanPct', 'Bình quân lãi suất giai đoạn trước', 'percent'],
    ['trendPp', 'Thay đổi bình quân lãi suất', 'percentage_point']
  ]) {
    addEvidence({
      id: `regime.moneyMarket.${field}`,
      domain: 'regime.moneyMarket',
      label,
      value: money[field] ?? null,
      unit,
      status: money[field] === null || money[field] === undefined ? 'unavailable' : (money.status || 'available'),
      asOf: nonEmptyString(money.referenceWeekEnd),
      provenance: moneyProvenance
    });
  }

  sourceStatusEvidence(
    addEvidence,
    'regime.marketBreadth',
    nonEmptyString(breadth.status) || 'unavailable',
    safeReason(breadth, 'SOURCE_NOT_PROVISIONED'),
    null,
    { service: 'vietnam-regime-market-breadth' }
  );
}

function addCandidateEvidence(addEvidence, candidate, cohortId, separateGold = false) {
  const symbol = nonEmptyString(candidate?.symbol) || 'UNKNOWN';
  const prefix = separateGold
    ? `opportunity.gold.${slug(symbol)}`
    : `opportunity.${slug(cohortId)}.${slug(symbol)}`;
  const asOf = nonEmptyString(candidate?.analysisAsOf) || nonEmptyString(candidate?.analysisPriceDate);
  const provenance = {
    service: 'opportunity-engine',
    methodologyVersion: 'opportunity-v1',
    provider: nonEmptyString(candidate?.analysisFreshness)
  };
  addEvidence({
    id: `${prefix}.candidate`,
    domain: separateGold ? 'opportunity.gold' : `opportunity.${cohortId}`,
    label: separateGold ? 'Bằng chứng mô tả Vàng' : 'Bằng chứng ứng viên trong nhóm',
    value: {
      symbol,
      name: candidate?.name ?? symbol,
      cohort: cohortId,
      candidateState: candidate?.candidateState ?? 'unsupported',
      descriptiveRank: candidate?.descriptiveRank ?? null,
      screenMatch: candidate?.screenMatch ?? null,
      quoteCurrency: candidate?.analysisQuoteCurrency ?? candidate?.canonicalQuoteCurrency ?? null,
      metrics: {
        priceChangePct: candidate?.evidence?.priceChangePct ?? null,
        positiveCloseTransitionRatio: candidate?.evidence?.positiveCloseTransitionRatio ?? null,
        dailyVolatilityPct: candidate?.evidence?.dailyVolatilityPct ?? null,
        maxDrawdownPct: candidate?.evidence?.maxDrawdownPct ?? null,
        completedCloseRangePositionPct: candidate?.evidence?.completedCloseRangePositionPct ?? null,
        distanceBelowHighestCompletedClosePct: candidate?.evidence?.distanceBelowHighestCompletedClosePct ?? null
      },
      held: candidate?.held ?? null,
      watchlisted: candidate?.watchlisted ?? null,
      currentExposurePct: candidate?.currentExposurePct ?? null,
      exposureStatus: candidate?.exposureStatus ?? null
    },
    unit: null,
    status: candidate?.candidateState || 'unsupported',
    asOf,
    provenance
  });
}

function addOpportunityEvidence({ addEvidence, opportunities }) {
  sourceStatusEvidence(
    addEvidence,
    'opportunity',
    opportunities?.status === 'unavailable' ? 'unavailable' : 'available',
    opportunities?.status === 'unavailable' ? 'OPPORTUNITY_SERVICE_UNAVAILABLE' : null,
    nonEmptyString(opportunities?.generatedAt),
    { service: 'opportunity-engine', methodologyVersion: opportunities?.methodologyVersion || 'opportunity-v1' }
  );
  addEvidence({
    id: 'opportunity.analysisRangeProxy',
    domain: 'opportunity',
    label: 'Khoảng phân tích đại diện cho thời hạn đầu tư',
    value: opportunities?.analysisRangeProxy ?? null,
    status: opportunities?.analysisRangeProxy ? 'available' : 'unavailable',
    asOf: nonEmptyString(opportunities?.generatedAt),
    provenance: { service: 'opportunity-engine', methodologyVersion: 'opportunity-v1' }
  });

  for (const cohort of Array.isArray(opportunities?.cohorts) ? opportunities.cohorts : []) {
    const cohortId = nonEmptyString(cohort?.id) || 'UNKNOWN';
    const candidates = Array.isArray(cohort?.candidates) ? cohort.candidates : [];
    if (cohortId === 'GOLD') {
      for (const candidate of candidates.slice(0, 1)) {
        addCandidateEvidence(addEvidence, candidate, cohortId, true);
      }
      continue;
    }
    for (const candidate of candidates.slice(0, MAX_CANDIDATES_PER_COHORT)) {
      addCandidateEvidence(addEvidence, candidate, cohortId, false);
    }
  }
}

function addNewsEvidence({ addEvidence, news, untrustedNews }) {
  const newsAsOf = nonEmptyString(news?.dataAsOf);
  sourceStatusEvidence(
    addEvidence,
    'news',
    news?.status === 'ok' ? (news?.partial ? 'partial' : 'available') : 'unavailable',
    news?.status === 'ok' ? null : 'PERSONALIZED_NEWS_UNAVAILABLE',
    newsAsOf,
    { service: 'personalized-news', methodologyVersion: 'feature-23' }
  );

  const items = Array.isArray(news?.data) ? news.data : (Array.isArray(news?.news) ? news.news : []);
  const sorted = items
    .map((item, index) => ({ item, index, publishedAt: timestampValue(item?.publishedAt) }))
    .sort((left, right) => {
      if (left.publishedAt !== right.publishedAt) return String(right.publishedAt || '').localeCompare(String(left.publishedAt || ''));
      return left.index - right.index;
    })
    .slice(0, MAX_NEWS_ITEMS);

  sorted.forEach(({ item, publishedAt }, index) => {
    const ordinal = index + 1;
    const prefix = `news.item${ordinal}`;
    const title = sanitizeUntrustedText(item?.title, 180);
    const excerpt = sanitizeUntrustedText(item?.summary ?? item?.excerpt, 320);
    const source = sanitizeUntrustedText(item?.source, 100) || 'Nguồn tin';
    const relatedAssets = (Array.isArray(item?.relatedAssets) ? item.relatedAssets : [])
      .slice(0, 8)
      .map((asset) => ({
        symbol: sanitizeUntrustedText(asset?.symbol, 30) || null,
        name: sanitizeUntrustedText(asset?.name, 100) || null
      }));
    const provenance = { service: 'personalized-news', source };
    addEvidence({
      id: `${prefix}.article`,
      domain: 'news',
      label: 'Bối cảnh bài viết từ nguồn tin',
      value: { title, excerpt, source, publishedAt, relatedAssets },
      unit: null,
      status: title ? 'available' : 'unavailable',
      asOf: publishedAt,
      provenance
    });
    if (excerpt) {
      untrustedNews.push({
        evidenceId: `${prefix}.article`,
        text: excerpt
      });
    }
  });
}

function unavailableEntry(domain, status, reason) {
  return { domain, status, reason };
}

export function buildInvestmentBriefFactRegistry({
  portfolio,
  composition,
  performance = null,
  regime = null,
  opportunities = null,
  news = null,
  sourceFailures = {},
  now
}) {
  requireNow(now);
  if (!portfolio?.summary || !Array.isArray(portfolio?.holdings)) {
    throw new TypeError('Investment brief requires a valid portfolio core');
  }

  const evidence = [];
  const untrustedNews = [];
  const addEvidence = addEvidenceFactory(evidence);
  const portfolioAsOf = latestTimestamp(portfolio.holdings.map((holding) => holding?.marketUpdatedAt));

  addPortfolioEvidence({ addEvidence, portfolio, composition, portfolioAsOf });
  if (performance) addPerformanceEvidence({ addEvidence, performance });
  else sourceStatusEvidence(addEvidence, 'performance', 'unavailable', sourceFailures.performance || 'PERFORMANCE_UNAVAILABLE', null, { service: 'portfolio-performance' });
  if (regime) addRegimeEvidence({ addEvidence, regime });
  else sourceStatusEvidence(addEvidence, 'regime', 'unavailable', sourceFailures.regime || 'REGIME_UNAVAILABLE', null, { service: 'vietnam-regime' });
  if (opportunities) addOpportunityEvidence({ addEvidence, opportunities });
  else sourceStatusEvidence(addEvidence, 'opportunity', 'unavailable', sourceFailures.opportunity || 'OPPORTUNITY_UNAVAILABLE', null, { service: 'opportunity-engine' });
  if (news) addNewsEvidence({ addEvidence, news, untrustedNews });
  else sourceStatusEvidence(addEvidence, 'news', 'unavailable', sourceFailures.news || 'PERSONALIZED_NEWS_UNAVAILABLE', null, { service: 'personalized-news' });

  addEvidence({
    id: 'brief.factBoundary',
    domain: 'brief',
    label: 'Ranh giới phương pháp bản tin',
    value: 'deterministic_facts_only',
    status: 'available',
    asOf: null,
    provenance: { service: 'investment-brief', methodologyVersion: AI_BRIEF_METHODOLOGY_VERSION }
  });

  const unavailableDomains = [];
  if (!performance || ['unavailable', 'partial'].includes(performance?.status)) {
    unavailableDomains.push(unavailableEntry('performance', performance?.status || 'unavailable', sourceFailures.performance || performance?.twr?.reason || null));
  }
  if (!regime || regime?.status === 'unavailable' || regime?.partial) {
    unavailableDomains.push(unavailableEntry('regime', regime?.status || 'unavailable', sourceFailures.regime || null));
  }
  if (regime?.marketBreadth?.status === 'unavailable') {
    unavailableDomains.push(unavailableEntry('marketBreadth', 'unavailable', regime.marketBreadth.reason || 'SOURCE_NOT_PROVISIONED'));
  }
  if (!opportunities || opportunities?.status === 'unavailable' || opportunities?.partial) {
    unavailableDomains.push(unavailableEntry('opportunity', opportunities?.status || 'unavailable', sourceFailures.opportunity || null));
  }
  if (!news || news?.status !== 'ok' || news?.partial) {
    unavailableDomains.push(unavailableEntry('news', news?.status === 'ok' ? 'partial' : 'unavailable', sourceFailures.news || null));
  }

  const dataAsOf = {
    portfolio: {
      marketUpdatedAt: portfolioAsOf,
      cashTimestamp: null
    },
    composition: {
      derivedFromPortfolioMarketUpdatedAt: portfolioAsOf
    },
    performance: performance ? {
      range: performance?.period?.range ?? null,
      endDate: performance?.period?.endDate ?? null
    } : null,
    regime: regime ? {
      fetchedAt: regime?.fetchedAt ?? null,
      inflationReferencePeriod: regime?.inflation?.referencePeriod ?? null,
      moneyMarketReferenceWeekEnd: regime?.moneyMarket?.referenceWeekEnd ?? null
    } : null,
    opportunity: opportunities ? {
      generatedAt: opportunities?.generatedAt ?? null,
      analysisRangeProxy: opportunities?.analysisRangeProxy ?? null
    } : null,
    news: news ? {
      dataAsOf: news?.dataAsOf ?? null
    } : null
  };

  const llmPacket = {
    methodologyVersion: AI_BRIEF_METHODOLOGY_VERSION,
    promptVersion: AI_BRIEF_PROMPT_VERSION,
    schemaVersion: AI_BRIEF_SCHEMA_VERSION,
    factPolicy: {
      closedPacket: true,
      calculationsAllowed: false,
      numericProseAllowed: false,
      recommendationsAllowed: false,
      newsIsUntrustedData: true
    },
    unavailableDomains,
    evidence,
    untrustedNews
  };
  const packetChars = JSON.stringify(llmPacket).length;
  if (packetChars > AI_BRIEF_MAX_PACKET_CHARS) {
    const error = new Error('Investment brief fact packet exceeds bounded input size');
    error.code = 'AI_BRIEF_PACKET_TOO_LARGE';
    throw error;
  }

  return {
    evidence,
    untrustedNews,
    unavailableDomains,
    dataAsOf,
    llmPacket,
    packetChars,
    partial: unavailableDomains.length > 0
  };
}

const digitOrFinancialSymbol = /[\p{N}%％₫$€£¥]/u;
const htmlPattern = /<\/?[a-z][^>]*>/iu;
const urlPattern = /(?:https?:\/\/|www\.)|(?:[a-z0-9-]+\.)+(?:com|net|org|vn)\b/iu;
const forbiddenRecommendationPattern = /(?:\b(?:buy|sell|hold)\b|\b(?:buy now|sell now|should buy|should sell|recommend(?:ed|ation)?)\b|\b(?:mua|bán)\b|(?:khuyến nghị|mục tiêu giá|giá mục tiêu|dự báo|dự đoán|xác suất|độ tin cậy|điểm cơ hội|điểm số|lợi nhuận kỳ vọng)|(?:nên|hãy|cần)\s+(?:mua|bán|giữ))/iu;
const spelledFinancialNumberPattern = /\b(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion|không|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười|mươi|trăm|nghìn|triệu|tỷ)\s+){1,8}(?:percent|per cent|phần trăm|đồng|vnd|usd|usdt)\b/iu;

export function validateInvestmentBriefSections(value, evidence) {
  const errors = [];
  const evidenceIds = new Set((Array.isArray(evidence) ? evidence : []).map((item) => item?.id));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['OUTPUT_NOT_OBJECT'], sections: null };
  }

  const keys = Object.keys(value);
  for (const key of keys) {
    if (!BRIEF_SECTION_KEYS.includes(key)) errors.push('UNKNOWN_SCHEMA_FIELD');
  }
  for (const key of BRIEF_SECTION_KEYS) {
    if (!Array.isArray(value[key])) errors.push(`MISSING_SECTION_${key}`);
  }
  if (errors.length > 0) return { valid: false, errors: [...new Set(errors)], sections: null };

  let statementCount = 0;
  let totalChars = 0;
  const sections = {};
  for (const key of BRIEF_SECTION_KEYS) {
    const maxItems = key === 'risksAndLimitations' ? 5 : 3;
    if (value[key].length > maxItems) errors.push('TOO_MANY_STATEMENTS');
    sections[key] = [];
    for (const statement of value[key]) {
      statementCount += 1;
      if (!statement || typeof statement !== 'object' || Array.isArray(statement)) {
        errors.push('INVALID_STATEMENT');
        continue;
      }
      if (Object.keys(statement).some((field) => !['text', 'evidenceIds'].includes(field))) {
        errors.push('UNKNOWN_STATEMENT_FIELD');
      }
      const text = nonEmptyString(statement.text);
      if (!text) errors.push('EMPTY_STATEMENT');
      if (text && text.length > 360) errors.push('STATEMENT_TOO_LONG');
      if (text && digitOrFinancialSymbol.test(text)) errors.push('NUMERIC_PROSE');
      if (text && spelledFinancialNumberPattern.test(text)) errors.push('NUMERIC_PROSE');
      const recommendationCheckText = text?.replace(
        /không\s+(?:phải\s+là\s+|đưa\s+ra\s+|tạo\s+)?(?:khuyến nghị|dự báo|dự đoán)(?:\s+(?:hay|hoặc)\s+(?:khuyến nghị|dự báo|dự đoán))?/giu,
        ''
      );
      if (recommendationCheckText && forbiddenRecommendationPattern.test(recommendationCheckText)) {
        errors.push('FORBIDDEN_INVESTMENT_LANGUAGE');
      }
      if (text && urlPattern.test(text)) errors.push('URL_IN_PROSE');
      if (text && htmlPattern.test(text)) errors.push('HTML_IN_PROSE');

      const refs = Array.isArray(statement.evidenceIds) ? statement.evidenceIds : [];
      if (refs.length === 0 || refs.length > 8) errors.push('INVALID_EVIDENCE_REFERENCE_COUNT');
      if (new Set(refs).size !== refs.length) errors.push('DUPLICATE_EVIDENCE_REFERENCE');
      if (refs.some((id) => typeof id !== 'string' || !evidenceIds.has(id))) errors.push('UNKNOWN_EVIDENCE_ID');
      if (key === 'newsContext' && refs.length > 0) {
        if (!refs.some((id) => id.startsWith('news.'))) errors.push('NEWS_WITHOUT_NEWS_EVIDENCE');
        if (text && !/(?:theo|nguồn|đưa tin|công bố|ghi nhận)/iu.test(text)) errors.push('NEWS_NOT_ATTRIBUTED');
      }
      totalChars += text?.length || 0;
      sections[key].push({ text: text || '', evidenceIds: [...refs] });
    }
  }
  if (statementCount > MAX_TOTAL_STATEMENTS) errors.push('OUTPUT_TOO_LONG');
  if (totalChars > MAX_TOTAL_PROSE_CHARS) errors.push('OUTPUT_TOO_LONG');
  return { valid: errors.length === 0, errors: [...new Set(errors)], sections: errors.length === 0 ? sections : null };
}

function evidenceIdSet(registry) {
  return new Set(registry.evidence.map((item) => item.id));
}

function refsThatExist(registry, ids) {
  const available = evidenceIdSet(registry);
  return ids.filter((id) => available.has(id));
}

function firstEvidenceIds(registry, prefix, limit = 2) {
  return registry.evidence.filter((item) => item.id.startsWith(prefix)).slice(0, limit).map((item) => item.id);
}

export function buildDeterministicBriefSections(registry) {
  const holdingsCount = registry.evidence.find((item) => item.id === 'portfolio.holdingsCount')?.value;
  const summaryRefs = refsThatExist(registry, ['portfolio.totalPortfolioValue', 'portfolio.cashAvailable', 'portfolio.holdingsCount']);
  const portfolioRefs = refsThatExist(registry, ['composition.cashWeightPct', 'composition.pricedAssetsWeightPct']);
  const concentrationRefs = refsThatExist(registry, ['composition.largestHolding.symbol', 'composition.largestHolding.weightPct']);
  const performanceRefs = refsThatExist(registry, ['performance.twr.returnPct', 'performance.drawdown.maxDrawdownPct']);
  const inflationRefs = refsThatExist(registry, ['regime.inflation.headlineCpiYoYPct', 'regime.inflation.threeMonthDeltaPp']);
  const moneyRefs = refsThatExist(registry, ['regime.moneyMarket.vndOvernightRatePct', 'regime.moneyMarket.trendPp']);
  const opportunityRefs = firstEvidenceIds(registry, 'opportunity.', 3).filter((id) => !id.endsWith('.status'));
  const newsRefs = firstEvidenceIds(registry, 'news.item', 3);
  const riskRefs = registry.unavailableDomains
    .flatMap((domain) => refsThatExist(registry, [`${domain.domain}.status`, `${domain.domain}.reason`]))
    .slice(0, 5);

  const sections = {
    summary: summaryRefs.length > 0 ? [{
      text: holdingsCount === 0
        ? 'Danh mục hiện chưa ghi nhận tài sản đang nắm giữ.'
        : 'Dữ liệu danh mục và tiền mặt đã được tổng hợp từ các nguồn xác định của hệ thống.',
      evidenceIds: summaryRefs
    }] : [],
    portfolioObservations: [],
    marketContext: [],
    opportunityEvidence: opportunityRefs.length > 0 ? [{
      text: 'Bằng chứng sàng lọc được trình bày riêng trong từng nhóm tài sản và chỉ mang tính mô tả.',
      evidenceIds: opportunityRefs
    }] : [],
    newsContext: newsRefs.length > 0 ? [{
      text: 'Theo các nguồn tin được liên kết với danh mục, nội dung gần đây được trình bày như bối cảnh chưa được ứng dụng xác minh độc lập.',
      evidenceIds: newsRefs
    }] : [],
    risksAndLimitations: []
  };
  if (portfolioRefs.length > 0) {
    sections.portfolioObservations.push({
      text: 'Cơ cấu tiền mặt và tài sản đã định giá được giữ theo đúng phạm vi định giá hiện có.',
      evidenceIds: portfolioRefs
    });
  }
  if (concentrationRefs.length > 0) {
    sections.portfolioObservations.push({
      text: 'Khoản nắm giữ có tỷ trọng lớn nhất là bằng chứng tập trung cần được quan sát cùng mức bao phủ định giá.',
      evidenceIds: concentrationRefs
    });
  }
  if (performanceRefs.length > 0) {
    sections.portfolioObservations.push({
      text: 'Hiệu suất và mức sụt giảm của danh mục được trình bày theo phương pháp định lượng hiện hành.',
      evidenceIds: performanceRefs
    });
  }
  if (inflationRefs.length > 0) {
    sections.marketContext.push({
      text: 'Bối cảnh lạm phát Việt Nam được giữ theo kỳ tham chiếu chính thức hiện có.',
      evidenceIds: inflationRefs
    });
  }
  if (moneyRefs.length > 0) {
    sections.marketContext.push({
      text: 'Bối cảnh thị trường tiền tệ chỉ phản ánh các quan sát chính thức đã được xác minh.',
      evidenceIds: moneyRefs
    });
  }
  if (riskRefs.length > 0) {
    sections.risksAndLimitations.push({
      text: 'Một phần dữ liệu đầu vào hiện chưa khả dụng và được giữ nguyên ở trạng thái thiếu.',
      evidenceIds: riskRefs
    });
  }
  sections.risksAndLimitations.push({
    text: 'Bản tin chỉ giải thích dữ kiện xác định và không phải là khuyến nghị hay dự báo đầu tư.',
    evidenceIds: ['brief.factBoundary']
  });

  return sections;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function investmentBriefFactHash(registry) {
  const fingerprint = {
    methodologyVersion: AI_BRIEF_METHODOLOGY_VERSION,
    promptVersion: AI_BRIEF_PROMPT_VERSION,
    schemaVersion: AI_BRIEF_SCHEMA_VERSION,
    model: AI_BRIEF_MODEL,
    evidence: registry.evidence,
    unavailableDomains: registry.unavailableDomains
  };
  return createHash('sha256').update(JSON.stringify(stableValue(fingerprint))).digest('hex');
}

export class InvestmentBriefRuntime {
  constructor() {
    this.cache = new Map();
    this.inflight = new Map();
    this.lastLiveAttemptAt = null;
    this.dailyKey = null;
    this.dailyAttempts = 0;
  }

  clear() {
    this.cache.clear();
    this.inflight.clear();
    this.lastLiveAttemptAt = null;
    this.dailyKey = null;
    this.dailyAttempts = 0;
  }

  getCached(key, nowMs, ttlMs) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (nowMs - entry.cachedAt > ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return structuredClone(entry.value);
  }

  setCached(key, value, nowMs) {
    this.cache.set(key, { value: structuredClone(value), cachedAt: nowMs });
  }

  reserveLiveAttempt(now, { cooldownMs, dailyLimit }) {
    const nowMs = now.getTime();
    if (this.lastLiveAttemptAt !== null && nowMs - this.lastLiveAttemptAt < cooldownMs) {
      const error = new Error('AI brief live-generation cooldown is active');
      error.code = 'AI_BRIEF_COOLDOWN';
      error.status = 429;
      throw error;
    }
    const dayKey = now.toISOString().slice(0, 10);
    if (this.dailyKey !== dayKey) {
      this.dailyKey = dayKey;
      this.dailyAttempts = 0;
    }
    if (this.dailyAttempts >= dailyLimit) {
      const error = new Error('AI brief daily generation budget is exhausted');
      error.code = 'AI_BRIEF_DAILY_LIMIT';
      error.status = 429;
      throw error;
    }
    this.lastLiveAttemptAt = nowMs;
    this.dailyAttempts += 1;
  }
}

export const globalInvestmentBriefRuntime = new InvestmentBriefRuntime();

function parseDailyLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : AI_BRIEF_DEFAULT_DAILY_LIMIT;
}

export function isAiBriefEnabled(value = process.env.AI_BRIEF_ENABLED) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function modelMetadata({ configuredEnabled, attempted, outputAccepted }) {
  return {
    provider: outputAccepted || attempted ? 'openai' : null,
    model: outputAccepted || attempted ? AI_BRIEF_MODEL : null,
    reasoningEffort: outputAccepted || attempted ? AI_BRIEF_REASONING_EFFORT : null,
    promptVersion: AI_BRIEF_PROMPT_VERSION,
    schemaVersion: AI_BRIEF_SCHEMA_VERSION,
    configuredEnabled,
    attempted,
    outputAccepted
  };
}

function briefResponse({ registry, sections, now, generationMode, status, model }) {
  return {
    methodologyVersion: AI_BRIEF_METHODOLOGY_VERSION,
    status,
    generationMode,
    generatedAt: now.toISOString(),
    model,
    dataAsOf: registry.dataAsOf,
    unavailableDomains: registry.unavailableDomains,
    sections,
    evidence: registry.evidence
  };
}

export async function generateInvestmentBriefFromRegistry({
  registry,
  now,
  runtime = globalInvestmentBriefRuntime,
  aiEnabled = isAiBriefEnabled(),
  apiKey = process.env.OPENAI_API_KEY,
  dailyLimit = parseDailyLimit(process.env.AI_BRIEF_DAILY_LIMIT),
  cooldownMs = AI_BRIEF_COOLDOWN_MS,
  cacheTtlMs = AI_BRIEF_CACHE_TTL_MS,
  generateLlmFn = generateOpenAiBrief
}) {
  requireNow(now);
  const configuredEnabled = aiEnabled === true;
  const hasApiKey = typeof apiKey === 'string' && apiKey.trim().length > 0;
  const fallback = ({ attempted = false } = {}) => briefResponse({
    registry,
    sections: buildDeterministicBriefSections(registry),
    now,
    generationMode: 'deterministic_fallback',
    status: 'fallback',
    model: modelMetadata({ configuredEnabled, attempted, outputAccepted: false })
  });

  if (!configuredEnabled || !hasApiKey) return fallback();

  const key = investmentBriefFactHash(registry);
  const nowMs = now.getTime();
  const cached = runtime.getCached(key, nowMs, cacheTtlMs);
  if (cached) return { ...cached, generationMode: 'cache' };

  const existing = runtime.inflight.get(key);
  if (existing) return existing;

  runtime.reserveLiveAttempt(now, { cooldownMs, dailyLimit });
  const promise = (async () => {
    try {
      const candidate = await generateLlmFn({ apiKey, factPacket: registry.llmPacket });
      const validation = validateInvestmentBriefSections(candidate, registry.evidence);
      if (!validation.valid) {
        const error = new Error('AI brief output failed deterministic validation');
        error.code = 'AI_BRIEF_OUTPUT_REJECTED';
        throw error;
      }
      const result = briefResponse({
        registry,
        sections: validation.sections,
        now,
        generationMode: 'llm',
        status: registry.partial ? 'partial' : 'available',
        model: modelMetadata({ configuredEnabled, attempted: true, outputAccepted: true })
      });
      runtime.setCached(key, result, nowMs);
      return result;
    } catch {
      return fallback({ attempted: true });
    } finally {
      runtime.inflight.delete(key);
    }
  })();
  runtime.inflight.set(key, promise);
  return promise;
}

function settled(promise, fallbackCode) {
  return Promise.resolve(promise).then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason, code: safeReason(reason, fallbackCode) })
  );
}

function unavailableBrief(now, reason, aiEnabled) {
  const configuredEnabled = aiEnabled === true;
  return {
    methodologyVersion: AI_BRIEF_METHODOLOGY_VERSION,
    status: 'unavailable',
    generationMode: 'deterministic_fallback',
    generatedAt: now.toISOString(),
    model: modelMetadata({ configuredEnabled, attempted: false, outputAccepted: false }),
    dataAsOf: {},
    unavailableDomains: [{ domain: 'portfolio', status: 'unavailable', reason }],
    sections: Object.fromEntries(BRIEF_SECTION_KEYS.map((key) => [key, []])),
    evidence: []
  };
}

export async function getInvestmentBrief({
  now,
  getPortfolioOverviewFn = getPortfolioOverview,
  calculatePortfolioCompositionFn = calculatePortfolioComposition,
  getPortfolioPerformanceFn = getPortfolioPerformance,
  getVietnamRegimeFn = getVietnamRegime,
  getOpportunitiesFn = getOpportunities,
  getPersonalizedNewsFeedFn = getPersonalizedNewsFeed,
  getNewsFeedFn = getNewsFeed,
  getAssetsFn = getAssets,
  getInvestorProfileFn = getInvestorProfile,
  getHoldingsFn = getHoldings,
  getWatchlistFn = getWatchlist,
  getAssetAnalysisFn = getAssetAnalysis,
  getMarketHistoryFn = getMarketHistory,
  runtime = globalInvestmentBriefRuntime,
  aiEnabled = isAiBriefEnabled(),
  apiKey = process.env.OPENAI_API_KEY,
  dailyLimit = parseDailyLimit(process.env.AI_BRIEF_DAILY_LIMIT),
  generateLlmFn = generateOpenAiBrief
} = {}) {
  requireNow(now);

  let portfolio;
  let composition;
  try {
    portfolio = await getPortfolioOverviewFn();
    composition = calculatePortfolioCompositionFn(portfolio);
  } catch (error) {
    return unavailableBrief(now, safeReason(error, 'PORTFOLIO_CORE_UNAVAILABLE'), aiEnabled);
  }

  const regimePromise = settled(getVietnamRegimeFn({ now }), 'REGIME_UNAVAILABLE');
  const newsPromise = settled(getPersonalizedNewsFeedFn({
    getNewsFeedFn,
    getHoldingsFn,
    getWatchlistFn
  }), 'PERSONALIZED_NEWS_UNAVAILABLE');
  const opportunityPromise = settled(getOpportunitiesFn({
    now,
    getAssetsFn,
    getInvestorProfileFn,
    getHoldingsFn,
    getWatchlistFn,
    getPortfolioCompositionFn: async () => composition,
    getAssetAnalysisFn: (symbol, options) => getAssetAnalysisFn(symbol, {
      ...options,
      getMarketHistoryFn
    }),
    getVietnamRegimeFn: async () => {
      const result = await regimePromise;
      if (result.status === 'fulfilled') return result.value;
      throw result.reason;
    }
  }), 'OPPORTUNITY_UNAVAILABLE');

  const [regimeResult, newsResult, opportunityResult] = await Promise.all([
    regimePromise,
    newsPromise,
    opportunityPromise
  ]);
  const performanceRange = opportunityResult.status === 'fulfilled'
    ? opportunityResult.value?.analysisRangeProxy || '3M'
    : '3M';
  const performanceResult = await settled(getPortfolioPerformanceFn({
    range: performanceRange,
    now,
    getMarketHistoryFn
  }), 'PERFORMANCE_UNAVAILABLE');

  const registry = buildInvestmentBriefFactRegistry({
    portfolio,
    composition,
    performance: performanceResult.status === 'fulfilled' ? performanceResult.value : null,
    regime: regimeResult.status === 'fulfilled' ? regimeResult.value : null,
    opportunities: opportunityResult.status === 'fulfilled' ? opportunityResult.value : null,
    news: newsResult.status === 'fulfilled' ? newsResult.value : null,
    sourceFailures: {
      performance: performanceResult.code,
      regime: regimeResult.code,
      opportunity: opportunityResult.code,
      news: newsResult.code
    },
    now
  });

  return generateInvestmentBriefFromRegistry({
    registry,
    now,
    runtime,
    aiEnabled,
    apiKey,
    dailyLimit,
    generateLlmFn
  });
}
