import {
  ALLOWED_STANCES,
  ALLOWED_CONVICTIONS,
  ALLOWED_CONFIDENCE_STATES,
  STRATEGIST_METHODOLOGY_VERSION
} from './marketStrategistPrompt.js';
import { computeDecisionDelta } from './strategyStabilityModel.js';

export const BRIEF_SECTIONS = Object.freeze({
  MARKET_VIEW: 'marketView',
  WHY: 'why',
  WHAT_CHANGED: 'whatChanged',
  RISKS: 'risks',
  WHAT_TO_WATCH: 'whatToWatch',
  DATA_CONTEXT: 'dataContext',
  SOURCES: 'sources'
});

export const STANCE_VIETNAMESE = Object.freeze({
  selective_risk_on: 'Tấn công chọn lọc',
  defensive: 'Phòng thủ',
  neutral: 'Trung lập',
  risk_on: 'Tấn công'
});

export const CONVICTION_VIETNAMESE = Object.freeze({
  high: 'Cao',
  medium: 'Trung bình',
  low: 'Thấp',
  insufficient_evidence: 'Chưa đủ dữ liệu'
});

export const CONFIDENCE_VIETNAMESE = Object.freeze({
  HIGH: 'Cao',
  MEDIUM: 'Trung bình',
  LOW: 'Thấp',
  INSUFFICIENT_EVIDENCE: 'Chưa đủ dữ liệu'
});

const PUBLICATION_ASSET_LABELS = Object.freeze({
  VIETNAM_EQUITIES: 'cổ phiếu Việt Nam',
  GOLD: 'Vàng',
  USD: 'USD',
  CRYPTO: 'Crypto',
  CASH: 'Tiền mặt'
});

const PUBLICATION_POSTURE_LABELS = Object.freeze({
  INCREASE: 'Tăng tỷ trọng',
  HOLD: 'Giữ vị thế',
  WATCH: 'Theo dõi',
  DECREASE: 'Giảm tỷ trọng',
  AVOID: 'Hạn chế',
  NONE: 'Không có'
});

const PUBLICATION_PRIORITY_LABELS = Object.freeze({
  high: 'Cao',
  medium: 'Vừa',
  low: 'Thấp'
});

function publicationValueLabel(value) {
  if (value === null || value === undefined || value === '') return 'Không có';
  return String(value);
}

function describePublicationChange(change) {
  if (change.type === 'ASSET_STRATEGY_CHANGED') {
    const assetLabel = PUBLICATION_ASSET_LABELS[change.assetClass] || change.assetClass;
    const previousPosture = PUBLICATION_POSTURE_LABELS[change.previous?.posture] || publicationValueLabel(change.previous?.posture);
    const currentPosture = PUBLICATION_POSTURE_LABELS[change.current?.posture] || publicationValueLabel(change.current?.posture);
    const priorityChanged = change.previous?.priority !== change.current?.priority;
    const priorityText = priorityChanged
      ? `; mức ưu tiên ${PUBLICATION_PRIORITY_LABELS[change.previous?.priority] || publicationValueLabel(change.previous?.priority)} → ${PUBLICATION_PRIORITY_LABELS[change.current?.priority] || publicationValueLabel(change.current?.priority)}`
      : '';
    return `${assetLabel}: ${previousPosture} → ${currentPosture}${priorityText}`;
  }
  if (change.type === 'PREFERRED_THEME_CHANGED') {
    return `${change.change === 'added' ? 'Thêm' : 'Bỏ'} chủ đề ưu tiên “${change.value}”`;
  }
  if (change.type === 'UNDERWEIGHT_THEME_CHANGED') {
    return `${change.change === 'added' ? 'Thêm' : 'Bỏ'} chủ đề hạn chế “${change.value}”`;
  }
  if (change.type === 'EXECUTIVE_DECISION_CHANGED') {
    return `Định hướng điều hành: ${publicationValueLabel(change.previous)} → ${publicationValueLabel(change.current)}`;
  }
  if (change.type === 'REGIME_CHANGED') {
    return `Trạng thái thị trường: ${publicationValueLabel(change.previous)} → ${publicationValueLabel(change.current)}`;
  }
  if (change.type === 'HORIZON_CHANGED') {
    return `Khung thời gian: ${publicationValueLabel(change.previous)} → ${publicationValueLabel(change.current)}`;
  }
  if (change.change === 'added' || change.change === 'removed') {
    return `${change.change === 'added' ? 'Thêm' : 'Bỏ'} ${publicationValueLabel(change.value)}`;
  }
  return `${change.field}: ${publicationValueLabel(change.previous)} → ${publicationValueLabel(change.current)}`;
}

function buildLatestPublicationChanges(activeStrategy, previousStrategy) {
  if (!activeStrategy) {
    return {
      status: 'UNAVAILABLE',
      strategyId: null,
      previousStrategyId: null,
      hasMaterialChange: false,
      changes: [],
      materialChanges: [],
      summary: 'Chưa có chiến lược đã công bố để đối chiếu.'
    };
  }
  if (!activeStrategy.previousStrategyId) {
    return {
      status: 'INITIAL_PUBLICATION',
      strategyId: activeStrategy.strategyId || null,
      previousStrategyId: null,
      hasMaterialChange: false,
      changes: [],
      materialChanges: [],
      summary: 'Đây là chiến lược thị trường được công bố lần đầu; chưa có phiên bản trước để so sánh.'
    };
  }
  if (!previousStrategy || previousStrategy.strategyId !== activeStrategy.previousStrategyId) {
    return {
      status: 'PREVIOUS_VERSION_UNAVAILABLE',
      strategyId: activeStrategy.strategyId || null,
      previousStrategyId: activeStrategy.previousStrategyId,
      hasMaterialChange: false,
      changes: [],
      materialChanges: [],
      summary: 'Không tải được phiên bản chiến lược trước để đối chiếu thay đổi gần nhất.'
    };
  }

  const delta = computeDecisionDelta(previousStrategy, activeStrategy);
  if (!delta.hasMaterialChange) {
    return {
      status: 'NO_GOVERNED_CHANGE',
      strategyId: activeStrategy.strategyId || null,
      previousStrategyId: previousStrategy.strategyId,
      ...delta,
      summary: 'Lần công bố chiến lược gần nhất không thay đổi các trường quyết định được quản trị.'
    };
  }

  return {
    status: 'CHANGED',
    strategyId: activeStrategy.strategyId || null,
    previousStrategyId: previousStrategy.strategyId,
    ...delta,
    summary: `Ở lần cập nhật chiến lược gần nhất: ${delta.changes.map(describePublicationChange).join('; ')}.`
  };
}

function buildSincePublicationStatus(activeStrategy, effectiveAssessment, gateResult, isInsufficient) {
  const assessmentAt = effectiveAssessment?.assessedAt || null;
  const assessedAfterPublication = Boolean(
    assessmentAt
    && activeStrategy?.publishedAt
    && Date.parse(assessmentAt) > Date.parse(activeStrategy.publishedAt)
  );
  const isPublicationAssessment = Boolean(
    effectiveAssessment?.result === 'PUBLISH_NEW'
    && effectiveAssessment?.strategyId === activeStrategy?.strategyId
    && !assessedAfterPublication
  );

  if (isInsufficient) {
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      assessmentResult: effectiveAssessment?.result || null,
      assessedAt: assessmentAt,
      summary: 'Kể từ lần công bố này, hiện chưa đủ bằng chứng để kết luận có thêm thay đổi chiến lược.'
    };
  }
  if (gateResult?.requiresReview && !isPublicationAssessment) {
    return {
      status: 'REVIEW_REQUIRED',
      assessmentResult: effectiveAssessment?.result || null,
      assessedAt: assessmentAt,
      summary: 'Kể từ lần công bố này, dữ kiện mới đang yêu cầu đánh giá lại trước khi kết luận về thay đổi tiếp theo.'
    };
  }
  if (isPublicationAssessment) {
    return {
      status: 'NOT_ASSESSED',
      assessmentResult: effectiveAssessment.result,
      assessedAt: assessmentAt,
      summary: 'Chưa có đánh giá mới kể từ lần công bố chiến lược này.'
    };
  }
  if (assessedAfterPublication || gateResult) {
    return {
      status: 'NO_FURTHER_MATERIAL_CHANGE',
      assessmentResult: effectiveAssessment?.result || null,
      assessedAt: assessmentAt,
      summary: 'Kể từ lần công bố này, chưa xuất hiện thay đổi đủ lớn để phát hành chiến lược mới.'
    };
  }
  return {
    status: 'NOT_ASSESSED',
    assessmentResult: effectiveAssessment?.result || null,
    assessedAt: assessmentAt,
    summary: 'Chưa có đánh giá mới kể từ lần công bố chiến lược này.'
  };
}

/**
 * Extracts key indicators from factPacket evidence.
 */
export function extractKeyObservations(evidence = []) {
  const obsByFactId = new Map();
  for (const item of evidence) {
    if (!item || typeof item !== 'object') continue;
    if (item.factId) obsByFactId.set(item.factId, item);
    if (item.id) obsByFactId.set(item.id, item);
    if (item.observationId) obsByFactId.set(item.observationId, item);
  }

  return {
    vnIndex: obsByFactId.get('vn.market.vnindex.close') || null,
    vn30: obsByFactId.get('vn.market.vn30.close') || null,
    hnx: obsByFactId.get('vn.market.hnx.close') || null,
    cpi: obsByFactId.get('vn.macro.cpi.yoy') || null,
    usdVnd: obsByFactId.get('vn.monetary.fx.usd_vnd') || null,
    dxy: obsByFactId.get('global.intermarket.dxy.quote') || null,
    us10y: obsByFactId.get('global.intermarket.us10y.yield') || null,
    brent: obsByFactId.get('global.intermarket.brent.futures') || null,
    goldSpot: obsByFactId.get('global.intermarket.gold_spot.price') || null,
    goldFutures: obsByFactId.get('global.intermarket.gold_futures.price') || null,
    allById: obsByFactId
  };
}

const CURRENT_ASSET_FACT_IDS = Object.freeze({
  vietnam_equities: Object.freeze([
    'vn.market.vnindex.close',
    'vn.market.vn30.close',
    'vn.market.hnx.close'
  ]),
  gold: Object.freeze([
    'global.intermarket.gold_spot.price',
    'global.intermarket.gold_futures.price',
    'global.intermarket.dxy.quote',
    'global.intermarket.us10y.yield'
  ]),
  usd: Object.freeze([
    'vn.monetary.fx.usd_vnd',
    'global.intermarket.dxy.quote'
  ]),
  crypto: Object.freeze([
    'global.intermarket.dxy.quote',
    'global.intermarket.us10y.yield'
  ]),
  cash: Object.freeze([
    'vn.macro.cpi.yoy',
    'vn.monetary.interbank.vnd.overnight.daily_avg_rate',
    'global.intermarket.us10y.yield'
  ])
});

function getObservationId(observation) {
  return observation?.observationId || observation?.id || null;
}

function isUsableObservation(observation) {
  return Boolean(
    observation
    && typeof observation === 'object'
    && getObservationId(observation)
    && observation.value !== null
    && observation.value !== undefined
    && observation.status !== 'unavailable'
  );
}

function formatCurrentObservation(observation) {
  const label = observation.label || observation.metric || observation.factId || 'Dữ kiện';
  const value = typeof observation.value === 'number'
    ? observation.value.toLocaleString('vi-VN', { maximumFractionDigits: 4 })
    : String(observation.value);
  const unit = typeof observation.unit === 'string' && observation.unit.trim()
    ? ` ${observation.unit.trim()}`
    : '';
  return `${label} ${value}${unit}`;
}

function collectCurrentAssetEvidence(assetClass, evidence) {
  const acceptedFactIds = new Set(CURRENT_ASSET_FACT_IDS[assetClass] || []);
  return (Array.isArray(evidence) ? evidence : [])
    .filter((item) => acceptedFactIds.has(item?.factId) && isUsableObservation(item));
}

function currentObservationForPublishedId(publishedId, evidence) {
  if (!publishedId || !Array.isArray(evidence)) return null;
  return evidence.find((item) => {
    if (!isUsableObservation(item)) return false;
    const currentId = getObservationId(item);
    return currentId === publishedId
      || (item.factId && String(publishedId).startsWith(`${item.factId}:`));
  }) || null;
}

function rebuildCurrentAssetStrategy(publishedItems, fallbackItems, evidence) {
  if (!Array.isArray(publishedItems) || publishedItems.length === 0) return fallbackItems;
  return publishedItems.map((item) => {
    const currentEvidence = collectCurrentAssetEvidence(item?.assetClass, evidence);
    const evidenceIds = currentEvidence.map(getObservationId).filter(Boolean);
    const rationale = currentEvidence.length > 0
      ? `Dữ kiện hiện tại liên quan: ${currentEvidence.map(formatCurrentObservation).join('; ')}. Định hướng đã công bố được giữ nguyên cho đến khi có đánh giá chiến lược mới.`
      : 'Định hướng đã công bố được giữ nguyên; chưa có dữ kiện hiện tại đủ trực tiếp để cập nhật luận cứ định lượng.';

    return {
      assetClass: item?.assetClass,
      stance: item?.stance,
      priority: item?.priority || 'medium',
      rationale,
      evidenceIds,
      signalIds: [],
      conclusionType: item?.conclusionType || 'ASSET_BIAS',
      supportStatus: currentEvidence.length > 0 ? 'supported' : 'conditional',
      currentEvidenceStatus: currentEvidence.length > 0 ? 'available' : 'unavailable'
    };
  });
}

function rebuildCurrentThemeItems(publishedItems, evidence, narrativeField) {
  if (!Array.isArray(publishedItems)) return [];
  return publishedItems.map((item) => {
    const normalized = typeof item === 'string' ? { theme: item } : (item || {});
    const currentEvidence = (Array.isArray(normalized.evidenceIds) ? normalized.evidenceIds : [])
      .map((id) => currentObservationForPublishedId(id, evidence))
      .filter(Boolean);
    const deduplicated = [...new Map(currentEvidence.map((entry) => [getObservationId(entry), entry])).values()];
    const evidenceIds = deduplicated.map(getObservationId).filter(Boolean);
    const currentNarrative = deduplicated.length > 0
      ? `Dữ kiện hiện tại liên quan: ${deduplicated.map(formatCurrentObservation).join('; ')}. Luận điểm chủ đề vẫn thuộc chiến lược đã công bố.`
      : 'Luận điểm chủ đề thuộc chiến lược đã công bố; chưa có ánh xạ dữ kiện hiện tại đủ trực tiếp để cập nhật luận cứ.';

    return {
      theme: normalized.theme || normalized.name || '',
      ...(normalized.stance ? { stance: normalized.stance } : {}),
      [narrativeField]: currentNarrative,
      evidenceIds,
      signalIds: [],
      conclusionType: normalized.conclusionType || (narrativeField === 'reason' ? 'THEME_UNDERWEIGHT' : 'THEME_PREFERENCE'),
      supportStatus: deduplicated.length > 0 ? 'supported' : 'conditional',
      currentEvidenceStatus: deduplicated.length > 0 ? 'available' : 'unavailable'
    };
  });
}

/**
 * Derives default stance and conviction if no strategy is passed.
 */
function deriveDefaultStance({ vnIndex, cpi }) {
  if (!vnIndex || typeof vnIndex.value !== 'number') {
    return {
      stance: 'neutral',
      conviction: 'low',
      confidence: 'LOW',
      isLimited: true
    };
  }

  const cpiVal = typeof cpi?.value === 'number' ? cpi.value : null;
  const vnIndexChg = typeof vnIndex?.change === 'number' ? vnIndex.change : null;

  if (vnIndexChg !== null && vnIndexChg > 0 && (cpiVal === null || cpiVal < 4.5)) {
    return {
      stance: 'selective_risk_on',
      conviction: 'medium',
      confidence: 'MEDIUM',
      isLimited: false
    };
  }

  if (cpiVal !== null && cpiVal >= 4.5) {
    return {
      stance: 'defensive',
      conviction: 'medium',
      confidence: 'MEDIUM',
      isLimited: false
    };
  }

  return {
    stance: 'neutral',
    conviction: 'medium',
    confidence: 'MEDIUM',
    isLimited: false
  };
}

/**
 * Builds the Always-Available Brief Contract and backward-compatible strategist payload.
 *
 * Invariant: Every positive factual statement is grounded by supplied evidence.
 * Invariant: No BUY/SELL commands, no target prices, no probabilities, no opaque scores.
 * Invariant: Missing != 0, unknown != negative.
 */
export function buildDeterministicMarketBrief({
  strategy = null,
  currentStrategy = null,
  previousStrategy = null,
  assessment = null,
  lastAssessment = null,
  gateResult = null,
  factPacket = {},
  now = new Date()
} = {}) {
  const activeStrategy = strategy || currentStrategy || null;
  const {
    evidence = [],
    untrustedNews = [],
    derivedSignals = [],
    claims = [],
    evidenceCoverage = null
  } = factPacket;

  const obs = extractKeyObservations(evidence);
  const signalsByType = new Map();
  for (const s of derivedSignals) {
    if (s?.signalType) signalsByType.set(s.signalType, s);
  }

  const vnTrendSignal = signalsByType.get('VN_MARKET_TREND');
  const inflationSignal = signalsByType.get('INFLATION_CONTEXT');
  const fxSignal = signalsByType.get('FX_PRESSURE');
  const dxySignal = signalsByType.get('GLOBAL_USD_PRESSURE');

  // Fallback stance derivation if strategy not yet formed
  const defaultDerivation = deriveDefaultStance(obs);
  const stance = activeStrategy?.executiveDecision?.stance || defaultDerivation.stance;
  const conviction = activeStrategy?.executiveDecision?.conviction || defaultDerivation.conviction;
  const confidence = activeStrategy?.confidence || defaultDerivation.confidence;
  const isLimited = evidence.length === 0 || (!obs.vnIndex && !obs.cpi);

  // Active assessment outcomes
  const effectiveAssessment = assessment || lastAssessment || null;
  const dataQualityState = gateResult?.dataQualityState || activeStrategy?.dataQualityState || 'HEALTHY';
  const isInsufficient = dataQualityState === 'INSUFFICIENT' || evidence.length === 0;

  // -------------------------------------------------------------
  // 1. SECTION A: MARKET VIEW
  // -------------------------------------------------------------
  const stanceLabel = STANCE_VIETNAMESE[stance] || 'Trung lập';
  let headline = '';
  let explanation = '';

  if (isInsufficient) {
    headline = 'Dữ liệu thị trường hiện tại chưa đầy đủ; hệ thống duy trì quan điểm thận trọng và theo dõi.';
    explanation = 'Do các dữ kiện cơ sở chưa đáp ứng điều kiện kiểm chứng đa chiều, nhà đầu tư nên giữ vị thế danh mục cân bằng, hạn chế hành động theo các giả định thiếu căn cứ định lượng.';
  } else if (stance === 'selective_risk_on') {
    headline = 'Thị trường duy trì xu hướng tích cực có chọn lọc, ưu tiên doanh nghiệp có nền tảng cơ bản vững chắc.';
    explanation = 'Phân bổ tập trung vào các nhóm ngành hưởng lợi từ chu kỳ kinh doanh thực tế, có dòng tiền ổn định và tỷ lệ đòn bẩy an toàn. Tránh mua đuổi tại các nhịp tăng nóng và duy trì kỷ luật giải ngân theo từng đợt tại các vùng hỗ trợ.';
  } else if (stance === 'defensive') {
    headline = 'Áp lực vĩ mô và chi phí tài chính gia tăng; định hướng quản trị rủi ro và phòng thủ vốn.';
    explanation = 'Chủ động hạ tỷ trọng các nhóm tài sản nhạy cảm lãi suất và đòn bẩy cao, ưu tiên duy trì thanh khoản tiền mặt an toàn để bảo toàn vốn trước các biến động khó lường.';
  } else if (stance === 'risk_on') {
    headline = 'Thị trường trong trạng thái tích cực diện rộng, dòng tiền và xu hướng vĩ mô đồng thuận.';
    explanation = 'Mở rộng tỷ trọng danh mục theo xu hướng tăng trưởng của thị trường, kết hợp các mốc quản trị rủi ro chặt chẽ để bảo vệ lợi nhuận.';
  } else {
    headline = 'Thị trường vận động tích lũy trong vùng giằng co; cân bằng giữa cơ hội và kiểm soát rủi ro.';
    explanation = 'Duy trì tỷ trọng danh mục ở mức cân bằng, kiên nhẫn quan sát và chờ đợi các tín hiệu xác nhận rõ ràng hơn từ thanh khoản và dòng tiền liên thị trường.';
  }

  const marketView = {
    stance,
    stanceLabel,
    conviction,
    convictionLabel: CONVICTION_VIETNAMESE[conviction] || 'Trung bình',
    confidence,
    confidenceLabel: CONFIDENCE_VIETNAMESE[confidence] || 'Trung bình',
    headline,
    explanation
  };

  // -------------------------------------------------------------
  // 2. SECTION B: WHY (Verified factors supporting current view)
  // -------------------------------------------------------------
  const whyFactors = [];
  const citedFactIds = [];
  const citedSignalIds = [];

  // VN-Index factor
  if (obs.vnIndex && typeof obs.vnIndex.value === 'number') {
    citedFactIds.push(obs.vnIndex.id);
    const sign = (obs.vnIndex.change !== null && obs.vnIndex.change >= 0) ? '+' : '';
    const chgStr = obs.vnIndex.change !== null ? ` (${sign}${obs.vnIndex.change} điểm)` : '';
    const sigIds = vnTrendSignal ? [vnTrendSignal.signalId] : [];
    if (vnTrendSignal) citedSignalIds.push(vnTrendSignal.signalId);

    whyFactors.push({
      factor: `Chỉ số VN-Index ghi nhận tại mức ${obs.vnIndex.value} điểm${chgStr}, phản ánh trạng thái vận động và tâm lý thị trường cơ sở.`,
      evidenceIds: [obs.vnIndex.id],
      signalIds: sigIds
    });
  }

  // CPI factor
  if (obs.cpi && typeof obs.cpi.value === 'number') {
    citedFactIds.push(obs.cpi.id);
    const sigIds = inflationSignal ? [inflationSignal.signalId] : [];
    if (inflationSignal) citedSignalIds.push(inflationSignal.signalId);

    const claimsBySubject = new Map();
    for (const c of claims) {
      if (c?.subject) claimsBySubject.set(c.subject, c);
    }

    function getClaimCaveat(subject) {
      const c = claimsBySubject.get(subject);
      if (c?.supportStatus === 'INSUFFICIENT_EVIDENCE') {
        return ' (ước tính sơ bộ)';
      }
      return '';
    }

    const isCpiContradicted = claims.some(
      (c) => c.subject === 'vn.macro.cpi.yoy' && (c.supportStatus === 'CONTRADICTED' || c.contradictionCount > 0)
    );

    const cpiText = isCpiContradicted
      ? `Lạm phát CPI (YoY) ở mức ${obs.cpi.value}%, tuy nhiên có sự khác biệt giữa các nguồn công bố cần theo dõi thận trọng.`
      : `Lạm phát CPI (YoY) ghi nhận ở mức ${obs.cpi.value}%, trong ngưỡng định hướng kiểm soát vĩ mô của cơ quan quản lý.`;

    whyFactors.push({
      factor: cpiText,
      evidenceIds: [obs.cpi.id],
      signalIds: sigIds
    });
  }

  // FX & USD factor
  if (obs.usdVnd || obs.dxy) {
    const ids = [];
    const sigIds = [];
    if (obs.usdVnd) {
      ids.push(obs.usdVnd.id);
      citedFactIds.push(obs.usdVnd.id);
    }
    if (obs.dxy) {
      ids.push(obs.dxy.id);
      citedFactIds.push(obs.dxy.id);
    }
    if (fxSignal) {
      sigIds.push(fxSignal.signalId);
      citedSignalIds.push(fxSignal.signalId);
    }
    if (dxySignal) {
      sigIds.push(dxySignal.signalId);
      citedSignalIds.push(dxySignal.signalId);
    }

    const usdVndStr = obs.usdVnd?.value ? `${Number(obs.usdVnd.value).toLocaleString('vi-VN')} VND` : 'chưa có';
    const dxyStr = obs.dxy?.value ? `${obs.dxy.value} điểm` : 'chưa có';

    whyFactors.push({
      factor: `Tỷ giá USD/VND (${usdVndStr}) và DXY (${dxyStr}) tạo biến số giám sát đối với áp lực tỷ giá và chi phí vốn.`,
      evidenceIds: ids,
      signalIds: sigIds
    });
  }

  // Global yield & energy factor
  if (obs.us10y || obs.brent) {
    const claimsBySubject = new Map();
    for (const c of claims) {
      if (c?.subject) claimsBySubject.set(c.subject, c);
    }
    function getClaimCaveat(subject) {
      const c = claimsBySubject.get(subject);
      if (c?.supportStatus === 'INSUFFICIENT_EVIDENCE') {
        return ' (ước tính sơ bộ)';
      }
      return '';
    }

    const ids = [];
    if (obs.us10y) {
      ids.push(obs.us10y.id);
      citedFactIds.push(obs.us10y.id);
    }
    if (obs.brent) {
      ids.push(obs.brent.id);
      citedFactIds.push(obs.brent.id);
    }

    const us10yCaveat = getClaimCaveat('global.intermarket.us10y.yield');
    const brentCaveat = getClaimCaveat('global.intermarket.brent.futures');
    const us10yStr = obs.us10y?.value ? `${obs.us10y.value}%${us10yCaveat}` : null;
    const brentStr = obs.brent?.value ? `$${Number(obs.brent.value).toFixed(2)}/thùng${brentCaveat}` : null;
    const parts = [];
    if (us10yStr) parts.push(`lợi suất TPCP Mỹ 10 năm (${us10yStr})`);
    if (brentStr) parts.push(`giá dầu Brent (${brentStr})`);

    whyFactors.push({
      factor: `Bối cảnh liên thị trường với ${parts.join(' và ')} ảnh hưởng tới chi phí năng lượng và dòng vốn quốc tế.`,
      evidenceIds: ids,
      signalIds: []
    });
  }

  // Fallback factor if no main macro observations are present
  if (whyFactors.length === 0) {
    if (evidence.length > 0) {
      const defaultEv = evidence[0];
      citedFactIds.push(defaultEv.id);
      whyFactors.push({
        factor: `Dữ liệu quan sát cơ sở từ nguồn ${defaultEv.source || 'hệ thống'} ghi nhận ở trạng thái ${defaultEv.status || 'available'}.`,
        evidenceIds: [defaultEv.id],
        signalIds: []
      });
    } else {
      whyFactors.push({
        factor: 'Hệ thống đang chờ đồng bộ thêm các dữ kiện quan sát thị trường công khai đã được xác thực.',
        evidenceIds: [],
        signalIds: []
      });
    }
  }

  // Construct narrative summary for WHY
  const summaryParts = [];
  if (obs.vnIndex?.value) {
    summaryParts.push(`VN-Index đang ở mức ${obs.vnIndex.value} điểm`);
  }
  if (obs.cpi?.value) {
    summaryParts.push(`CPI ở mức ${obs.cpi.value}%`);
  }
  if (obs.usdVnd?.value) {
    summaryParts.push(`USD/VND ghi nhận ${Number(obs.usdVnd.value).toLocaleString('vi-VN')}`);
  }
  if (obs.dxy?.value) {
    summaryParts.push(`DXY đạt ${obs.dxy.value}`);
  }

  const whySummary = summaryParts.length > 0
    ? `Góc nhìn hiện tại được xây dựng dựa trên sự phối hợp của các dữ kiện kiểm chứng: ${summaryParts.join(', ')}. Các yếu tố này định hình môi trường rủi ro và xác lập thứ tự ưu tiên phân bổ.`
    : 'Góc nhìn chiến lược dựa trên các dữ kiện kinh tế và thị trường đã được hệ thống xác minh tính hợp lệ.';

  const why = {
    factors: whyFactors,
    summary: whySummary
  };

  // -------------------------------------------------------------
  // 3. SECTION C: WHAT CHANGED
  // -------------------------------------------------------------
  const latestPublicationChanges = buildLatestPublicationChanges(activeStrategy, previousStrategy);
  const sincePublicationStatus = buildSincePublicationStatus(activeStrategy, effectiveAssessment, gateResult, isInsufficient);
  const whatChangedSummary = `${latestPublicationChanges.summary} ${sincePublicationStatus.summary}`.trim();

  const whatChanged = {
    hasMaterialChange: latestPublicationChanges.hasMaterialChange,
    materialChanges: latestPublicationChanges.materialChanges,
    latestPublicationChanges,
    sincePublicationStatus,
    summary: whatChangedSummary
  };

  // -------------------------------------------------------------
  // 4. SECTION D: RISKS & INVALIDATION CONDITIONS
  // -------------------------------------------------------------
  const keyRisks = [];
  if (obs.usdVnd || obs.dxy) {
    keyRisks.push('Biến động tỷ giá USD/VND và sức mạnh đồng USD gia tăng làm tăng chi phí vốn ngoại tệ và áp lực lạm phát nhập khẩu.');
  }
  if (obs.us10y) {
    keyRisks.push('Lợi suất trái phiếu quốc tế neo cao kéo dài tạo áp lực rút vốn gián tiếp khỏi các thị trường mới nổi và cận biên.');
  }
  const hasContradictedClaim = claims.some((c) => c.supportStatus === 'CONTRADICTED' || c.contradictionCount > 0);
  if (hasContradictedClaim) {
    keyRisks.push('Tồn tại sự phân kỳ hoặc khác biệt số liệu giữa các nguồn công bố đối với một số chỉ tiêu vĩ mô cơ sở.');
  }
  if (obs.cpi && typeof obs.cpi.value === 'number' && obs.cpi.value >= 4.0) {
    keyRisks.push('Áp lực chi phí sinh hoạt và nguyên vật liệu đầu vào có thể làm thu hẹp biên lợi nhuận của doanh nghiệp.');
  }
  if (keyRisks.length === 0) {
    keyRisks.push('Rủi ro từ các cú sốc thanh khoản bất ngờ hoặc căng thẳng địa chính trị quốc tế tác động gián đoạn chuỗi cung ứng.');
  }

  const hasPublishedInvalidationFramework = Array.isArray(activeStrategy?.invalidationConditions)
    && activeStrategy.invalidationConditions.length > 0;
  const invalidationConditions = hasPublishedInvalidationFramework
    ? [
        'Khung điều kiện vô hiệu hóa của chiến lược đã công bố vẫn được bảo lưu; các ngưỡng gốc được trình bày riêng trong ảnh chụp chiến lược công bố.'
      ]
    : [
        'Tỷ giá USD/VND hoặc chỉ số DXY bứt phá mạnh vượt khỏi vùng kiểm soát dự báo.',
        'Chỉ số giá tiêu dùng CPI vượt ngưỡng mục tiêu kiểm soát vĩ mô chính thức.',
        'Thanh khoản và độ rộng thị trường chứng khoán suy giảm đột ngột kéo dài.'
      ];

  const risks = {
    keyRisks,
    invalidationConditions,
    evidenceIds: citedFactIds.slice(0, 4),
    signalIds: citedSignalIds.slice(0, 3)
  };

  // -------------------------------------------------------------
  // 5. SECTION E: WHAT TO WATCH
  // -------------------------------------------------------------
  const whatToWatchItems = [
    {
      item: 'Kỳ công bố chỉ số giá tiêu dùng CPI và số liệu vĩ mô chính thức của Tổng cục Thống kê (GSO)',
      priority: 'high',
      monitorCadence: 'monthly'
    },
    {
      item: 'Định hướng điều hành tỷ giá trung tâm, thanh khoản thị trường mở (OMO) và lãi suất liên ngân hàng của NHNN',
      priority: 'high',
      monitorCadence: 'weekly'
    },
    {
      item: 'Thanh khoản khớp lệnh và độ rộng phân hóa giữa các nhóm ngành trên thị trường chứng khoán Việt Nam',
      priority: 'medium',
      monitorCadence: 'daily'
    },
    {
      item: 'Chỉ số sức mạnh đồng USD (DXY), lợi suất trái phiếu chính phủ Mỹ 10 năm và giá dầu thô Brent quốc tế',
      priority: 'medium',
      monitorCadence: 'daily'
    }
  ];

  const whatToWatch = {
    items: whatToWatchItems
  };

  // -------------------------------------------------------------
  // 6. SECTION F: DATA CONTEXT
  // -------------------------------------------------------------
  const limitations = [];
  if (evidenceCoverage?.hasMixedCadence) {
    limitations.push('Các nguồn dữ kiện có chu kỳ công bố khác biệt (giao dịch hàng ngày, vĩ mô hàng tháng/quý).');
  }
  if (Array.isArray(evidenceCoverage?.cadenceLimitations)) {
    limitations.push(...evidenceCoverage.cadenceLimitations);
  }
  limitations.push('Báo cáo tài chính doanh nghiệp chi tiết và công bố thông tin niêm yết hiện chưa được tích hợp nguồn chính thức.');

  const dataContext = {
    dataAsOf: factPacket.dataAsOf || (now instanceof Date ? now.toISOString() : new Date().toISOString()),
    freshness: isInsufficient ? 'Dữ liệu chưa đầy đủ hoặc có độ trễ' : 'Đã xác thực tính toàn vẹn',
    hasMixedCadence: Boolean(evidenceCoverage?.hasMixedCadence),
    limitations: [...new Set(limitations)],
    coverageRatio: typeof evidenceCoverage?.coverageRatio === 'number' ? evidenceCoverage.coverageRatio : null
  };

  // -------------------------------------------------------------
  // 7. SECTION G: SOURCES / EVIDENCE
  // -------------------------------------------------------------
  const citedArticleIds = (untrustedNews || []).slice(0, 4).map((a) => a.articleId || a.id).filter(Boolean);
  const sources = {
    citations: {
      factObservationIds: citedFactIds.length > 0 ? [...new Set(citedFactIds)] : (evidence[0]?.id ? [evidence[0].id] : []),
      articleIds: citedArticleIds,
      signalIds: [...new Set(citedSignalIds)]
    },
    evidence: evidence.slice(0, 12)
  };

  // -------------------------------------------------------------
  // Backward-Compatible Core Output Fields
  // -------------------------------------------------------------
  // Current commentary is rebuilt from the current fact packet. The exact
  // publication-time wording remains available on the immutable
  // publishedStrategy projection assembled by Strategy Stability.
  const executiveDecision = {
    ...(activeStrategy?.executiveDecision || {}),
    stance,
    conviction,
    confidence,
    oneLineDecision: marketView.headline,
    actionNow: marketView.explanation
  };

  const defaultAssetStrategy = [
        {
          assetClass: 'vietnam_equities',
          stance: (!obs.vnIndex || confidence === 'LOW') ? 'watch' : (stance === 'selective_risk_on' ? 'increase' : 'hold'),
          priority: obs.vnIndex ? 'high' : 'low',
          rationale: obs.vnIndex
            ? 'VN-Index duy trì vùng vận động có sự phân hóa; ưu tiên quản trị giá vốn tại vùng giá hợp lý thay vì mua đuổi.'
            : 'Chưa đủ dữ liệu xác nhận xu hướng VN-Index; tạm thời theo dõi diễn biến thanh khoản và dòng tiền.',
          evidenceIds: obs.vnIndex ? [obs.vnIndex.id] : (evidence[0]?.id ? [evidence[0].id] : []),
          signalIds: vnTrendSignal ? [vnTrendSignal.signalId] : [],
          conclusionType: 'ASSET_BIAS',
          supportStatus: obs.vnIndex ? 'supported' : 'conditional',
          limitations: 'Chưa bao gồm diễn biến độ rộng chi tiết toàn bộ các sàn giao dịch.'
        },
        {
          assetClass: 'gold',
          stance: 'hold',
          priority: 'medium',
          rationale: 'Nắm giữ vị thế phòng thủ chiến lược trước biến số lạm phát quốc tế và bất ổn địa chính trị.',
          evidenceIds: obs.brent ? [obs.brent.id] : (obs.dxy ? [obs.dxy.id] : (evidence[0]?.id ? [evidence[0].id] : [])),
          signalIds: [],
          conclusionType: 'ASSET_BIAS',
          supportStatus: 'supported',
          limitations: 'Tham chiếu thị trường giao ngay quốc tế.'
        },
        {
          assetClass: 'usd',
          stance: 'watch',
          priority: 'medium',
          rationale: 'Theo dõi chặt biến động chỉ số DXY và diễn biến tỷ giá trong nước để đánh giá dư địa chính sách tiền tệ.',
          evidenceIds: obs.usdVnd ? [obs.usdVnd.id] : (obs.dxy ? [obs.dxy.id] : (evidence[0]?.id ? [evidence[0].id] : [])),
          signalIds: fxSignal ? [fxSignal.signalId] : [],
          conclusionType: 'ASSET_BIAS',
          supportStatus: 'supported',
          limitations: 'Tỷ giá giao ngay tham chiếu.'
        },
        {
          assetClass: 'crypto',
          stance: 'watch',
          priority: 'low',
          rationale: 'Thị trường tài sản số biến động mạnh theo thanh khoản toàn cầu; hạn chế sử dụng đòn bẩy.',
          evidenceIds: obs.dxy ? [obs.dxy.id] : (evidence[0]?.id ? [evidence[0].id] : []),
          signalIds: dxySignal ? [dxySignal.signalId] : [],
          conclusionType: 'ASSET_BIAS',
          supportStatus: 'supported',
          limitations: 'Tài sản rủi ro cao nhạy cảm thanh khoản.'
        },
        {
          assetClass: 'cash',
          stance: 'hold',
          priority: 'high',
          rationale: 'Duy trì thanh khoản sẵn sàng để chủ động tận dụng các nhịp điều chỉnh giải ngân vào các cổ phiếu cơ bản tốt.',
          evidenceIds: obs.cpi ? [obs.cpi.id] : (evidence[0]?.id ? [evidence[0].id] : []),
          signalIds: inflationSignal ? [inflationSignal.signalId] : [],
          conclusionType: 'ASSET_BIAS',
          supportStatus: 'supported',
          limitations: 'Dự trữ thanh khoản phòng thủ.'
        }
      ];

  const assetStrategy = rebuildCurrentAssetStrategy(
    activeStrategy?.assetStrategy,
    defaultAssetStrategy,
    evidence
  );

  const fallbackPreferredThemes = (
    (citedArticleIds.length > 0 && obs.vnIndex) ? [
      {
        theme: 'Doanh nghiệp đầu ngành dòng tiền mạnh và nợ thấp',
        stance: 'prefer',
        rationale: 'Khả năng chống chịu tốt trước biến động chi phí đầu vào và lãi suất vay.',
        evidenceIds: [obs.vnIndex.id],
        signalIds: vnTrendSignal ? [vnTrendSignal.signalId] : [],
        conclusionType: 'THEME_PREFERENCE',
        supportStatus: 'supported',
        limitations: 'Yêu cầu thẩm định báo cáo tài chính từng quý.'
      }
    ] : []
  );
  const preferredThemes = Array.isArray(activeStrategy?.preferredThemes)
    ? rebuildCurrentThemeItems(activeStrategy.preferredThemes, evidence, 'rationale')
    : fallbackPreferredThemes;

  const fallbackAvoidOrUnderweight = (
    (obs.usdVnd || obs.dxy) ? [
      {
        theme: 'Nhóm doanh nghiệp chịu chi phí nợ ngoại tệ cao hoặc đầu cơ đòn bẩy',
        reason: 'Biên an toàn thấp và dễ bị tổn thương khi biến động tỷ giá và thanh khoản phân hóa.',
        evidenceIds: [obs.usdVnd?.id || obs.dxy?.id].filter(Boolean),
        signalIds: fxSignal ? [fxSignal.signalId] : [],
        conclusionType: 'THEME_UNDERWEIGHT',
        supportStatus: 'supported',
        limitations: 'Tác động theo từng chu kỳ tái cơ cấu nợ.'
      }
    ] : []
  );
  const avoidOrUnderweight = Array.isArray(activeStrategy?.avoidOrUnderweight)
    ? rebuildCurrentThemeItems(activeStrategy.avoidOrUnderweight, evidence, 'reason')
    : fallbackAvoidOrUnderweight;

  const vnProse = obs.vnIndex?.value
    ? `Chỉ số VN-Index ghi nhận mức ${obs.vnIndex.value} điểm (${obs.vnIndex.change !== null && obs.vnIndex.change >= 0 ? '+' : ''}${obs.vnIndex.change ?? 0} điểm), phản ánh tâm lý giao dịch có sự phân hóa giữa các nhóm ngành.`
    : 'Thị trường chứng khoán Việt Nam duy trì nhịp tích lũy trong bối cảnh các chỉ số thanh khoản cần thêm tín hiệu xác nhận.';

  const isCpiContradictedGlobal = claims.some(
    (c) => c.subject === 'vn.macro.cpi.yoy' && (c.supportStatus === 'CONTRADICTED' || c.contradictionCount > 0)
  );

  const cpiProse = obs.cpi?.value
    ? (isCpiContradictedGlobal
        ? `Lạm phát CPI (YoY) ở mức ${obs.cpi.value}%, tuy nhiên có sự khác biệt giữa các nguồn công bố cần theo dõi thận trọng.`
        : `Lạm phát CPI (YoY) ở mức ${obs.cpi.value}%, trong vùng kiểm soát của chính sách vĩ mô nhưng vẫn đòi hỏi theo dõi chặt chẽ biến động chi phí đầu vào.`)
    : 'Dữ liệu lạm phát chính thức tiếp tục được cập nhật theo kỳ công bố của cơ quan thống kê.';

  const claimsBySubjectGlobal = new Map();
  for (const c of claims) {
    if (c?.subject) claimsBySubjectGlobal.set(c.subject, c);
  }
  const us10yClaim = claimsBySubjectGlobal.get('global.intermarket.us10y.yield');
  const us10yCaveat = us10yClaim?.supportStatus === 'INSUFFICIENT_EVIDENCE' ? ' (ước tính sơ bộ)' : '';

  const globalProse = obs.dxy?.value
    ? `Trên thị trường quốc tế, DXY đạt ${obs.dxy.value} điểm${obs.us10y?.value ? ` và lợi suất Trái phiếu Mỹ 10 năm ở mức ${obs.us10y.value}%${us10yCaveat}` : ''}, tác động đến mặt bằng tỷ giá và dòng vốn biên giới.`
    : 'Bối cảnh liên thị trường toàn cầu tiếp tục chịu ảnh hưởng từ định hướng lãi suất của các ngân hàng trung ương lớn.';

  const marketOverview = {
    vietnam: `${vnProse} ${cpiProse}`.trim(),
    global: globalProse.trim()
  };

  const keyDrivers = whyFactors.map((f) => ({
    driver: f.factor,
    evidenceIds: f.evidenceIds,
    signalIds: f.signalIds
  }));

  const watchNext = whatToWatchItems.map((w) => w.item);

  return {
    // Structured 7-Section Brief Contract
    brief: {
      marketView,
      why,
      whatChanged,
      risks,
      whatToWatch,
      dataContext,
      sources
    },
    // Top-level mirrors and backwards-compatible contract
    marketView,
    why,
    whatChanged,
    risks,
    whatToWatch,
    dataContext,
    sources,
    executiveDecision,
    marketOverview,
    keyDrivers,
    assetStrategy,
    preferredThemes,
    avoidOrUnderweight,
    risksAndInvalidation: {
      keyRisks: risks.keyRisks,
      invalidationConditions: risks.invalidationConditions,
      evidenceIds: risks.evidenceIds,
      signalIds: risks.signalIds
    },
    investmentOrientation: {
      stance,
      preferredThemes: (preferredThemes || []).map((t) => typeof t === 'string' ? t : t.theme),
      pressuredThemes: (avoidOrUnderweight || []).map((t) => typeof t === 'string' ? t : t.theme),
      rationale: executiveDecision.actionNow || executiveDecision.oneLineDecision,
      evidenceIds: (assetStrategy || []).flatMap((a) => a.evidenceIds || []).slice(0, 6)
    },
    watchNext,
    citations: sources.citations,
    evidence: sources.evidence,
    evidenceCoverage: factPacket.evidenceCoverage || null,
    generatedAt: now instanceof Date ? now.toISOString() : new Date().toISOString(),
    dataAsOf: dataContext.dataAsOf,
    generationMode: 'deterministic_fallback',
    methodologyVersion: STRATEGIST_METHODOLOGY_VERSION
  };
}
