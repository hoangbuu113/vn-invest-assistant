import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVndInput,
  parseDecimalInput,
  parseFinancialInput,
  formatVndPreview,
  getAssetUnitLabel
} from '../../client/src/utils/financialInput.js';

test('parseVndInput handles plain integers, grouped strings, and edge cases', () => {
  // Plain integers
  assert.deepEqual(parseVndInput('68603'), { value: 68603, isValid: true, error: null });
  assert.deepEqual(parseVndInput('1000000'), { value: 1000000, isValid: true, error: null });
  assert.deepEqual(parseVndInput(68603), { value: 68603, isValid: true, error: null });

  // Dot-grouped thousands (Vietnamese standard)
  assert.deepEqual(parseVndInput('68.603'), { value: 68603, isValid: true, error: null });
  assert.deepEqual(parseVndInput('1.000.000'), { value: 1000000, isValid: true, error: null });
  assert.deepEqual(parseVndInput('66.400'), { value: 66400, isValid: true, error: null });
  assert.deepEqual(parseVndInput('12.345.678.900'), { value: 12345678900, isValid: true, error: null });

  // Space-grouped thousands
  assert.deepEqual(parseVndInput('68 603'), { value: 68603, isValid: true, error: null });
  assert.deepEqual(parseVndInput('1 000 000'), { value: 1000000, isValid: true, error: null });

  // Currency suffixes & whitespace
  assert.deepEqual(parseVndInput('  68.603 đ  '), { value: 68603, isValid: true, error: null });
  assert.deepEqual(parseVndInput('68.603 VND'), { value: 68603, isValid: true, error: null });
  assert.deepEqual(parseVndInput('68.603₫'), { value: 68603, isValid: true, error: null });
  assert.deepEqual(parseVndInput('₫ 1.000.000'), { value: 1000000, isValid: true, error: null });

  // Zero handling
  assert.equal(parseVndInput('0', { allowZero: false }).isValid, false);
  assert.deepEqual(parseVndInput('0', { allowZero: true }), { value: 0, isValid: true, error: null });
  assert.equal(parseVndInput(0, { allowZero: false }).isValid, false);
  assert.deepEqual(parseVndInput(0, { allowZero: true }), { value: 0, isValid: true, error: null });

  // Ambiguous shorthand decimals rejected with helpful guidance
  const rDecimal1 = parseVndInput('68.5');
  assert.equal(rDecimal1.isValid, false);
  assert.match(rDecimal1.error, /Số tiền VND không có phần thập phân/);

  const rDecimal2 = parseVndInput('68.50');
  assert.equal(rDecimal2.isValid, false);
  assert.match(rDecimal2.error, /Số tiền VND không có phần thập phân/);

  // Malformed dot grouping rejected
  const rMalformed1 = parseVndInput('68.60.3');
  assert.equal(rMalformed1.isValid, false);
  assert.match(rMalformed1.error, /phân cách hàng nghìn không hợp lệ/);

  const rMalformed2 = parseVndInput('1.00.000');
  assert.equal(rMalformed2.isValid, false);
  assert.match(rMalformed2.error, /phân cách hàng nghìn không hợp lệ/);

  // Commas rejected with clear guidance
  const rComma1 = parseVndInput('68,603');
  assert.equal(rComma1.isValid, false);
  assert.match(rComma1.error, /không dùng dấu phẩy/);

  const rComma2 = parseVndInput('68,603.5');
  assert.equal(rComma2.isValid, false);
  assert.match(rComma2.error, /không dùng dấu phẩy/);

  // Negative numbers
  const rNegative = parseVndInput('-50000');
  assert.equal(rNegative.isValid, false);
  assert.match(rNegative.error, /không được âm/);

  // Invalid characters
  const rInvalid = parseVndInput('abc');
  assert.equal(rInvalid.isValid, false);
  assert.match(rInvalid.error, /ký tự không hợp lệ/);

  // Empty / null
  assert.equal(parseVndInput('').isValid, false);
  assert.equal(parseVndInput(null).isValid, false);
  assert.deepEqual(parseVndInput('', { allowEmpty: true }), { value: null, isValid: true, error: null });
});

test('parseDecimalInput handles crypto and foreign currency decimals', () => {
  assert.deepEqual(parseDecimalInput('0.4265'), { value: 0.4265, isValid: true, error: null });
  assert.deepEqual(parseDecimalInput('0.2139'), { value: 0.2139, isValid: true, error: null });
  assert.deepEqual(parseDecimalInput('0.36402'), { value: 0.36402, isValid: true, error: null });
  assert.deepEqual(parseDecimalInput('2650.50'), { value: 2650.5, isValid: true, error: null });
  assert.deepEqual(parseDecimalInput('0.4265 USDT'), { value: 0.4265, isValid: true, error: null });
  assert.deepEqual(parseDecimalInput('$2650.50'), { value: 2650.5, isValid: true, error: null });

  // Single comma normalized for VN keyboards
  assert.deepEqual(parseDecimalInput('0,4265'), { value: 0.4265, isValid: true, error: null });

  // Zero handling
  assert.equal(parseDecimalInput('0', { allowZero: false }).isValid, false);
  assert.deepEqual(parseDecimalInput('0', { allowZero: true }), { value: 0, isValid: true, error: null });

  // Negative & invalid
  assert.equal(parseDecimalInput('-1.5').isValid, false);
  assert.equal(parseDecimalInput('abc').isValid, false);
});

test('parseFinancialInput dispatches by currency', () => {
  // VND uses parseVndInput
  assert.deepEqual(parseFinancialInput('68.603', 'VND'), { value: 68603, isValid: true, error: null });
  assert.deepEqual(parseFinancialInput('68.603', 'vnd'), { value: 68603, isValid: true, error: null });
  assert.deepEqual(parseFinancialInput('68.603'), { value: 68603, isValid: true, error: null });

  // Non-VND uses parseDecimalInput
  assert.deepEqual(parseFinancialInput('0.4265', 'USDT'), { value: 0.4265, isValid: true, error: null });
  assert.deepEqual(parseFinancialInput('2650.50', 'USD'), { value: 2650.5, isValid: true, error: null });
});

test('FPT exact regression: "68.603" parses to 68603 VND and gives 960,442 VND cost basis for 14 cp', () => {
  const userInput = '68.603';
  const quantity = 14;

  const parsed = parseFinancialInput(userInput, 'VND');
  assert.equal(parsed.isValid, true);
  assert.equal(parsed.value, 68603);

  const costBasis = quantity * parsed.value;
  assert.equal(costBasis, 960442);

  const unitPreview = formatVndPreview(parsed.value, 'cp');
  assert.equal(unitPreview, '68.603 đ / cp');

  const totalPreview = formatVndPreview(costBasis);
  assert.equal(totalPreview, '960.442 đ');
});

test('getAssetUnitLabel identifies correct units', () => {
  assert.equal(getAssetUnitLabel({ asset_type: 'stock', symbol: 'FPT' }), 'cp');
  assert.equal(getAssetUnitLabel({ assetType: 'stock', symbol: 'HPG' }), 'cp');
  assert.equal(getAssetUnitLabel({ asset_type: 'etf', symbol: 'E1VFVN30' }), 'ccq');
  assert.equal(getAssetUnitLabel({ asset_type: 'fund', symbol: 'VESAF' }), 'ccq');
  assert.equal(getAssetUnitLabel({ asset_type: 'gold', symbol: 'XAU/USD' }), 'oz');
  assert.equal(getAssetUnitLabel({ symbol: 'XAU/USD' }), 'oz');
  assert.equal(getAssetUnitLabel({ asset_type: 'crypto', symbol: 'ONDO' }), 'coin');
  assert.equal(getAssetUnitLabel({ asset_type: 'other', symbol: 'XYZ' }), 'đơn vị');
});

