import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TiltCard, MagneticButton, CountUp } from './MotionHelpers.jsx';
import { apiFetch } from '../utils/api.js';
import {
  formatNativeAmount,
  formatMarketChange,
  formatPercentVN,
  formatAssetType
} from '../utils/formatting.js';

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
 * Normalized Multi-Asset Price Chart (Base = 100 on Common Dates)
 */
function NormalizedComparisonChart({
  base100Data = null,
  assets = [],
  periodLabel = '1 tháng'
}) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const svgRef = useRef(null);

  const series = base100Data?.series || [];
  const validSeries = series.filter((s) => s.points && s.points.length >= 2);

  if (!base100Data || base100Data.status === 'unavailable' || validSeries.length === 0) {
    return (
      <div className="chart-empty-state" style={{ minHeight: '180px', padding: '2rem 1rem', textAlign: 'center' }}>
        <span>
          {base100Data?.reason === 'HISTORY_UNAVAILABLE_FOR_SELECTED_ASSET'
            ? 'So sánh lịch sử giá không khả dụng do danh sách chứa tài sản chưa hỗ trợ lịch sử giá.'
            : 'Chưa đủ dữ liệu lịch sử giá đồng nhất để vẽ biểu đồ tương đối (Base 100).'}
        </span>
      </div>
    );
  }

  // Reference series for date mapping
  const referenceSeries = validSeries[0];
  const totalPoints = referenceSeries.points.length;

  // Global min and max base100 values
  let minNorm = 100;
  let maxNorm = 100;
  validSeries.forEach((s) => {
    s.points.forEach((p) => {
      if (typeof p.base100 === 'number' && Number.isFinite(p.base100)) {
        if (p.base100 < minNorm) minNorm = p.base100;
        if (p.base100 > maxNorm) maxNorm = p.base100;
      }
    });
  });

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

  const y100 = getY(100);

  const ySteps = 4;
  const gridLines = Array.from({ length: ySteps + 1 }, (_, index) => {
    const val = yMin + (index / ySteps) * ySpan;
    return {
      val: Math.round(val),
      y: getY(val)
    };
  });

  const handlePointerMove = (e) => {
    if (!svgRef.current || !totalPoints) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX);
    if (clientX === undefined) return;

    const relativeX = ((clientX - rect.left) / rect.width) * width;
    const boundedX = Math.max(paddingLeft, Math.min(width - paddingRight, relativeX));
    const ratio = (boundedX - paddingLeft) / chartWidth;
    const nearestIndex = Math.round(ratio * (totalPoints - 1));
    const clampedIndex = Math.max(0, Math.min(totalPoints - 1, nearestIndex));
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
        {validSeries.map((s, sIdx) => {
          const color = ASSET_COLORS[sIdx % ASSET_COLORS.length];
          return (
            <div key={s.symbol} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-slate-700)' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: color.stroke }} />
              <span>{s.symbol} ({s.quoteCurrency || 'VND'})</span>
            </div>
          );
        })}
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
              stroke="var(--border-subtle, #e2e8f0)"
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
        {validSeries.map((s, sIdx) => {
          const color = ASSET_COLORS[sIdx % ASSET_COLORS.length];
          const coords = s.points.map((p, i) => `${getX(i, totalPoints)},${getY(p.base100)}`);
          const linePath = `M ${coords.join(' L ')}`;

          return (
            <g key={s.symbol}>
              <path
                d={linePath}
                fill="none"
                stroke={color.stroke}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {s.points.length > 0 && (
                <circle
                  cx={getX(s.points.length - 1, totalPoints)}
                  cy={getY(s.points[s.points.length - 1].base100)}
                  r="3.5"
                  fill={color.stroke}
                />
              )}
            </g>
          );
        })}

        {/* Interactive Hover Guide */}
        {hoverIndex !== null && referenceSeries.points[hoverIndex] && (
          <g>
            <line
              x1={getX(hoverIndex, totalPoints)}
              y1={paddingTop}
              x2={getX(hoverIndex, totalPoints)}
              y2={height - paddingBottom}
              stroke="var(--color-slate-400)"
              strokeDasharray="3 3"
              strokeWidth="1"
            />

            {validSeries.map((s, sIdx) => {
              const color = ASSET_COLORS[sIdx % ASSET_COLORS.length];
              const p = s.points[hoverIndex];
              if (!p) return null;
              const cx = getX(hoverIndex, totalPoints);
              const cy = getY(p.base100);

              return (
                <circle
                  key={s.symbol}
                  cx={cx}
                  cy={cy}
                  r="4.5"
                  fill={color.stroke}
                  stroke="#ffffff"
                  strokeWidth="2"
                />
              );
            })}
          </g>
        )}
      </svg>

      {/* Floating Hover Tooltip */}
      {hoverIndex !== null && referenceSeries.points[hoverIndex] && (
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
            📅 {referenceSeries.points[hoverIndex].date || new Date(referenceSeries.points[hoverIndex].timestamp).toLocaleDateString('vi-VN')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {validSeries.map((s, sIdx) => {
              const color = ASSET_COLORS[sIdx % ASSET_COLORS.length];
              const p = s.points[hoverIndex];
              if (!p) return null;
              return (
                <div key={s.symbol} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, color: color.text }}>{s.symbol}:</span>
                  <span style={{ fontWeight: 700, color: 'var(--color-slate-900)' }}>
                    {p.base100.toFixed(2).replace('.', ',')}
                    <span style={{ fontSize: '0.72rem', color: 'var(--color-slate-500)', marginLeft: '4px' }}>
                      ({formatNativeAmount(p.close, s.quoteCurrency || 'VND')})
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
  const [selectedPeriod, setSelectedPeriod] = useState('1M');

  const [comparisonData, setComparisonData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const abortControllerRef = useRef(null);

  const handleAddSymbol = (sym) => {
    if (!sym) return;
    const cleanSym = sym.trim().toUpperCase();
    if (selectedSymbols.includes(cleanSym)) return;
    if (selectedSymbols.length >= 4) return;

    setSelectedSymbols((prev) => [...prev, cleanSym]);
    setSearchQuery('');
    setIsDropdownOpen(false);
  };

  const handleRemoveSymbol = (sym) => {
    if (selectedSymbols.length <= 2) return;
    setSelectedSymbols((prev) => prev.filter((s) => s !== sym));
  };

  const fetchComparison = useCallback((symbols, range) => {
    if (!symbols || symbols.length < 2) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    const queryParams = new URLSearchParams({
      symbols: symbols.join(','),
      range
    });

    apiFetch(`/api/comparison?${queryParams.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) {
          return res.json().catch(() => ({})).then((json) => {
            throw new Error(json.message || `HTTP ${res.status}`);
          });
        }
        return res.json();
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        if (json.status === 'ok' && json.data) {
          setComparisonData(json.data);
        } else {
          throw new Error(json.message || 'Không thể tải dữ liệu so sánh');
        }
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted || err.name === 'AbortError') return;
        setError(err.message || 'Lỗi kết nối khi tải dữ liệu so sánh');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchComparison(selectedSymbols, selectedPeriod);
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [selectedSymbols, selectedPeriod, fetchComparison]);

  const activePeriodConfig = PERIODS.find((p) => p.id === selectedPeriod) || PERIODS[1];

  const availableDropdownAssets = availableAssets.filter((a) => {
    const sym = a.symbol?.toUpperCase();
    if (selectedSymbols.includes(sym)) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return sym?.toLowerCase().includes(q) || a.name?.toLowerCase().includes(q);
  });

  const comparedAssets = comparisonData?.assets || [];

  return (
    <div style={{ animation: 'fadeIn 0.25s ease-out' }}>
      {/* Top Header Navigation */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.25rem'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ fontSize: '1.4rem' }}>⚖️</span>
            <h1
              style={{
                fontSize: '1.5rem',
                fontWeight: 900,
                color: 'var(--color-slate-900)',
                margin: 0,
                letterSpacing: '-0.02em'
              }}
            >
              So sánh tài sản
            </h1>
          </div>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--color-slate-500)' }}>
            Đối chiếu biến động giá tương đối (Base 100) và các chỉ số định lượng theo cùng mốc thời gian.
          </p>
        </div>

        {onBack && (
          <MagneticButton
            onClick={onBack}
            className="fintech-btn btn-secondary btn-sm"
          >
            ← Quay lại danh sách
          </MagneticButton>
        )}
      </div>

      {/* Asset Selector & Controls Bar */}
      <TiltCard className="fintech-card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }} tiltMax={1}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          {/* Selected Asset Chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-slate-600)' }}>
              Đang so sánh ({selectedSymbols.length}/4):
            </span>

            {selectedSymbols.map((sym, idx) => {
              const color = ASSET_COLORS[idx % ASSET_COLORS.length];
              const assetInfo = availableAssets.find((a) => a.symbol === sym);

              return (
                <div
                  key={sym}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full, 9999px)',
                    backgroundColor: color.bg,
                    border: `1px solid ${color.border}`,
                    color: color.text,
                    fontSize: '0.85rem',
                    fontWeight: 800
                  }}
                >
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color.dot }} />
                  <span>{sym}</span>
                  {selectedSymbols.length > 2 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSymbol(sym)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: color.text,
                        cursor: 'pointer',
                        padding: '0 2px',
                        fontSize: '0.9rem',
                        lineHeight: 1
                      }}
                      title="Bỏ tài sản này"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}

            {/* Add Asset Dropdown */}
            {selectedSymbols.length < 4 && (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="fintech-btn btn-secondary btn-sm"
                  style={{ padding: '4px 10px', fontSize: '0.82rem' }}
                >
                  ＋ Thêm tài sản
                </button>

                {isDropdownOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: '6px',
                      width: '260px',
                      backgroundColor: 'var(--color-surface, #ffffff)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-default)',
                      boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
                      zIndex: 50,
                      padding: '8px'
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Tìm mã hoặc tên..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      autoFocus
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '0.82rem',
                        marginBottom: '6px',
                        boxSizing: 'border-box'
                      }}
                    />
                    <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                      {availableDropdownAssets.length === 0 ? (
                        <div style={{ padding: '8px', fontSize: '0.78rem', color: 'var(--color-slate-400)', textAlign: 'center' }}>
                          Không tìm thấy tài sản phù hợp
                        </div>
                      ) : (
                        availableDropdownAssets.map((a) => (
                          <div
                            key={a.id || a.symbol}
                            onClick={() => handleAddSymbol(a.symbol)}
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
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-slate-100)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <span style={{ fontWeight: 800, color: 'var(--color-slate-900)' }}>{a.symbol}</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)' }}>{formatAssetType(a.asset_type)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Period Selector Tabs */}
          <div className="range-selector-group">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`range-selector-btn ${selectedPeriod === p.id ? 'active' : ''}`}
                onClick={() => setSelectedPeriod(p.id)}
                disabled={loading}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </TiltCard>

      {/* Error state */}
      {error && (
        <div className="fintech-banner banner-warning" style={{ marginBottom: '1.25rem' }}>
          <span>{error}</span>
          <MagneticButton onClick={() => fetchComparison(selectedSymbols, selectedPeriod)} className="fintech-btn btn-secondary btn-sm" style={{ marginTop: '0.5rem' }}>
            Thử lại
          </MagneticButton>
        </div>
      )}

      {/* Main Comparison Cards */}
      {loading && !comparisonData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="skeleton-shimmer" style={{ width: '100%', height: '280px', borderRadius: 'var(--radius-md)' }} />
          <div className="skeleton-shimmer" style={{ width: '100%', height: '320px', borderRadius: 'var(--radius-md)' }} />
        </div>
      )}

      {comparisonData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* 1. Base-100 Relative Chart Card */}
          <TiltCard className="fintech-card" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-slate-900)', fontWeight: 800 }}>
                  Biểu đồ tăng trưởng tương đối (Base 100)
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-500)' }}>
                  Chuẩn hóa mốc đầu kỳ về 100 trên các mốc ngày dữ liệu chung ({activePeriodConfig.name}).
                </span>
              </div>
              <span className="fintech-badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                {comparisonData.base100?.commonObservationCount || 0} mốc chung
              </span>
            </div>

            <NormalizedComparisonChart
              base100Data={comparisonData.base100}
              assets={comparedAssets}
              periodLabel={activePeriodConfig.name}
            />
          </TiltCard>

          {/* 2. Side-by-Side Metric Comparison Matrix */}
          <TiltCard className="fintech-card" style={{ padding: '1.5rem' }}>
            <div style={{ marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-slate-900)', fontWeight: 800 }}>
                Bảng đối chiếu định lượng ({activePeriodConfig.name})
              </h3>
              <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-500)' }}>
                So sánh các chỉ số V2 theo đơn vị tiền tệ niêm yết gốc của từng tài sản.
              </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: `180px repeat(${comparedAssets.length}, minmax(180px, 1fr))`, gap: '12px', minWidth: '600px' }}>
                {/* Column 0: Metric Headers */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ height: '70px', display: 'flex', alignItems: 'flex-end', paddingBottom: '8px' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--color-slate-400)', textTransform: 'uppercase' }}>
                      Chỉ số
                    </span>
                  </div>
                  <div className="comparison-metric-row-label">
                    <span className="metric-label-title">Giá thị trường</span>
                    <span className="metric-label-sub">Đồng tiền niêm yết</span>
                  </div>
                  <div className="comparison-metric-row-label">
                    <span className="metric-label-title">Biến động giá</span>
                    <span className="metric-label-sub">Giai đoạn {activePeriodConfig.label}</span>
                  </div>
                  <div className="comparison-metric-row-label">
                    <span className="metric-label-title">Khoảng giá</span>
                    <span className="metric-label-sub">Thấp → Cao</span>
                  </div>
                  <div className="comparison-metric-row-label">
                    <span className="metric-label-title">Vị trí vùng giá</span>
                    <span className="metric-label-sub">Tương quan đỉnh - đáy</span>
                  </div>
                  <div className="comparison-metric-row-label">
                    <span className="metric-label-title">Tỷ lệ mốc đóng cửa tăng</span>
                    <span className="metric-label-sub">Mốc tăng/tổng mốc</span>
                  </div>
                  <div className="comparison-metric-row-label">
                    <span className="metric-label-title">Biến động ngày</span>
                    <span className="metric-label-sub">Độ lệch chuẩn log-return</span>
                  </div>
                  <div className="comparison-metric-row-label">
                    <span className="metric-label-title">Sụt giảm tối đa</span>
                    <span className="metric-label-sub">Max Drawdown (đóng cửa)</span>
                  </div>
                  <div className="comparison-metric-row-label">
                    <span className="metric-label-title">Số mốc dữ liệu</span>
                    <span className="metric-label-sub">Số ngày/phiên</span>
                  </div>
                </div>

                {/* Columns 1..N: Asset Cards */}
                {comparedAssets.map((item, idx) => {
                  const color = ASSET_COLORS[idx % ASSET_COLORS.length];
                  const qCur = item.quoteCurrency || 'VND';
                  const ana = item.analysis;
                  const metrics = ana?.metrics || {};
                  const isAvail = ana?.status === 'available' && typeof metrics.priceChangePct === 'number';

                  const seriesObj = comparisonData.base100?.series?.find((s) => s.symbol === item.symbol);
                  const points = seriesObj?.points || [];
                  const closes = points.map((p) => p.close).filter((c) => typeof c === 'number' && Number.isFinite(c));
                  const lowPrice = closes.length > 0 ? Math.min(...closes) : null;
                  const highPrice = closes.length > 0 ? Math.max(...closes) : null;
                  const rangePct = typeof metrics.completedCloseRangePositionPct === 'number' ? metrics.completedCloseRangePositionPct : null;
                  const barCount = ana?.usableCompletedBarCount || points.length;

                  return (
                    <div
                      key={item.symbol}
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
                      {/* Header Card */}
                      <div style={{ height: '70px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              backgroundColor: color.bg,
                              color: color.text,
                              border: `1px solid ${color.border}`,
                              fontWeight: 900,
                              fontSize: '0.92rem'
                            }}
                          >
                            {item.symbol}
                          </span>
                          <span className="fintech-badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                            {formatAssetType(item.assetType)}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--color-slate-600)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.name}
                        </div>
                      </div>

                      {/* Row 1: Giá thị trường */}
                      <div className="comparison-metric-cell">
                        <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                          {item.snapshot?.price !== null && item.snapshot?.price !== undefined
                            ? formatNativeAmount(item.snapshot.price, qCur)
                            : '—'}
                        </div>
                      </div>

                      {/* Row 2: Biến động giá */}
                      <div className="comparison-metric-cell">
                        {isAvail ? (
                          <span
                            style={{
                              fontSize: '0.95rem',
                              fontWeight: 800,
                              color: metrics.priceChangePct > 0 ? 'var(--color-gain-700)' : metrics.priceChangePct < 0 ? 'var(--color-loss-700)' : 'var(--color-slate-700)'
                            }}
                          >
                            {formatPercentVN(metrics.priceChangePct)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--color-slate-400)', fontSize: '0.82rem' }}>
                            {item.historyStatus?.status === 'unsupported' ? 'Không hỗ trợ' : 'Chưa đủ dữ liệu'}
                          </span>
                        )}
                      </div>

                      {/* Row 3: Khoảng giá */}
                      <div className="comparison-metric-cell">
                        {isAvail && lowPrice !== null && highPrice !== null ? (
                          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-slate-800)' }}>
                            {formatNativeAmount(lowPrice, qCur)} → {formatNativeAmount(highPrice, qCur)}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--color-slate-400)', fontSize: '0.82rem' }}>—</span>
                        )}
                      </div>

                      {/* Row 4: Vị trí trong vùng giá */}
                      <div className="comparison-metric-cell">
                        {isAvail && typeof rangePct === 'number' ? (
                          <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-slate-800)' }}>
                            {rangePct.toFixed(1).replace('.', ',')}%
                          </span>
                        ) : (
                          <span style={{ color: 'var(--color-slate-400)', fontSize: '0.82rem' }}>—</span>
                        )}
                      </div>

                      {/* Row 5: Tỷ lệ mốc đóng cửa tăng */}
                      <div className="comparison-metric-cell">
                        {isAvail && typeof metrics.positiveCloseTransitionRatio === 'number' ? (
                          <span style={{ fontSize: '0.88rem', fontWeight: 700, color: color.text }}>
                            {(metrics.positiveCloseTransitionRatio * 100).toFixed(1).replace('.', ',')}%
                          </span>
                        ) : (
                          <span style={{ color: 'var(--color-slate-400)', fontSize: '0.82rem' }}>—</span>
                        )}
                      </div>

                      {/* Row 6: Biến động ngày */}
                      <div className="comparison-metric-cell">
                        {isAvail && typeof metrics.dailyVolatilityPct === 'number' ? (
                          <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-slate-800)' }}>
                            {metrics.dailyVolatilityPct.toFixed(2).replace('.', ',')}%
                          </span>
                        ) : (
                          <span style={{ color: 'var(--color-slate-400)', fontSize: '0.82rem' }}>—</span>
                        )}
                      </div>

                      {/* Row 7: Sụt giảm tối đa */}
                      <div className="comparison-metric-cell">
                        {isAvail && typeof metrics.maxDrawdownPct === 'number' ? (
                          <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-loss-600)' }}>
                            −{Math.abs(metrics.maxDrawdownPct).toFixed(2).replace('.', ',')}%
                          </span>
                        ) : (
                          <span style={{ color: 'var(--color-slate-400)', fontSize: '0.82rem' }}>—</span>
                        )}
                      </div>

                      {/* Row 8: Số mốc dữ liệu */}
                      <div className="comparison-metric-cell">
                        <span style={{ fontSize: '0.85rem', color: 'var(--color-slate-700)' }}>
                          {barCount > 0 ? `${barCount} mốc` : '—'}
                        </span>
                      </div>
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
