import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TiltCard, MagneticButton, CountUp } from './MotionHelpers.jsx';

function formatVND(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return `${Number(value).toLocaleString('vi-VN')} ₫`;
}

function formatEffectiveTime(isoString) {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return String(isoString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  } catch {
    return String(isoString);
  }
}

const sectionItemVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } }
};

export default function CashManagementSection({
  cashOverview,
  currentCashSnapshot,
  currentCashLoading,
  cashOverviewLoading = false,
  cashOverviewError = null,
  cashLedger = [],
  cashLedgerLoading = false,
  cashLedgerError = null,
  onOpenDeposit,
  onOpenWithdraw,
  onRefresh,
  activityOnly = false
}) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [filterType, setFilterType] = useState('ALL'); // 'ALL' | 'MOVEMENT' | 'TRADE'

  const counts = useMemo(() => {
    let movement = 0;
    let trade = 0;
    if (Array.isArray(cashLedger)) {
      for (const entry of cashLedger) {
        if (entry.entryType === 'DEPOSIT' || entry.entryType === 'WITHDRAWAL') {
          movement++;
        } else if (entry.entryType === 'BUY' || entry.entryType === 'SELL') {
          trade++;
        }
      }
    }
    return {
      all: cashLedger.length,
      movement,
      trade
    };
  }, [cashLedger]);

  const filteredLedger = useMemo(() => {
    if (!Array.isArray(cashLedger)) return [];
    if (filterType === 'MOVEMENT') {
      return cashLedger.filter(
        (e) => e.entryType === 'DEPOSIT' || e.entryType === 'WITHDRAWAL'
      );
    }
    if (filterType === 'TRADE') {
      return cashLedger.filter((e) => e.entryType === 'BUY' || e.entryType === 'SELL');
    }
    return cashLedger;
  }, [cashLedger, filterType]);

  const hasSnapshotAuthority = currentCashSnapshot !== undefined;
  const currentCash = hasSnapshotAuthority
    ? currentCashSnapshot?.status === 'AVAILABLE'
      && typeof currentCashSnapshot?.value === 'number'
      && Number.isFinite(currentCashSnapshot.value)
      ? currentCashSnapshot.value
      : null
    : typeof cashOverview?.currentCash === 'number'
      && Number.isFinite(cashOverview.currentCash)
      ? cashOverview.currentCash
      : null;
  const isCurrentCashLoading = typeof currentCashLoading === 'boolean'
    ? currentCashLoading
    : cashOverviewLoading;

  return (
    <motion.div
      variants={sectionItemVariants}
      className={`fintech-card${activityOnly ? ' cash-management-activity' : ''}`}
      style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}
    >
      {activityOnly && (
        <div className="cash-activity-heading">
          <div>
            <strong>Dòng tiền</strong>
            <span>Nạp, rút và dòng tiền giao dịch đã ghi nhận</span>
          </div>
          <button
            type="button"
            onClick={() => setIsDetailsOpen((prev) => !prev)}
            className="fintech-btn btn-secondary btn-sm"
          >
            {isDetailsOpen ? 'Thu gọn' : 'Xem dòng tiền'}
          </button>
        </div>
      )}
      {/* Primary Cash Summary & Actions Bar */}
      <div
        className="cash-primary-summary"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              color: 'var(--color-brand-600, #2563eb)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.4rem'
            }}
          >
            💵
          </div>
          <div>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-slate-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Tiền sẵn sàng đầu tư
            </span>
            <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--color-slate-900)', marginTop: '2px' }}>
              {isCurrentCashLoading ? (
                <span style={{ fontSize: '1.1rem', color: 'var(--color-slate-400)' }}>Đang tải...</span>
              ) : currentCash !== null ? (
                <CountUp value={currentCash} suffix=" ₫" />
              ) : (
                <span style={{ fontSize: '1rem', color: 'var(--color-slate-500)' }}>Chưa khả dụng</span>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <MagneticButton
            onClick={onOpenDeposit}
            className="fintech-btn btn-primary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
          >
            <span>+</span>
            <span>Nạp tiền</span>
          </MagneticButton>

          <MagneticButton
            onClick={onOpenWithdraw}
            className="fintech-btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
          >
            <span>−</span>
            <span>Rút tiền</span>
          </MagneticButton>

          <button
            type="button"
            onClick={() => setIsDetailsOpen((prev) => !prev)}
            style={{
              padding: '0.5rem 0.85rem',
              border: '1px solid var(--border-default, #cbd5e1)',
              borderRadius: '8px',
              backgroundColor: isDetailsOpen ? 'var(--color-slate-100, #f1f5f9)' : 'var(--color-surface, #ffffff)',
              color: 'var(--color-slate-700, #334155)',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
          >
            <span>{isDetailsOpen ? 'Ẩn lịch sử dòng tiền' : 'Xem lịch sử dòng tiền'}</span>
            <span style={{ fontSize: '0.7rem' }}>{isDetailsOpen ? '▲' : '▼'}</span>
          </button>
        </div>
      </div>

      {/* Non-fatal Error Banners */}
      {cashOverviewError && (
        <div className="fintech-banner banner-warning" style={{ marginTop: '1rem', marginBottom: 0 }}>
          <span>Không thể làm mới tổng quan tiền mặt ({cashOverviewError}).</span>
        </div>
      )}

      {/* Expandable Breakdown & Cash Ledger */}
      <AnimatePresence>
        {isDetailsOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden', paddingTop: '1.25rem', marginTop: '1.25rem', borderTop: '1px solid var(--border-subtle, #f1f5f9)' }}
          >
            {/* Cash Breakdown Metrics Grid */}
            {cashOverview && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '10px',
                  marginBottom: '1.5rem'
                }}
              >
                {/* 1. Opening Balance */}
                <div style={{ padding: '0.85rem 1rem', backgroundColor: 'var(--color-slate-50, #f8fafc)', borderRadius: '10px', border: '1px solid var(--color-slate-200, #e2e8f0)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-slate-500)' }}>
                    Số dư khởi điểm
                  </div>
                  <div style={{ fontSize: '0.98rem', fontWeight: 800, color: 'var(--color-slate-900)', marginTop: '3px' }}>
                    {formatVND(cashOverview.openingBalance)}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-slate-400)', marginTop: '2px' }}>
                    Số dư khởi điểm khi bắt đầu theo dõi dòng tiền
                  </div>
                </div>

                {/* 2. Total Deposits */}
                <div style={{ padding: '0.85rem 1rem', backgroundColor: 'var(--color-slate-50, #f8fafc)', borderRadius: '10px', border: '1px solid var(--color-slate-200, #e2e8f0)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-slate-500)' }}>
                    Tổng tiền đã nạp
                  </div>
                  <div
                    style={{
                      fontSize: '0.98rem',
                      fontWeight: 800,
                      color: cashOverview.totalDeposits > 0 ? 'var(--color-gain-600, #059669)' : 'var(--color-slate-900)',
                      marginTop: '3px'
                    }}
                  >
                    {cashOverview.totalDeposits > 0 ? `+${formatVND(cashOverview.totalDeposits)}` : '0 ₫'}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-slate-400)', marginTop: '2px' }}>
                    Tiền nạp vào tài khoản
                  </div>
                </div>

                {/* 3. Total Withdrawals */}
                <div style={{ padding: '0.85rem 1rem', backgroundColor: 'var(--color-slate-50, #f8fafc)', borderRadius: '10px', border: '1px solid var(--color-slate-200, #e2e8f0)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-slate-500)' }}>
                    Tổng tiền đã rút
                  </div>
                  <div
                    style={{
                      fontSize: '0.98rem',
                      fontWeight: 800,
                      color: cashOverview.totalWithdrawals > 0 ? 'var(--color-loss-600, #dc2626)' : 'var(--color-slate-900)',
                      marginTop: '3px'
                    }}
                  >
                    {cashOverview.totalWithdrawals > 0 ? `−${formatVND(cashOverview.totalWithdrawals)}` : '0 ₫'}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-slate-400)', marginTop: '2px' }}>
                    Tiền rút ra khỏi tài khoản
                  </div>
                </div>

                {/* 4. BUY Outflows */}
                <div style={{ padding: '0.85rem 1rem', backgroundColor: 'var(--color-slate-50, #f8fafc)', borderRadius: '10px', border: '1px solid var(--color-slate-200, #e2e8f0)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-slate-500)' }}>
                    Dòng tiền mua tài sản
                  </div>
                  <div
                    style={{
                      fontSize: '0.98rem',
                      fontWeight: 800,
                      color: cashOverview.buyOutflows > 0 ? 'var(--color-slate-800)' : 'var(--color-slate-900)',
                      marginTop: '3px'
                    }}
                  >
                    {cashOverview.buyOutflows > 0 ? `−${formatVND(cashOverview.buyOutflows)}` : '0 ₫'}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-slate-400)', marginTop: '2px' }}>
                    Chi trả mua danh mục
                  </div>
                </div>

                {/* 5. SELL Inflows */}
                <div style={{ padding: '0.85rem 1rem', backgroundColor: 'var(--color-slate-50, #f8fafc)', borderRadius: '10px', border: '1px solid var(--color-slate-200, #e2e8f0)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-slate-500)' }}>
                    Dòng tiền bán tài sản
                  </div>
                  <div
                    style={{
                      fontSize: '0.98rem',
                      fontWeight: 800,
                      color: cashOverview.sellInflows > 0 ? 'var(--color-gain-600, #059669)' : 'var(--color-slate-900)',
                      marginTop: '3px'
                    }}
                  >
                    {cashOverview.sellInflows > 0 ? `+${formatVND(cashOverview.sellInflows)}` : '0 ₫'}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-slate-400)', marginTop: '2px' }}>
                    Thu hồi từ bán tài sản
                  </div>
                </div>
              </div>
            )}

            {/* Cash Ledger Section Header & Filter */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
                marginBottom: '0.75rem'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                    Lịch sử dòng tiền
                  </span>
                  <span className="fintech-badge badge-neutral" style={{ fontSize: '0.72rem', fontWeight: 700 }}>
                    {cashLedger.length}
                  </span>
                </div>
                <span style={{ fontSize: '0.76rem', color: 'var(--color-slate-500)' }}>
                  Lịch sử dòng tiền đã ghi nhận không thể chỉnh sửa trong phiên bản hiện tại.
                </span>
              </div>

              {/* Filter Tabs */}
              {cashLedger.length > 0 && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setFilterType('ALL')}
                    style={{
                      padding: '0.3rem 0.65rem',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '0.78rem',
                      fontWeight: filterType === 'ALL' ? 800 : 600,
                      cursor: 'pointer',
                      backgroundColor: filterType === 'ALL' ? 'var(--color-slate-200, #e2e8f0)' : 'transparent',
                      color: 'var(--color-slate-800)'
                    }}
                  >
                    Tất cả ({counts.all})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterType('MOVEMENT')}
                    style={{
                      padding: '0.3rem 0.65rem',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '0.78rem',
                      fontWeight: filterType === 'MOVEMENT' ? 800 : 600,
                      cursor: 'pointer',
                      backgroundColor: filterType === 'MOVEMENT' ? 'var(--color-slate-200, #e2e8f0)' : 'transparent',
                      color: 'var(--color-slate-800)'
                    }}
                  >
                    Nạp/Rút ({counts.movement})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterType('TRADE')}
                    style={{
                      padding: '0.3rem 0.65rem',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '0.78rem',
                      fontWeight: filterType === 'TRADE' ? 800 : 600,
                      cursor: 'pointer',
                      backgroundColor: filterType === 'TRADE' ? 'var(--color-slate-200, #e2e8f0)' : 'transparent',
                      color: 'var(--color-slate-800)'
                    }}
                  >
                    Mua/Bán ({counts.trade})
                  </button>
                </div>
              )}
            </div>

            {/* Loading / Error States for Ledger */}
            {cashLedgerLoading && cashLedger.length === 0 && (
              <div className="state-box" style={{ border: 'none', boxShadow: 'none', padding: '1.5rem' }}>
                <div className="state-icon spin-icon">⏳</div>
                <h3 className="state-title" style={{ fontSize: '0.9rem' }}>Đang tải lịch sử dòng tiền...</h3>
              </div>
            )}

            {cashLedgerError && cashLedger.length === 0 && (
              <div className="fintech-banner banner-error" style={{ marginBottom: '1rem' }}>
                <span>Không thể tải lịch sử dòng tiền ({cashLedgerError}).</span>
              </div>
            )}

            {/* Empty State */}
            {!cashLedgerLoading && !cashLedgerError && cashLedger.length === 0 && (
              <div className="state-box" style={{ border: 'none', boxShadow: 'none', padding: '1.5rem' }}>
                <div className="state-icon">💼</div>
                <h3 className="state-title" style={{ fontSize: '0.95rem' }}>Chưa có dữ liệu dòng tiền.</h3>
              </div>
            )}

            {/* Filter Empty State */}
            {!cashLedgerLoading && cashLedger.length > 0 && filteredLedger.length === 0 && (
              <div className="state-box" style={{ border: 'none', boxShadow: 'none', padding: '1.25rem' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-slate-500)' }}>
                  Không có mục dòng tiền nào phù hợp với bộ lọc.
                </span>
              </div>
            )}

            {/* Cash Ledger Table */}
            {!cashLedgerLoading && filteredLedger.length > 0 && (
              <div className="table-container" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                <table className="fintech-table" style={{ fontSize: '0.85rem' }}>
                  <thead>
                    <tr>
                      <th>Hoạt động</th>
                      <th>Mã tài sản</th>
                      <th style={{ textAlign: 'right' }}>Dòng tiền</th>
                      <th style={{ textAlign: 'right' }}>Thời gian ghi nhận</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLedger.map((entry) => {
                      const isDeposit = entry.entryType === 'DEPOSIT';
                      const isWithdraw = entry.entryType === 'WITHDRAWAL';
                      const isBuy = entry.entryType === 'BUY';
                      const isSell = entry.entryType === 'SELL';
                      const isOpening = entry.entryType === 'OPENING_BALANCE';

                      let badgeText = 'Khác';
                      let badgeClass = 'badge-neutral';
                      let sign = '';
                      let amountColor = 'var(--color-slate-900)';
                      const numAmount = Number(entry.amount);

                      if (isOpening || numAmount === 0) {
                        badgeText = 'Số dư khởi điểm';
                        badgeClass = 'badge-neutral';
                        sign = '';
                        amountColor = 'var(--color-slate-900)';
                      } else if (isDeposit) {
                        badgeText = '+ Nạp tiền';
                        badgeClass = 'badge-gain';
                        sign = '+';
                        amountColor = 'var(--color-gain-600)';
                      } else if (isWithdraw) {
                        badgeText = '− Rút tiền';
                        badgeClass = 'badge-loss';
                        sign = '−';
                        amountColor = 'var(--color-loss-600)';
                      } else if (isBuy) {
                        badgeText = 'Mua tài sản';
                        badgeClass = 'badge-neutral';
                        sign = '−';
                        amountColor = 'var(--color-slate-800)';
                      } else if (isSell) {
                        badgeText = 'Bán tài sản';
                        badgeClass = 'badge-gain';
                        sign = '+';
                        amountColor = 'var(--color-gain-600)';
                      }

                      return (
                        <tr key={entry.id || `${entry.entryType}-${entry.effectiveAt}-${entry.amount}`}>
                          {/* 1. Entry Type */}
                          <td>
                            <span className={`fintech-badge ${badgeClass}`} style={{ fontWeight: 700, padding: '2px 7px', fontSize: '0.72rem' }}>
                              {badgeText}
                            </span>
                            {isOpening && (
                              <div style={{ fontSize: '0.7rem', color: 'var(--color-slate-400)', marginTop: '2px' }}>
                                Số dư khởi điểm khi bắt đầu theo dõi dòng tiền
                              </div>
                            )}
                          </td>

                          {/* 2. Linked Asset Symbol */}
                          <td>
                            {entry.symbol ? (
                              <strong style={{ color: 'var(--color-slate-900)' }}>{entry.symbol}</strong>
                            ) : (
                              <span style={{ color: 'var(--color-slate-400)' }}>—</span>
                            )}
                          </td>

                          {/* 3. Cash Flow Amount */}
                          <td style={{ textAlign: 'right', fontWeight: 800, color: amountColor }}>
                            {numAmount === 0 ? '0 ₫' : `${sign}${formatVND(entry.amount)}`}
                          </td>

                          {/* 4. Effective Time */}
                          <td style={{ textAlign: 'right', color: 'var(--color-slate-600)', fontSize: '0.8rem' }}>
                            {formatEffectiveTime(entry.effectiveAt || entry.createdAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
