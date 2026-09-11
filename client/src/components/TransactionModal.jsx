import React, { useState, useEffect, useMemo, useRef } from 'react';
import { apiFetch } from '../utils/api.js';
import { formatAssetType } from '../utils/formatting.js';
import { isPortfolioTradeableAsset } from '../utils/assetCapabilities.js';

function getClientUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'idemp-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

function translateErrorMessage(msg) {
  if (!msg) return 'Không thể ghi nhận giao dịch.';
  const lower = String(msg).toLowerCase();

  if (lower.includes('ic001') || lower.includes('idempotency key reused')) {
    return 'Giao dịch bị xung đột khóa trùng lặp. Vui lòng thử lại.';
  }
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
    return 'Giá vốn quy đổi VND phải là số dương lớn hơn 0.';
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

  // Cross-Currency & Settlement state
  const [executionUnitPrice, setExecutionUnitPrice] = useState('');
  const [priceCurrency, setPriceCurrency] = useState('VND');
  const [settlementMode, setSettlementMode] = useState('INTERNAL_VND_CASH');
  const [settlementCurrency, setSettlementCurrency] = useState('');
  const [currentUsdVndRate, setCurrentUsdVndRate] = useState(null);
  const [fxObservedAt, setFxObservedAt] = useState(null);
  const [isFxPrefillConfirmed, setIsFxPrefillConfirmed] = useState(false);

  const [isCustomTime, setIsCustomTime] = useState(false);
  const [customDateTime, setCustomDateTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const idempotencyKeyRef = useRef(null);

  // Initialize or reset form on open
  useEffect(() => {
    if (isOpen) {
      idempotencyKeyRef.current = getClientUUID();
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
      setExecutionUnitPrice('');
      setSettlementCurrency('');
      setIsFxPrefillConfirmed(false);
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

  // Filtered asset list (Canonical assets supported for trading under V1.1)
  const filteredAssets = useMemo(() => {
    const query = assetSearchQuery.trim().toLowerCase();
    let list = Array.isArray(assets)
      ? assets.filter((a) => isPortfolioTradeableAsset(a))
      : [];

    // If SELL mode, prioritize held assets
    if (transactionType === 'SELL') {
      list.sort((a, b) => {
        const aHeld = heldSymbolMap.has((a.symbol || '').toUpperCase()) ? 1 : 0;
        const bHeld = heldSymbolMap.has((b.symbol || '').toUpperCase()) ? 1 : 0;
        return bHeld - aHeld;
      });
    }

    if (!query) return list;

    return list.filter((a) => {
      const sym = (a.symbol || '').toLowerCase();
      const name = (a.name || '').toLowerCase();
      const typeLabel = formatAssetType(a.asset_type || a.assetType).toLowerCase();
      return sym.includes(query) || name.includes(query) || typeLabel.includes(query);
    });
  }, [assets, assetSearchQuery, transactionType, heldSymbolMap]);

  // Currently selected asset object
  const selectedAssetObject = useMemo(() => {
    if (!selectedSymbol) return null;
    return (assets || []).find((a) => (a.symbol || '').toUpperCase() === selectedSymbol.toUpperCase()) || null;
  }, [selectedSymbol, assets]);

  // Currently selected holding context if any
  const currentHolding = useMemo(() => {
    if (!selectedSymbol) return null;
    return heldSymbolMap.get(selectedSymbol.toUpperCase()) || null;
  }, [selectedSymbol, heldSymbolMap]);

  // Asset type categorization
  const isCrypto = selectedAssetObject?.asset_type === 'crypto' || selectedAssetObject?.assetType === 'crypto';
  const isGold = selectedAssetObject?.asset_type === 'gold' || selectedAssetObject?.assetType === 'gold' || selectedSymbol.toUpperCase() === 'XAU/USD';
  const isVndAsset = selectedAssetObject
    ? (selectedAssetObject.quote_currency === 'VND' || selectedAssetObject.quoteCurrency === 'VND') && !isCrypto && !isGold
    : true;
  const isNonVnd = !isVndAsset;

  // Set currency and settlement defaults when selected asset changes
  useEffect(() => {
    if (!selectedAssetObject) return;

    if (isCrypto) {
      setPriceCurrency('USDT');
      setSettlementMode('EXTERNAL_SETTLEMENT');
    } else if (isGold) {
      setPriceCurrency('USD');
      setSettlementMode('EXTERNAL_SETTLEMENT');
    } else {
      setPriceCurrency('VND');
      setSettlementMode('INTERNAL_VND_CASH');
    }
    setExecutionUnitPrice('');
    setIsFxPrefillConfirmed(false);
  }, [selectedAssetObject, isCrypto, isGold]);

  // Fetch USD/VND rate for verified prefill path when relevant
  useEffect(() => {
    let active = true;
    if (priceCurrency === 'USD' || isGold) {
      apiFetch('/api/market/USD%2FVND')
        .then((res) => res.json())
        .then((json) => {
          if (!active) return;
          if (json.status === 'ok' && typeof json.data?.price === 'number' && json.data.price > 0) {
            setCurrentUsdVndRate(json.data.price);
            setFxObservedAt(json.data.marketUpdatedAt || new Date().toISOString());
          }
        })
        .catch(() => {
          if (active) setCurrentUsdVndRate(null);
        });
    } else {
      setCurrentUsdVndRate(null);
    }
    return () => {
      active = false;
    };
  }, [priceCurrency, isGold]);

  if (!isOpen) return null;

  const handleTypeChange = (type) => {
    if (loading) return;
    setTransactionType(type);
    setErrorMsg(null);
    setSuccessMsg(null);

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

  const handleApplyUsdRate = () => {
    const rawExec = executionUnitPrice.trim();
    if (!rawExec || !currentUsdVndRate) return;
    const numExec = parseFloat(rawExec);
    if (!Number.isFinite(numExec) || numExec <= 0) {
      setErrorMsg('Vui lòng nhập giá thực hiện (USD) hợp lệ trước khi áp dụng tỷ giá.');
      return;
    }
    const calculatedVnd = Math.round(numExec * currentUsdVndRate);
    setPriceInput(String(calculatedVnd));
    setIsFxPrefillConfirmed(true);
    setErrorMsg(null);
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
      setErrorMsg(isNonVnd ? 'Vui lòng nhập giá vốn / giá trị quy đổi VND.' : 'Vui lòng nhập giá giao dịch.');
      return;
    }
    const numPrice = parseFloat(rawPrice);
    if (!Number.isFinite(numPrice) || numPrice <= 0) {
      setErrorMsg('Giá vốn quy đổi VND phải là số dương lớn hơn 0.');
      return;
    }

    let numExecUnitPrice = null;
    if (isNonVnd && executionUnitPrice.trim()) {
      numExecUnitPrice = parseFloat(executionUnitPrice.trim());
      if (!Number.isFinite(numExecUnitPrice) || numExecUnitPrice <= 0) {
        setErrorMsg(`Giá thực hiện (${priceCurrency}) phải là số dương lớn hơn 0.`);
        return;
      }
    }

    // Build payload ensuring numeric JSON values and approved cross-currency contract
    const payload = {
      symbol: selectedSymbol.trim().toUpperCase(),
      transactionType,
      quantity: numQty,
      price: numPrice
    };

    if (isCustomTime && customDateTime) {
      const dt = new Date(customDateTime);
      if (isNaN(dt.getTime())) {
        setErrorMsg('Thời gian giao dịch không hợp lệ.');
        return;
      }
      payload.executedAt = dt.toISOString();
    }

    if (isNonVnd) {
      payload.priceCurrency = priceCurrency;
      payload.settlementMode = settlementMode;

      if (numExecUnitPrice !== null) {
        payload.executionUnitPrice = numExecUnitPrice;
      }

      if (settlementMode === 'EXTERNAL_SETTLEMENT') {
        const trimmedCur = settlementCurrency.trim();
        payload.settlementCurrency = trimmedCur ? trimmedCur.toUpperCase() : null;
      } else {
        payload.settlementCurrency = 'VND';
      }

      // If priceCurrency is USD and user verified/confirmed current USD/VND rate
      if (priceCurrency === 'USD' && isFxPrefillConfirmed && currentUsdVndRate && !isCustomTime) {
        payload.fxRateToVnd = currentUsdVndRate;
        payload.fxProvenance = 'TWELVE_DATA_USD_VND';
        payload.fxObservedAt = fxObservedAt || new Date().toISOString();
      } else {
        payload.fxProvenance = 'USER_SUPPLIED_VND_BASIS';
      }
    } else {
      payload.priceCurrency = 'VND';
      payload.settlementMode = 'INTERNAL_VND_CASH';
      payload.settlementCurrency = 'VND';
    }

    const idempotencyKey = idempotencyKeyRef.current || (idempotencyKeyRef.current = getClientUUID());
    payload.idempotencyKey = idempotencyKey;

    setLoading(true);

    try {
      const res = await apiFetch('/api/transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      const json = await res.json();

      if (!res.ok || json.status !== 'ok') {
        const backendMsg = json.details || json.message || `HTTP ${res.status}`;
        throw new Error(translateErrorMessage(backendMsg));
      }

      // Rotate key after verified success so subsequent operations have a fresh key
      idempotencyKeyRef.current = getClientUUID();

      const successText = transactionType === 'BUY'
        ? 'Đã ghi nhận giao dịch mua.'
        : 'Đã ghi nhận giao dịch bán.';

      setSuccessMsg(successText);

      if (onTransactionRecorded) {
        onTransactionRecorded(json.data);
      }

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
          maxWidth: '520px',
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
            {/* Gold Troy Ounce Explanatory Banner */}
            {isGold && (
              <div
                style={{
                  fontSize: '0.8rem',
                  color: '#92400e',
                  backgroundColor: '#fef3c7',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid #fde68a',
                  marginBottom: '1.15rem',
                  lineHeight: 1.45
                }}
              >
                🪙 <strong>Vàng quốc tế XAU/USD:</strong> Đơn vị: ounce troy. Đây là giá vàng giao ngay quốc tế, không phải vàng SJC/PNJ.
              </div>
            )}

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
                    {(selectedAssetObject.asset_type || selectedAssetObject.assetType) && (
                      <span className="fintech-badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                        {formatAssetType(selectedAssetObject.asset_type || selectedAssetObject.assetType)}
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
                        const isHeld = heldSymbolMap.has((asset.symbol || '').toUpperCase());
                        const isSelected = selectedSymbol.toUpperCase() === (asset.symbol || '').toUpperCase();

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
                            {(asset.asset_type || asset.assetType) && (
                              <span style={{ fontSize: '0.72rem', color: 'var(--color-slate-400)' }}>
                                {formatAssetType(asset.asset_type || asset.assetType)}
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* SELL Context Display */}
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
                          <span style={{ color: 'var(--color-slate-600)' }}>Giá vốn TB (VND):</span>
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

            {/* Quantity Input */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-slate-700)', marginBottom: '0.4rem' }}>
                Số lượng giao dịch <span style={{ color: 'var(--color-loss-600)' }}>*</span>
              </label>
              <input
                type="number"
                step="any"
                min="0.00000001"
                placeholder={isGold ? 'Ví dụ: 1 (troy ounce)' : (isCrypto ? 'Ví dụ: 0.05' : 'Ví dụ: 100')}
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

            {/* Non-VND Progressive Disclosure: Execution Price & Currency */}
            {isNonVnd && (
              <div
                style={{
                  backgroundColor: 'var(--color-slate-50, #f8fafc)',
                  padding: '1rem',
                  borderRadius: '12px',
                  border: '1px solid var(--color-slate-200, #e2e8f0)',
                  marginBottom: '1.25rem'
                }}
              >
                <div style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--color-slate-800)', marginBottom: '0.75rem' }}>
                  Thông tin giá thực hiện ngoại tệ
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-slate-600)', marginBottom: '0.35rem' }}>
                      Giá thực hiện ({priceCurrency})
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0.00000001"
                      placeholder={`Ví dụ: ${isGold ? '2650' : '95000'}`}
                      value={executionUnitPrice}
                      onChange={(e) => {
                        setExecutionUnitPrice(e.target.value);
                        setIsFxPrefillConfirmed(false);
                      }}
                      disabled={loading}
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.8rem',
                        fontSize: '0.9rem',
                        border: '1px solid var(--border-default, #cbd5e1)',
                        borderRadius: '8px',
                        outline: 'none',
                        backgroundColor: '#ffffff'
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-slate-600)', marginBottom: '0.35rem' }}>
                      Đồng tiền giá
                    </label>
                    <select
                      value={priceCurrency}
                      onChange={(e) => {
                        setPriceCurrency(e.target.value);
                        setIsFxPrefillConfirmed(false);
                      }}
                      disabled={loading}
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.8rem',
                        fontSize: '0.88rem',
                        fontWeight: 700,
                        border: '1px solid var(--border-default, #cbd5e1)',
                        borderRadius: '8px',
                        backgroundColor: '#ffffff'
                      }}
                    >
                      {isCrypto ? (
                        <>
                          <option value="USDT">USDT</option>
                          <option value="USD">USD</option>
                        </>
                      ) : (
                        <>
                          <option value="USD">USD</option>
                          <option value="USDT">USDT</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>

                {/* USDT Explanation */}
                {priceCurrency === 'USDT' && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', lineHeight: 1.4, marginBottom: '0.5rem' }}>
                    ℹ️ Giao dịch bằng USDT cần nhập giá vốn/giá trị quy đổi VND thực tế bên dưới để tính toán danh mục chính xác (hệ thống không tự động quy đổi USDT=USD).
                  </div>
                )}

                {/* USD Verified Rate Prefill Option */}
                {priceCurrency === 'USD' && !isCustomTime && currentUsdVndRate && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: 'rgba(59, 130, 246, 0.08)',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '8px',
                      fontSize: '0.76rem',
                      color: 'var(--color-brand-900, #1e3a8a)',
                      gap: '8px'
                    }}
                  >
                    <span>
                      Tỷ giá USD/VND tham khảo: <strong>{Number(currentUsdVndRate).toLocaleString('vi-VN')} ₫</strong> (Twelve Data)
                    </span>
                    <button
                      type="button"
                      onClick={handleApplyUsdRate}
                      disabled={loading || !executionUnitPrice.trim()}
                      style={{
                        border: 'none',
                        background: 'var(--color-brand-600, #2563eb)',
                        color: '#ffffff',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: '5px',
                        cursor: executionUnitPrice.trim() ? 'pointer' : 'not-allowed',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Áp dụng tính giá VND
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Authoritative VND Accounting Price */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-slate-700)', marginBottom: '0.4rem' }}>
                {isNonVnd ? 'Giá vốn / Giá trị quy đổi VND (₫/đơn vị)' : 'Giá giao dịch (₫)'} <span style={{ color: 'var(--color-loss-600)' }}>*</span>
              </label>
              <input
                type="number"
                step="any"
                min="1"
                placeholder={isGold ? 'Ví dụ: 68000000' : 'Ví dụ: 120000'}
                value={priceInput}
                onChange={(e) => {
                  setPriceInput(e.target.value);
                  setIsFxPrefillConfirmed(false);
                }}
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
              <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '4px' }}>
                {isNonVnd
                  ? 'Đây là giá trị VND đơn vị làm căn cứ xác định giá vốn, lãi/lỗ và giá trị danh mục.'
                  : 'Giá tiền đồng cho mỗi đơn vị tài sản.'}
              </div>
            </div>

            {/* Non-VND Settlement Options */}
            {isNonVnd && (
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-slate-700)', marginBottom: '0.4rem' }}>
                  Cách thanh toán <span style={{ color: 'var(--color-loss-600)' }}>*</span>
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      padding: '0.65rem 0.85rem',
                      border: `1px solid ${settlementMode === 'EXTERNAL_SETTLEMENT' ? 'var(--color-brand-600, #2563eb)' : 'var(--color-slate-200, #e2e8f0)'}`,
                      borderRadius: '10px',
                      backgroundColor: settlementMode === 'EXTERNAL_SETTLEMENT' ? 'rgba(37, 99, 235, 0.04)' : '#ffffff',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="radio"
                      name="settlementMode"
                      value="EXTERNAL_SETTLEMENT"
                      checked={settlementMode === 'EXTERNAL_SETTLEMENT'}
                      onChange={() => setSettlementMode('EXTERNAL_SETTLEMENT')}
                      disabled={loading}
                      style={{ marginTop: '2px' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-slate-900)' }}>
                        Giao dịch qua ví / sàn / tài khoản bên ngoài
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                        Không thay đổi số dư tiền mặt VND đang theo dõi trong ứng dụng.
                      </div>
                    </div>
                  </label>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      padding: '0.65rem 0.85rem',
                      border: `1px solid ${settlementMode === 'INTERNAL_VND_CASH' ? 'var(--color-brand-600, #2563eb)' : 'var(--color-slate-200, #e2e8f0)'}`,
                      borderRadius: '10px',
                      backgroundColor: settlementMode === 'INTERNAL_VND_CASH' ? 'rgba(37, 99, 235, 0.04)' : '#ffffff',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="radio"
                      name="settlementMode"
                      value="INTERNAL_VND_CASH"
                      checked={settlementMode === 'INTERNAL_VND_CASH'}
                      onChange={() => setSettlementMode('INTERNAL_VND_CASH')}
                      disabled={loading}
                      style={{ marginTop: '2px' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-slate-900)' }}>
                        Thanh toán từ tiền mặt VND đang theo dõi
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                        Mua sẽ trừ tiền mặt VND, Bán sẽ cộng thêm vào tiền mặt VND.
                      </div>
                    </div>
                  </label>
                </div>

                {/* Optional Settlement Currency for External */}
                {settlementMode === 'EXTERNAL_SETTLEMENT' && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-slate-600)', marginBottom: '0.25rem' }}>
                      Đồng tiền thanh toán thực tế (không bắt buộc)
                    </label>
                    <input
                      type="text"
                      placeholder="Ví dụ: USDT, USD, VND..."
                      value={settlementCurrency}
                      onChange={(e) => setSettlementCurrency(e.target.value)}
                      disabled={loading}
                      style={{
                        width: '100%',
                        padding: '0.5rem 0.75rem',
                        fontSize: '0.85rem',
                        border: '1px solid var(--border-default, #cbd5e1)',
                        borderRadius: '8px',
                        outline: 'none',
                        backgroundColor: '#ffffff'
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Total Estimated Value Preview */}
            {Number(quantityInput) > 0 && Number(priceInput) > 0 && (
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  backgroundColor: 'rgba(37, 99, 235, 0.05)',
                  borderRadius: '10px',
                  border: '1px solid rgba(37, 99, 235, 0.15)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1.25rem'
                }}
              >
                <span style={{ fontSize: '0.82rem', color: 'var(--color-slate-600)' }}>
                  Tổng giá trị quy đổi VND:
                </span>
                <strong style={{ fontSize: '0.95rem', color: 'var(--color-brand-600, #2563eb)' }}>
                  {(Number(quantityInput) * Number(priceInput)).toLocaleString('vi-VN')} ₫
                </strong>
              </div>
            )}

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
                  onChange={(e) => {
                    setCustomDateTime(e.target.value);
                    setIsFxPrefillConfirmed(false);
                  }}
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
