import {
  ALLOWED_STANCES,
  ALLOWED_CONVICTIONS,
  ALLOWED_ASSET_CLASSES,
  ALLOWED_ASSET_STANCES,
  ALLOWED_PRIORITIES,
  ALLOWED_THEME_STANCES
} from './marketStrategistPrompt.js';

const FORBIDDEN_WORDS_REGEX = /(?:\b(?:buy now|sell now|mua ngay|bán tháo|mục tiêu giá|giá mục tiêu|cam kết lợi nhuận|chắc chắn tăng|chắc chắn giảm)\b|(?:khuyến nghị (?:mua|bán)))/i;

const PURE_VAGUE_REGEX = /^(?:nên theo dõi thị trường|cần thận trọng|ưu tiên doanh nghiệp tốt|thị trường biến động nên đứng ngoài)[\.\s]*$/i;

const STANDARD_ACRONYMS = new Set([
  'CPI', 'GDP', 'USD', 'VND', 'FED', 'DXY', 'HNX', 'HOSE', 'VN30', 'BTC',
  'CNY', 'IMF', 'KPI', 'SBV', 'PMI', 'FDI', 'PBR', 'PER', 'EPS', 'ROE',
  'ROA', 'OPEC', 'WTI', 'ETF', 'API', 'LLM', 'USA', 'VIB', 'SEC', 'ECB',
  'BOT', 'III', 'VII', 'XII'
]);

/**
 * Validates an AI-generated or fallback market strategist output against the strict contract.
 * Checks structure, types, citations against actual supplied evidence, and anti-hallucination rules.
 *
 * @param {object} output - The candidate JSON object.
 * @param {object} evidenceScope - The valid facts and news provided in the closed input packet.
 * @param {Set<string>|Array<string>} [evidenceScope.validFactIds] - Allowed observation IDs or fact IDs.
 * @param {Set<string>|Array<string>} [evidenceScope.validArticleIds] - Allowed article IDs.
 * @param {Set<string>|Array<string>} [evidenceScope.validTickers] - Allowed individual stock tickers mentioned in evidence.
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
  const allowedTickers = new Set([
    ...STANDARD_ACRONYMS,
    ...(evidenceScope.validTickers || [])
  ]);

  // 1. executiveDecision
  if (!output.executiveDecision || typeof output.executiveDecision !== 'object') {
    errors.push('MISSING_EXECUTIVE_DECISION');
  } else {
    const ed = output.executiveDecision;
    if (!ALLOWED_STANCES.includes(ed.stance)) {
      errors.push(`INVALID_EXECUTIVE_STANCE_${ed.stance}`);
    }
    if (!ALLOWED_CONVICTIONS.includes(ed.conviction)) {
      errors.push(`INVALID_EXECUTIVE_CONVICTION_${ed.conviction}`);
    }
    if (typeof ed.oneLineDecision !== 'string' || ed.oneLineDecision.trim().length < 10) {
      errors.push('INVALID_ONE_LINE_DECISION');
    }
    if (typeof ed.actionNow !== 'string' || ed.actionNow.trim().length < 10) {
      errors.push('INVALID_ACTION_NOW');
    } else if (PURE_VAGUE_REGEX.test(ed.actionNow.trim())) {
      errors.push('VAGUE_ACTION_NOT_ACTIONABLE');
    }
  }

  // 2. assetStrategy
  if (!Array.isArray(output.assetStrategy) || output.assetStrategy.length === 0) {
    errors.push('MISSING_ASSET_STRATEGY');
  } else {
    for (let i = 0; i < output.assetStrategy.length; i++) {
      const as = output.assetStrategy[i];
      if (!as || typeof as !== 'object') {
        errors.push(`INVALID_ASSET_STRATEGY_ITEM_${i}`);
        continue;
      }
      if (!ALLOWED_ASSET_CLASSES.includes(as.assetClass)) {
        errors.push(`INVALID_ASSET_CLASS_${as.assetClass}`);
      }
      if (!ALLOWED_ASSET_STANCES.includes(as.stance)) {
        errors.push(`INVALID_ASSET_STANCE_${as.stance}`);
      }
      if (!ALLOWED_PRIORITIES.includes(as.priority)) {
        errors.push(`INVALID_ASSET_PRIORITY_${as.priority}`);
      }
      if (typeof as.rationale !== 'string' || as.rationale.trim().length < 5) {
        errors.push(`INVALID_ASSET_RATIONALE_${i}`);
      }
      if (!Array.isArray(as.evidenceIds) || as.evidenceIds.length === 0) {
        errors.push(`MISSING_ASSET_EVIDENCE_${i}`);
      } else {
        for (const evId of as.evidenceIds) {
          if (!allValidEvidence.has(evId)) {
            errors.push(`UNKNOWN_EVIDENCE_ID_IN_ASSET_STRATEGY_${evId}`);
          }
        }
      }
    }
  }

  // 3. preferredThemes
  if (!Array.isArray(output.preferredThemes) || output.preferredThemes.length === 0) {
    errors.push('MISSING_PREFERRED_THEMES');
  } else {
    for (let i = 0; i < output.preferredThemes.length; i++) {
      const pt = output.preferredThemes[i];
      if (!pt || typeof pt !== 'object' || typeof pt.theme !== 'string' || pt.theme.trim().length < 2) {
        errors.push(`INVALID_PREFERRED_THEME_${i}`);
      }
      if (!ALLOWED_THEME_STANCES.includes(pt?.stance)) {
        errors.push(`INVALID_THEME_STANCE_${pt?.stance}`);
      }
      if (typeof pt?.rationale !== 'string' || pt.rationale.trim().length < 5) {
        errors.push(`INVALID_THEME_RATIONALE_${i}`);
      }
      if (!Array.isArray(pt?.evidenceIds) || pt.evidenceIds.length === 0) {
        errors.push(`MISSING_PREFERRED_THEME_EVIDENCE_${i}`);
      } else {
        for (const evId of pt.evidenceIds) {
          if (!allValidEvidence.has(evId)) {
            errors.push(`UNKNOWN_EVIDENCE_ID_IN_PREFERRED_THEME_${evId}`);
          }
        }
      }
    }
  }

  // 4. avoidOrUnderweight
  if (!Array.isArray(output.avoidOrUnderweight) || output.avoidOrUnderweight.length === 0) {
    errors.push('MISSING_AVOID_OR_UNDERWEIGHT');
  } else {
    for (let i = 0; i < output.avoidOrUnderweight.length; i++) {
      const au = output.avoidOrUnderweight[i];
      if (!au || typeof au !== 'object' || typeof au.theme !== 'string' || au.theme.trim().length < 2) {
        errors.push(`INVALID_AVOID_ITEM_${i}`);
      }
      if (typeof au?.reason !== 'string' || au.reason.trim().length < 5) {
        errors.push(`INVALID_AVOID_REASON_${i}`);
      }
      if (!Array.isArray(au?.evidenceIds) || au.evidenceIds.length === 0) {
        errors.push(`MISSING_AVOID_EVIDENCE_${i}`);
      } else {
        for (const evId of au.evidenceIds) {
          if (!allValidEvidence.has(evId)) {
            errors.push(`UNKNOWN_EVIDENCE_ID_IN_AVOID_${evId}`);
          }
        }
      }
    }
  }

  // 5. marketOverview
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

  // 6. keyDrivers
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

  // 7. risksAndInvalidation
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

  // 8. watchNext
  if (!Array.isArray(output.watchNext) || output.watchNext.length === 0) {
    errors.push('MISSING_WATCH_NEXT');
  } else {
    for (let i = 0; i < output.watchNext.length; i++) {
      if (typeof output.watchNext[i] !== 'string' || output.watchNext[i].trim().length < 5) {
        errors.push(`INVALID_WATCH_NEXT_ITEM_${i}`);
      }
    }
  }

  // 9. citations
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

  // 10. Anti-hallucination: forbidden recommendation keywords check across all strings
  const stringDump = JSON.stringify(output);
  if (FORBIDDEN_WORDS_REGEX.test(stringDump)) {
    errors.push('FORBIDDEN_RECOMMENDATION_KEYWORDS_DETECTED');
  }

  // 11. Unsupported stock ticker detection in actionable fields
  const actionableText = [
    output.executiveDecision?.oneLineDecision || '',
    output.executiveDecision?.actionNow || '',
    ...(Array.isArray(output.assetStrategy) ? output.assetStrategy.map((a) => `${a.rationale}`) : []),
    ...(Array.isArray(output.preferredThemes) ? output.preferredThemes.map((t) => `${t.theme} ${t.rationale}`) : []),
    ...(Array.isArray(output.avoidOrUnderweight) ? output.avoidOrUnderweight.map((a) => `${a.theme} ${a.reason}`) : [])
  ].join(' ');

  const tickerMatches = actionableText.match(/\b[A-Z]{3}\b/g) || [];
  for (const ticker of tickerMatches) {
    if (!allowedTickers.has(ticker)) {
      errors.push(`UNSUPPORTED_STOCK_TICKER_DETECTED_${ticker}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
