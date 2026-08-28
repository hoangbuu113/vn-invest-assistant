import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TiltCard, MagneticButton, CountUp } from './MotionHelpers.jsx';

const PERIODS_CONFIG = [
  { key: '1W', label: '1T', name: '1 tuần' },
  { key: '1M', label: '1Th', name: '1 tháng' },
  { key: '3M', label: '3Th', name: '3 tháng' },
  { key: '6M', label: '6Th', name: '6 tháng' },
  { key: '1Y', label: '1N', name: '1 năm' }
];

const AVAILABILITY_LABELS = {
  complete: { text: 'Dữ liệu đầy đủ', badgeClass: 'badge-gain' },
  partial: { text: 'Dữ liệu một phần', badgeClass: 'badge-warn' },
  limited: { text: 'Dữ liệu còn hạn chế', badgeClass: 'badge-warn' },
  unavailable: { text: 'Chưa đủ dữ liệu', badgeClass: 'badge-neutral' }
};

const UNAVAILABLE_REASON_LABELS = {
  insufficient_sessions: 'Chưa đủ số phiên giao dịch theo tiêu chuẩn giai đoạn',
  missing_high: 'Thiếu dữ liệu giá cao nhất trong giai đoạn',
  missing_low: 'Thiếu dữ liệu giá thấp nhất trong giai đoạn',
  flat_range: 'Vùng giá chưa xác định được (giá cao nhất bằng giá thấp nhất)',
  analysis_price_outside_range: 'Dữ liệu vùng giá chưa nhất quán với giá phân tích',
  invalid_start_price: 'Giá đầu kỳ không hợp lệ'
};

function formatVND(value) {
  if (value === null || value === undefined || isNaN(value)) return 'N/A';
  return `${Number(value).toLocaleString('vi-VN')} ₫`;
}

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

function formatPercentVN(val, showSign = true) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  const num = Number(val);
  const formatted = Math.abs(num).toFixed(2).replace('.', ',');
  if (num > 0) return showSign ? `+${formatted}%` : `${formatted}%`;
  if (num < 0) return `-${formatted}%`;
  return `0,00%`;
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
          <span className="fintech-badge badge-neutral">Dữ liệu thị trường có độ trễ</span>
        </div>

        <div className="fintech-banner banner-warning" style={{ margin: '0.5rem 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span>Không thể tải dữ liệu phân tích tài sản ({error}).</span>
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

  const {
    analysisPrice,
    analysisAsOf,
    periods = {},
    crossPeriod = {},
    dataCompleteness = {},
    methodology = {}
  } = data;

  const availabilityInfo = AVAILABILITY_LABELS[dataCompleteness.availabilityLevel] || AVAILABILITY_LABELS.unavailable;
  const availableRangesCount = Array.isArray(dataCompleteness.availableRanges) ? dataCompleteness.availableRanges.length : 0;

  const activePeriodConfig = PERIODS_CONFIG.find((p) => p.key === selectedPeriod) || PERIODS_CONFIG[1];
  const activePeriodData = periods[selectedPeriod] || { status: 'unavailable', unavailableReasons: ['insufficient_sessions'] };
  const isPeriodAvailable = activePeriodData.status === 'available';

  const isPositiveChange = typeof activePeriodData.priceChangePct === 'number' && activePeriodData.priceChangePct > 0;
  const isNegativeChange = typeof activePeriodData.priceChangePct === 'number' && activePeriodData.priceChangePct < 0;

  // Clamped dot position for range visual
  const rangePosition = typeof activePeriodData.rangePositionPct === 'number' && Number.isFinite(activePeriodData.rangePositionPct)
    ? Math.min(100, Math.max(0, activePeriodData.rangePositionPct))
    : null;

  return (
    <TiltCard className="fintech-card" style={{ padding: '1.5rem', marginTop: '1.25rem' }}>
      {/* 1. Header & Explanatory Notice */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--color-slate-900)', fontWeight: 800 }}>
              Phân tích tài sản
            </h3>
            <span className={`fintech-badge ${availabilityInfo.badgeClass}`} style={{ fontSize: '0.75rem' }}>
              {availabilityInfo.text} ({availableRangesCount}/5)
            </span>
            <span className="fintech-badge badge-neutral" style={{ fontSize: '0.75rem' }}>
              Dữ liệu thị trường có độ trễ
            </span>
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
            {analysisPrice !== null && analysisPrice !== undefined ? (
              <CountUp value={analysisPrice} suffix=" ₫" />
            ) : 'N/A'}
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--color-slate-500)', marginTop: '3px' }}>
            Giá đóng cửa của phiên hoàn tất gần nhất
          </div>
        </div>

        {/* Ngày dữ liệu */}
        <div className="metric-card" style={{ padding: '0.9rem 1rem', '--card-accent': '#64748b' }}>
          <div className="metric-label">Ngày dữ liệu</div>
          <div className="metric-value" style={{ fontSize: '1.1rem', color: 'var(--color-slate-800)' }}>
            {analysisAsOf ? formatDate(analysisAsOf) : 'N/A'}
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--color-slate-500)', marginTop: '3px' }}>
            Phiên đóng cửa gần nhất được ghi nhận
          </div>
        </div>

        {/* Mức độ sẵn sàng dữ liệu */}
        <div className="metric-card" style={{ padding: '0.9rem 1rem', '--card-accent': availableRangesCount === 5 ? '#10b981' : '#f59e0b' }}>
          <div className="metric-label">Độ bao phủ dữ liệu</div>
          <div className="metric-value" style={{ fontSize: '1.1rem', color: 'var(--color-slate-800)' }}>
            {availableRangesCount}/5 giai đoạn
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--color-slate-500)', marginTop: '3px' }}>
            {availableRangesCount === 5 ? '5/5 giai đoạn có đủ dữ liệu' : `${availableRangesCount} trên 5 giai đoạn có đủ dữ liệu`}
          </div>
        </div>
      </div>

      {/* 3. Cross-Period Breadth Indicator */}
      <div className="analysis-breadth-box" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-slate-800)' }}>
              Giai đoạn tăng giá:
            </span>
            <strong style={{ fontSize: '1.05rem', color: 'var(--color-brand-700)', fontWeight: 800 }}>
              {crossPeriod.positivePeriodCount !== undefined ? `${crossPeriod.positivePeriodCount} / ${crossPeriod.validPeriodCount ?? 5}` : '—'}
            </strong>
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-slate-600)' }}>
            {crossPeriod.positivePeriodRatio !== null && crossPeriod.positivePeriodRatio !== undefined
              ? `${crossPeriod.positivePeriodCount} trong ${crossPeriod.validPeriodCount} giai đoạn có biến động giá dương (${(crossPeriod.positivePeriodRatio * 100).toFixed(0)}%)`
              : 'Chưa đủ dữ liệu giai đoạn để thống kê độ rộng'}
          </span>
        </div>

        {/* Compact Breadth Progress Bar */}
        {crossPeriod.validPeriodCount > 0 && (
          <div className="breadth-mini-bar" style={{ marginTop: '0.65rem' }}>
            <div
              className="breadth-mini-fill"
              style={{
                width: `${(crossPeriod.positivePeriodRatio || 0) * 100}%`
              }}
            />
          </div>
        )}
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
                      ? `${activePeriodData.validSessionCount || 0} phiên giao dịch hoàn tất (${formatDate(activePeriodData.observedStartAt)} → ${formatDate(activePeriodData.observedEndAt)})`
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
                <div className="metrics-grid" style={{ marginBottom: '1.25rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
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
                        ? `${activePeriodData.absoluteChange > 0 ? '+' : ''}${activePeriodData.absoluteChange.toLocaleString('vi-VN')} ₫`
                        : '—'}
                    </div>
                  </div>

                  {/* Khoảng giá (Low -> High) */}
                  <div className="metric-card" style={{ padding: '0.95rem 1rem', '--card-accent': '#6366f1' }}>
                    <div className="metric-label">Khoảng giá trong kỳ</div>
                    <div className="metric-value" style={{ fontSize: '1.05rem', color: 'var(--color-slate-900)' }}>
                      {formatVND(activePeriodData.periodLowPrice)} &rarr; {formatVND(activePeriodData.periodHighPrice)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                      Biên độ: {typeof activePeriodData.periodHighPrice === 'number' && typeof activePeriodData.periodLowPrice === 'number'
                        ? `${(activePeriodData.periodHighPrice - activePeriodData.periodLowPrice).toLocaleString('vi-VN')} ₫`
                        : '—'}
                    </div>
                  </div>

                  {/* Cách đỉnh giai đoạn */}
                  <div
                    className="metric-card"
                    style={{
                      padding: '0.95rem 1rem',
                      '--card-accent': activePeriodData.distanceBelowHighPct === 0 ? '#10b981' : '#f59e0b'
                    }}
                  >
                    <div className="metric-label">Cách đỉnh giai đoạn</div>
                    <div className="metric-value" style={{ fontSize: '1.05rem', color: 'var(--color-slate-800)' }}>
                      {activePeriodData.distanceBelowHighPct === 0 ? (
                        <span style={{ color: 'var(--color-gain-600)', fontWeight: 700 }}>
                          Đang ở đỉnh kỳ ✨
                        </span>
                      ) : typeof activePeriodData.distanceBelowHighPct === 'number' ? (
                        <span>Thấp hơn đỉnh {activePeriodData.distanceBelowHighPct.toFixed(2).replace('.', ',')}%</span>
                      ) : '—'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                      {activePeriodData.distanceBelowHighPct === 0
                        ? 'Giá phân tích trùng với mức cao nhất trong kỳ'
                        : `Đỉnh cao nhất: ${formatVND(activePeriodData.periodHighPrice)}`}
                    </div>
                  </div>

                  {/* Số phiên giao dịch */}
                  <div className="metric-card" style={{ padding: '0.95rem 1rem', '--card-accent': '#3b82f6' }}>
                    <div className="metric-label">Số phiên dữ liệu</div>
                    <div className="metric-value" style={{ fontSize: '1.15rem', color: 'var(--color-slate-900)' }}>
                      {activePeriodData.validSessionCount} phiên
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                      Giá đầu kỳ: {formatVND(activePeriodData.periodStartPrice)}
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
                            {formatVND(analysisPrice)}
                          </div>
                        </motion.div>
                      )}
                    </div>

                    <div className="range-track-labels">
                      <div className="range-label-left">
                        <span className="label-title">Thấp nhất</span>
                        <span className="label-price">{formatVND(activePeriodData.periodLowPrice)}</span>
                      </div>
                      <div className="range-label-right">
                        <span className="label-title">Cao nhất</span>
                        <span className="label-price">{formatVND(activePeriodData.periodHighPrice)}</span>
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
                  Giai đoạn này không có đủ số phiên hợp lệ hoặc dữ liệu thị trường chưa đủ điều kiện tính toán.
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
                <th>Khoảng giá (Thấp - Cao)</th>
                <th>Vị trí vùng giá</th>
                <th>Cách đỉnh</th>
                <th>Số phiên</th>
              </tr>
            </thead>
            <tbody>
              {PERIODS_CONFIG.map((p) => {
                const pData = periods[p.key];
                const isAvail = pData && pData.status === 'available';
                const isSelected = selectedPeriod === p.key;

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
                      {isAvail && pData.periodLowPrice !== null && pData.periodHighPrice !== null ? (
                        <span style={{ fontSize: '0.84rem' }}>
                          {Number(pData.periodLowPrice).toLocaleString('vi-VN')} – {Number(pData.periodHighPrice).toLocaleString('vi-VN')} ₫
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-slate-400)' }}>—</span>
                      )}
                    </td>
                    <td>
                      {isAvail && typeof pData.rangePositionPct === 'number' ? (
                        <span style={{ fontWeight: 600, color: 'var(--color-slate-800)', fontSize: '0.84rem' }}>
                          {pData.rangePositionPct.toFixed(1).replace('.', ',')}%
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-slate-400)' }}>—</span>
                      )}
                    </td>
                    <td>
                      {isAvail && typeof pData.distanceBelowHighPct === 'number' ? (
                        <span
                          style={{
                            fontSize: '0.84rem',
                            color: pData.distanceBelowHighPct === 0 ? 'var(--color-gain-600)' : 'var(--color-slate-700)',
                            fontWeight: pData.distanceBelowHighPct === 0 ? 600 : 400
                          }}
                        >
                          {pData.distanceBelowHighPct.toFixed(2).replace('.', ',')}%
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-slate-400)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <span style={{ fontSize: '0.82rem', color: 'var(--color-slate-600)' }}>
                        {isAvail ? `${pData.validSessionCount} phiên` : `${pData?.validSessionCount || 0} phiên`}
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
                  <strong>Nguồn giá phân tích:</strong> Sử dụng giá đóng cửa của phiên giao dịch lịch sử đã hoàn tất gần nhất ({methodology.analysisPriceSource || 'last_completed_daily_close'}). Không tính phiên trong ngày đang diễn ra.
                </li>
                <li>
                  <strong>Độ trễ dữ liệu:</strong> Dữ liệu thị trường có độ trễ (~15 phút) từ nguồn tham chiếu.
                </li>
                <li>
                  <strong>Cổ tức:</strong> Phép tính biến động giá thuần ({methodology.priceChangeMetric || 'unadjusted_close_change'}), không điều chỉnh dòng tiền cổ tức bằng tiền.
                </li>
                <li>
                  <strong>Sự kiện doanh nghiệp:</strong> Chưa điều chỉnh đầy đủ cho toàn bộ các sự kiện doanh nghiệp phát sinh trong quá khứ.
                </li>
                <li>
                  <strong>Bản chất phân tích:</strong> Phân tích mô tả định lượng dựa trên các phiên giao dịch lịch sử đã ghi nhận; không cấu thành dự đoán xu hướng tương lai hay phân tích cơ bản doanh nghiệp.
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

