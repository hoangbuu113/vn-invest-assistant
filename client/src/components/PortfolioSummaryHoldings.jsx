import React from 'react';
import { motion } from 'framer-motion';
import {
  formatAssetType,
  formatNativeAmount,
  formatPercentVN,
  formatPublishedTime,
  formatVNDReporting
} from '../utils/formatting.js';
import {
  buildPortfolioHoldingsDisplay,
  buildPortfolioSummaryDisplay
} from '../utils/portfolioSnapshotDisplay.js';

const sectionItemVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } }
};

function StateBadge({ tone, children }) {
  return <span className={`portfolio-state-badge is-${tone}`}>{children}</span>;
}

function ValueOrUnavailable({ value, formatter = formatVNDReporting, className = '' }) {
  return (
    <span className={className}>
      {value === null ? '—' : formatter(value)}
    </span>
  );
}

function formatQuantity(value, unit, symbol, assetType) {
  if (value === null) return '—';
  const formatted = value.toLocaleString('vi-VN', { maximumFractionDigits: 8 });
  if (assetType === 'crypto' && symbol) return `${formatted} ${symbol}`;
  const unitLabels = { share: 'cp', coin: 'coin', oz: 'oz', unit: 'đơn vị' };
  return `${formatted}${unit ? ` ${unitLabels[unit] || unit}` : ''}`;
}

function formatMoneyValue(value) {
  if (!value) return '—';
  return value.currency === 'VND'
    ? formatVNDReporting(value.value)
    : formatNativeAmount(value.value, value.currency);
}

function pnlClass(value) {
  if (!value || value.value === 0) return 'is-neutral';
  return value.value > 0 ? 'is-gain' : 'is-loss';
}

function PortfolioActions({ onRecordTransaction, onDeclarePosition, onOpenDeposit, onOpenWithdraw }) {
  return (
    <div className="portfolio-summary-actions">
      <button type="button" className="fintech-btn btn-primary btn-sm" onClick={onRecordTransaction}>
        Ghi giao dịch
      </button>
      <button type="button" className="fintech-btn btn-secondary btn-sm" onClick={onDeclarePosition}>
        Khai báo tài sản đang có
      </button>
      <details className="portfolio-cash-menu">
        <summary>Quản lý tiền mặt</summary>
        <div className="portfolio-cash-menu-actions">
          <button type="button" onClick={onOpenDeposit}>Nạp tiền</button>
          <button type="button" onClick={onOpenWithdraw}>Rút tiền</button>
        </div>
      </details>
    </div>
  );
}

function Summary({ snapshot, actions }) {
  const view = buildPortfolioSummaryDisplay(snapshot);
  const hasPnl = view.unrealizedPnl !== null || view.isPnlPartial;

  return (
    <motion.section variants={sectionItemVariants} className="portfolio-summary-card" aria-labelledby="portfolio-summary-title">
      <div className="portfolio-summary-heading">
        <div>
          <span className="portfolio-eyebrow">Tổng quan hiện tại</span>
          <h3 id="portfolio-summary-title">{view.totalLabel}</h3>
        </div>
        <div className="portfolio-summary-freshness">
          <StateBadge tone={view.stateTone}>{view.stateLabel}</StateBadge>
          {view.valuationAsOf && <span>Cập nhật {formatPublishedTime(view.valuationAsOf)}</span>}
        </div>
      </div>

      <ValueOrUnavailable value={view.total} className="portfolio-total-value" />

      <div className={`portfolio-summary-metrics${hasPnl ? '' : ' without-pnl'}`}>
        <div>
          <span>Tiền mặt</span>
          <ValueOrUnavailable value={view.cash} />
        </div>
        <div>
          <span>{view.isCashOnly ? 'Đang đầu tư' : 'Giá trị tài sản đang nắm giữ'}</span>
          <ValueOrUnavailable value={view.invested} />
        </div>
        {hasPnl && (
          <div>
            {view.unrealizedPnl !== null ? (
              <>
                <span>Lãi/lỗ chưa thực hiện</span>
                <strong className={view.unrealizedPnl > 0 ? 'is-gain' : view.unrealizedPnl < 0 ? 'is-loss' : ''}>
                  {view.unrealizedPnl > 0 ? '+' : ''}{formatVNDReporting(view.unrealizedPnl)}
                  {view.unrealizedPnlPercent !== null && (
                    <small>{formatPercentVN(view.unrealizedPnlPercent)}</small>
                  )}
                </strong>
              </>
            ) : view.isPnlPartial ? (
              <div className="portfolio-partial-pnl-cell">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  Lãi/lỗ chưa thực hiện
                  <span
                    className="portfolio-info-hint"
                    title={view.pnlExplanation}
                    aria-label={view.pnlExplanation}
                    style={{ cursor: 'help', fontSize: '0.75rem', opacity: 0.8 }}
                  >
                    ℹ️
                  </span>
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '2px' }}>
                  <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-slate-500)' }}>—</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-amber-600, #d97706)', fontWeight: 500 }}>
                    Chưa thể tổng hợp toàn bộ sang VND
                  </span>
                  {view.knownUnrealizedPnl !== null && (
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-600)' }}>
                      Phần có cơ sở VND: <strong className={view.knownUnrealizedPnl > 0 ? 'is-gain' : view.knownUnrealizedPnl < 0 ? 'is-loss' : ''}>
                        {view.knownUnrealizedPnl > 0 ? '+' : ''}{formatVNDReporting(view.knownUnrealizedPnl)}
                      </strong>
                    </span>
                  )}
                  {view.nativePnlSummaries?.USDT && (
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-600)' }}>
                      Lãi/lỗ Crypto: <strong className={view.nativePnlSummaries.USDT.value > 0 ? 'is-gain' : view.nativePnlSummaries.USDT.value < 0 ? 'is-loss' : ''}>
                        {view.nativePnlSummaries.USDT.value > 0 ? '+' : ''}{formatNativeAmount(view.nativePnlSummaries.USDT.value, 'USDT')}
                      </strong>
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <PortfolioActions {...actions} />
    </motion.section>
  );
}

function HoldingState({ holding }) {
  return (
    <div className="portfolio-holding-state">
      <StateBadge tone={holding.stateTone}>{holding.stateLabel}</StateBadge>
      {holding.priceAsOf && <time dateTime={holding.priceAsOf}>{formatPublishedTime(holding.priceAsOf)}</time>}
    </div>
  );
}

function HoldingPnl({ holding }) {
  if (!holding.unrealizedPnl) return <span className="portfolio-unavailable">—</span>;
  return (
    <div className={`portfolio-holding-pnl ${pnlClass(holding.unrealizedPnl)}`}>
      <strong>
        {holding.unrealizedPnl.value > 0 ? '+' : ''}{formatMoneyValue(holding.unrealizedPnl)}
      </strong>
      {holding.unrealizedPnl.percent !== null && <span>{formatPercentVN(holding.unrealizedPnl.percent)}</span>}
    </div>
  );
}

function HoldingsDesktop({ holdings }) {
  return (
    <div className="portfolio-holdings-desktop">
      <table>
        <thead>
          <tr>
            <th>Tài sản</th>
            <th>Số lượng</th>
            <th>Giá / Giá vốn</th>
            <th>Giá trị hiện tại</th>
            <th>Lãi/lỗ</th>
            <th>Tỷ trọng</th>
            <th>Dữ liệu</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => (
            <tr key={holding.id}>
              <td>
                <div className="portfolio-asset-name">
                  <strong>{holding.symbol}</strong>
                  <span>{holding.name}</span>
                  <small>{formatAssetType(holding.assetType)}{holding.exchange ? ` · ${holding.exchange}` : ''}</small>
                </div>
              </td>
              <td>{formatQuantity(holding.quantity, holding.quantityUnit, holding.symbol, holding.assetType)}</td>
              <td>
                <div className="portfolio-price-stack">
                  <span><small>Hiện tại</small>{formatMoneyValue(holding.currentPrice)}</span>
                  <span><small>Giá mua TB</small>{formatMoneyValue(holding.averageCost)}</span>
                </div>
              </td>
              <td>
                {holding.marketValueVnd !== null ? (
                  <strong>{holding.isApproximateVnd ? '≈ ' : ''}{formatVNDReporting(holding.marketValueVnd)}</strong>
                ) : holding.hasNativeMarketValue ? (
                  <div className="portfolio-native-market-value">
                    <strong>≈ {formatNativeAmount(holding.nativeMarketValue, holding.nativeMarketCurrency)}</strong>
                    <small style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-slate-500)', fontWeight: 400 }}>VND chưa khả dụng</small>
                  </div>
                ) : (
                  <strong>—</strong>
                )}
              </td>
              <td><HoldingPnl holding={holding} /></td>
              <td>{holding.weightPct === null ? '—' : formatPercentVN(holding.weightPct, false)}</td>
              <td><HoldingState holding={holding} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HoldingsMobile({ holdings }) {
  return (
    <div className="portfolio-holdings-mobile">
      {holdings.map((holding) => (
        <details className="portfolio-holding-card" key={holding.id}>
          <summary>
            <span className="portfolio-holding-card-identity">
              <strong>{holding.symbol}</strong>
              <small>{formatAssetType(holding.assetType)}</small>
            </span>
            <span className="portfolio-holding-card-value">
              {holding.marketValueVnd !== null ? (
                <strong>{holding.isApproximateVnd ? '≈ ' : ''}{formatVNDReporting(holding.marketValueVnd)}</strong>
              ) : holding.hasNativeMarketValue ? (
                <div style={{ textAlign: 'right' }}>
                  <strong>≈ {formatNativeAmount(holding.nativeMarketValue, holding.nativeMarketCurrency)}</strong>
                  <small style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-slate-500)', fontWeight: 400 }}>VND chưa khả dụng</small>
                </div>
              ) : (
                <strong>—</strong>
              )}
              <StateBadge tone={holding.stateTone}>{holding.stateLabel}</StateBadge>
            </span>
          </summary>
          <div className="portfolio-holding-card-details">
            <div><span>Tên tài sản</span><strong>{holding.name}</strong></div>
            <div><span>Số lượng</span><strong>{formatQuantity(holding.quantity, holding.quantityUnit, holding.symbol, holding.assetType)}</strong></div>
            <div><span>Giá hiện tại</span><strong>{formatMoneyValue(holding.currentPrice)}</strong></div>
            <div><span>Giá mua TB</span><strong>{formatMoneyValue(holding.averageCost)}</strong></div>
            <div><span>Lãi/lỗ</span><HoldingPnl holding={holding} /></div>
            <div><span>Tỷ trọng</span><strong>{holding.weightPct === null ? '—' : formatPercentVN(holding.weightPct, false)}</strong></div>
            <div className="portfolio-holding-card-time"><span>Cập nhật giá</span><HoldingState holding={holding} /></div>
          </div>
        </details>
      ))}
    </div>
  );
}

function Holdings({ snapshot, actions }) {
  const summary = buildPortfolioSummaryDisplay(snapshot);
  const holdings = buildPortfolioHoldingsDisplay(snapshot);

  return (
    <motion.section variants={sectionItemVariants} className="portfolio-holdings-section" aria-labelledby="portfolio-holdings-title">
      <div className="portfolio-holdings-heading">
        <div>
          <span className="portfolio-eyebrow">Tài sản đang nắm giữ</span>
          <h3 id="portfolio-holdings-title">Danh mục hiện tại <small>({holdings.length})</small></h3>
        </div>
        {holdings.length > 0 && (
          <div className="portfolio-holdings-actions">
            <button type="button" className="fintech-btn btn-primary btn-sm" onClick={actions.onRecordTransaction}>Ghi giao dịch</button>
            <button type="button" className="fintech-btn btn-secondary btn-sm" onClick={actions.onDeclarePosition}>Khai báo tài sản</button>
          </div>
        )}
      </div>

      {holdings.length === 0 ? (
        <div className="portfolio-holdings-empty">
          <div className="portfolio-holdings-empty-icon" aria-hidden="true">◇</div>
          <div>
            <h4>
              {summary.cash === 0
                ? 'Chưa có tài sản trong danh mục.'
                : summary.cash !== null
                  ? 'Hiện danh mục đang giữ tiền mặt.'
                  : 'Chưa có tài sản trong danh mục.'}
            </h4>
            <p>
              {summary.cash === 0
                ? 'Bắt đầu bằng cách ghi nhận giao dịch mới hoặc khai báo tài sản bạn đang có.'
                : summary.cash !== null
                  ? `Bạn có ${formatVNDReporting(summary.cash)} tiền mặt.`
                  : 'Số dư tiền mặt hiện chưa khả dụng.'}
            </p>
          </div>
          <div className="portfolio-empty-actions">
            <button type="button" className="fintech-btn btn-primary btn-sm" onClick={actions.onRecordTransaction}>Ghi giao dịch</button>
            <button type="button" className="fintech-btn btn-secondary btn-sm" onClick={actions.onDeclarePosition}>Khai báo tài sản đang có</button>
          </div>
        </div>
      ) : (
        <>
          <HoldingsDesktop holdings={holdings} />
          <HoldingsMobile holdings={holdings} />
        </>
      )}
    </motion.section>
  );
}

export function PortfolioSummaryHoldings({ snapshot, ...actions }) {
  return (
    <div className="portfolio-current-state">
      <Summary snapshot={snapshot} actions={actions} />
      <Holdings snapshot={snapshot} actions={actions} />
    </div>
  );
}

export default PortfolioSummaryHoldings;
