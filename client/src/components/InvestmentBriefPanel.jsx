import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import { apiFetch } from '../utils/api.js';
import {
  INITIAL_INVESTMENT_BRIEF_STATE,
  buildInvestmentBriefViewModel,
  formatInvestmentBriefEvidence,
  reduceInvestmentBriefState
} from '../utils/investmentBriefDisplay.js';
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

    apiFetch('/api/investment-brief', {
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
      .then((data) => {
        if (activeRequestRef.current !== controller || controller.signal.aborted) return;
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

  const view = buildInvestmentBriefViewModel(state.data);
  const isLoading = state.phase === 'loading';
  const displaySections = view?.curatedSections?.length > 0 ? view.curatedSections : (view?.sections || []);

  return (
    <div className="market-brief-panel">
      {/* Header */}
      <div className="market-brief-header">
        <div className="market-brief-heading-group">
          <div className="market-brief-kicker-row">
            <span className="market-brief-badge">
              {view?.badgeLabel || 'Tóm tắt dữ liệu'}
            </span>
            {view && (
              <span className="market-brief-timestamp">
                Cập nhật: {view.generatedAt}
              </span>
            )}
          </div>
          <h3 id="investment-brief-title" className="market-brief-title">
            Bản tin thị trường
          </h3>
          <p className="market-brief-subtitle">
            Tổng hợp và phân tích dữ kiện từ bối cảnh kinh tế, danh mục và tin tức đáng chú ý.
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

      {/* Active Content: Curated Sections */}
      {view && displaySections.length > 0 && (
        <div className="market-brief-content-body" aria-live="polite">
          <div className="market-brief-sections-stack">
            {displaySections.map((section) => (
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

          {/* Evidence Details Collapsible Drawer */}
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
