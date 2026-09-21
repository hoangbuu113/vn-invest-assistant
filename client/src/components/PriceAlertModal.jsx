import React, { useState, useEffect, useMemo } from 'react';
import { formatNativeAmount } from '../utils/formatting.js';
import { parseFinancialInput } from '../utils/financialInput.js';
import { apiFetch } from '../utils/api.js';

export default function PriceAlertModal({
  isOpen,
  onClose,
  asset,
  currentPrice,
  onAlertCreated
}) {
  const [direction, setDirection] = useState('above');
  const [targetPriceInput, setTargetPriceInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setSuccessMsg(null);
      setDirection('above');
      setTargetPriceInput('');
    }
  }, [isOpen, asset]);

  const quoteCurrency = asset?.quote_currency || asset?.quoteCurrency || 'VND';
  const parsedTargetPrice = parseFinancialInput(targetPriceInput, quoteCurrency, { allowZero: false });
  const numericTargetPrice = parsedTargetPrice.value;
  const isValidPrice = parsedTargetPrice.isValid && numericTargetPrice > 0;

  const priceAlertPreview = useMemo(() => {
    if (!targetPriceInput.trim()) return null;
    if (!isValidPrice) {
      return { isValid: false, error: parsedTargetPrice.error };
    }
    return {
      isValid: true,
      text: formatNativeAmount(numericTargetPrice, quoteCurrency)
    };
  }, [targetPriceInput, isValidPrice, numericTargetPrice, quoteCurrency, parsedTargetPrice]);

  if (!isOpen || !asset) return null;

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!isValidPrice) {
      setErrorMsg(parsedTargetPrice.error || 'Vui lòng nhập mức giá mục tiêu hợp lệ (> 0).');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await apiFetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: asset.symbol,
          direction,
          target_price: numericTargetPrice
        })
      });

      const json = await res.json();

      if (!res.ok || json.status === 'error') {
        throw new Error(json.message || 'Không thể tạo cảnh báo giá');
      }

      setSuccessMsg('Đã tạo cảnh báo giá thành công.');
      if (onAlertCreated) {
        onAlertCreated(json.data);
      }

      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      setErrorMsg(err.message || 'Đã có lỗi xảy ra khi tạo cảnh báo');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
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
          borderRadius: '16px',
          boxShadow: '0 20px 45px -10px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(226, 232, 240, 0.8)',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '10px',
                backgroundColor: 'rgba(217, 119, 6, 0.12)',
                color: 'var(--color-amber-600, #d97706)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.1rem'
              }}
            >
              🔔
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                Đặt cảnh báo giá
              </h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-slate-500)' }}>
                {asset.symbol} — {asset.name}
              </span>
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

        {/* Content Body */}
        <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>
          {/* Current market price context */}
          {typeof currentPrice === 'number' && currentPrice > 0 && (
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
                Giá hiện tại tham chiếu:
              </span>
              <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                {formatNativeAmount(currentPrice, quoteCurrency)}
              </span>
            </div>
          )}

          {/* Direction selector */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label
              style={{
                display: 'block',
                fontSize: '0.85rem',
                fontWeight: 700,
                color: 'var(--color-slate-700)',
                marginBottom: '0.5rem'
              }}
            >
              Điều kiện kích hoạt
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
              <button
                type="button"
                onClick={() => setDirection('above')}
                style={{
                  padding: '0.85rem 0.75rem',
                  borderRadius: '10px',
                  border: direction === 'above' ? '2px solid var(--color-gain-600, #16a34a)' : '1px solid var(--color-slate-200, #e2e8f0)',
                  backgroundColor: direction === 'above' ? 'rgba(22, 163, 74, 0.08)' : 'transparent',
                  color: direction === 'above' ? 'var(--color-gain-700, #15803d)' : 'var(--color-slate-700)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.2rem',
                  transition: 'all 0.15s ease'
                }}
              >
                <span style={{ fontSize: '0.88rem', fontWeight: 700 }}>▲ Đạt hoặc vượt</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)' }}>Giá &gt;= mức đặt</span>
              </button>

              <button
                type="button"
                onClick={() => setDirection('below')}
                style={{
                  padding: '0.85rem 0.75rem',
                  borderRadius: '10px',
                  border: direction === 'below' ? '2px solid var(--color-loss-600, #dc2626)' : '1px solid var(--color-slate-200, #e2e8f0)',
                  backgroundColor: direction === 'below' ? 'rgba(220, 38, 38, 0.08)' : 'transparent',
                  color: direction === 'below' ? 'var(--color-loss-700, #b91c1c)' : 'var(--color-slate-700)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.2rem',
                  transition: 'all 0.15s ease'
                }}
              >
                <span style={{ fontSize: '0.88rem', fontWeight: 700 }}>▼ Giảm xuống hoặc thấp hơn</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)' }}>Giá &lt;= mức đặt</span>
              </button>
            </div>
          </div>

          {/* Target Price input */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label
              style={{
                display: 'block',
                fontSize: '0.85rem',
                fontWeight: 700,
                color: 'var(--color-slate-700)',
                marginBottom: '0.5rem'
              }}
            >
              Mức giá mục tiêu ({quoteCurrency})
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                inputMode={quoteCurrency === 'VND' ? 'numeric' : 'decimal'}
                placeholder={`VD: ${quoteCurrency === 'VND' ? '80.000 hoặc 80000' : '80.5'}`}
                value={targetPriceInput}
                onChange={(e) => setTargetPriceInput(e.target.value)}
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: '10px',
                  border: '1px solid var(--color-slate-300, #cbd5e1)',
                  fontSize: '1rem',
                  fontWeight: 700,
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                required
              />
            </div>
            {priceAlertPreview && (
              priceAlertPreview.isValid ? (
                <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: 'var(--color-slate-500)' }}>
                  ≈ {priceAlertPreview.text}
                </div>
              ) : (
                <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: 'var(--color-loss-600, #dc2626)' }}>
                  {priceAlertPreview.error}
                </div>
              )
            )}
          </div>

          {/* Delay & manual evaluation disclosure */}
          <div
            style={{
              fontSize: '0.78rem',
              color: 'var(--color-slate-500)',
              backgroundColor: 'var(--color-slate-50, #f8fafc)',
              padding: '0.65rem 0.85rem',
              borderRadius: '8px',
              border: '1px solid var(--color-slate-200, #e2e8f0)',
              marginBottom: '1.25rem',
              lineHeight: 1.45
            }}
          >
            ⓘ <strong>Lưu ý:</strong> Cảnh báo chỉ kích hoạt một lần và được kiểm tra khi bạn làm mới dữ liệu trong ứng dụng. Thời điểm giá phụ thuộc nguồn dữ liệu của tài sản.
          </div>

          {/* Messages */}
          {errorMsg && (
            <div
              style={{
                padding: '0.65rem 0.85rem',
                backgroundColor: 'rgba(220, 38, 38, 0.1)',
                color: 'var(--color-loss-700, #b91c1c)',
                borderRadius: '8px',
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
                backgroundColor: 'rgba(22, 163, 74, 0.1)',
                color: 'var(--color-gain-700, #15803d)',
                borderRadius: '8px',
                fontSize: '0.85rem',
                marginBottom: '1rem'
              }}
            >
              ✓ {successMsg}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="fintech-button button-secondary"
              style={{ padding: '0.65rem 1.25rem', fontSize: '0.9rem' }}
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading || !isValidPrice}
              className="fintech-button button-primary"
              style={{
                padding: '0.65rem 1.35rem',
                fontSize: '0.9rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              {loading ? 'Đang tạo...' : 'Tạo cảnh báo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
