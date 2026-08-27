import React, { useState, useRef, useId } from 'react';

/**
 * Format date for X axis and tooltips in Vietnamese
 */
function formatDateLabel(isoString, isFull = false) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    if (isFull) {
      return d.toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    }
    return d.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit'
    });
  } catch {
    return isoString;
  }
}

/**
 * Formats currency in VND
 */
function formatVND(value) {
  if (value === null || value === undefined || isNaN(value)) return 'N/A';
  return `${Number(value).toLocaleString('vi-VN')} ₫`;
}

export function PriceHistoryChart({
  bars = [],
  percentageChange = null,
  currency = 'VND'
}) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const svgRef = useRef(null);
  const gradientId = useId();

  if (!bars || bars.length === 0) {
    return (
      <div className="chart-empty-state">
        <span>Không có dữ liệu lịch sử giá</span>
      </div>
    );
  }

  if (bars.length < 2) {
    return (
      <div className="chart-empty-state">
        <span>Chưa đủ phiên giao dịch để vẽ biểu đồ xu hướng (cần tối thiểu 2 phiên)</span>
      </div>
    );
  }

  // Theme styling based on period change
  const isPositive = (percentageChange || 0) > 0;
  const isNegative = (percentageChange || 0) < 0;

  const strokeColor = isPositive ? '#10b981' : isNegative ? '#ef4444' : '#64748b';
  const fillGradientStart = isPositive
    ? 'rgba(16, 185, 129, 0.28)'
    : isNegative
    ? 'rgba(239, 68, 68, 0.28)'
    : 'rgba(100, 116, 139, 0.2)';
  const fillGradientEnd = isPositive
    ? 'rgba(16, 185, 129, 0.0)'
    : isNegative
    ? 'rgba(239, 68, 68, 0.0)'
    : 'rgba(100, 116, 139, 0.0)';

  // Dimensions
  const width = 680;
  const height = 240;
  const paddingLeft = 70;
  const paddingRight = 20;
  const paddingTop = 25;
  const paddingBottom = 35;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // Min / Max calculation with padding headroom
  const closes = bars.map((b) => b.close).filter((c) => typeof c === 'number' && isFinite(c));
  const minPrice = Math.min(...closes);
  const maxPrice = Math.max(...closes);
  const priceRange = maxPrice - minPrice || 1;

  const yMin = Math.max(0, minPrice - priceRange * 0.06);
  const yMax = maxPrice + priceRange * 0.06;
  const ySpan = yMax - yMin || 1;

  // Coordinate mapping
  const getX = (i) => paddingLeft + (i / (bars.length - 1)) * chartWidth;
  const getY = (price) => height - paddingBottom - ((price - yMin) / ySpan) * chartHeight;

  // Build SVG path
  const points = bars.map((bar, i) => `${getX(i)},${getY(bar.close)}`);
  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `M ${getX(0)},${height - paddingBottom} L ${points.join(' L ')} L ${getX(bars.length - 1)},${height - paddingBottom} Z`;

  // Horizontal Gridlines (4 levels)
  const gridSteps = 4;
  const gridLines = Array.from({ length: gridSteps + 1 }, (_, index) => {
    const p = yMin + (index / gridSteps) * ySpan;
    const yCoord = getY(p);
    return {
      price: Math.round(p),
      y: yCoord
    };
  });

  // X Axis Ticks (4 to 5 ticks)
  const tickCount = Math.min(5, bars.length);
  const xTicks = Array.from({ length: tickCount }, (_, index) => {
    const barIndex = Math.round((index / (tickCount - 1)) * (bars.length - 1));
    return {
      index: barIndex,
      bar: bars[barIndex],
      x: getX(barIndex)
    };
  });

  // Handle pointer / touch movement for interactive tooltip
  const handlePointerMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX);
    if (clientX === undefined) return;

    const relativeX = ((clientX - rect.left) / rect.width) * width;
    const boundedX = Math.max(paddingLeft, Math.min(width - paddingRight, relativeX));
    const ratio = (boundedX - paddingLeft) / chartWidth;
    const nearestIndex = Math.round(ratio * (bars.length - 1));
    const clampedIndex = Math.max(0, Math.min(bars.length - 1, nearestIndex));
    setHoverIndex(clampedIndex);
  };

  const handlePointerLeave = () => {
    setHoverIndex(null);
  };

  const activeBar = hoverIndex !== null ? bars[hoverIndex] : null;
  const activeX = hoverIndex !== null ? getX(hoverIndex) : null;
  const activeY = activeBar !== null ? getY(activeBar.close) : null;

  return (
    <div className="price-history-chart-wrapper">
      {/* Active Bar Floating Readout / Tooltip Header */}
      <div className="chart-active-readout">
        {activeBar ? (
          <div className="active-readout-inner">
            <span className="readout-date">📅 {formatDateLabel(activeBar.timestamp, true)}</span>
            <span className="readout-close">
              Đóng cửa: <strong>{formatVND(activeBar.close)}</strong>
            </span>
            {activeBar.open && (
              <span className="readout-sub">Mở: {formatVND(activeBar.open)}</span>
            )}
            {activeBar.high && (
              <span className="readout-sub">Cao: {formatVND(activeBar.high)}</span>
            )}
            {activeBar.low && (
              <span className="readout-sub">Thấp: {formatVND(activeBar.low)}</span>
            )}
          </div>
        ) : (
          <div className="active-readout-hint">
            <span>Di chuột hoặc chạm vào biểu đồ để xem chi tiết từng phiên</span>
          </div>
        )}
      </div>

      {/* Responsive SVG Chart */}
      <div className="svg-container">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="price-trend-svg"
          onMouseMove={handlePointerMove}
          onMouseLeave={handlePointerLeave}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerLeave}
        >
          <defs>
            {/* Area Fill Gradient */}
            <linearGradient id={`area-grad-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fillGradientStart} />
              <stop offset="100%" stopColor={fillGradientEnd} />
            </linearGradient>

            {/* Filter for glowing active dot */}
            <filter id={`glow-${gradientId}`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Horizontal Gridlines & Price Labels */}
          {gridLines.map((grid, idx) => (
            <g key={idx} className="chart-grid-line">
              <line
                x1={paddingLeft}
                y1={grid.y}
                x2={width - paddingRight}
                y2={grid.y}
                stroke="var(--border-default, #e2e8f0)"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              <text
                x={paddingLeft - 8}
                y={grid.y + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--color-slate-400, #94a3b8)"
                fontWeight="500"
                fontFamily="var(--font-mono, monospace)"
              >
                {grid.price.toLocaleString('vi-VN')}
              </text>
            </g>
          ))}

          {/* Area Gradient Fill */}
          <path
            d={areaPath}
            fill={`url(#area-grad-${gradientId})`}
            className="chart-area-fill"
          />

          {/* Main Price Line */}
          <path
            d={linePath}
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="chart-stroke-line"
          />

          {/* X Axis Ticks */}
          {xTicks.map((tick, idx) => (
            <g key={idx} className="chart-x-tick">
              <line
                x1={tick.x}
                y1={height - paddingBottom}
                x2={tick.x}
                y2={height - paddingBottom + 5}
                stroke="var(--border-strong, #cbd5e1)"
                strokeWidth="1"
              />
              <text
                x={tick.x}
                y={height - paddingBottom + 18}
                textAnchor="middle"
                fontSize="11"
                fill="var(--color-slate-500, #64748b)"
                fontWeight="600"
              >
                {formatDateLabel(tick.bar.timestamp, false)}
              </text>
            </g>
          ))}

          {/* Active Hover Crosshair Line & Target Dot */}
          {activeBar && activeX !== null && activeY !== null && (
            <g className="chart-active-indicator">
              {/* Vertical Crosshair Line */}
              <line
                x1={activeX}
                y1={paddingTop}
                x2={activeX}
                y2={height - paddingBottom}
                stroke="var(--color-slate-400, #94a3b8)"
                strokeDasharray="4 4"
                strokeWidth="1.5"
              />

              {/* Pulse Outer Ring */}
              <circle
                cx={activeX}
                cy={activeY}
                r="7"
                fill={strokeColor}
                opacity="0.25"
              />

              {/* Inner Focus Dot */}
              <circle
                cx={activeX}
                cy={activeY}
                r="4.5"
                fill={strokeColor}
                stroke="#ffffff"
                strokeWidth="2"
                filter={`url(#glow-${gradientId})`}
              />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

