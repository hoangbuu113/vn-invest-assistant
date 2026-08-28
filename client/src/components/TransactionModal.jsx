import React, { useState, useEffect, useMemo } from 'react';

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

function translateErrorMessage(msg) {
  if (!msg) return 'Không thể ghi nhận giao dịch.';
  const lower = String(msg).toLowerCase();

  if (lower.includes('sell quantity exceeds current holding quantity') || lower.includes('pt003')) {
    return 'Số lượng bán vượt quá số lượng đang nắm giữ trong danh mục.';
  }
  if (lower.includes('cannot sell an asset without an existing holding') || lower.includes('pt002')) {
    return 'Không thể ghi nhận bán tài sản chưa có trong danh mục nắm giữ.';
  }
  if (lower.includes('asset not found') || lower.includes('pt001')) {
    return 'Không tìm thấy thông tin tài sản trong hệ thống.';
  }
  if (lower.includes('quantity must be a finite number greater than 0')) {
    return 'Số lượng giao dịch phải là số dương lớn hơn 0.';
  }
  if (lower.includes('price must be a finite number greater than 0')) {
    return 'Giá giao dịch phải là số dương lớn hơn 0.';
  }
  if (lower.includes('executedat must be an explicit timezone-aware iso timestamp')) {
    return 'Thời gian giao dịch không đúng định dạng chuẩn ISO.';
  }
  if (lower.includes('exactly one of symbol or assetid is required')) {
    return 'Vui lòng chọn một tài sản hợp lệ.';
  }
  if (lower.includes('transactiontype must be one of')) {
    return 'Loại giao dịch phải là Mua (BUY) hoặc Bán (SELL).';
  }

  return msg;
}

export default function TransactionModal({
  isOpen,
  onClose,
  assets = [],
  holdings = [],
  onTransactionRecorded,
  defaultType = 'BUY',
  defaultAsset = null
}) {
  const [transactionType, setTransactionType] = useState('BUY'); // 'BUY' | 'SELL'
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [assetSearchQuery, setAssetSearchQuery] = useState('');
  const [isAssetDropdownOpen, setIsAssetDropdownOpen] = useState(false);
  const [quantityInput, setQuantityInput] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [isCustomTime, setIsCustomTime] = useState(false);
  const [customDateTime, setCustomDateTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Initialize or reset form on open
  useEffect(() => {
    if (isOpen) {
      const initialType = defaultType === 'SELL' ? 'SELL' : 'BUY';
      setTransactionType(initialType);
      
      const initialSymbol = typeof defaultAsset === 'string'
        ? defaultAsset
        : defaultAsset?.symbol || (initialType === 'SELL' && holdings.length > 0 ? (holdings[0].symbol || holdings[0].asset?.symbol || '') : '');
      
      setSelectedSymbol(initialSymbol);
      setAssetSearchQuery('');
      setIsAssetDropdownOpen(false);
      setQuantityInput('');
      setPriceInput('');
      setIsCustomTime(false);
      setCustomDateTime('');
      setErrorMsg(null);
      setSuccessMsg(null);
    }
  }, [isOpen, defaultType, defaultAsset, holdings]);

  // Set of held asset symbols
  const heldSymbolMap = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(holdings)) return map;
    for (const h of holdings) {
      const sym = h.symbol || h.asset?.symbol;
      if (sym) {
        map.set(sym.toUpperCase(), h);
      }
    }
    return map;
  }, [holdings]);

  // Currently selected holding context if any
  const currentHolding = useMemo(() => {
    if (!selectedSymbol) return null;
    return heldSymbolMap.get(selectedSymbol.toUpperCase()) || null;
  }, [selectedSymbol, heldSymbolMap]);

  // Filtered asset list
  const filteredAssets = useMemo(() => {
    const query = assetSearchQuery.trim().toLowerCase();
    let list = Array.isArray(assets) ? [...assets] : [];

    // If SELL mode, prioritize held assets
    if (transactionType === 'SELL') {
      list.sort((a, b) => {
        const aHeld = heldSymbolMap.has(a.symbol.toUpperCase()) ? 1 : 0;
        const bHeld = heldSymbolMap.has(b.symbol.toUpperCase()) ? 1 : 0;
        return bHeld - aHeld;
      });
    }

    if (!query) return list;

    return list.filter((a) => {
      const sym = (a.symbol || '').toLowerCase();
      const name = (a.name || '').toLowerCase();
      return sym.includes(query) || name.includes(query);
    });
  }, [assets, assetSearchQuery, transactionType, heldSymbolMap]);

  // Currently selected asset object
  const selectedAssetObject = useMemo(() => {
    if (!selectedSymbol) return null;
    return (assets || []).find((a) => a.symbol.toUpperCase() === selectedSymbol.toUpperCase()) || null;
  }, [selectedSymbol, assets]);

  if (!isOpen) return null;

  const handleTypeChange = (type) => {
    if (loading) return;
    setTransactionType(type);
    setErrorMsg(null);
    setSuccessMsg(null);

    // If switching to SELL and current selected asset is not held, default to first held asset if available
    if (type === 'SELL' && selectedSymbol && !heldSymbolMap.has(selectedSymbol.toUpperCase())) {
      const firstHeld = holdings[0]?.symbol || holdings[0]?.asset?.symbol;
      if (firstHeld) {
        setSelectedSymbol(firstHeld);
      }
    }
  };

  const handleSelectAsset = (sym) => {
    setSelectedSymbol(sym);
    setIsAssetDropdownOpen(false);
    setAssetSearchQuery('');
    setErrorMsg(null);
  };

  const handleFillMaxQuantity = () => {
    if (currentHolding && typeof currentHolding.quantity === 'number') {
      setQuantityInput(String(currentHolding.quantity));
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (loading) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    // Strict client validations
    if (!selectedSymbol || !selectedSymbol.trim()) {
      setErrorMsg('Vui lòng chọn tài sản giao dịch.');
      return;
    }

    const rawQty = quantityInput.trim();
    if (!rawQty) {
      setErrorMsg('Vui lòng nhập số lượng giao dịch.');
      return;
    }
    const numQty = parseFloat(rawQty);
    if (!Number.isFinite(numQty) || numQty <= 0) {
      setErrorMsg('Số lượng giao dịch phải là số dương lớn hơn 0.');
      return;
    }

    const rawPrice = priceInput.trim();
    if (!rawPrice) {
      setErrorMsg('Vui lòng nhập giá giao dịch.');
      return;
    }
    const numPrice = parseFloat(rawPrice);
    if (!Number.isFinite(numPrice) || numPrice <= 0) {
      setErrorMsg('Giá giao dịch phải là số dương lớn hơn 0.');
      return;
    }

    // Build payload ensuring numeric JSON values
    const payload = {
      symbol: selectedSymbol.trim().toUpperCase(),
      transactionType,
      quantity: numQty,
      price: numPrice
    };

    // If custom execution time specified, send timezone-aware ISO timestamp
    if (isCustomTime && customDateTime) {
      const dt = new Date(customDateTime);
      if (isNaN(dt.getTime())) {
        setErrorMsg('Thời gian giao dịch không hợp lệ.');
        return;
      }
      payload.executedAt = dt.toISOString();
    }

    setLoading(true);

    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const json = await res.json();

      if (!res.ok || json.status !== 'ok') {
        const backendMsg = json.details || json.message || `HTTP ${res.status}`;
        throw new Error(translateErrorMessage(backendMsg));
      }

      const successText = transactionType === 'BUY'
        ? 'Đã ghi nhận giao dịch mua.'
        : 'Đã ghi nhận giao dịch bán.';
      
      setSuccessMsg(successText);

      if (onTransactionRecorded) {
        onTransactionRecorded(json.data);
      }

      // Close modal after brief delay so user sees confirmation
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      setErrorMsg(err.message || 'Đã có lỗi xảy ra khi ghi nhận giao dịch.');
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
          maxWidth: '500px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--color-surface, #ffffff)',
          borderRadius: '18px',
          boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25), 0 0 0 1px rgba(226, 232, 240, 0.85)',
          overflow: 'hidden',
          animation: 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        {/* Modal Header */}
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
                backgroundColor: transactionType === 'BUY' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                color: transactionType === 'BUY' ? 'var(--color-gain-600, #059669)' : 'var(--color-loss-600, #dc2626)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.15rem'
              }}
            >
              {transactionType === 'BUY' ? '📥' : '📤'}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                Ghi nhận giao dịch
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: 'var(--color-slate-500)' }}>
                Ghi lại giao dịch mua hoặc bán để cập nhật danh mục.
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
              borderRadius: '6px',
              transition: 'color 0.15s ease'
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div style={{ overflowY: 'auto', padding: '1.25rem 1.5rem', flex: 1 }}>
          <form onSubmit={handleSubmit} id="transaction-entry-form">
            {/* Transaction Type Segmented Toggle */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-slate-700)', marginBottom: '0.4rem' }}>
                Loại giao dịch <span style={{ color: 'var(--color-loss-600)' }}>*</span>
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px',
                  backgroundColor: 'var(--color-slate-100, #f1f5f9)',
                  padding: '4px',
                  borderRadius: '12px'
                }}
              >
                <button
                  type="button"
                  onClick={() => handleTypeChange('BUY')}
                  disabled={loading}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '0.65rem 1rem',
                    border: 'none',
                    borderRadius: '9px',
                    fontSize: '0.9rem',
                    fontWeight: transactionType === 'BUY' ? 800 : 600,
                    cursor: 'pointer',
                    backgroundColor: transactionType === 'BUY' ? 'var(--color-surface, #ffffff)' : 'transparent',
                    color: transactionType === 'BUY' ? 'var(--color-gain-600, #059669)' : 'var(--color-slate-600)',
                    boxShadow: transactionType === 'BUY' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                    transition: 'all 0.18s ease'
                  }}
                >
                  <span>🟢</span>
                  <span>Mua</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTypeChange('SELL')}
                  disabled={loading}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '0.65rem 1rem',
                    border: 'none',
                    borderRadius: '9px',
                    fontSize: '0.9rem',
                    fontWeight: transactionType === 'SELL' ? 800 : 600,
                    cursor: 'pointer',
                    backgroundColor: transactionType === 'SELL' ? 'var(--color-surface, #ffffff)' : 'transparent',
                    color: transactionType === 'SELL' ? 'var(--color-loss-600, #dc2626)' : 'var(--color-slate-600)',
                    boxShadow: transactionType === 'SELL' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                    transition: 'all 0.18s ease'
                  }}
                >
                  <span>🔴</span>
                  <span>Bán</span>
                </button>
              </div>
            </div>

            {/* Asset Selection */}
            <div style={{ marginBottom: '1.25rem', position: 'relative' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-slate-700)', marginBottom: '0.4rem' }}>
                Tài sản giao dịch <span style={{ color: 'var(--color-loss-600)' }}>*</span>
              </label>

              {/* Selected Asset Display or Trigger */}
              <div
                onClick={() => !loading && setIsAssetDropdownOpen((prev) => !prev)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.65rem 0.9rem',
                  border: '1px solid var(--border-default, #cbd5e1)',
                  borderRadius: '10px',
                  backgroundColor: 'var(--color-surface, #ffffff)',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
              >
                {selectedAssetObject ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 800, color: 'var(--color-slate-900)', fontSize: '0.95rem' }}>
                      {selectedAssetObject.symbol}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-slate-500)' }}>
                      {selectedAssetObject.name}
                    </span>
                    {selectedAssetObject.asset_type && (
                      <span className="fintech-badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                        {formatAssetType(selectedAssetObject.asset_type)}
                      </span>
                    )}
                  </div>
                ) : (
                  <span style={{ color: 'var(--color-slate-400)', fontSize: '0.9rem' }}>
                    {transactionType === 'SELL' && holdings.length > 0
                      ? 'Chọn tài sản đang nắm giữ để bán...'
                      : 'Chọn mã tài sản...'}
                  </span>
                )}
                <span style={{ color: 'var(--color-slate-400)', fontSize: '0.75rem' }}>
                  {isAssetDropdownOpen ? '▲' : '▼'}
                </span>
              </div>

              {/* Searchable Dropdown Popup */}
              {isAssetDropdownOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: '4px',
                    backgroundColor: 'var(--color-surface, #ffffff)',
                    borderRadius: '12px',
                    boxShadow: '0 12px 28px -4px rgba(15, 23, 42, 0.2), 0 0 0 1px rgba(226, 232, 240, 0.9)',
                    zIndex: 1100,
                    maxHeight: '230px',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column'
                  }}
                >
                  <div style={{ padding: '8px', borderBottom: '1px solid var(--color-slate-100, #f1f5f9)' }}>
                    <input
                      type="text"
                      autoFocus
                      placeholder="Tìm mã hoặc tên tài sản..."
                      value={assetSearchQuery}
                      onChange={(e) => setAssetSearchQuery(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        width: '100%',
                        padding: '0.5rem 0.75rem',
                        fontSize: '0.85rem',
                        border: '1px solid var(--color-slate-200, #e2e8f0)',
                        borderRadius: '8px',
                        outline: 'none'
                      }}
                    />
                  </div>

                  <div style={{ overflowY: 'auto', flex: 1, padding: '4px' }}>
                    {filteredAssets.length === 0 ? (
                      <div style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.82rem', color: 'var(--color-slate-400)' }}>
                        Không tìm thấy tài sản phù hợp
                      </div>
                    ) : (
                      filteredAssets.map((asset) => {
                        const isHeld = heldSymbolMap.has(asset.symbol.toUpperCase());
                        const isSelected = selectedSymbol.toUpperCase() === asset.symbol.toUpperCase();

                        return (
                          <div
                            key={asset.id || asset.symbol}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectAsset(asset.symbol);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0.55rem 0.75rem',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              backgroundColor: isSelected
                                ? 'var(--color-brand-50, #eff6ff)'
                                : 'transparent',
                              transition: 'background-color 0.12s ease'
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-slate-50, #f8fafc)';
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                          >
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--color-slate-900)' }}>
                                  {asset.symbol}
                                </span>
                                {isHeld && (
                                  <span
                                    className="fintech-badge"
                                    style={{
                                      backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                      color: 'var(--color-gain-600)',
                                      fontSize: '0.68rem',
                                      padding: '1px 5px'
                                    }}
                                  >
                                    Đang nắm giữ
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.76rem', color: 'var(--color-slate-500)', marginTop: '1px' }}>
                                {asset.name}
                              </div>
                            </div>
                            {asset.asset_type && (
                              <span style={{ fontSize: '0.72rem', color: 'var(--color-slate-400)' }}>
                                {formatAssetType(asset.asset_type)}
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* SELL Context Display: Current Holding & Average Cost (Pure context) */}
              {transactionType === 'SELL' && (
                <div style={{ marginTop: '0.6rem' }}>
                  {currentHolding ? (
                    <div
                      style={{
                        padding: '0.65rem 0.85rem',
                        backgroundColor: 'rgba(59, 130, 246, 0.05)',
                        borderRadius: '10px',
                        border: '1px solid rgba(191, 219, 254, 0.6)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem' }}>
                        <span style={{ color: 'var(--color-slate-600)' }}>Đang nắm giữ:</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <strong style={{ color: 'var(--color-slate-900)' }}>
                            {Number(currentHolding.quantity).toLocaleString('vi-VN')} đơn vị
                          </strong>
                          <button
                            type="button"
                            onClick={handleFillMaxQuantity}
                            style={{
                              border: 'none',
                              background: 'var(--color-brand-100, #dbeafe)',
                              color: 'var(--color-brand-700, #1d4ed8)',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              borderRadius: '4px',
                              padding: '2px 6px',
                              cursor: 'pointer'
                            }}
                          >
                            Bán hết
                          </button>
                        </div>
                      </div>
                      {typeof currentHolding.averageCost === 'number' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                          <span style={{ color: 'var(--color-slate-600)' }}>Giá vốn trung bình:</span>
                          <strong style={{ color: 'var(--color-slate-900)' }}>
                            {Number(currentHolding.averageCost).toLocaleString('vi-VN')} ₫
                          </strong>
                        </div>
                      )}
                    </div>
                  ) : selectedSymbol ? (
                    <div
                      style={{
                        padding: '0.55rem 0.85rem',
                        backgroundColor: 'rgba(239, 68, 68, 0.06)',
                        borderRadius: '8px',
                        border: '1px solid rgba(254, 202, 202, 0.8)',
                        fontSize: '0.8rem',
                        color: 'var(--color-loss-700, #b91c1c)'
                      }}
                    >
                      ⚠️ Tài sản này hiện chưa có trong danh mục nắm giữ.
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Inputs Grid: Quantity & Price */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '1.25rem' }}>
              {/* Quantity */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-slate-700)', marginBottom: '0.4rem' }}>
                  Số lượng <span style={{ color: 'var(--color-loss-600)' }}>*</span>
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.00000001"
                  placeholder="Ví dụ: 100"
                  value={quantityInput}
                  onChange={(e) => setQuantityInput(e.target.value)}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    fontSize: '0.92rem',
                    border: '1px solid var(--border-default, #cbd5e1)',
                    borderRadius: '10px',
                    outline: 'none',
                    backgroundColor: 'var(--color-surface, #ffffff)',
                    color: 'var(--color-slate-900)'
                  }}
                />
              </div>

              {/* Price */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-slate-700)', marginBottom: '0.4rem' }}>
                  Giá giao dịch (₫) <span style={{ color: 'var(--color-loss-600)' }}>*</span>
                </label>
                <input
                  type="number"
                  step="any"
                  min="1"
                  placeholder="Ví dụ: 120000"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    fontSize: '0.92rem',
                    border: '1px solid var(--border-default, #cbd5e1)',
                    borderRadius: '10px',
                    outline: 'none',
                    backgroundColor: 'var(--color-surface, #ffffff)',
                    color: 'var(--color-slate-900)'
                  }}
                />
              </div>
            </div>

            {/* Execution Time (Optional) */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-slate-700)' }}>
                  Thời gian giao dịch
                </label>
                <button
                  type="button"
                  onClick={() => setIsCustomTime((prev) => !prev)}
                  style={{
                    border: 'none',
                    background: 'none',
                    color: 'var(--color-brand-600, #2563eb)',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  {isCustomTime ? 'Dùng thời gian hiện tại' : 'Tùy chỉnh ngày giờ'}
                </button>
              </div>

              {isCustomTime ? (
                <input
                  type="datetime-local"
                  value={customDateTime}
                  onChange={(e) => setCustomDateTime(e.target.value)}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.85rem',
                    fontSize: '0.88rem',
                    border: '1px solid var(--border-default, #cbd5e1)',
                    borderRadius: '10px',
                    outline: 'none',
                    backgroundColor: 'var(--color-surface, #ffffff)',
                    color: 'var(--color-slate-900)'
                  }}
                />
              ) : (
                <div
                  style={{
                    padding: '0.55rem 0.85rem',
                    backgroundColor: 'var(--color-slate-50, #f8fafc)',
                    borderRadius: '8px',
                    border: '1px solid var(--color-slate-200, #e2e8f0)',
                    fontSize: '0.82rem',
                    color: 'var(--color-slate-500)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span>🕒</span>
                  <span>Thời gian hiện tại (ngay bây giờ)</span>
                </div>
              )}
            </div>

            {/* Error Message Display */}
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
                  alignItems: 'flex-start',
                  gap: '8px'
                }}
              >
                <span>⚠️</span>
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Success Message Display */}
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
          </form>
        </div>

        {/* Modal Footer Actions */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid var(--color-slate-100, #f1f5f9)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
            backgroundColor: 'var(--color-slate-50, #f8fafc)'
          }}
        >
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
            form="transaction-entry-form"
            disabled={loading}
            className="fintech-btn btn-primary btn-sm"
            style={{
              padding: '0.6rem 1.25rem',
              backgroundColor: transactionType === 'BUY' ? 'var(--color-brand-600, #2563eb)' : 'var(--color-slate-800, #1e293b)'
            }}
          >
            {loading ? 'Đang lưu...' : 'Ghi nhận giao dịch'}
          </button>
        </div>
      </div>
    </div>
  );
}

