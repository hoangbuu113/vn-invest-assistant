import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { TiltCard, MagneticButton } from './MotionHelpers.jsx';

const ASSET_TYPE_LABELS = {
  stock: 'Cổ phiếu',
  etf: 'ETF',
  fund: 'Quỹ đầu tư',
  gold: 'Vàng',
  deposit: 'Tiền gửi',
  bank_deposit: 'Tiền gửi',
  bond: 'Trái phiếu',
  unknown: 'Khác'
};

function formatAssetType(assetType) {
  if (!assetType) return 'N/A';
  return ASSET_TYPE_LABELS[String(assetType).toLowerCase()] || assetType;
}

function formatVND(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return `${Number(value).toLocaleString('vi-VN')} ₫`;
}

function formatPercentVN(val) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  return `${Number(val).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
}

const COVERAGE_CONFIG = {
  complete: { text: 'Định giá đầy đủ', badgeClass: 'badge-gain' },
  partial: { text: 'Định giá một phần', badgeClass: 'badge-warn' },
  unavailable: { text: 'Chưa có đủ dữ liệu giá', badgeClass: 'badge-neutral' },
  not_applicable: { text: 'Chưa có tài sản', badgeClass: 'badge-neutral' }
};

/**
 * Premium 2.5D Donut Component with SVG depth layering and interactive hover
 */
function CompositionDonut25D({
  cashValue = 0,
  cashWeightPct = null,
  pricedHoldingsMarketValue = 0,
  pricedAssetsWeightPct = null,
  knownAllocationValue = 0,
  isKnownValueOnly = false,
  hoveredSegment,
  setHoveredSegment
}) {
  const size = 200;
  const strokeWidth = 18;
  const center = 100;
  const radius = 72; // radius 72 + strokeWidth/2 (9) = 81, fits cleanly inside 100
  const circumference = 2 * Math.PI * radius;

  const validCashPct = cashWeightPct !== null && !isNaN(cashWeightPct) ? Math.max(0, Math.min(100, cashWeightPct)) : 0;
  const validPricedPct = pricedAssetsWeightPct !== null && !isNaN(pricedAssetsWeightPct) ? Math.max(0, Math.min(100, pricedAssetsWeightPct)) : 0;

  const hasData = validCashPct > 0 || validPricedPct > 0;
  const cashStrokeLength = hasData ? (validCashPct / 100) * circumference : 0;
  const pricedStrokeLength = hasData ? (validPricedPct / 100) * circumference : 0;

  // Center display data
  let centerTitle = isKnownValueOnly ? 'Giá trị đã biết' : 'Tổng danh mục';
  let centerValue = formatVND(knownAllocationValue);
  let centerPct = null;
  let centerDotClass = null;

  if (hoveredSegment === 'cash') {
    centerTitle = 'Tiền mặt';
    centerValue = formatVND(cashValue);
    centerPct = formatPercentVN(cashWeightPct);
    centerDotClass = 'dot-cash';
  } else if (hoveredSegment === 'invested') {
    centerTitle = 'Tài sản định giá';
    centerValue = formatVND(pricedHoldingsMarketValue);
    centerPct = formatPercentVN(pricedAssetsWeightPct);
    centerDotClass = 'dot-invested';
  }

  return (
    <div
      className="donut-interactive-wrapper"
      onMouseLeave={() => setHoveredSegment(null)}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="donut-svg"
      >
        <defs>
          {/* Depth Drop Shadow Filter */}
          <filter id="donutDepthShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#0f172a" floodOpacity="0.1" />
          </filter>

          {/* Cash Gradients */}
          <linearGradient id="cashSurfaceGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
          <linearGradient id="cashBaseGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1d4ed8" />
            <stop offset="100%" stopColor="#1e3a8a" />
          </linearGradient>

          {/* Invested Asset Gradients */}
          <linearGradient id="investedSurfaceGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
          <linearGradient id="investedBaseGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6d28d9" />
            <stop offset="100%" stopColor="#4c1d95" />
          </linearGradient>

          {/* Gloss Top Specular Highlight */}
          <linearGradient id="glossHighlight" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3" />
            <stop offset="40%" stopColor="#ffffff" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 1. Base / Extrusion Shadow Layer (Shifted Down 3px for 2.5D Depth) */}
        <g transform="translate(0, 3)" filter="url(#donutDepthShadow)">
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--color-slate-200)"
            strokeWidth={strokeWidth}
            opacity="0.5"
          />
          {hasData && (
            <>
              {validCashPct > 0 && (
                <circle
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke="url(#cashBaseGrad)"
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${cashStrokeLength} ${circumference}`}
                  strokeDashoffset="0"
                  transform={`rotate(-90 ${center} ${center})`}
                />
              )}
              {validPricedPct > 0 && (
                <circle
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke="url(#investedBaseGrad)"
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${pricedStrokeLength} ${circumference}`}
                  strokeDashoffset={`-${cashStrokeLength}`}
                  transform={`rotate(-90 ${center} ${center})`}
                />
              )}
            </>
          )}
        </g>

        {/* 2. Main Top Donut Ring */}
        <g>
          {/* Background Track */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--color-slate-100)"
            strokeWidth={strokeWidth}
          />

          {/* Cash Arc */}
          {validCashPct > 0 && (
            <motion.circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="url(#cashSurfaceGrad)"
              strokeWidth={hoveredSegment === 'cash' ? strokeWidth + 3 : strokeWidth}
              strokeDasharray={`${cashStrokeLength} ${circumference}`}
              strokeDashoffset="0"
              transform={`rotate(-90 ${center} ${center})`}
              className="donut-segment"
              onMouseEnter={() => setHoveredSegment('cash')}
              onMouseLeave={() => setHoveredSegment(null)}
              initial={{ strokeDasharray: `0 ${circumference}` }}
              animate={{ strokeDasharray: `${cashStrokeLength} ${circumference}` }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              style={{
                cursor: 'pointer',
                transition: 'stroke-width 0.2s ease, filter 0.2s ease',
                filter: hoveredSegment === 'cash' ? 'drop-shadow(0 0 6px rgba(59, 130, 246, 0.4))' : 'none'
              }}
            />
          )}

          {/* Priced Assets Arc */}
          {validPricedPct > 0 && (
            <motion.circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="url(#investedSurfaceGrad)"
              strokeWidth={hoveredSegment === 'invested' ? strokeWidth + 3 : strokeWidth}
              strokeDasharray={`${pricedStrokeLength} ${circumference}`}
              strokeDashoffset={`-${cashStrokeLength}`}
              transform={`rotate(-90 ${center} ${center})`}
              className="donut-segment"
              onMouseEnter={() => setHoveredSegment('invested')}
              onMouseLeave={() => setHoveredSegment(null)}
              initial={{ strokeDasharray: `0 ${circumference}` }}
              animate={{ strokeDasharray: `${pricedStrokeLength} ${circumference}` }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              style={{
                cursor: 'pointer',
                transition: 'stroke-width 0.2s ease, filter 0.2s ease',
                filter: hoveredSegment === 'invested' ? 'drop-shadow(0 0 6px rgba(139, 92, 246, 0.4))' : 'none'
              }}
            />
          )}

          {/* 3. Gloss Top Specular Highlight */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="url(#glossHighlight)"
            strokeWidth={strokeWidth}
            pointerEvents="none"
          />
        </g>
      </svg>

      {/* 4. Center Disc Content (HTML overlay inside donut hole) */}
      <div className="donut-center-content">
        <div className="donut-center-title">
          {centerDotClass && <span className={`composition-indicator-dot ${centerDotClass}`} />}
          <span>{centerTitle}</span>
        </div>
        <div className="donut-center-value">{centerValue}</div>
        {centerPct ? (
          <div className="donut-center-pct">{centerPct}</div>
        ) : (
          <div className="donut-center-sub">100% giá trị đã biết</div>
        )}
      </div>
    </div>
  );
}

export function PortfolioCompositionSection({
  data,
  loading = false,
  error = null,
  onRetry
}) {
  const [hoveredSegment, setHoveredSegment] = useState(null); // 'cash' | 'invested' | null

  // 1. Loading Skeleton State
  if (loading && !data) {
    return (
      <motion.div
        className="fintech-card"
        style={{ padding: '1.5rem', marginTop: '1.5rem' }}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div className="skeleton-shimmer" style={{ width: '180px', height: '24px', marginBottom: '6px' }} />
            <div className="skeleton-shimmer" style={{ width: '260px', height: '14px' }} />
          </div>
          <div className="skeleton-shimmer" style={{ width: '120px', height: '26px', borderRadius: 'var(--radius-full)' }} />
        </div>

        <div className="composition-top-grid" style={{ marginBottom: '1.25rem' }}>
          <div className="skeleton-shimmer" style={{ height: '220px', borderRadius: 'var(--radius-lg)' }} />
          <div className="skeleton-shimmer" style={{ height: '220px', borderRadius: 'var(--radius-lg)' }} />
        </div>

        <div className="skeleton-shimmer" style={{ height: '200px', borderRadius: 'var(--radius-lg)' }} />
      </motion.div>
    );
  }

  // 2. Fatal Error State (Only when no data exists)
  if (error && !data) {
    return (
      <div className="fintech-banner banner-error" style={{ marginTop: '1.5rem' }}>
        <div>
          <strong style={{ display: 'block', marginBottom: '0.2rem' }}>Không thể tải cơ cấu danh mục</strong>
          <span style={{ fontSize: '0.85rem' }}>{error}</span>
        </div>
        {onRetry && (
          <MagneticButton
            onClick={onRetry}
            className="fintech-btn btn-danger btn-sm"
          >
            Thử lại
          </MagneticButton>
        )}
      </div>
    );
  }

  // If no data yet, do not render
  if (!data) return null;

  const {
    hasHoldings,
    totalHoldingsCount = 0,
    pricedHoldingsCount = 0,
    unpricedHoldingsCount = 0,
    valuationCoverageLevel = 'not_applicable',
    allocationBasis = 'no_known_value',
    cashValue = 0,
    pricedHoldingsMarketValue = 0,
    knownAllocationValue = 0,
    cashWeightPct = null,
    pricedAssetsWeightPct = null,
    holdingAllocations = [],
    assetTypeGroups = [],
    largestHolding = null,
    top3HoldingsWeightPct = null,
    pricedHoldingCountUsed = 0
  } = data;

  const coverageInfo = COVERAGE_CONFIG[valuationCoverageLevel] || COVERAGE_CONFIG.unavailable;
  const isPartial = valuationCoverageLevel === 'partial';
  const isKnownValueOnly = allocationBasis === 'known_value_only';

  // 3. Completely Empty State (No cash and no holdings)
  if (!hasHoldings && cashValue === 0) {
    return (
      <motion.div
        className="fintech-card"
        style={{ marginTop: '1.5rem', overflow: 'hidden' }}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="card-header">
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
              Cơ cấu danh mục
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
              Tỷ trọng phân bổ tài sản và mức độ tập trung danh mục
            </div>
          </div>
        </div>
        <div className="state-box" style={{ border: 'none', boxShadow: 'none', padding: '2.5rem 1rem' }}>
          <div className="state-icon float-icon">📊</div>
          <h3 className="state-title">Chưa có dữ liệu để hiển thị cơ cấu danh mục</h3>
          <p className="state-desc">
            Vui lòng cập nhật số dư tiền mặt hoặc thêm tài sản trong mục <strong>Hồ sơ đầu tư</strong>.
          </p>
        </div>
      </motion.div>
    );
  }

  // Only show top 3 when there are multiple priced holdings (removes redundant 1-holding duplicate)
  const showTop3Card = pricedHoldingCountUsed > 1 && top3HoldingsWeightPct !== null;

  return (
    <motion.div
      className="fintech-card composition-section"
      style={{ marginTop: '1.5rem', overflow: 'hidden' }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* Header */}
      <div className="card-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
              Cơ cấu danh mục
            </span>
            <span className={`fintech-badge ${coverageInfo.badgeClass}`}>
              {coverageInfo.text}
            </span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
            Phân bổ tiền mặt, tài sản đầu tư và mức độ tập trung danh mục
          </div>
        </div>

        {isPartial && (
          <div style={{ fontSize: '0.8rem', color: 'var(--color-slate-600)', background: 'var(--color-slate-100)', padding: '4px 10px', borderRadius: 'var(--radius-sm)' }}>
            {pricedHoldingsCount}/{totalHoldingsCount} tài sản có dữ liệu giá
          </div>
        )}
      </div>

      <div style={{ padding: '1.25rem 1.5rem' }}>
        {/* Partial Valuation Explanatory Banner */}
        {isPartial && (
          <div className="fintech-banner banner-warning" style={{ marginBottom: '1.25rem', marginTop: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
              <span>ℹ️</span>
              <span>
                <strong>Tỷ trọng được tính trên phần giá trị hiện có dữ liệu giá.</strong>{' '}
                ({pricedHoldingsCount}/{totalHoldingsCount} tài sản có dữ liệu giá từ thị trường).
              </span>
            </div>
          </div>
        )}

        {/* Top 2-Column Grid: 2.5D Donut Allocation & Descriptive Concentration */}
        <div className="composition-top-grid">
          {/* Box 1: 2.5D Donut Allocation (Tiền mặt vs Tài sản đã định giá) */}
          <TiltCard className="composition-panel-card" style={{ '--card-accent': '#3b82f6' }}>
            <div className="composition-panel-title">
              <span>Phân bổ Vốn & Tài sản</span>
              <span className="fintech-badge badge-neutral" style={{ fontSize: '0.72rem' }}>
                {isKnownValueOnly ? 'Theo giá trị đã biết' : 'Tổng danh mục'}
              </span>
            </div>

            {/* Donut Visual & Legend Layout */}
            <div className="donut-layout-container">
              {/* 2.5D Donut Visual */}
              <div className="donut-visual-col">
                <CompositionDonut25D
                  cashValue={cashValue}
                  cashWeightPct={cashWeightPct}
                  pricedHoldingsMarketValue={pricedHoldingsMarketValue}
                  pricedAssetsWeightPct={pricedAssetsWeightPct}
                  knownAllocationValue={knownAllocationValue}
                  isKnownValueOnly={isKnownValueOnly}
                  hoveredSegment={hoveredSegment}
                  setHoveredSegment={setHoveredSegment}
                />
              </div>

              {/* Side Legend */}
              <div className="donut-legend-col">
                {/* Cash item */}
                <div
                  className={`donut-legend-item ${hoveredSegment === 'cash' ? 'legend-item-active' : ''}`}
                  onMouseEnter={() => setHoveredSegment('cash')}
                  onMouseLeave={() => setHoveredSegment(null)}
                >
                  <div className="donut-legend-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="composition-indicator-dot dot-cash" />
                      <span className="donut-legend-name">Tiền mặt</span>
                    </div>
                    <span className="donut-legend-pct cash-pct">{formatPercentVN(cashWeightPct)}</span>
                  </div>
                  <div className="donut-legend-val">{formatVND(cashValue)}</div>
                </div>

                {/* Priced Assets item */}
                <div
                  className={`donut-legend-item ${hoveredSegment === 'invested' ? 'legend-item-active' : ''}`}
                  onMouseEnter={() => setHoveredSegment('invested')}
                  onMouseLeave={() => setHoveredSegment(null)}
                >
                  <div className="donut-legend-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="composition-indicator-dot dot-invested" />
                      <span className="donut-legend-name">Tài sản đã định giá</span>
                    </div>
                    <span className="donut-legend-pct invested-pct">{formatPercentVN(pricedAssetsWeightPct)}</span>
                  </div>
                  <div className="donut-legend-val">{formatVND(pricedHoldingsMarketValue)}</div>
                </div>
              </div>
            </div>
          </TiltCard>

          {/* Box 2: Descriptive Concentration (Mức tập trung hiện tại) */}
          <TiltCard className="composition-panel-card" style={{ '--card-accent': '#6366f1' }}>
            <div className="composition-panel-title">
              <span>Mức tập trung hiện tại</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-slate-400)' }}>
                Số liệu định lượng
              </span>
            </div>

            <div className="concentration-items-container">
              {/* Largest Holding */}
              <div className="concentration-stat-box">
                <div className="concentration-stat-header">
                  <span className="concentration-stat-label">Tài sản lớn nhất</span>
                  {largestHolding && (
                    <span className="fintech-badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                      {formatAssetType(largestHolding.assetType)}
                    </span>
                  )}
                </div>

                {largestHolding ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
                      <span className="concentration-symbol">{largestHolding.symbol || 'N/A'}</span>
                      <span className="concentration-pct-highlight">
                        {formatPercentVN(largestHolding.weightPct)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }}>
                        {largestHolding.name || 'Tài sản'}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-700)', fontWeight: 700 }}>
                        {formatVND(largestHolding.marketValue)}
                      </span>
                    </div>
                    <div className="concentration-basis-note">
                      {isKnownValueOnly ? '% trên phần giá trị đã định giá' : '% tổng giá trị danh mục'}
                    </div>
                  </div>
                ) : (
                  <div className="concentration-empty-note">
                    {!hasHoldings ? 'Chưa có tài sản đang nắm giữ' : 'Chưa có tài sản được định giá'}
                  </div>
                )}
              </div>

              {/* Top 3 Holdings Weight (Only shown when there are 2 or more priced holdings) */}
              {showTop3Card ? (
                <div className="concentration-stat-box">
                  <div className="concentration-stat-header">
                    <span className="concentration-stat-label">
                      {pricedHoldingCountUsed > 0 && pricedHoldingCountUsed < 3
                        ? `Tổng ${pricedHoldingCountUsed} tài sản lớn nhất`
                        : 'Top 3 tài sản'}
                    </span>
                  </div>

                  <div>
                    <div className="concentration-pct-large">
                      {formatPercentVN(top3HoldingsWeightPct)}
                    </div>
                    <div className="concentration-basis-note" style={{ marginTop: '4px' }}>
                      {isKnownValueOnly ? '% trên phần giá trị đã định giá' : '% tổng giá trị danh mục'}
                    </div>
                  </div>
                </div>
              ) : largestHolding && (
                <div className="concentration-stat-box" style={{ background: 'transparent', borderStyle: 'dashed' }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-slate-500)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>📌</span>
                    <span>
                      {unpricedHoldingsCount > 0
                        ? `1 tài sản có giá, ${unpricedHoldingsCount} tài sản chưa có dữ liệu giá`
                        : `Toàn bộ ${totalHoldingsCount} tài sản đã được định giá`}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </TiltCard>
        </div>

        {/* Section 3 & 4: Holding Breakdown & Asset Type Breakdown Grid */}
        <div className="composition-breakdown-grid" style={{ marginTop: '1.5rem' }}>
          {/* Left Column: Phân bổ theo tài sản */}
          <div className="composition-breakdown-card">
            <div className="breakdown-header">
              <span className="breakdown-title">Phân bổ theo tài sản</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-slate-500)', fontWeight: 600 }}>
                {holdingAllocations.length} tài sản
              </span>
            </div>

            {holdingAllocations.length === 0 ? (
              <div className="breakdown-empty">Chưa có tài sản nào trong danh mục.</div>
            ) : (
              <div className="allocation-list">
                {holdingAllocations.map((h, idx) => {
                  const isPriced = h.isPriced;
                  const weightClamped = h.weightPct !== null ? Math.min(100, Math.max(0, h.weightPct)) : 0;

                  return (
                    <div key={h.id || h.assetId || h.symbol || idx} className="allocation-item">
                      <div className="allocation-item-top">
                        <div className="allocation-item-info">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span className="allocation-item-symbol">{h.symbol || 'N/A'}</span>
                            {h.assetType && (
                              <span className="fintech-badge badge-neutral" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                                {formatAssetType(h.assetType)}
                              </span>
                            )}
                          </div>
                          {h.name && (
                            <span className="allocation-item-subname">{h.name}</span>
                          )}
                        </div>

                        <div className="allocation-item-nums">
                          {isPriced ? (
                            <>
                              <span className="allocation-item-val">{formatVND(h.marketValue)}</span>
                              <span className="allocation-item-pct">{formatPercentVN(h.weightPct)}</span>
                            </>
                          ) : (
                            <>
                              <span className="allocation-item-unpriced">Chưa có dữ liệu giá</span>
                              <span className="allocation-item-pct" style={{ color: 'var(--color-slate-400)' }}>—</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Visual Bar for Holding */}
                      <div className="allocation-bar-track">
                        {isPriced && h.weightPct !== null ? (
                          <motion.div
                            className="allocation-bar-fill"
                            style={{ width: `${weightClamped}%` }}
                            initial={{ width: 0 }}
                            animate={{ width: `${weightClamped}%` }}
                            transition={{ duration: 0.5, delay: idx * 0.04, ease: [0.16, 1, 0.3, 1] }}
                          />
                        ) : (
                          <div className="allocation-bar-unpriced-fill" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Phân bổ theo loại tài sản */}
          <div className="composition-breakdown-card">
            <div className="breakdown-header">
              <span className="breakdown-title">Phân bổ theo loại tài sản</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-slate-500)', fontWeight: 600 }}>
                {assetTypeGroups.length} nhóm
              </span>
            </div>

            {assetTypeGroups.length === 0 ? (
              <div className="breakdown-empty">
                {hasHoldings ? 'Chưa có tài sản có dữ liệu định giá.' : 'Chưa có tài sản trong danh mục.'}
              </div>
            ) : (
              <div className="allocation-list">
                {assetTypeGroups.map((g, idx) => {
                  const weightClamped = g.weightPct !== null ? Math.min(100, Math.max(0, g.weightPct)) : 0;

                  return (
                    <div key={g.assetType || idx} className="allocation-item">
                      <div className="allocation-item-top">
                        <div className="allocation-item-info">
                          <span className="allocation-item-symbol">{formatAssetType(g.assetType)}</span>
                          <span className="allocation-item-subname">
                            {g.holdingCount} tài sản
                          </span>
                        </div>

                        <div className="allocation-item-nums">
                          <span className="allocation-item-val">{formatVND(g.marketValue)}</span>
                          <span className="allocation-item-pct">{formatPercentVN(g.weightPct)}</span>
                        </div>
                      </div>

                      {/* Visual Bar for Asset Type */}
                      <div className="allocation-bar-track">
                        {g.weightPct !== null ? (
                          <motion.div
                            className="allocation-bar-fill asset-type-fill"
                            style={{ width: `${weightClamped}%` }}
                            initial={{ width: 0 }}
                            animate={{ width: `${weightClamped}%` }}
                            transition={{ duration: 0.5, delay: idx * 0.05, ease: [0.16, 1, 0.3, 1] }}
                          />
                        ) : (
                          <div className="allocation-bar-unpriced-fill" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
