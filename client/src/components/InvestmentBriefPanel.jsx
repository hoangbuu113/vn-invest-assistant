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
            {view?.dataAsOfLabel ? (
              <span className="market-brief-timestamp" title={view.generatedAt ? `Khởi tạo: ${view.generatedAt}` : undefined}>
                {view.dataAsOfLabel}
              </span>
            ) : view?.generatedAt ? (
              <span className="market-brief-timestamp">
                Cập nhật: {view.generatedAt}
              </span>
            ) : null}
            {view?.strategyDataAsOfLabel && view.strategyDataAsOf !== view.currentEvidenceDataAsOf && (
              <span className="market-brief-timestamp strategist-publication-timestamp">
                {view.strategyDataAsOfLabel}
              </span>
            )}
            {view?.generationBadge && (
              <span className="market-brief-cadence-badge" title={view.modeLabel}>
                {view.generationBadge}
              </span>
            )}
            {view?.hasMixedCadence && (
              <span className="market-brief-cadence-badge" title={view.cadenceLimitations?.join('\n') || 'Các nguồn dữ liệu có chu kỳ công bố khác nhau'}>
                {view.mixedCadenceNotice || 'Nguồn có độ trễ khác nhau'}
              </span>
            )}
          </div>
          <h3 id="investment-brief-title" className="market-brief-title">
            AI Market Strategist
          </h3>
          <p className="market-brief-subtitle">
            {view?.modeLabel || 'Bản tin chiến lược thị trường từ dữ kiện kinh tế, liên thị trường và tin tức đã kiểm chứng.'}
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
          <span>{view.fallbackNotice || 'Bản chiến lược hiện được tạo từ dữ liệu đã xác minh.'}</span>
        </div>
      )}

      {/* Idle State */}
      {state.phase === 'idle' && !view && (
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

      {/* Active Content: decision-first AI Market Strategist surface */}
      {strategistView && (
        <div className="market-strategist" aria-live="polite">
          {strategistView.executiveDecision && (
            <section className={`strategist-command ${strategistView.executiveDecision.stanceClass}`}>
              <div className="strategist-command-meta">
                <div className="strategist-regime-lockup">
                  <span className="strategist-eyebrow">Trạng thái thị trường</span>
                  <strong className="strategist-regime-value">
                    {strategistView.executiveDecision.stanceLabel}
                  </strong>
                </div>
                {strategistView.confidenceAssessment && (
                  <div className={`strategist-confidence-grade confidence-${strategistView.confidenceAssessment.publicGrade?.toLowerCase() || 'not-assessed'}`}>
                    <span>Độ vững của nhận định</span>
                    <strong>{strategistView.confidenceAssessment.publicGradeLabel}</strong>
                  </div>
                )}
              </div>

              <div className="strategist-core-view">
                <span className="strategist-eyebrow">Góc nhìn cốt lõi</span>
                <p>{strategistView.executiveDecision.oneLineDecision}</p>
              </div>

              <div className="strategist-action-now">
                <span className="strategist-action-index" aria-hidden="true">01</span>
                <div>
                  <span className="strategist-action-label">Bây giờ nên làm gì?</span>
                  <p>{strategistView.executiveDecision.actionNow}</p>
                </div>
              </div>

              {strategistView.whatChanged?.summary && (
                <div className="strategist-change-section">
                  <div className="strategist-change-badge">
                    <span>Thay đổi mới nhất:</span>
                  </div>
                  {strategistView.whatChanged.display ? (
                    <div className="strategist-change-content">
                      {strategistView.whatChanged.display.assetChanges.length > 0 && (
                        <div className="strategist-change-assets" role="list" aria-label="Thay đổi phân bổ tài sản">
                          {strategistView.whatChanged.display.assetChanges.map((change) => (
                            <div key={change.key} className="strategist-change-asset" role="listitem">
                              <strong>{change.label}</strong>
                              <div className="strategist-change-values">
                                <span>{change.previousPosture}</span>
                                <span aria-hidden="true">→</span>
                                <span>{change.currentPosture}</span>
                              </div>
                              {change.priorityChanged && (
                                <small>
                                  Ưu tiên: {change.previousPriority} <span aria-hidden="true">→</span> {change.currentPriority}
                                </small>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {strategistView.whatChanged.display.preferredThemeChanges.length > 0 && (
                        <div className="strategist-change-group">
                          <span className="strategist-change-group-label">Chủ đề</span>
                          <div className="strategist-change-chips">
                            {strategistView.whatChanged.display.preferredThemeChanges.map((change) => (
                              <span key={change.key} className={`strategist-change-chip is-${change.tone}`}>{change.label}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {strategistView.whatChanged.display.restrictedThemeChanges.length > 0 && (
                        <div className="strategist-change-group">
                          <span className="strategist-change-group-label">Chủ đề hạn chế</span>
                          <div className="strategist-change-chips">
                            {strategistView.whatChanged.display.restrictedThemeChanges.map((change) => (
                              <span key={change.key} className={`strategist-change-chip is-${change.tone}`}>{change.label}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {strategistView.whatChanged.display.riskChanges.length > 0 && (
                        <div className="strategist-change-group">
                          <span className="strategist-change-group-label">Rủi ro / điều kiện</span>
                          <div className="strategist-change-chips">
                            {strategistView.whatChanged.display.riskChanges.map((change) => (
                              <span key={change.key} className={`strategist-change-chip is-${change.tone}`}>{change.label}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {strategistView.whatChanged.display.otherChanges.length > 0 && (
                        <div className="strategist-change-other" role="list" aria-label="Các thay đổi chiến lược khác">
                          {strategistView.whatChanged.display.otherChanges.map((change) => (
                            <div key={change.key} role="listitem">
                              <strong>{change.label}</strong>
                              <span>{change.previous} → {change.current}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {strategistView.whatChanged.display.publicationNotice && (
                        <p className="strategist-change-note">{strategistView.whatChanged.display.publicationNotice}</p>
                      )}
                      {strategistView.whatChanged.display.sincePublicationSummary && (
                        <p className="strategist-change-status">{strategistView.whatChanged.display.sincePublicationSummary}</p>
                      )}
                    </div>
                  ) : (
                    <p className="strategist-change-summary">{strategistView.whatChanged.summary}</p>
                  )}
                </div>
              )}

              {strategistView.confidenceAssessment && (
                <div className="strategist-confidence-framework">
                  <div className="strategist-confidence-facts" aria-label="Chi tiết độ vững của nhận định">
                    <span><small>Bằng chứng</small><strong>{strategistView.confidenceAssessment.evidenceSupportLabel}</strong></span>
                    <span><small>Kiểm chứng lịch sử</small><strong>{strategistView.confidenceAssessment.calibrationStatusLabel}</strong></span>
                  </div>

                  <div className="strategist-confidence-explanation">
                    {strategistView.confidenceAssessment.strengths.length > 0 && (
                      <div>
                        <strong>Điểm mạnh</strong>
                        <ul>{strategistView.confidenceAssessment.strengths.map((item, index) => <li key={`strength-${index}`}>✓ {item}</li>)}</ul>
                      </div>
                    )}
                    {strategistView.confidenceAssessment.limitations.length > 0 && (
                      <div>
                        <strong>Giới hạn</strong>
                        <ul>{strategistView.confidenceAssessment.limitations.map((item, index) => <li key={`limit-${index}`}>△ {item}</li>)}</ul>
                      </div>
                    )}
                    {strategistView.confidenceAssessment.upgrades.length > 0 && (
                      <div>
                        <strong>Để đạt Cao</strong>
                        <ul>{strategistView.confidenceAssessment.upgrades.map((item, index) => <li key={`upgrade-${index}`}>→ {item}</li>)}</ul>
                      </div>
                    )}
                  </div>
                  {strategistView.confidenceAssessment.monetaryDiagnostics.length > 0 && (
                    <div className="strategist-monetary-diagnostics" aria-label="Bằng chứng tiền tệ theo phạm vi nhận định">
                      <strong>Bằng chứng tiền tệ đang áp dụng</strong>
                      <ul>
                        {strategistView.confidenceAssessment.monetaryDiagnostics.map((item) => (
                          <li key={item.requirementId}>
                            <span>{item.label}</span>
                            <strong>{item.status === 'SUPPORTED' ? 'Đã hỗ trợ' : 'Còn thiếu'}</strong>
                            {item.pathId && <small>{item.pathId}</small>}
                            {item.evidenceIds.length > 0 && <small>{item.evidenceIds.join(', ')}</small>}
                            {item.remediation && <small>{item.remediation}</small>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="strategist-confidence-disclaimer">{strategistView.confidenceAssessment.disclaimer}</p>
                </div>
              )}
            </section>
          )}

          {strategistView.assetStrategy.length > 0 && (
            <section className="strategist-section strategist-allocation-section">
              <div className="strategist-section-header">
                <div>
                  <span className="strategist-section-index">02</span>
                  <h4>Định hướng theo lớp tài sản</h4>
                </div>
                <p>Ưu tiên và luận điểm ở cấp lớp tài sản, không phải lệnh giao dịch.</p>
              </div>

              <div className="strategist-allocation-table" role="table" aria-label="Định hướng phân bổ theo lớp tài sản">
                <div className="strategist-allocation-head" role="row" aria-hidden="true">
                  <span>Lớp tài sản</span>
                  <span>Định hướng</span>
                  <span>Ưu tiên</span>
                  <span>Luận điểm</span>
                </div>
                {strategistView.assetStrategy.map((asset) => (
                  <div className="strategist-allocation-row" role="row" key={asset.assetClass}>
                    <strong className="strategist-asset-name" role="cell">{asset.assetClassLabel}</strong>
                    <span className={`strategist-asset-stance ${asset.stanceClass}`} role="cell">
                      {asset.stanceLabel}
                    </span>
                    <span className={`strategist-priority priority-${asset.priority}`} role="cell">
                      <i aria-hidden="true" />{asset.priorityLabel}
                    </span>
                    <p className="strategist-asset-rationale" role="cell">{asset.rationale}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(strategistView.preferredThemes.length > 0 || strategistView.avoidOrUnderweight.length > 0) && (
            <section className="strategist-theme-grid">
              {strategistView.preferredThemes.length > 0 && (
                <article className="strategist-theme-lane strategist-theme-opportunity">
                  <div className="strategist-theme-heading">
                    <span aria-hidden="true">+</span>
                    <div>
                      <span className="strategist-eyebrow">Cơ hội / ưu tiên</span>
                      <h4>Nhóm cổ phiếu ưu tiên</h4>
                    </div>
                  </div>
                  <ul>
                    {strategistView.preferredThemes.map((item, idx) => (
                      <li key={`${item.theme}-${idx}`}>
                        <strong>{item.theme}</strong>
                        {item.rationale && <p>{item.rationale}</p>}
                      </li>
                    ))}
                  </ul>
                </article>
              )}

              {strategistView.avoidOrUnderweight.length > 0 && (
                <article className="strategist-theme-lane strategist-theme-risk">
                  <div className="strategist-theme-heading">
                    <span aria-hidden="true">−</span>
                    <div>
                      <span className="strategist-eyebrow">Rủi ro / giảm ưu tiên</span>
                      <h4>Nhóm cần hạn chế</h4>
                    </div>
                  </div>
                  <ul>
                    {strategistView.avoidOrUnderweight.map((item, idx) => (
                      <li key={`${item.theme}-${idx}`}>
                        <strong>{item.theme}</strong>
                        {item.reason && <p>{item.reason}</p>}
                      </li>
                    ))}
                  </ul>
                </article>
              )}
            </section>
          )}

          <section className="strategist-research-grid">
            {(strategistView.keyDrivers.length > 0 || strategistView.why?.summary) && (
              <article className="strategist-research-column">
                <div className="strategist-section-header compact">
                  <div>
                    <span className="strategist-section-index">03</span>
                    <h4>Vì sao có góc nhìn này?</h4>
                  </div>
                </div>
                {strategistView.why?.summary && (
                  <p className="strategist-why-summary">{strategistView.why.summary}</p>
                )}
                <ol className="strategist-numbered-list">
                  {strategistView.keyDrivers.map((item, idx) => (
                    <li key={`${item.driver}-${idx}`}>{item.driver}</li>
                  ))}
                </ol>
              </article>
            )}

            {strategistView.risksAndInvalidation && (
              <article className="strategist-research-column strategist-invalidation-column">
                <div className="strategist-section-header compact">
                  <div>
                    <span className="strategist-section-index">04</span>
                    <h4>Điều gì làm thay đổi góc nhìn?</h4>
                  </div>
                </div>
                <div className="strategist-invalidation-group">
                  <span>Rủi ro cần kiểm soát</span>
                  <ul>
                    {strategistView.risksAndInvalidation.keyRisks.map((risk, idx) => (
                      <li key={`risk-${idx}`}>{risk}</li>
                    ))}
                  </ul>
                </div>
                <div className="strategist-invalidation-group conditions">
                  <span>Dấu hiệu thay đổi quan điểm</span>
                  <ul>
                    {strategistView.risksAndInvalidation.invalidationConditions.map((condition, idx) => (
                      <li key={`condition-${idx}`}>{condition}</li>
                    ))}
                  </ul>
                </div>
              </article>
            )}
          </section>

          {strategistView.watchNext.length > 0 && (
            <section className="strategist-section strategist-watch-section">
              <div className="strategist-section-header compact">
                <div>
                  <span className="strategist-section-index">05</span>
                  <h4>Chỉ báo cần theo dõi tiếp</h4>
                </div>
              </div>
              <div className="strategist-watch-list">
                {strategistView.watchNext.map((item, idx) => (
                  <div key={`${typeof item === 'string' ? item : item.item}-${idx}`}>
                    <span>{String(idx + 1).padStart(2, '0')}</span>
                    <p>{typeof item === 'string' ? item : item.item}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(strategistView.marketOverview.vietnam || strategistView.marketOverview.global) && (
            <details className="strategist-context-drawer">
              <summary>Bối cảnh phân tích chi tiết</summary>
              <div>
                {strategistView.marketOverview.vietnam && (
                  <p><strong>Việt Nam</strong>{strategistView.marketOverview.vietnam}</p>
                )}
                {strategistView.marketOverview.global && (
                  <p><strong>Toàn cầu</strong>{strategistView.marketOverview.global}</p>
                )}
              </div>
            </details>
          )}

          {strategistView.evidence.length > 0 && (
            <details className="market-brief-details-drawer strategist-evidence-drawer">
              <summary className="market-brief-details-summary">
                <span>Bằng chứng & nguồn kiểm chứng ({strategistView.evidence.length})</span>
              </summary>
              <div className="market-brief-details-body">
                {strategistView.cadenceLimitations?.length > 0 && (
                  <div className="strategist-cadence-limitations">
                    {strategistView.cadenceLimitations.map((limit, idx) => (
                      <p key={idx} className="strategist-cadence-limit-item">{limit}</p>
                    ))}
                  </div>
                )}
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
            Góc nhìn chiến lược được tổng hợp từ dữ kiện thị trường đã kiểm chứng; không phải khuyến nghị đầu tư cá nhân, giá mục tiêu hay dự báo lợi nhuận.
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
