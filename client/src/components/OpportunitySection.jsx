import { useMemo } from 'react';
import { formatPercentVN } from '../utils/formatting.js';
import {
  OPPORTUNITY_STATE_LABELS,
  buildOpportunityViewModel,
  opportunityReasonLabel
} from '../utils/opportunityDisplay.js';

function formatRatio(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? formatPercentVN(value * 100, false)
    : '—';
}

function formatUnsignedPercent(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? formatPercentVN(value, false)
    : '—';
}

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
}

function riskToleranceLabel(value) {
  return ({ low: 'Thấp', moderate: 'Vừa', high: 'Cao' })[value] || '—';
}

function MetricValue({ value, formatter = formatUnsignedPercent, status }) {
  const available = typeof value === 'number' && Number.isFinite(value);
  return (
    <>
      <strong>{available ? formatter(value) : '—'}</strong>
      {!available && status?.reason && <small>{status.reason}</small>}
    </>
  );
}

function ProfileFitBadge({ profileFit }) {
  if (!profileFit || profileFit.status === 'not_assessed') {
    return (
      <span className="opportunity-badge opportunity-badge-neutral" title={opportunityReasonLabel(profileFit?.reason)}>
        Hồ sơ: chưa đánh giá
      </span>
    );
  }
  const within = profileFit.status === 'within_preference';
  return (
    <span className={`opportunity-badge ${within ? 'opportunity-badge-positive' : 'opportunity-badge-warning'}`}>
      {within ? 'Trong ngưỡng rủi ro tương đối' : 'Ngoài ngưỡng rủi ro tương đối'}
    </span>
  );
}

function CandidateReasons({ reasons }) {
  if (!Array.isArray(reasons) || reasons.length === 0) return null;
  return (
    <div className="opportunity-reasons">
      {reasons.map((reason) => (
        <div key={reason}>
          {opportunityReasonLabel(reason)} <code>{reason}</code>
        </div>
      ))}
    </div>
  );
}

function CandidateCard({ candidate, cohortId, onSelectAsset }) {
  const eligible = candidate.candidateState === 'eligible';
  const goldEvidenceOnly = cohortId === 'GOLD' && candidate.descriptiveRank === null;
  return (
    <article className={`opportunity-candidate opportunity-state-${candidate.candidateState}`}>
      <div className="opportunity-candidate-main">
        <div className="opportunity-rank">
          {eligible
            ? (goldEvidenceOnly ? <span>Bằng chứng</span> : <strong>#{candidate.descriptiveRank}</strong>)
            : <span>—</span>}
        </div>
        <button
          type="button"
          className="opportunity-asset-button"
          onClick={() => onSelectAsset?.(candidate.symbol)}
        >
          <strong>{candidate.symbol}</strong>
          <span>{candidate.name || 'Tài sản'}</span>
        </button>
        <div className="opportunity-badge-row">
          <span className={`opportunity-badge opportunity-badge-${candidate.candidateState}`}>
            {OPPORTUNITY_STATE_LABELS[candidate.candidateState] || candidate.candidateState}
          </span>
          {candidate.screenMatch === true && (
            <span className="opportunity-badge opportunity-badge-positive">Đạt bộ lọc hành vi giá</span>
          )}
          {candidate.screenMatch === false && (
            <span className="opportunity-badge opportunity-badge-neutral">Không đạt bộ lọc hành vi giá</span>
          )}
          {candidate.held && <span className="opportunity-badge opportunity-badge-held">Đang nắm giữ</span>}
          {candidate.watchlisted && <span className="opportunity-badge opportunity-badge-watch">Đang theo dõi</span>}
          {eligible && <ProfileFitBadge profileFit={candidate.profileFit} />}
        </div>
      </div>

      <div className="opportunity-metrics" aria-label={`Bằng chứng định lượng ${candidate.symbol}`}>
        <div>
          <span>Biến động giá kỳ</span>
          <MetricValue
            value={candidate.evidence?.priceChangePct}
            formatter={formatPercentVN}
            status={candidate.metricStatus?.priceChangePct}
          />
        </div>
        <div>
          <span>Phiên đóng cửa tăng</span>
          <MetricValue
            value={candidate.evidence?.positiveCloseTransitionRatio}
            formatter={formatRatio}
            status={candidate.metricStatus?.positiveCloseTransitionRatio}
          />
        </div>
        <div>
          <span>Biến động ngày</span>
          <MetricValue
            value={candidate.evidence?.dailyVolatilityPct}
            status={candidate.metricStatus?.dailyVolatilityPct}
          />
        </div>
        <div>
          <span>Sụt giảm tối đa</span>
          <MetricValue
            value={candidate.evidence?.maxDrawdownPct}
            status={candidate.metricStatus?.maxDrawdownPct}
          />
        </div>
        <div>
          <span>Vị trí trong biên độ đóng cửa</span>
          <MetricValue
            value={candidate.evidence?.completedCloseRangePositionPct}
            status={candidate.metricStatus?.completedCloseRangePositionPct}
          />
        </div>
        <div>
          <span>Tỷ trọng hiện tại</span>
          <strong>{formatUnsignedPercent(candidate.currentExposurePct)}</strong>
          {candidate.exposureStatus === 'partial_basis' && <small>trên phần giá trị đã định giá</small>}
        </div>
      </div>

      <CandidateReasons reasons={candidate.reasons} />
      <div className="opportunity-provenance">
        <span>Kỳ: {candidate.analysisPriceDate || '—'}</span>
        <span>Đồng tiền phân tích: {candidate.analysisQuoteCurrency || '—'}</span>
        <span>Số giá đóng cửa: {candidate.usableCompletedBarCount ?? '—'}</span>
      </div>
    </article>
  );
}

function VietnamContext({ regime }) {
  if (!regime) return null;
  const inflation = regime.inflation || {};
  const money = regime.moneyMarket || {};
  return (
    <aside className="opportunity-context-card">
      <div>
        <strong>Bối cảnh Việt Nam dùng chung</strong>
        <span>Chỉ để tham khảo, không ảnh hưởng thứ hạng tài sản.</span>
      </div>
      <div className="opportunity-context-values">
        <span>CPI YoY: {formatUnsignedPercent(inflation.headlineCpiYoYPct)}</span>
        <span>Thay đổi CPI 3 tháng: {formatPercentVN(inflation.threeMonthDeltaPp)}</span>
        <span>Lãi suất VND qua đêm: {formatUnsignedPercent(money.vndOvernightRatePct)}</span>
        <span>Độ rộng thị trường: Chưa có nguồn dữ liệu đủ tin cậy</span>
      </div>
    </aside>
  );
}

export function OpportunitySection({ data, loading, refreshing, error, onRefresh, onSelectAsset }) {
  const view = useMemo(() => buildOpportunityViewModel(data), [data]);

  return (
    <section className="opportunity-section" aria-labelledby="opportunity-title">
      <div className="section-header opportunity-header">
        <div>
          <h2 id="opportunity-title" className="section-title">Cơ hội</h2>
          <p className="section-subtitle">
            Sàng lọc định lượng mô tả từ dữ liệu giá đóng cửa quá khứ đã hoàn tất.
          </p>
        </div>
        <button type="button" className="fintech-btn btn-secondary btn-sm" onClick={onRefresh} disabled={loading || refreshing}>
          {refreshing ? 'Đang làm mới…' : 'Làm mới'}
        </button>
      </div>

      {loading && !data && (
        <div className="state-box">
          <div className="state-icon spin-icon">⏳</div>
          <h3 className="state-title">Đang phân tích các nhóm tài sản…</h3>
          <p className="state-desc">Dữ liệu được lấy theo từng tài sản với giới hạn đồng thời.</p>
        </div>
      )}

      {error && !data && (
        <div className="fintech-banner banner-error">
          <span>{error}</span>
          <button type="button" className="fintech-btn btn-danger btn-sm" onClick={onRefresh}>Thử lại</button>
        </div>
      )}

      {data && (
        <>
          {error && <div className="fintech-banner banner-warning">{error}</div>}
          <div className="opportunity-summary-grid">
            <div><span>Phạm vi phân tích thay thế</span><strong>{view.analysisRangeProxy || '—'}</strong></div>
            <div><span>Khẩu vị rủi ro</span><strong>{riskToleranceLabel(view.profileContext?.riskTolerance)}</strong></div>
            <div><span>Thời điểm tạo</span><strong>{formatTimestamp(view.generatedAt)}</strong></div>
            <div><span>Phương pháp</span><strong>{view.methodologyVersion || '—'}</strong></div>
          </div>

          {view.profileContext?.longHorizonDisclosure && (
            <div className="fintech-banner banner-warning">
              1Y là phạm vi phân tích dài nhất hiện có, không phải đánh giá đầu tư dài hạn hoàn chỉnh.
            </div>
          )}

          {(view.holdingsContext?.status === 'unavailable'
            || view.watchlistContext?.status === 'unavailable'
            || view.portfolioContext?.status === 'unavailable') && (
            <div className="fintech-banner banner-warning">
              Một phần bối cảnh nắm giữ, theo dõi hoặc tỷ trọng hiện chưa khả dụng; dữ liệu thiếu không được suy thành “không nắm giữ”.
            </div>
          )}

          <VietnamContext regime={view.vietnamRegime} />

          <div className="opportunity-cohorts">
            {view.cohorts.map((cohort) => (
              <section key={cohort.id} className="fintech-card opportunity-cohort">
                <div className="opportunity-cohort-header">
                  <div>
                    <h3>{cohort.label}</h3>
                    <p>Xếp hạng mô tả trong nhóm tài sản · {cohort.eligibleCohortSize} tài sản đủ dữ liệu</p>
                  </div>
                  {cohort.profileFitCutoffs ? (
                    <details className="opportunity-cutoffs">
                      <summary>Ngưỡng hồ sơ</summary>
                      <span>P33 biến động: {formatUnsignedPercent(cohort.profileFitCutoffs.p33?.dailyVolatilityPct)}</span>
                      <span>P33 sụt giảm: {formatUnsignedPercent(cohort.profileFitCutoffs.p33?.maxDrawdownPct)}</span>
                      <span>P67 biến động: {formatUnsignedPercent(cohort.profileFitCutoffs.p67?.dailyVolatilityPct)}</span>
                      <span>P67 sụt giảm: {formatUnsignedPercent(cohort.profileFitCutoffs.p67?.maxDrawdownPct)}</span>
                    </details>
                  ) : (
                    <span className="opportunity-badge opportunity-badge-neutral">Hồ sơ chưa đánh giá: nhóm dưới 10</span>
                  )}
                </div>

                {cohort.candidates.length === 0 ? (
                  <p className="opportunity-empty">Chưa có tài sản trong nhóm.</p>
                ) : (
                  <div className="opportunity-candidate-list">
                    {cohort.candidates.map((candidate) => (
                      <CandidateCard
                        key={candidate.assetId || candidate.symbol}
                        candidate={candidate}
                        cohortId={cohort.id}
                        onSelectAsset={onSelectAsset}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>

          <details className="fintech-card opportunity-methodology">
            <summary>Phương pháp và giới hạn</summary>
            <ul>
              <li>Chỉ xếp hạng trong từng nhóm; không so sánh thứ hạng giữa cổ phiếu, ETF, Crypto và Vàng.</li>
              <li>Bộ lọc đạt khi giá kỳ tăng trên 0% và hơn 50% chuyển tiếp giá đóng cửa là tăng.</li>
              <li>Mức phù hợp hồ sơ không thay đổi thứ hạng mô tả.</li>
              <li>Biến động là độ lệch chuẩn mẫu theo ngày, không quy đổi năm; sụt giảm dùng giá đóng cửa đã hoàn tất.</li>
              <li>Biến động giá không bao gồm cổ tức, phân phối ETF, phí, funding hay staking.</li>
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
