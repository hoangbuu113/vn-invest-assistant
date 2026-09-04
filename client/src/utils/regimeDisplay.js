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

  // Normalize raw pillars
  const rawPillars = payload?.pillars || {};
  const pillars = {
    macro: Array.isArray(rawPillars.macro) ? rawPillars.macro : [],
    monetary: Array.isArray(rawPillars.monetary) ? rawPillars.monetary : [],
    market: Array.isArray(rawPillars.market) ? rawPillars.market : [],
    intermarket: Array.isArray(rawPillars.intermarket) ? rawPillars.intermarket : []
  };

  // Normalize pulse metrics
  const rawPulse = Array.isArray(payload?.pulseMetrics) ? payload.pulseMetrics : [];
  const pulseMetrics = rawPulse.map((p) => ({
    id: p.id,
    factId: p.factId || p.id,
    label: p.label || p.id,
    value: finiteOrNull(p.value),
    unit: typeof p.unit === 'string' ? p.unit : '',
    unitType: p.unitType || null,
    change: finiteOrNull(p.change),
    changeUnit: typeof p.changeUnit === 'string' ? p.changeUnit : (p.unit || ''),
    changeUnitType: p.changeUnitType || null,
    changePercent: finiteOrNull(p.changePercent),
    volume: finiteOrNull(p.volume),
    volumeUnit: typeof p.volumeUnit === 'string' ? p.volumeUnit : null,
    source: typeof p.source === 'string' ? p.source : '',
    referenceTime: typeof p.referenceTime === 'string' ? p.referenceTime : null,
    status: p.status || 'available',
    freshness: p.freshness || 'fresh'
  })).filter((p) => p.value !== null);

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
    },
    pillars,
    pulseMetrics
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

export function formatMetricValue(value, unit = '') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';

  const cleanUnit = typeof unit === 'string' ? unit.trim() : '';

  if (cleanUnit === '%') {
    return formatRegimePercent(value);
  }

  if (cleanUnit === 'VND') {
    return new Intl.NumberFormat('vi-VN', {
      maximumFractionDigits: 0
    }).format(value) + ' VND';
  }

  if (cleanUnit === 'điểm') {
    return new Intl.NumberFormat('vi-VN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value) + ' điểm';
  }

  if (cleanUnit === 'USD/thùng' || cleanUnit === 'USD/oz') {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value) + ` ${cleanUnit}`;
  }

  if (cleanUnit === 'USD') {
    return '$' + new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  if (cleanUnit === 'CNY') {
    return new Intl.NumberFormat('vi-VN', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    }).format(value) + ' CNY';
  }

  return new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: 2
  }).format(value) + (cleanUnit ? ` ${cleanUnit}` : '');
}

export function formatMetricChange(change, changePercent, unit = '', unitType = null) {
  if (typeof change !== 'number' || !Number.isFinite(change)) return null;

  const sign = change > 0 ? '+' : '';
  const formattedChange = new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: 2
  }).format(change);

  const cleanUnit = typeof unit === 'string' ? unit.trim() : '';

  if (cleanUnit === 'điểm %' || unitType === 'percentage_point') {
    return `${sign}${formattedChange} điểm %`;
  }

  const unitSuffix = cleanUnit ? (cleanUnit === '%' ? '%' : ` ${cleanUnit}`) : '';

  if (typeof changePercent === 'number' && Number.isFinite(changePercent)) {
    const formattedPercent = new Intl.NumberFormat('vi-VN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(changePercent);
    return `${sign}${formattedChange}${unitSuffix} (${sign}${formattedPercent}%)`;
  }

  return `${sign}${formattedChange}${unitSuffix}`;
}
