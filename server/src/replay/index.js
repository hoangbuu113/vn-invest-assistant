/**
 * Historical As-of Replay Module (01D.1)
 */

export {
  resolveEvidenceAvailabilityTime,
  AVAILABILITY_CLASSIFICATION,
  isReplaySafeAvailability
} from './availability.js';

export {
  buildHistoricalEvidencePacket,
  REPLAY_POLICY_VERSION
} from './historicalReplay.js';

export {
  runStrategyShadowReplay,
  computeShadowReplayMetrics,
  formatShadowReplaySummary,
  SHADOW_REPLAY_POLICY_VERSION
} from '../ai/strategyShadowReplay.js';
