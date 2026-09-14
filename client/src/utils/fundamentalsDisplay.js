export const FUNDAMENTALS_DISPLAY_METRICS = Object.freeze([
  Object.freeze({ code: 'netRevenue', label: 'Doanh thu thuần' }),
  Object.freeze({ code: 'grossProfit', label: 'Lợi nhuận gộp' }),
  Object.freeze({ code: 'netIncome', label: 'Lợi nhuận sau thuế' }),
  Object.freeze({ code: 'totalAssets', label: 'Tổng tài sản' }),
  Object.freeze({ code: 'totalLiabilities', label: 'Tổng nợ phải trả' }),
  Object.freeze({ code: 'equity', label: 'Vốn chủ sở hữu' }),
  Object.freeze({ code: 'operatingCashFlow', label: 'Lưu chuyển tiền thuần từ HĐKD' })
]);

const UNIT_LABELS = Object.freeze({
  1: '',
  1000: 'nghìn',
  1000000: 'triệu',
  1000000000: 'tỷ'
});

const SCOPE_LABELS = Object.freeze({
  CONSOLIDATED: 'Hợp nhất',
  SEPARATE: 'Riêng lẻ'
});

const AUDIT_LABELS = Object.freeze({
  UNAUDITED: 'Chưa kiểm toán',
  REVIEWED: 'Đã soát xét',
  AUDITED: 'Đã kiểm toán'
});

const AVAILABILITY_DISPLAY = Object.freeze({
  AVAILABLE: Object.freeze({
    label: 'Dữ liệu đã xác minh đầy đủ',
    badgeClass: 'badge-gain'
  }),
  PARTIAL: Object.freeze({
    label: 'Dữ liệu xác minh chưa đầy đủ',
    badgeClass: 'badge-warn'
  })
});

export function buildFundamentalsAvailabilityDisplay(availability) {
  return AVAILABILITY_DISPLAY[availability] || null;
}

export function formatDecimalText(value) {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) return '—';
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction] = unsigned.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped}${fraction ? `,${fraction}` : ''}`;
}

export function formatFundamentalFact(fact) {
  if (!fact || fact.validationStatus !== 'VERIFIED' || fact.numericValue === null) return '—';
  const numeric = formatDecimalText(fact.numericValue);
  if (numeric === '—') return numeric;
  const unit = UNIT_LABELS[fact.unitScale];
  if (unit === undefined || typeof fact.currencyCode !== 'string') return '—';
  return [numeric, unit, fact.currencyCode].filter(Boolean).join(' ');
}

export function buildFundamentalsPeriodDisplay(period) {
  if (!period) return null;
  const periodLabel = {
    ANNUAL: `Năm ${period.fiscalYear}`,
    QUARTER: `Quý ${period.fiscalQuarter ?? '—'}/${period.fiscalYear}`,
    YTD: `Lũy kế quý ${period.fiscalQuarter ?? '—'}/${period.fiscalYear}`,
    HALF_YEAR: `Bán niên ${period.fiscalYear}`,
    INSTANT: `Tại ngày ${period.periodEnd}`
  }[period.periodKind] || `${period.periodKind} ${period.fiscalYear}`;
  return Object.freeze({
    filingId: period.filingId,
    periodLabel,
    periodEnd: period.periodEnd,
    scopeLabel: SCOPE_LABELS[period.statementScope] || period.statementScope,
    auditLabel: AUDIT_LABELS[period.auditStatus] || period.auditStatus,
    revisionLabel: `Bản ${period.revisionNumber}`,
    source: period.source,
    publishedAt: period.publishedAt,
    metrics: FUNDAMENTALS_DISPLAY_METRICS.map(({ code, label }) => {
      const fact = period.facts?.[code] || null;
      const sourceLocation = fact ? [
        fact.sourceLineCode ? `mã dòng ${fact.sourceLineCode}` : null,
        fact.sourcePage ? `trang ${fact.sourcePage}` : null,
        fact.sourceSheet ? `sheet ${fact.sourceSheet}` : null,
        fact.sourceCell ? `ô ${fact.sourceCell}` : null
      ].filter(Boolean).join(' · ') : null;
      return Object.freeze({
        code,
        label,
        value: formatFundamentalFact(fact),
        sourceLabel: fact?.sourceLabel || null,
        sourceLocation,
        missingReason: fact?.numericValue === null ? fact.missingReason : null
      });
    })
  });
}
