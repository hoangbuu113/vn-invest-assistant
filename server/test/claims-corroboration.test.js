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

test('3B. Two genuinely independent source families corroborate', () => {
  const issuerClaim = createMarketClaim({
    claimType: CLAIM_TYPES.CORPORATE_EVENT,
    subject: 'vn.issuer.vnm.restructuring',
    predicate: 'ANNOUNCED',
    valueText: 'Approved restructuring plan',
    scope: 'corporate_action',
    authorityLevel: CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL
  });

  const ev1 = {
    evidenceId: 'ir_release_1',
    subject: 'vn.issuer.vnm.restructuring',
    sourceFamily: SOURCE_FAMILIES.ISSUER_IR,
    dependencyGroup: DEPENDENCY_GROUPS.ISSUER_IR,
    title: 'Vinamilk công bố phương án tái cấu trúc'
  };

  const ev2 = {
    evidenceId: 'market_investigation_1',
    subject: 'vn.issuer.vnm.restructuring',
    sourceFamily: SOURCE_FAMILIES.CAFEF,
    dependencyGroup: DEPENDENCY_GROUPS.CAFEF,
    title: 'CafeF độc quyền: Chi tiết lộ trình tái cấu trúc của Vinamilk'
  };

  const reconciled = reconcileClaims([issuerClaim], [ev1, ev2]);
  assert.equal(reconciled[0].claim.independentSourceCount, 2, 'Two genuinely independent primary sources yield count = 2');
  assert.equal(reconciled[0].claim.supportStatus, CLAIM_STATUS.CORROBORATED, 'Independent sources corroborate');
  assert.deepEqual(reconciled[0].independentFamilies, [DEPENDENCY_GROUPS.CAFEF, DEPENDENCY_GROUPS.ISSUER_IR]);
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
