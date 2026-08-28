import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { MagneticButton } from './MotionHelpers.jsx';

const ASSET_TYPE_LABELS = {
  stock: 'Cổ phiếu',
  etf: 'ETF',
  fund: 'Quỹ đầu tư',
  gold: 'Vàng',
  deposit: 'Tiền gửi',
  bank_deposit: 'Tiền gửi',
  bond: 'Trái phiếu'
};

function formatAssetType(type) {
  if (!type) return '';
  return ASSET_TYPE_LABELS[String(type).toLowerCase()] || type;
}

function formatVND(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return `${Number(value).toLocaleString('vi-VN')} ₫`;
}

function formatTransactionTime(isoString) {
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

export default function TransactionHistorySection({
  transactions = [],
  loading = false,
  refreshing = false,
  error = null,
  holdingsCount = 0,
  onOpenTransactionModal,
  onRetry,
  onRefresh
}) {
  const [filterType, setFilterType] = useState('ALL'); // 'ALL' | 'BUY' | 'SELL'

  const counts = useMemo(() => {
    let buy = 0;
    let sell = 0;
    if (Array.isArray(transactions)) {
      for (const t of transactions) {
        if (t.transactionType === 'BUY') buy++;
        else if (t.transactionType === 'SELL') sell++;
      }
    }
    return {
      all: transactions.length,
      buy,
      sell
    };
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    if (!Array.isArray(transactions)) return [];
    if (filterType === 'BUY') return transactions.filter((t) => t.transactionType === 'BUY');
    if (filterType === 'SELL') return transactions.filter((t) => t.transactionType === 'SELL');
    return transactions;
  }, [transactions, filterType]);

  const hasHoldings = holdingsCount > 0;
  const hasTransactions = transactions.length > 0;

  return (
    <motion.div variants={sectionItemVariants} className="fintech-card" style={{ overflow: 'hidden', marginTop: '1.5rem' }}>
      {/* Section Header */}
      <div
        style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border-subtle, #f1f5f9)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
              Lịch sử giao dịch
            </span>
            {hasTransactions && (
              <span className="fintech-badge badge-neutral" style={{ fontWeight: 700 }}>
                {transactions.length}
              </span>
            )}
          </div>
          <p style={{ margin: '3px 0 0 0', fontSize: '0.8rem', color: 'var(--color-slate-500)' }}>
            Lịch sử giao dịch đã ghi nhận không thể chỉnh sửa trong phiên bản hiện tại.
          </p>
        </div>

        {/* Header Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {onRefresh && (
            <MagneticButton
              onClick={onRefresh}
              disabled={refreshing || loading}
              className="fintech-btn btn-secondary btn-sm"
            >
              <span className={refreshing ? 'spin-icon' : ''}>{refreshing ? '⟳' : '↻'}</span>
              <span>{refreshing ? 'Đang tải...' : 'Làm mới'}</span>
            </MagneticButton>
          )}

          {onOpenTransactionModal && (
            <MagneticButton
              onClick={onOpenTransactionModal}
              className="fintech-btn btn-primary btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <span>+</span>
              <span>Ghi nhận giao dịch</span>
            </MagneticButton>
          )}
        </div>
      </div>

      {/* Filter Tabs (when there are transactions) */}
      {hasTransactions && (
        <div
          style={{
            padding: '0.75rem 1.5rem',
            borderBottom: '1px solid var(--border-subtle, #f1f5f9)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: 'var(--color-slate-50, #f8fafc)'
          }}
        >
          <button
            type="button"
            onClick={() => setFilterType('ALL')}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: '8px',
              border: 'none',
              fontSize: '0.82rem',
              fontWeight: filterType === 'ALL' ? 800 : 600,
              cursor: 'pointer',
              backgroundColor: filterType === 'ALL' ? 'var(--color-surface, #ffffff)' : 'transparent',
              color: filterType === 'ALL' ? 'var(--color-slate-900)' : 'var(--color-slate-500)',
              boxShadow: filterType === 'ALL' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            Tất cả ({counts.all})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('BUY')}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: '8px',
              border: 'none',
              fontSize: '0.82rem',
              fontWeight: filterType === 'BUY' ? 800 : 600,
              cursor: 'pointer',
              backgroundColor: filterType === 'BUY' ? 'var(--color-surface, #ffffff)' : 'transparent',
              color: filterType === 'BUY' ? 'var(--color-gain-600, #059669)' : 'var(--color-slate-500)',
              boxShadow: filterType === 'BUY' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            Mua ({counts.buy})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('SELL')}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: '8px',
              border: 'none',
              fontSize: '0.82rem',
              fontWeight: filterType === 'SELL' ? 800 : 600,
              cursor: 'pointer',
              backgroundColor: filterType === 'SELL' ? 'var(--color-surface, #ffffff)' : 'transparent',
              color: filterType === 'SELL' ? 'var(--color-loss-600, #dc2626)' : 'var(--color-slate-500)',
              boxShadow: filterType === 'SELL' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            Bán ({counts.sell})
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && !hasTransactions && (
        <div className="state-box" style={{ border: 'none', boxShadow: 'none' }}>
          <div className="state-icon spin-icon">⏳</div>
          <h3 className="state-title">Đang tải lịch sử giao dịch...</h3>
        </div>
      )}

      {/* Fatal Error State */}
      {error && !hasTransactions && (
        <div style={{ padding: '1.5rem' }}>
          <div className="fintech-banner banner-error">
            <div>
              <strong style={{ display: 'block', marginBottom: '0.2rem' }}>Không thể tải lịch sử giao dịch</strong>
              <span style={{ fontSize: '0.85rem' }}>{error}</span>
            </div>
            {onRetry && (
              <MagneticButton onClick={onRetry} className="fintech-btn btn-danger btn-sm">
                Thử lại
              </MagneticButton>
            )}
          </div>
        </div>
      )}

      {/* Non-fatal error banner when data already loaded */}
      {error && hasTransactions && (
        <div style={{ padding: '1rem 1.5rem 0' }}>
          <div className="fintech-banner banner-warning">
            <span>Không thể làm mới lịch sử giao dịch ({error}). Đang hiển thị kết quả gần nhất.</span>
          </div>
        </div>
      )}

      {/* Empty State: Opening Position Semantics (holdings exist but transaction history empty) */}
      {!loading && !error && !hasTransactions && hasHoldings && (
        <div className="state-box" style={{ border: 'none', boxShadow: 'none', padding: '2.5rem 1.5rem' }}>
          <div className="state-icon float-icon" style={{ fontSize: '2.5rem' }}>📜</div>
          <h3 className="state-title" style={{ fontSize: '1.05rem', color: 'var(--color-slate-800)' }}>
            Chưa có giao dịch nào được ghi nhận từ khi bật lịch sử giao dịch.
          </h3>
          <p className="state-desc" style={{ maxWidth: '520px' }}>
            Các tài sản hiện có trong danh mục được bảo lưu từ trước. Hãy ghi nhận giao dịch mua hoặc bán mới để bắt đầu theo dõi sổ lệnh chi tiết.
          </p>
        </div>
      )}

      {/* Empty State: Completely Empty (no holdings & no transactions) */}
      {!loading && !error && !hasTransactions && !hasHoldings && (
        <div className="state-box" style={{ border: 'none', boxShadow: 'none', padding: '2.5rem 1.5rem' }}>
          <div className="state-icon float-icon" style={{ fontSize: '2.5rem' }}>💼</div>
          <h3 className="state-title" style={{ fontSize: '1.05rem', color: 'var(--color-slate-800)' }}>
            Lịch sử giao dịch chưa có dữ liệu.
          </h3>
          <p className="state-desc" style={{ maxWidth: '480px' }}>
            Các giao dịch được ghi nhận từ thời điểm tính năng này được sử dụng.
          </p>
        </div>
      )}

      {/* Filter Empty State (has transactions overall, but current filter has 0) */}
      {!loading && !error && hasTransactions && filteredTransactions.length === 0 && (
        <div className="state-box" style={{ border: 'none', boxShadow: 'none', padding: '2rem 1.5rem' }}>
          <div className="state-icon">🔍</div>
          <h3 className="state-title" style={{ fontSize: '0.95rem' }}>
            Không có giao dịch {filterType === 'BUY' ? 'mua' : 'bán'} nào được ghi nhận.
          </h3>
          <button
            type="button"
            onClick={() => setFilterType('ALL')}
            className="fintech-btn btn-secondary btn-sm"
            style={{ marginTop: '0.75rem' }}
          >
            Xem tất cả giao dịch
          </button>
        </div>
      )}

      {/* Transaction List / Table */}
      {!loading && !error && filteredTransactions.length > 0 && (
        <div className="table-container">
          <table className="fintech-table">
            <thead>
              <tr>
                <th>Mã & Tài sản</th>
                <th style={{ textAlign: 'center' }}>Loại GD</th>
                <th style={{ textAlign: 'right' }}>Khối lượng & Giá</th>
                <th style={{ textAlign: 'right' }}>Tổng giá trị</th>
                <th style={{ textAlign: 'right' }}>Lãi/lỗ đã thực hiện</th>
                <th style={{ textAlign: 'right' }}>Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((tx) => {
                const isBuy = tx.transactionType === 'BUY';
                const totalValue = typeof tx.quantity === 'number' && typeof tx.price === 'number'
                  ? tx.quantity * tx.price
                  : null;

                const hasRealizedPnL = !isBuy && typeof tx.realizedPnL === 'number';
                const isGain = hasRealizedPnL && tx.realizedPnL > 0;
                const isLoss = hasRealizedPnL && tx.realizedPnL < 0;

                return (
                  <tr key={tx.id || `${tx.symbol}-${tx.executedAt}-${tx.quantity}`}>
                    {/* 1. Symbol & Asset Name */}
                    <td>
                      <div style={{ fontWeight: 800, color: 'var(--color-slate-900)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>{tx.symbol || 'N/A'}</span>
                        {tx.assetType && (
                          <span className="fintech-badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                            {formatAssetType(tx.assetType)}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                        {tx.assetName || 'Tài sản'}
                      </div>
                    </td>

                    {/* 2. Transaction Type */}
                    <td style={{ textAlign: 'center' }}>
                      <span
                        className={`fintech-badge ${isBuy ? 'badge-gain' : 'badge-loss'}`}
                        style={{
                          fontWeight: 700,
                          padding: '3px 8px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <span>{isBuy ? '📥' : '📤'}</span>
                        <span>{isBuy ? 'Mua' : 'Bán'}</span>
                      </span>
                    </td>

                    {/* 3. Quantity & Price */}
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, color: 'var(--color-slate-900)' }}>
                        {Number(tx.quantity).toLocaleString('vi-VN')} đơn vị
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                        × {Number(tx.price).toLocaleString('vi-VN')} ₫
                      </div>
                    </td>

                    {/* 4. Total Value */}
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-slate-800)' }}>
                      {formatVND(totalValue)}
                    </td>

                    {/* 5. Realized P/L for SELL */}
                    <td style={{ textAlign: 'right' }}>
                      {isBuy ? (
                        <span style={{ color: 'var(--color-slate-400)' }}>—</span>
                      ) : hasRealizedPnL ? (
                        <div>
                          <div
                            style={{
                              fontWeight: 800,
                              color: isGain ? 'var(--color-gain-600)' : isLoss ? 'var(--color-loss-600)' : 'var(--color-slate-900)'
                            }}
                          >
                            {isGain ? '+' : ''}{formatVND(tx.realizedPnL)}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--color-slate-400)', marginTop: '1px' }}>
                            Đã thực hiện
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--color-slate-400)', fontSize: '0.8rem' }}>—</span>
                      )}
                    </td>

                    {/* 6. Execution Time */}
                    <td style={{ textAlign: 'right', fontSize: '0.82rem', color: 'var(--color-slate-600)' }}>
                      {formatTransactionTime(tx.executedAt || tx.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}

