import test from 'node:test';
import assert from 'node:assert/strict';

import { computeDecisionDelta, computeDecisionFingerprint } from '../src/ai/strategyStabilityModel.js';
import { buildDeterministicMarketBrief } from '../src/ai/marketStrategistBrief.js';
import { buildMarketStrategistViewModel } from '../../client/src/utils/marketStrategistDisplay.js';

const PREVIOUS = {
  strategyId: 'strat_previous',
  previousStrategyId: 'strat_older',
  publishedAt: '2026-09-07T18:23:21.688Z',
  dataAsOf: '2026-09-07T17:51:00.000Z',
  regime: {},
  executiveDecision: { stance: 'selective_risk_on' },
  assetStrategy: [
    { assetClass: 'vietnam_equities', stance: 'increase', priority: 'high' },
    { assetClass: 'gold', stance: 'hold', priority: 'medium' },
    { assetClass: 'usd', stance: 'watch', priority: 'low' },
    { assetClass: 'crypto', stance: 'watch', priority: 'low' },
    { assetClass: 'cash', stance: 'hold', priority: 'medium' }
  ],
  preferredThemes: [
    { theme: 'Nhóm Bảo hiểm và Đầu tư Tài chính', stance: 'prefer' },
    { theme: 'Nhóm Năng lượng và Dầu khí', stance: 'watch' }
  ],
  avoidOrUnderweight: [
    { theme: 'Nhóm Bán lẻ và Dịch vụ Tiêu dùng qua Nền tảng' },
    { theme: 'Nhóm Cổ phiếu chịu áp lực Cơ cấu Danh mục' }
  ],
  riskOverlay: {},
  horizon: 'medium',
  invalidationConditions: []
};

const CURRENT = {
  strategyId: 'strat_current',
  previousStrategyId: PREVIOUS.strategyId,
  publishedAt: '2026-09-08T03:19:10.186Z',
  dataAsOf: '2026-09-08T03:08:00.000Z',
  materialChanges: ['REGIME:UNKNOWN->UNKNOWN', 'EXECUTIVE_ACTION:selective_risk_on->selective_risk_on'],
  regime: {},
  executiveDecision: { stance: 'selective_risk_on' },
  assetStrategy: [
    { assetClass: 'vietnam_equities', stance: 'hold', priority: 'high' },
    { assetClass: 'gold', stance: 'increase', priority: 'medium' },
    { assetClass: 'usd', stance: 'hold', priority: 'low' },
    { assetClass: 'crypto', stance: 'watch', priority: 'low' },
    { assetClass: 'cash', stance: 'increase', priority: 'high' }
  ],
  preferredThemes: [
    { theme: 'Nhóm Ngân hàng', stance: 'prefer' },
    { theme: 'Nhóm Hạ tầng và Dịch vụ Tài chính', stance: 'prefer' }
  ],
  avoidOrUnderweight: [
    { theme: 'Nhóm sản xuất truyền thống chậm chuyển đổi' }
  ],
  riskOverlay: {},
  horizon: 'medium',
  invalidationConditions: []
};

const FACT_PACKET = {
  dataAsOf: '2026-09-08T03:31:01.000Z',
  evidence: [
    {
      id: 'vn.market.vnindex.close:current',
      observationId: 'vn.market.vnindex.close:current',
      factId: 'vn.market.vnindex.close',
      label: 'VN-Index',
      value: 1821.64,
      unit: 'điểm',
      status: 'available'
    },
    {
      id: 'vn.macro.cpi.yoy:current',
      observationId: 'vn.macro.cpi.yoy:current',
      factId: 'vn.macro.cpi.yoy',
      label: 'CPI',
      value: 4.89,
      unit: '%',
      status: 'available'
    }
  ],
  untrustedNews: [],
  derivedSignals: [],
  claims: []
};

test('released publication delta uses the governed fingerprint fields and omits unchanged fields', () => {
  const delta = computeDecisionDelta(PREVIOUS, CURRENT);
  const assetChanges = new Map(
    delta.changes
      .filter((change) => change.type === 'ASSET_STRATEGY_CHANGED')
      .map((change) => [change.assetClass, change])
  );

  assert.notEqual(computeDecisionFingerprint(PREVIOUS), computeDecisionFingerprint(CURRENT));
  assert.equal(delta.hasMaterialChange, true);
  assert.deepEqual(assetChanges.get('VIETNAM_EQUITIES').previous, {
    assetClass: 'VIETNAM_EQUITIES', posture: 'INCREASE', action: '', priority: 'high'
  });
  assert.deepEqual(assetChanges.get('VIETNAM_EQUITIES').current, {
    assetClass: 'VIETNAM_EQUITIES', posture: 'HOLD', action: '', priority: 'high'
  });
  assert.equal(assetChanges.get('GOLD').previous.posture, 'HOLD');
  assert.equal(assetChanges.get('GOLD').current.posture, 'INCREASE');
  assert.equal(assetChanges.get('USD').previous.posture, 'WATCH');
  assert.equal(assetChanges.get('USD').current.posture, 'HOLD');
  assert.equal(assetChanges.get('CASH').previous.posture, 'HOLD');
  assert.equal(assetChanges.get('CASH').current.posture, 'INCREASE');
  assert.equal(assetChanges.get('CASH').previous.priority, 'medium');
  assert.equal(assetChanges.get('CASH').current.priority, 'high');
  assert.equal(assetChanges.has('CRYPTO'), false);
  assert.equal(delta.changes.some((change) => change.type === 'PREFERRED_THEME_CHANGED'), true);
  assert.equal(delta.changes.some((change) => change.type === 'UNDERWEIGHT_THEME_CHANGED'), true);
  assert.doesNotMatch(delta.materialChanges.join('|'), /UNKNOWN->UNKNOWN/);
  assert.doesNotMatch(delta.materialChanges.join('|'), /selective_risk_on->selective_risk_on/i);
  assert.equal(delta.changes.some((change) => change.field === 'executiveDecision.stance'), false);
});

test('later KEEP preserves publication delta and reports since-publication status separately', () => {
  const result = buildDeterministicMarketBrief({
    currentStrategy: CURRENT,
    previousStrategy: PREVIOUS,
    assessment: {
      result: 'KEEP',
      assessedAt: '2026-09-08T03:39:45.108Z',
      materialChanges: []
    },
    gateResult: { requiresReview: false, dataQualityState: 'HEALTHY' },
    factPacket: FACT_PACKET,
    now: new Date('2026-09-08T03:40:00.000Z')
  });

  const whatChanged = result.whatChanged;
  assert.equal(whatChanged.latestPublicationChanges.status, 'CHANGED');
  assert.equal(whatChanged.latestPublicationChanges.hasMaterialChange, true);
  assert.equal(whatChanged.sincePublicationStatus.status, 'NO_FURTHER_MATERIAL_CHANGE');
  assert.equal(whatChanged.sincePublicationStatus.assessmentResult, 'KEEP');
  assert.match(whatChanged.summary, /cổ phiếu Việt Nam: Tăng tỷ trọng → Giữ vị thế/);
  assert.match(whatChanged.summary, /Vàng: Giữ vị thế → Tăng tỷ trọng/);
  assert.match(whatChanged.summary, /Tiền mặt: Giữ vị thế → Tăng tỷ trọng/);
  assert.match(whatChanged.summary, /chưa xuất hiện thay đổi đủ lớn để phát hành chiến lược mới/);
  assert.doesNotMatch(whatChanged.summary, /Quan điểm thị trường hiện chưa thay đổi/);

  const view = buildMarketStrategistViewModel({
    strategyId: CURRENT.strategyId,
    generatedAt: CURRENT.publishedAt,
    strategyDataAsOf: CURRENT.dataAsOf,
    currentEvidenceDataAsOf: FACT_PACKET.dataAsOf,
    currentBrief: {
      ...result,
      currentEvidenceDataAsOf: FACT_PACKET.dataAsOf
    },
    publishedStrategy: CURRENT
  });
  assert.deepEqual(view.whatChanged.latestPublicationChanges, whatChanged.latestPublicationChanges);
  assert.deepEqual(view.whatChanged.sincePublicationStatus, whatChanged.sincePublicationStatus);
});

test('initial publication and unavailable predecessor fail closed without invented changes', () => {
  const initial = buildDeterministicMarketBrief({
    currentStrategy: { ...CURRENT, previousStrategyId: null },
    factPacket: FACT_PACKET,
    now: new Date('2026-09-08T03:20:00.000Z')
  });
  assert.equal(initial.whatChanged.latestPublicationChanges.status, 'INITIAL_PUBLICATION');
  assert.equal(initial.whatChanged.latestPublicationChanges.changes.length, 0);
  assert.match(initial.whatChanged.summary, /công bố lần đầu/);

  const unavailable = buildDeterministicMarketBrief({
    currentStrategy: CURRENT,
    previousStrategy: null,
    factPacket: FACT_PACKET,
    now: new Date('2026-09-08T03:20:00.000Z')
  });
  assert.equal(unavailable.whatChanged.latestPublicationChanges.status, 'PREVIOUS_VERSION_UNAVAILABLE');
  assert.equal(unavailable.whatChanged.latestPublicationChanges.changes.length, 0);
  assert.doesNotMatch(unavailable.whatChanged.summary, /UNKNOWN->UNKNOWN|selective_risk_on->selective_risk_on/i);
});
