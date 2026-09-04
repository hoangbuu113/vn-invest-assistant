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

  // Support both new market strategist shape and legacy brief shape
  const isStrategist = Boolean(data.marketOverview && data.investmentOrientation);

  if (!isStrategist) {
    return null;
  }

  const stance = data.investmentOrientation?.stance || 'neutral';
  const stanceLabel = formatStrategistStance(stance);
  const stanceClass = STANCE_CLASSES[stance] || 'stance-neutral';

  const isLlm = data.generationMode === 'llm' || data.generationMode === 'live_ai' || data.generationMode === 'gemini';
  const isCache = data.generationMode === 'cache';
  const isFallback = data.generationMode === 'deterministic_fallback' || !data.generationMode;

  const badgeLabel = isLlm ? 'AI Tổng hợp' : isCache ? 'AI Lưu tạm' : 'Tóm tắt dữ liệu';
  const modeLabel = isLlm
    ? 'AI tổng hợp từ dữ kiện đã kiểm chứng'
    : isCache
      ? 'Bản AI lưu tạm từ dữ kiện tương ứng'
      : 'Bản tóm tắt xác định — AI trực tiếp chưa được sử dụng';

  const fallbackNotice = isFallback
    ? 'Bản tóm tắt hiện được tạo từ dữ liệu đã xác minh.'
    : null;

  const generatedAt = data.generatedAt ? formatPublishedTime(data.generatedAt) : 'Vừa xong';

  return {
    isStrategist: true,
    badgeLabel,
    modeLabel,
    fallbackNotice,
    generatedAt,
    marketOverview: {
      vietnam: data.marketOverview?.vietnam || '',
      global: data.marketOverview?.global || ''
    },
    keyDrivers: Array.isArray(data.keyDrivers) ? data.keyDrivers : [],
    investmentOrientation: {
      stance,
      stanceLabel,
      stanceClass,
      preferredThemes: Array.isArray(data.investmentOrientation?.preferredThemes)
        ? data.investmentOrientation.preferredThemes
        : [],
      pressuredThemes: Array.isArray(data.investmentOrientation?.pressuredThemes)
        ? data.investmentOrientation.pressuredThemes
        : [],
      rationale: data.investmentOrientation?.rationale || '',
      evidenceIds: Array.isArray(data.investmentOrientation?.evidenceIds)
        ? data.investmentOrientation.evidenceIds
        : []
    },
    risksAndInvalidation: {
      keyRisks: Array.isArray(data.risksAndInvalidation?.keyRisks)
        ? data.risksAndInvalidation.keyRisks
        : [],
      invalidationConditions: Array.isArray(data.risksAndInvalidation?.invalidationConditions)
        ? data.risksAndInvalidation.invalidationConditions
        : [],
      evidenceIds: Array.isArray(data.risksAndInvalidation?.evidenceIds)
        ? data.risksAndInvalidation.evidenceIds
        : []
    },
    watchNext: Array.isArray(data.watchNext) ? data.watchNext : [],
    citations: data.citations || { factObservationIds: [], articleIds: [] },
    evidence: Array.isArray(data.evidence) ? data.evidence : []
  };
}
