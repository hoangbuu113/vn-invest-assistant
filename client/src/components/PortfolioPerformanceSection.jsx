import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { formatPercentVN, formatVNDReporting } from '../utils/formatting.js';
import { apiFetch } from '../utils/api.js';
import { getPerformanceEmptyStateGuidance } from '../utils/portfolioOnboarding.js';

const PERFORMANCE_RANGES = ['1W', '1M', '3M', '6M', '1Y'];

const BENCHMARK_OPTIONS = [
  { id: 'VN_INDEX', label: 'VN-Index' },
  { id: 'SP500', label: 'S&P 500' }
];

const REASON_MESSAGES = {
  PORTFOLIO_NOT_ACTIVATED: 'Chưa có mốc bắt đầu để tính hiệu suất danh mục.',
  NO_STARTING_VALUATION: 'Chưa có định giá đầu kỳ phù hợp để tính hiệu suất.',
  INSUFFICIENT_DATE_SPAN: 'Khoảng thời gian hiện chưa có đủ dữ liệu hoàn chỉnh.',
  INSUFFICIENT_COMMON_DATES: 'Chưa có đủ ngày chung để so sánh với chỉ số tham chiếu.',
  INCOMPLETE_VALUATION_COVERAGE: 'Một số ngày trong kỳ chưa có đủ dữ liệu định giá.',
  NON_VND_HISTORICAL_FX_UNAVAILABLE: 'Chưa thể tính hiệu suất VND đầy đủ cho tài sản ngoại tệ vì chưa có lịch sử tỷ giá tương ứng.',
  NON_VND_OR_MISSING_END_PRICE: 'Lãi/lỗ cuối kỳ chưa đầy đủ do tài sản ngoại tệ hoặc thiếu giá cuối kỳ.',
  ZERO_STARTING_VALUATION: 'Giá trị danh mục đầu kỳ bằng 0 nên chưa thể tính hiệu suất.',
  ZERO_CAPITAL_BREAK: 'Có thời điểm vốn danh mục bằng 0 nên chuỗi hiệu suất bị gián đoạn.',
  TWR_UNAVAILABLE: 'Hiệu suất danh mục hiện chưa khả dụng để so sánh.',
  TWR_NON_NUMERIC: 'Hiệu suất danh mục hiện chưa khả dụng để so sánh.',
  PORTFOLIO_PERFORMANCE_UNAVAILABLE: 'Hiệu suất danh mục hiện chưa khả dụng để so sánh.',
  PORTFOLIO_PERIOD_UNAVAILABLE: 'Khoảng thời gian danh mục hiện chưa khả dụng để so sánh.',
  HISTORICAL_FX_UNAVAILABLE: 'Chưa có dữ liệu tỷ giá lịch sử phù hợp.',
  NO_SIGN_CHANGE: 'Dòng tiền trong kỳ chưa tạo được nghiệm lợi suất theo dòng tiền.',
  NO_SOLUTION: 'Chưa thể xác định lợi suất theo dòng tiền cho kỳ này.'
};

function getReasonMessage(reason, fallback = 'Dữ liệu hiện chưa khả dụng.') {
  if (!reason) return fallback;
  return REASON_MESSAGES[reason] || fallback;
}

function getStatusMeta(status) {
  switch (status) {
    case 'available':
      return { label: 'Sẵn sàng', className: 'performance-status-available' };
    case 'partial':
      return { label: 'Dữ liệu một phần', className: 'performance-status-partial' };
    case 'insufficient_data':
      return { label: 'Chưa đủ dữ liệu', className: 'performance-status-insufficient' };
    default:
      return { label: 'Chưa khả dụng', className: 'performance-status-unavailable' };
  }
}

function formatDateKey(value) {
  if (typeof value !== 'string') return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function formatIndex(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
}

function formatSignedVnd(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (value === 0) return formatVNDReporting(0);
  return `${value > 0 ? '+' : '−'}${formatVNDReporting(Math.abs(value))}`;
}

async function fetchApiData(url, signal) {
  const response = await apiFetch(url, { signal });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The HTTP status below remains the authoritative transient-error signal.
  }

  if (!response.ok || payload?.status !== 'ok' || !payload?.data) {
    const error = new Error(payload?.message || `HTTP ${response.status}`);
    error.code = payload?.code || null;
    error.status = response.status;
    throw error;
  }

  return payload.data;
}

function buildChartGeometry(points, fields, width = 820, height = 260) {
  const padding = { top: 22, right: 22, bottom: 34, left: 52 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = points.flatMap((point) => fields
    .map((field) => point[field])
    .filter((value) => typeof value === 'number' && Number.isFinite(value)));

  if (points.length < 2 || values.length < 2) return null;

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = Math.max(rawMax - rawMin, Math.abs(rawMax) * 0.01, 1);
  const min = rawMin - span * 0.12;
  const max = rawMax + span * 0.12;
  const x = (index) => padding.left + (index / (points.length - 1)) * plotWidth;
  const y = (value) => padding.top + ((max - value) / (max - min)) * plotHeight;
  const paths = Object.fromEntries(fields.map((field) => [
    field,
    points
      .map((point, index) => {
        const value = point[field];
        return typeof value === 'number' && Number.isFinite(value)
          ? `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`
          : '';
      })
      .filter(Boolean)
      .join(' ')
  ]));
  const ticks = Array.from({ length: 4 }, (_, index) => {
    const value = min + ((max - min) * index) / 3;
    return { value, y: y(value) };
  }).reverse();

  return { width, height, padding, plotWidth, plotHeight, min, max, x, y, paths, ticks };
}

function PerformanceChart({ series, status, reason }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const points = useMemo(
    () => (Array.isArray(series) ? series : []).filter((point) => (
      point?.date && typeof point.twrIndex === 'number' && Number.isFinite(point.twrIndex)
    )),
    [series]
  );
  const geometry = useMemo(() => buildChartGeometry(points, ['twrIndex']), [points]);

  useEffect(() => setActiveIndex(null), [series]);

  if (status !== 'available' || !geometry) {
    return (
      <div className="performance-chart-empty">
        <span className="performance-chart-empty-icon">⌁</span>
        <strong>Chưa có đường hiệu suất</strong>
        <span>{getReasonMessage(reason, 'Cần ít nhất hai điểm hiệu suất hợp lệ trong kỳ.')}</span>
      </div>
    );
  }

  const activePoint = activeIndex === null ? null : points[activeIndex];
  const handlePointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - rect.left) / rect.width) * geometry.width;
    const relative = (pointerX - geometry.padding.left) / geometry.plotWidth;
    const index = Math.max(0, Math.min(points.length - 1, Math.round(relative * (points.length - 1))));
    setActiveIndex(index);
  };

  const areaPath = `${geometry.paths.twrIndex} L ${geometry.x(points.length - 1)} ${geometry.height - geometry.padding.bottom} L ${geometry.x(0)} ${geometry.height - geometry.padding.bottom} Z`;

  return (
    <div className="performance-chart-shell">
      <div className="performance-chart-readout" aria-live="polite">
        {activePoint ? (
          <>
            <strong>{formatDateKey(activePoint.date)}</strong>
            <span>Chỉ số hiệu suất {formatIndex(activePoint.twrIndex)}</span>
            <span>Giá trị danh mục {formatVNDReporting(activePoint.portfolioValueVnd)}</span>
            <span>Dòng tiền ròng {formatSignedVnd(activePoint.netExternalFlowVnd)}</span>
          </>
        ) : (
          <span>Di chuột hoặc chạm vào biểu đồ để xem giá trị cuối ngày và dòng tiền ròng.</span>
        )}
      </div>
      <div className="performance-svg-scroll">
        <svg
          className="performance-line-chart"
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          role="img"
          aria-label="Đường hiệu suất danh mục theo chỉ số TWR cuối ngày"
          onPointerMove={handlePointer}
          onPointerLeave={() => setActiveIndex(null)}
        >
          <defs>
            <linearGradient id="portfolioPerformanceArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.01" />
            </linearGradient>
            <filter id="portfolioPerformanceGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#2563eb" floodOpacity="0.2" />
            </filter>
          </defs>
          {geometry.ticks.map((tick) => (
            <g key={tick.value}>
              <line
                x1={geometry.padding.left}
                x2={geometry.width - geometry.padding.right}
                y1={tick.y}
                y2={tick.y}
                className="performance-grid-line"
              />
              <text x={geometry.padding.left - 10} y={tick.y + 4} textAnchor="end" className="performance-axis-label">
                {formatIndex(tick.value)}
              </text>
            </g>
          ))}
          <path d={areaPath} fill="url(#portfolioPerformanceArea)" />
          <path d={geometry.paths.twrIndex} className="performance-primary-line" filter="url(#portfolioPerformanceGlow)" />
          {activePoint && (
            <g>
              <line
                x1={geometry.x(activeIndex)}
                x2={geometry.x(activeIndex)}
                y1={geometry.padding.top}
                y2={geometry.height - geometry.padding.bottom}
                className="performance-cursor-line"
              />
              <circle
                cx={geometry.x(activeIndex)}
                cy={geometry.y(activePoint.twrIndex)}
                r="5"
                className="performance-active-dot"
              />
            </g>
          )}
          <text x={geometry.padding.left} y={geometry.height - 9} textAnchor="start" className="performance-axis-label">
            {formatDateKey(points[0].date)}
          </text>
          <text x={geometry.width - geometry.padding.right} y={geometry.height - 9} textAnchor="end" className="performance-axis-label">
            {formatDateKey(points.at(-1).date)}
          </text>
        </svg>
      </div>
    </div>
  );
}

function BenchmarkChart({ data, selectedBenchmark }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const points = useMemo(
    () => (Array.isArray(data?.series) ? data.series : []).filter((point) => (
      point?.date
      && typeof point.portfolioBase100 === 'number'
      && Number.isFinite(point.portfolioBase100)
      && typeof point.benchmarkBase100 === 'number'
      && Number.isFinite(point.benchmarkBase100)
    )),
    [data]
  );
  const geometry = useMemo(
    () => buildChartGeometry(points, ['portfolioBase100', 'benchmarkBase100']),
    [points]
  );

  useEffect(() => setActiveIndex(null), [data, selectedBenchmark]);

  if (data?.status !== 'available' || !geometry) {
    return (
      <div className="performance-chart-empty performance-chart-empty-compact">
        <span className="performance-chart-empty-icon">⌁</span>
        <strong>Chưa có biểu đồ so sánh</strong>
        <span>{getReasonMessage(data?.reason, 'Dữ liệu chỉ số tham chiếu hiện chưa khả dụng.')}</span>
      </div>
    );
  }

  const activePoint = activeIndex === null ? null : points[activeIndex];
  const handlePointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - rect.left) / rect.width) * geometry.width;
    const relative = (pointerX - geometry.padding.left) / geometry.plotWidth;
    const index = Math.max(0, Math.min(points.length - 1, Math.round(relative * (points.length - 1))));
    setActiveIndex(index);
  };
  const benchmarkLabel = selectedBenchmark === 'SP500' ? 'S&P 500' : 'VN-Index';

  return (
    <div className="performance-chart-shell benchmark-chart-shell">
      <div className="performance-chart-readout" aria-live="polite">
        {activePoint ? (
          <>
            <strong>{formatDateKey(activePoint.date)}</strong>
            <span>Danh mục {formatIndex(activePoint.portfolioBase100)}</span>
            <span>{benchmarkLabel} {formatIndex(activePoint.benchmarkBase100)}</span>
          </>
        ) : (
          <span>Cả hai được chuẩn hóa về 100 tại ngày chung đầu tiên.</span>
        )}
      </div>
      <div className="performance-svg-scroll">
        <svg
          className="performance-line-chart"
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          role="img"
          aria-label={`So sánh Base100 giữa danh mục và ${benchmarkLabel}`}
          onPointerMove={handlePointer}
          onPointerLeave={() => setActiveIndex(null)}
        >
          {geometry.ticks.map((tick) => (
            <g key={tick.value}>
              <line
                x1={geometry.padding.left}
                x2={geometry.width - geometry.padding.right}
                y1={tick.y}
                y2={tick.y}
                className="performance-grid-line"
              />
              <text x={geometry.padding.left - 10} y={tick.y + 4} textAnchor="end" className="performance-axis-label">
                {formatIndex(tick.value)}
              </text>
            </g>
          ))}
          <path d={geometry.paths.portfolioBase100} className="performance-primary-line" />
          <path d={geometry.paths.benchmarkBase100} className="performance-benchmark-line" />
          {activePoint && (
            <g>
              <line
                x1={geometry.x(activeIndex)}
                x2={geometry.x(activeIndex)}
                y1={geometry.padding.top}
                y2={geometry.height - geometry.padding.bottom}
                className="performance-cursor-line"
              />
              <circle
                cx={geometry.x(activeIndex)}
                cy={geometry.y(activePoint.portfolioBase100)}
                r="5"
                className="performance-active-dot"
              />
              <circle
                cx={geometry.x(activeIndex)}
                cy={geometry.y(activePoint.benchmarkBase100)}
                r="5"
                className="performance-active-dot performance-active-dot-benchmark"
              />
            </g>
          )}
          <text x={geometry.padding.left} y={geometry.height - 9} textAnchor="start" className="performance-axis-label">
            {formatDateKey(points[0].date)}
          </text>
          <text x={geometry.width - geometry.padding.right} y={geometry.height - 9} textAnchor="end" className="performance-axis-label">
            {formatDateKey(points.at(-1).date)}
          </text>
        </svg>
      </div>
    </div>
  );
}

function MetricValue({ value, type = 'percent', status = 'available' }) {
  const isAvailable = status === 'available' && typeof value === 'number' && Number.isFinite(value);
  if (!isAvailable) return <span className="performance-unavailable-value">Chưa đủ dữ liệu</span>;
  return type === 'vnd' ? formatVNDReporting(value) : formatPercentVN(value);
}

function LoadingSkeleton() {
  return (
    <div className="performance-skeleton" aria-label="Đang tải dữ liệu hiệu suất">
      <div className="performance-skeleton-grid">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="performance-skeleton-card skeleton-shimmer" />)}
      </div>
      <div className="performance-skeleton-chart skeleton-shimmer" />
    </div>
  );
}

export function PortfolioPerformanceSection({
  cashAvailable = null,
  holdingsCount = 0,
  onNavigateToPortfolio
} = {}) {
  const [range, setRange] = useState('1M');
  const [benchmarkId, setBenchmarkId] = useState('VN_INDEX');
  const [performance, setPerformance] = useState(null);
  const [performanceLoading, setPerformanceLoading] = useState(true);
  const [performanceError, setPerformanceError] = useState(null);
  const [benchmark, setBenchmark] = useState(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(true);
  const [benchmarkError, setBenchmarkError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setPerformance(null);
    setPerformanceLoading(true);
    setPerformanceError(null);

    fetchApiData(`/api/portfolio/performance?range=${encodeURIComponent(range)}`, controller.signal)
      .then((data) => {
        if (active) setPerformance(data);
      })
      .catch((error) => {
        if (!active || error.name === 'AbortError') return;
        setPerformanceError(error);
      })
      .finally(() => {
        if (active) setPerformanceLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [range]);

  useEffect(() => {
    if (holdingsCount === 0) {
      setBenchmark(null);
      setBenchmarkLoading(false);
      setBenchmarkError(null);
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    setBenchmark(null);
    setBenchmarkLoading(true);
    setBenchmarkError(null);

    fetchApiData(
      `/api/portfolio/performance/benchmark?range=${encodeURIComponent(range)}&benchmark=${encodeURIComponent(benchmarkId)}`,
      controller.signal
    )
      .then((data) => {
        if (active) setBenchmark(data);
      })
      .catch((error) => {
        if (!active || error.name === 'AbortError') return;
        setBenchmarkError(error);
      })
      .finally(() => {
        if (active) setBenchmarkLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [range, benchmarkId, holdingsCount]);

  const performanceStatus = getStatusMeta(performance?.status);
  const coverage = performance?.valuationCoverage;
  const coverageReasons = Array.isArray(coverage?.reasons) ? coverage.reasons : [];
  const primaryCoverageReason = coverageReasons[0] || performance?.twr?.reason;
  const isPerformanceUnavailable = performance && performance.status !== 'available' && performance.status !== 'partial';
  const isSp500 = benchmarkId === 'SP500';
  const pnl = performance?.pnl;
  const drawdown = performance?.drawdown;
  const benchmarkStatus = getStatusMeta(benchmark?.status);

  return (
    <motion.section
      className="portfolio-performance-section"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="performance-hero-card">
        <div className="performance-hero-copy">
          <div className="performance-eyebrow">Hiệu suất theo dòng tiền</div>
          <div className="performance-title-row">
            <h3>Hiệu suất & chỉ số tham chiếu</h3>
            {!performanceLoading && performance && (
              <span className={`performance-status-badge ${performanceStatus.className}`}>
                {performanceStatus.label}
              </span>
            )}
          </div>
          <p>
            Theo dõi mức tăng/giảm của danh mục mà không biến tiền nạp hoặc rút thành lợi nhuận đầu tư.
          </p>
        </div>
        <div className="performance-range-control" aria-label="Chọn khoảng thời gian hiệu suất">
          {PERFORMANCE_RANGES.map((item) => (
            <button
              type="button"
              key={item}
              className={range === item ? 'active' : ''}
              onClick={() => setRange(item)}
              disabled={performanceLoading && range === item}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {performanceLoading && !performance && <LoadingSkeleton />}

      {performanceError && !performance && (
        <div className="performance-semantic-state performance-semantic-error">
          <strong>Chưa thể tải hiệu suất danh mục</strong>
          <span>Không thể tải dữ liệu hiệu suất lúc này.</span>
        </div>
      )}

      {performance && (
        <>
          {performanceLoading && <div className="performance-refresh-line skeleton-shimmer" />}

          {isPerformanceUnavailable && (
            <div className="performance-semantic-state">
              <strong>{performance.status === 'insufficient_data' ? 'Chưa đủ dữ liệu cho kỳ đã chọn' : 'Hiệu suất chưa khả dụng'}</strong>
              <span>
                {holdingsCount === 0
                  ? getPerformanceEmptyStateGuidance({ cashAvailable, holdingsCount })
                  : getReasonMessage(primaryCoverageReason)}
              </span>
              {holdingsCount === 0 && onNavigateToPortfolio && (
                <div style={{ marginTop: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={onNavigateToPortfolio}
                    className="fintech-btn btn-secondary btn-sm"
                    style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                  >
                    Đi đến Thiết lập danh mục →
                  </button>
                </div>
              )}
            </div>
          )}

          {performance.status === 'partial' && (
            <div className="fintech-banner banner-warning performance-inline-banner">
              <span>⚠️</span>
              <div>
                <strong>Định giá lịch sử chưa đầy đủ</strong>
                <span>{getReasonMessage(primaryCoverageReason, 'Một số ngày trong kỳ chưa có đủ dữ liệu định giá.')}</span>
              </div>
            </div>
          )}

          {performance.period?.clippedToInception && (
            <div className="performance-quiet-note">
              Dữ liệu hiệu suất bắt đầu từ <strong>{formatDateKey(performance.period.actualStartDate || performance.period.inceptionDate)}</strong>.
            </div>
          )}

          <div className="performance-kpi-grid">
            <article className="performance-kpi-card performance-kpi-primary">
              <div className="performance-kpi-topline">
                <span className="performance-kpi-label">Hiệu suất danh mục</span>
                <span className="performance-kpi-tag">TWR · theo kỳ</span>
              </div>
              <div className="performance-kpi-value performance-kpi-value-large">
                <MetricValue value={performance.twr?.returnPct} status={performance.twr?.status} />
              </div>
              <p>Đã loại ảnh hưởng của tiền nạp/rút theo phương pháp chuỗi ngày.</p>
              <span className="performance-kpi-footnote">Ước tính theo dữ liệu cuối ngày; không phải TWR nội ngày chính xác.</span>
            </article>

            <article className="performance-kpi-card">
              <div className="performance-kpi-topline">
                <span className="performance-kpi-label">Lợi suất theo dòng tiền</span>
                <span className="performance-kpi-tag">MWR/XIRR · quy năm</span>
              </div>
              <div className="performance-kpi-value">
                <MetricValue value={performance.mwr?.annualizedReturnPct} status={performance.mwr?.status} />
              </div>
              <p>Tính đến thời điểm và quy mô tiền bạn thực tế nạp/rút.</p>
              {performance.mwr?.status !== 'available' && (
                <span className="performance-kpi-footnote">{getReasonMessage(performance.mwr?.reason)}</span>
              )}
            </article>

            <article className="performance-kpi-card">
              <div className="performance-kpi-topline">
                <span className="performance-kpi-label">Sụt giảm tối đa</span>
                <span className="performance-kpi-tag">Từ đỉnh TWR</span>
              </div>
              <div className="performance-kpi-value performance-drawdown-value">
                <MetricValue value={drawdown?.maxDrawdownPct} status={drawdown?.status} />
              </div>
              <p>Mức giảm sâu nhất của chuỗi hiệu suất so với đỉnh đã thiết lập trước đó.</p>
              {drawdown?.status !== 'available' && (
                <span className="performance-kpi-footnote">{getReasonMessage(drawdown?.reason)}</span>
              )}
            </article>

            <article className="performance-kpi-card">
              <div className="performance-kpi-topline">
                <span className="performance-kpi-label">Lãi/lỗ kế toán cuối kỳ</span>
                <span className="performance-kpi-tag">VND · {formatDateKey(pnl?.asOfDate)}</span>
              </div>
              <div className="performance-kpi-value performance-kpi-vnd">
                <MetricValue value={pnl?.totalAccountingPnlAtEnd} type="vnd" status={pnl?.status} />
              </div>
              <p>Đã thực hiện lũy kế cộng với lãi/lỗ chưa thực hiện tại cuối kỳ.</p>
              {pnl?.status !== 'available' && (
                <span className="performance-kpi-footnote">{getReasonMessage(pnl?.reason)}</span>
              )}
            </article>
          </div>

          <article className="performance-panel performance-main-chart-panel">
            <div className="performance-panel-header">
              <div>
                <div className="performance-panel-kicker">TWR Wealth Index</div>
                <h4>Đường hiệu suất danh mục</h4>
                <p>Dòng tiền bên ngoài không được xem là khoản tăng hoặc giảm hiệu suất.</p>
              </div>
              <div className="performance-chart-legend">
                <span><i className="performance-legend-dot performance-legend-portfolio" />Danh mục</span>
              </div>
            </div>
            <PerformanceChart
              series={performance.series}
              status={performance.twr?.status}
              reason={performance.twr?.reason}
            />
          </article>

          <article className="performance-panel benchmark-panel">
            <div className="performance-panel-header performance-benchmark-header">
              <div>
                <div className="performance-panel-kicker">Đối chiếu cùng kỳ</div>
                <h4>Chỉ số tham chiếu</h4>
                <p>Chuỗi ngày chung và Base100 do backend xác định.</p>
              </div>
              {holdingsCount > 0 && <div className="performance-benchmark-selector" aria-label="Chọn chỉ số tham chiếu">
                {BENCHMARK_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className={benchmarkId === option.id ? 'active' : ''}
                    onClick={() => setBenchmarkId(option.id)}
                    disabled={benchmarkLoading && benchmarkId === option.id}
                  >
                    {option.label}
                  </button>
                ))}
              </div>}
            </div>

            {holdingsCount === 0 && (
              <div className="performance-semantic-state">
                <strong>Chỉ số tham chiếu không áp dụng</strong>
                <span>Danh mục chỉ có tiền mặt nên không tạo so sánh hiệu suất với chỉ số thị trường.</span>
              </div>
            )}

            {holdingsCount > 0 && isSp500 && (
              <div className="performance-reference-notice">
                <span>USD</span>
                <p><strong>S&P 500 là đường tham chiếu nguyên bản.</strong> Chỉ số được hiển thị theo USD, chưa điều chỉnh sang VND vì chưa có dữ liệu tỷ giá lịch sử.</p>
              </div>
            )}

            {holdingsCount > 0 && benchmarkLoading && !benchmark && (
              <div className="performance-benchmark-loading skeleton-shimmer" aria-hidden="true" />
            )}

            {holdingsCount > 0 && benchmarkError && (
              <div className="performance-semantic-state performance-benchmark-error">
                <strong>Dữ liệu chỉ số tạm thời chưa khả dụng</strong>
                <span>Hiệu suất danh mục phía trên vẫn được giữ nguyên và có thể sử dụng.</span>
              </div>
            )}

            {holdingsCount > 0 && benchmark && !benchmarkError && (
              <>
                {benchmarkLoading && <div className="performance-refresh-line skeleton-shimmer" />}
                <div className="performance-benchmark-meta-row">
                  <span className={`performance-status-badge ${benchmarkStatus.className}`}>{benchmarkStatus.label}</span>
                  <span className="performance-return-type">Biến động theo giá</span>
                  {benchmark.period?.commonStartDate && benchmark.period?.commonEndDate && (
                    <span>
                      Kỳ chung {formatDateKey(benchmark.period.commonStartDate)}–{formatDateKey(benchmark.period.commonEndDate)}
                    </span>
                  )}
                </div>

                {benchmark.status === 'available' && (
                  <div className={`performance-benchmark-metrics ${isSp500 ? 'reference-only' : ''}`}>
                    <div>
                      <span>Danh mục · TWR kỳ chung</span>
                      <strong>{formatPercentVN(benchmark.portfolio?.returnPctOnCommonPeriod)}</strong>
                    </div>
                    <div>
                      <span>{isSp500 ? 'S&P 500' : 'VN-Index'} · Biến động theo giá</span>
                      <strong>{formatPercentVN(benchmark.benchmarkReturnPct)}</strong>
                    </div>
                    {!isSp500 && typeof benchmark.returnDifferencePctPoints === 'number' && Number.isFinite(benchmark.returnDifferencePctPoints) && (
                      <div>
                        <span>Chênh lệch hiệu suất</span>
                        <strong>{formatPercentVN(benchmark.returnDifferencePctPoints)}</strong>
                      </div>
                    )}
                  </div>
                )}

                <div className="performance-chart-legend performance-benchmark-legend">
                  <span><i className="performance-legend-dot performance-legend-portfolio" />Danh mục</span>
                  <span><i className="performance-legend-dot performance-legend-benchmark" />{isSp500 ? 'S&P 500' : 'VN-Index'}</span>
                </div>
                <BenchmarkChart data={benchmark} selectedBenchmark={benchmarkId} />
              </>
            )}
          </article>

          <div className="performance-detail-grid">
            <article className="performance-panel performance-accounting-panel">
              <div className="performance-panel-header">
                <div>
                  <div className="performance-panel-kicker">Tách biệt với TWR/MWR</div>
                  <h4>Lãi/lỗ kế toán</h4>
                  <p>Tại ngày cuối kỳ {formatDateKey(pnl?.asOfDate)}.</p>
                </div>
              </div>
              {pnl?.status === 'available' ? (
                <dl className="performance-detail-list">
                  <div>
                    <dt>Đã thực hiện trong kỳ</dt>
                    <dd>{formatVNDReporting(pnl.realizedPnlDuringPeriod)}</dd>
                  </div>
                  <div>
                    <dt>Đã thực hiện lũy kế đến cuối kỳ</dt>
                    <dd>{formatVNDReporting(pnl.cumulativeRealizedPnlToEnd)}</dd>
                  </div>
                  <div>
                    <dt>Chưa thực hiện tại cuối kỳ</dt>
                    <dd>{formatVNDReporting(pnl.unrealizedPnlAtEnd)}</dd>
                  </div>
                </dl>
              ) : (
                <div className="performance-compact-unavailable">
                  <strong>Chưa có lãi/lỗ kế toán đầy đủ</strong>
                  <span>{getReasonMessage(pnl?.reason)}</span>
                </div>
              )}
            </article>

            <article className="performance-panel performance-drawdown-panel">
              <div className="performance-panel-header">
                <div>
                  <div className="performance-panel-kicker">Khoảng giảm từ đỉnh</div>
                  <h4>Hành trình sụt giảm</h4>
                  <p>Dựa trực tiếp trên chuỗi TWR cuối ngày.</p>
                </div>
              </div>
              {drawdown?.status === 'available' ? (
                <div className="performance-drawdown-detail">
                  <div>
                    <span>Mức giảm hiện tại từ đỉnh</span>
                    <strong>{formatPercentVN(drawdown.currentDrawdownPct)}</strong>
                  </div>
                  <div className="performance-drawdown-dates">
                    <span>Đỉnh gần kỳ đo <strong>{formatDateKey(drawdown.peakDate)}</strong></span>
                    <span>Đáy sâu nhất <strong>{formatDateKey(drawdown.troughDate)}</strong></span>
                  </div>
                </div>
              ) : (
                <div className="performance-compact-unavailable">
                  <strong>Chưa có dữ liệu sụt giảm</strong>
                  <span>{getReasonMessage(drawdown?.reason)}</span>
                </div>
              )}
            </article>
          </div>

          {(coverage?.carriedForwardMarks > 0
            || coverage?.missingValuationMarks > 0
            || coverageReasons.includes('NON_VND_HISTORICAL_FX_UNAVAILABLE')) && (
            <div className="performance-coverage-note">
              <strong>Chất lượng định giá</strong>
              {coverage?.carriedForwardMarks > 0 && (
                <span>Một số ngày không giao dịch dùng giá đóng cửa gần nhất để định giá ({coverage.carriedForwardMarks} mốc).</span>
              )}
              {coverage?.missingValuationMarks > 0 && (
                <span>Thiếu {coverage.missingValuationMarks} mốc định giá trong kỳ.</span>
              )}
              {coverageReasons.includes('NON_VND_HISTORICAL_FX_UNAVAILABLE') && (
                <span>Chưa thể tính hiệu suất VND đầy đủ cho tài sản ngoại tệ vì chưa có lịch sử tỷ giá tương ứng.</span>
              )}
            </div>
          )}

          <div className="performance-methodology-note">
            <span>i</span>
            <p>
              Hiệu suất dùng dữ liệu cuối ngày và hiện chưa bao gồm đầy đủ phí, thuế, cổ tức và một số điều chỉnh doanh nghiệp.
            </p>
          </div>
        </>
      )}
    </motion.section>
  );
}
