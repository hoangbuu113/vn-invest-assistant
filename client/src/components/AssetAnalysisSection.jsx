import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TiltCard, MagneticButton, CountUp } from './MotionHelpers.jsx';
import {
  formatNativeAmount,
  formatMarketChange,
  formatPercentVN
} from '../utils/formatting.js';

const PERIODS_CONFIG = [
  { key: '1W', label: '1T', name: '1 tuần' },
  { key: '1M', label: '1Th', name: '1 tháng' },
  { key: '3M', label: '3Th', name: '3 tháng' },
  { key: '6M', label: '6Th', name: '6 tháng' },
  { key: '1Y', label: '1N', name: '1 năm' }
];

const UNAVAILABLE_REASON_LABELS = {
  insufficient_sessions: 'Chưa đủ số mốc dữ liệu theo tiêu chuẩn giai đoạn',
  missing_high: 'Thiếu dữ liệu giá cao nhất trong giai đoạn',
  missing_low: 'Thiếu dữ liệu giá thấp nhất trong giai đoạn',
  flat_range: 'Vùng giá chưa xác định được (giá cao nhất bằng giá thấp nhất)',
  analysis_price_outside_range: 'Dữ liệu vùng giá chưa nhất quán với giá phân tích',
  invalid_start_price: 'Giá đầu kỳ không hợp lệ'
};

function formatDate(isoString, includeTime = false) {
  if (!isoString) return 'N/A';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    if (includeTime) {
      return d.toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
    return d.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  } catch {
    return isoString;
  }
}

export function AssetAnalysisSection({
  data,
  loading = false,
  error = null,
  onRetry,
  symbol = ''
}) {
  const [selectedPeriod, setSelectedPeriod] = useState('1M');
  const [showMethodology, setShowMethodology] = useState(false);

  // Explicit unsupported state (e.g. USD/VND FX)
  if (symbol === 'USD/VND' || data?.unsupported) {
    return (
      <TiltCard className="fintech-card" style={{ padding: '1.5rem', marginTop: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-slate-900)', fontWeight: 800 }}>
            Phân tích tài sản
          </h3>
          <span className="fintech-badge badge-neutral" style={{ fontSize: '0.75rem' }}>
            Không hỗ trợ
          </span>
        </div>
        <div
          style={{
            padding: '1rem',
            backgroundColor: 'var(--color-slate-50, #f8fafc)',
            borderRadius: '10px',
            border: '1px solid var(--color-slate-200, #e2e8f0)',
            fontSize: '0.85rem',
            color: 'var(--color-slate-600)'
          }}
        >
          Phân tích lịch sử hiện chưa được hỗ trợ cho USD/VND.
        </div>
      </TiltCard>
    );
  }

  // Loading skeleton state
  if (loading) {
    return (
      <TiltCard className="fintech-card" style={{ padding: '1.5rem', marginTop: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div className="skeleton-shimmer" style={{ width: '200px', height: '26px', marginBottom: '6px' }} />
            <div className="skeleton-shimmer" style={{ width: '280px', height: '16px' }} />
          </div>
          <div className="skeleton-shimmer" style={{ width: '120px', height: '28px', borderRadius: 'var(--radius-full)' }} />
        </div>

        <div className="metrics-grid" style={{ marginBottom: '1.25rem' }}>
          {[1, 2, 3].map((n) => (
            <div key={n} className="skeleton-shimmer" style={{ height: '78px' }} />
          ))}
        </div>

        <div className="skeleton-shimmer" style={{ height: '48px', marginBottom: '1.25rem', borderRadius: 'var(--radius-md)' }} />
        <div className="skeleton-shimmer" style={{ height: '220px', borderRadius: 'var(--radius-md)' }} />
      </TiltCard>
    );
  }

  // Error state
  if (error && !data) {
    return (
      <TiltCard className="fintech-card" style={{ padding: '1.5rem', marginTop: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-slate-900)', fontWeight: 800 }}>
              Phân tích tài sản
            </h3>
            <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)' }}>
              Dựa trên biến động giá lịch sử đã hoàn tất.
            </span>
          </div>
          <span className="fintech-badge badge-neutral">Dựa trên dữ liệu đã hoàn tất</span>
        </div>

        <div className="fintech-banner banner-warning" style={{ margin: '0.5rem 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span>{error}</span>
            {onRetry && (
              <MagneticButton onClick={onRetry} className="fintech-btn btn-secondary btn-sm">
                Thử lại
              </MagneticButton>
            )}
          </div>
        </div>
      </TiltCard>
    );
  }

  // No data state
  if (!data) {
    return null;
  }

  const quoteCurrency = data.quoteCurrency || data.currency || 'VND';
  const isCloseOnly = data.capabilities?.ohlc === false || data.marketPolicy === 'CONTINUOUS_24_7' || data.marketPolicy === 'GLOBAL_24_5';

  const {
    analysisPrice,
    analysisAsOf,
    periods = {},
    dataCompleteness = {},
    methodology = {}
  } = data;

  const availableRangesCount = Array.isArray(dataCompleteness.availableRanges) ? dataCompleteness.availableRanges.length : 0;

  const activePeriodConfig = PERIODS_CONFIG.find((p) => p.key === selectedPeriod) || PERIODS_CONFIG[1];
  const activePeriodData = periods[selectedPeriod] || { status: 'unavailable', unavailableReasons: ['insufficient_sessions'] };
  const isPeriodAvailable = activePeriodData.status === 'available';

  const isPositiveChange = typeof activePeriodData.priceChangePct === 'number' && activePeriodData.priceChangePct > 0;
  const isNegativeChange = typeof activePeriodData.priceChangePct === 'number' && activePeriodData.priceChangePct < 0;

  // Clamped dot position for range visual (prefer V2 completedCloseRangePositionPct if close-only)
  const rawRangePct = isCloseOnly
    ? (activePeriodData.completedCloseRangePositionPct ?? activePeriodData.rangePositionPct)
    : (activePeriodData.rangePositionPct ?? activePeriodData.completedCloseRangePositionPct);

  const rangePosition = typeof rawRangePct === 'number' && Number.isFinite(rawRangePct)
    ? Math.min(100, Math.max(0, rawRangePct))
    : null;

  // Determine low/high price for current period
  const effectiveLowPrice = isCloseOnly
    ? (activePeriodData.lowestCompletedClose ?? activePeriodData.periodLowPrice)
    : (activePeriodData.periodLowPrice ?? activePeriodData.lowestCompletedClose);

  const effectiveHighPrice = isCloseOnly
    ? (activePeriodData.highestCompletedClose ?? activePeriodData.periodHighPrice)
    : (activePeriodData.periodHighPrice ?? activePeriodData.highestCompletedClose);

  const effectiveDistanceBelowHigh = isCloseOnly
    ? (activePeriodData.distanceBelowHighestCompletedClosePct ?? activePeriodData.distanceBelowHighPct)
    : (activePeriodData.distanceBelowHighPct ?? activePeriodData.distanceBelowHighestCompletedClosePct);

  return (
    <TiltCard className="fintech-card" style={{ padding: '1.5rem', marginTop: '1.25rem' }}>
      {/* 1. Header & Explanatory Notice */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--color-slate-900)', fontWeight: 800 }}>
              Phân tích tài sản
            </h3>
            <span className={`fintech-badge ${availableRangesCount === 5 ? 'badge-gain' : 'badge-neutral'}`} style={{ fontSize: '0.75rem' }}>
              {availableRangesCount}/5 kỳ có dữ liệu
            </span>
            <span className="fintech-badge badge-neutral" style={{ fontSize: '0.75rem' }}>
              Dựa trên dữ liệu đã hoàn tất
            </span>
            {isCloseOnly && (
              <span className="fintech-badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                Một số chỉ số nội ngày không áp dụng
              </span>
            )}
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--color-slate-500)' }}>
            Dựa trên biến động giá lịch sử đã hoàn tất.
          </p>
        </div>

        {onRetry && (
          <MagneticButton
            onClick={onRetry}
            className="fintech-btn btn-secondary btn-sm"
            title="Làm mới phân tích"
          >
            <span>↻ Làm mới</span>
          </MagneticButton>
        )}
      </div>

      {/* 2. Top Summary Reference Cards */}
      <div className="metrics-grid" style={{ marginBottom: '1.25rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {/* Giá dùng để phân tích */}
        <div className="metric-card" style={{ padding: '0.9rem 1rem', '--card-accent': '#2563eb' }}>
          <div className="metric-label">Giá dùng để phân tích</div>
          <div className="metric-value" style={{ fontSize: '1.2rem', color: 'var(--color-slate-900)' }}>
            {analysisPrice !== null && analysisPrice !== undefined
              ? formatNativeAmount(analysisPrice, quoteCurrency)
              : 'N/A'}
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--color-slate-500)', marginTop: '3px' }}>
            {isCloseOnly ? 'Giá đóng cửa của ngày hoàn tất gần nhất' : 'Giá đóng cửa của phiên hoàn tất gần nhất'}
          </div>
        </div>

        {/* Ngày dữ liệu */}
        <div className="metric-card" style={{ padding: '0.9rem 1rem', '--card-accent': '#64748b' }}>
          <div className="metric-label">Ngày dữ liệu</div>
          <div className="metric-value" style={{ fontSize: '1.1rem', color: 'var(--color-slate-800)' }}>
            {analysisAsOf ? formatDate(analysisAsOf) : 'N/A'}
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--color-slate-500)', marginTop: '3px' }}>
            Mốc đóng cửa gần nhất được ghi nhận
          </div>
        </div>

        {/* Mức độ sẵn sàng dữ liệu */}
        <div className="metric-card" style={{ padding: '0.9rem 1rem', '--card-accent': availableRangesCount === 5 ? '#10b981' : '#f59e0b' }}>
          <div className="metric-label">Độ bao phủ dữ liệu</div>
          <div className="metric-value" style={{ fontSize: '1.1rem', color: 'var(--color-slate-800)' }}>
            {availableRangesCount}/5 kỳ có dữ liệu
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--color-slate-500)', marginTop: '3px' }}>
            {availableRangesCount === 5
              ? (isCloseOnly ? '5/5 kỳ có dữ liệu mốc đóng cửa' : '5/5 kỳ có đủ dữ liệu phiên')
              : `${availableRangesCount} trên 5 kỳ có dữ liệu`}
          </div>
        </div>
      </div>

      {/* 4. Five-Period Interactive Switcher & Active Period Details */}
      <div style={{ marginBottom: '1.5rem' }}>
        {/* Period Selector Tabs */}
        <div className="period-tabs-bar" style={{ marginBottom: '1rem' }}>
          {PERIODS_CONFIG.map((p) => {
            const isActive = selectedPeriod === p.key;
            const pData = periods[p.key];
            const hasChange = pData && pData.status === 'available' && typeof pData.priceChangePct === 'number';
            const changePct = hasChange ? pData.priceChangePct : null;

            return (
              <button
                key={p.key}
                type="button"
                className={`period-tab-card ${isActive ? 'active' : ''}`}
                onClick={() => setSelectedPeriod(p.key)}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeAnalysisTabPill"
                    className="period-tab-active-bg"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                <div style={{ position: 'relative', zIndex: 1 }}>
                  <div className="period-tab-name">{p.label}</div>
                  <div className="period-tab-sub">{p.name}</div>
                  <div
                    className={`period-tab-change ${
                      changePct !== null && changePct > 0
                        ? 'change-gain'
                        : changePct !== null && changePct < 0
                        ? 'change-loss'
                        : 'change-neutral'
                    }`}
                  >
                    {changePct !== null ? formatPercentVN(changePct) : '—'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Period Detailed Presentation */}
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedPeriod}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="analysis-period-card"
          >
            {/* Header of Active Period */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.15rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <span className="period-badge-large">{activePeriodConfig.label}</span>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--color-slate-900)', fontWeight: 800 }}>
                    Giai đoạn {activePeriodConfig.name}
                  </h4>
                  <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-500)' }}>
                    {isPeriodAvailable
                      ? `${activePeriodData.validSessionCount || 0} ${isCloseOnly ? 'ngày' : 'phiên'} dữ liệu hoàn tất (${formatDate(activePeriodData.observedStartAt)} → ${formatDate(activePeriodData.observedEndAt)})`
                      : 'Chưa đủ dữ liệu phân tích'}
                  </span>
                </div>
              </div>

              <span className={`fintech-badge ${isPeriodAvailable ? 'badge-gain' : 'badge-neutral'}`}>
                {isPeriodAvailable ? 'Đủ dữ liệu' : 'Chưa đủ dữ liệu'}
              </span>
            </div>

            {isPeriodAvailable ? (
              <div>
                {/* Metrics Grid for this Period */}
                <div className="metrics-grid" style={{ marginBottom: '1.25rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                  {/* Biến động giá */}
                  <div
                    className={`metric-card ${
                      isPositiveChange ? 'metric-card-gain' : isNegativeChange ? 'metric-card-loss' : ''
                    }`}
                    style={{
                      padding: '0.95rem 1rem',
                      '--card-accent': isPositiveChange ? '#10b981' : isNegativeChange ? '#ef4444' : '#64748b'
                    }}
                  >
                    <div className="metric-label">Biến động giá</div>
                    <div
                      className="metric-value"
                      style={{
                        fontSize: '1.35rem',
                        color: isPositiveChange ? 'var(--color-gain-600)' : isNegativeChange ? 'var(--color-loss-600)' : 'var(--color-slate-800)'
                      }}
                    >
                      {formatPercentVN(activePeriodData.priceChangePct)}
                    </div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-slate-600)', marginTop: '2px' }}>
                      {typeof activePeriodData.absoluteChange === 'number'
                        ? formatMarketChange(activePeriodData.absoluteChange, quoteCurrency)
                        : '—'}
                    </div>
                  </div>

                  {/* Khoảng giá (Low -> High) */}
                  <div className="metric-card" style={{ padding: '0.95rem 1rem', '--card-accent': '#6366f1' }}>
                    <div className="metric-label">{isCloseOnly ? 'Khoảng giá đóng cửa' : 'Khoảng giá trong kỳ'}</div>
                    <div className="metric-value" style={{ fontSize: '0.95rem', color: 'var(--color-slate-900)' }}>
                      {effectiveLowPrice !== null && effectiveHighPrice !== null ? (
                        <span>{formatNativeAmount(effectiveLowPrice, quoteCurrency)} &rarr; {formatNativeAmount(effectiveHighPrice, quoteCurrency)}</span>
                      ) : '—'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                      Biên độ: {typeof effectiveHighPrice === 'number' && typeof effectiveLowPrice === 'number'
                        ? formatMarketChange(effectiveHighPrice - effectiveLowPrice, quoteCurrency, { showCurrency: true })
                        : '—'}
                    </div>
                  </div>

                  {/* Cách đỉnh giai đoạn */}
                  <div
                    className="metric-card"
                    style={{
                      padding: '0.95rem 1rem',
                      '--card-accent': effectiveDistanceBelowHigh === 0 ? '#10b981' : '#f59e0b'
                    }}
                  >
                    <div className="metric-label">Cách đỉnh giai đoạn</div>
                    <div className="metric-value" style={{ fontSize: '1.05rem', color: 'var(--color-slate-800)' }}>
                      {effectiveDistanceBelowHigh === 0 ? (
                        <span style={{ color: 'var(--color-gain-600)', fontWeight: 700 }}>
                          Đang ở đỉnh kỳ ✨
                        </span>
                      ) : typeof effectiveDistanceBelowHigh === 'number' ? (
                        <span>Thấp hơn đỉnh {effectiveDistanceBelowHigh.toFixed(2).replace('.', ',')}%</span>
                      ) : '—'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                      {effectiveDistanceBelowHigh === 0
                        ? 'Giá phân tích trùng với mức cao nhất trong kỳ'
                        : `Đỉnh: ${formatNativeAmount(effectiveHighPrice, quoteCurrency)}`}
                    </div>
                  </div>

                  {/* Tỷ lệ mốc đóng cửa tăng */}
                  {typeof activePeriodData.positiveCloseTransitionRatio === 'number' && (
                    <div className="metric-card" style={{ padding: '0.95rem 1rem', '--card-accent': '#0284c7' }}>
                      <div className="metric-label">Tỷ lệ mốc đóng cửa tăng</div>
                      <div className="metric-value" style={{ fontSize: '1.15rem', color: 'var(--color-slate-900)' }}>
                        {(activePeriodData.positiveCloseTransitionRatio * 100).toFixed(1).replace('.', ',')}%
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                        Tỷ lệ các mốc có giá đóng cửa tăng so với mốc trước
                      </div>
                    </div>
                  )}

                  {/* Biến động ngày (Volatility) */}
                  {typeof activePeriodData.dailyVolatilityPct === 'number' && (
                    <div className="metric-card" style={{ padding: '0.95rem 1rem', '--card-accent': '#8b5cf6' }}>
                      <div className="metric-label">Biến động ngày</div>
                      <div className="metric-value" style={{ fontSize: '1.15rem', color: 'var(--color-slate-900)' }}>
                        {activePeriodData.dailyVolatilityPct.toFixed(2).replace('.', ',')}%
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                        Độ lệch chuẩn log-return ngày
                      </div>
                    </div>
                  )}

                  {/* Sụt giảm tối đa theo giá đóng cửa (Max Drawdown) */}
                  {typeof activePeriodData.maxDrawdownPct === 'number' && (
                    <div className="metric-card" style={{ padding: '0.95rem 1rem', '--card-accent': '#f43f5e' }}>
                      <div className="metric-label">Sụt giảm tối đa (đóng cửa)</div>
                      <div className="metric-value" style={{ fontSize: '1.15rem', color: 'var(--color-loss-600)' }}>
                        {activePeriodData.maxDrawdownPct > 0 ? '-' : ''}{activePeriodData.maxDrawdownPct.toFixed(2).replace('.', ',')}%
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                        Mức giảm lớn nhất từ đỉnh đến đáy đóng cửa
                      </div>
                    </div>
                  )}

                  {/* Số mốc dữ liệu & Giá đầu kỳ */}
                  <div className="metric-card" style={{ padding: '0.95rem 1rem', '--card-accent': '#3b82f6' }}>
                    <div className="metric-label">Số {isCloseOnly ? 'ngày' : 'phiên'} dữ liệu</div>
                    <div className="metric-value" style={{ fontSize: '1.15rem', color: 'var(--color-slate-900)' }}>
                      {activePeriodData.validSessionCount} {isCloseOnly ? 'ngày' : 'phiên'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                      Giá đầu kỳ: {formatNativeAmount(activePeriodData.periodStartPrice, quoteCurrency)}
                    </div>
                  </div>
                </div>

                {/* 5. Range Position Line Visualization */}
                <div className="range-visual-box">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-slate-800)' }}>
                      Vị trí trong vùng giá
                    </span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-brand-700)' }}>
                      {rangePosition !== null ? `Đang ở ${rangePosition.toFixed(1).replace('.', ',')}% của vùng giá` : 'Chưa đủ dữ liệu'}
                    </span>
                  </div>

                  {/* Visual Track */}
                  <div className="range-track-container">
                    <div className="range-track-bar">
                      {rangePosition !== null && (
                        <motion.div
                          className="range-track-fill"
                          initial={{ width: 0 }}
                          animate={{ width: `${rangePosition}%` }}
                          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                        />
                      )}

                      {rangePosition !== null && (
                        <motion.div
                          className="range-indicator-dot"
                          initial={{ left: '0%' }}
                          animate={{ left: `${rangePosition}%` }}
                          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                        >
                          <div className="range-dot-core" />
                          <div className="range-dot-badge">
                            {formatNativeAmount(analysisPrice, quoteCurrency)}
                          </div>
                        </motion.div>
                      )}
                    </div>

                    <div className="range-track-labels">
                      <div className="range-label-left">
                        <span className="label-title">{isCloseOnly ? 'Đóng cửa thấp nhất' : 'Thấp nhất'}</span>
                        <span className="label-price">{formatNativeAmount(effectiveLowPrice, quoteCurrency)}</span>
                      </div>
                      <div className="range-label-right">
                        <span className="label-title">{isCloseOnly ? 'Đóng cửa cao nhất' : 'Cao nhất'}</span>
                        <span className="label-price">{formatNativeAmount(effectiveHighPrice, quoteCurrency)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Unavailable Period State */
              <div className="unavailable-period-box">
                <div style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>📋</div>
                <h5 style={{ margin: '0 0 0.4rem 0', fontSize: '0.95rem', color: 'var(--color-slate-800)', fontWeight: 700 }}>
                  Chưa đủ dữ liệu cho giai đoạn {activePeriodConfig.name}
                </h5>
                <p style={{ margin: '0 0 0.85rem 0', fontSize: '0.82rem', color: 'var(--color-slate-500)' }}>
                  Giai đoạn này không có đủ số mốc dữ liệu hợp lệ hoặc dữ liệu thị trường chưa đủ điều kiện tính toán.
                </p>
                {Array.isArray(activePeriodData.unavailableReasons) && activePeriodData.unavailableReasons.length > 0 && (
                  <div className="unavailable-reasons-list">
                    {activePeriodData.unavailableReasons.map((reason, idx) => (
                      <span key={idx} className="unavailable-reason-chip">
                        • {UNAVAILABLE_REASON_LABELS[reason] || reason}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 6. Multi-Period Summary Matrix (Scannable Table) */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.92rem', color: 'var(--color-slate-800)', fontWeight: 700 }}>
          Bảng đối chiếu 5 giai đoạn
        </h4>
        <div className="table-container" style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)' }}>
          <table className="fintech-table">
            <thead>
              <tr>
                <th>Giai đoạn</th>
                <th>Biến động giá</th>
                <th>Khoảng giá</th>
                <th>Vị trí vùng giá</th>
                <th>Cách đỉnh</th>
                <th>Số {isCloseOnly ? 'ngày' : 'phiên'}</th>
              </tr>
            </thead>
            <tbody>
              {PERIODS_CONFIG.map((p) => {
                const pData = periods[p.key];
                const isAvail = pData && pData.status === 'available';
                const isSelected = selectedPeriod === p.key;

                const pLow = isCloseOnly
                  ? (pData?.lowestCompletedClose ?? pData?.periodLowPrice)
                  : (pData?.periodLowPrice ?? pData?.lowestCompletedClose);

                const pHigh = isCloseOnly
                  ? (pData?.highestCompletedClose ?? pData?.periodHighPrice)
                  : (pData?.periodHighPrice ?? pData?.highestCompletedClose);

                const pDist = isCloseOnly
                  ? (pData?.distanceBelowHighestCompletedClosePct ?? pData?.distanceBelowHighPct)
                  : (pData?.distanceBelowHighPct ?? pData?.distanceBelowHighestCompletedClosePct);

                const pRange = isCloseOnly
                  ? (pData?.completedCloseRangePositionPct ?? pData?.rangePositionPct)
                  : (pData?.rangePositionPct ?? pData?.completedCloseRangePositionPct);

                return (
                  <tr
                    key={p.key}
                    className={`row-interactive ${isSelected ? 'row-editing' : ''}`}
                    onClick={() => setSelectedPeriod(p.key)}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 800, color: isSelected ? 'var(--color-brand-700)' : 'var(--color-slate-900)' }}>
                          {p.label}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)' }}>
                          ({p.name})
                        </span>
                      </div>
                    </td>
                    <td>
                      {isAvail && typeof pData.priceChangePct === 'number' ? (
                        <span
                          className={`fintech-badge ${
                            pData.priceChangePct > 0 ? 'badge-gain' : pData.priceChangePct < 0 ? 'badge-loss' : 'badge-neutral'
                          }`}
                          style={{ fontSize: '0.8rem', padding: '2px 8px' }}
                        >
                          {formatPercentVN(pData.priceChangePct)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-slate-400)' }}>Chưa đủ dữ liệu</span>
                      )}
                    </td>
                    <td>
                      {isAvail && pLow !== null && pHigh !== null ? (
                        <span style={{ fontSize: '0.84rem' }}>
                          {formatNativeAmount(pLow, quoteCurrency)} – {formatNativeAmount(pHigh, quoteCurrency)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-slate-400)' }}>—</span>
                      )}
                    </td>
                    <td>
                      {isAvail && typeof pRange === 'number' ? (
                        <span style={{ fontWeight: 600, color: 'var(--color-slate-800)', fontSize: '0.84rem' }}>
                          {pRange.toFixed(1).replace('.', ',')}%
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-slate-400)' }}>—</span>
                      )}
                    </td>
                    <td>
                      {isAvail && typeof pDist === 'number' ? (
                        <span
                          style={{
                            fontSize: '0.84rem',
                            color: pDist === 0 ? 'var(--color-gain-600)' : 'var(--color-slate-700)',
                            fontWeight: pDist === 0 ? 600 : 400
                          }}
                        >
                          {pDist.toFixed(2).replace('.', ',')}%
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-slate-400)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <span style={{ fontSize: '0.82rem', color: 'var(--color-slate-600)' }}>
                        {isAvail ? `${pData.validSessionCount} ${isCloseOnly ? 'ngày' : 'phiên'}` : `${pData?.validSessionCount || 0} ${isCloseOnly ? 'ngày' : 'phiên'}`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 7. Methodology & Transparency (Collapsible Area) */}
      <div className="methodology-section" style={{ marginBottom: '1.25rem' }}>
        <button
          type="button"
          className="methodology-toggle-btn"
          onClick={() => setShowMethodology(!showMethodology)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.9rem' }}>ℹ️</span>
            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--color-slate-700)' }}>
              Cách tính & Giới hạn phương pháp
            </span>
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-slate-500)' }}>
            {showMethodology ? 'Thu gọn ▲' : 'Xem chi tiết ▼'}
          </span>
        </button>

        <AnimatePresence>
          {showMethodology && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="methodology-content"
            >
              <ul className="methodology-list">
                <li>
                  <strong>Nguồn giá phân tích:</strong> Sử dụng giá đóng cửa của mốc dữ liệu lịch sử đã hoàn tất gần nhất ({methodology.analysisPriceSource || 'last_completed_daily_close'}). Không tính dữ liệu phiên/ngày đang diễn ra.
                </li>
                <li>
                  <strong>Đơn vị tiền tệ:</strong> Định giá theo đồng tiền niêm yết gốc ({quoteCurrency}).
                </li>
                <li>
                  <strong>Cổ tức:</strong> Phép tính biến động giá thuần ({methodology.priceChangeMetric || 'unadjusted_close_change'}), không điều chỉnh dòng tiền cổ tức bằng tiền.
                </li>
                <li>
                  <strong>Sự kiện tài sản:</strong> Chưa điều chỉnh đầy đủ cho toàn bộ các sự kiện tài sản phát sinh trong quá khứ.
                </li>
                <li>
                  <strong>Bản chất phân tích:</strong> Phân tích mô tả định lượng dựa trên các mốc dữ liệu lịch sử đã ghi nhận; không cấu thành dự đoán xu hướng tương lai hay khuyến nghị đầu tư.
                </li>
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 8. Important Non-Alarming Disclaimer */}
      <div className="analysis-disclaimer-card">
        <span style={{ fontSize: '0.95rem' }}>🛡️</span>
        <span style={{ fontSize: '0.82rem', color: 'var(--color-slate-600)', lineHeight: 1.45 }}>
          <strong>Lưu ý:</strong> Đây là phân tích mô tả từ dữ liệu giá, không phải khuyến nghị mua hoặc bán.
        </span>
      </div>
    </TiltCard>
  );
}
