import {
  formatNativeAmount,
  formatPercentVN,
  formatPublishedTime,
  formatVNDReporting
} from './formatting.js';

export const INVESTMENT_BRIEF_SECTION_ORDER = Object.freeze([
  ['summary', 'Tóm tắt'],
  ['portfolioObservations', 'Quan sát danh mục'],
  ['marketContext', 'Bối cảnh thị trường'],
  ['opportunityEvidence', 'Bằng chứng sàng lọc'],
  ['newsContext', 'Bối cảnh tin tức'],
  ['risksAndLimitations', 'Rủi ro và giới hạn dữ liệu']
]);

export const INITIAL_INVESTMENT_BRIEF_STATE = Object.freeze({
  phase: 'idle',
  data: null,
  error: null
});

export function reduceInvestmentBriefState(state, action) {
  switch (action?.type) {
    case 'start':
      return { phase: 'loading', data: state?.data ?? null, error: null };
    case 'success':
      return { phase: 'success', data: action.data, error: null };
    case 'error':
      return { phase: 'error', data: state?.data ?? null, error: action.error || 'Không thể tạo bản tin lúc này.' };
    case 'reset':
      return { ...INITIAL_INVESTMENT_BRIEF_STATE };
    default:
      return state || { ...INITIAL_INVESTMENT_BRIEF_STATE };
  }
}

function formatPlainNumber(value) {
  return Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 6 });
}

export function formatInvestmentBriefEvidence(item) {
  if (!item || item.value === null || item.value === undefined || item.status === 'unavailable') return 'Chưa khả dụng';
  const { value, unit } = item;
  if (unit === 'VND') return formatVNDReporting(value);
  if (unit === 'USD' || unit === 'USDT') return formatNativeAmount(value, unit);
  if (unit === 'percent') return formatPercentVN(value, false);
  if (unit === 'percentage_point') return formatPercentVN(value, false).replace('%', ' điểm %');
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'number') return formatPlainNumber(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) => entry?.symbol || entry?.name)
      .filter(Boolean)
      .join(', ') || 'Không có';
  }
  if (typeof value === 'object') {
    if (value.symbol) {
      const rank = value.descriptiveRank === null || value.descriptiveRank === undefined
        ? ''
        : ` · hạng ${value.descriptiveRank}`;
      const currency = value.quoteCurrency ? ` · ${value.quoteCurrency}` : '';
      const metrics = value.metrics && typeof value.metrics === 'object'
        ? [
          ['Thay đổi giá', value.metrics.priceChangePct, 'percent'],
          ['Tỷ lệ chuyển tiếp dương', value.metrics.positiveCloseTransitionRatio, 'ratio'],
          ['Biến động ngày', value.metrics.dailyVolatilityPct, 'percent'],
          ['Sụt giảm tối đa', value.metrics.maxDrawdownPct, 'percent'],
          ['Vị trí trong vùng giá đóng cửa', value.metrics.completedCloseRangePositionPct, 'percent'],
          ['Khoảng cách dưới đỉnh đóng cửa', value.metrics.distanceBelowHighestCompletedClosePct, 'percent']
        ]
          .filter(([, metricValue]) => typeof metricValue === 'number' && Number.isFinite(metricValue))
          .map(([label, metricValue, metricUnit]) => (
            `${label}: ${metricUnit === 'percent' ? formatPercentVN(metricValue, false) : formatPlainNumber(metricValue)}`
          ))
        : [];
      return [`${value.symbol}${rank}${currency}`, ...metrics].join(' · ');
    }
    if (value.title) return `${value.title}${value.source ? ` · ${value.source}` : ''}`;
    return 'Dữ liệu có cấu trúc';
  }
  return String(value);
}

export function formatInvestmentBriefAsOf(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Chưa có thời điểm';
  const trimmed = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const monthOnly = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (monthOnly) return `${monthOnly[2]}/${monthOnly[1]}`;
  return formatPublishedTime(trimmed);
}

export function investmentBriefModeLabel(data) {
  if (data?.generationMode === 'llm' && data?.model?.outputAccepted) {
    return 'AI giải thích dữ kiện đã kiểm chứng';
  }
  if (data?.generationMode === 'cache' && data?.model?.outputAccepted) {
    return 'Bản AI đã lưu từ dữ kiện tương ứng';
  }
  if (data?.generationMode === 'cache') {
    return 'Bản tóm tắt quy tắc đã lưu';
  }
  return 'Bản tóm tắt xác định — AI trực tiếp chưa được sử dụng';
}

export function buildInvestmentBriefViewModel(data) {
  if (!data || typeof data !== 'object') return null;
  const evidenceMap = new Map(
    (Array.isArray(data.evidence) ? data.evidence : [])
      .filter((item) => typeof item?.id === 'string')
      .map((item) => [item.id, item])
  );
  const sections = INVESTMENT_BRIEF_SECTION_ORDER.map(([id, label]) => ({
    id,
    label,
    statements: (Array.isArray(data.sections?.[id]) ? data.sections[id] : []).map((statement) => ({
      text: statement?.text || '',
      evidence: (Array.isArray(statement?.evidenceIds) ? statement.evidenceIds : [])
        .map((evidenceId) => evidenceMap.get(evidenceId))
        .filter(Boolean)
    }))
  })).filter((section) => section.statements.length > 0);

  const dataAsOf = Object.entries(data.dataAsOf || {}).flatMap(([domain, value]) => {
    if (!value || typeof value !== 'object') return [];
    const timestamp = value.marketUpdatedAt
      || value.endDate
      || value.fetchedAt
      || value.generatedAt
      || value.dataAsOf
      || value.inflationReferencePeriod
      || null;
    return timestamp ? [{ domain, value: formatInvestmentBriefAsOf(timestamp) }] : [];
  });

  return {
    status: data.status || 'unavailable',
    generationMode: data.generationMode || 'deterministic_fallback',
    modeLabel: investmentBriefModeLabel(data),
    generatedAt: formatPublishedTime(data.generatedAt),
    sections,
    dataAsOf,
    unavailableDomains: Array.isArray(data.unavailableDomains) ? data.unavailableDomains : [],
    liveAiEnabled: data?.model?.configuredEnabled === true,
    liveAiUsed: data?.model?.outputAccepted === true
  };
}
