import { EQUITY_QUALIFICATION_STATUS } from './model.js';

const EXPLAINABLE_STATUSES = new Set([
  EQUITY_QUALIFICATION_STATUS.QUALIFIED,
  EQUITY_QUALIFICATION_STATUS.WATCH
]);

const FORBIDDEN_LANGUAGE = /(?<![\p{L}\p{N}])(?:buy|sell|hold|score|opaque\s+score|recommendation|recommendation\s+strength|confidence|confidence\s+percentage|probability|chance\s+of\s+success|target\s+price|price\s+objective|expected\s+return|return\s+forecast|mua|bán|giữ|điểm\s+số|khuyến\s+nghị|độ\s+tin\s+cậy|xác\s+suất|giá\s+mục\s+tiêu|lợi\s+nhuận\s+kỳ\s+vọng)(?![\p{L}\p{N}])/iu;

function extractGroundedStrings(citedEvidence, candidate) {
  const datesAndPeriods = new Set();
  const yearTokens = new Set();
  const dayMonthNumbers = new Set();

  const addDate = (dateStr) => {
    if (typeof dateStr !== 'string') return;
    const trimmed = dateStr.trim();
    if (!trimmed) return;
    datesAndPeriods.add(trimmed);
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (match) {
      const [, y, m, d] = match;
      datesAndPeriods.add(`${y}-${m}-${d}`);
      datesAndPeriods.add(`${d}/${m}/${y}`);
      datesAndPeriods.add(`${d}-${m}-${y}`);
      yearTokens.add(y);
      dayMonthNumbers.add(Number(m));
      dayMonthNumbers.add(Number(d));
      const q = Math.ceil(Number(m) / 3);
      datesAndPeriods.add(`Q${q} ${y}`);
      datesAndPeriods.add(`${y}-Q${q}`);
      datesAndPeriods.add(`Q${q}/${y}`);
      datesAndPeriods.add(`Q${q}-${y}`);
      datesAndPeriods.add(`quý ${q} ${y}`);
      datesAndPeriods.add(`quý ${q} năm ${y}`);
      datesAndPeriods.add(`quý ${q}/${y}`);
      datesAndPeriods.add(`quý ${q}-${y}`);
      dayMonthNumbers.add(q);
    }
    const qMatch = /(?:(\d{4})[-/ ]?Q([1-4])|Q([1-4])[-/ ]+(\d{4}))/i.exec(trimmed);
    if (qMatch) {
      const y = qMatch[1] || qMatch[4];
      const q = qMatch[2] || qMatch[3];
      datesAndPeriods.add(`Q${q} ${y}`);
      datesAndPeriods.add(`${y}-Q${q}`);
      datesAndPeriods.add(`Q${q}/${y}`);
      datesAndPeriods.add(`Q${q}-${y}`);
      datesAndPeriods.add(`quý ${q} ${y}`);
      datesAndPeriods.add(`quý ${q} năm ${y}`);
      datesAndPeriods.add(`quý ${q}/${y}`);
      datesAndPeriods.add(`quý ${q}-${y}`);
      datesAndPeriods.add(`Q${q}`);
      datesAndPeriods.add(`quý ${q}`);
      yearTokens.add(y);
      dayMonthNumbers.add(Number(q));
    }
    const yMatch = /^(\d{4})$/.exec(trimmed);
    if (yMatch) {
      yearTokens.add(yMatch[1]);
      datesAndPeriods.add(yMatch[1]);
      datesAndPeriods.add(`năm ${yMatch[1]}`);
    }
  };

  if (candidate?.asOf) addDate(candidate.asOf.slice(0, 10));

  for (const ev of citedEvidence) {
    if (ev.referencePeriod) addDate(ev.referencePeriod);
    if (ev.observedAt) addDate(ev.observedAt.slice(0, 10));
    if (ev.publishedAt) addDate(ev.publishedAt.slice(0, 10));
    if (ev.sourceAvailableAt) addDate(ev.sourceAvailableAt.slice(0, 10));
    if (ev.firstSeenAt) addDate(ev.firstSeenAt.slice(0, 10));
  }

  return {
    datesAndPeriods: Array.from(datesAndPeriods).sort((a, b) => b.length - a.length),
    yearTokens,
    dayMonthNumbers
  };
}

function parseNumericTokens(token) {
  const values = [];
  const plain = Number(token);
  if (Number.isFinite(plain)) values.push(plain);

  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(token)) {
    const cleaned = Number(token.replace(/,/g, ''));
    if (Number.isFinite(cleaned)) values.push(cleaned);
  }

  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(token)) {
    const cleaned = Number(token.replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(cleaned)) values.push(cleaned);
  }

  if (/^\d+,\d+$/.test(token)) {
    const cleaned = Number(token.replace(',', '.'));
    if (Number.isFinite(cleaned)) values.push(cleaned);
  }

  return values;
}

function isStatementNumericallyGrounded(text, citedEvidence, candidate) {
  if (!/\d/.test(text)) return true;
  if (!Array.isArray(citedEvidence) || citedEvidence.length === 0) return false;

  const { datesAndPeriods, yearTokens, dayMonthNumbers } = extractGroundedStrings(citedEvidence, candidate);

  let remaining = text;
  for (const pattern of datesAndPeriods) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    remaining = remaining.replace(new RegExp(escaped, 'gi'), ' ');
  }

  remaining = remaining.replace(/\b(?:ngày|tháng|quý|năm)\s+(\d{1,4})\b/gi, (match, numStr) => {
    const n = Number(numStr);
    if (yearTokens.has(numStr) || dayMonthNumbers.has(n)) {
      return ' ';
    }
    return match;
  });

  const tokens = remaining.match(/\d+(?:[.,]\d+)*/g) || [];
  if (tokens.length === 0) {
    return true;
  }

  for (const token of tokens) {
    if (yearTokens.has(token) || dayMonthNumbers.has(Number(token))) {
      continue;
    }

    const candidateValues = parseNumericTokens(token);
    if (candidateValues.length === 0) return false;

    const matchedEvidence = candidateValues.some((v) => (
      citedEvidence.some((ev) => (
        ev.numericValue !== null
        && Number.isFinite(ev.numericValue)
        && Math.abs(ev.numericValue - v) < 1e-4
      ))
    ));

    if (!matchedEvidence) {
      return false;
    }
  }

  return true;
}

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

function validStatement(statement, candidate, knownEvidenceIds) {
  if (!statement || typeof statement !== 'object') return null;
  if (typeof statement.text !== 'string' || !statement.text.trim() || statement.text.length > 360) return null;
  if (FORBIDDEN_LANGUAGE.test(statement.text)) return null;
  if (/[€£$¥]/u.test(statement.text)) return null;

  const evidenceRefs = Array.isArray(statement.evidenceRefs)
    ? [...new Set(statement.evidenceRefs.filter((id) => typeof id === 'string' && knownEvidenceIds.has(id)))].sort()
    : [];
  if (evidenceRefs.length === 0 || evidenceRefs.length !== statement.evidenceRefs.length) return null;

  const citedEvidence = candidate.evidenceRefs.filter((item) => evidenceRefs.includes(item.observationId));

  if (statement.text.includes('%')) {
    const hasPercentEvidence = citedEvidence.some((ev) => ev.unit === '%');
    if (!hasPercentEvidence) return null;
  }

  if (!isStatementNumericallyGrounded(statement.text, citedEvidence, candidate)) {
    return null;
  }

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
  const summary = validStatement(output.summary, candidate, knownEvidenceIds);
  const rawSupporting = Array.isArray(output.supportingEvidence) ? output.supportingEvidence : [];
  if (!summary || rawSupporting.length === 0 || rawSupporting.length > 5) {
    return { valid: false, reason: 'AI_EXPLANATION_SCHEMA_VIOLATION' };
  }
  const supportingEvidence = rawSupporting.map((item) => validStatement(item, candidate, knownEvidenceIds));
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

