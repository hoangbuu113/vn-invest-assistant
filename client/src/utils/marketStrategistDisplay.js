import {
  formatNativeAmount,
  formatPercentVN,
  formatPublishedTime,
  formatVNDReporting
} from './formatting.js';

export const STANCE_LABELS = Object.freeze({
  defensive: 'Phòng thủ',
  neutral: 'Trung lập',
  selective_risk_on: 'Tấn công chọn lọc',
  risk_on: 'Tấn công'
});

export const STANCE_CLASSES = Object.freeze({
  defensive: 'stance-defensive',
  neutral: 'stance-neutral',
  selective_risk_on: 'stance-selective-risk-on',
  risk_on: 'stance-risk-on'
});

export const CONVICTION_LABELS = Object.freeze({
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  insufficient_evidence: 'Chưa đủ dữ liệu'
});

export const CONFIDENCE_LABELS = Object.freeze({
  HIGH: 'Cao',
  MEDIUM: 'Trung bình',
  LOW: 'Thấp',
  INSUFFICIENT_EVIDENCE: 'Chưa đủ dữ liệu'
});

export const ASSET_CLASS_LABELS = Object.freeze({
  vietnam_equities: 'VN Cổ phiếu',
  gold: 'Vàng',
  usd: 'USD / Ngoại tệ',
  crypto: 'Crypto',
  cash: 'Tiền mặt'
});

export const ASSET_STANCE_LABELS = Object.freeze({
  increase: '↑ Tăng tỷ trọng',
  hold: '→ Giữ vị thế',
  reduce: '↓ Giảm tỷ trọng',
  avoid: '✕ Tránh / Hạn chế',
  watch: '◎ Quan sát'
});

export const ASSET_STANCE_CLASSES = Object.freeze({
  increase: 'asset-stance-increase',
  hold: 'asset-stance-hold',
  reduce: 'asset-stance-reduce',
  avoid: 'asset-stance-avoid',
  watch: 'asset-stance-watch'
});

export const PRIORITY_LABELS = Object.freeze({
  high: 'Cao',
  medium: 'Vừa',
  low: 'Thấp'
});

export function formatStrategistStance(stance) {
  return STANCE_LABELS[stance] || 'Trung lập';
}

export function formatEvidenceValue(item) {
  if (!item || item.value === null || item.value === undefined || item.status === 'unavailable') {
    return 'Chưa khả dụng';
  }
  const { value, unit } = item;
  if (unit === 'VND') return formatVNDReporting(value);
  if (unit === 'USD' || unit === 'USDT') return formatNativeAmount(value, unit);
  if (unit === 'USD/thùng') return `$${Number(value).toFixed(2)}/thùng`;
  if (unit === 'USD/oz') return `$${Number(value).toLocaleString('vi-VN')}/oz`;
  if (unit === 'CNY') return `${Number(value).toFixed(4)} CNY`;
  if (unit === 'điểm') return `${Number(value).toLocaleString('vi-VN')} điểm`;
  if (unit === 'percent' || unit === '%') return formatPercentVN(value, false);
  if (unit === 'percentage_point' || unit === 'điểm %') return formatPercentVN(value, false).replace('%', ' điểm %');
  if (typeof value === 'number') return Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 4 });
  return String(value);
}

export function buildMarketStrategistViewModel(raw) {
  const data = raw?.data || raw;
  if (!data || typeof data !== 'object') return null;

  // Support structured brief, new strategist shape, and legacy brief shape
  const isStrategist = Boolean(
    (data.brief || data.marketOverview) &&
    (data.executiveDecision || data.investmentOrientation || data.marketView)
  );

  if (!isStrategist) {
    return null;
  }

  const stance = data.executiveDecision?.stance || data.investmentOrientation?.stance || data.marketView?.stance || 'neutral';
  const stanceLabel = formatStrategistStance(stance);
  const stanceClass = STANCE_CLASSES[stance] || 'stance-neutral';

  const conviction = data.executiveDecision?.conviction || data.marketView?.conviction || 'medium';
  const convictionLabel = CONVICTION_LABELS[conviction] || 'Trung bình';

  const isLlm = data.generationMode === 'llm' || data.generationMode === 'live_ai' || data.generationMode === 'gemini';
  const isCache = data.generationMode === 'cache';
  const isFallback = data.generationMode === 'deterministic_fallback' || !data.generationMode;

  const badgeLabel = isLlm ? 'AI Chiến lược' : isCache ? 'Dữ kiện lưu tạm' : 'Chiến lược xác định';
  const modeLabel = isLlm
    ? 'AI chiến lược gia tổng hợp từ dữ kiện đã kiểm chứng'
    : isCache
      ? 'Bản chiến lược từ dữ kiện thị trường tương ứng'
      : 'Chiến lược thị trường từ dữ kiện kinh tế và liên thị trường đã kiểm chứng';

  const fallbackNotice = isFallback
    ? 'Bản chiến lược hiện được tạo từ dữ liệu đã xác minh.'
    : null;
  const generationBadge = isLlm ? 'AI Live' : isCache ? 'Cache' : 'Xác định';

  const generatedAt = data.generatedAt ? formatPublishedTime(data.generatedAt) : 'Vừa xong';

  const confidence = data.executiveDecision?.confidence || data.confidence || (conviction === 'insufficient_evidence' ? 'INSUFFICIENT_EVIDENCE' : 'MEDIUM');
  const confidenceLabel = CONFIDENCE_LABELS[confidence] || 'Trung bình';

  const executiveDecision = {
    stance,
    stanceLabel,
    stanceClass,
    conviction,
    convictionLabel,
    confidence,
    confidenceLabel,
    oneLineDecision: data.executiveDecision?.oneLineDecision || data.marketView?.headline || data.investmentOrientation?.rationale || '',
    actionNow: data.executiveDecision?.actionNow || data.marketView?.explanation || data.investmentOrientation?.rationale || ''
  };

  const rawAssetStrategy = Array.isArray(data.assetStrategy) ? data.assetStrategy : [];
  const assetStrategy = rawAssetStrategy.map((item) => ({
    assetClass: item.assetClass,
    assetClassLabel: ASSET_CLASS_LABELS[item.assetClass] || item.assetClass,
    stance: item.stance,
    stanceLabel: ASSET_STANCE_LABELS[item.stance] || item.stance,
    stanceClass: ASSET_STANCE_CLASSES[item.stance] || 'asset-stance-watch',
    priority: item.priority || 'medium',
    priorityLabel: PRIORITY_LABELS[item.priority] || 'Vừa',
    rationale: item.rationale || '',
    evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds : []
  }));

  const preferredThemes = Array.isArray(data.preferredThemes)
    ? data.preferredThemes.map((item) => typeof item === 'string'
      ? { theme: item, stance: 'prefer', rationale: '', evidenceIds: [] }
      : item
    )
    : [];

  const avoidOrUnderweight = Array.isArray(data.avoidOrUnderweight)
    ? data.avoidOrUnderweight.map((item) => typeof item === 'string'
      ? { theme: item, reason: '', evidenceIds: [] }
      : item
    )
    : [];

  const keyDrivers = Array.isArray(data.keyDrivers) ? data.keyDrivers : [];
  const rawWatchNext = Array.isArray(data.watchNext) ? data.watchNext : [];

  const brief = data.brief || null;
  const rawMarketView = data.marketView || brief?.marketView || null;
  const rawWhy = data.why || brief?.why || null;
  const rawWhatChanged = data.whatChanged || brief?.whatChanged || null;
  const rawRisks = data.risks || brief?.risks || null;
  const rawWhatToWatch = data.whatToWatch || brief?.whatToWatch || null;
  const rawDataContext = data.dataContext || brief?.dataContext || null;
  const rawSources = data.sources || brief?.sources || null;

  const marketView = {
    stance,
    stanceLabel,
    stanceClass,
    conviction,
    convictionLabel,
    confidence,
    confidenceLabel,
    headline: rawMarketView?.headline || executiveDecision.oneLineDecision,
    explanation: rawMarketView?.explanation || executiveDecision.actionNow
  };

  const why = {
    factors: Array.isArray(rawWhy?.factors)
      ? rawWhy.factors
      : keyDrivers.map((k) => ({ factor: k.driver, evidenceIds: k.evidenceIds || [], signalIds: k.signalIds || [] })),
    summary: rawWhy?.summary || (keyDrivers[0]?.driver || '')
  };

  const whatChanged = {
    hasMaterialChange: Boolean(rawWhatChanged?.hasMaterialChange),
    materialChanges: Array.isArray(rawWhatChanged?.materialChanges)
      ? rawWhatChanged.materialChanges
      : (Array.isArray(data.materialChanges) ? data.materialChanges : []),
    summary: rawWhatChanged?.summary || (data.latestAssessmentResult === 'KEEP' ? 'Quan điểm thị trường tiếp tục được bảo lưu ổn định.' : '')
  };

  const risks = {
    keyRisks: Array.isArray(rawRisks?.keyRisks)
      ? rawRisks.keyRisks
      : (Array.isArray(data.risksAndInvalidation?.keyRisks) ? data.risksAndInvalidation.keyRisks : []),
    invalidationConditions: Array.isArray(rawRisks?.invalidationConditions)
      ? rawRisks.invalidationConditions
      : (Array.isArray(data.risksAndInvalidation?.invalidationConditions) ? data.risksAndInvalidation.invalidationConditions : [])
  };

  const whatToWatch = {
    items: Array.isArray(rawWhatToWatch?.items)
      ? rawWhatToWatch.items
      : rawWatchNext.map((w) => typeof w === 'string' ? { item: w, priority: 'medium', monitorCadence: 'daily' } : w)
  };

  const evidenceCoverage = data.evidenceCoverage || null;
  const dataAsOf = data.dataAsOf || evidenceCoverage?.dataAsOf || rawDataContext?.dataAsOf || null;
  const hasMixedCadence = Boolean(evidenceCoverage?.hasMixedCadence || rawDataContext?.hasMixedCadence);
  const dataAsOfLabel = dataAsOf ? `Dữ liệu mới nhất: ${formatPublishedTime(dataAsOf)}` : null;
  const mixedCadenceNotice = hasMixedCadence ? 'Nguồn có độ trễ khác nhau' : null;
  const cadenceLimitations = Array.isArray(evidenceCoverage?.cadenceLimitations)
    ? evidenceCoverage.cadenceLimitations
    : (Array.isArray(rawDataContext?.limitations) ? rawDataContext.limitations : []);

  const dataContext = {
    dataAsOf,
    freshness: rawDataContext?.freshness || (isFallback ? 'Đã xác thực' : 'Trực tiếp'),
    hasMixedCadence,
    limitations: cadenceLimitations
  };

  const evidence = Array.isArray(data.evidence) && data.evidence.length > 0
    ? data.evidence
    : (Array.isArray(rawSources?.evidence) ? rawSources.evidence : []);

  return {
    isStrategist: true,
    runId: data.runId || null,
    strategyId: data.strategyId || null,
    dataAsOf,
    dataAsOfLabel,
    hasMixedCadence,
    mixedCadenceNotice,
    cadenceLimitations,
    evidenceCoverage,
    badgeLabel,
    generationBadge,
    modeLabel,
    fallbackNotice,
    generatedAt,
    executiveDecision,
    brief,
    marketView,
    why,
    whatChanged,
    risks,
    whatToWatch,
    dataContext,
    assetStrategy,
    preferredThemes,
    avoidOrUnderweight,
    marketOverview: {
      vietnam: data.marketOverview?.vietnam || '',
      global: data.marketOverview?.global || ''
    },
    keyDrivers,
    investmentOrientation: {
      stance,
      stanceLabel,
      stanceClass,
      preferredThemes: preferredThemes.map((t) => t.theme),
      pressuredThemes: avoidOrUnderweight.map((t) => t.theme),
      rationale: executiveDecision.actionNow || executiveDecision.oneLineDecision,
      evidenceIds: Array.isArray(data.investmentOrientation?.evidenceIds)
        ? data.investmentOrientation.evidenceIds
        : []
    },
    risksAndInvalidation: {
      keyRisks: risks.keyRisks,
      invalidationConditions: risks.invalidationConditions,
      evidenceIds: Array.isArray(data.risksAndInvalidation?.evidenceIds)
        ? data.risksAndInvalidation.evidenceIds
        : []
    },
    watchNext: whatToWatch.items,
    citations: data.citations || rawSources?.citations || { factObservationIds: [], articleIds: [] },
    evidence
  };
}
