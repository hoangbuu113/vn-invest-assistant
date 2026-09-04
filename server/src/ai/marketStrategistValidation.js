import { ALLOWED_STANCES } from './marketStrategistPrompt.js';

const FORBIDDEN_WORDS_REGEX = /(?:\b(?:buy now|sell now|mua ngay|bán tháo|mục tiêu giá|giá mục tiêu|cam kết lợi nhuận|chắc chắn tăng|chắc chắn giảm)\b|(?:khuyến nghị (?:mua|bán)))/i;

/**
 * Validates an AI-generated or fallback market strategist output against the strict contract.
 * Checks structure, types, citations against actual supplied evidence, and anti-hallucination rules.
 *
 * @param {object} output - The candidate JSON object.
 * @param {object} evidenceScope - The valid facts and news provided in the closed input packet.
 * @param {Set<string>|Array<string>} [evidenceScope.validFactIds] - Allowed observation IDs or fact IDs.
 * @param {Set<string>|Array<string>} [evidenceScope.validArticleIds] - Allowed article IDs.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateMarketStrategistOutput(output, evidenceScope = {}) {
  const errors = [];

  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { valid: false, errors: ['OUTPUT_NOT_AN_OBJECT'] };
  }

  const validFacts = new Set(evidenceScope.validFactIds || []);
  const validArticles = new Set(evidenceScope.validArticleIds || []);
  const allValidEvidence = new Set([...validFacts, ...validArticles]);

  // 1. marketOverview
  if (!output.marketOverview || typeof output.marketOverview !== 'object') {
    errors.push('MISSING_MARKET_OVERVIEW');
  } else {
    if (typeof output.marketOverview.vietnam !== 'string' || output.marketOverview.vietnam.trim().length < 10) {
      errors.push('INVALID_VIETNAM_OVERVIEW');
    }
    if (typeof output.marketOverview.global !== 'string' || output.marketOverview.global.trim().length < 10) {
      errors.push('INVALID_GLOBAL_OVERVIEW');
    }
  }

  // 2. keyDrivers
  if (!Array.isArray(output.keyDrivers) || output.keyDrivers.length === 0) {
    errors.push('MISSING_KEY_DRIVERS');
  } else {
    for (let i = 0; i < output.keyDrivers.length; i++) {
      const kd = output.keyDrivers[i];
      if (!kd || typeof kd !== 'object' || typeof kd.driver !== 'string' || kd.driver.trim().length < 5) {
        errors.push(`INVALID_KEY_DRIVER_TEXT_${i}`);
      }
      if (!Array.isArray(kd?.evidenceIds) || kd.evidenceIds.length === 0) {
        errors.push(`MISSING_KEY_DRIVER_EVIDENCE_${i}`);
      } else {
        for (const evId of kd.evidenceIds) {
          if (!allValidEvidence.has(evId)) {
            errors.push(`UNKNOWN_EVIDENCE_ID_IN_KEY_DRIVER_${evId}`);
          }
        }
      }
    }
  }

  // 3. investmentOrientation
  if (!output.investmentOrientation || typeof output.investmentOrientation !== 'object') {
    errors.push('MISSING_INVESTMENT_ORIENTATION');
  } else {
    const io = output.investmentOrientation;
    if (!ALLOWED_STANCES.includes(io.stance)) {
      errors.push(`INVALID_STANCE_${io.stance}`);
    }
    if (!Array.isArray(io.preferredThemes) || io.preferredThemes.length === 0) {
      errors.push('MISSING_PREFERRED_THEMES');
    }
    if (!Array.isArray(io.pressuredThemes) || io.pressuredThemes.length === 0) {
      errors.push('MISSING_PRESSURED_THEMES');
    }
    if (typeof io.rationale !== 'string' || io.rationale.trim().length < 10) {
      errors.push('INVALID_ORIENTATION_RATIONALE');
    }
    if (!Array.isArray(io.evidenceIds) || io.evidenceIds.length === 0) {
      errors.push('MISSING_ORIENTATION_EVIDENCE');
    } else {
      for (const evId of io.evidenceIds) {
        if (!allValidEvidence.has(evId)) {
          errors.push(`UNKNOWN_EVIDENCE_ID_IN_ORIENTATION_${evId}`);
        }
      }
    }
  }

  // 4. risksAndInvalidation
  if (!output.risksAndInvalidation || typeof output.risksAndInvalidation !== 'object') {
    errors.push('MISSING_RISKS_AND_INVALIDATION');
  } else {
    const ri = output.risksAndInvalidation;
    if (!Array.isArray(ri.keyRisks) || ri.keyRisks.length === 0) {
      errors.push('MISSING_KEY_RISKS');
    }
    if (!Array.isArray(ri.invalidationConditions) || ri.invalidationConditions.length === 0) {
      errors.push('MISSING_INVALIDATION_CONDITIONS');
    }
    if (!Array.isArray(ri.evidenceIds) || ri.evidenceIds.length === 0) {
      errors.push('MISSING_RISKS_EVIDENCE');
    } else {
      for (const evId of ri.evidenceIds) {
        if (!allValidEvidence.has(evId)) {
          errors.push(`UNKNOWN_EVIDENCE_ID_IN_RISKS_${evId}`);
        }
      }
    }
  }

  // 5. watchNext
  if (!Array.isArray(output.watchNext) || output.watchNext.length === 0) {
    errors.push('MISSING_WATCH_NEXT');
  } else {
    for (let i = 0; i < output.watchNext.length; i++) {
      if (typeof output.watchNext[i] !== 'string' || output.watchNext[i].trim().length < 5) {
        errors.push(`INVALID_WATCH_NEXT_ITEM_${i}`);
      }
    }
  }

  // 6. citations
  if (!output.citations || typeof output.citations !== 'object') {
    errors.push('MISSING_CITATIONS');
  } else {
    if (!Array.isArray(output.citations.factObservationIds) || output.citations.factObservationIds.length === 0) {
      errors.push('MISSING_FACT_CITATIONS');
    } else {
      for (const factId of output.citations.factObservationIds) {
        if (!validFacts.has(factId)) {
          errors.push(`UNKNOWN_FACT_CITATION_${factId}`);
        }
      }
    }

    if (Array.isArray(output.citations.articleIds)) {
      for (const articleId of output.citations.articleIds) {
        if (!validArticles.has(articleId)) {
          errors.push(`UNKNOWN_ARTICLE_CITATION_${articleId}`);
        }
      }
    }
  }

  // 7. Anti-hallucination: forbidden recommendation keywords check across all strings
  const stringDump = JSON.stringify(output);
  if (FORBIDDEN_WORDS_REGEX.test(stringDump)) {
    errors.push('FORBIDDEN_RECOMMENDATION_KEYWORDS_DETECTED');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
