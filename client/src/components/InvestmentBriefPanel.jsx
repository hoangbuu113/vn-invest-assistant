import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import { apiFetch } from '../utils/api.js';
import {
  INITIAL_INVESTMENT_BRIEF_STATE,
  buildInvestmentBriefViewModel,
  formatInvestmentBriefEvidence,
  reduceInvestmentBriefState
} from '../utils/investmentBriefDisplay.js';
import {
  buildMarketStrategistViewModel,
  formatEvidenceValue
} from '../utils/marketStrategistDisplay.js';
import { MagneticButton } from './MotionHelpers.jsx';

export function InvestmentBriefPanel() {
  const [state, dispatch] = useReducer(reduceInvestmentBriefState, INITIAL_INVESTMENT_BRIEF_STATE);
  const activeRequestRef = useRef(null);

  useEffect(() => () => {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
  }, []);

  const generateBrief = useCallback(() => {
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    dispatch({ type: 'start' });

    apiFetch('/api/market-strategist', {
      method: 'POST',
      signal: controller.signal
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          const error = new Error(response.status === 429
            ? 'Tần suất tạo bản tin đang được giới hạn. Vui lòng thử lại sau.'
            : 'Không thể tạo bản tin lúc này.');
          error.status = response.status;
          throw error;
        }
        return body;
      })
      .then((payload) => {
        if (activeRequestRef.current !== controller || controller.signal.aborted) return;
        const data = payload?.data || payload;
        dispatch({ type: 'success', data });
      })
      .catch((error) => {
        if (error?.name === 'AbortError' || activeRequestRef.current !== controller) return;
        dispatch({ type: 'error', error: error?.message });
      })
      .finally(() => {
        if (activeRequestRef.current === controller) activeRequestRef.current = null;
      });
  }, []);

  const strategistView = buildMarketStrategistViewModel(state.data);
  const legacyView = buildInvestmentBriefViewModel(state.data);
  const view = strategistView || legacyView;
  const isLoading = state.phase === 'loading';

  return (
    <div className="market-brief-panel">
      {/* Header */}
      <div className="market-brief-header">
        <div className="market-brief-heading-group">
          <div className="market-brief-kicker-row">
            <span className="market-brief-badge">
              {view?.badgeLabel || 'Tóm tắt dữ liệu'}
            </span>
            {view?.generatedAt && (
              <span className="market-brief-timestamp">
                Cập nhật: {view.generatedAt}
              </span>
            )}
          </div>
          <h3 id="investment-brief-title" className="market-brief-title">
            Chiến lược gia Thị trường AI
          </h3>
          <p className="market-brief-subtitle">
            Bản tin thị trường tổng hợp và phân tích dữ kiện từ bối cảnh kinh tế, thị trường và tin tức đáng chú ý.
          </p>
        </div>

        <MagneticButton
          onClick={generateBrief}
          disabled={isLoading}
          className="fintech-btn btn-primary btn-sm market-brief-action-btn"
          aria-label={isLoading ? 'Đang tạo bản tin' : view ? 'Làm mới bản tin' : 'Tạo bản tin'}
        >
          {isLoading ? 'Đang tải...' : view ? 'Làm mới bản tin' : 'Tạo bản tin'}
        </MagneticButton>
      </div>

      {/* Fallback Notice */}
      {view && view.fallbackNotice && (
        <div className="market-brief-fallback-banner">
          <span className="market-brief-fallback-dot" aria-hidden="true" />
          <span>{view.fallbackNotice || 'Bản tóm tắt hiện được tạo từ dữ liệu đã xác minh.'}</span>
        </div>
      )}

      {/* Idle State */}
      {state.phase === 'idle' && (
        <div className="market-brief-empty-state">
          <p>Nhấn <strong>"Tạo bản tin"</strong> để tổng hợp góc nhìn thị trường cập nhật theo dữ kiện thực tế.</p>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && !view && (
        <div className="market-brief-loading-skeleton" aria-live="polite">
          <div className="skeleton-shimmer" style={{ width: '90%', height: '20px', borderRadius: '4px', marginBottom: '10px' }} />
          <div className="skeleton-shimmer" style={{ width: '75%', height: '18px', borderRadius: '4px', marginBottom: '14px' }} />
          <div className="skeleton-shimmer" style={{ width: '100%', height: '48px', borderRadius: '6px', marginBottom: '10px' }} />
          <div className="skeleton-shimmer" style={{ width: '95%', height: '38px', borderRadius: '6px' }} />
        </div>
      )}

      {/* Error banner */}
      {state.error && (
        <div className="fintech-banner banner-warning market-brief-error" role="alert">
          {state.error}
        </div>
      )}

      {/* Active Content: AI Market Strategist Structured Sections */}
      {strategistView && (
        <div className="market-brief-content-body" aria-live="polite">
          <div className="market-brief-sections-stack">
            {/* 1. Quyết định điều hành & Hành động ngay (Executive Decision) */}
            {strategistView.executiveDecision && (
              <article className="market-brief-section-item" style={{
                background: 'rgba(59, 130, 246, 0.05)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                borderRadius: '8px',
                padding: '16px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary, #94a3b8)' }}>
                      Quyết định điều hành
                    </span>
                    <span className={`stance-badge ${strategistView.executiveDecision.stanceClass}`} style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: 'rgba(59, 130, 246, 0.15)',
                      color: 'var(--color-primary, #3b82f6)',
                      border: '1px solid rgba(59, 130, 246, 0.3)'
                    }}>
                      {strategistView.executiveDecision.stanceLabel}
                    </span>
                  </div>
                  <span style={{
                    fontSize: '12px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: 'var(--color-text-secondary, #94a3b8)',
                    border: '1px solid rgba(255, 255, 255, 0.1)'
                  }}>
                    Mức độ tin cậy: <strong>{strategistView.executiveDecision.convictionLabel}</strong>
                  </span>
                </div>

                <p style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  lineHeight: '1.5',
                  color: 'var(--color-text-primary, #f8fafc)',
                  margin: '0 0 10px 0'
                }}>
                  {strategistView.executiveDecision.oneLineDecision}
                </p>

                <div style={{
                  padding: '10px 12px',
                  background: 'rgba(0, 0, 0, 0.2)',
                  borderRadius: '6px',
                  borderLeft: '3px solid var(--color-primary, #3b82f6)'
                }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary, #60a5fa)', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                    Hành động cụ thể lúc này:
                  </span>
                  <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.45', color: 'var(--color-text-primary, #e2e8f0)' }}>
                    {strategistView.executiveDecision.actionNow}
                  </p>
                </div>
              </article>
            )}

            {/* 2. Ma trận Chiến lược theo Lớp tài sản (Asset Strategy Matrix) */}
            {strategistView.assetStrategy && strategistView.assetStrategy.length > 0 && (
              <article className="market-brief-section-item">
                <h4 className="market-brief-section-heading" style={{ marginBottom: '10px' }}>
                  Chiến lược phân bổ lớp tài sản
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {strategistView.assetStrategy.map((asset, idx) => (
                    <div key={idx} style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: '6px',
                      gap: '12px',
                      flexWrap: 'wrap'
                    }}>
                      <div style={{ minWidth: '140px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text-primary, #f8fafc)' }}>
                          {asset.assetClassLabel}
                        </span>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: '3px',
                            background: asset.stance === 'increase' ? 'rgba(34, 197, 94, 0.15)' : (asset.stance === 'reduce' || asset.stance === 'avoid' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(234, 179, 8, 0.15)'),
                            color: asset.stance === 'increase' ? '#22c55e' : (asset.stance === 'reduce' || asset.stance === 'avoid' ? '#ef4444' : '#eab308'),
                            border: `1px solid ${asset.stance === 'increase' ? 'rgba(34, 197, 94, 0.3)' : (asset.stance === 'reduce' || asset.stance === 'avoid' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(234, 179, 8, 0.3)')}`
                          }}>
                            {asset.stanceLabel}
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--color-text-secondary, #94a3b8)' }}>
                            Ưu tiên: {asset.priorityLabel}
                          </span>
                        </div>
                      </div>
                      <div style={{ flex: 1, fontSize: '13px', color: 'var(--color-text-secondary, #cbd5e1)', lineHeight: '1.45' }}>
                        {asset.rationale}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            )}

            {/* 3. Chủ đề ưu tiên & Nhóm cần tránh / hạ tỷ trọng */}
            {(strategistView.preferredThemes.length > 0 || strategistView.avoidOrUnderweight.length > 0) && (
              <article className="market-brief-section-item">
                <h4 className="market-brief-section-heading" style={{ marginBottom: '10px' }}>
                  Chủ đề ưu tiên & Nhóm cần hạn chế
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
                  {/* Preferred */}
                  {strategistView.preferredThemes.length > 0 && (
                    <div style={{
                      padding: '12px',
                      borderRadius: '6px',
                      background: 'rgba(34, 197, 94, 0.05)',
                      border: '1px solid rgba(34, 197, 94, 0.15)'
                    }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', marginBottom: '6px' }}>
                        ✓ Ưu tiên quan sát
                      </div>
                      <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '13px', color: 'var(--color-text-primary, #f1f5f9)' }}>
                        {strategistView.preferredThemes.map((item, idx) => (
                          <li key={idx} style={{ marginBottom: '4px' }}>
                            <strong>{item.theme}</strong>
                            {item.rationale && <span style={{ color: 'var(--color-text-secondary, #94a3b8)' }}>: {item.rationale}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Avoid / Underweight */}
                  {strategistView.avoidOrUnderweight.length > 0 && (
                    <div style={{
                      padding: '12px',
                      borderRadius: '6px',
                      background: 'rgba(239, 68, 68, 0.05)',
                      border: '1px solid rgba(239, 68, 68, 0.15)'
                    }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', marginBottom: '6px' }}>
                        ✕ Cần tránh / Hạ tỷ trọng
                      </div>
                      <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '13px', color: 'var(--color-text-primary, #f1f5f9)' }}>
                        {strategistView.avoidOrUnderweight.map((item, idx) => (
                          <li key={idx} style={{ marginBottom: '4px' }}>
                            <strong>{item.theme}</strong>
                            {item.reason && <span style={{ color: 'var(--color-text-secondary, #94a3b8)' }}>: {item.reason}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </article>
            )}

            {/* 4. Động lực chính & Bối cảnh */}
            {strategistView.keyDrivers.length > 0 && (
              <article className="market-brief-section-item">
                <h4 className="market-brief-section-heading">Động lực thị trường then chốt</h4>
                <div className="market-brief-statements">
                  {strategistView.keyDrivers.map((kd, idx) => (
                    <div key={idx} className="market-brief-statement-row">
                      <p className="market-brief-prose">• {kd.driver}</p>
                    </div>
                  ))}
                </div>
              </article>
            )}

            {/* 5. Tổng quan thị trường */}
            <article className="market-brief-section-item">
              <h4 className="market-brief-section-heading">Bối cảnh kinh tế & thị trường</h4>
              <div className="market-brief-statements">
                {strategistView.marketOverview.vietnam && (
                  <div className="market-brief-statement-row">
                    <p className="market-brief-prose">
                      <strong>Việt Nam:</strong> {strategistView.marketOverview.vietnam}
                    </p>
                  </div>
                )}
                {strategistView.marketOverview.global && (
                  <div className="market-brief-statement-row">
                    <p className="market-brief-prose">
                      <strong>Toàn cầu:</strong> {strategistView.marketOverview.global}
                    </p>
                  </div>
                )}
              </div>
            </article>

            {/* 6. Rủi ro / điều kiện thay đổi góc nhìn */}
            {strategistView.risksAndInvalidation && (
              <article className="market-brief-section-item">
                <h4 className="market-brief-section-heading">Rủi ro & điều kiện đảo chiều góc nhìn</h4>
                <div className="market-brief-statements">
                  {strategistView.risksAndInvalidation.keyRisks.map((risk, idx) => (
                    <div key={`risk-${idx}`} className="market-brief-statement-row">
                      <p className="market-brief-prose">• <strong>Rủi ro:</strong> {risk}</p>
                    </div>
                  ))}
                  {strategistView.risksAndInvalidation.invalidationConditions.map((cond, idx) => (
                    <div key={`cond-${idx}`} className="market-brief-statement-row">
                      <p className="market-brief-prose">• <em>Điều kiện thay đổi quan điểm:</em> {cond}</p>
                    </div>
                  ))}
                </div>
              </article>
            )}

            {/* 7. Điểm cần theo dõi tiếp theo */}
            {strategistView.watchNext.length > 0 && (
              <article className="market-brief-section-item">
                <h4 className="market-brief-section-heading">Điểm theo dõi tiếp theo</h4>
                <div className="market-brief-statements">
                  {strategistView.watchNext.map((item, idx) => (
                    <div key={idx} className="market-brief-statement-row">
                      <p className="market-brief-prose">• {typeof item === 'string' ? item : item.item}</p>
                    </div>
                  ))}
                </div>
              </article>
            )}
          </div>

          {/* 6. Evidence Details Collapsible Drawer */}
          {Array.isArray(strategistView.evidence) && strategistView.evidence.length > 0 && (
            <details className="market-brief-details-drawer">
              <summary className="market-brief-details-summary">
                <span>Nguồn bằng chứng & tham chiếu kiểm chứng ({strategistView.evidence.length})</span>
              </summary>
              <div className="market-brief-details-body">
                <ul className="market-brief-evidence-grid">
                  {strategistView.evidence.map((item) => (
                    <li key={item.id} className="market-brief-evidence-tag">
                      <span className="evidence-tag-label">{item.label}:</span>
                      <strong className="evidence-tag-val">{formatEvidenceValue(item)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          )}

          <p className="market-brief-disclaimer-text">
            Bản tin AI là lớp tổng hợp từ dữ kiện thị trường đã kiểm chứng; không đưa ra giá mục tiêu, dự báo cam kết hay khuyến nghị đầu tư cá nhân hóa.
          </p>
        </div>
      )}

      {/* Legacy View Fallback if strategistView is absent */}
      {!strategistView && legacyView && legacyView.curatedSections?.length > 0 && (
        <div className="market-brief-content-body" aria-live="polite">
          <div className="market-brief-sections-stack">
            {legacyView.curatedSections.map((section) => (
              <article key={section.id} className="market-brief-section-item">
                <h4 className="market-brief-section-heading">{section.label}</h4>
                <div className="market-brief-statements">
                  {section.statements.map((statement, idx) => (
                    <div key={idx} className="market-brief-statement-row">
                      <p className="market-brief-prose">{statement.text}</p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>

          {Array.isArray(state.data?.evidence) && state.data.evidence.length > 0 && (
            <details className="market-brief-details-drawer">
              <summary className="market-brief-details-summary">
                <span>Dữ kiện & tham chiếu kiểm chứng ({state.data.evidence.length})</span>
              </summary>
              <div className="market-brief-details-body">
                <ul className="market-brief-evidence-grid">
                  {state.data.evidence.map((item) => (
                    <li key={item.id} className="market-brief-evidence-tag">
                      <span className="evidence-tag-label">{item.label}:</span>
                      <strong className="evidence-tag-val">{formatInvestmentBriefEvidence(item)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          )}

          <p className="market-brief-disclaimer-text">
            Bản tin chỉ diễn giải dữ kiện đã cung cấp; không tạo điểm số, giá mục tiêu, dự báo hay khuyến nghị đầu tư.
          </p>
        </div>
      )}
    </div>
  );
}
