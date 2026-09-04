import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../utils/api.js';
import {
  buildVietnamRegimeViewModel,
  formatRegimePercent,
  formatReferencePeriod,
  formatDateKey
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
        if (body?.moneyMarket || body?.inflation || body?.marketBreadth) {
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
              : 'Nguồn chính thức'}
          </span>
        </div>
      </div>

      {/* 2. Loading State */}
      {loading && !payload && (
        <div className="market-pulse-loading" aria-label="Đang tải dữ liệu bối cảnh thị trường">
          <div className="skeleton-shimmer" style={{ height: '78px', borderRadius: 'var(--radius-md)' }} />
        </div>
      )}

      {/* 3. Subtle Degraded Notice */}
      {!loading && requestError && !payload && (
        <div className="market-pulse-degraded-notice">
          <span>Một số nguồn dữ liệu vĩ mô chính thức chưa cập nhật đầy đủ. Đang hiển thị bản tin và tin tức.</span>
        </div>
      )}

      {/* 4. MARKET PULSE: Compact Metric Strip */}
      <div className="market-pulse-strip">
        {/* Metric 1: CPI */}
        <div className="market-pulse-cell">
          <div className="market-pulse-cell-header">
            <span className="market-pulse-label">Lạm phát CPI (YoY)</span>
            <span className="market-pulse-source-tag">NSO</span>
          </div>
          <div className="market-pulse-cell-body">
            <div className="market-pulse-value">
              {view.inflation.usable
                ? formatRegimePercent(view.inflation.headlineCpiYoYPct)
                : <span className="market-pulse-null">Chưa có số liệu CPI chính thức khả dụng.</span>}
            </div>
            {view.inflation.usable && (
              <div className="market-pulse-subtext">
                {view.inflation.threeMonthDeltaPp !== null ? (
                  <span className={view.inflation.threeMonthDeltaPp > 0 ? 'color-loss' : 'color-gain'}>
                    {formatRegimePercent(view.inflation.threeMonthDeltaPp, { signed: true, suffix: 'điểm %' })} (3T)
                  </span>
                ) : (
                  <span className="market-pulse-muted">Chưa đủ kỳ M-3 để tính thay đổi 3 tháng.</span>
                )}
                {view.inflation.status === 'stale' && (
                  <span className="market-pulse-stale-tag">Đang hiển thị bản lưu chính thức gần nhất.</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Metric 2: Lãi suất VND qua đêm */}
        <div className="market-pulse-cell">
          <div className="market-pulse-cell-header">
            <span className="market-pulse-label">Lãi suất VND qua đêm</span>
            <span className="market-pulse-source-tag">SBV</span>
          </div>
          <div className="market-pulse-cell-body">
            <div className="market-pulse-value">
              {view.moneyMarket.usable
                ? formatRegimePercent(view.moneyMarket.vndOvernightRatePct)
                : <span className="market-pulse-null">Chưa có quan sát tuần chính thức khả dụng.</span>}
            </div>
            {view.moneyMarket.usable && (
              <div className="market-pulse-subtext">
                {view.moneyMarket.trendPp !== null ? (
                  <span>
                    {formatRegimePercent(view.moneyMarket.trendPp, { signed: true, suffix: 'điểm %' })} vs TB 4T
                  </span>
                ) : (
                  <span className="market-pulse-muted">Chưa đủ 8 tuần chính thức liên tục để tính xu hướng.</span>
                )}
                {view.moneyMarket.status === 'stale' && (
                  <span className="market-pulse-stale-tag">Đang hiển thị bản lưu chính thức gần nhất.</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Metric 3: Độ rộng & Thanh khoản */}
        <div className="market-pulse-cell">
          <div className="market-pulse-cell-header">
            <span className="market-pulse-label">Độ rộng thị trường</span>
            <span className="market-pulse-source-tag">HOSE / HNX</span>
          </div>
          <div className="market-pulse-cell-body">
            <div className="market-pulse-value">
              <span className="market-pulse-pending">Đang chuẩn bị</span>
            </div>
            <div className="market-pulse-subtext">
              <span className="market-pulse-muted">Chưa có nguồn dữ liệu đủ tin cậy</span>
            </div>
          </div>
        </div>
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
          <div className="driver-pillar-cell">
            <div className="driver-pillar-title">Vĩ mô</div>
            <div className="driver-pillar-status">
              {view.inflation.usable
                ? `CPI: ${formatRegimePercent(view.inflation.headlineCpiYoYPct)}`
                : 'Chưa cập nhật'}
            </div>
            <div className="driver-pillar-desc">Chỉ số giá tiêu dùng & áp lực chi phí (NSO)</div>
          </div>

          <div className="driver-pillar-cell">
            <div className="driver-pillar-title">Tiền tệ</div>
            <div className="driver-pillar-status">
              {view.moneyMarket.usable
                ? `ON: ${formatRegimePercent(view.moneyMarket.vndOvernightRatePct)}`
                : 'Chưa cập nhật'}
            </div>
            <div className="driver-pillar-desc">Thanh khoản liên ngân hàng & lãi suất (SBV)</div>
          </div>

          <div className="driver-pillar-cell">
            <div className="driver-pillar-title">Thị trường</div>
            <div className="driver-pillar-status">Cổ phiếu & Quỹ</div>
            <div className="driver-pillar-desc">Giao dịch niêm yết theo dõi (HOSE / HNX)</div>
          </div>

          <div className="driver-pillar-cell">
            <div className="driver-pillar-title">Liên thị trường</div>
            <div className="driver-pillar-status">Tỷ giá & Hàng hóa</div>
            <div className="driver-pillar-desc">USD/VND, Vàng và thị trường quốc tế</div>
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
          </div>
          <div className="quality-item">
            <strong>Thị trường tiền tệ:</strong> {view.moneyMarket.source || 'Ngân hàng Nhà nước Việt Nam (SBV)'}
            {view.moneyMarket.referenceWeekStart && (
              ` · Tuần tham chiếu: ${formatDateKey(view.moneyMarket.referenceWeekStart)} – ${formatDateKey(view.moneyMarket.referenceWeekEnd)}`
            )}
            {!view.moneyMarket.usable && ' · Chưa đủ 8 tuần chính thức liên tục để tính xu hướng.'}
          </div>
          <div className="quality-item">
            <strong>Độ rộng thị trường:</strong> Chưa có nguồn dữ liệu đủ tin cậy để tính toán độ rộng từ danh mục theo dõi giới hạn.
          </div>
          <div className="quality-disclaimer">
            Chỉ báo mô tả từ nguồn chính thức, không phải dự báo hay khuyến nghị.
          </div>
        </div>
      </details>
    </section>
  );
}
