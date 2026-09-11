import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  buildPortfolioRecentActivity
} from '../utils/portfolioSnapshotDisplay.js';
import TransactionHistorySection from './TransactionHistorySection.jsx';
import CashManagementSection from './CashManagementSection.jsx';

const sectionItemVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } }
};

function eventBadgeClass(type) {
  switch (type) {
    case 'BUY':
      return 'is-buy';
    case 'SELL':
      return 'is-sell';
    case 'OPENING_POSITION':
      return 'is-opening';
    case 'DEPOSIT':
    case 'WITHDRAWAL':
    case 'OPENING_BALANCE':
      return 'is-cash';
    default:
      return 'is-neutral';
  }
}

export function PortfolioActivitySection({
  transactions = [],
  transactionsLoading = false,
  transactionsRefreshing = false,
  transactionsError = null,
  holdings = [],
  cashOverview = null,
  cashLedger = [],
  cashLedgerLoading = false,
  cashLedgerError = null,
  currentCashSnapshot = null,
  onOpenTransactionModal,
  onOpenDeposit,
  onOpenWithdraw,
  onRefresh,
  onRetryTransactions
}) {
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);

  const recentEvents = useMemo(() => {
    return buildPortfolioRecentActivity({
      transactions,
      holdings,
      cashLedger
    });
  }, [transactions, holdings, cashLedger]);

  const hasEvents = recentEvents.length > 0;
  const isFatalError = Boolean(transactionsError && !hasEvents);

  return (
    <motion.section
      variants={sectionItemVariants}
      className="portfolio-activity-card"
      aria-labelledby="portfolio-activity-title"
    >
      <div className="portfolio-activity-header">
        <div>
          <span className="portfolio-eyebrow">Hoạt động</span>
          <h3 id="portfolio-activity-title">Hoạt động gần đây</h3>
        </div>
        {transactionsRefreshing && (
          <span className="portfolio-refreshing-tag spin-icon" title="Đang đồng bộ...">⟳</span>
        )}
      </div>

      {/* CASE 6: Activity load error must NOT look like empty activity */}
      {isFatalError ? (
        <div className="portfolio-activity-error">
          <div>
            <strong>Không thể tải hoạt động gần đây</strong>
            <p>{transactionsError}</p>
          </div>
          {onRetryTransactions && (
            <button
              type="button"
              onClick={onRetryTransactions}
              className="fintech-btn btn-danger btn-sm"
            >
              Thử lại
            </button>
          )}
        </div>
      ) : transactionsLoading && !hasEvents ? (
        <div className="portfolio-activity-loading">
          <span className="spin-icon">⏳</span>
          <span>Đang tải hoạt động...</span>
        </div>
      ) : !hasEvents ? (
        /* CASE 1 & 2: Empty activity compact state */
        <div className="portfolio-activity-empty">
          <p>Chưa có hoạt động trong danh mục.</p>
        </div>
      ) : (
        /* Recent Activity List (MAX 5 items) */
        <div className="portfolio-activity-list">
          {recentEvents.map((item) => (
            <div key={item.id} className="portfolio-activity-row">
              <div className="portfolio-activity-left">
                <span className={`portfolio-activity-badge ${eventBadgeClass(item.type)}`}>
                  {item.action}
                </span>
                <div className="portfolio-activity-info">
                  <span className="portfolio-activity-symbol">{item.symbol}</span>
                  <span className="portfolio-activity-detail">{item.detail}</span>
                </div>
              </div>
              <div className="portfolio-activity-right">
                <time className="portfolio-activity-date">{item.formattedDate}</time>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full History Toggle */}
      <div className="portfolio-history-toggle-wrap">
        <button
          type="button"
          className="portfolio-history-toggle-btn"
          onClick={() => setIsHistoryExpanded((prev) => !prev)}
          aria-expanded={isHistoryExpanded}
        >
          <span>{isHistoryExpanded ? 'Thu gọn lịch sử' : 'Xem toàn bộ lịch sử'}</span>
          <span className="portfolio-toggle-arrow">{isHistoryExpanded ? '▲' : '▼'}</span>
        </button>
      </div>

      {/* Expanded Full Ledger History */}
      <AnimatePresence>
        {isHistoryExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
            className="portfolio-full-history-wrapper"
          >
            <TransactionHistorySection
              transactions={transactions}
              loading={transactionsLoading}
              refreshing={transactionsRefreshing}
              error={transactionsError}
              holdingsCount={holdings.length}
              onOpenTransactionModal={onOpenTransactionModal}
              onRetry={onRetryTransactions}
              onRefresh={onRefresh}
            />

            <CashManagementSection
              activityOnly
              cashOverview={cashOverview}
              currentCashSnapshot={currentCashSnapshot}
              currentCashLoading={transactionsLoading}
              cashOverviewLoading={false}
              cashOverviewError={null}
              cashLedger={cashLedger}
              cashLedgerLoading={cashLedgerLoading}
              cashLedgerError={cashLedgerError}
              onOpenDeposit={onOpenDeposit}
              onOpenWithdraw={onOpenWithdraw}
              onRefresh={onRefresh}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

export default PortfolioActivitySection;
