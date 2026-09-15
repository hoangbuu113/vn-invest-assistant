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

function normalizedUppercase(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().toUpperCase()
    : null;
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

export function getTransactionEntryUnitLabels(assetSymbol, priceCurrency) {
  const assetUnit = normalizedUppercase(assetSymbol);
  const quoteCurrency = normalizedUppercase(priceCurrency);

  return {
    quantityUnit: assetUnit || 'đơn vị',
    executionPriceUnit: quoteCurrency && assetUnit
      ? `${quoteCurrency} / ${assetUnit}`
      : quoteCurrency || 'đồng giá'
  };
}

export function buildTransactionConfirmationSummary(payload, {
  transactionTimeLabel = 'Thời gian hiện tại (khi xác nhận)'
} = {}) {
  const assetSymbol = normalizedUppercase(payload?.symbol);
  const priceCurrency = normalizedUppercase(payload?.priceCurrency) || 'VND';
  const quantity = positiveFiniteNumber(payload?.quantity);
  const accountingUnitPriceVnd = positiveFiniteNumber(payload?.price);
  const executionUnitPrice = positiveFiniteNumber(
    payload?.executionUnitPrice ?? (priceCurrency === 'VND' ? payload?.price : null)
  );
  const nativeTotal = calculateNativeTransactionTotal(quantity, executionUnitPrice);
  const accountingTotalVnd = quantity !== null && accountingUnitPriceVnd !== null
    ? quantity * accountingUnitPriceVnd
    : null;
  const units = getTransactionEntryUnitLabels(assetSymbol, priceCurrency);
  const transactionType = payload?.transactionType === 'SELL' ? 'SELL' : 'BUY';

  return {
    transactionType,
    actionLabel: transactionType === 'SELL' ? 'BÁN (SELL)' : 'MUA (BUY)',
    assetSymbol: assetSymbol || '—',
    quantity,
    quantityUnit: units.quantityUnit,
    quantityLabel: quantity === null
      ? '—'
      : formatNativeAmount(quantity, units.quantityUnit, { decimals: 8 }),
    executionUnitPrice,
    executionPriceUnit: units.executionPriceUnit,
    executionPriceLabel: executionUnitPrice === null
      ? '—'
      : `${formatNativeAmount(executionUnitPrice, priceCurrency, { decimals: priceCurrency === 'VND' ? 0 : 8 })}${assetSymbol ? ` / ${assetSymbol}` : ''}`,
    nativeCurrency: priceCurrency,
    nativeTotal,
    nativeTotalLabel: nativeTotal === null
      ? '—'
      : formatNativeAmount(nativeTotal, priceCurrency, { decimals: priceCurrency === 'VND' ? 0 : 8 }),
    accountingUnitPriceVnd,
    accountingUnitPriceLabel: accountingUnitPriceVnd === null
      ? '—'
      : `${formatNativeAmount(accountingUnitPriceVnd, 'VND', { decimals: 8 })}${assetSymbol ? ` / ${assetSymbol}` : ''}`,
    accountingTotalVnd,
    accountingTotalLabel: accountingTotalVnd === null
      ? '—'
      : formatNativeAmount(accountingTotalVnd, 'VND', { decimals: 8 }),
    settlementMode: payload?.settlementMode || null,
    settlementModeLabel: payload?.settlementMode === 'EXTERNAL_SETTLEMENT'
      ? 'Ví / sàn bên ngoài'
      : 'Tiền mặt VND trong ứng dụng',
    transactionTimeLabel
  };
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

export function freezeTransactionSubmissionIntent({
  previousIntent,
  candidatePayload,
  idempotencyKey,
  createIdempotencyKey
}) {
  const signature = JSON.stringify(candidatePayload);
  if (previousIntent?.signature === signature) return previousIntent;

  const nextKey = previousIntent
    ? createIdempotencyKey()
    : (idempotencyKey || createIdempotencyKey());
  return {
    signature,
    idempotencyKey: nextKey,
    payload: {
      ...candidatePayload,
      idempotencyKey: nextKey
    }
  };
}
