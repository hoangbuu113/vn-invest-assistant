import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../utils/api.js';
import { buildVietnamRegimeViewModel, formatRegimePercent } from '../utils/regimeDisplay.js';

function formatReferencePeriod(period) {
  const match = /^(\d{4})-(\d{2})$/.exec(period || '');
  return match ? `Tháng ${Number(match[2])}/${match[1]}` : 'Chưa xác định';
}

function formatDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Chưa xác định';
}

function SourceLine({ source, reference, publishedAt }) {
  return (
    <div className="regime-source-line">
      <span>{source || 'Nguồn chính thức chưa khả dụng'}</span>
      {reference && <span>Tham chiếu: {reference}</span>}
      {publishedAt && <span>Công bố: {formatDateKey(publishedAt)}</span>}
    </div>
  );
}

export function VietnamRegimePanel() {
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
    <section className="fintech-card vietnam-regime-panel" aria-labelledby="vietnam-regime-title">
      <div className="regime-panel-header">
        <div>
          <h3 id="vietnam-regime-title">Bối cảnh thị trường Việt Nam</h3>
          <p>Chỉ báo mô tả từ nguồn chính thức, không phải dự báo hay khuyến nghị.</p>
        </div>
        {view.partial && <span className="fintech-badge badge-neutral">Dữ liệu một phần</span>}
      </div>

      {loading && !payload && (
        <div className="regime-loading" aria-label="Đang tải dữ liệu bối cảnh thị trường">
          <div className="skeleton-shimmer" />
          <div className="skeleton-shimmer" />
          <div className="skeleton-shimmer" />
        </div>
      )}

      {!loading && requestError && !payload && (
        <div className="fintech-banner banner-warning">Chưa thể tải dữ liệu chính thức lúc này.</div>
      )}

      {payload && (
        <div className="regime-domain-grid">
          <article className="regime-domain-card">
            <div className="regime-domain-title">Lạm phát</div>
            {view.inflation.usable ? (
              <>
                <div className="regime-value-row">
                  <span>CPI so với cùng kỳ</span>
                  <strong>{formatRegimePercent(view.inflation.headlineCpiYoYPct)}</strong>
                </div>
                <div className="regime-value-row">
                  <span>Thay đổi sau 3 tháng</span>
                  <strong>{formatRegimePercent(view.inflation.threeMonthDeltaPp, { signed: true, suffix: 'điểm %' })}</strong>
                </div>
                {view.inflation.threeMonthDeltaPp === null && (
                  <p className="regime-state-note">Chưa đủ kỳ M-3 để tính thay đổi 3 tháng.</p>
                )}
                {view.inflation.status === 'stale' && (
                  <p className="regime-state-note">Đang hiển thị bản lưu chính thức gần nhất.</p>
                )}
                <SourceLine
                  source={view.inflation.source}
                  reference={formatReferencePeriod(view.inflation.referencePeriod)}
                  publishedAt={view.inflation.publishedAt}
                />
              </>
            ) : (
              <p className="regime-state-note">Chưa có số liệu CPI chính thức khả dụng.</p>
            )}
          </article>

          <article className="regime-domain-card">
            <div className="regime-domain-title">Thị trường tiền tệ</div>
            {view.moneyMarket.usable ? (
              <>
                <div className="regime-value-row">
                  <span>Lãi suất VND qua đêm</span>
                  <strong>{formatRegimePercent(view.moneyMarket.vndOvernightRatePct)}</strong>
                </div>
                {view.moneyMarket.trendPp !== null ? (
                  <div className="regime-value-row">
                    <span>Chênh lệch TB 4 tuần</span>
                    <strong>{formatRegimePercent(view.moneyMarket.trendPp, { signed: true, suffix: 'điểm %' })}</strong>
                  </div>
                ) : (
                  <p className="regime-state-note">Chưa đủ 8 tuần chính thức liên tục để tính xu hướng.</p>
                )}
                {view.moneyMarket.status === 'stale' && (
                  <p className="regime-state-note">Đang hiển thị bản lưu chính thức gần nhất.</p>
                )}
                <SourceLine
                  source={view.moneyMarket.source}
                  reference={`${formatDateKey(view.moneyMarket.referenceWeekStart)} – ${formatDateKey(view.moneyMarket.referenceWeekEnd)}`}
                />
              </>
            ) : (
              <p className="regime-state-note">Chưa có quan sát tuần chính thức khả dụng.</p>
            )}
          </article>

          <article className="regime-domain-card">
            <div className="regime-domain-title">Độ rộng thị trường</div>
            <p className="regime-state-note">Chưa có nguồn dữ liệu đủ tin cậy</p>
          </article>
        </div>
      )}
    </section>
  );
}
