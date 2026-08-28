import React, { useState, useEffect, useCallback, useRef, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TiltCard, MagneticButton, CountUp } from './MotionHelpers.jsx';

const PERIODS = [
  { id: '1W', label: '1T', name: '1 tuần' },
  { id: '1M', label: '1Th', name: '1 tháng' },
  { id: '3M', label: '3Th', name: '3 tháng' },
  { id: '6M', label: '6Th', name: '6 tháng' },
  { id: '1Y', label: '1N', name: '1 năm' }
];

const ASSET_COLORS = [
  { stroke: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8', dot: '#3b82f6', label: 'Tài sản 1' },
  { stroke: '#059669', bg: '#ecfdf5', border: '#a7f3d0', text: '#047857', dot: '#10b981', label: 'Tài sản 2' },
  { stroke: '#7c3aed', bg: '#faf5ff', border: '#e9d5ff', text: '#6d28d9', dot: '#8b5cf6', label: 'Tài sản 3' },
  { stroke: '#d97706', bg: '#fffbeb', border: '#fde68a', text: '#b45309', dot: '#f59e0b', label: 'Tài sản 4' }
];

const ASSET_TYPE_LABELS = {
  stock: 'Cổ phiếu',
  etf: 'ETF',
  fund: 'Quỹ đầu tư',
  gold: 'Vàng',
  deposit: 'Tiền gửi',
  bank_deposit: 'Tiền gửi',
  bond: 'Trái phiếu'
};

function formatAssetType(type) {
  if (!type) return 'N/A';
  return ASSET_TYPE_LABELS[String(type).toLowerCase()] || type;
}

function formatVND(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return `${Number(value).toLocaleString('vi-VN')} ₫`;
}

function formatPublishedTime(isoString) {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
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

function translateAvailability(level) {
  switch (level) {
    case 'complete':
      return { text: 'Đầy đủ', badgeClass: 'badge-gain' };
    case 'partial':
      return { text: 'Một phần', badgeClass: 'badge-warn' };
    case 'limited':
      return { text: 'Hạn chế', badgeClass: 'badge-warn' };
    case 'unavailable':
    default:
      return { text: 'Chưa đủ dữ liệu', badgeClass: 'badge-neutral' };
  }
}

/**
 * Normalized Multi-Asset Price Chart (Base = 100)
 */
function NormalizedComparisonChart({
  seriesData = [],
  periodLabel = '1 tháng'
}) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const svgRef = useRef(null);

  // Filter series that have valid bars
  const validSeries = seriesData.filter((s) => s.bars && s.bars.length >= 2);

  if (validSeries.length === 0) {
    return (
      <div className="chart-empty-state" style={{ minHeight: '180px' }}>
        <span>Chưa đủ dữ liệu lịch sử giá để vẽ biểu đồ tương đối</span>
      </div>
    );
  }

  // Find standard timestamps length
  const maxBarLength = Math.max(...validSeries.map((s) => s.bars.length));
  const referenceSeries = validSeries.reduce((prev, curr) =>
    curr.bars.length > prev.bars.length ? curr : prev
  , validSeries[0]);

  // Compute all normalized points
  const normalizedSeries = validSeries.map((s, sIdx) => {
    const validBars = s.bars.filter((b) => b && typeof b.close === 'number' && b.close > 0 && b.timestamp);
    if (validBars.length < 2) return { ...s, points: [] };
    const baseClose = validBars[0].close;

    const points = validBars.map((b, bIdx) => ({
      timestamp: b.timestamp,
      close: b.close,
      normalizedValue: (b.close / baseClose) * 100,
      index: bIdx
    }));

    return {
      symbol: s.symbol,
      color: s.color || ASSET_COLORS[sIdx % ASSET_COLORS.length],
      points
    };
  });

  // Calculate global min and max normalized values
  let minNorm = 100;
  let maxNorm = 100;
  normalizedSeries.forEach((s) => {
    s.points.forEach((p) => {
      if (p.normalizedValue < minNorm) minNorm = p.normalizedValue;
      if (p.normalizedValue > maxNorm) maxNorm = p.normalizedValue;
    });
  });

  // Dimensions
  const width = 680;
  const height = 260;
  const paddingLeft = 55;
  const paddingRight = 20;
  const paddingTop = 30;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const normRange = maxNorm - minNorm || 10;
  const yMin = Math.floor(Math.max(0, minNorm - normRange * 0.1));
  const yMax = Math.ceil(maxNorm + normRange * 0.1);
  const ySpan = yMax - yMin || 1;

  const getX = (i, total) => paddingLeft + (i / Math.max(1, total - 1)) * chartWidth;
  const getY = (val) => height - paddingBottom - ((val - yMin) / ySpan) * chartHeight;

  // Base 100 line coordinate
  const y100 = getY(100);

  // Y-axis gridlines
  const ySteps = 4;
  const gridLines = Array.from({ length: ySteps + 1 }, (_, index) => {
    const val = yMin + (index / ySteps) * ySpan;
    return {
      val: Math.round(val),
      y: getY(val)
    };
  });

  // Handle pointer move
  const handlePointerMove = (e) => {
    if (!svgRef.current || !referenceSeries.bars.length) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX);
    if (clientX === undefined) return;

    const relativeX = ((clientX - rect.left) / rect.width) * width;
    const boundedX = Math.max(paddingLeft, Math.min(width - paddingRight, relativeX));
    const ratio = (boundedX - paddingLeft) / chartWidth;
    const nearestIndex = Math.round(ratio * (referenceSeries.bars.length - 1));
    const clampedIndex = Math.max(0, Math.min(referenceSeries.bars.length - 1, nearestIndex));
    setHoverIndex(clampedIndex);
  };

  const handlePointerLeave = () => {
    setHoverIndex(null);
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.25rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--color-slate-500)' }}>
          <span style={{ width: '14px', height: '2px', backgroundColor: 'var(--color-slate-400)', borderStyle: 'dashed' }} />
          <span>Mốc cơ sở (100)</span>
        </div>
        {normalizedSeries.map((s) => (
          <div key={s.symbol} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-slate-700)' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: s.color.stroke }} />
            <span>{s.symbol}</span>
          </div>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none' }}
        onMouseMove={handlePointerMove}
        onMouseLeave={handlePointerLeave}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerLeave}
      >
        {/* Background Grid */}
        {gridLines.map((line, idx) => (
          <g key={idx}>
            <line
              x1={paddingLeft}
              y1={line.y}
              x2={width - paddingRight}
              y2={line.y}
              stroke="var(--border-subtle)"
              strokeDasharray="2 2"
              strokeWidth="1"
            />
            <text
              x={paddingLeft - 8}
              y={line.y + 4}
              textAnchor="end"
              fontSize="10"
              fontWeight="600"
              fill="var(--color-slate-400)"
            >
              {line.val}
            </text>
          </g>
        ))}

        {/* Base 100 Highlight Line */}
        {y100 >= paddingTop && y100 <= height - paddingBottom && (
          <g>
            <line
              x1={paddingLeft}
              y1={y100}
              x2={width - paddingRight}
              y2={y100}
              stroke="var(--color-slate-400)"
              strokeDasharray="4 3"
              strokeWidth="1.5"
            />
            <text
              x={width - paddingRight + 4}
              y={y100 + 3}
              fontSize="9"
              fontWeight="700"
              fill="var(--color-slate-500)"
            >
              100
            </text>
          </g>
        )}

        {/* Render Each Asset's Normalized Curve */}
        {normalizedSeries.map((s) => {
          if (s.points.length < 2) return null;
          const coords = s.points.map((p, i) => `${getX(i, s.points.length)},${getY(p.normalizedValue)}`);
          const linePath = `M ${coords.join(' L ')}`;

          return (
            <g key={s.symbol}>
              <path
                d={linePath}
                fill="none"
                stroke={s.color.stroke}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Endpoint marker */}
              {s.points.length > 0 && (
                <circle
                  cx={getX(s.points.length - 1, s.points.length)}
                  cy={getY(s.points[s.points.length - 1].normalizedValue)}
                  r="3.5"
                  fill={s.color.stroke}
                />
              )}
            </g>
          );
        })}

        {/* Interactive Hover Vertical Guide and Dots */}
        {hoverIndex !== null && referenceSeries.bars[hoverIndex] && (
          <g>
            <line
              x1={getX(hoverIndex, referenceSeries.bars.length)}
              y1={paddingTop}
              x2={getX(hoverIndex, referenceSeries.bars.length)}
              y2={height - paddingBottom}
              stroke="var(--color-slate-400)"
              strokeDasharray="3 3"
              strokeWidth="1"
            />

            {normalizedSeries.map((s) => {
              const p = s.points[Math.min(hoverIndex, s.points.length - 1)];
              if (!p) return null;
              const cx = getX(hoverIndex, referenceSeries.bars.length);
              const cy = getY(p.normalizedValue);

              return (
                <circle
                  key={s.symbol}
                  cx={cx}
                  cy={cy}
                  r="4.5"
                  fill={s.color.stroke}
                  stroke="#ffffff"
                  strokeWidth="2"
                />
              );
            })}
          </g>
        )}
      </svg>

      {/* Floating Hover Tooltip */}
      {hoverIndex !== null && referenceSeries.bars[hoverIndex] && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '12px',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(8px)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            fontSize: '0.78rem',
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--color-slate-500)', marginBottom: '4px' }}>
            {new Date(referenceSeries.bars[hoverIndex].timestamp).toLocaleDateString('vi-VN')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {normalizedSeries.map((s) => {
              const p = s.points[Math.min(hoverIndex, s.points.length - 1)];
              if (!p) return null;
              return (
                <div key={s.symbol} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, color: s.color.text }}>{s.symbol}:</span>
                  <span style={{ fontWeight: 700, color: 'var(--color-slate-900)' }}>
                    {p.normalizedValue.toFixed(2).replace('.', ',')}
                    <span style={{ fontSize: '0.72rem', color: 'var(--color-slate-500)', marginLeft: '4px' }}>
                      ({p.close.toLocaleString('vi-VN')} ₫)
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Main Asset Comparison View Component
 */
export function AssetComparisonSection({
  availableAssets = [],
  initialSymbols = ['FPT', 'VCB'],
  onBack,
  onSelectAsset
}) {
  const [selectedSymbols, setSelectedSymbols] = useState(initialSymbols);
  const [selectedPeriod, setSelectedPeriod] = useState('1M'); // '1W' | '1M' | '3M' | '6M' | '1Y'

  // Per-asset asynchronous data state
  const [marketDataMap, setMarketDataMap] = useState({});
  const [analysisDataMap, setAnalysisDataMap] = useState({});
  const [historyDataMap, setHistoryDataMap] = useState({});
  const [loadingMap, setLoadingMap] = useState({});
  const [errorMap, setErrorMap] = useState({});

  // Search/add dropdown state
  const [searchQuery, setSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Active abort controllers per symbol
  const abortControllersRef = useRef({});

  // Add symbol to selection
  const handleAddSymbol = (sym) => {
    if (!sym) return;
    const cleanSym = sym.trim().toUpperCase();
    if (selectedSymbols.includes(cleanSym)) return;
    if (selectedSymbols.length >= 4) return;

    setSelectedSymbols((prev) => [...prev, cleanSym]);
    setSearchQuery('');
    setIsDropdownOpen(false);
  };

  // Remove symbol from selection
  const handleRemoveSymbol = (sym) => {
    if (abortControllersRef.current[sym]) {
      abortControllersRef.current[sym].abort();
      delete abortControllersRef.current[sym];
    }
    setSelectedSymbols((prev) => prev.filter((s) => s !== sym));
    setMarketDataMap((prev) => {
      const copy = { ...prev };
      delete copy[sym];
      return copy;
    });
    setAnalysisDataMap((prev) => {
      const copy = { ...prev };
      delete copy[sym];
      return copy;
    });
    setHistoryDataMap((prev) => {
      const copy = { ...prev };
      delete copy[sym];
      return copy;
    });
    setErrorMap((prev) => {
      const copy = { ...prev };
      delete copy[sym];
      return copy;
    });
  };

  // Fetch all endpoints for one symbol with failure isolation
  const fetchAssetComparisonData = useCallback((sym, period) => {
    if (!sym) return;

    if (abortControllersRef.current[sym]) {
      abortControllersRef.current[sym].abort();
    }
    const controller = new AbortController();
    abortControllersRef.current[sym] = controller;

    setLoadingMap((prev) => ({ ...prev, [sym]: true }));
    setErrorMap((prev) => ({ ...prev, [sym]: null }));

    const mktPromise = fetch(`/api/market/${encodeURIComponent(sym)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Market ${res.status}`))))
      .then((json) => (json.status === 'ok' ? json.data : null))
      .catch((err) => {
        if (err.name === 'AbortError') throw err;
        return null;
      });

    const analysisPromise = fetch(`/api/analysis/${encodeURIComponent(sym)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Analysis ${res.status}`))))
      .then((json) => (json.status === 'ok' ? json.data : null))
      .catch((err) => {
        if (err.name === 'AbortError') throw err;
        return null;
      });

    const historyPromise = fetch(`/api/market/${encodeURIComponent(sym)}/history?range=${encodeURIComponent(period)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`History ${res.status}`))))
      .then((json) => (json.status === 'ok' ? json.data : null))
      .catch((err) => {
        if (err.name === 'AbortError') throw err;
        return null;
      });

    Promise.allSettled([mktPromise, analysisPromise, historyPromise])
      .then(([mktRes, anaRes, histRes]) => {
        if (controller.signal.aborted) return;

        const mktData = mktRes.status === 'fulfilled' ? mktRes.value : null;
        const anaData = anaRes.status === 'fulfilled' ? anaRes.value : null;
        const histData = histRes.status === 'fulfilled' ? histRes.value : null;

        if (!mktData && !anaData && !histData) {
          setErrorMap((prev) => ({ ...prev, [sym]: 'Không thể tải dữ liệu cho tài sản này' }));
        }

        if (mktData) setMarketDataMap((prev) => ({ ...prev, [sym]: mktData }));
        if (anaData) setAnalysisDataMap((prev) => ({ ...prev, [sym]: anaData }));
        if (histData) setHistoryDataMap((prev) => ({ ...prev, [sym]: histData }));
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setErrorMap((prev) => ({ ...prev, [sym]: err.message || 'Lỗi kết nối' }));
      })
      .finally(() => {
        if (abortControllersRef.current[sym] === controller) {
          setLoadingMap((prev) => ({ ...prev, [sym]: false }));
        }
      });
  }, []);

  // Fetch / refresh data when selected symbols or period changes
  useEffect(() => {
    selectedSymbols.forEach((sym) => {
      fetchAssetComparisonData(sym, selectedPeriod);
    });

    return () => {
      Object.values(abortControllersRef.current).forEach((ctrl) => ctrl && ctrl.abort());
    };
  }, [selectedSymbols, selectedPeriod, fetchAssetComparisonData]);

  // Filter available assets for search dropdown
  const filteredAssets = availableAssets.filter((a) => {
    if (selectedSymbols.includes(a.symbol)) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (a.symbol && a.symbol.toLowerCase().includes(q)) ||
      (a.name && a.name.toLowerCase().includes(q))
    );
  });

  const activePeriodConfig = PERIODS.find((p) => p.id === selectedPeriod) || PERIODS[1];

  // Prepare normalized chart data
  const normalizedSeriesData = selectedSymbols.map((sym, idx) => {
    const hist = historyDataMap[sym];
    return {
      symbol: sym,
      color: ASSET_COLORS[idx % ASSET_COLORS.length],
      bars: hist && Array.isArray(hist.bars) ? hist.bars : []
    };
  });

  return (
    <div>
      {/* Top Action Bar */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="section-header"
        style={{ alignItems: 'center', marginBottom: '1.25rem' }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <h2 className="section-title">So sánh tài sản</h2>
            <span className="fintech-badge badge-neutral">Dữ liệu có độ trễ ~15p</span>
          </div>
          <p className="section-subtitle">
            So sánh trực quan từ 2 đến 4 tài sản song song dựa trên dữ liệu thị trường và phân tích định lượng.
          </p>
        </div>

        <MagneticButton onClick={onBack} className="fintech-btn btn-secondary btn-sm">
          &larr; Quay lại danh sách
        </MagneticButton>
      </motion.div>

      {/* Asset Selection Controls & Shared Period Bar */}
      <TiltCard className="fintech-card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }} tiltMax={1}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>

          {/* Left: Selected Badges + Add Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', flex: 1 }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-slate-700)' }}>
              Tài sản ({selectedSymbols.length}/4):
            </span>

            {/* Selected asset chips */}
            {selectedSymbols.map((sym, idx) => {
              const color = ASSET_COLORS[idx % ASSET_COLORS.length];
              const assetInfo = availableAssets.find((a) => a.symbol === sym);

              return (
                <motion.div
                  key={sym}
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '3px 10px',
                    borderRadius: 'var(--radius-full)',
                    backgroundColor: color.bg,
                    border: `1px solid ${color.border}`,
                    color: color.text,
                    fontWeight: 800,
                    fontSize: '0.85rem'
                  }}
                >
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color.dot }} />
                  <span>{sym}</span>
                  {assetInfo && (
                    <span style={{ fontWeight: 500, fontSize: '0.75rem', opacity: 0.8 }}>
                      ({formatAssetType(assetInfo.asset_type)})
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveSymbol(sym)}
                    title={`Bỏ ${sym}`}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: color.text,
                      cursor: 'pointer',
                      fontSize: '1rem',
                      fontWeight: 'bold',
                      lineHeight: 1,
                      padding: '0 2px',
                      opacity: 0.7
                    }}
                  >
                    ×
                  </button>
                </motion.div>
              );
            })}

            {/* Add Asset Selector / Dropdown (Capped at 4) */}
            {selectedSymbols.length < 4 && (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen((prev) => !prev)}
                  className="fintech-btn btn-secondary btn-sm"
                  style={{ borderRadius: 'var(--radius-full)', padding: '4px 10px', fontSize: '0.8rem' }}
                >
                  + Thêm tài sản
                </button>

                {isDropdownOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '110%',
                      left: 0,
                      zIndex: 30,
                      width: '260px',
                      maxHeight: '280px',
                      backgroundColor: 'var(--color-bg-surface, #ffffff)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                      padding: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px'
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Tìm mã hoặc tên..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      autoFocus
                      className="fintech-input"
                      style={{ padding: '6px 8px', fontSize: '0.82rem' }}
                    />

                    <div style={{ overflowY: 'auto', maxHeight: '200px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      {filteredAssets.length === 0 ? (
                        <div style={{ padding: '8px', fontSize: '0.78rem', color: 'var(--color-slate-400)', textAlign: 'center' }}>
                          Không tìm thấy tài sản phù hợp
                        </div>
                      ) : (
                        filteredAssets.map((asset) => (
                          <div
                            key={asset.symbol}
                            onClick={() => handleAddSymbol(asset.symbol)}
                            style={{
                              padding: '6px 8px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: '0.82rem',
                              transition: 'background-color 0.15s ease'
                            }}
                            className="row-interactive"
                          >
                            <span style={{ fontWeight: 800, color: 'var(--color-slate-900)' }}>
                              {asset.symbol}
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)' }}>
                              {formatAssetType(asset.asset_type)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Shared Period Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--color-slate-500)', fontWeight: 600 }}>
              Giai đoạn:
            </span>
            <div className="range-selector-group">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`range-selector-btn ${selectedPeriod === p.id ? 'active' : ''}`}
                  onClick={() => setSelectedPeriod(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

        </div>
      </TiltCard>

      {/* Initial state if fewer than 2 assets */}
      {selectedSymbols.length < 2 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="state-box"
          style={{ padding: '3rem 1.5rem', marginBottom: '2rem' }}
        >
          <div className="state-icon float-icon" style={{ fontSize: '2.5rem' }}>⚖️</div>
          <h3 className="state-title" style={{ fontSize: '1.25rem', marginTop: '0.5rem' }}>
            Chọn từ 2 đến 4 tài sản để so sánh.
          </h3>
          <p className="state-desc" style={{ maxWidth: '480px', margin: '0.5rem auto 1.25rem auto' }}>
            Thêm ít nhất 2 tài sản bằng nút "+ Thêm tài sản" phía trên để bắt đầu phân tích so sánh các chỉ số song song.
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {['FPT', 'VCB', 'E1VFVN30', 'MWG'].map((presetSym) => (
              <MagneticButton
                key={presetSym}
                onClick={() => handleAddSymbol(presetSym)}
                disabled={selectedSymbols.includes(presetSym)}
                className="fintech-btn btn-secondary btn-sm"
              >
                + {presetSym}
              </MagneticButton>
            ))}
          </div>
        </motion.div>
      )}

      {/* Comparison Matrix & Charts when >= 2 assets */}
      {selectedSymbols.length >= 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Normalized Relative Price Chart (Base = 100) */}
          <TiltCard className="fintech-card" style={{ padding: '1.5rem' }} tiltMax={1}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                  Diễn biến giá tương đối — mốc đầu kỳ = 100
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)' }}>
                  Chuẩn hóa biến động giá trong giai đoạn {activePeriodConfig.name} để dễ so sánh trực quan.
                </span>
              </div>
              <span className="fintech-badge badge-neutral">Mốc 100 đầu kỳ</span>
            </div>

            <NormalizedComparisonChart
              seriesData={normalizedSeriesData}
              periodLabel={activePeriodConfig.name}
            />
          </TiltCard>

          {/* Side-by-Side Comparison Matrix Table / Cards */}
          <TiltCard className="fintech-card" style={{ padding: '1.5rem', overflow: 'hidden' }} tiltMax={0.5}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                  Bảng đối chiếu chỉ số định lượng ({activePeriodConfig.name})
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)' }}>
                  Dữ liệu trích xuất trực tiếp từ engine định lượng, không xếp hạng hay gợi ý giao dịch.
                </span>
              </div>
            </div>

            {/* Responsive Scrollable Container */}
            <div className="table-container" style={{ margin: '0 -1.5rem', padding: '0 1.5rem' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `200px repeat(${selectedSymbols.length}, minmax(220px, 1fr))`,
                  gap: '12px',
                  minWidth: `${200 + selectedSymbols.length * 220}px`
                }}
              >
                {/* COLUMN 0: METRIC LABELS HEADER */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', justifyContent: 'space-between' }}>
                  {/* Header spacer */}
                  <div style={{ height: '140px', display: 'flex', alignItems: 'flex-end', paddingBottom: '8px' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--color-slate-400)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Chỉ số đối chiếu
                    </span>
                  </div>

                  {/* Row 1: Giá gần nhất */}
                  <div className="comparison-metric-row-label">
                    <span className="metric-label-title">Giá gần nhất</span>
                    <span className="metric-label-sub">Độ trễ ~15 phút</span>
                  </div>

                  {/* Row 2: Biến động giá */}
                  <div className="comparison-metric-row-label">
                    <span className="metric-label-title">Biến động giá</span>
                    <span className="metric-label-sub">Trong {activePeriodConfig.name}</span>
                  </div>

                  {/* Row 3: Khoảng giá */}
                  <div className="comparison-metric-row-label">
                    <span className="metric-label-title">Khoảng giá</span>
                    <span className="metric-label-sub">Thấp nhất — Cao nhất</span>
                  </div>

                  {/* Row 4: Vị trí vùng giá */}
                  <div className="comparison-metric-row-label">
                    <span className="metric-label-title">Vị trí trong vùng giá</span>
                    <span className="metric-label-sub">Tương quan đỉnh - đáy</span>
                  </div>

                  {/* Row 5: Cách đỉnh */}
                  <div className="comparison-metric-row-label">
                    <span className="metric-label-title">Cách đỉnh giai đoạn</span>
                    <span className="metric-label-sub">So với giá cao nhất</span>
                  </div>

                  {/* Row 6: Số phiên */}
                  <div className="comparison-metric-row-label">
                    <span className="metric-label-title">Số phiên dữ liệu</span>
                    <span className="metric-label-sub">Phiên giao dịch hợp lệ</span>
                  </div>

                  {/* Row 7: Giai đoạn tăng giá */}
                  <div className="comparison-metric-row-label">
                    <span className="metric-label-title">Giai đoạn tăng giá</span>
                    <span className="metric-label-sub">Tỷ lệ kỳ tăng (5 kỳ)</span>
                  </div>

                  {/* Row 8: Mức độ đầy đủ dữ liệu */}
                  <div className="comparison-metric-row-label">
                    <span className="metric-label-title">Độ đầy đủ dữ liệu</span>
                    <span className="metric-label-sub">Độ bao phủ các mốc</span>
                  </div>
                </div>

                {/* ASSET COLUMNS */}
                {selectedSymbols.map((sym, idx) => {
                  const color = ASSET_COLORS[idx % ASSET_COLORS.length];
                  const assetInfo = availableAssets.find((a) => a.symbol === sym);
                  const mkt = marketDataMap[sym];
                  const ana = analysisDataMap[sym];
                  const loading = loadingMap[sym];
                  const err = errorMap[sym];

                  const periodAna = ana?.periods?.[selectedPeriod];
                  const isPeriodAvail = periodAna && periodAna.status === 'available';

                  return (
                    <div
                      key={sym}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        backgroundColor: 'rgba(248, 250, 252, 0.65)',
                        borderRadius: 'var(--radius-md)',
                        padding: '12px',
                        border: `1px solid ${color.border}`
                      }}
                    >
                      {/* Asset Header Card */}
                      <div
                        style={{
                          height: '140px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          paddingBottom: '8px',
                          borderBottom: '1px solid var(--border-subtle)'
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: '4px',
                                backgroundColor: color.bg,
                                color: color.text,
                                border: `1px solid ${color.border}`,
                                fontWeight: 900,
                                fontSize: '0.95rem'
                              }}
                            >
                              {sym}
                            </span>
                            <span className="fintech-badge badge-neutral" style={{ fontSize: '0.72rem' }}>
                              {assetInfo ? formatAssetType(assetInfo.asset_type) : 'Tài sản'}
                            </span>
                          </div>

                          <div
                            style={{
                              fontSize: '0.82rem',
                              fontWeight: 700,
                              color: 'var(--color-slate-800)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                            title={assetInfo?.name || sym}
                          >
                            {assetInfo?.name || sym}
                          </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                          <MagneticButton
                            onClick={() => onSelectAsset(sym)}
                            className="fintech-btn btn-secondary btn-sm"
                            style={{ width: '100%', justifyContent: 'center', fontSize: '0.78rem', padding: '4px 8px' }}
                          >
                            Xem chi tiết ↗
                          </MagneticButton>
                        </div>
                      </div>

                      {/* Loading or Isolated Error Fallback */}
                      {loading && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px 0' }}>
                          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                            <div key={n} className="skeleton-shimmer" style={{ height: '36px', borderRadius: '4px' }} />
                          ))}
                        </div>
                      )}

                      {err && !loading && (
                        <div className="fintech-banner banner-warning" style={{ margin: '12px 0', fontSize: '0.78rem' }}>
                          <span>{err}</span>
                          <button
                            type="button"
                            onClick={() => fetchAssetComparisonData(sym, selectedPeriod)}
                            className="fintech-btn btn-secondary btn-sm"
                            style={{ marginTop: '6px', fontSize: '0.72rem' }}
                          >
                            Thử lại
                          </button>
                        </div>
                      )}

                      {!loading && !err && (
                        <>
                          {/* Row 1: Giá gần nhất */}
                          <div className="comparison-metric-cell">
                            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                              {mkt && typeof mkt.price === 'number' ? formatVND(mkt.price) : '—'}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                              {mkt && typeof mkt.changePercent === 'number' ? (
                                <span
                                  className={`fintech-badge ${mkt.changePercent > 0 ? 'badge-gain' : mkt.changePercent < 0 ? 'badge-loss' : 'badge-neutral'}`}
                                  style={{ fontSize: '0.72rem', padding: '1px 6px' }}
                                >
                                  {mkt.changePercent > 0 ? '+' : ''}{Number(mkt.changePercent).toFixed(2)}%
                                </span>
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-slate-400)' }}>—</span>
                              )}
                              {mkt?.updatedAt && (
                                <span style={{ fontSize: '0.7rem', color: 'var(--color-slate-400)' }}>
                                  {new Date(mkt.updatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Row 2: Biến động giá */}
                          <div className="comparison-metric-cell">
                            {isPeriodAvail && typeof periodAna.priceChangePct === 'number' ? (
                              <div>
                                <span
                                  style={{
                                    fontSize: '1rem',
                                    fontWeight: 800,
                                    color: periodAna.priceChangePct > 0 ? 'var(--color-gain-700)' : periodAna.priceChangePct < 0 ? 'var(--color-loss-700)' : 'var(--color-slate-700)'
                                  }}
                                >
                                  {formatPercentVN(periodAna.priceChangePct)}
                                </span>
                                {typeof periodAna.absoluteChange === 'number' && (
                                  <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                                    {periodAna.absoluteChange > 0 ? '+' : ''}{Number(periodAna.absoluteChange).toLocaleString('vi-VN')} ₫
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: 'var(--color-slate-400)', fontSize: '0.85rem' }}>Chưa đủ dữ liệu</span>
                            )}
                          </div>

                          {/* Row 3: Khoảng giá */}
                          <div className="comparison-metric-cell">
                            {isPeriodAvail && periodAna.periodLowPrice !== null && periodAna.periodHighPrice !== null ? (
                              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-slate-900)' }}>
                                {Number(periodAna.periodLowPrice).toLocaleString('vi-VN')} — {Number(periodAna.periodHighPrice).toLocaleString('vi-VN')} ₫
                              </div>
                            ) : (
                              <span style={{ color: 'var(--color-slate-400)', fontSize: '0.85rem' }}>Chưa đủ dữ liệu</span>
                            )}
                          </div>

                          {/* Row 4: Vị trí trong vùng giá (Visual slider track) */}
                          <div className="comparison-metric-cell">
                            {isPeriodAvail && typeof periodAna.rangePositionPct === 'number' ? (
                              <div style={{ width: '100%', padding: '4px 0' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--color-slate-400)', marginBottom: '4px' }}>
                                  <span>Thấp</span>
                                  <span style={{ fontWeight: 800, color: 'var(--color-slate-800)' }}>
                                    {Math.round(periodAna.rangePositionPct)}%
                                  </span>
                                  <span>Cao</span>
                                </div>
                                <div
                                  style={{
                                    height: '6px',
                                    backgroundColor: 'var(--color-slate-200)',
                                    borderRadius: '3px',
                                    position: 'relative'
                                  }}
                                >
                                  <div
                                    style={{
                                      position: 'absolute',
                                      left: `${Math.max(0, Math.min(100, periodAna.rangePositionPct))}%`,
                                      top: '50%',
                                      transform: 'translate(-50%, -50%)',
                                      width: '12px',
                                      height: '12px',
                                      borderRadius: '50%',
                                      backgroundColor: color.dot,
                                      border: '2px solid #ffffff',
                                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                    }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--color-slate-400)', fontSize: '0.85rem' }}>Chưa đủ dữ liệu</span>
                            )}
                          </div>

                          {/* Row 5: Cách đỉnh */}
                          <div className="comparison-metric-cell">
                            {isPeriodAvail && typeof periodAna.distanceBelowHighPct === 'number' ? (
                              <span
                                style={{
                                  fontSize: '0.92rem',
                                  fontWeight: 800,
                                  color: 'var(--color-slate-800)'
                                }}
                              >
                                {periodAna.distanceBelowHighPct.toFixed(2).replace('.', ',')}%
                              </span>
                            ) : (
                              <span style={{ color: 'var(--color-slate-400)', fontSize: '0.85rem' }}>Chưa đủ dữ liệu</span>
                            )}
                          </div>

                          {/* Row 6: Số phiên */}
                          <div className="comparison-metric-cell">
                            {isPeriodAvail && typeof periodAna.validSessionCount === 'number' ? (
                              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-slate-800)' }}>
                                {periodAna.validSessionCount} phiên
                              </span>
                            ) : (
                              <span style={{ color: 'var(--color-slate-400)', fontSize: '0.85rem' }}>—</span>
                            )}
                          </div>

                          {/* Row 7: Giai đoạn tăng giá (Cross-period breadth) */}
                          <div className="comparison-metric-cell">
                            {ana?.crossPeriod && typeof ana.crossPeriod.positivePeriodCount === 'number' && typeof ana.crossPeriod.validPeriodCount === 'number' ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '0.95rem', fontWeight: 900, color: color.text }}>
                                  {ana.crossPeriod.positivePeriodCount}/{ana.crossPeriod.validPeriodCount}
                                </span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)' }}>kỳ tăng</span>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--color-slate-400)', fontSize: '0.85rem' }}>Chưa đủ dữ liệu</span>
                            )}
                          </div>

                          {/* Row 8: Mức độ đầy đủ dữ liệu */}
                          <div className="comparison-metric-cell">
                            {ana?.dataCompleteness?.availabilityLevel ? (
                              (() => {
                                const avail = translateAvailability(ana.dataCompleteness.availabilityLevel);
                                return (
                                  <span className={`fintech-badge ${avail.badgeClass}`} style={{ fontSize: '0.75rem' }}>
                                    {avail.text}
                                  </span>
                                );
                              })()
                            ) : (
                              <span className="fintech-badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                                Chưa đủ dữ liệu
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </TiltCard>

        </div>
      )}
    </div>
  );
}

