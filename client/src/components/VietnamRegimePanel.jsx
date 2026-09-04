import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../utils/api.js';
import {
  buildVietnamRegimeViewModel,
  formatRegimePercent,
  formatReferencePeriod,
  formatDateKey,
  formatMetricValue,
  formatMetricChange
} from '../utils/regimeDisplay.js';

export function VietnamRegimePanel({ briefSlot = null, newsSlot = null }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    apiFetch('/api/regime/vietnam', { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (body?.moneyMarket || body?.inflation || body?.marketBreadth || body?.pillars) {
          setPayload(body);
          setRequestError(false);
          return;
        }
        throw new Error('REGIME_UNAVAILABLE');
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') setRequestError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const view = useMemo(() => buildVietnamRegimeViewModel(payload), [payload]);

  // Derived pillar helper observations
  const macroCpi = view.pillars?.macro?.find((o) => o.factId === 'vn.macro.cpi.yoy' || o.id === 'macro.cpi_yoy');
  const monetaryUsdVnd = view.pillars?.monetary?.find((o) => o.factId === 'vn.monetary.fx.usd_vnd' || o.id === 'monetary.usd_vnd');
  const marketVnindex = view.pillars?.market?.find((o) => o.factId === 'vn.market.vnindex.close' || o.id === 'market.vnindex');
  const marketVn30 = view.pillars?.market?.find((o) => o.factId === 'vn.market.vn30.close' || o.id === 'market.vn30');
  const intermarketDxy = view.pillars?.intermarket?.find((o) => o.factId === 'global.intermarket.dxy.quote' || o.id === 'intermarket.dxy');
  const intermarketBrent = view.pillars?.intermarket?.find((o) => o.factId === 'global.intermarket.brent.futures' || o.id === 'intermarket.brent');
  const intermarketGoldSpot = view.pillars?.intermarket?.find((o) => o.factId === 'global.intermarket.gold_spot.price' || o.id === 'intermarket.gold_spot');

  return (
    <section className="market-intelligence-surface fintech-card" aria-labelledby="vietnam-regime-title">
      {/* 1. Header */}
      <div className="market-intelligence-header">
        <div>
          <div className="market-intelligence-title-row">
            <h2 id="vietnam-regime-title" className="market-intelligence-title">
              Bối cảnh thị trường
            </h2>
            {view.partial && (
              <span className="fintech-badge badge-neutral market-intelligence-status-badge">
                Dữ liệu định kỳ
              </span>
            )}
          </div>
          <p className="market-intelligence-subtitle">
            Dữ liệu và diễn biến đáng chú ý tại Việt Nam
          </p>
        </div>

        <div className="market-intelligence-meta">
          <span className="market-intelligence-meta-label">
            {view.inflation.usable && view.inflation.referencePeriod
              ? `Tham chiếu: ${formatReferencePeriod(view.inflation.referencePeriod)}`
              : 'Nguồn chính thức & thị trường'}
          </span>
        </div>
      </div>

      {/* 2. Loading State */}
      {loading && !payload && (
        <div className="market-pulse-loading" role="status" aria-live="polite">
          <span className="sr-only">Đang tải dữ liệu bối cảnh thị trường...</span>
          <div className="skeleton-shimmer" style={{ height: '78px', borderRadius: 'var(--radius-md)' }} aria-hidden="true" />
        </div>
      )}

      {/* 3. Subtle Degraded Notice */}
      {!loading && requestError && !payload && (
        <div className="market-pulse-degraded-notice">
          <span>Một số nguồn dữ liệu vĩ mô chính thức chưa cập nhật đầy đủ. Đang hiển thị bản tin và tin tức.</span>
        </div>
      )}

      {/* 4. MARKET PULSE: Compact Metric Strip (Adaptive verified metrics) */}
      <div className="market-pulse-strip">
        {view.pulseMetrics && view.pulseMetrics.length > 0 ? (
          view.pulseMetrics.map((metric) => (
            <div key={metric.id} className="market-pulse-cell">
              <div className="market-pulse-cell-header">
                <span className="market-pulse-label">{metric.label}</span>
                <span className="market-pulse-source-tag">{metric.source}</span>
              </div>
              <div className="market-pulse-cell-body">
                <div className="market-pulse-value">
                  {formatMetricValue(metric.value, metric.unit)}
                </div>
                <div className="market-pulse-subtext">
                  {metric.change !== null ? (
                    <span className={metric.change > 0 ? 'color-gain' : metric.change < 0 ? 'color-loss' : ''}>
                      {formatMetricChange(metric.change, metric.changePercent, metric.changeUnit, metric.changeUnitType)}
                    </span>
                  ) : (
                    <span className="market-pulse-muted">Chưa có dữ liệu biến động phiên.</span>
                  )}
                  {(metric.status === 'stale' || metric.freshness === 'stale') && (
                    <span className="market-pulse-stale-tag">Đang hiển thị bản lưu gần nhất.</span>
                  )}
                </div>
              </div>
            </div>
          ))
        ) : (
          /* Fallback for legacy payloads */
          <>
            {view.inflation.usable && view.inflation.headlineCpiYoYPct !== null && (
              <div className="market-pulse-cell">
                <div className="market-pulse-cell-header">
                  <span className="market-pulse-label">Lạm phát CPI (YoY)</span>
                  <span className="market-pulse-source-tag">NSO</span>
                </div>
                <div className="market-pulse-cell-body">
                  <div className="market-pulse-value">
                    {formatRegimePercent(view.inflation.headlineCpiYoYPct)}
                  </div>
                  <div className="market-pulse-subtext">
                    {view.inflation.threeMonthDeltaPp !== null ? (
                      <span className={view.inflation.threeMonthDeltaPp > 0 ? 'color-loss' : 'color-gain'}>
                        {formatRegimePercent(view.inflation.threeMonthDeltaPp, { signed: true, suffix: 'điểm %' })} (3T)
                      </span>
                    ) : (
                      <span className="market-pulse-muted">Chưa đủ kỳ M-3 để tính thay đổi 3 tháng.</span>
                    )}
                  </div>
                </div>
              </div>
            )}
            {view.moneyMarket.usable && view.moneyMarket.vndOvernightRatePct !== null && (
              <div className="market-pulse-cell">
                <div className="market-pulse-cell-header">
                  <span className="market-pulse-label">Lãi suất VND qua đêm</span>
                  <span className="market-pulse-source-tag">SBV</span>
                </div>
                <div className="market-pulse-cell-body">
                  <div className="market-pulse-value">
                    {formatRegimePercent(view.moneyMarket.vndOvernightRatePct)}
                  </div>
                  <div className="market-pulse-subtext">
                    {view.moneyMarket.trendPp !== null ? (
                      <span>
                        {formatRegimePercent(view.moneyMarket.trendPp, { signed: true, suffix: 'điểm %' })} vs TB 4T
                      </span>
                    ) : (
                      <span className="market-pulse-muted">Chưa đủ 8 tuần chính thức liên tục để tính xu hướng.</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 5. SLOTS: Brief + News Row */}
      {(briefSlot || newsSlot) && (
        <div className="market-intelligence-main-grid">
          {briefSlot && <div className="market-intelligence-brief-wrapper">{briefSlot}</div>}
          {newsSlot && <div className="market-intelligence-news-wrapper">{newsSlot}</div>}
        </div>
      )}

      {/* 6. VIETNAM DRIVERS: 4 Pillars */}
      <div className="vietnam-drivers-container">
        <h4 className="vietnam-drivers-heading">Trụ cột bối cảnh Việt Nam</h4>
        <div className="vietnam-drivers-grid">
          {/* Pillar 1: Vĩ mô */}
          <div className="driver-pillar-cell">
            <div className="driver-pillar-title">Vĩ mô</div>
            <div className="driver-pillar-status">
              {macroCpi && macroCpi.value !== null
                ? `CPI: ${formatRegimePercent(macroCpi.value)}`
                : (view.inflation.usable ? `CPI: ${formatRegimePercent(view.inflation.headlineCpiYoYPct)}` : 'Chưa cập nhật')}
            </div>
            <div className="driver-pillar-desc">
              Chỉ số giá tiêu dùng & áp lực chi phí (NSO)
            </div>
          </div>

          {/* Pillar 2: Tiền tệ */}
          <div className="driver-pillar-cell">
            <div className="driver-pillar-title">Tiền tệ</div>
            <div className="driver-pillar-status">
              {monetaryUsdVnd && monetaryUsdVnd.value !== null
                ? `${formatMetricValue(monetaryUsdVnd.value, 'VND')}`
                : (view.moneyMarket.usable ? `ON: ${formatRegimePercent(view.moneyMarket.vndOvernightRatePct)}` : 'Chưa cập nhật')}
            </div>
            <div className="driver-pillar-desc">
              {view.moneyMarket.usable
                ? `Tỷ giá USD/VND & Lãi suất qua đêm (${formatRegimePercent(view.moneyMarket.vndOvernightRatePct)})`
                : 'Tỷ giá USD/VND & Lãi suất liên ngân hàng (SBV)'}
            </div>
          </div>

          {/* Pillar 3: Thị trường */}
          <div className="driver-pillar-cell">
            <div className="driver-pillar-title">Thị trường</div>
            <div className="driver-pillar-status">
              {marketVnindex && marketVnindex.value !== null
                ? `VN-Index: ${formatMetricValue(marketVnindex.value, 'điểm')}`
                : 'Cổ phiếu & Quỹ'}
            </div>
            <div className="driver-pillar-desc">
              {marketVn30 && marketVn30.value !== null
                ? `VN30: ${formatMetricValue(marketVn30.value, 'điểm')} · HOSE / HNX`
                : 'Giao dịch niêm yết theo dõi (HOSE / HNX)'}
            </div>
          </div>

          {/* Pillar 4: Liên thị trường */}
          <div className="driver-pillar-cell">
            <div className="driver-pillar-title">Liên thị trường</div>
            <div className="driver-pillar-status">
              {intermarketDxy && intermarketDxy.value !== null
                ? `DXY: ${formatMetricValue(intermarketDxy.value, '')}`
                : 'Tỷ giá & Hàng hóa'}
            </div>
            <div className="driver-pillar-desc">
              {intermarketGoldSpot && intermarketGoldSpot.value !== null
                ? `Vàng Spot: ${formatMetricValue(intermarketGoldSpot.value, 'USD')} · Dầu & TP Mỹ (10N)`
                : (intermarketBrent && intermarketBrent.value !== null
                  ? `Dầu Brent: ${formatMetricValue(intermarketBrent.value, 'USD')} · Vàng & TP Mỹ (10N)`
                  : 'USD/VND, Vàng và thị trường quốc tế')}
            </div>
          </div>
        </div>
      </div>

      {/* 7. Collapsible Data Quality Drawer */}
      <details className="market-regime-data-quality">
        <summary className="market-regime-quality-summary">
          <span>Nguồn & chất lượng dữ liệu</span>
        </summary>
        <div className="market-regime-quality-content">
          <div className="quality-item">
            <strong>Lạm phát:</strong> {view.inflation.source || 'Cơ quan Thống kê Quốc gia (NSO)'}
            {view.inflation.referencePeriod && ` · Kỳ tham chiếu: ${formatReferencePeriod(view.inflation.referencePeriod)}`}
            {view.inflation.publishedAt && ` · Công bố: ${formatDateKey(view.inflation.publishedAt)}`}
            {!view.inflation.usable && ' · Chưa có số liệu CPI chính thức khả dụng.'}
          </div>
          <div className="quality-item">
            <strong>Thị trường tiền tệ:</strong> {view.moneyMarket.source || 'Ngân hàng Nhà nước Việt Nam (SBV)'}
            {view.moneyMarket.referenceWeekStart && (
              ` · Tuần tham chiếu: ${formatDateKey(view.moneyMarket.referenceWeekStart)} – ${formatDateKey(view.moneyMarket.referenceWeekEnd)}`
            )}
            {!view.moneyMarket.usable && (
              view.moneyMarket.vndOvernightRatePct === null
                ? ' · Chưa có quan sát tuần chính thức khả dụng (chưa đủ 8 tuần chính thức liên tục để tính xu hướng).'
                : ' · Chưa đủ 8 tuần chính thức liên tục để tính xu hướng.'
            )}
          </div>
          <div className="quality-item">
            <strong>Thị trường chứng khoán:</strong> VNDIRECT dchart API (VN-Index, VN30, HNX-Index).
          </div>
          <div className="quality-item">
            <strong>Liên thị trường & Hàng hóa:</strong> Twelve Data (USD/VND giao ngay), Alpha Vantage (Vàng giao ngay XAU/USD), và Yahoo Finance (DXY, US10Y, Dầu Brent tương lai, Vàng tương lai COMEX).
          </div>
          <div className="quality-item">
            <strong>Độ rộng thị trường:</strong> Chưa có nguồn dữ liệu đủ tin cậy để tính toán độ rộng từ danh mục theo dõi giới hạn.
          </div>
          <div className="quality-disclaimer">
            Chỉ báo mô tả từ nguồn chính thức và thị trường, không phải dự báo hay khuyến nghị.
          </div>
        </div>
      </details>
    </section>
  );
}
