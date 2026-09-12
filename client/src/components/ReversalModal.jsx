import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../utils/api.js';

function getClientUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'idemp-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

function formatVND(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return `${Number(value).toLocaleString('vi-VN')} ₫`;
}

function translateReversalError(msg) {
  if (!msg) return 'Không thể thực hiện hoàn tác.';
  const lower = String(msg).toLowerCase();

  if (lower.includes('rc001') || lower.includes('already been reversed') || lower.includes('already reversed')) {
    return 'Giao dịch hoặc dòng tiền này đã được hoàn tác trước đó.';
  }
  if (lower.includes('rc002') || lower.includes('subsequent transactions depend on it') || lower.includes('later transactions exist')) {
    return 'Không thể hoàn tác do đã có các giao dịch phát sinh sau đó ảnh hưởng đến vị thế này. Vui lòng hoàn tác theo thứ tự thời gian ngược lại (LIFO).';
  }
  if (lower.includes('current holding quantity is less than bought quantity')) {
    return 'Khối lượng tài sản đang nắm giữ hiện tại không đủ để hoàn tác lệnh mua.';
  }
  if (lower.includes('rc003') || lower.includes('trade cash') || lower.includes('trade-linked')) {
    return 'Dòng tiền mua/bán tự động không thể hoàn tác trực tiếp. Hãy hoàn tác chính giao dịch mua/bán tương ứng.';
  }
  if (lower.includes('rc004') || lower.includes('cannot reverse a reversal')) {
    return 'Không thể hoàn tác một bản ghi hoàn tác.';
  }
  if (lower.includes('cl001') || lower.includes('exceeds available cash') || lower.includes('withdrawal amount exceeds current cash')) {
    return 'Số dư tiền mặt hiện tại không đủ để hoàn lại số tiền giao dịch.';
  }
  if (lower.includes('ic001') || lower.includes('idempotency key reused')) {
    return 'Xung đột khóa lặp lại với dữ liệu khác nhau. Vui lòng thử lại.';
  }
  if (lower.includes('reason is required')) {
    return 'Vui lòng nhập lý do hoàn tác.';
  }

  return msg;
}

export default function ReversalModal({
  isOpen,
  onClose,
  target = null, // { type: 'TRANSACTION' | 'CASH', item: object, title: string, subtitle: string }
  onSuccess
}) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const idempotencyKeyRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      idempotencyKeyRef.current = getClientUUID();
      setReason('');
      setErrorMsg(null);
      setSuccessMsg(null);
      setLoading(false);
    }
  }, [isOpen, target]);

  if (!isOpen || !target) return null;

  const isTransaction = target.type === 'TRANSACTION';
  const item = target.item || {};

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (loading) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setErrorMsg('Vui lòng nhập lý do hoàn tác (bắt buộc).');
      return;
    }

    setLoading(true);

    const endpoint = isTransaction
      ? `/api/transactions/${item.id}/reversal`
      : `/api/cash/ledger/${item.id}/reversal`;

    const idempotencyKey = idempotencyKeyRef.current || (idempotencyKeyRef.current = getClientUUID());

    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          reason: trimmedReason,
          idempotencyKey
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Mã lỗi: ${res.status}`);
      }

      const resData = await res.json().catch(() => ({}));
      const isReplayed = res.headers.get('Idempotent-Replayed') === 'true' || resData?.data?.replayed;

      setSuccessMsg(
        isReplayed
          ? 'Yêu cầu hoàn tác đã được xử lý trước đó (kết quả gửi lại).'
          : 'Hoàn tác thành công! Bản ghi bù trừ đã được lưu vào sổ cái.'
      );

      setTimeout(() => {
        if (onSuccess) onSuccess();
        onClose();
      }, 1200);
    } catch (err) {
      setErrorMsg(translateReversalError(err.message));
      // Refresh idempotency key on failure so user can retry safely
      idempotencyKeyRef.current = getClientUUID();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        className="fintech-card modal-content"
        style={{
          maxWidth: '520px',
          width: '100%',
          padding: '1.75rem',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
        }}
      >
        {/* Modal Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
              Xác nhận hoàn tác
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--color-slate-500)' }}>
              {target.title || (isTransaction ? 'Hoàn tác giao dịch' : 'Hoàn tác dòng tiền')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '1.25rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              color: 'var(--color-slate-400)'
            }}
          >
            ✕
          </button>
        </div>

        {/* Target Details Box */}
        <div
          style={{
            padding: '1rem',
            backgroundColor: 'var(--color-slate-50, #f8fafc)',
            borderRadius: '10px',
            border: '1px solid var(--border-subtle, #e2e8f0)',
            marginBottom: '1rem',
            fontSize: '0.88rem'
          }}
        >
          {target.subtitle && (
            <div style={{ fontWeight: 700, color: 'var(--color-slate-800)', marginBottom: '4px' }}>
              {target.subtitle}
            </div>
          )}
          {isTransaction ? (
            <div style={{ color: 'var(--color-slate-600)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <div>Loại lệnh: <strong>{item.transactionType === 'BUY' ? 'Mua' : 'Bán'}</strong> ({item.symbol})</div>
              <div>Khối lượng: <strong>{Number(item.quantity).toLocaleString('vi-VN')}</strong> · Giá: <strong>{Number(item.price).toLocaleString('vi-VN')} ₫</strong></div>
              <div>Tổng tiền: <strong>{formatVND(item.quantity * item.price)}</strong></div>
            </div>
          ) : (
            <div style={{ color: 'var(--color-slate-600)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <div>Loại dòng tiền: <strong>{item.entryType === 'DEPOSIT' ? 'Nạp tiền' : 'Rút tiền'}</strong></div>
              <div>Số tiền: <strong>{formatVND(item.amount)}</strong></div>
            </div>
          )}
        </div>

        {/* Auditable Notice */}
        <div
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '8px',
            marginBottom: '1.25rem',
            fontSize: '0.8rem',
            color: '#1e40af',
            lineHeight: 1.4
          }}
        >
          <strong>Lưu ý kiểm toán:</strong> Bản ghi gốc sẽ không bị xóa hoặc ghi đè. Hệ thống sẽ ghi nhận một bản ghi bù trừ (reversal) độc lập và hoàn nguyên trạng thái số dư/tài sản tương ứng.
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1.25rem' }}>
            <label
              htmlFor="reversal-reason-input"
              style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-slate-800)', marginBottom: '6px' }}
            >
              Lý do hoàn tác <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <textarea
              id="reversal-reason-input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: Nhập nhầm giá, lệnh trùng lặp, ngân hàng hủy giao dịch..."
              disabled={loading}
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle, #cbd5e1)',
                fontSize: '0.88rem',
                fontFamily: 'inherit',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Feedback messages */}
          {errorMsg && (
            <div
              style={{
                padding: '0.65rem 0.85rem',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                color: '#b91c1c',
                fontSize: '0.85rem',
                marginBottom: '1rem'
              }}
            >
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div
              style={{
                padding: '0.65rem 0.85rem',
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '8px',
                color: '#15803d',
                fontSize: '0.85rem',
                marginBottom: '1rem'
              }}
            >
              {successMsg}
            </div>
          )}

          {/* Modal Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '1.5rem' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="fintech-btn btn-secondary btn-sm"
              style={{ padding: '0.5rem 1rem' }}
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={loading || !reason.trim()}
              className="fintech-btn btn-danger btn-sm"
              style={{
                padding: '0.5rem 1.25rem',
                backgroundColor: '#dc2626',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 700,
                cursor: loading || !reason.trim() ? 'not-allowed' : 'pointer',
                opacity: loading || !reason.trim() ? 0.6 : 1
              }}
            >
              {loading ? 'Đang xử lý...' : 'Xác nhận hoàn tác'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
