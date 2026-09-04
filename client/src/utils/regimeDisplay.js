function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isUsableStatus(status) {
  return status === 'available' || status === 'insufficient_history' || status === 'stale';
}

export function buildVietnamRegimeViewModel(payload) {
  const inflation = payload?.inflation || {};
  const moneyMarket = payload?.moneyMarket || {};
  const breadth = payload?.marketBreadth || {};
  const inflationYoY = finiteOrNull(inflation.headlineCpiYoYPct);
  const inflationDelta = finiteOrNull(inflation.threeMonthDeltaPp);
  const overnightRate = finiteOrNull(moneyMarket.vndOvernightRatePct);
  const moneyHasSufficientHistory = moneyMarket.status === 'available' || (
    moneyMarket.status === 'stale' && moneyMarket.underlyingStatus === 'available'
  );

  return {
    partial: payload?.partial === true,
    fetchedAt: typeof payload?.fetchedAt === 'string' ? payload.fetchedAt : null,
    inflation: {
      status: inflation.status || 'unavailable',
      usable: isUsableStatus(inflation.status) && inflationYoY !== null,
      headlineCpiYoYPct: inflationYoY,
      threeMonthDeltaPp: inflationDelta,
      referencePeriod: typeof inflation.referencePeriod === 'string' ? inflation.referencePeriod : null,
      publishedAt: typeof inflation.publishedAt === 'string' ? inflation.publishedAt : null,
      source: inflation.provenance?.source || null,
      releaseUrl: inflation.provenance?.releaseUrl || null
    },
    moneyMarket: {
      status: moneyMarket.status || 'unavailable',
      usable: isUsableStatus(moneyMarket.status) && overnightRate !== null,
      vndOvernightRatePct: overnightRate,
      latest4WeekMeanPct: moneyHasSufficientHistory ? finiteOrNull(moneyMarket.latest4WeekMeanPct) : null,
      previous4WeekMeanPct: moneyHasSufficientHistory ? finiteOrNull(moneyMarket.previous4WeekMeanPct) : null,
      trendPp: moneyHasSufficientHistory ? finiteOrNull(moneyMarket.trendPp) : null,
      referenceWeekStart: typeof moneyMarket.referenceWeekStart === 'string' ? moneyMarket.referenceWeekStart : null,
      referenceWeekEnd: typeof moneyMarket.referenceWeekEnd === 'string' ? moneyMarket.referenceWeekEnd : null,
      source: moneyMarket.provenance?.source || null,
      releaseUrl: moneyMarket.provenance?.releaseUrl || null
    },
    marketBreadth: {
      status: breadth.status || 'unavailable',
      reason: breadth.reason || null
    }
  };
}

export function formatReferencePeriod(period) {
  const match = /^(\d{4})-(\d{2})$/.exec(period || '');
  return match ? `Tháng ${Number(match[2])}/${match[1]}` : 'Chưa xác định';
}

export function formatDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Chưa xác định';
}

export function formatRegimePercent(value, { signed = false, suffix = '%' } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const formatted = new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    signDisplay: signed ? 'exceptZero' : 'auto'
  }).format(value);
  return `${formatted} ${suffix}`;
}
