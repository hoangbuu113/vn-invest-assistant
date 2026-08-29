import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MagneticButton } from './MotionHelpers.jsx';

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 }
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 16 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', damping: 25, stiffness: 350 }
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: 10,
    transition: { duration: 0.15 }
  }
};

function formatAssetType(assetType) {
  const map = {
    stock: 'Cổ phiếu',
    etf: 'ETF',
    fund: 'Quỹ đầu tư',
    gold: 'Vàng',
    fx: 'Ngoại hối',
    crypto: 'Tiền mã hóa'
  };
  return map[String(assetType).toLowerCase()] || assetType || 'Tài sản';
}

function translateOpeningError(error) {
  if (!error) return 'Đã xảy ra lỗi không xác định. Vui lòng thử lại.';
  const msg = typeof error === 'string' ? error : error.message || '';

  if (msg.includes('OP001') || msg.includes('asset not found')) {
    return 'Không tìm thấy thông tin tài sản đã chọn.';
  }
  if (msg.includes('OP002') || msg.includes('asset is inactive')) {
    return 'Tài sản này hiện đang tạm dừng giao dịch.';
  }
  if (msg.includes('OP003') || msg.includes('non-VND')) {
    return 'Hệ thống hiện chỉ hỗ trợ ghi nhận vị thế ban đầu cho tài sản định giá bằng VNĐ.';
  }
  if (msg.includes('OP004')) {
    return 'Thông tin không hợp lệ: Số lượng phải > 0 và giá vốn trung bình phải ≥ 0.';
  }
  if (msg.includes('OP005') || msg.includes('already has a holding')) {
    return 'Tài sản này đã có trong danh mục. Để thay đổi số lượng, hãy sử dụng tính năng Ghi nhận giao dịch (Mua/Bán).';
  }
  if (msg.includes('OP006') || msg.includes('opening position not found')) {
    return 'Không tìm thấy hồ sơ vị thế ban đầu của tài sản này.';
  }
  if (msg.includes('OP007') || msg.includes('locked')) {
    return 'Vị thế ban đầu này đã bị khóa do đã phát sinh giao dịch Mua/Bán sau đó, không thể chỉnh sửa hoặc hủy.';
  }

  return msg;
}

export default function OpeningPositionModal({
  isOpen,
  mode = 'CREATE', // 'CREATE' | 'CORRECT' | 'CANCEL'
  targetHolding = null,
  assets = [],
  holdings = [],
  onClose,
  onSuccess
}) {
  const [assetId, setAssetId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [averageCost, setAverageCost] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Initialize modal state on open or mode change
  useEffect(() => {
    if (!isOpen) {
      setAssetId('');
      setQuantity('');
      setAverageCost('');
      setError(null);
      setLoading(false);
      return;
    }

    setError(null);
    setLoading(false);

    if (mode === 'CORRECT' && targetHolding) {
      const opening = targetHolding.opening_position;
      setAssetId(targetHolding.asset_id || '');
      setQuantity(opening?.opening_quantity !== undefined ? String(opening.opening_quantity) : String(targetHolding.quantity || ''));
      setAverageCost(opening?.opening_average_cost !== undefined ? String(opening.opening_average_cost) : String(targetHolding.average_cost || ''));
    } else if (mode === 'CANCEL' && targetHolding) {
      setAssetId(targetHolding.asset_id || '');
      setQuantity(String(targetHolding.quantity || ''));
      setAverageCost(String(targetHolding.average_cost || ''));
    } else {
      setAssetId('');
      setQuantity('');
      setAverageCost('');
    }
  }, [isOpen, mode, targetHolding]);

  if (!isOpen) return null;

  // Filter available assets (excluding already held assets in CREATE mode, and restricted to VND assets)
  const availableAssets = (assets || []).filter((a) => {
    const isVnd = (a.quote_currency || a.quoteCurrency || 'VND').toUpperCase() === 'VND';
    if (!isVnd) return false;
    if (mode !== 'CREATE') return true;
    return !(holdings || []).some((h) => h.asset_id === a.id);
  });

  const selectedAsset = (assets || []).find((a) => a.id === assetId) || targetHolding?.asset || null;
  const isVndAsset = selectedAsset ? (selectedAsset.quote_currency || selectedAsset.quoteCurrency || 'VND').toUpperCase() === 'VND' : true;

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    setError(null);

    if (mode === 'CANCEL') {
      const openingId = targetHolding?.opening_position?.id || targetHolding?.opening_position_id;
      if (!openingId) {
        setError('Không tìm thấy mã vị thế ban đầu để hủy.');
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(`/api/positions/opening/${encodeURIComponent(openingId)}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const json = await res.json();
        if (!res.ok || json.status !== 'ok') {
          throw new Error(json.message || `HTTP ${res.status}`);
        }
        if (onSuccess) {
          onSuccess({
            type: 'CANCEL',
            message: `Đã hủy vị thế ban đầu của ${selectedAsset?.symbol || 'tài sản'}.`
          });
        }
        onClose();
      } catch (err) {
        setError(translateOpeningError(err));
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === 'CREATE') {
      if (!assetId) {
        setError('Vui lòng chọn tài sản bạn đã sở hữu từ trước.');
        return;
      }
    }

    const numQuantity = Number(quantity);
    if (!quantity || isNaN(numQuantity) || !Number.isFinite(numQuantity) || numQuantity <= 0) {
      setError('Số lượng phải là số lớn hơn 0.');
      return;
    }

    const numAverageCost = Number(averageCost);
    if (averageCost === '' || isNaN(numAverageCost) || !Number.isFinite(numAverageCost) || numAverageCost < 0) {
      setError('Giá vốn trung bình phải là số không âm.');
      return;
    }

    setLoading(true);

    try {
      if (mode === 'CREATE') {
        const res = await fetch('/api/positions/opening', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assetId,
            quantity: numQuantity,
            averageCost: numAverageCost
          })
        });
        const json = await res.json();
        if (!res.ok || json.status !== 'ok') {
          throw new Error(json.message || `HTTP ${res.status}`);
        }
        if (onSuccess) {
          onSuccess({
            type: 'CREATE',
            message: `Đã ghi nhận vị thế ban đầu cho ${selectedAsset?.symbol || 'tài sản'} thành công.`,
            data: json.data
          });
        }
        onClose();
      } else if (mode === 'CORRECT') {
        const openingId = targetHolding?.opening_position?.id || targetHolding?.opening_position_id;
        if (!openingId) {
          throw new Error('Không tìm thấy mã vị thế ban đầu để sửa.');
        }
        const res = await fetch(`/api/positions/opening/${encodeURIComponent(openingId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quantity: numQuantity,
            averageCost: numAverageCost
          })
        });
        const json = await res.json();
        if (!res.ok || json.status !== 'ok') {
          throw new Error(json.message || `HTTP ${res.status}`);
        }
        if (onSuccess) {
          onSuccess({
            type: 'CORRECT',
            message: `Đã cập nhật thông tin vị thế ban đầu cho ${selectedAsset?.symbol || 'tài sản'} thành công.`,
            data: json.data
          });
        }
        onClose();
      }
    } catch (err) {
      setError(translateOpeningError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(6px)'
        }}
      >
        <motion.div
          variants={overlayVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          onClick={loading ? undefined : onClose}
          style={{ position: 'absolute', inset: 0 }}
        />

        <motion.div
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: '520px',
            backgroundColor: 'var(--color-surface, #ffffff)',
            borderRadius: '16px',
            border: '1px solid var(--border-default, #cbd5e1)',
            boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.25)',
            overflow: 'hidden',
            zIndex: 10000
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid var(--border-subtle, #f1f5f9)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                {mode === 'CREATE' && 'Thêm tài sản đã sở hữu từ trước'}
                {mode === 'CORRECT' && 'Sửa thông tin vị thế ban đầu'}
                {mode === 'CANCEL' && 'Hủy vị thế ban đầu'}
              </h3>
              <p style={{ margin: '3px 0 0 0', fontSize: '0.8rem', color: 'var(--color-slate-500)' }}>
                {mode === 'CREATE' && 'Ghi nhận vị thế khởi điểm cho tài sản bạn đã mua trước khi dùng ứng dụng'}
                {mode === 'CORRECT' && 'Điều chỉnh số lượng hoặc giá vốn ban đầu khi chưa phát sinh giao dịch mới'}
                {mode === 'CANCEL' && 'Xóa vị thế ban đầu do ghi nhận nhầm lẫn'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '1.4rem',
                color: 'var(--color-slate-400)',
                cursor: loading ? 'not-allowed' : 'pointer',
                padding: '4px 8px',
                borderRadius: '8px'
              }}
            >
              ×
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>
            {/* Explanatory Banner */}
            <div
              style={{
                padding: '0.85rem 1rem',
                backgroundColor: mode === 'CANCEL' ? '#fef2f2' : 'var(--color-slate-50, #f8fafc)',
                border: `1px solid ${mode === 'CANCEL' ? '#fecaca' : 'var(--color-slate-200, #e2e8f0)'}`,
                borderRadius: '10px',
                marginBottom: '1.25rem',
                fontSize: '0.82rem',
                lineHeight: 1.5,
                color: mode === 'CANCEL' ? '#991b1b' : 'var(--color-slate-700, #334155)'
              }}
            >
              {mode === 'CREATE' && (
                <>
                  <div>📌 <strong>Thông tin này dùng để ghi nhận tài sản bạn đã sở hữu trước khi theo dõi bằng ứng dụng.</strong></div>
                  <div style={{ marginTop: '4px', color: 'var(--color-slate-500)' }}>
                    Thao tác này tạo vị thế khởi điểm trong danh mục, <strong>không tạo giao dịch mua</strong> và <strong>không làm thay đổi số tiền mặt hiện tại</strong>. Hiện chỉ hỗ trợ ghi nhận vị thế ban đầu cho tài sản định giá bằng VND.
                  </div>
                </>
              )}
              {mode === 'CORRECT' && (
                <>
                  <div>✏️ <strong>Chỉnh sửa số lượng hoặc giá vốn ban đầu cho tài sản này.</strong></div>
                  <div style={{ marginTop: '4px', color: 'var(--color-slate-500)' }}>
                    Thao tác này chỉ áp dụng khi vị thế chưa có giao dịch Mua/Bán mới, và không thay đổi tiền mặt.
                  </div>
                </>
              )}
              {mode === 'CANCEL' && (
                <>
                  <div>⚠️ <strong>Hủy vị thế ban đầu sẽ xóa tài sản này khỏi danh mục.</strong></div>
                  <div style={{ marginTop: '4px' }}>
                    Sử dụng khi bạn ghi nhận nhầm tài sản này. Thao tác này <strong>không tạo giao dịch bán</strong> và <strong>không thay đổi số tiền mặt</strong>.
                  </div>
                </>
              )}
            </div>

            {!isVndAsset && (
              <div className="fintech-banner banner-warning" style={{ marginBottom: '1.25rem' }}>
                <span>Hiện chỉ hỗ trợ ghi nhận vị thế ban đầu cho tài sản định giá bằng VND.</span>
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div className="fintech-banner banner-error" style={{ marginBottom: '1.25rem' }}>
                <span>{error}</span>
              </div>
            )}

            {mode !== 'CANCEL' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                {/* 1. Asset Selection (CREATE) or Fixed Info (CORRECT) */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, color: 'var(--color-slate-700)', marginBottom: '0.35rem' }}>
                    Tài sản {mode === 'CREATE' ? '*' : ''}
                  </label>
                  {mode === 'CREATE' ? (
                    <select
                      value={assetId}
                      onChange={(e) => {
                        setAssetId(e.target.value);
                        setError(null);
                      }}
                      required
                      className="fintech-select"
                      disabled={loading}
                      style={{ width: '100%' }}
                    >
                      <option value="">-- Chọn tài sản đã sở hữu --</option>
                      {availableAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.symbol} - {asset.name} ({formatAssetType(asset.asset_type)})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div
                      style={{
                        padding: '0.65rem 0.9rem',
                        backgroundColor: 'var(--color-slate-100, #f1f5f9)',
                        borderRadius: '8px',
                        border: '1px solid var(--border-default, #cbd5e1)',
                        fontWeight: 700,
                        color: 'var(--color-slate-900)'
                      }}
                    >
                      {selectedAsset?.symbol} — {selectedAsset?.name} ({formatAssetType(selectedAsset?.asset_type)})
                    </div>
                  )}
                  {mode === 'CREATE' && availableAssets.length === 0 && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '4px' }}>
                      Tất cả tài sản hiện có đã nằm trong danh mục.
                    </div>
                  )}
                </div>

                {/* 2. Quantity */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, color: 'var(--color-slate-700)', marginBottom: '0.35rem' }}>
                    Số lượng đang sở hữu *
                  </label>
                  <input
                    type="number"
                    min="0.00000001"
                    step="any"
                    placeholder="Ví dụ: 1000"
                    value={quantity}
                    onChange={(e) => {
                      setQuantity(e.target.value);
                      setError(null);
                    }}
                    required
                    disabled={loading}
                    className="fintech-input"
                    style={{ width: '100%' }}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-400)', marginTop: '3px' }}>
                    Hỗ trợ số lượng thập phân (ví dụ cho quỹ hoặc tài sản phân đoạn).
                  </div>
                </div>

                {/* 3. Average Purchase Cost */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, color: 'var(--color-slate-700)', marginBottom: '0.35rem' }}>
                    Giá vốn trung bình (VNĐ) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Ví dụ: 35000"
                    value={averageCost}
                    onChange={(e) => {
                      setAverageCost(e.target.value);
                      setError(null);
                    }}
                    required
                    disabled={loading}
                    className="fintech-input"
                    style={{ width: '100%' }}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-400)', marginTop: '3px' }}>
                    Giá vốn trung bình khi bạn mua tài sản này từ trước.
                  </div>
                </div>

                {/* Calculation preview */}
                {Number(quantity) > 0 && Number(averageCost) >= 0 && (
                  <div
                    style={{
                      padding: '0.65rem 0.9rem',
                      backgroundColor: 'rgba(37, 99, 235, 0.05)',
                      borderRadius: '8px',
                      border: '1px solid rgba(37, 99, 235, 0.15)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <span style={{ fontSize: '0.82rem', color: 'var(--color-slate-600)' }}>Tổng giá trị vốn ban đầu:</span>
                    <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-brand-600)' }}>
                      {(Number(quantity) * Number(averageCost)).toLocaleString('vi-VN')} ₫
                    </span>
                  </div>
                )}
              </div>
            ) : (
              /* CANCEL Confirmation Display */
              <div style={{ padding: '0.5rem 0' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--color-slate-800)', marginBottom: '0.75rem' }}>
                  Xác nhận hủy vị thế ban đầu của tài sản:
                </div>
                <div
                  style={{
                    padding: '0.85rem 1rem',
                    backgroundColor: 'var(--color-slate-50, #f8fafc)',
                    border: '1px solid var(--border-default, #cbd5e1)',
                    borderRadius: '8px'
                  }}
                >
                  <div style={{ fontWeight: 800, color: 'var(--color-slate-900)' }}>
                    {selectedAsset?.symbol} — {selectedAsset?.name}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--color-slate-600)', marginTop: '4px' }}>
                    Số lượng: <strong>{Number(targetHolding?.quantity || 0).toLocaleString('vi-VN')}</strong> • Giá vốn TB: <strong>{Number(targetHolding?.average_cost || 0).toLocaleString('vi-VN')} ₫</strong>
                  </div>
                </div>
              </div>
            )}

            {/* Modal Actions Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: '8px',
                marginTop: '1.75rem'
              }}
            >
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="fintech-btn btn-secondary"
                style={{ fontSize: '0.85rem' }}
              >
                Hủy bỏ
              </button>

              <MagneticButton
                type="submit"
                disabled={loading || (mode === 'CREATE' && availableAssets.length === 0)}
                className={`fintech-btn ${mode === 'CANCEL' ? 'btn-danger' : 'btn-primary'}`}
                style={{ fontSize: '0.85rem' }}
              >
                {loading && <span className="spin-icon" style={{ marginRight: '4px' }}>⟳</span>}
                <span>
                  {mode === 'CREATE' && (loading ? 'Đang ghi nhận...' : 'Ghi nhận vị thế')}
                  {mode === 'CORRECT' && (loading ? 'Đang lưu...' : 'Lưu điều chỉnh')}
                  {mode === 'CANCEL' && (loading ? 'Đang hủy...' : 'Xác nhận hủy vị thế')}
                </span>
              </MagneticButton>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

