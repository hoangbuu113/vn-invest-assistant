import { formatNativeAmount } from './formatting.js';

function positiveFiniteNumber(value) {
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizedAssetType(asset) {
  const value = asset?.asset_type ?? asset?.assetType;
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function getTransactionEntryDefaults(asset) {
  const assetType = normalizedAssetType(asset);
  const symbol = typeof asset?.symbol === 'string' ? asset.symbol.trim().toUpperCase() : '';

  if (assetType === 'crypto') {
    return {
      priceCurrency: 'USDT',
      settlementMode: 'EXTERNAL_SETTLEMENT'
    };
  }

  if (assetType === 'gold' || symbol === 'XAU/USD') {
    return {
      priceCurrency: 'USD',
      settlementMode: 'EXTERNAL_SETTLEMENT'
    };
  }

  return {
    priceCurrency: 'VND',
    settlementMode: 'INTERNAL_VND_CASH'
  };
}

export function isSimplifiedCryptoExternalEntry(asset, settlementMode) {
  return normalizedAssetType(asset) === 'crypto'
    && settlementMode === 'EXTERNAL_SETTLEMENT';
}

export function calculateNativeTransactionTotal(quantity, executionUnitPrice) {
  const normalizedQuantity = positiveFiniteNumber(quantity);
  const normalizedExecutionPrice = positiveFiniteNumber(executionUnitPrice);
  if (normalizedQuantity === null || normalizedExecutionPrice === null) return null;
  return normalizedQuantity * normalizedExecutionPrice;
}

export function formatNativeTransactionTotal(quantity, executionUnitPrice, priceCurrency) {
  const total = calculateNativeTransactionTotal(quantity, executionUnitPrice);
  const currency = typeof priceCurrency === 'string' && priceCurrency.trim()
    ? priceCurrency.trim().toUpperCase()
    : null;
  if (total === null || currency === null) return '—';

  return formatNativeAmount(total, currency, {
    decimals: currency === 'VND' ? 0 : 8
  });
}

export function validateRequiredVndAccountingPrice(value) {
  const price = positiveFiniteNumber(value);
  if (price !== null) {
    return {
      valid: true,
      price,
      expandAdvancedAccounting: false,
      message: null
    };
  }

  const isMissing = value === null
    || value === undefined
    || (typeof value === 'string' && value.trim() === '');

  return {
    valid: false,
    price: null,
    expandAdvancedAccounting: true,
    message: isMissing
      ? 'Vui lòng nhập giá hạch toán VND bắt buộc để tính giá vốn và lãi/lỗ.'
      : 'Giá hạch toán VND phải là số dương lớn hơn 0.'
  };
}
