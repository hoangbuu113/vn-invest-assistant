import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { formatPercentVN, formatVNDReporting } from '../utils/formatting.js';
import { apiFetch } from '../utils/api.js';
import {
  buildBenchmarkDisplay,
  buildPortfolioPerformanceDisplay,
  PERFORMANCE_DATA_STATES,
  performanceReasonMessage
} from '../utils/portfolioPerformanceDisplay.js';

const PERFORMANCE_RANGES = ['1W', '1M', '3M', '6M', '1Y'];

const BENCHMARK_OPTIONS = [
  { id: 'NONE', label: 'Không benchmark' },
  { id: 'VN_INDEX', label: 'VN-Index' },
  { id: 'SP500', label: 'S&P 500' }
];

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

function formatPctPoints(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const absolute = Math.abs(value).toLocaleString('vi-VN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${absolute} điểm %`;
}

async function fetchApiData(url, signal) {
  const response = await apiFetch(url, { signal });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // HTTP status remains the authoritative error signal.
  }
  if (!response.ok || payload?.status !== 'ok' || !payload?.data) {
    const error = new Error(payload?.message || `HTTP ${response.status}`);
    error.code = payload?.code || null;
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

function buildChartGeometry(points, fields, width = 820, height = 250) {
  const padding = { top: 18, right: 20, bottom: 32, left: 50 };
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
    points.map((point, index) => {
      const value = point[field];
      return typeof value === 'number' && Number.isFinite(value)
        ? `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`
        : '';
    }).filter(Boolean).join(' ')
  ]));
  const ticks = Array.from({ length: 4 }, (_, index) => {
    const value = min + ((max - min) * index) / 3;
    return { value, y: y(value) };
  }).reverse();
  return { width, height, padding, plotWidth, x, y, paths, ticks };
}

function UnifiedPerformanceChart({ performanceView, benchmarkView }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const hasBenchmarkOverlay = benchmarkView.canOverlay;
  const points = useMemo(() => {
    if (hasBenchmarkOverlay) {
      return benchmarkView.series.filter((point) => (
        point?.date
        && typeof point.portfolioBase100 === 'number'
        && Number.isFinite(point.portfolioBase100)
        && typeof point.benchmarkBase100 === 'number'
        && Number.isFinite(point.benchmarkBase100)
      )).map((point) => ({
        date: point.date,
        portfolioIndex: point.portfolioBase100,
        benchmarkIndex: point.benchmarkBase100
      }));
    }
    return performanceView.series.map((point) => ({
      ...point,
      portfolioIndex: point.twrIndex
    }));
  }, [benchmarkView, hasBenchmarkOverlay, performanceView.series]);
  const fields = hasBenchmarkOverlay ? ['portfolioIndex', 'benchmarkIndex'] : ['portfolioIndex'];
  const geometry = useMemo(() => buildChartGeometry(points, fields), [points, hasBenchmarkOverlay]);

  useEffect(() => setActiveIndex(null), [points]);
  if (!geometry) return null;

  const activePoint = activeIndex === null ? null : points[activeIndex];
  const handlePointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - rect.left) / rect.width) * geometry.width;
    const relative = (pointerX - geometry.padding.left) / geometry.plotWidth;
    setActiveIndex(Math.max(0, Math.min(points.length - 1, Math.round(relative * (points.length - 1)))));
  };
  const areaPath = `${geometry.paths.portfolioIndex} L ${geometry.x(points.length - 1)} ${geometry.height - geometry.padding.bottom} L ${geometry.x(0)} ${geometry.height - geometry.padding.bottom} Z`;

  return (
    <div className="performance-chart-shell">
      <div className="performance-chart-readout" aria-live="polite">
        {activePoint ? (
          <>
            <strong>{formatDateKey(activePoint.date)}</strong>
            <span>Danh mục {formatIndex(activePoint.portfolioIndex)}</span>
            {hasBenchmarkOverlay && <span>{benchmarkView.name} {formatIndex(activePoint.benchmarkIndex)}</span>}
            {!hasBenchmarkOverlay && typeof activePoint.portfolioValueVnd === 'number' && (
              <span>Giá trị cuối ngày {formatVNDReporting(activePoint.portfolioValueVnd)}</span>
            )}
          </>
        ) : (
          <span>Chỉ số TWR tích lũy, chuẩn hóa theo kỳ đo đã chọn.</span>
        )}
      </div>
      <svg
        className="performance-line-chart"
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        role="img"
        aria-label={hasBenchmarkOverlay
          ? `Hiệu suất danh mục và ${benchmarkView.name} trên kỳ chung`
          : 'Hiệu suất TWR tích lũy của danh mục'}
        onPointerMove={handlePointer}
        onPointerLeave={() => setActiveIndex(null)}
      >
        <defs>
          <linearGradient id="portfolioPerformanceArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0.01" />
          </linearGradient>
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
            <text x={geometry.padding.left - 9} y={tick.y + 4} textAnchor="end" className="performance-axis-label">
              {formatIndex(tick.value)}
            </text>
          </g>
        ))}
        <path d={areaPath} fill="url(#portfolioPerformanceArea)" />
        <path d={geometry.paths.portfolioIndex} className="performance-primary-line" />
        {hasBenchmarkOverlay && <path d={geometry.paths.benchmarkIndex} className="performance-benchmark-line" />}
        {activePoint && (
          <g>
            <line
              x1={geometry.x(activeIndex)}
              x2={geometry.x(activeIndex)}
              y1={geometry.padding.top}
              y2={geometry.height - geometry.padding.bottom}
              className="performance-cursor-line"
            />
            <circle cx={geometry.x(activeIndex)} cy={geometry.y(activePoint.portfolioIndex)} r="5" className="performance-active-dot" />
            {hasBenchmarkOverlay && (
              <circle cx={geometry.x(activeIndex)} cy={geometry.y(activePoint.benchmarkIndex)} r="5" className="performance-active-dot performance-active-dot-benchmark" />
            )}
          </g>
        )}
        <text x={geometry.padding.left} y={geometry.height - 8} textAnchor="start" className="performance-axis-label">
          {formatDateKey(points[0].date)}
        </text>
        <text x={geometry.width - geometry.padding.right} y={geometry.height - 8} textAnchor="end" className="performance-axis-label">
          {formatDateKey(points.at(-1).date)}
        </text>
      </svg>
    </div>
  );
}

function StateBadge({ meta }) {
  return <span className={`performance-status-badge performance-status-${meta.tone}`}>{meta.label}</span>;
}

function PercentValue({ value, unavailableText = '—' }) {
  return typeof value === 'number' && Number.isFinite(value)
    ? formatPercentVN(value)
    : <span className="performance-unavailable-value">{unavailableText}</span>;
}

function VndValue({ value }) {
  return typeof value === 'number' && Number.isFinite(value)
    ? formatSignedVnd(value)
    : <span className="performance-unavailable-value">—</span>;
}

function LoadingSkeleton() {
  return (
    <div className="performance-skeleton" aria-label="Đang tải dữ liệu hiệu suất">
      <div className="performance-skeleton-grid">
        <div className="performance-skeleton-card skeleton-shimmer" />
        <div className="performance-skeleton-card skeleton-shimmer" />
      </div>
      <div className="performance-skeleton-chart skeleton-shimmer" />
    </div>
  );
}

function HistorySummary({ view }) {
  if (view.historyMode === 'SUFFICIENT' && view.canRenderChart) return null;
  const isZero = view.observationCount === 0;
  const isSingle = view.observationCount === 1;
  const title = view.isCashOnly
    ? 'Danh mục hiện chỉ có tiền mặt'
    : isZero
      ? 'Chưa có lịch sử định giá'
      : isSingle
        ? 'Chưa đủ lịch sử để đánh giá hiệu suất.'
        : 'Kỳ đo hiện có ít quan sát';
  const description = view.isCashOnly
    ? 'Biểu đồ đầu tư và benchmark được thu gọn; các số liệu hợp lệ vẫn hiển thị.'
    : view.primaryReason
      ? view.primaryReasonMessage
      : 'Không mở biểu đồ lớn cho chuỗi dữ liệu ngắn.';
  return (
    <div className="performance-history-summary">
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <dl>
        <div><dt>Bắt đầu</dt><dd>{formatDateKey(view.period.startDate)}</dd></div>
        <div><dt>Kết thúc</dt><dd>{formatDateKey(view.period.endDate)}</dd></div>
        <div><dt>Quan sát hợp lệ</dt><dd>{view.observationCount}</dd></div>
      </dl>
    </div>
  );
}

function BenchmarkSummary({ view }) {
  if (view.id === 'NONE') {
    return <p className="performance-benchmark-note">Không dùng benchmark cho kỳ này.</p>;
  }
  if (view.state === 'LOADING') {
    return <div className="performance-benchmark-loading skeleton-shimmer" aria-label="Đang tải benchmark" />;
  }
  if (view.state !== PERFORMANCE_DATA_STATES.AVAILABLE) {
    return (
      <div className="performance-compact-unavailable">
        <strong>Benchmark chưa thể đối chiếu</strong>
        <span>{performanceReasonMessage(view.reason, 'Dữ liệu benchmark hiện chưa khả dụng; hiệu suất danh mục vẫn giữ nguyên.')}</span>
      </div>
    );
  }
  return (
    <div className="performance-benchmark-result">
      <div><span>Danh mục · TWR kỳ chung</span><strong>{formatPercentVN(view.portfolioReturnPct)}</strong></div>
      <div><span>{view.name} · biến động theo giá</span><strong>{formatPercentVN(view.benchmarkReturnPct)}</strong></div>
      {view.differencePctPoints !== null && (
        <div><span>Chênh lệch</span><strong>{formatPctPoints(view.differencePctPoints)}</strong></div>
      )}
      {view.isReferenceOnly && (
        <p>S&P 500 là tham chiếu giá bằng USD; không tính chênh lệch với danh mục báo cáo bằng VND.</p>
      )}
    </div>
  );
}

export function PortfolioPerformanceSection({
  holdingsCount = 0
} = {}) {
  const [range, setRange] = useState('1M');
  const [benchmarkId, setBenchmarkId] = useState('NONE');
  const [performance, setPerformance] = useState(null);
  const [performanceLoading, setPerformanceLoading] = useState(true);
  const [performanceError, setPerformanceError] = useState(null);
  const [benchmark, setBenchmark] = useState(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setPerformance(null);
    setPerformanceLoading(true);
    setPerformanceError(null);
    fetchApiData(`/api/portfolio/performance?range=${encodeURIComponent(range)}`, controller.signal)
      .then((data) => { if (active) setPerformance(data); })
      .catch((error) => {
        if (!active || error.name === 'AbortError') return;
        setPerformanceError(error);
      })
      .finally(() => { if (active) setPerformanceLoading(false); });
    return () => {
      active = false;
      controller.abort();
    };
  }, [range]);

  const view = useMemo(
    () => buildPortfolioPerformanceDisplay(performance, { holdingsCount }),
    [performance, holdingsCount]
  );

  useEffect(() => {
    if (holdingsCount === 0 || benchmarkId === 'NONE' || view.observationCount === 0) {
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
      .then((data) => { if (active) setBenchmark(data); })
      .catch((error) => {
        if (!active || error.name === 'AbortError') return;
        setBenchmarkError(error);
      })
      .finally(() => { if (active) setBenchmarkLoading(false); });
    return () => {
      active = false;
      controller.abort();
    };
  }, [range, benchmarkId, holdingsCount, view.observationCount]);

  const benchmarkView = useMemo(() => buildBenchmarkDisplay({
    benchmarkId,
    benchmark,
    loading: benchmarkLoading,
    error: benchmarkError,
    holdingsCount,
    observationCount: view.observationCount
  }), [benchmarkId, benchmark, benchmarkLoading, benchmarkError, holdingsCount, view.observationCount]);
  const showChart = view.canRenderChart;
  const hasCoverageWarning = view.coverage?.carriedForwardMarks > 0
    || view.coverage?.missingValuationMarks > 0
    || view.coverageReasons.length > 0;

  return (
    <motion.section
      className="portfolio-performance-section performance-v1-section"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="performance-hero-card">
        <div className="performance-hero-copy">
          <div className="performance-eyebrow">Hiệu suất lịch sử</div>
          <div className="performance-title-row">
            <h3>Hiệu suất danh mục</h3>
            {!performanceLoading && performance && <StateBadge meta={view.stateMeta} />}
          </div>
          <p>Đo trên dữ liệu cuối ngày; tách biệt với định giá hiện tại của Summary.</p>
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
          <strong>Không thể tải dữ liệu hiệu suất</strong>
          <span>Lỗi API không được xem là danh mục 0% hoặc không có lịch sử. Vui lòng thử lại sau.</span>
        </div>
      )}

      {performance && (
        <div className="performance-unified-card">
          {performanceLoading && <div className="performance-refresh-line skeleton-shimmer" />}

          <div className="performance-primary-grid">
            <article className="performance-primary-metric performance-twr-metric">
              <div className="performance-kpi-topline">
                <span className="performance-kpi-label">TWR trong kỳ</span>
                <span className="performance-kpi-tag">Chỉ số chính</span>
              </div>
              <div className="performance-primary-value">
                <PercentValue value={view.twr.value} unavailableText={view.twr.state === PERFORMANCE_DATA_STATES.INSUFFICIENT_HISTORY ? 'Chưa đủ lịch sử' : '—'} />
              </div>
              {view.observationCount === 0 ? (
                <p>Bắt đầu: — · Kết thúc: — · 0 quan sát hợp lệ</p>
              ) : (
                <p>{formatDateKey(view.period.startDate)}–{formatDateKey(view.period.endDate)} · {view.observationCount} quan sát hợp lệ</p>
              )}
              <small>Đã loại ảnh hưởng của tiền nạp/rút; ước tính theo chuỗi cuối ngày.</small>
            </article>

            <article className="performance-primary-metric performance-accounting-metric">
              <div className="performance-kpi-topline">
                <span className="performance-kpi-label">Lãi/lỗ kế toán cuối kỳ</span>
                <span className="performance-kpi-tag">VND · {formatDateKey(view.pnl.asOfDate)}</span>
              </div>
              <div className="performance-primary-value performance-primary-vnd">
                <VndValue value={view.pnl.totalAtEnd} />
              </div>
              <p>Tách biệt với TWR; đây là lãi/lỗ kế toán lũy kế tại ngày cuối kỳ.</p>
              {view.pnl.totalAtEnd === null && <small>{performanceReasonMessage(view.pnl.reason)}</small>}
            </article>
          </div>

          {view.state !== PERFORMANCE_DATA_STATES.AVAILABLE && view.historyMode === 'SUFFICIENT' && (
            <div className={`performance-inline-state is-${view.state.toLowerCase()}`}>
              <strong>{view.stateMeta.label}</strong>
              <span>{view.primaryReasonMessage}</span>
            </div>
          )}

          <HistorySummary view={view} />

          {showChart && (
            <div className="performance-chart-block">
              <div className="performance-chart-heading">
                <div>
                  <strong>Hiệu suất tích lũy</strong>
                  <span>Dữ liệu lịch sử/EOD đến {formatDateKey(view.historicalAsOf)}</span>
                </div>
                <div className="performance-chart-legend">
                  <span><i className="performance-legend-dot performance-legend-portfolio" />Danh mục</span>
                  {benchmarkView.canOverlay && (
                    <span><i className="performance-legend-dot performance-legend-benchmark" />{benchmarkView.name}</span>
                  )}
                </div>
              </div>
              <UnifiedPerformanceChart performanceView={view} benchmarkView={benchmarkView} />
            </div>
          )}

          <div className="performance-benchmark-row">
            <div>
              <strong>Chỉ số tham chiếu</strong>
              <span>Chỉ tải khi bạn chủ động chọn.</span>
            </div>
            {holdingsCount > 0 ? (
              <div className="performance-benchmark-selector" aria-label="Chọn chỉ số tham chiếu">
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
              </div>
            ) : (
              <span className="performance-not-applicable">Không áp dụng cho danh mục chỉ có tiền mặt</span>
            )}
          </div>
          <BenchmarkSummary view={benchmarkView} />

          <details className="performance-secondary-details" open>
            <summary>Chi tiết hiệu suất</summary>
            <div className="performance-secondary-grid">
              <article>
                <span>MWR / XIRR quy năm</span>
                <strong><PercentValue value={view.mwr.value} unavailableText={view.mwr.state === PERFORMANCE_DATA_STATES.INSUFFICIENT_HISTORY ? 'Chưa đủ lịch sử' : '—'} /></strong>
                {view.mwr.value === null && <small>{performanceReasonMessage(view.mwr.reason)}</small>}
              </article>
              <article>
                <span>Drawdown tối đa</span>
                <strong><PercentValue value={view.drawdown.value} /></strong>
                {view.drawdown.isZero ? (
                  <small>Không ghi nhận drawdown trong giai đoạn đo.</small>
                ) : view.drawdown.value !== null ? (
                  <small>{formatDateKey(view.drawdown.peakDate)} → {formatDateKey(view.drawdown.troughDate)}</small>
                ) : (
                  <small>{performanceReasonMessage(view.drawdown.reason)}</small>
                )}
              </article>
              <article>
                <span>Đã thực hiện trong kỳ</span>
                <strong><VndValue value={view.pnl.realizedDuringPeriod} /></strong>
                <small>Lãi/lỗ đã ghi nhận từ giao dịch trong kỳ.</small>
              </article>
              <article>
                <span>Chưa thực hiện cuối kỳ</span>
                <strong><VndValue value={view.pnl.unrealizedAtEnd} /></strong>
                <small>{view.pnl.unrealizedAtEnd === null ? performanceReasonMessage(view.pnl.reason) : 'Theo giá hợp lệ tại cuối kỳ.'}</small>
              </article>
            </div>
          </details>

          {hasCoverageWarning && (
            <div className="performance-coverage-note">
              <strong>Chất lượng dữ liệu</strong>
              {view.coverage?.carriedForwardMarks > 0 && <span>{view.coverage.carriedForwardMarks} mốc dùng giá đóng cửa hợp lệ gần nhất.</span>}
              {view.coverage?.missingValuationMarks > 0 && <span>Thiếu {view.coverage.missingValuationMarks} mốc định giá.</span>}
              {view.coverageReasons.map((reason) => <span key={reason}>{performanceReasonMessage(reason)}</span>)}
            </div>
          )}

          <div className="performance-methodology-note">
            <span>i</span>
            <p>Hiệu suất dùng dữ liệu cuối ngày và chưa bao gồm đầy đủ phí, thuế, cổ tức hoặc điều chỉnh doanh nghiệp.</p>
          </div>
        </div>
      )}
    </motion.section>
  );
}

export default PortfolioPerformanceSection;
