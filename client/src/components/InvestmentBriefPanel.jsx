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
            {/* 1. Tổng quan thị trường */}
            <article className="market-brief-section-item">
              <h4 className="market-brief-section-heading">1. Tổng quan thị trường</h4>
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

            {/* 2. Động lực chính */}
            {strategistView.keyDrivers.length > 0 && (
              <article className="market-brief-section-item">
                <h4 className="market-brief-section-heading">2. Động lực chính</h4>
                <div className="market-brief-statements">
                  {strategistView.keyDrivers.map((kd, idx) => (
                    <div key={idx} className="market-brief-statement-row">
                      <p className="market-brief-prose">• {kd.driver}</p>
                    </div>
                  ))}
                </div>
              </article>
            )}

            {/* 3. Định hướng đầu tư */}
            {strategistView.investmentOrientation && (
              <article className="market-brief-section-item">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <h4 className="market-brief-section-heading" style={{ margin: 0 }}>3. Định hướng đầu tư</h4>
                  <span className={`stance-badge ${strategistView.investmentOrientation.stanceClass}`} style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: 'rgba(59, 130, 246, 0.1)',
                    color: 'var(--color-primary, #2563eb)',
                    border: '1px solid rgba(59, 130, 246, 0.2)'
                  }}>
                    {strategistView.investmentOrientation.stanceLabel}
                  </span>
                </div>
                <div className="market-brief-statements">
                  <div className="market-brief-statement-row">
                    <p className="market-brief-prose">{strategistView.investmentOrientation.rationale}</p>
                  </div>
                  {strategistView.investmentOrientation.preferredThemes.length > 0 && (
                    <div className="market-brief-statement-row" style={{ marginTop: '4px' }}>
                      <p className="market-brief-prose" style={{ fontSize: '13px' }}>
                        <strong style={{ color: 'var(--color-success, #16a34a)' }}>Ưu tiên quan sát:</strong> {strategistView.investmentOrientation.preferredThemes.join(' · ')}
                      </p>
                    </div>
                  )}
                  {strategistView.investmentOrientation.pressuredThemes.length > 0 && (
                    <div className="market-brief-statement-row" style={{ marginTop: '2px' }}>
                      <p className="market-brief-prose" style={{ fontSize: '13px' }}>
                        <strong style={{ color: 'var(--color-warning, #d97706)' }}>Chịu áp lực:</strong> {strategistView.investmentOrientation.pressuredThemes.join(' · ')}
                      </p>
                    </div>
                  )}
                </div>
              </article>
            )}

            {/* 4. Rủi ro / điều kiện thay đổi góc nhìn */}
            {strategistView.risksAndInvalidation && (
              <article className="market-brief-section-item">
                <h4 className="market-brief-section-heading">4. Rủi ro & điều kiện thay đổi góc nhìn</h4>
                <div className="market-brief-statements">
                  {strategistView.risksAndInvalidation.keyRisks.map((risk, idx) => (
                    <div key={`risk-${idx}`} className="market-brief-statement-row">
                      <p className="market-brief-prose">• <strong>Rủi ro:</strong> {risk}</p>
                    </div>
                  ))}
                  {strategistView.risksAndInvalidation.invalidationConditions.map((cond, idx) => (
                    <div key={`cond-${idx}`} className="market-brief-statement-row">
                      <p className="market-brief-prose">• <em>Điều kiện đảo chiều:</em> {cond}</p>
                    </div>
                  ))}
                </div>
              </article>
            )}

            {/* 5. Điểm cần theo dõi */}
            {strategistView.watchNext.length > 0 && (
              <article className="market-brief-section-item">
                <h4 className="market-brief-section-heading">5. Điểm cần theo dõi</h4>
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
