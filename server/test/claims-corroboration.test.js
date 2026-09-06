import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CLAIM_TYPES,
  CLAIM_STATUS,
  CLAIM_AUTHORITY_LEVELS,
  generateClaimId,
  createMarketClaim,
  buildConfidenceDimensions
} from '../src/claims/claimModel.js';

import {
  SOURCE_FAMILIES,
  DEPENDENCY_GROUPS,
  classifySourceFamily,
  isFamilyIndependent,
  aggregateEvidenceSources
} from '../src/claims/sourceFamily.js';

import {
  extractClaimsFromObservation,
  extractClaimsFromArticle,
  doesEvidenceSupportClaim
} from '../src/claims/claimExtractor.js';

import {
  reconcileClaims
} from '../src/claims/claimReconciliation.js';

import {
  persistClaims
} from '../src/claims/claimRepository.js';

import {
  buildMarketStrategistFactPacket,
  generateDeterministicMarketStrategist,
  computeStrategistFingerprint
} from '../src/ai/marketStrategistEngine.js';

import {
  validateClaimIntegrity,
  applySharedPublicationGate
} from '../src/ai/marketStrategistValidation.js';

test('1. Two CafeF articles with unknown origin do NOT produce independent sources', () => {
  const ev1 = {
    evidenceId: 'art_1',
    sourceFamily: SOURCE_FAMILIES.CAFEF,
    url: 'https://cafef.vn/bai-1.chn'
    // No subject, no snippet, no provenance → UNKNOWN_DEPENDENCY
  };
  const ev2 = {
    evidenceId: 'art_2',
    sourceFamily: SOURCE_FAMILIES.CAFEF,
    url: 'https://cafef.vn/bai-2.chn'
    // No subject, no snippet, no provenance → UNKNOWN_DEPENDENCY
  };

  const agg = aggregateEvidenceSources([ev1, ev2]);
  assert.equal(agg.sourceCount, 2, 'Total evidence items is 2');
  assert.equal(agg.independentSourceCount, 0, 'CafeF with no provenance = UNKNOWN_DEPENDENCY = 0 independent');
  assert.deepEqual(agg.independentFamilies, [], 'No independent families when origin is unknown');
});

test('2. Three articles: two CafeF + one syndication header → 0 independent (all unknown origin)', () => {
  const art1 = {
    evidenceId: 'art_1',
    url: 'https://cafef.vn/cpi-tang.chn',
    sourceId: 'cafef',
    title: 'CPI tháng 8 tăng 4.89%'
    // No explicit NSO attribution, no subject → UNKNOWN_DEPENDENCY
  };
  const art2 = {
    evidenceId: 'art_2',
    url: 'https://cafef.vn/phan-tich-cpi.chn',
    sourceId: 'cafef',
    title: 'Phân tích CPI tháng 8 tăng 4.89%'
    // No explicit NSO attribution, no subject → UNKNOWN_DEPENDENCY
  };
  const art3 = {
    evidenceId: 'art_3',
    url: 'https://tin-tuc-tong-hop.vn/bai.html',
    sourceId: 'aggregator',
    title: 'Theo CafeF: CPI tháng 8 tăng 4.89%',
    summary: 'Nguồn: CafeF'
    // Attributing CafeF → DEPENDENCY_GROUPS.CAFEF → also not independent
  };

  const agg = aggregateEvidenceSources([art1, art2, art3]);
  assert.equal(agg.sourceCount, 3, 'Total sources is 3');
  assert.equal(agg.independentSourceCount, 0, 'No independent sources: CafeF is not an independent dependency group');
  assert.deepEqual(agg.independentFamilies, []);
});

test('3. Secondary media reporting official statistics collapses to official dependency group (not corroborated)', () => {
  const nsoObs = {
    factId: 'vn.macro.cpi.yoy',
    observationId: 'obs_nso_cpi',
    value: 4.89,
    referenceTime: '2026-08',
    source: 'nso',
    provenance: { authority: 'Tổng cục Thống kê' }
  };
  const reutersArticle = {
    articleId: 'art_reuters_1',
    url: 'https://reuters.com/markets/vietnam-cpi-august',
    sourceId: 'reuters',
    title: 'Vietnam CPI rises 4.89% in August, according to NSO',
    summary: 'According to the National Statistics Office, Vietnam CPI rose 4.89% YoY.',
    publishedAt: '2026-08-30T08:00:00Z'
  };

  const claimNSO = extractClaimsFromObservation(nsoObs)[0].claim;
  const claimReuters = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    predicate: 'EQUALS',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.FINANCIAL_MEDIA,
    publishedAt: '2026-08-30T08:00:00Z'
  });

  const evidence = [
    {
      evidenceId: 'obs_nso_cpi',
      factId: 'vn.macro.cpi.yoy',
      value: 4.89,
      referenceTime: '2026-08',
      sourceFamily: SOURCE_FAMILIES.OFFICIAL_NSO,
      dependencyGroup: DEPENDENCY_GROUPS.OFFICIAL_NSO
    },
    {
      evidenceId: 'art_reuters_1',
      url: 'https://reuters.com/article',
      sourceId: 'reuters',
      title: 'Vietnam CPI tháng 8 tăng 4.89%',
      summary: 'Theo Tổng cục Thống kê, CPI tháng 8 tăng 4.89%',
      sourceFamily: SOURCE_FAMILIES.REUTERS,
      snippet: 'Theo Tổng cục Thống kê (NSO), CPI tháng 8 tăng 4.89%'
    }
  ];

  const reconciled = reconcileClaims([claimNSO, claimReuters], evidence);
  const nsoResult = reconciled.find((r) => r.claim.authorityLevel === CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL);
  assert.ok(nsoResult, 'NSO claim exists');
  assert.equal(nsoResult.claim.independentSourceCount, 1, 'Official + secondary reporting official must collapse to 1 independent dependency group');
  assert.equal(nsoResult.claim.supportStatus, CLAIM_STATUS.SUPPORTED, 'Must be SUPPORTED, never CORROBORATED');
  assert.deepEqual(nsoResult.independentFamilies, [DEPENDENCY_GROUPS.OFFICIAL_NSO]);

  // Check evidence links independence assignment
  const nsoLink = nsoResult.supportingEvidence.find((e) => e.evidenceId === 'obs_nso_cpi');
  const reutersLink = nsoResult.supportingEvidence.find((e) => e.evidenceId === 'art_reuters_1');
  assert.equal(nsoLink.isIndependent, true, 'Primary official evidence is independent');
  assert.equal(reutersLink.isIndependent, false, 'Derivative media evidence in same dependency group is NOT independent');
});

test('3B. Issuer IR + article merely reporting issuer announcement collapses to ONE issuer origin', () => {
  // The article reports ON the issuer announcement — its underlying origin is ISSUER_IR, not a second primary origin.
  const issuerClaim = createMarketClaim({
    claimType: CLAIM_TYPES.CORPORATE_EVENT,
    subject: 'vn.issuer.vnm.restructuring',
    predicate: 'ANNOUNCED',
    valueText: 'Approved restructuring plan',
    scope: 'corporate_action',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL
  });

  const evIR = {
    evidenceId: 'ir_release_1',
    subject: 'vn.issuer.vnm.restructuring',
    sourceFamily: SOURCE_FAMILIES.ISSUER_IR,
    dependencyGroup: DEPENDENCY_GROUPS.ISSUER_IR,
    title: 'Vinamilk công bố phương án tái cấu trúc'
  };

  // CafeF article reporting on the SAME issuer announcement — no positively established independent origin
  const evCafeF = {
    evidenceId: 'cafef_art_vnm',
    subject: 'vn.issuer.vnm.restructuring',
    sourceFamily: SOURCE_FAMILIES.CAFEF,
    // dependencyGroup NOT explicitly set → will be resolved via resolveClaimDependency
    // corporate_action subject + no explicit independent survey → ISSUER_IR or UNKNOWN_DEPENDENCY
    title: 'CafeF: Vinamilk công bố tái cấu trúc'
    // No snippet/snippet is empty, no explicit attribution of an independent second primary origin
  };

  const reconciled = reconcileClaims([issuerClaim], [evIR, evCafeF]);
  const result = reconciled[0];
  assert.ok(result, 'Reconciled claim exists');
  // CafeF article reporting on an issuer announcement without independent provenance must NOT yield 2 independent origins
  assert.equal(result.claim.independentSourceCount, 1, 'Issuer IR + media reporting that IR = 1 issuer origin, NOT 2 independent');
  assert.equal(result.claim.supportStatus, CLAIM_STATUS.SUPPORTED, 'Must be SUPPORTED, not CORROBORATED from media reporting alone');
});

test('3C. Genuine two-origin corroboration via ISSUER_IR + explicit independent regulatory filing', () => {
  // A regulatory filing (SSC or HOSE official disclosure) constitutes a SECOND independent primary origin
  const issuerClaim = createMarketClaim({
    claimType: CLAIM_TYPES.CORPORATE_EVENT,
    subject: 'vn.issuer.vnm.restructuring',
    predicate: 'ANNOUNCED',
    valueText: 'Approved restructuring plan',
    scope: 'corporate_action',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL
  });

  const evIR = {
    evidenceId: 'ir_release_1',
    subject: 'vn.issuer.vnm.restructuring',
    sourceFamily: SOURCE_FAMILIES.ISSUER_IR,
    dependencyGroup: DEPENDENCY_GROUPS.ISSUER_IR,
    title: 'Vinamilk công bố phương án tái cấu trúc'
  };

  // Explicit independent primary research / survey with positively established provenance
  const evIndependentSurvey = {
    evidenceId: 'independent_research_1',
    subject: 'vn.issuer.vnm.restructuring',
    sourceFamily: SOURCE_FAMILIES.MARKET_DATA,
    dependencyGroup: DEPENDENCY_GROUPS.MARKET_DATA,
    isPrimaryResearch: true,
    methodology: 'independent_survey',
    title: 'SSC independent filing verification confirms restructuring plan'
  };

  const reconciled = reconcileClaims([issuerClaim], [evIR, evIndependentSurvey]);
  const result = reconciled[0];
  assert.ok(result, 'Reconciled claim exists');
  assert.equal(result.claim.independentSourceCount, 2, 'Two distinct independent primary origins yield count = 2');
  assert.equal(result.claim.supportStatus, CLAIM_STATUS.CORROBORATED, 'Two genuinely independent origins = CORROBORATED');
});


test('4. Official source outranks secondary report for numeric fact', () => {
  const officialClaim = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL
  });

  const secondaryClaim = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 5.15, // Conflicting value reported by secondary media
    unit: '%',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.FINANCIAL_MEDIA
  });

  const reconciled = reconcileClaims([officialClaim, secondaryClaim], []);
  const reconciledOfficial = reconciled.find((r) => r.claim.authorityLevel === CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL).claim;
  const reconciledSecondary = reconciled.find((r) => r.claim.authorityLevel === CLAIM_AUTHORITY_LEVELS.FINANCIAL_MEDIA).claim;

  assert.equal(reconciledOfficial.numericValue, 4.89, 'Official value remains untouched');
  assert.ok(reconciledOfficial.limitations.includes('ưu tiên số liệu chính thức'));
  assert.equal(reconciledSecondary.supportStatus, CLAIM_STATUS.CONTRADICTED);
  assert.ok(reconciledSecondary.limitations.includes('khác biệt so với công bố chính thức'));
});

test('5. Same fact/period conflicting values produce contradiction', () => {
  const claimA = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.FINANCIAL_MEDIA
  });

  const claimB = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 5.25,
    unit: '%',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.FINANCIAL_MEDIA
  });

  const reconciled = reconcileClaims([claimA, claimB], []);
  assert.equal(reconciled[0].claim.supportStatus, CLAIM_STATUS.CONTRADICTED);
  assert.equal(reconciled[1].claim.supportStatus, CLAIM_STATUS.CONTRADICTED);
  assert.equal(reconciled[0].claim.contradictionCount, 1);
  assert.equal(reconciled[1].claim.contradictionCount, 1);
});

test('6. Monthly CPI vs cumulative CPI is NOT contradiction', () => {
  const monthlyCpi = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy'
  });

  const ytdCpi = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.ytd_average',
    numericValue: 3.20,
    unit: '%',
    referencePeriod: '2026-M8',
    scope: 'ytd_cumulative'
  });

  const reconciled = reconcileClaims([monthlyCpi, ytdCpi], []);
  assert.notEqual(reconciled[0].claim.supportStatus, CLAIM_STATUS.CONTRADICTED);
  assert.notEqual(reconciled[1].claim.supportStatus, CLAIM_STATUS.CONTRADICTED);
  assert.equal(reconciled[0].claim.contradictionCount, 0);
  assert.equal(reconciled[1].claim.contradictionCount, 0);
});

test('7. Central FX vs commercial FX is NOT contradiction', () => {
  const centralRate = createMarketClaim({
    claimType: CLAIM_TYPES.MONETARY_NUMERIC,
    subject: 'vn.monetary.fx.sbv_central.usd_vnd',
    numericValue: 25240,
    unit: 'VND',
    referencePeriod: '2026-09-05',
    scope: 'central_rate'
  });

  const commercialRate = createMarketClaim({
    claimType: CLAIM_TYPES.MONETARY_NUMERIC,
    subject: 'vn.monetary.fx.commercial.usd_vnd',
    numericValue: 25480,
    unit: 'VND',
    referencePeriod: '2026-09-05',
    scope: 'commercial_rate'
  });

  const reconciled = reconcileClaims([centralRate, commercialRate], []);
  assert.notEqual(reconciled[0].claim.supportStatus, CLAIM_STATUS.CONTRADICTED);
  assert.notEqual(reconciled[1].claim.supportStatus, CLAIM_STATUS.CONTRADICTED);
  assert.equal(reconciled[0].claim.contradictionCount, 0);
});

test('8. Preliminary vs revised official value is revision/supersession, not contradiction', () => {
  const preliminaryClaim = createMarketClaim({
    claimType: CLAIM_TYPES.TRADE_NUMERIC,
    subject: 'vn.trade.goods.exports.month_usd',
    numericValue: 33000000000,
    unit: 'USD',
    referencePeriod: '2026-02',
    scope: 'monthly',
    revisionMarker: 'preliminary',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL
  });

  const revisedClaim = createMarketClaim({
    claimType: CLAIM_TYPES.TRADE_NUMERIC,
    subject: 'vn.trade.goods.exports.month_usd',
    numericValue: 33200000000,
    unit: 'USD',
    referencePeriod: '2026-02',
    scope: 'monthly',
    revisionMarker: 'revised',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL
  });

  const reconciled = reconcileClaims([preliminaryClaim, revisedClaim], []);
  const prelimResult = reconciled.find((r) => r.claim.revisionMarker === 'preliminary').claim;
  const revisedResult = reconciled.find((r) => r.claim.revisionMarker === 'revised').claim;

  assert.equal(prelimResult.supportStatus, CLAIM_STATUS.SUPERSEDED);
  assert.notEqual(prelimResult.supportStatus, CLAIM_STATUS.CONTRADICTED);
  assert.equal(revisedResult.revisionOf, prelimResult.claimId);
  assert.equal(revisedResult.contradictionCount, 0);
});

test('9. Superseded claim not treated as current', () => {
  const supersededClaim = createMarketClaim({
    claimType: CLAIM_TYPES.TRADE_NUMERIC,
    subject: 'vn.trade.goods.exports.month_usd',
    numericValue: 33000000000,
    unit: 'USD',
    referencePeriod: '2026-02',
    scope: 'monthly',
    revisionMarker: 'preliminary',
    supportStatus: CLAIM_STATUS.SUPERSEDED
  });

  // Mock output citing the superseded preliminary number as current figure without mentioning revision
  const invalidOutput = {
    executiveDecision: {
      oneLineDecision: 'Xuất khẩu tháng 2 đạt 33000000000 USD là con số hiện hành.',
      actionNow: 'Theo dõi tiếp.'
    }
  };

  const errors = validateClaimIntegrity(invalidOutput, [supersededClaim]);
  assert.ok(errors.length > 0, 'Must produce error when superseded claim is treated as current');
  assert.ok(errors[0].includes('SUPERSEDED_CLAIM_TREATED_AS_CURRENT'));

  // Valid output mentioning revision passes
  const validOutput = {
    executiveDecision: {
      oneLineDecision: 'Số liệu sơ bộ 33000000000 USD trước đó đã được điều chỉnh trong báo cáo mới.',
      actionNow: 'Theo dõi tiếp.'
    }
  };
  const validErrors = validateClaimIntegrity(validOutput, [supersededClaim]);
  assert.equal(validErrors.length, 0, 'Acknowledging revision passes gate');
});

test('10. Unsupported article cannot support exact numeric claim', () => {
  const genericArticle = {
    articleId: 'art_generic',
    title: 'Lạm phát toàn cầu và bối cảnh giá cả tại Việt Nam',
    summary: 'Áp lực giá cả hàng hóa gia tăng khiến chỉ số CPI được đặc biệt quan tâm trong những tháng cuối năm.'
  };

  const specificClaim = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy'
  });

  const supports = doesEvidenceSupportClaim(genericArticle, specificClaim);
  assert.equal(supports, false, 'Article with general inflation mention does NOT support exact numeric claim');
});

test('11. Exact matching evidence supports claim', () => {
  const exactArticle = {
    articleId: 'art_exact',
    title: 'CPI tháng 8 tăng 4.89% so với cùng kỳ năm trước',
    summary: 'Theo số liệu thống kê, CPI tháng 08/2026 tăng 4.89% YoY.',
    publishedAt: '2026-08-29T10:00:00Z'
  };

  const specificClaim = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy'
  });

  const supports = doesEvidenceSupportClaim(exactArticle, specificClaim);
  assert.equal(supports, true, 'Exact matching article supports numeric claim');
});

test('12. Claim identity deterministic', () => {
  const id1 = generateClaimId({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy',
    numericValue: 4.89
  });

  const id2 = generateClaimId({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy',
    numericValue: 4.89
  });

  assert.equal(id1, id2, 'Identical semantic fields must yield identical claimId');
  assert.ok(id1.startsWith('claim_'), 'Claim ID has standard prefix');
});

test('13. Corrected claim creates new immutable version', () => {
  const originalId = generateClaimId({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy',
    numericValue: 4.89
  });

  const correctedId = generateClaimId({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy',
    numericValue: 4.91
  });

  assert.notEqual(originalId, correctedId, 'Corrected numerical value must produce distinct claim ID');
});

test('14. Unknown source family does not automatically count independent', () => {
  const unk = classifySourceFamily({
    url: 'https://random-forum-post.xyz/view?id=123',
    sourceId: 'anonymous_forum',
    publisher: 'Diễn đàn đầu tư'
  });

  assert.equal(unk, SOURCE_FAMILIES.UNKNOWN);
  assert.equal(isFamilyIndependent(unk), false, 'Unknown family is not independent');

  const agg = aggregateEvidenceSources([{ sourceFamily: unk }]);
  assert.equal(agg.independentSourceCount, 0, 'Unknown source family count does not increment independence');
});

test('15. Contradicted claim reaches strategist with limitation', () => {
  const contradictedClaim = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy',
    supportStatus: CLAIM_STATUS.CONTRADICTED,
    contradictionCount: 1,
    limitations: 'Tồn tại xung đột số liệu giữa các cơ quan báo cáo.'
  });

  const factPacket = buildMarketStrategistFactPacket({
    marketObservations: [
      {
        factId: 'vn.macro.cpi.yoy',
        observationId: 'obs_cpi_1',
        pillar: 'macro',
        metric: 'CPI YoY',
        value: 4.89,
        unit: '%',
        status: 'available',
        referenceTime: '2026-08'
      }
    ],
    claims: [contradictedClaim]
  });

  const strategistBrief = generateDeterministicMarketStrategist({ factPacket });
  assert.ok(
    strategistBrief.marketOverview.vietnam.includes('thận trọng') ||
    strategistBrief.marketOverview.vietnam.includes('khác biệt') ||
    strategistBrief.marketOverview.vietnam.includes('tranh cãi'),
    'Deterministic brief narrative must surface uncertainty for contradicted claim'
  );

  const gateResult = applySharedPublicationGate(strategistBrief, factPacket);
  assert.equal(gateResult.published, true, 'Surfacing uncertainty allows publication gate to pass');
});

test('16. Duplicated source family cannot inflate confidence', () => {
  const singleClaim = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.FINANCIAL_MEDIA
  });

  const ev1 = { evidenceId: 'art_1', sourceFamily: SOURCE_FAMILIES.CAFEF, claimId: singleClaim.claimId };
  const ev2 = { evidenceId: 'art_2', sourceFamily: SOURCE_FAMILIES.CAFEF, claimId: singleClaim.claimId };
  const ev3 = { evidenceId: 'art_3', sourceFamily: SOURCE_FAMILIES.CAFEF, claimId: singleClaim.claimId };

  const reconciled = reconcileClaims([singleClaim], [ev1, ev2, ev3]);
  const dimensions = reconciled[0].claim.confidenceDimensions;

  assert.equal(reconciled[0].claim.independentSourceCount, 1);
  assert.equal(dimensions.corroboration, 'SINGLE_SOURCE', 'Cannot claim MULTI_SOURCE with single family');
  assert.notEqual(dimensions.corroboration, 'MULTI_SOURCE');
});

test('17. No opaque credibility score introduced', () => {
  const claim = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy'
  });

  // Verify no 0-100 or scalar credibility score is present anywhere in claim object
  assert.equal('credibilityScore' in claim, false);
  assert.equal('score' in claim, false);
  assert.equal('confidenceScore' in claim, false);
  assert.equal('compositeScore' in claim, false);

  const dims = buildConfidenceDimensions();
  for (const val of Object.values(dims)) {
    assert.notEqual(typeof val, 'number', 'Confidence dimensions must be structured categories, not magic numbers');
  }
});

test('18. No private profile/portfolio data enters claim pipeline', () => {
  assert.throws(
    () => {
      buildMarketStrategistFactPacket({
        marketObservations: [],
        newsArticles: [],
        claims: [
          {
            claimType: CLAIM_TYPES.MACRO_NUMERIC,
            subject: 'vn.macro.cpi.yoy',
            numericValue: 4.89,
            portfolio: { totalValue: 500000000 } // Forbidden user data
          }
        ]
      });
    },
    /FORBIDDEN_USER_DATA/,
    'Passing user portfolio data must throw error'
  );
});

test('19. Raw article body not unnecessarily forwarded to Gemini', () => {
  const verboseArticle = {
    articleId: 'art_long_1',
    title: 'Tiêu đề bài báo ngắn',
    excerpt: 'Tóm tắt bài báo 50 ký tự.',
    content: 'A'.repeat(50000), // Very long 50KB article body
    text: 'A'.repeat(50000)
  };

  const factPacket = buildMarketStrategistFactPacket({
    marketObservations: [],
    newsArticles: [verboseArticle]
  });

  const newsInPacket = factPacket.untrustedNews[0];
  assert.ok(newsInPacket, 'Article exists in untrustedNews');
  assert.equal('content' in newsInPacket, false, 'content must not be attached to untrustedNews');
  assert.equal('text' in newsInPacket, false, 'raw text must not be attached to untrustedNews');
  assert.ok(newsInPacket.excerpt.length <= 1000, 'Excerpt remains compact');
});

test('20. Claim storage RLS blocks anon/auth writes', () => {
  const migrationPath = resolve(import.meta.dirname, '../../supabase/migrations/20260905020000_create_market_claims_and_evidence_links.sql');
  const sql = readFileSync(migrationPath, 'utf8');

  // Verify RLS is enabled
  assert.ok(sql.includes('ALTER TABLE public.market_claims ENABLE ROW LEVEL SECURITY;'));
  assert.ok(sql.includes('ALTER TABLE public.claim_evidence_links ENABLE ROW LEVEL SECURITY;'));

  // Verify public read policy
  assert.ok(sql.includes('CREATE POLICY market_claims_read'));
  assert.ok(sql.includes('CREATE POLICY claim_evidence_links_read'));

  // Verify modifications revoked from public, anon, authenticated
  assert.ok(sql.includes('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_claims FROM PUBLIC;'));
  assert.ok(sql.includes('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_claims FROM anon, authenticated;'));
  assert.ok(sql.includes('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.claim_evidence_links FROM PUBLIC;'));
  assert.ok(sql.includes('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.claim_evidence_links FROM anon, authenticated;'));

  // Verify service-role grant
  assert.ok(sql.includes('GRANT ALL ON public.market_claims TO service_role;'));
  assert.ok(sql.includes('GRANT ALL ON public.claim_evidence_links TO service_role;'));
});

test('21. Database migration includes dependency_group and defaults is_independent to false', () => {
  const migrationPath = resolve(import.meta.dirname, '../../supabase/migrations/20260905020000_create_market_claims_and_evidence_links.sql');
  const sql = readFileSync(migrationPath, 'utf8');

  assert.ok(sql.includes("dependency_group TEXT NOT NULL DEFAULT 'UNKNOWN_DEPENDENCY'"), 'dependency_group column must be defined');
  assert.ok(sql.includes('is_independent BOOLEAN NOT NULL DEFAULT false'), 'is_independent must default to false');
  assert.ok(sql.includes('CREATE INDEX IF NOT EXISTS idx_claim_evidence_links_dep_group'), 'Index on dependency_group must exist');
});

test('22. Unknown dependency strictly defaults to non-independent in persistence and memory', async () => {
  const claim = createMarketClaim({
    claimType: CLAIM_TYPES.NEWS_ASSERTION,
    subject: 'vn.issuer.test.event',
    predicate: 'REPORTED',
    valueText: 'Some unverified event'
  });

  const evUnknown = {
    evidenceId: 'ev_anon_1',
    evidenceType: 'article',
    sourceFamily: SOURCE_FAMILIES.UNKNOWN,
    dependencyGroup: DEPENDENCY_GROUPS.UNKNOWN_DEPENDENCY
    // Note: isIndependent omitted intentionally to test default
  };

  const saved = await persistClaims([{ claim, supportingEvidence: [evUnknown] }], null);
  assert.equal(saved.length, 1);
  const links = (await import('../src/claims/claimRepository.js')).getEvidenceLinksForClaim(claim.claimId);
  assert.equal(links.length, 1);
  assert.equal(links[0].dependencyGroup, DEPENDENCY_GROUPS.UNKNOWN_DEPENDENCY);
  assert.equal(links[0].isIndependent, false, 'Omitted or unknown independence must default strictly to false');
});

test('23. Subject mention without finite numeric value strictly fails to support numeric claim', () => {
  const specificClaim = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy'
  });

  // 1. Evidence item specifying subject only, no numeric value
  const evSubjectOnly = {
    evidenceId: 'art_topic',
    subject: 'vn.macro.cpi.yoy'
  };
  assert.equal(doesEvidenceSupportClaim(evSubjectOnly, specificClaim), false, 'Subject only cannot support numeric claim');

  // 2. Evidence item with null numeric value
  const evNullVal = {
    evidenceId: 'art_topic_null',
    subject: 'vn.macro.cpi.yoy',
    value: null
  };
  assert.equal(doesEvidenceSupportClaim(evNullVal, specificClaim), false, 'Null value cannot support numeric claim');

  // 3. Evidence item with non-numeric string
  const evNonNumeric = {
    evidenceId: 'art_topic_nan',
    subject: 'vn.macro.cpi.yoy',
    value: 'not_a_number'
  };
  assert.equal(doesEvidenceSupportClaim(evNonNumeric, specificClaim), false, 'NaN string cannot support numeric claim');

  // 4. Observation with null value
  const obsNull = {
    factId: 'vn.macro.cpi.yoy',
    observationId: 'obs_null',
    value: null
  };
  assert.equal(doesEvidenceSupportClaim(obsNull, specificClaim), false, 'Observation with null value cannot support numeric claim');
});

test('24. Claim status transition alters strategist cache fingerprint', () => {
  const claim1 = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    supportStatus: CLAIM_STATUS.SUPPORTED,
    independentSourceCount: 1,
    contradictionCount: 0
  });

  const claimContradicted = createMarketClaim({
    ...claim1,
    supportStatus: CLAIM_STATUS.CONTRADICTED,
    contradictionCount: 1
  });

  const fp1 = computeStrategistFingerprint({
    claims: [claim1]
  });

  const fp2 = computeStrategistFingerprint({
    claims: [claimContradicted]
  });

  assert.notEqual(fp1, fp2, 'Claim status change must invalidate strategist cache fingerprint');
});

test('25. Array reordering of identical claims preserves strategist cache fingerprint', () => {
  const claimA = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    supportStatus: CLAIM_STATUS.SUPPORTED
  });

  const claimB = createMarketClaim({
    claimType: CLAIM_TYPES.MONETARY_NUMERIC,
    subject: 'vn.monetary.fx.sbv_central.usd_vnd',
    numericValue: 25240,
    unit: 'VND',
    referencePeriod: '2026-09-05',
    supportStatus: CLAIM_STATUS.SUPPORTED
  });

  const fpOrder1 = computeStrategistFingerprint({
    claims: [claimA, claimB]
  });

  const fpOrder2 = computeStrategistFingerprint({
    claims: [claimB, claimA]
  });

  assert.equal(fpOrder1, fpOrder2, 'Fingerprint must be invariant to order of claims in array');
});

test('26. 01D historical replay architectural boundary is documented in repository', () => {
  const repoPath = resolve(import.meta.dirname, '../src/claims/claimRepository.js');
  const repoContent = readFileSync(repoPath, 'utf8');

  assert.ok(repoContent.includes('ARCHITECTURAL BOUNDARY (01D Historical Replay)'), 'Boundary header must be present');
  assert.ok(repoContent.includes('point-in-time') || repoContent.includes('Point-in-time'), 'Point-in-time replay documentation must be present');
  assert.ok(repoContent.includes('claim_evidence_links'), 'Evidence links replay foundation must be mentioned');
});

// ============================================================
// NEW 01C.2 TESTS — Evidence Independence Correction
// ============================================================

import { resolveClaimDependency, isDependencyIndependent, INDEPENDENT_DEPENDENCY_GROUPS, CANONICAL_OFFICIAL_NSO_METRICS } from '../src/claims/sourceFamily.js';

test('27. Reuters unknown-origin + CafeF unknown-origin → NOT 2 independent sources', () => {
  const reutersEv = {
    evidenceId: 'art_reuters_uk',
    sourceFamily: SOURCE_FAMILIES.REUTERS,
    url: 'https://reuters.com/markets/vietnam-outlook',
    title: 'Vietnam market outlook for September'
    // No subject, no snippet, no explicit official attribution → UNKNOWN_DEPENDENCY
  };
  const cafefEv = {
    evidenceId: 'art_cafef_uk',
    sourceFamily: SOURCE_FAMILIES.CAFEF,
    url: 'https://cafef.vn/thi-truong.chn',
    title: 'Thị trường Việt Nam tháng 9'
    // No subject, no snippet, no explicit official attribution → UNKNOWN_DEPENDENCY
  };
  const agg = aggregateEvidenceSources([reutersEv, cafefEv]);
  assert.equal(agg.independentSourceCount, 0, 'Reuters unknown + CafeF unknown = 0 independent, NOT 2');
  assert.deepEqual(agg.independentFamilies, [], 'No independent dependency groups');
});

test('28. Recognized publisher alone → isIndependent=false when no provenance established', () => {
  const depGroup = resolveClaimDependency({
    publisherFamily: SOURCE_FAMILIES.REUTERS,
    subject: '',
    snippet: '',
    title: 'Vietnam market outlook'
  });
  assert.equal(depGroup, DEPENDENCY_GROUPS.UNKNOWN_DEPENDENCY, 'Reuters with no subject/snippet = UNKNOWN_DEPENDENCY');
  assert.equal(isDependencyIndependent(depGroup), false, 'isIndependent must be false for UNKNOWN_DEPENDENCY');
});

test('29. NSO + Reuters citing NSO + CafeF citing NSO → only one OFFICIAL_NSO dependency', () => {
  const evidence = [
    {
      evidenceId: 'obs_nso',
      factId: 'vn.macro.cpi.yoy',
      observationId: 'obs_nso_cpi_aug',
      value: 4.89,
      referenceTime: '2026-08',
      sourceFamily: SOURCE_FAMILIES.OFFICIAL_NSO,
      dependencyGroup: DEPENDENCY_GROUPS.OFFICIAL_NSO
    },
    {
      evidenceId: 'art_reuters_nso',
      sourceFamily: SOURCE_FAMILIES.REUTERS,
      snippet: 'Theo Tổng cục Thống kê, CPI tháng 8 tăng 4.89%',
      title: 'Vietnam CPI 4.89% per NSO'
    },
    {
      evidenceId: 'art_cafef_nso',
      sourceFamily: SOURCE_FAMILIES.CAFEF,
      snippet: 'Theo GSO, CPI tháng 8/2026 tăng 4.89% so với cùng kỳ',
      title: 'CPI tháng 8 tăng theo số liệu GSO'
    }
  ];
  const agg = aggregateEvidenceSources(evidence, { subject: 'vn.macro.cpi.yoy' });
  assert.equal(agg.independentSourceCount, 1, 'All three collapse to single OFFICIAL_NSO dependency group');
  assert.deepEqual(agg.independentFamilies, [DEPENDENCY_GROUPS.OFFICIAL_NSO]);
});

test('30. Commercial publisher with explicit NSO attribution collapses to OFFICIAL_NSO (not commercial dep)', () => {
  const dep = resolveClaimDependency({
    publisherFamily: SOURCE_FAMILIES.CAFEF,
    subject: 'vn.macro.cpi.yoy',
    snippet: 'Theo Tổng cục Thống kê, CPI tháng 8 tăng 4.89%'
  });
  assert.equal(dep, DEPENDENCY_GROUPS.OFFICIAL_NSO, 'Explicit NSO attribution in snippet collapses to OFFICIAL_NSO');
});

test('31. Commercial publisher without attribution and non-official subject stays UNKNOWN_DEPENDENCY', () => {
  const dep = resolveClaimDependency({
    publisherFamily: SOURCE_FAMILIES.CAFEF,
    subject: 'vn.news.general.market_sentiment',  // non-canonical, non-corporate, non-official
    snippet: '',
    title: 'CafeF: Thị trường chứng khoán hôm nay'
  });
  assert.equal(dep, DEPENDENCY_GROUPS.UNKNOWN_DEPENDENCY, 'CafeF with non-official subject and no provenance = UNKNOWN_DEPENDENCY');
  assert.equal(isDependencyIndependent(dep), false, 'Must not be independent');
});

test('32. Full article with NSO mention in unrelated paragraph does NOT make corporate claim OFFICIAL_NSO', () => {
  // Article paragraph 1 mentions NSO CPI; paragraph 4 is about corporate restructuring
  // Only the snippet (claim-local text) is used for dependency resolution
  const dep = resolveClaimDependency({
    publisherFamily: SOURCE_FAMILIES.CAFEF,
    subject: 'vn.issuer.abc.restructuring',
    claimType: 'CORPORATE_EVENT',
    // snippet is about the corporate claim specifically, NOT the NSO paragraph
    snippet: 'Công ty ABC công bố kế hoạch tái cơ cấu trong Q3/2026',
    title: 'ABC đẩy mạnh tái cơ cấu',
    // text contains NSO reference in an unrelated paragraph - must NOT contaminate this claim
    text: 'According to NSO, CPI was 4.89% in August. ... In other news, ABC announced restructuring.'
  });
  // Corporate claim must NOT be assigned OFFICIAL_NSO just because article mentions NSO elsewhere
  assert.notEqual(dep, DEPENDENCY_GROUPS.OFFICIAL_NSO, 'NSO mention in unrelated text must NOT contaminate corporate claim dependency');
  // The corporate subject should map to ISSUER_IR
  assert.equal(dep, DEPENDENCY_GROUPS.ISSUER_IR, 'Corporate event with corporate snippet must map to ISSUER_IR');
});

test('33. Claim-local NSO attribution in snippet correctly assigns CPI claim to OFFICIAL_NSO', () => {
  const dep = resolveClaimDependency({
    publisherFamily: SOURCE_FAMILIES.REUTERS,
    subject: 'vn.macro.cpi.yoy',
    snippet: 'Theo GSO (General Statistics Office), CPI tháng 8/2026 tăng 4.89%',
    title: 'Vietnam August CPI'
  });
  assert.equal(dep, DEPENDENCY_GROUPS.OFFICIAL_NSO, 'Claim-local snippet with GSO attribution → OFFICIAL_NSO');
});

test('34. Private CPI survey does NOT map to OFFICIAL_NSO', () => {
  const dep = resolveClaimDependency({
    publisherFamily: SOURCE_FAMILIES.CAFEF,
    subject: 'vn.macro.cpi.yoy',
    methodology: 'private_estimate',
    scope: 'private_survey',
    snippet: ''
  });
  assert.notEqual(dep, DEPENDENCY_GROUPS.OFFICIAL_NSO, 'Private estimate scope must NOT map to OFFICIAL_NSO');
  assert.equal(dep, DEPENDENCY_GROUPS.UNKNOWN_DEPENDENCY, 'Private estimate must yield UNKNOWN_DEPENDENCY');
});

test('35. Private-bank inflation estimate does NOT map to OFFICIAL_NSO', () => {
  const dep = resolveClaimDependency({
    publisherFamily: SOURCE_FAMILIES.CAFEF,
    subject: 'vn.macro.cpi.yoy',
    methodology: 'bank_forecast',
    snippet: ''
  });
  assert.notEqual(dep, DEPENDENCY_GROUPS.OFFICIAL_NSO, 'Bank forecast must not map to OFFICIAL_NSO');
  assert.equal(dep, DEPENDENCY_GROUPS.UNKNOWN_DEPENDENCY, 'Bank forecast must yield UNKNOWN_DEPENDENCY');
});

test('36. Canonical official CPI observation maps correctly to OFFICIAL_NSO', () => {
  assert.ok(CANONICAL_OFFICIAL_NSO_METRICS.has('vn.macro.cpi.yoy'), 'Canonical CPI metric must be in allowlist');
  const dep = resolveClaimDependency({
    publisherFamily: SOURCE_FAMILIES.OFFICIAL_NSO,
    subject: 'vn.macro.cpi.yoy'
  });
  assert.equal(dep, DEPENDENCY_GROUPS.OFFICIAL_NSO, 'Official NSO publisher + canonical metric = OFFICIAL_NSO');
});

test('37. Same evidence array in different orders produces identical independence counts and per-link assignments', () => {
  const evNSO = {
    evidenceId: 'obs_nso_37',
    factId: 'vn.macro.cpi.yoy',
    observationId: 'obs_nso_cpi_aug_37',
    value: 4.89,
    referenceTime: '2026-08',
    sourceFamily: SOURCE_FAMILIES.OFFICIAL_NSO,
    dependencyGroup: DEPENDENCY_GROUPS.OFFICIAL_NSO,
    subject: 'vn.macro.cpi.yoy'
  };
  // Reuters article explicitly subject-tagged with numericValue + referencePeriod so doesEvidenceSupportClaim matches
  const evReuters = {
    evidenceId: 'art_reuters_37',
    sourceFamily: SOURCE_FAMILIES.REUTERS,
    dependencyGroup: DEPENDENCY_GROUPS.OFFICIAL_NSO, // explicitly set: citing NSO
    snippet: 'Theo Tổng cục Thống kê, CPI tháng 8 tăng 4.89%',
    subject: 'vn.macro.cpi.yoy',
    referencePeriod: '2026-08',
    numericValue: 4.89
  };

  const claim = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    scope: 'monthly'
  });

  const r1 = reconcileClaims([claim], [evNSO, evReuters]);
  const r2 = reconcileClaims([claim], [evReuters, evNSO]);

  // Independence counts must be identical regardless of input order
  assert.equal(r1[0].claim.independentSourceCount, r2[0].claim.independentSourceCount, 'Order-invariant independent source count');

  // Per-link isIndependent assignments must be identical regardless of input order
  const nsoPosR1 = r1[0].supportingEvidence.find(e => e.evidenceId === 'obs_nso_37');
  const nsoPosR2 = r2[0].supportingEvidence.find(e => e.evidenceId === 'obs_nso_37');
  const reutersPosR1 = r1[0].supportingEvidence.find(e => e.evidenceId === 'art_reuters_37');
  const reutersPosR2 = r2[0].supportingEvidence.find(e => e.evidenceId === 'art_reuters_37');

  assert.ok(nsoPosR1, 'NSO evidence must be in supportingEvidence (ordering 1)');
  assert.ok(nsoPosR2, 'NSO evidence must be in supportingEvidence (ordering 2)');
  assert.ok(reutersPosR1, 'Reuters evidence must be in supportingEvidence (ordering 1)');
  assert.ok(reutersPosR2, 'Reuters evidence must be in supportingEvidence (ordering 2)');

  assert.equal(nsoPosR1.isIndependent, nsoPosR2.isIndependent, 'NSO link isIndependent must be same in both orderings');
  assert.equal(reutersPosR1.isIndependent, reutersPosR2.isIndependent, 'Reuters link isIndependent must be same in both orderings');

  // Observation always wins over article as representative (both map to OFFICIAL_NSO)
  assert.equal(nsoPosR1.isIndependent, true, 'Observation is always representative over article');
  assert.equal(reutersPosR1.isIndependent, false, 'Article citing same official origin is NOT the representative');
});

test('38. Official observation wins representative selection over secondary article in same dependency group', () => {
  const evArticle = {
    evidenceId: 'art_reuters_38',
    sourceFamily: SOURCE_FAMILIES.REUTERS,
    dependencyGroup: DEPENDENCY_GROUPS.OFFICIAL_NSO, // explicitly set: citing NSO
    snippet: 'Theo Tổng cục Thống kê, CPI tháng 8 tăng 4.89%',
    subject: 'vn.macro.cpi.yoy',
    referencePeriod: '2026-08',
    numericValue: 4.89
  };
  const evObs = {
    evidenceId: 'obs_nso_official_38',
    factId: 'vn.macro.cpi.yoy',
    observationId: 'obs_nso_aug_official_38',
    value: 4.89,
    referenceTime: '2026-08',
    sourceFamily: SOURCE_FAMILIES.OFFICIAL_NSO,
    dependencyGroup: DEPENDENCY_GROUPS.OFFICIAL_NSO,
    subject: 'vn.macro.cpi.yoy'
  };

  const claim = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    scope: 'monthly'
  });

  // Article comes first in array — but obs must still win as representative
  const reconciled = reconcileClaims([claim], [evArticle, evObs]);
  const obsLink = reconciled[0].supportingEvidence.find(e => e.evidenceId === 'obs_nso_official_38');
  const artLink = reconciled[0].supportingEvidence.find(e => e.evidenceId === 'art_reuters_38');

  assert.ok(obsLink, 'Observation evidence must be in supportingEvidence');
  assert.ok(artLink, 'Article evidence must be in supportingEvidence');
  assert.equal(obsLink.isIndependent, true, 'Observation is the deterministic representative (wins over article)');
  assert.equal(artLink.isIndependent, false, 'Article is NOT the representative even when it appears first in array');
});

test('39. null article numeric value does not support numeric zero claim', () => {
  const zeroClaim = createMarketClaim({
    claimType: CLAIM_TYPES.TRADE_NUMERIC,
    subject: 'vn.trade.goods.balance.month_usd',
    numericValue: 0,
    unit: 'USD',
    referencePeriod: '2026-07',
    scope: 'monthly'
  });

  const evNull = {
    evidenceId: 'art_null_val',
    subject: 'vn.trade.goods.balance.month_usd',
    referencePeriod: '2026-07',
    numericValue: null
  };
  assert.equal(doesEvidenceSupportClaim(evNull, zeroClaim), false, 'null numeric value must NOT coerce to 0 and support zero claim');
});

test('40. undefined numeric value does not support numeric claim', () => {
  const claim = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    subject: 'vn.macro.cpi.yoy',
    numericValue: 4.89,
    unit: '%',
    referencePeriod: '2026-08',
    scope: 'monthly_yoy'
  });

  const evUndef = {
    evidenceId: 'obs_undef',
    factId: 'vn.macro.cpi.yoy',
    observationId: 'obs_undef_1',
    value: undefined,
    referenceTime: '2026-08'
  };
  assert.equal(doesEvidenceSupportClaim(evUndef, claim), false, 'undefined numeric value must NOT support numeric claim');
});

test('41. Valid finite zero supports zero claim when all semantics match', () => {
  const zeroClaim = createMarketClaim({
    claimType: CLAIM_TYPES.TRADE_NUMERIC,
    subject: 'vn.trade.goods.balance.month_usd',
    numericValue: 0,
    unit: 'USD',
    referencePeriod: '2026-07',
    scope: 'monthly'
  });

  const evZero = {
    evidenceId: 'obs_zero',
    factId: 'vn.trade.goods.balance.month_usd',
    observationId: 'obs_zero_balance',
    value: 0,
    referenceTime: '2026-07'
  };
  assert.equal(doesEvidenceSupportClaim(evZero, zeroClaim), true, 'Explicit numeric 0 supports zero-valued claim when all semantics match');
});

test('42. Duplicate links are deduplicated in memory store on second persist call', async () => {
  const claim = createMarketClaim({
    claimType: CLAIM_TYPES.NEWS_ASSERTION,
    subject: 'vn.issuer.dedup_test',
    predicate: 'REPORTED',
    valueText: 'Deduplication test event'
  });

  const ev = {
    evidenceId: 'ev_dedup_42',
    evidenceType: 'article',
    sourceFamily: SOURCE_FAMILIES.UNKNOWN,
    dependencyGroup: DEPENDENCY_GROUPS.UNKNOWN_DEPENDENCY,
    isIndependent: false
  };

  await persistClaims([{ claim, supportingEvidence: [ev] }], null);
  // Second call with same evidence should NOT duplicate in memory
  await persistClaims([{ claim, supportingEvidence: [ev] }], null);

  const { getEvidenceLinksForClaim } = await import('../src/claims/claimRepository.js');
  const links = getEvidenceLinksForClaim(claim.claimId);
  const dedupLinks = links.filter(l => l.evidenceId === 'ev_dedup_42');
  assert.equal(dedupLinks.length, 1, 'Same evidence link must not be duplicated in memory store');
});

test('43. MARKET_DIRECT observation maps to valid MARKET_REFERENCE claim', () => {
  const obs = {
    factId: 'vn.market.vnindex.close',
    observationId: 'vn.market.vnindex.close:2026-09-04',
    pillar: 'market',
    value: 1853.08,
    unit: 'điểm',
    referenceTime: '2026-09-04',
    authorityLevel: 'MARKET_DIRECT',
    methodologyVersion: 'v1.3'
  };

  const extracted = extractClaimsFromObservation(obs);
  assert.equal(extracted.length, 1);
  assert.equal(extracted[0].claim.authorityLevel, CLAIM_AUTHORITY_LEVELS.MARKET_REFERENCE, 'MARKET_DIRECT must map to MARKET_REFERENCE');
  assert.equal(extracted[0].claim.subject, 'vn.market.vnindex.close');
  assert.equal(extracted[0].claim.numericValue, 1853.08);
});

test('44. Standard observation authority levels (PRIMARY_OFFICIAL, REGULATORY_OFFICIAL, MARKET_REFERENCE) remain unchanged', () => {
  for (const auth of [CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL, CLAIM_AUTHORITY_LEVELS.REGULATORY_OFFICIAL, CLAIM_AUTHORITY_LEVELS.MARKET_REFERENCE]) {
    const obs = {
      factId: 'vn.macro.indicator',
      observationId: `obs_${auth}`,
      pillar: 'macro',
      value: 5.5,
      unit: '%',
      referenceTime: '2026-08',
      authorityLevel: auth,
      methodologyVersion: 'v1.3'
    };
    const extracted = extractClaimsFromObservation(obs);
    assert.equal(extracted[0].claim.authorityLevel, auth, `${auth} must remain unchanged`);
  }
});

test('45. Unknown unsupported authority is rejected and NOT silently upgraded', () => {
  const obs = {
    factId: 'vn.market.unknown',
    observationId: 'obs_unknown_auth',
    pillar: 'market',
    value: 100,
    unit: 'points',
    referenceTime: '2026-09-04',
    authorityLevel: 'BOGUS_UNSUPPORTED_AUTHORITY',
    methodologyVersion: 'v1.3'
  };

  assert.throws(() => {
    extractClaimsFromObservation(obs);
  }, /INVALID_AUTHORITY_LEVEL: "BOGUS_UNSUPPORTED_AUTHORITY"/, 'Unknown authority must fail closed and never silently map to MARKET_REFERENCE');

  assert.throws(() => {
    createMarketClaim({
      claimType: CLAIM_TYPES.MARKET_EVENT,
      subject: 'test',
      numericValue: 100,
      authorityLevel: 'FABRICATED_LEVEL'
    });
  }, /INVALID_AUTHORITY_LEVEL: "FABRICATED_LEVEL"/, 'createMarketClaim must reject fabricated authority');
});

test('46. buildMarketStrategistFactPacket succeeds with real-shaped MARKET_DIRECT VN-Index/HNX observations', () => {
  const marketObservations = [
    {
      id: 'vn.market.vnindex.close',
      factId: 'vn.market.vnindex.close',
      observationId: 'vn.market.vnindex.close:2026-09-04:pub_2026-09-04T000000000Z',
      pillar: 'market',
      label: 'VN-Index',
      metric: 'Chỉ số VN-Index (đóng cửa phiên)',
      value: 1853.08,
      unit: 'điểm',
      referenceTime: '2026-09-04',
      observedAt: '2026-09-04T00:00:00.000Z',
      publishedAt: '2026-09-04T00:00:00.000Z',
      source: 'VNDIRECT',
      authorityLevel: 'MARKET_DIRECT',
      methodologyVersion: 'v1.2'
    },
    {
      id: 'vn.market.hnx.close',
      factId: 'vn.market.hnx.close',
      observationId: 'vn.market.hnx.close:2026-09-04:pub_2026-09-04T000000000Z',
      pillar: 'market',
      label: 'HNX-Index',
      metric: 'Chỉ số HNX-Index (đóng cửa phiên)',
      value: 282.53,
      unit: 'điểm',
      referenceTime: '2026-09-04',
      observedAt: '2026-09-04T00:00:00.000Z',
      publishedAt: '2026-09-04T00:00:00.000Z',
      source: 'VNDIRECT',
      authorityLevel: 'MARKET_DIRECT',
      methodologyVersion: 'v1.2'
    }
  ];

  const packet = buildMarketStrategistFactPacket({
    marketObservations,
    newsArticles: [],
    now: new Date('2026-09-06T09:00:00.000Z')
  });

  assert.ok(packet, 'Fact packet must build successfully');
  assert.equal(packet.evidence.length, 2, 'Must include both observations in evidence');
  assert.equal(packet.claims.length, 2, 'Must extract 2 claims from observations');
  for (const claim of packet.claims) {
    assert.equal(claim.authorityLevel, CLAIM_AUTHORITY_LEVELS.MARKET_REFERENCE, 'All extracted market claims must have valid authorityLevel');
  }
});
