import React, { useCallback, useEffect, useReducer, useRef } from 'react';

import { apiFetch } from '../utils/api.js';
import {
  INITIAL_INVESTMENT_BRIEF_STATE,
  buildInvestmentBriefViewModel,
  formatInvestmentBriefAsOf,
  formatInvestmentBriefEvidence,
  reduceInvestmentBriefState
} from '../utils/investmentBriefDisplay.js';
import { MagneticButton } from './MotionHelpers.jsx';

const DOMAIN_LABELS = {
  portfolio: 'Danh mục',
  composition: 'Cơ cấu',
  performance: 'Hiệu suất',
  regime: 'Vĩ mô Việt Nam',
  opportunity: 'Sàng lọc cơ hội',
  news: 'Tin tức'
};

function EvidenceChip({ item }) {
  return (
    <span className="investment-brief-evidence" title={`${item.label}: ${formatInvestmentBriefEvidence(item)}`}>
      <span>{item.label}</span>
      <strong>{formatInvestmentBriefEvidence(item)}</strong>
      {item.asOf && <small>Tham chiếu: {formatInvestmentBriefAsOf(item.asOf)}</small>}
    </span>
  );
}

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

  return (
    <section className="fintech-card investment-brief-panel" aria-labelledby="investment-brief-title">
      <div className="investment-brief-header">
        <div>
          <div className="investment-brief-title-row">
            <span className="investment-brief-kicker">AI có kiểm soát</span>
            {view && <span className={`investment-brief-status status-${view.status}`}>{view.modeLabel}</span>}
          </div>
          <h3 id="investment-brief-title">Bản tin đầu tư AI</h3>
          <p>
            Giải thích dữ kiện xác định từ danh mục, thị trường, bối cảnh Việt Nam và tin liên quan.
          </p>
        </div>
        <MagneticButton
          onClick={generateBrief}
          disabled={isLoading}
          className="fintech-btn btn-primary btn-sm"
        >
          {isLoading ? 'Đang tạo bản tin...' : view ? 'Làm mới bản tin' : 'Tạo bản tin'}
        </MagneticButton>
      </div>

      <p className="investment-brief-privacy">
        Khi AI trực tiếp được bật, một gói dữ kiện đầu tư đã tối giản sẽ được gửi tới nhà cung cấp AI đã cấu hình. Không gửi sổ giao dịch, sổ tiền mặt, mã định danh nội bộ hoặc bí mật hệ thống.
      </p>

      {state.phase === 'idle' && (
        <div className="investment-brief-empty">
          Bản tin chỉ được tạo khi bạn chủ động nhấn nút. Nội dung mang tính thông tin, không phải khuyến nghị hay dự báo đầu tư.
        </div>
      )}

      {isLoading && !view && (
        <div className="investment-brief-loading" aria-live="polite">
          <div className="skeleton-shimmer" />
          <div className="skeleton-shimmer" />
          <div className="skeleton-shimmer" />
        </div>
      )}

      {state.error && (
        <div className="fintech-banner banner-warning investment-brief-error" role="alert">
          {state.error}
        </div>
      )}

      {view && (
        <div className="investment-brief-content" aria-live="polite">
          <div className="investment-brief-meta">
            <span>Tạo lúc: <strong>{view.generatedAt}</strong></span>
            {view.status === 'partial' && <span>Một phần nguồn dữ liệu chưa khả dụng</span>}
            {view.status === 'fallback' && <span>Đang hiển thị bản tóm tắt xác định</span>}
          </div>

          <div className="investment-brief-sections">
            {view.sections.map((section) => (
              <article key={section.id} className="investment-brief-section">
                <h4>{section.label}</h4>
                {section.statements.map((statement, index) => (
                  <div key={`${section.id}-${index}`} className="investment-brief-statement">
                    <p>{statement.text}</p>
                    <div className="investment-brief-evidence-list">
                      {statement.evidence.map((item) => <EvidenceChip key={item.id} item={item} />)}
                    </div>
                  </div>
                ))}
              </article>
            ))}
          </div>

          {view.dataAsOf.length > 0 && (
            <details className="investment-brief-asof">
              <summary>Nguồn và thời điểm tham chiếu</summary>
              <ul>
                {view.dataAsOf.map((item) => (
                  <li key={item.domain}>
                    <strong>{DOMAIN_LABELS[item.domain] || item.domain}:</strong> {item.value}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className="investment-brief-disclaimer">
            Bản tin chỉ diễn giải dữ kiện đã cung cấp; không tạo điểm số, giá mục tiêu, dự báo, độ tin cậy hoặc khuyến nghị đầu tư.
          </p>
        </div>
      )}
    </section>
  );
}
