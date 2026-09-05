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
  buildMarketStrategistFactPacket,
  generateDeterministicMarketStrategist
} from '../src/ai/marketStrategistEngine.js';

import {
  validateClaimIntegrity,
  applySharedPublicationGate
} from '../src/ai/marketStrategistValidation.js';

test('1. Identical claim from same source family counts once for independence', () => {
  const ev1 = {
    evidenceId: 'art_1',
    sourceFamily: SOURCE_FAMILIES.CAFEF,
    url: 'https://cafef.vn/bai-1.chn'
  };
  const ev2 = {
    evidenceId: 'art_2',
    sourceFamily: SOURCE_FAMILIES.CAFEF,
    url: 'https://cafef.vn/bai-2.chn'
  };

  const agg = aggregateEvidenceSources([ev1, ev2]);
  assert.equal(agg.sourceCount, 2, 'Total evidence items is 2');
  assert.equal(agg.independentSourceCount, 1, 'Only 1 independent source family');
  assert.deepEqual(agg.independentFamilies, [SOURCE_FAMILIES.CAFEF]);
});

test('2. Three articles copying same family do not become 3 corroborations', () => {
  const art1 = {
    evidenceId: 'art_1',
    url: 'https://cafef.vn/cpi-tang.chn',
    sourceId: 'cafef',
    title: 'CPI tháng 8 tăng 4.89%'
  };
  const art2 = {
    evidenceId: 'art_2',
    url: 'https://cafef.vn/phan-tich-cpi.chn',
    sourceId: 'cafef',
    title: 'Phân tích CPI tháng 8 tăng 4.89%'
  };
  const art3 = {
    evidenceId: 'art_3',
    url: 'https://tin-tuc-tong-hop.vn/bai.html',
    sourceId: 'aggregator',
    title: 'Theo CafeF: CPI tháng 8 tăng 4.89%',
    summary: 'Nguồn: CafeF'
  };

  const agg = aggregateEvidenceSources([art1, art2, art3]);
  assert.equal(agg.sourceCount, 3, 'Total sources is 3');
  assert.equal(agg.independentSourceCount, 1, 'Syndicated aggregator collapses into CafeF dependency group');
  assert.deepEqual(agg.independentFamilies, [SOURCE_FAMILIES.CAFEF]);
});

test('3. Two genuinely independent source families corroborate', () => {
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
    title: 'Vietnam CPI rises 4.89% in August',
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
      sourceFamily: SOURCE_FAMILIES.OFFICIAL_NSO
    },
    {
      evidenceId: 'art_reuters_1',
      url: 'https://reuters.com/article',
      sourceId: 'reuters',
      title: 'Vietnam CPI tháng 8 tăng 4.89%',
      sourceFamily: SOURCE_FAMILIES.REUTERS
    }
  ];

  const reconciled = reconcileClaims([claimNSO, claimReuters], evidence);
  const corroboratedClaim = reconciled.find((r) => r.claim.authorityLevel === CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL);
  assert.ok(corroboratedClaim, 'NSO claim exists');
  assert.equal(corroboratedClaim.claim.independentSourceCount, 2);
  assert.equal(corroboratedClaim.claim.supportStatus, CLAIM_STATUS.CORROBORATED);
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
