import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../utils/api.js';
import { buildFundamentalsPeriodDisplay } from '../utils/fundamentalsDisplay.js';
import { TiltCard } from './MotionHelpers.jsx';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';
}

function EmptyFundamentals({ availability }) {
  const unsupported = availability === 'UNSUPPORTED_COMPANY_TYPE';
  const noAnnualOrQuarter = ['AVAILABLE', 'PARTIAL'].includes(availability);
  return (
    <div className="fintech-banner banner-warning" style={{ margin: 0 }}>
      {unsupported
        ? 'Fundamentals V1A hiện chỉ hỗ trợ doanh nghiệp công nghiệp/phi tài chính.'
        : noAnnualOrQuarter
          ? 'Chưa có kỳ năm hoặc kỳ quý đã xác minh để hiển thị.'
          : availability === 'SOURCE_NOT_PROVISIONED'
            ? 'Nguồn báo cáo chính thức chưa được cấu hình.'
            : 'Chưa nhập báo cáo chính thức đã xác minh cho doanh nghiệp này.'}
    </div>
  );
}

export function EquityFundamentalsSection({ asset }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState('quarter');
  const isVietnamEquity = asset?.asset_type === 'stock' && asset?.market_policy === 'VN_EXCHANGE';

  useEffect(() => {
    setData(null);
    setError(null);
    setSelectedPeriod('quarter');
    if (!isVietnamEquity || !asset?.symbol) return undefined;

    const controller = new AbortController();
    setLoading(true);
    apiFetch(`/api/equities/${encodeURIComponent(asset.symbol)}/fundamentals`, {
      signal: controller.signal
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || body?.status !== 'ok') {
          throw new Error(body?.message || 'Không thể tải dữ liệu cơ bản');
        }
        setData(body.data);
      })
      .catch((requestError) => {
        if (requestError?.name !== 'AbortError') setError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [asset?.symbol, isVietnamEquity]);

  const activePeriod = useMemo(() => {
    if (!data) return null;
    if (selectedPeriod === 'annual') return data.latestAnnual || data.latestQuarter;
    return data.latestQuarter || data.latestAnnual;
  }, [data, selectedPeriod]);
  const display = useMemo(() => buildFundamentalsPeriodDisplay(activePeriod), [activePeriod]);

  if (!isVietnamEquity) return null;

  return (
    <TiltCard className="fintech-card" style={{ padding: '1.5rem', marginTop: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-slate-900)', fontWeight: 800 }}>
              Chỉ số tài chính cơ bản
            </h3>
            {display && <span className="fintech-badge badge-gain">Đã xác minh</span>}
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--color-slate-500)' }}>
            Nhập thủ công từ báo cáo chính thức; không suy diễn số liệu còn thiếu.
          </p>
        </div>
        {data?.latestAnnual && data?.latestQuarter && (
          <div style={{ display: 'flex', gap: '6px' }} aria-label="Chọn kỳ báo cáo">
            <button type="button" className={`fintech-btn btn-sm ${selectedPeriod === 'quarter' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSelectedPeriod('quarter')}>
              Kỳ gần nhất
            </button>
            <button type="button" className={`fintech-btn btn-sm ${selectedPeriod === 'annual' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSelectedPeriod('annual')}>
              Năm gần nhất
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="metrics-grid" aria-label="Đang tải chỉ số tài chính">
          {[1, 2, 3, 4].map((item) => <div key={item} className="skeleton-shimmer" style={{ height: '74px' }} />)}
        </div>
      )}
      {!loading && error && <div className="fintech-banner banner-warning">{error}</div>}
      {!loading && !error && data && !display && <EmptyFundamentals availability={data.availability} />}

      {!loading && !error && display && (
        <div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '0.85rem', fontSize: '0.78rem', color: 'var(--color-slate-600)' }}>
            <strong>{display.periodLabel}</strong>
            <span>• Kết thúc {formatDate(display.periodEnd)}</span>
            <span>• {display.scopeLabel}</span>
            <span>• {display.auditLabel}</span>
            <span>• {display.revisionLabel}</span>
          </div>
          <div className="metrics-grid" style={{ marginBottom: '0.9rem', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            {display.metrics.map((metric) => (
              <div
                key={metric.code}
                className="metric-card"
                style={{ padding: '0.9rem 1rem', '--card-accent': metric.value === '—' ? '#94a3b8' : '#2563eb' }}
                title={metric.sourceLabel
                  ? [metric.sourceLabel, metric.sourceLocation, metric.missingReason].filter(Boolean).join(' · ')
                  : undefined}
              >
                <div className="metric-label">{metric.label}</div>
                <div className="metric-value" style={{ fontSize: '1.05rem' }}>{metric.value}</div>
              </div>
            ))}
          </div>
          <div style={{ paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)', fontSize: '0.78rem', color: 'var(--color-slate-500)' }}>
            <span>Nguồn: </span>
            <a href={display.source.url} target="_blank" rel="noreferrer noopener" style={{ fontWeight: 700 }}>
              Xem nguồn chính thức
            </a>
            <span> · {display.source.authority} — {display.source.title} · Công bố {formatDate(display.publishedAt)}</span>
          </div>
        </div>
      )}
    </TiltCard>
  );
}
