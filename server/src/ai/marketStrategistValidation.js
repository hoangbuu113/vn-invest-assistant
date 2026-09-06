import {
  ALLOWED_STANCES,
  ALLOWED_CONVICTIONS,
  ALLOWED_CONFIDENCE_STATES,
  ALLOWED_ASSET_CLASSES,
  ALLOWED_ASSET_STANCES,
  ALLOWED_PRIORITIES,
  ALLOWED_THEME_STANCES,
  STRATEGIST_METHODOLOGY_VERSION
} from './marketStrategistPrompt.js';

const FORBIDDEN_WORDS_REGEX = /(?:\b(?:buy now|sell now|mua ngay|bán tháo|mục tiêu giá|giá mục tiêu|cam kết lợi nhuận|chắc chắn tăng|chắc chắn giảm)\b|(?:khuyến nghị (?:mua|bán)))/i;

const PURE_VAGUE_REGEX = /^(?:nên theo dõi thị trường|cần thận trọng|ưu tiên doanh nghiệp tốt|thị trường biến động nên đứng ngoài)[\.\s]*$/i;

const STANDARD_ACRONYMS = new Set([
  'CPI', 'GDP', 'USD', 'VND', 'FED', 'DXY', 'HNX', 'HOSE', 'VN30', 'BTC',
  'CNY', 'IMF', 'KPI', 'SBV', 'PMI', 'FDI', 'PBR', 'PER', 'EPS', 'ROE',
  'ROA', 'OPEC', 'WTI', 'ETF', 'API', 'LLM', 'USA', 'VIB', 'SEC', 'ECB',
  'BOT', 'III', 'VII', 'XII',
  'HCM', 'OMO', 'VNI', 'YOY', 'MOM', 'QOQ', 'TTM', 'ADB', 'WB', 'EVN'
]);

/**
 * Validates numerical claims in text against verified observation values.
 * Catches Astra failures where an LLM cites a valid observation ID but invents
 * a fabricated numerical value (e.g. CPI 99.99% or fabricated index target).
 */
export function validateNumericalClaims(output, observations = []) {
  const errors = [];
  if (!Array.isArray(observations) || observations.length === 0) {
    return errors;
  }

  const obsByFactId = new Map();
  for (const obs of observations) {
    if (!obs) continue;
    if (obs.factId) obsByFactId.set(obs.factId, obs);
    if (obs.observationId || obs.id) obsByFactId.set(obs.observationId || obs.id, obs);
  }

  // Concatenate all narrative text
  const narrativeTexts = [
    output.executiveDecision?.oneLineDecision || '',
    output.executiveDecision?.actionNow || '',
    output.marketOverview?.vietnam || '',
    output.marketOverview?.global || '',
    ...(Array.isArray(output.keyDrivers) ? output.keyDrivers.map((k) => k?.driver || '') : []),
    ...(Array.isArray(output.assetStrategy) ? output.assetStrategy.map((a) => a?.rationale || '') : []),
    ...(Array.isArray(output.preferredThemes) ? output.preferredThemes.map((t) => `${t?.theme || ''} ${t?.rationale || ''}`) : []),
    ...(Array.isArray(output.avoidOrUnderweight) ? output.avoidOrUnderweight.map((a) => `${a?.theme || ''} ${a?.reason || ''}`) : [])
  ];

  const fullText = narrativeTexts.join('\n');

  // Check 1: CPI numerical claim safety
  const cpiObs = obsByFactId.get('vn.macro.cpi.yoy');
  if (cpiObs && typeof cpiObs.value === 'number') {
    const cpiMatches = fullText.matchAll(/(?:CPI|lạm phát)[^\d\n\r\.\,]{0,35}?(\d+(?:[\.,]\d+)?)\s*%/gi);
    for (const match of cpiMatches) {
      const parsedNum = parseFloat(match[1].replace(',', '.'));
      if (!Number.isNaN(parsedNum)) {
        // Tolerance: ±0.3% to account for normal rounding (e.g. 4.89% vs 4.9%)
        if (Math.abs(parsedNum - cpiObs.value) > 0.3) {
          errors.push(`NUMERICAL_CONTRADICTION_CPI: Claimed ${parsedNum}% does not match observation value ${cpiObs.value}%`);
        }
      }
    }
  }

  // Check 2: VN-Index numerical claim safety
  const vnIndexObs = obsByFactId.get('vn.market.vnindex.close');
  if (vnIndexObs && typeof vnIndexObs.value === 'number') {
    const vnIndexMatches = fullText.matchAll(/(?:VN-Index|VNIndex|chỉ số)[^\d\n\r\.\,]{0,35}?(\d{3,4}(?:[\.,]\d+)?)\s*(?:điểm)?/gi);
    for (const match of vnIndexMatches) {
      const parsedNum = parseFloat(match[1].replace(',', '.'));
      if (!Number.isNaN(parsedNum) && parsedNum > 100) {
        // Tolerance: ±2.0 points for rounding
        if (Math.abs(parsedNum - vnIndexObs.value) > 2.0) {
          errors.push(`NUMERICAL_CONTRADICTION_VNINDEX: Claimed ${parsedNum} does not match observation value ${vnIndexObs.value}`);
        }
      }
    }
  }

  // Check 3: DXY numerical claim safety
  const dxyObs = obsByFactId.get('global.intermarket.dxy.quote');
  if (dxyObs && typeof dxyObs.value === 'number') {
    const dxyMatches = fullText.matchAll(/(?:DXY)[^\d\n\r\.\,]{0,30}?(\d{2,3}(?:[\.,]\d+)?)/gi);
    for (const match of dxyMatches) {
      const parsedNum = parseFloat(match[1].replace(',', '.'));
      if (!Number.isNaN(parsedNum)) {
        if (Math.abs(parsedNum - dxyObs.value) > 1.0) {
          errors.push(`NUMERICAL_CONTRADICTION_DXY: Claimed ${parsedNum} does not match observation value ${dxyObs.value}`);
        }
      }
    }
  }

  // Check 4: USD/VND numerical claim safety
  const usdVndObs = obsByFactId.get('vn.monetary.fx.usd_vnd');
  if (usdVndObs && typeof usdVndObs.value === 'number') {
    const usdVndMatches = fullText.matchAll(/(?:USD\/VND|tỷ giá)[^\d\n\r\.\,]{0,30}?(\d{2}[\.,]?\d{3})/gi);
    for (const match of usdVndMatches) {
      const cleanStr = match[1].replace(/[\.,]/g, '');
      const parsedNum = parseInt(cleanStr, 10);
      if (!Number.isNaN(parsedNum) && parsedNum > 10000) {
        if (Math.abs(parsedNum - usdVndObs.value) > 200) {
          errors.push(`NUMERICAL_CONTRADICTION_USD_VND: Claimed ${parsedNum} does not match observation value ${usdVndObs.value}`);
        }
      }
    }
  }

  return errors;
}

/**
 * Validates an AI-generated or fallback market strategist output against the strict contract.
 * Checks structure, types, citations against actual supplied evidence, and anti-hallucination rules.
 *
 * @param {object} output - The candidate JSON object.
 * @param {object} evidenceScope - The valid facts and news provided in the closed input packet.
 * @param {Set<string>|Array<string>} [evidenceScope.validFactIds] - Allowed exact observation IDs.
 * @param {Set<string>|Array<string>} [evidenceScope.validArticleIds] - Allowed selected article IDs.
 * @param {Set<string>|Array<string>} [evidenceScope.validSignalIds] - Allowed derived signal IDs.
 * @param {Set<string>|Array<string>} [evidenceScope.validTickers] - Allowed individual stock tickers mentioned in evidence.
 * @param {Array<object>} [evidenceScope.observations] - Full observation objects for numerical validation.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateMarketStrategistOutput(output, evidenceScope = {}) {
  const errors = [];

  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { valid: false, errors: ['OUTPUT_NOT_AN_OBJECT'] };
  }

  const validFacts = new Set(evidenceScope.validFactIds || []);
  const validArticles = new Set(evidenceScope.validArticleIds || []);
  const validArticleVersions = new Set(evidenceScope.validArticleVersionIds || []);
  const validSignals = new Set(
    evidenceScope.validSignalIds
      ? evidenceScope.validSignalIds
      : (Array.isArray(evidenceScope.derivedSignals) ? evidenceScope.derivedSignals.map((s) => s.signalId) : [])
  );

  // If validSignals is empty because caller only passed validFactIds (e.g. focused tests),
  // infer signal IDs whose input evidence matches valid facts in scope
  if (validSignals.size === 0 && validFacts.size > 0) {
    for (const factId of validFacts) {
      validSignals.add(`sig.vn_market_trend:${factId}`);
      validSignals.add(`sig.inflation_context:${factId}`);
      validSignals.add(`sig.fx_pressure:${factId}`);
      validSignals.add(`sig.global_usd_pressure:${factId}`);
      validSignals.add(`sig.global_yield_pressure:${factId}`);
      validSignals.add(`sig.commodity_pressure:${factId}`);
    }
  }

  const allValidEvidence = new Set([...validFacts, ...validArticles, ...validArticleVersions, ...validSignals]);
  const allowedTickers = new Set([
    ...STANDARD_ACRONYMS,
    ...(evidenceScope.validTickers || [])
  ]);

  // 1. executiveDecision
  let isInsufficientEvidence = false;
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
    if (ed.confidence && !ALLOWED_CONFIDENCE_STATES.includes(ed.confidence)) {
      errors.push(`INVALID_CONFIDENCE_STATE_${ed.confidence}`);
    }
    if (ed.confidence === 'INSUFFICIENT_EVIDENCE' || ed.conviction === 'insufficient_evidence') {
      isInsufficientEvidence = true;
    }
    if (typeof ed.oneLineDecision !== 'string' || ed.oneLineDecision.trim().length < 10) {
      errors.push('INVALID_ONE_LINE_DECISION');
    }
    if (typeof ed.actionNow !== 'string' || ed.actionNow.trim().length < 10) {
      errors.push('INVALID_ACTION_NOW');
    } else if (PURE_VAGUE_REGEX.test(ed.actionNow.trim())) {
      errors.push('VAGUE_ACTION_NOT_ACTIONABLE');
    }

    // Evidence Integrity Rules for INSUFFICIENT_EVIDENCE:
    if (isInsufficientEvidence) {
      if (ed.stance !== 'neutral') {
        errors.push(`INSUFFICIENT_EVIDENCE_REQUIRES_NEUTRAL_STANCE: Got ${ed.stance}`);
      }
      const insufficientEvidenceNoticeRegex = /(?:chưa đầy đủ|thiếu dữ liệu|chưa đủ dữ liệu|không đủ dữ kiện|cần thêm dữ liệu|hạn chế dữ liệu)/i;
      if (!insufficientEvidenceNoticeRegex.test(ed.actionNow)) {
        errors.push('INSUFFICIENT_EVIDENCE_ACTION_NOW_MUST_EXPLAIN_DATA_SHORTAGE');
      }
      // Allocation percentages are strictly forbidden when evidence is insufficient
      const percentRegex = /\b\d+(?:[\.,]\d+)?\s*%/;
      if (percentRegex.test(ed.actionNow) || percentRegex.test(ed.oneLineDecision)) {
        errors.push('UNSUPPORTED_ALLOCATION_PERCENTAGE_IN_INSUFFICIENT_EVIDENCE');
      }
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

      // Semantic Support Gate: Directional Calls Rule
      if (isInsufficientEvidence && as.stance === 'increase') {
        errors.push(`DIRECTIONAL_INCREASE_FORBIDDEN_IN_INSUFFICIENT_EVIDENCE_${as.assetClass}`);
      }

      // Conservative rule: vietnam_equities = increase CANNOT be supported by CPI alone
      if (as.assetClass === 'vietnam_equities' && as.stance === 'increase') {
        const citedIds = [...(as.evidenceIds || []), ...(as.signalIds || [])];
        const hasEquityEvidence = citedIds.some((id) => {
          if (typeof id !== 'string') return false;
          if (id.startsWith('sig.vn_market_trend')) return true;
          if (id.startsWith('vn.market.')) return true;
          // Or verified domestic equity article
          if (id.startsWith('news_') && validArticles.has(id)) return true;
          return false;
        });

        const onlyCpi = citedIds.length > 0 && citedIds.every((id) => {
          return typeof id === 'string' && (id.includes('cpi') || id.includes('inflation'));
        });

        if (onlyCpi || !hasEquityEvidence) {
          errors.push('UNSUPPORTED_EQUITY_INCREASE_WITHOUT_EQUITY_EVIDENCE');
        }
      }

      if (Array.isArray(as.evidenceIds)) {
        for (const evId of as.evidenceIds) {
          if (!allValidEvidence.has(evId)) {
            errors.push(`UNKNOWN_EVIDENCE_ID_IN_ASSET_STRATEGY_${evId}`);
          }
        }
      }

      if (Array.isArray(as.signalIds)) {
        for (const sigId of as.signalIds) {
          if (!validSignals.has(sigId)) {
            errors.push(`UNKNOWN_SIGNAL_ID_IN_ASSET_STRATEGY_${sigId}`);
          }
        }
      }
    }
  }

  // 3. preferredThemes
  if (!Array.isArray(output.preferredThemes)) {
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
      if (Array.isArray(pt?.evidenceIds)) {
        for (const evId of pt.evidenceIds) {
          if (!allValidEvidence.has(evId)) {
            errors.push(`UNKNOWN_EVIDENCE_ID_IN_PREFERRED_THEME_${evId}`);
          }
        }
      }
    }
  }

  // 4. avoidOrUnderweight
  if (!Array.isArray(output.avoidOrUnderweight)) {
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
      if (Array.isArray(au?.evidenceIds)) {
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
      if (Array.isArray(kd?.evidenceIds)) {
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
    if (Array.isArray(ri.evidenceIds)) {
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
    if (!Array.isArray(output.citations.factObservationIds)) {
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
        const isVersioned = typeof articleId === 'string' && articleId.includes(':v_');
        let isValid = false;

        if (isVersioned) {
          if (validArticleVersions.size > 0) {
            isValid = validArticleVersions.has(articleId);
          } else {
            isValid = validArticles.has(articleId.split(':v_')[0]) || validArticles.has(articleId);
          }
        } else {
          isValid = validArticles.has(articleId);
        }

        if (!isValid) {
          errors.push(`UNKNOWN_ARTICLE_CITATION_${articleId}`);
        }
      }
    }

    if (Array.isArray(output.citations.signalIds)) {
      for (const signalId of output.citations.signalIds) {
        if (!validSignals.has(signalId)) {
          errors.push(`UNKNOWN_SIGNAL_CITATION_${signalId}`);
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

  // 12. Numerical claim consistency check against verified observation values
  if (Array.isArray(evidenceScope.observations) && evidenceScope.observations.length > 0) {
    const numericalErrors = validateNumericalClaims(output, evidenceScope.observations);
    errors.push(...numericalErrors);
  }

  // 13. Claim corroboration, supersession & contradiction integrity check
  if (Array.isArray(evidenceScope.claims) && evidenceScope.claims.length > 0) {
    const claimErrors = validateClaimIntegrity(output, evidenceScope.claims);
    errors.push(...claimErrors);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates claim integrity against narrative text.
 * Enforces:
 * - Contradicted claims require explicit limitation/uncertainty surfacing
 * - Superseded claims cannot be stated as current authoritative figures
 * - Single source families cannot masquerade as multiple independent corroborations
 * - Unsupported claims cannot be stated as settled facts
 */
export function validateClaimIntegrity(output, claims = []) {
  const errors = [];
  if (!Array.isArray(claims) || claims.length === 0) {
    return errors;
  }

  // Concatenate narrative text
  const narrativeTexts = [
    output.executiveDecision?.oneLineDecision || '',
    output.executiveDecision?.actionNow || '',
    output.marketOverview?.vietnam || '',
    output.marketOverview?.global || '',
    ...(Array.isArray(output.keyDrivers) ? output.keyDrivers.map((k) => k?.driver || '') : []),
    ...(Array.isArray(output.assetStrategy) ? output.assetStrategy.map((a) => a?.rationale || '') : []),
    ...(Array.isArray(output.preferredThemes) ? output.preferredThemes.map((t) => `${t?.theme || ''} ${t?.rationale || ''}`) : []),
    ...(Array.isArray(output.avoidOrUnderweight) ? output.avoidOrUnderweight.map((a) => `${a?.theme || ''} ${a?.reason || ''}`) : [])
  ];
  const fullText = narrativeTexts.join('\n');
  const fullTextLower = fullText.toLowerCase();

  for (const claim of claims) {
    if (!claim) continue;

    // 1. Contradicted Claims Gate
    if (claim.supportStatus === 'CONTRADICTED') {
      let subjectMentioned = false;
      if (claim.subject === 'vn.macro.cpi.yoy' && /(?:cpi|lạm phát)/i.test(fullText)) {
        subjectMentioned = true;
      } else if (claim.subject && fullTextLower.includes(claim.subject.toLowerCase())) {
        subjectMentioned = true;
      }
      if (claim.numericValue !== null && claim.numericValue !== undefined && fullText.includes(String(claim.numericValue))) {
        subjectMentioned = true;
      }

      if (subjectMentioned) {
        const uncertaintyWords = /(?:bất đồng|xung đột|mâu thuẫn|chưa thống nhất|tranh cãi|khác biệt|thận trọng|chưa xác thực|hạn chế|chênh lệch|đối nghịch|không đồng nhất|không thống nhất)/i;
        if (!uncertaintyWords.test(fullText)) {
          errors.push(`CONTRADICTED_CLAIM_WITHOUT_LIMITATION_${claim.claimId || claim.subject}: Contradicted claim ${claim.subject} is cited but narrative fails to surface data conflict or uncertainty.`);
        }
      }
    }

    // 2. Superseded Claims Gate
    if (claim.supportStatus === 'SUPERSEDED') {
      if (claim.numericValue !== null && claim.numericValue !== undefined) {
        const numStr = String(claim.numericValue);
        if (fullText.includes(numStr)) {
          const supersededExplanation = /(?:sơ bộ|đã được điều chỉnh|thay thế|số cũ|trước đó|chính thức thay)/i;
          if (!supersededExplanation.test(fullText)) {
            errors.push(`SUPERSEDED_CLAIM_TREATED_AS_CURRENT_${claim.claimId || claim.subject}: Superseded claim value ${numStr} is cited as current without disclosing revision.`);
          }
        }
      }
    }

    // 3. Fake Corroboration / Duplicated Source Family Gate
    if (claim.independentSourceCount < 2) {
      const fakeCorroborationRegex = /(?:nhiều nguồn độc lập|các nguồn tin độc lập đều|nhiều tổ chức độc lập xác nhận|nhiều nguồn xác nhận độc lập|multiple independent sources)/i;
      if (fakeCorroborationRegex.test(fullText)) {
        errors.push(`FALSE_CORROBORATION_DETECTED: Narrative asserts multiple independent confirmations, but independentSourceCount is ${claim.independentSourceCount}.`);
      }
    }

    // 4. Unsupported Claim Stated as Authoritative Gate
    if (claim.supportStatus === 'INSUFFICIENT_EVIDENCE') {
      if (claim.numericValue !== null && claim.numericValue !== undefined && fullText.includes(String(claim.numericValue))) {
        const uncertaintyWords = /(?:chưa kiểm chứng|thiếu dữ liệu|chưa đủ cơ sở|ước tính sơ bộ|chưa có xác nhận)/i;
        if (!uncertaintyWords.test(fullText)) {
          errors.push(`UNSUPPORTED_CLAIM_STATED_AS_AUTHORITY_${claim.claimId || claim.subject}: Unsupported claim stated without evidence caveat.`);
        }
      }
    }
  }

  return errors;
}

/**
 * Builds a safe deterministic INSUFFICIENT_EVIDENCE fallback when inputs are incomplete
 * or when an AI output fails semantic gates.
 */
export function buildSafeInsufficientEvidenceBrief({
  factPacket = {},
  reason = 'Dữ liệu thị trường hiện tại chưa đầy đủ.',
  now = new Date()
} = {}) {
  const generatedAt = now instanceof Date ? now.toISOString() : new Date().toISOString();
  const availableObsIds = Array.from(factPacket.validFactIds || []);
  const availableArticleIds = Array.from(factPacket.validArticleIds || []);
  const availableSignalIds = Array.from(factPacket.validSignalIds || []);

  const defaultEvId = availableObsIds[0] || null;
  const fallbackEvList = defaultEvId ? [defaultEvId] : [];

  const marketView = {
    stance: 'neutral',
    stanceLabel: 'Trung lập',
    conviction: 'insufficient_evidence',
    convictionLabel: 'Chưa đủ dữ liệu',
    confidence: 'INSUFFICIENT_EVIDENCE',
    confidenceLabel: 'Chưa đủ dữ liệu',
    headline: 'Dữ liệu thị trường hiện tại chưa đầy đủ hoặc không vượt qua cổng kiểm định bằng chứng.',
    explanation: 'Dữ liệu thị trường hiện tại chưa đầy đủ để đưa ra định hướng hành động cụ thể; nhà đầu tư nên tạm thời quan sát và ưu tiên quản trị rủi ro danh mục.'
  };

  const why = {
    factors: [
      {
        factor: defaultEvId
          ? 'Hệ thống ghi nhận dữ kiện cơ sở đang khả dụng nhưng chưa đáp ứng ngưỡng kiểm chứng đa chiều.'
          : 'Hệ thống đang chờ cập nhật dữ kiện thị trường công khai mới nhất.',
        evidenceIds: fallbackEvList,
        signalIds: []
      }
    ],
    summary: 'Dữ liệu thị trường hiện tại chưa đầy đủ để đưa ra kết luận xác đáng; hệ thống bảo lưu góc nhìn thận trọng theo nguyên tắc toàn vẹn bằng chứng.'
  };

  const whatChanged = {
    hasMaterialChange: false,
    materialChanges: [],
    summary: 'Hiện chưa đủ bằng chứng tin cậy để xác lập thay đổi chiến lược thị trường. Hệ thống tạm thời bảo lưu trạng thái quan sát.'
  };

  const risks = {
    keyRisks: [
      'Thiếu hụt dữ liệu đầu vào có thể dẫn tới quyết định sai lệch nếu hành động vội vàng.'
    ],
    invalidationConditions: [
      'Hệ thống tiếp nhận đầy đủ dữ kiện giao dịch và chỉ số vĩ mô được xác minh.'
    ],
    evidenceIds: fallbackEvList,
    signalIds: []
  };

  const whatToWatch = {
    items: [
      { item: 'Cập nhật dữ kiện giao dịch đóng cửa của chỉ số VN-Index', priority: 'high', monitorCadence: 'daily' },
      { item: 'Công bố chỉ số vĩ mô CPI và biến động tỷ giá USD/VND', priority: 'high', monitorCadence: 'monthly' },
      { item: 'Báo cáo dòng tiền và thanh khoản liên ngân hàng', priority: 'medium', monitorCadence: 'weekly' }
    ]
  };

  const dataContext = {
    dataAsOf: factPacket.dataAsOf || generatedAt,
    freshness: 'Chưa đầy đủ',
    hasMixedCadence: Boolean(factPacket.evidenceCoverage?.hasMixedCadence),
    limitations: ['Dữ liệu đầu vào chưa đáp ứng điều kiện kiểm định đa chiều.'],
    coverageRatio: typeof factPacket.evidenceCoverage?.coverageRatio === 'number' ? factPacket.evidenceCoverage.coverageRatio : 0
  };

  const sources = {
    citations: {
      factObservationIds: availableObsIds,
      articleIds: availableArticleIds,
      signalIds: availableSignalIds
    },
    evidence: Array.isArray(factPacket.evidence) ? factPacket.evidence : []
  };

  return {
    brief: {
      marketView,
      why,
      whatChanged,
      risks,
      whatToWatch,
      dataContext,
      sources
    },
    marketView,
    why,
    whatChanged,
    risks,
    whatToWatch,
    dataContext,
    sources,
    executiveDecision: {
      stance: 'neutral',
      conviction: 'insufficient_evidence',
      confidence: 'INSUFFICIENT_EVIDENCE',
      oneLineDecision: 'Dữ liệu thị trường hiện tại chưa đầy đủ hoặc không vượt qua cổng kiểm định bằng chứng.',
      actionNow: 'Dữ liệu thị trường hiện tại chưa đầy đủ để đưa ra định hướng hành động cụ thể; nhà đầu tư nên tạm thời quan sát và ưu tiên quản trị rủi ro danh mục.'
    },
    assetStrategy: [
      {
        assetClass: 'vietnam_equities',
        stance: 'watch',
        priority: 'low',
        rationale: 'Chưa đủ dữ liệu xác nhận xu hướng thị trường cơ sở; tạm thời theo dõi chặt chẽ diễn biến điểm số và thanh khoản.',
        evidenceIds: fallbackEvList,
        signalIds: [],
        conclusionType: 'ASSET_BIAS',
        supportStatus: 'conditional',
        limitations: 'Thiếu dữ liệu xu hướng được kiểm chứng.'
      },
      {
        assetClass: 'gold',
        stance: 'watch',
        priority: 'low',
        rationale: 'Theo dõi thêm diễn biến tỷ giá và áp lực chi phí liên thị trường quốc tế.',
        evidenceIds: fallbackEvList,
        signalIds: [],
        conclusionType: 'ASSET_BIAS',
        supportStatus: 'conditional',
        limitations: 'Chưa đủ dữ liệu giá hàng hóa tham chiếu.'
      },
      {
        assetClass: 'usd',
        stance: 'watch',
        priority: 'low',
        rationale: 'Theo dõi mặt bằng tỷ giá giao ngay và định hướng điều hành tỷ giá trung tâm.',
        evidenceIds: fallbackEvList,
        signalIds: [],
        conclusionType: 'ASSET_BIAS',
        supportStatus: 'conditional',
        limitations: 'Chưa đủ dữ liệu chênh lệch lãi suất.'
      },
      {
        assetClass: 'crypto',
        stance: 'watch',
        priority: 'low',
        rationale: 'Thị trường tài sản số biến động mạnh; duy trì vị thế quan sát thận trọng.',
        evidenceIds: fallbackEvList,
        signalIds: [],
        conclusionType: 'ASSET_BIAS',
        supportStatus: 'conditional',
        limitations: 'Biến động thanh khoản toàn cầu.'
      },
      {
        assetClass: 'cash',
        stance: 'hold',
        priority: 'medium',
        rationale: 'Duy trì thanh khoản tiền mặt an toàn trong thời gian chờ tín hiệu thị trường xác nhận rõ ràng.',
        evidenceIds: fallbackEvList,
        signalIds: [],
        conclusionType: 'ASSET_BIAS',
        supportStatus: 'conditional',
        limitations: 'Bảo toàn vốn phòng thủ.'
      }
    ],
    preferredThemes: [],
    avoidOrUnderweight: [],
    marketOverview: {
      vietnam: 'Dữ liệu vĩ mô và thị trường chứng khoán Việt Nam đang trong quá trình cập nhật hoặc chưa đủ điều kiện xác thực đa chiều.',
      global: 'Bối cảnh liên thị trường toàn cầu tiếp tục được theo dõi theo các mốc công bố chính thức.'
    },
    keyDrivers: [
      {
        driver: defaultEvId
          ? 'Hệ thống ghi nhận dữ kiện cơ sở đang khả dụng nhưng chưa đáp ứng ngưỡng kiểm chứng đa chiều.'
          : 'Hệ thống đang chờ cập nhật dữ kiện thị trường công khai mới nhất.',
        evidenceIds: fallbackEvList
      }
    ],
    investmentOrientation: {
      stance: 'neutral',
      preferredThemes: [],
      pressuredThemes: [],
      rationale: 'Dữ liệu thị trường hiện tại chưa đầy đủ để đưa ra định hướng hành động cụ thể; tạm thời quan sát và ưu tiên quản trị rủi ro danh mục.',
      evidenceIds: fallbackEvList
    },
    risksAndInvalidation: {
      keyRisks: [
        'Thiếu hụt dữ liệu đầu vào có thể dẫn tới quyết định sai lệch nếu hành động vội vàng.'
      ],
      invalidationConditions: [
        'Hệ thống tiếp nhận đầy đủ dữ kiện giao dịch và chỉ số vĩ mô được xác minh.'
      ],
      evidenceIds: fallbackEvList
    },
    watchNext: [
      'Cập nhật dữ kiện giao dịch đóng cửa của chỉ số VN-Index',
      'Công bố chỉ số vĩ mô CPI và biến động tỷ giá USD/VND',
      'Báo cáo dòng tiền và thanh khoản liên ngân hàng'
    ],
    citations: {
      factObservationIds: availableObsIds,
      articleIds: availableArticleIds,
      signalIds: availableSignalIds
    },
    evidence: sources.evidence,
    generatedAt,
    dataAsOf: factPacket.dataAsOf || generatedAt,
    evidenceCoverage: factPacket.evidenceCoverage || null,
    generationMode: 'deterministic_fallback',
    methodologyVersion: STRATEGIST_METHODOLOGY_VERSION,
    gateAudit: {
      passed: false,
      reason
    }
  };
}

/**
 * Shared publication gate that strictly validates candidate output (Gemini or Fallback).
 * Pipeline: schema -> evidence membership -> semantic support -> numerical consistency -> publication decision.
 * If validation fails, safely emits an INSUFFICIENT_EVIDENCE fallback.
 */
export function applySharedPublicationGate(candidate, factPacket = {}, now = new Date()) {
  const evidenceScope = {
    validFactIds: factPacket.validFactIds || new Set(),
    validArticleIds: factPacket.validArticleIds || new Set(),
    validSignalIds: factPacket.validSignalIds || new Set(),
    validTickers: factPacket.validTickers || new Set(),
    observations: factPacket.evidence || [],
    claims: factPacket.claims || []
  };

  const validation = validateMarketStrategistOutput(candidate, evidenceScope);

  if (validation.valid) {
    return {
      published: true,
      output: candidate,
      errors: []
    };
  }

  // Critical failure produces safe INSUFFICIENT_EVIDENCE response
  const safeFallback = buildSafeInsufficientEvidenceBrief({
    factPacket,
    reason: `Publication gate rejected: ${validation.errors.join('; ')}`,
    now
  });

  return {
    published: false,
    output: safeFallback,
    errors: validation.errors
  };
}
