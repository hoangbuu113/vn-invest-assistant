import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api.js';

function formatVND(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return `${Number(value).toLocaleString('vi-VN')} ₫`;
}

function translateErrorMessage(msg, mode) {
  if (!msg) {
    return mode === 'DEPOSIT'
      ? 'Không thể ghi nhận nạp tiền.'
      : 'Không thể ghi nhận rút tiền.';
  }
  const lower = String(msg).toLowerCase();

  if (lower.includes('withdrawal amount exceeds current cash') || lower.includes('cl001')) {
    return 'Số tiền rút vượt quá số tiền mặt hiện có.';
  }
  if (lower.includes('amount must be a finite number greater than 0') || lower.includes('cl002')) {
    return 'Số tiền phải là số dương lớn hơn 0.';
  }
  if (lower.includes('cash ledger is not activated') || lower.includes('cl500')) {
    return 'Sổ lệnh tiền mặt chưa được kích hoạt hoặc hồ sơ không khả dụng.';
  }

  return msg;
}

export default function CashMovementModal({
  isOpen,
  onClose,
  mode = 'DEPOSIT', // 'DEPOSIT' | 'WITHDRAWAL'
  currentCash = null,
  onMovementSuccess
}) {
  const [amountInput, setAmountInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const isDeposit = mode === 'DEPOSIT';

  useEffect(() => {
    if (isOpen) {
      setAmountInput('');
      setErrorMsg(null);
      setSuccessMsg(null);
      setLoading(false);
    }
  }, [isOpen, mode]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (loading) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    const rawAmount = amountInput.trim();
    if (!rawAmount) {
      setErrorMsg(isDeposit ? 'Vui lòng nhập số tiền cần nạp.' : 'Vui lòng nhập số tiền cần rút.');
      return;
    }

    const numAmount = parseFloat(rawAmount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setErrorMsg('Số tiền phải là số dương lớn hơn 0.');
      return;
    }

    setLoading(true);

    const endpoint = isDeposit ? '/api/cash/deposit' : '/api/cash/withdraw';

    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ amount: numAmount })
      });

      const json = await res.json();

      if (!res.ok || json.status !== 'ok') {
        const backendMsg = json.details || json.message || `HTTP ${res.status}`;
        throw new Error(translateErrorMessage(backendMsg, mode));
      }

      const successText = isDeposit ? 'Đã ghi nhận tiền nạp.' : 'Đã ghi nhận tiền rút.';
      setSuccessMsg(successText);

      if (onMovementSuccess) {
        onMovementSuccess(json.data);
      }

      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      setErrorMsg(err.message || (isDeposit ? 'Lỗi khi nạp tiền.' : 'Lỗi khi rút tiền.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
        animation: 'fadeIn 0.2s ease-out'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          backgroundColor: 'var(--color-surface, #ffffff)',
          borderRadius: '18px',
          boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25), 0 0 0 1px rgba(226, 232, 240, 0.85)',
          overflow: 'hidden',
          animation: 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--color-slate-100, #f1f5f9)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--color-slate-50, #f8fafc)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                backgroundColor: isDeposit ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                color: isDeposit ? 'var(--color-gain-600, #059669)' : 'var(--color-loss-600, #dc2626)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.2rem',
                fontWeight: 800
              }}
            >
              {isDeposit ? '+' : '−'}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                {isDeposit ? 'Nạp tiền vào danh mục' : 'Rút tiền khỏi danh mục'}
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: 'var(--color-slate-500)' }}>
                {isDeposit
                  ? 'Ghi nhận dòng tiền nạp thêm vào danh mục đầu tư.'
                  : 'Ghi nhận dòng tiền rút ra khỏi danh mục đầu tư.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.25rem',
              color: 'var(--color-slate-400)',
              cursor: 'pointer',
              padding: '0.25rem 0.5rem',
              borderRadius: '6px'
            }}
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>
          {/* Current cash context for withdrawal */}
          {!isDeposit && (
            <div
              style={{
                padding: '0.75rem 1rem',
                backgroundColor: 'var(--color-slate-50, #f8fafc)',
                borderRadius: '10px',
                marginBottom: '1.25rem',
                border: '1px solid var(--color-slate-200, #e2e8f0)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span style={{ fontSize: '0.85rem', color: 'var(--color-slate-600)' }}>
                Tiền mặt hiện tại:
              </span>
              <strong style={{ fontSize: '0.95rem', color: 'var(--color-slate-900)' }}>
                {formatVND(currentCash)}
              </strong>
            </div>
          )}

          {/* Amount input */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-slate-700)', marginBottom: '0.4rem' }}>
              {isDeposit ? 'Số tiền nạp (₫)' : 'Số tiền rút (₫)'} <span style={{ color: 'var(--color-loss-600)' }}>*</span>
            </label>
            <input
              type="number"
              step="any"
              min="1"
              autoFocus
              placeholder={isDeposit ? 'Ví dụ: 10000000' : 'Ví dụ: 5000000'}
              value={amountInput}
              onChange={(e) => {
                setAmountInput(e.target.value);
                setErrorMsg(null);
              }}
              disabled={loading}
              style={{
                width: '100%',
                padding: '0.75rem 0.9rem',
                fontSize: '1rem',
                border: '1px solid var(--border-default, #cbd5e1)',
                borderRadius: '10px',
                outline: 'none',
                backgroundColor: 'var(--color-surface, #ffffff)',
                color: 'var(--color-slate-900)'
              }}
            />
            {Number(amountInput) > 0 && (
              <div style={{ marginTop: '0.35rem', fontSize: '0.82rem', color: 'var(--color-brand-600)', fontWeight: 600 }}>
                ≈ {formatVND(Number(amountInput))}
              </div>
            )}
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div
              style={{
                padding: '0.75rem 1rem',
                backgroundColor: 'var(--color-loss-50, #fef2f2)',
                borderRadius: '10px',
                border: '1px solid var(--color-loss-200, #fecaca)',
                color: 'var(--color-loss-700, #b91c1c)',
                fontSize: '0.85rem',
                marginBottom: '1.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <span>⚠️</span>
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Success Message */}
          {successMsg && (
            <div
              style={{
                padding: '0.75rem 1rem',
                backgroundColor: 'var(--color-gain-50, #ecfdf5)',
                borderRadius: '10px',
                border: '1px solid var(--color-gain-200, #a7f3d0)',
                color: 'var(--color-gain-700, #047857)',
                fontSize: '0.85rem',
                marginBottom: '1.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <span>✓</span>
              <span>{successMsg}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '1.5rem' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="fintech-btn btn-secondary btn-sm"
              style={{ padding: '0.6rem 1.15rem' }}
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="fintech-btn btn-primary btn-sm"
              style={{
                padding: '0.6rem 1.35rem',
                backgroundColor: isDeposit ? 'var(--color-brand-600, #2563eb)' : 'var(--color-slate-800, #1e293b)'
              }}
            >
              {loading ? 'Đang xử lý...' : isDeposit ? 'Xác nhận nạp tiền' : 'Xác nhận rút tiền'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
