import React from 'react';
import { motion } from 'framer-motion';
import {
  formatAssetType,
  formatPercentVN,
  formatVNDReporting
} from '../utils/formatting.js';
import {
  buildPortfolioAllocationDisplay,
  PORTFOLIO_DISPLAY_STATES
} from '../utils/portfolioSnapshotDisplay.js';

const sectionItemVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } }
};

function StateBadge({ tone, children }) {
  return <span className={`portfolio-state-badge is-${tone}`}>{children}</span>;
}

export function PortfolioCompositionSection({
  snapshot = null,
  data = null,
  loading = false,
  error = null,
  onRetry = null
}) {
  if (loading) {
    return (
      <motion.section variants={sectionItemVariants} className="portfolio-composition-card" aria-label="Đang tải phân bổ">
        <div className="portfolio-composition-state">
          <div className="state-icon spin-icon">⏳</div>
          <h4>Đang tính toán phân bổ danh mục...</h4>
          <p>Đang tổng hợp cơ cấu tiền mặt và các loại tài sản.</p>
        </div>
      </motion.section>
    );
  }

  if (error && !snapshot && !data) {
    return (
      <motion.section variants={sectionItemVariants} className="portfolio-composition-card" aria-label="Lỗi phân bổ">
        <div className="portfolio-composition-error">
          <div>
            <strong>Không thể tải cơ cấu danh mục</strong>
            <p>{error}</p>
          </div>
          {onRetry && (
            <button type="button" onClick={onRetry} className="fintech-btn btn-danger btn-sm">
              Thử lại
            </button>
          )}
        </div>
      </motion.section>
    );
  }

  const rawSnapshot = snapshot || { allocation: data };
  const view = buildPortfolioAllocationDisplay(rawSnapshot);

  // CASE 2: Completely Empty (cash = 0 and holdings = 0)
  if (view.isEmpty) {
    return (
      <motion.section variants={sectionItemVariants} className="portfolio-composition-card" aria-labelledby="portfolio-allocation-title">
        <div className="portfolio-composition-header">
          <div>
            <span className="portfolio-eyebrow">Phân bổ</span>
            <h3 id="portfolio-allocation-title">Cơ cấu danh mục</h3>
          </div>
          <StateBadge tone={view.stateTone}>{view.stateLabel}</StateBadge>
        </div>
        <div className="portfolio-composition-empty">
          <p>Chưa có tài sản trong danh mục để hiển thị phân bổ.</p>
        </div>
      </motion.section>
    );
  }

  // CASE 1: Cash-Only (holdings = 0 and cash > 0)
  if (view.isCashOnly) {
    return (
      <motion.section variants={sectionItemVariants} className="portfolio-composition-card" aria-labelledby="portfolio-allocation-title">
        <div className="portfolio-composition-header">
          <div>
            <span className="portfolio-eyebrow">Phân bổ</span>
            <h3 id="portfolio-allocation-title">Cơ cấu danh mục</h3>
          </div>
          <StateBadge tone="available">Đã cập nhật</StateBadge>
        </div>

        <div className="portfolio-cash-only-box">
          <div className="portfolio-allocation-bar-track">
            <div
              className="portfolio-allocation-bar-segment is-cash"
              style={{ width: '100%' }}
              title="Tiền mặt 100%"
            />
          </div>

          <div className="portfolio-allocation-summary-row">
            <div className="portfolio-allocation-metric">
              <span className="composition-dot is-cash" />
              <span>Tiền mặt: <strong>100%</strong></span>
              <small>({formatVNDReporting(view.cashValue)})</small>
            </div>
            <div className="portfolio-allocation-metric">
              <span className="composition-dot is-invested" />
              <span>Đang đầu tư: <strong>0%</strong></span>
              <small>(0 ₫)</small>
            </div>
          </div>
        </div>
      </motion.section>
    );
  }

  // CASE 3, 4, normal: Holdings exist
  const cashPct = view.cashWeightPct !== null ? Math.max(0, Math.min(100, view.cashWeightPct)) : 0;
  const investedPct = view.investedWeightPct !== null ? Math.max(0, Math.min(100, view.investedWeightPct)) : 0;
  const hasLargest = view.largestHolding !== null;
  const hasTop3 = view.top3Concentration !== null;

  return (
    <motion.section variants={sectionItemVariants} className="portfolio-composition-card" aria-labelledby="portfolio-allocation-title">
      <div className="portfolio-composition-header">
        <div>
          <span className="portfolio-eyebrow">Phân bổ</span>
          <h3 id="portfolio-allocation-title">Cơ cấu danh mục</h3>
        </div>
        <div className="portfolio-composition-badges">
          {view.isPartial && (
            <span className="portfolio-partial-count">
              {view.pricedHoldingsCount}/{view.totalHoldingsCount} có giá
            </span>
          )}
          <StateBadge tone={view.stateTone}>{view.stateLabel}</StateBadge>
        </div>
      </div>

      {view.isPartial && (
        <div className="portfolio-composition-banner is-warn">
          <span>ℹ️</span>
          <span>Một số tài sản chưa có dữ liệu định giá; tỷ trọng hiển thị dựa trên tài sản đã có giá.</span>
        </div>
      )}

      {view.isStale && (
        <div className="portfolio-composition-banner is-warn">
          <span>⚠️</span>
          <span>Dữ liệu giá thị trường hoặc tỷ giá gần nhất đã cũ.</span>
        </div>
      )}

      {/* Primary Split: Tiền mặt vs Đang đầu tư */}
      <div className="portfolio-allocation-block">
        <span className="portfolio-block-label">Phân bổ vốn & tài sản</span>

        <div className="portfolio-allocation-bar-track">
          {cashPct > 0 && (
            <div
              className="portfolio-allocation-bar-segment is-cash"
              style={{ width: `${cashPct}%` }}
              title={`Tiền mặt: ${formatPercentVN(cashPct)}`}
            />
          )}
          {investedPct > 0 && (
            <div
              className="portfolio-allocation-bar-segment is-invested"
              style={{ width: `${investedPct}%` }}
              title={`Đang đầu tư: ${formatPercentVN(investedPct)}`}
            />
          )}
        </div>

        <div className="portfolio-allocation-summary-row">
          <div className="portfolio-allocation-metric">
            <span className="composition-dot is-cash" />
            <span>Tiền mặt: <strong>{view.cashWeightPct === null ? '—' : formatPercentVN(view.cashWeightPct)}</strong></span>
            {view.cashValue !== null && <small>({formatVNDReporting(view.cashValue)})</small>}
          </div>
          <div className="portfolio-allocation-metric">
            <span className="composition-dot is-invested" />
            <span>Đang đầu tư: <strong>{view.investedWeightPct === null ? '—' : formatPercentVN(view.investedWeightPct)}</strong></span>
            {view.investedMarketValue !== null && <small>({formatVNDReporting(view.investedMarketValue)})</small>}
          </div>
        </div>
      </div>

      {/* Concentration & Asset Class Breakdown */}
      <div className="portfolio-allocation-grid">
        {/* Concentration Card */}
        {(hasLargest || hasTop3) && (
          <div className="portfolio-subcard">
            <h4 className="portfolio-subcard-title">Mức độ tập trung</h4>
            <div className="portfolio-concentration-stats">
              {hasLargest && (
                <div className="portfolio-concentration-item">
                  <div className="portfolio-concentration-label">
                    <span>Tài sản lớn nhất</span>
                    {view.largestHolding.assetType && (
                      <span className="portfolio-type-pill">{formatAssetType(view.largestHolding.assetType)}</span>
                    )}
                  </div>
                  <div className="portfolio-concentration-value">
                    <strong>{view.largestHolding.symbol}</strong>
                    <span className="portfolio-highlight-pct">
                      {view.largestHolding.investedWeightPct !== null
                        ? formatPercentVN(view.largestHolding.investedWeightPct)
                        : formatPercentVN(view.largestHolding.weightPct)}
                    </span>
                  </div>
                  <small className="portfolio-subtext">
                    {formatVNDReporting(view.largestHolding.marketValue)} (trên tài sản đầu tư)
                  </small>
                </div>
              )}

              {hasTop3 && (
                <div className="portfolio-concentration-item">
                  <div className="portfolio-concentration-label">
                    <span>Top 3 tập trung</span>
                  </div>
                  <div className="portfolio-concentration-value">
                    <strong className="portfolio-highlight-pct">{formatPercentVN(view.top3Concentration)}</strong>
                  </div>
                  <small className="portfolio-subtext">
                    Tỷ trọng top 3 trên tài sản đang đầu tư (không bao gồm tiền mặt)
                  </small>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Asset Class Breakdown Card */}
        {view.assetTypeGroups.length > 0 && (
          <div className="portfolio-subcard">
            <h4 className="portfolio-subcard-title">Phân bổ theo loại tài sản</h4>
            <div className="portfolio-type-list">
              {view.assetTypeGroups.map((group) => {
                const weightClamped = group.weightPct !== null ? Math.min(100, Math.max(0, group.weightPct)) : 0;
                return (
                  <div key={group.assetType} className="portfolio-type-row">
                    <div className="portfolio-type-info">
                      <span className="portfolio-type-name">{formatAssetType(group.assetType)}</span>
                      <span className="portfolio-type-val">
                        {formatVNDReporting(group.marketValue)} · <strong>{formatPercentVN(group.weightPct)}</strong>
                      </span>
                    </div>
                    <div className="portfolio-mini-bar-track">
                      <div
                        className="portfolio-mini-bar-fill"
                        style={{ width: `${weightClamped}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </motion.section>
  );
}

export default PortfolioCompositionSection;
