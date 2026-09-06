import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  evaluateAndApplyStrategyStability
} from '../src/ai/strategyStabilityService.js';
import {
  clearStabilityMemoryStore,
  getCurrentPublishedStrategy,
  publishStrategyVersionAtomic,
  strategyVersionToRow
} from '../src/ai/strategyStabilityRepository.js';
import {
  createStrategyVersion,
  computeDecisionFingerprint,
  STRATEGY_LIFECYCLE_STATES,
  EVALUATION_STATUSES,
  ASSESSMENT_RESULTS,
  DATA_QUALITY_STATES
} from '../src/ai/strategyStabilityModel.js';
import {
  buildMarketStrategistFactPacket,
  generateDeterministicMarketStrategist,
  globalMarketStrategistRuntime
} from '../src/ai/marketStrategistEngine.js';

describe('V1.3 Strategy Stability — Phase 2.2 Production Memory Fallback Removal Suite', { concurrency: 1 }, () => {
  beforeEach(() => {
    clearStabilityMemoryStore();
    globalMarketStrategistRuntime.clear();
  });

  const baseFact = {
    id: 'vn.macro.cpi.yoy:2026-08:pub_1',
    observationId: 'vn.macro.cpi.yoy:2026-08:pub_1',
    factId: 'vn.macro.cpi.yoy',
    pillar: 'macro',
    metric: 'Chỉ số giá tiêu dùng CPI (so với cùng kỳ)',
    label: 'Lạm phát CPI (YoY)',
    value: 3.45,
    unit: '%',
    status: 'available',
    freshness: 'fresh',
    source: 'GSO',
    dependencyGroup: 'OFFICIAL_NSO',
    period: '2026-08',
    observedAt: '2026-08-31T00:00:00.000Z',
    publishedAt: '2026-09-01T02:00:00.000Z'
  };

  const baseNews = {
    articleId: 'art_transport_1',
    title: 'Doanh nghiệp cảng biển ghi nhận tăng trưởng sản lượng',
    summary: 'Sản lượng hàng hóa thông qua cảng biển tăng trưởng ổn định theo thống kê quý.',
    source: 'CafeF',
    dependencyGroup: 'CAFEF',
    url: 'https://cafef.vn/cang-bien.chn',
    publishedAt: '2026-09-01T03:00:00.000Z',
    geography: 'vietnam'
  };

  function buildValidPacket(obsList = [baseFact], newsList = [baseNews], customNow = new Date('2026-09-01T10:00:00.000Z')) {
    return buildMarketStrategistFactPacket({
      marketObservations: obsList,
      newsArticles: newsList,
      now: customNow
    });
  }

  function createValidCandidate(packet, overrides = {}) {
    const candidate = generateDeterministicMarketStrategist({ factPacket: packet, now: packet.now || new Date() });
    return {
      ...candidate,
      confidence: 'MEDIUM',
      regime: candidate.marketRegime || { status: 'NORMAL', directionalStance: 'NEUTRAL' },
      ...overrides
    };
  }

  async function seedPublishedStrategy(options = {}) {
    const packet = buildValidPacket();
    const candidate = createValidCandidate(packet, options.candidateOverrides || {});
    const decisionFp = computeDecisionFingerprint(candidate);
    const version = createStrategyVersion({
      strategyId: 'strat_seed_p2_2',
      previousStrategyId: null,
      generatedAt: candidate.generatedAt || '2026-09-01T10:00:00.000Z',
      publishedAt: candidate.generatedAt || '2026-09-01T10:00:00.000Z',
      dataAsOf: candidate.dataAsOf || '2026-09-01T10:00:00.000Z',
      evidenceFingerprint: 'evidence_fp_initial_v1',
      decisionFingerprint: decisionFp,
      triggerReason: { type: 'INITIAL_SEED' },
      materialChanges: ['INITIAL_SEED'],
      confidence: 'MEDIUM',
      regime: candidate.regime,
      executiveDecision: candidate.executiveDecision,
      assetStrategy: candidate.assetStrategy,
      preferredThemes: candidate.preferredThemes,
      avoidOrUnderweight: candidate.avoidOrUnderweight,
      riskOverlay: candidate.riskOverlay,
      horizon: candidate.horizon,
      invalidationConditions: candidate.invalidationConditions,
      status: 'published',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY,
      rawOutput: candidate
    });

    await publishStrategyVersionAtomic({
      newVersion: version,
      expectedCurrentStrategyId: null
    }, null);

    return { version, packet, candidate };
  }

  // 1. client === null -> memory atomic publication remains supported
  test('1. client === null -> memory atomic publication remains supported', async () => {
    const { version: v1, packet } = await seedPublishedStrategy();
    const candidate2 = createValidCandidate(packet);
    const v2 = createStrategyVersion({
      strategyId: 'strat_p2_2_v2',
      previousStrategyId: v1.strategyId,
      generatedAt: '2026-09-02T10:00:00.000Z',
      publishedAt: '2026-09-02T10:00:00.000Z',
      dataAsOf: '2026-09-02T10:00:00.000Z',
      evidenceFingerprint: 'fp_v2',
      decisionFingerprint: computeDecisionFingerprint(candidate2),
      triggerReason: { type: 'UPDATE' },
      materialChanges: ['UPDATE'],
      confidence: 'MEDIUM',
      regime: candidate2.regime,
      executiveDecision: candidate2.executiveDecision,
      assetStrategy: candidate2.assetStrategy,
      preferredThemes: candidate2.preferredThemes,
      avoidOrUnderweight: candidate2.avoidOrUnderweight,
      riskOverlay: candidate2.riskOverlay,
      horizon: candidate2.horizon,
      invalidationConditions: candidate2.invalidationConditions,
      status: 'published',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY
    });

    const result = await publishStrategyVersionAtomic({
      newVersion: v2,
      expectedCurrentStrategyId: v1.strategyId
    }, null);

    assert.equal(result.isDurable, false, 'Memory-only publication must report isDurable: false');
    assert.equal(result.strategy.strategyId, 'strat_p2_2_v2');

    const current = await getCurrentPublishedStrategy(null);
    assert.equal(current.strategyId, 'strat_p2_2_v2');

    const repo = await import('../src/ai/strategyStabilityRepository.js');
    const oldRow = await repo.getStrategyVersionById(v1.strategyId, null);
    assert.equal(oldRow.status, 'superseded', 'Old strategy must be superseded in memory');
  });

  // 2. real/mock client returns PGRST202 -> executeMemoryAtomic is NOT used -> deterministic RPC unavailable error is surfaced
  test('2. real/mock client returns PGRST202 -> deterministic RPC unavailable error is surfaced', async () => {
    const { version: v1, packet } = await seedPublishedStrategy();
    const candidate2 = createValidCandidate(packet);
    const v2 = createStrategyVersion({
      strategyId: 'strat_p2_2_phantom',
      previousStrategyId: v1.strategyId,
      generatedAt: '2026-09-02T10:00:00.000Z',
      publishedAt: '2026-09-02T10:00:00.000Z',
      dataAsOf: '2026-09-02T10:00:00.000Z',
      evidenceFingerprint: 'fp_v2',
      decisionFingerprint: computeDecisionFingerprint(candidate2),
      triggerReason: { type: 'UPDATE' },
      materialChanges: ['UPDATE'],
      confidence: 'MEDIUM',
      regime: candidate2.regime,
      executiveDecision: candidate2.executiveDecision,
      assetStrategy: candidate2.assetStrategy,
      preferredThemes: candidate2.preferredThemes,
      avoidOrUnderweight: candidate2.avoidOrUnderweight,
      riskOverlay: candidate2.riskOverlay,
      horizon: candidate2.horizon,
      invalidationConditions: candidate2.invalidationConditions,
      status: 'published',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY
    });

    const mockClient = {
      rpc: async (fnName) => {
        assert.equal(fnName, 'publish_strategy_version_atomic');
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message: 'Could not find the function public.publish_strategy_version_atomic in the schema cache'
          }
        };
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ data: [strategyVersionToRow(v1)], error: null })
            })
          }),
          order: () => ({
            limit: () => ({ data: [strategyVersionToRow(v1)], error: null })
          })
        })
      })
    };

    await assert.rejects(async () => {
      await publishStrategyVersionAtomic({
        newVersion: v2,
        expectedCurrentStrategyId: v1.strategyId
      }, mockClient);
    }, (err) => {
      assert.equal(err.code, 'PGRST202');
      assert.equal(err.isRpcMissing, true);
      assert.ok(err.message.includes('STRATEGY_PUBLICATION_RPC_UNAVAILABLE'));
      assert.ok(err.cause);
      return true;
    });
  });

  // 3. PGRST202 does not create a new memory strategy version
  test('3. PGRST202 does not create a new memory strategy version', async () => {
    const { version: v1, packet } = await seedPublishedStrategy();
    const candidate2 = createValidCandidate(packet);
    const v2 = createStrategyVersion({
      strategyId: 'strat_p2_2_phantom_v2',
      previousStrategyId: v1.strategyId,
      generatedAt: '2026-09-02T10:00:00.000Z',
      publishedAt: '2026-09-02T10:00:00.000Z',
      dataAsOf: '2026-09-02T10:00:00.000Z',
      evidenceFingerprint: 'fp_v2',
      decisionFingerprint: computeDecisionFingerprint(candidate2),
      triggerReason: { type: 'UPDATE' },
      materialChanges: ['UPDATE'],
      confidence: 'MEDIUM',
      regime: candidate2.regime,
      executiveDecision: candidate2.executiveDecision,
      assetStrategy: candidate2.assetStrategy,
      preferredThemes: candidate2.preferredThemes,
      avoidOrUnderweight: candidate2.avoidOrUnderweight,
      riskOverlay: candidate2.riskOverlay,
      horizon: candidate2.horizon,
      invalidationConditions: candidate2.invalidationConditions,
      status: 'published',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY
    });

    const mockClient = {
      rpc: async () => ({
        data: null,
        error: { code: 'PGRST202', message: 'Schema cache missing function' }
      }),
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ data: [strategyVersionToRow(v1)], error: null })
            })
          }),
          order: () => ({
            limit: () => ({ data: [strategyVersionToRow(v1)], error: null })
          })
        })
      })
    };

    try {
      await publishStrategyVersionAtomic({
        newVersion: v2,
        expectedCurrentStrategyId: v1.strategyId
      }, mockClient);
    } catch {
      // Expected to fail
    }

    const current = await getCurrentPublishedStrategy(null);
    assert.equal(current.strategyId, v1.strategyId, 'Current published strategy in memory must remain v1');
    assert.equal(current.status, 'published');

    const repo = await import('../src/ai/strategyStabilityRepository.js');
    const phantomRow = await repo.getStrategyVersionById(v2.strategyId, null);
    assert.equal(phantomRow, null, 'Phantom version must NOT exist in memory store');
  });

  // 4. old published strategy remains authoritative after RPC unavailable failure
  test('4. old published strategy remains authoritative after RPC unavailable failure', async () => {
    const { version: v1 } = await seedPublishedStrategy();

    const mockClient = {
      rpc: async () => ({
        data: null,
        error: { code: 'PGRST202', message: 'function publish_strategy_version_atomic does not exist' }
      }),
      from: (table) => {
        if (table === 'strategy_assessments') {
          return {
            upsert: async () => ({ error: null }),
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({ data: [], error: null })
                })
              }),
              order: () => ({
                limit: () => ({ data: [], error: null })
              })
            })
          };
        }
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({ data: [strategyVersionToRow(v1)], error: null })
              })
            }),
            order: () => ({
              limit: () => ({ data: [strategyVersionToRow(v1)], error: null })
            })
          })
        };
      }
    };

    const factPacket = buildValidPacket([{ ...baseFact, revision: 'revised' }]);

    const result = await evaluateAndApplyStrategyStability({
      factPacket,
      allowLlm: true,
      client: mockClient,
      generateLlmFn: async () => {
        const c = generateDeterministicMarketStrategist({ factPacket });
        const newStance = c.executiveDecision.stance === 'defensive' ? 'risk_on' : 'defensive';
        return {
          ...c,
          executiveDecision: {
            ...c.executiveDecision,
            stance: newStance
          }
        };
      }
    });

    assert.equal(result.strategyId, v1.strategyId, 'Authoritative strategy returned must be the old strategy');
    assert.equal(result.publishedAt, v1.publishedAt);
  });

  // 5. service does not return PUBLISH_NEW success after RPC unavailable failure
  test('5. service does not return PUBLISH_NEW success after RPC unavailable failure', async () => {
    const { version: v1 } = await seedPublishedStrategy();

    const mockClient = {
      rpc: async () => ({
        data: null,
        error: { code: 'PGRST202', message: 'RPC not available' }
      }),
      from: (table) => {
        if (table === 'strategy_assessments') {
          return {
            upsert: async () => ({ error: null }),
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({ data: [], error: null })
                })
              }),
              order: () => ({
                limit: () => ({ data: [], error: null })
              })
            })
          };
        }
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({ data: [strategyVersionToRow(v1)], error: null })
              })
            }),
            order: () => ({
              limit: () => ({ data: [strategyVersionToRow(v1)], error: null })
            })
          })
        };
      }
    };

    const factPacket = buildValidPacket([{ ...baseFact, revision: 'revised' }]);

    const result = await evaluateAndApplyStrategyStability({
      factPacket,
      allowLlm: true,
      client: mockClient,
      generateLlmFn: async () => {
        const c = generateDeterministicMarketStrategist({ factPacket });
        const newStance = c.executiveDecision.stance === 'defensive' ? 'risk_on' : 'defensive';
        return {
          ...c,
          executiveDecision: {
            ...c.executiveDecision,
            stance: newStance
          }
        };
      }
    });

    assert.notEqual(result.latestAssessmentResult, ASSESSMENT_RESULTS.PUBLISH_NEW, 'Must NOT report PUBLISH_NEW');
    assert.equal(result.latestAssessmentResult, null);
    assert.equal(result.latestAssessmentStatus, EVALUATION_STATUSES.FAILED);
  });

  // 6. reviewPending / incomplete operational metadata remains truthful
  test('6. reviewPending / incomplete operational metadata remains truthful', async () => {
    const { version: v1 } = await seedPublishedStrategy();

    const mockClient = {
      rpc: async () => ({
        data: null,
        error: { code: 'PGRST202', message: 'Function not deployed' }
      }),
      from: (table) => {
        if (table === 'strategy_assessments') {
          return {
            upsert: async () => ({ error: null }),
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({ data: [], error: null })
                })
              }),
              order: () => ({
                limit: () => ({ data: [], error: null })
              })
            })
          };
        }
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({ data: [strategyVersionToRow(v1)], error: null })
              })
            }),
            order: () => ({
              limit: () => ({ data: [strategyVersionToRow(v1)], error: null })
            })
          })
        };
      }
    };

    const factPacket = buildValidPacket([{ ...baseFact, revision: 'revised' }]);

    const result = await evaluateAndApplyStrategyStability({
      factPacket,
      allowLlm: true,
      client: mockClient,
      generateLlmFn: async () => {
        const c = generateDeterministicMarketStrategist({ factPacket });
        const newStance = c.executiveDecision.stance === 'defensive' ? 'risk_on' : 'defensive';
        return {
          ...c,
          executiveDecision: {
            ...c.executiveDecision,
            stance: newStance
          }
        };
      }
    });

    assert.equal(result.reviewPending, true, 'reviewPending must be true');
    assert.equal(result.lifecycleState, STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED, 'lifecycleState must be REVIEW_REQUIRED, not STABLE');
    assert.ok(result.publicationError?.includes('STRATEGY_PUBLICATION_RPC_UNAVAILABLE'));
    assert.equal(result.lastAssessment.evaluationStatus, EVALUATION_STATUSES.FAILED);
    assert.equal(result.lastAssessment.result, ASSESSMENT_RESULTS.KEEP);
    assert.equal(result.lastAssessment.lifecycleState, STRATEGY_LIFECYCLE_STATES.REVIEW_REQUIRED);
  });

  // 7. generic DB error with client !== null also does not fall back to memory
  test('7. generic DB error with client !== null also does not fall back to memory', async () => {
    const { version: v1, packet } = await seedPublishedStrategy();
    const candidate2 = createValidCandidate(packet);
    const v2 = createStrategyVersion({
      strategyId: 'strat_p2_2_generic_db_err',
      previousStrategyId: v1.strategyId,
      generatedAt: '2026-09-02T10:00:00.000Z',
      publishedAt: '2026-09-02T10:00:00.000Z',
      dataAsOf: '2026-09-02T10:00:00.000Z',
      evidenceFingerprint: 'fp_v2',
      decisionFingerprint: computeDecisionFingerprint(candidate2),
      triggerReason: { type: 'UPDATE' },
      materialChanges: ['UPDATE'],
      confidence: 'MEDIUM',
      regime: candidate2.regime,
      executiveDecision: candidate2.executiveDecision,
      assetStrategy: candidate2.assetStrategy,
      preferredThemes: candidate2.preferredThemes,
      avoidOrUnderweight: candidate2.avoidOrUnderweight,
      riskOverlay: candidate2.riskOverlay,
      horizon: candidate2.horizon,
      invalidationConditions: candidate2.invalidationConditions,
      status: 'published',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY
    });

    const mockClient = {
      rpc: async () => ({
        data: null,
        error: { code: '42501', message: 'permission denied for function publish_strategy_version_atomic' }
      }),
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ data: [strategyVersionToRow(v1)], error: null })
            })
          }),
          order: () => ({
            limit: () => ({ data: [strategyVersionToRow(v1)], error: null })
          })
        })
      })
    };

    await assert.rejects(async () => {
      await publishStrategyVersionAtomic({
        newVersion: v2,
        expectedCurrentStrategyId: v1.strategyId
      }, mockClient);
    }, (err) => {
      assert.equal(err.code, '42501');
      return true;
    });

    const current = await getCurrentPublishedStrategy(null);
    assert.equal(current.strategyId, v1.strategyId, 'Memory store must not adopt new version on DB error');
  });

  // 8. STRATEGY_VERSION_CONFLICT behavior remains unchanged
  test('8. STRATEGY_VERSION_CONFLICT behavior remains unchanged', async () => {
    const { version: v1, packet } = await seedPublishedStrategy();
    const candidate2 = createValidCandidate(packet);
    const v2 = createStrategyVersion({
      strategyId: 'strat_p2_2_conflict',
      previousStrategyId: v1.strategyId,
      generatedAt: '2026-09-02T10:00:00.000Z',
      publishedAt: '2026-09-02T10:00:00.000Z',
      dataAsOf: '2026-09-02T10:00:00.000Z',
      evidenceFingerprint: 'fp_v2',
      decisionFingerprint: computeDecisionFingerprint(candidate2),
      triggerReason: { type: 'UPDATE' },
      materialChanges: ['UPDATE'],
      confidence: 'MEDIUM',
      regime: candidate2.regime,
      executiveDecision: candidate2.executiveDecision,
      assetStrategy: candidate2.assetStrategy,
      preferredThemes: candidate2.preferredThemes,
      avoidOrUnderweight: candidate2.avoidOrUnderweight,
      riskOverlay: candidate2.riskOverlay,
      horizon: candidate2.horizon,
      invalidationConditions: candidate2.invalidationConditions,
      status: 'published',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY
    });

    const mockClient = {
      rpc: async () => ({
        data: null,
        error: { code: 'P0001', message: 'STRATEGY_VERSION_CONFLICT: Expected published strategy strat_other' }
      }),
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ data: [strategyVersionToRow(v1)], error: null })
            })
          }),
          order: () => ({
            limit: () => ({ data: [strategyVersionToRow(v1)], error: null })
          })
        })
      })
    };

    await assert.rejects(async () => {
      await publishStrategyVersionAtomic({
        newVersion: v2,
        expectedCurrentStrategyId: v1.strategyId
      }, mockClient);
    }, (err) => {
      assert.equal(err.code, 'P0001');
      assert.equal(err.isConflict, true);
      assert.ok(err.message.includes('STRATEGY_VERSION_CONFLICT'));
      return true;
    });
  });

  // 9. successful RPC publication still works
  test('9. successful RPC publication still works', async () => {
    const { version: v1, packet } = await seedPublishedStrategy();
    const candidate2 = createValidCandidate(packet);
    const v2 = createStrategyVersion({
      strategyId: 'strat_p2_2_success',
      previousStrategyId: v1.strategyId,
      generatedAt: '2026-09-02T10:00:00.000Z',
      publishedAt: '2026-09-02T10:00:00.000Z',
      dataAsOf: '2026-09-02T10:00:00.000Z',
      evidenceFingerprint: 'fp_v2',
      decisionFingerprint: computeDecisionFingerprint(candidate2),
      triggerReason: { type: 'UPDATE' },
      materialChanges: ['UPDATE'],
      confidence: 'MEDIUM',
      regime: candidate2.regime,
      executiveDecision: candidate2.executiveDecision,
      assetStrategy: candidate2.assetStrategy,
      preferredThemes: candidate2.preferredThemes,
      avoidOrUnderweight: candidate2.avoidOrUnderweight,
      riskOverlay: candidate2.riskOverlay,
      horizon: candidate2.horizon,
      invalidationConditions: candidate2.invalidationConditions,
      status: 'published',
      lifecycleState: STRATEGY_LIFECYCLE_STATES.STABLE,
      dataQualityState: DATA_QUALITY_STATES.HEALTHY
    });

    const mockClient = {
      rpc: async (fnName, params) => {
        assert.equal(fnName, 'publish_strategy_version_atomic');
        assert.equal(params.p_expected_current_strategy_id, v1.strategyId);
        return {
          data: strategyVersionToRow(v2),
          error: null
        };
      },
      from: (table) => {
        if (table === 'strategy_assessments') {
          return {
            upsert: async () => ({ error: null }),
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({ data: [], error: null })
                })
              }),
              order: () => ({
                limit: () => ({ data: [], error: null })
              })
            })
          };
        }
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({ data: [strategyVersionToRow(v2)], error: null })
              })
            }),
            order: () => ({
              limit: () => ({ data: [strategyVersionToRow(v2)], error: null })
            })
          })
        };
      }
    };

    const pubResult = await publishStrategyVersionAtomic({
      newVersion: v2,
      expectedCurrentStrategyId: v1.strategyId
    }, mockClient);

    assert.equal(pubResult.isDurable, true, 'Must report isDurable: true on DB commit');
    assert.equal(pubResult.strategy.strategyId, 'strat_p2_2_success');

    const currentMem = await getCurrentPublishedStrategy(null);
    assert.equal(currentMem.strategyId, 'strat_p2_2_success', 'Memory must mirror successful DB publication');
  });

  // 10. no duplicate publication write path is reintroduced
  test('10. no duplicate publication write path is reintroduced', async () => {
    const servicePath = fs.existsSync('server/src/ai/strategyStabilityService.js')
      ? 'server/src/ai/strategyStabilityService.js'
      : 'src/ai/strategyStabilityService.js';
    const content = fs.readFileSync(servicePath, 'utf8');

    // Count calls to publishStrategyVersionAtomic
    const publishMatches = content.match(/publishStrategyVersionAtomic\(/g) || [];
    assert.equal(publishMatches.length, 2, 'Must have exactly 2 publication sites: cold-start and decision change');

    // Ensure persistStrategyVersion is not called in strategyStabilityService
    const persistVersionMatches = content.match(/persistStrategyVersion\(/g) || [];
    assert.equal(persistVersionMatches.length, 0, 'persistStrategyVersion must NOT be called in strategyStabilityService');
  });
});
