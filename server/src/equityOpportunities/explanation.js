import { EQUITY_QUALIFICATION_STATUS } from './model.js';

const EXPLAINABLE_STATUSES = new Set([
  EQUITY_QUALIFICATION_STATUS.QUALIFIED,
  EQUITY_QUALIFICATION_STATUS.WATCH
]);

const FORBIDDEN_LANGUAGE = /\b(?:buy|sell|hold|score|recommendation|confidence|probability|target\s+price|expected\s+return)\b|\b(?:mua|bán|giữ|điểm\s+số|khuyến\s+nghị|độ\s+tin\s+cậy|xác\s+suất|giá\s+mục\s+tiêu)\b/iu;
const NUMERICAL_CLAIM = /\d|[%₫$€£¥]/u;

function deterministicFallback(candidate, reason = null) {
  if (!EXPLAINABLE_STATUSES.has(candidate?.qualificationStatus)) {
    return Object.freeze({
      status: 'not_applicable',
      generationMode: 'deterministic_fallback',
      reason: 'DETERMINISTIC_STATUS_NOT_EXPLAINABLE',
      summary: null,
      supportingEvidence: Object.freeze([]),
      missingRequirements: Object.freeze([...(candidate?.missingRequirements || [])]),
      limitations: Object.freeze(['STRUCTURAL_EVIDENCE_SCREEN_ONLY'])
    });
  }

  const primaryReason = candidate.qualificationReasons[0];
  return Object.freeze({
    status: 'available',
    generationMode: 'deterministic_fallback',
    reason,
    summary: Object.freeze({
      text: `${candidate.symbol} is retained for evidence monitoring because a validated completed close is available.`,
      evidenceRefs: Object.freeze([...(primaryReason?.evidenceRefs || [])])
    }),
    supportingEvidence: Object.freeze(candidate.qualificationReasons.map((item) => Object.freeze({
      text: `Validated evidence supports ${item.code}.`,
      evidenceRefs: Object.freeze([...item.evidenceRefs])
    }))),
    missingRequirements: Object.freeze([...candidate.missingRequirements]),
    limitations: Object.freeze([
      'STRUCTURAL_EVIDENCE_SCREEN_ONLY',
      'NO_CALIBRATED_NUMERIC_QUALIFICATION_POLICY'
    ])
  });
}

function validStatement(statement, knownEvidenceIds) {
  if (!statement || typeof statement !== 'object') return null;
  if (typeof statement.text !== 'string' || !statement.text.trim() || statement.text.length > 360) return null;
  if (FORBIDDEN_LANGUAGE.test(statement.text) || NUMERICAL_CLAIM.test(statement.text)) return null;
  const evidenceRefs = Array.isArray(statement.evidenceRefs)
    ? [...new Set(statement.evidenceRefs.filter((id) => typeof id === 'string' && knownEvidenceIds.has(id)))].sort()
    : [];
  if (evidenceRefs.length === 0 || evidenceRefs.length !== statement.evidenceRefs.length) return null;
  return Object.freeze({ text: statement.text.trim(), evidenceRefs: Object.freeze(evidenceRefs) });
}

export function validateEquityOpportunityAiExplanation(candidate, output) {
  if (!EXPLAINABLE_STATUSES.has(candidate?.qualificationStatus)) {
    return { valid: false, reason: 'DETERMINISTIC_STATUS_NOT_EXPLAINABLE' };
  }
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { valid: false, reason: 'MALFORMED_AI_EXPLANATION' };
  }
  const allowedKeys = new Set(['summary', 'supportingEvidence']);
  if (Object.keys(output).some((key) => !allowedKeys.has(key))) {
    return { valid: false, reason: 'AI_EXPLANATION_SCHEMA_VIOLATION' };
  }

  const knownEvidenceIds = new Set(candidate.evidenceRefs.map((item) => item.observationId));
  const summary = validStatement(output.summary, knownEvidenceIds);
  const rawSupporting = Array.isArray(output.supportingEvidence) ? output.supportingEvidence : [];
  if (!summary || rawSupporting.length === 0 || rawSupporting.length > 5) {
    return { valid: false, reason: 'AI_EXPLANATION_SCHEMA_VIOLATION' };
  }
  const supportingEvidence = rawSupporting.map((item) => validStatement(item, knownEvidenceIds));
  if (supportingEvidence.some((item) => item === null)) {
    return { valid: false, reason: 'AI_EXPLANATION_EVIDENCE_VIOLATION' };
  }

  return {
    valid: true,
    explanation: Object.freeze({
      status: 'available',
      generationMode: 'ai_explanation',
      reason: null,
      summary,
      supportingEvidence: Object.freeze(supportingEvidence),
      missingRequirements: Object.freeze([...candidate.missingRequirements]),
      limitations: Object.freeze([
        'STRUCTURAL_EVIDENCE_SCREEN_ONLY',
        'NO_CALIBRATED_NUMERIC_QUALIFICATION_POLICY'
      ])
    })
  };
}

export async function explainEquityOpportunity(candidate, { generateAiFn = null } = {}) {
  if (!EXPLAINABLE_STATUSES.has(candidate?.qualificationStatus)) {
    return deterministicFallback(candidate);
  }
  if (typeof generateAiFn !== 'function') return deterministicFallback(candidate);

  try {
    const output = await generateAiFn({
      candidate: {
        symbol: candidate.symbol,
        exchange: candidate.exchange,
        asOf: candidate.asOf,
        qualificationStatus: candidate.qualificationStatus,
        qualificationReasons: candidate.qualificationReasons,
        evidenceRefs: candidate.evidenceRefs,
        missingRequirements: candidate.missingRequirements,
        policyVersion: candidate.policyVersion
      },
      constraints: {
        mayChangeQualification: false,
        numericalClaimsAllowed: false,
        evidenceReferencesRequired: true,
        authoritativeActionLanguageAllowed: false
      }
    });
    const validated = validateEquityOpportunityAiExplanation(candidate, output);
    return validated.valid
      ? validated.explanation
      : deterministicFallback(candidate, validated.reason);
  } catch {
    return deterministicFallback(candidate, 'AI_EXPLANATION_UNAVAILABLE');
  }
}

