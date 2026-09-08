import {
  formatNativeAmount,
  formatPercentVN,
  formatPublishedTime,
  formatVNDReporting
} from './formatting.js';

export const STANCE_LABELS = Object.freeze({
  defensive: 'Phòng thủ',
  neutral: 'Trung lập',
  selective_risk_on: 'Tấn công chọn lọc',
  risk_on: 'Tấn công'
});

export const STANCE_CLASSES = Object.freeze({
  defensive: 'stance-defensive',
  neutral: 'stance-neutral',
  selective_risk_on: 'stance-selective-risk-on',
  risk_on: 'stance-risk-on'
});

export const CONVICTION_LABELS = Object.freeze({
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  insufficient_evidence: 'Chưa đủ dữ liệu'
});

export const CONFIDENCE_LABELS = Object.freeze({
  HIGH: 'Cao',
  MEDIUM: 'Trung bình',
  LOW: 'Thấp',
  INSUFFICIENT_EVIDENCE: 'Chưa đủ dữ liệu'
});

export const PUBLIC_CONFIDENCE_LABELS = Object.freeze({
  HIGH: 'Cao',
  MEDIUM: 'Trung bình',
  LOW: 'Thấp',
  INSUFFICIENT_EVIDENCE: 'Chưa đủ bằng chứng'
});

export const EVIDENCE_SUPPORT_LABELS = Object.freeze({
  STRONG: 'Mạnh',
  ADEQUATE: 'Đủ',
  FRAGILE: 'Mỏng',
  INSUFFICIENT: 'Chưa đủ'
});

export const CALIBRATION_STATUS_LABELS = Object.freeze({
  UNVALIDATED: 'Chưa kiểm chứng',
  PARTIAL: 'Một phần',
  VALIDATED: 'Đã kiểm chứng',
  SUSPENDED: 'Tạm ngưng'
});

const CONFIDENCE_REASON_LABELS = Object.freeze({
  EVIDENCE_REQUIREMENTS_MET: 'Các nhóm bằng chứng thiết yếu đã có đường hỗ trợ hợp lệ.',
  CRITICAL_EVIDENCE_MISSING: 'Thiếu bằng chứng thiết yếu cho phạm vi nhận định.',
  EVIDENCE_INTEGRITY_FAILED: 'Bằng chứng không vượt qua kiểm tra toàn vẹn hoặc thời điểm khả dụng.',
  FRESHNESS_REQUIREMENT_FAILED: 'Dữ liệu cần tính hiện thời không còn đáp ứng yêu cầu.',
  CORROBORATION_DEPENDENT: 'Nhận định đang phụ thuộc vào đường bằng chứng thay thế.',
  MATERIAL_CONFLICT_UNRESOLVED: 'Xung đột trọng yếu trong bằng chứng chưa được giải quyết.',
  ASSUMPTION_SENSITIVE: 'Kết luận nhạy cảm với các giả định phân tích.',
  ANALYTIC_REVIEW_INCOMPLETE: 'Rà soát giả định và bằng chứng phản biện chưa hoàn tất.',
  MODEL_APPLICABILITY_UNCERTAIN: 'Khả năng áp dụng mô hình cho bối cảnh hiện tại chưa chắc chắn.',
  REVISION_IMPACT_PENDING: 'Tác động của bản sửa đổi dữ liệu đang chờ đánh giá.',
  CALIBRATION_NOT_ESTABLISHED: 'Chưa có kiểm chứng lịch sử phù hợp để công bố mức Cao.',
  CALIBRATION_NOT_APPLICABLE: 'Kiểm chứng hiện có không áp dụng cho phạm vi hoặc thời điểm này.',
  DUPLICATE_EVIDENCE_IGNORED: 'Bằng chứng trùng lặp đã được loại khỏi mức hỗ trợ.',
  CADENCE_VALID_CARRY_FORWARD: 'Dữ liệu chu kỳ chậm vẫn hợp lệ theo kỳ công bố của nguồn.',
  EXPECTATION_BASELINE_UNAVAILABLE: 'Không có mốc kỳ vọng hợp lệ để đánh giá bất ngờ.',
  ASSESSMENT_POLICY_UNCONFIGURED: 'Chưa có hồ sơ yêu cầu được quản trị cho phạm vi này.',
  MATERIAL_LIMITATION_UNRESOLVED: 'Giới hạn trọng yếu của phân tích chưa được giải quyết.'
});

const UPGRADE_LABELS = Object.freeze({
  PROVIDE_VALID_ESSENTIAL_SUPPORT_PATH: 'Bổ sung đường bằng chứng hợp lệ cho nhóm thiết yếu còn thiếu.',
  CONFIGURE_GOVERNED_REQUIREMENT_PROFILE: 'Thiết lập hồ sơ yêu cầu được quản trị cho phạm vi nhận định.',
  ESTABLISH_APPLICABLE_VALIDATED_CALIBRATION: 'Hoàn tất kiểm chứng lịch sử phù hợp với phạm vi và chính sách hiện tại.'
});

const MONETARY_REQUIREMENT_LABELS = Object.freeze({
  REQ_VN_MONETARY_POLICY_CONTEXT: 'Bối cảnh chính sách tiền tệ',
  REQ_VN_MONETARY_TRANSMISSION_CONTEXT: 'Dẫn truyền chính sách và điều kiện kinh tế',
  REQ_VN_MONETARY_FX_ADMIN_REFERENCE: 'Tỷ giá điều hành chính thức',
  REQ_VN_MONETARY_FX_MARKET_REFERENCE: 'Tỷ giá tham chiếu thị trường',
  REQ_VN_MONETARY_INTERBANK_CONDITIONS: 'Điều kiện liên ngân hàng',
  REQ_VN_MONETARY_OMO_OPERATIONS: 'Nghiệp vụ thị trường mở',
  REQ_VN_MONETARY_CREDIT_CONDITIONS: 'Điều kiện tín dụng',
  REQ_VN_MONETARY_OFFICIAL_POLICY_STATEMENT: 'Quyết định/tuyên bố chính sách chính thức'
});

function confidenceReasonText(reason) {
  return CONFIDENCE_REASON_LABELS[reason?.code] || reason?.messageKey || reason?.code || '';
}

function upgradeRequirementText(requirement) {
  if (UPGRADE_LABELS[requirement?.code]) return UPGRADE_LABELS[requirement.code];
  if (String(requirement?.code || '').startsWith('RESOLVE_')) return 'Giải quyết giới hạn đang áp dụng trước khi nâng mức độ vững.';
  return requirement?.code || requirement?.requirementId || '';
}

export function buildConfidenceAssessmentViewModel(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const assessed = raw.assessmentStatus === 'ASSESSED';
  const reasons = Array.isArray(raw.reasons) ? raw.reasons : [];
  const upgradesRaw = Array.isArray(raw.upgradeRequirements) ? raw.upgradeRequirements : [];
  const monetaryDiagnostics = (Array.isArray(raw.gateResults) ? raw.gateResults : [])
    .filter((item) => String(item?.requirementId || '').startsWith('REQ_VN_MONETARY_'))
    .map((item) => ({
      requirementId: item.requirementId,
      label: MONETARY_REQUIREMENT_LABELS[item.requirementId] || item.requirementId,
      status: item.passed ? 'SUPPORTED' : 'MISSING',
      pathId: item.pathId || null,
      evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds : [],
      remediation: upgradesRaw.find((upgrade) => upgrade?.requirementId === item.requirementId)?.code || null
    }));
  return {
    assessmentId: raw.assessmentId || null,
    assessmentStatus: raw.assessmentStatus || 'NOT_ASSESSED',
    publicGrade: assessed ? raw.publicGrade : null,
    publicGradeLabel: assessed
      ? (PUBLIC_CONFIDENCE_LABELS[raw.publicGrade] || 'Chưa đủ bằng chứng')
      : 'Chưa đánh giá',
    evidenceSupport: raw.evidenceSupport || 'INSUFFICIENT',
    evidenceSupportLabel: EVIDENCE_SUPPORT_LABELS[raw.evidenceSupport] || 'Chưa đủ',
    calibrationStatus: raw.calibrationStatus || 'UNVALIDATED',
    calibrationStatusLabel: CALIBRATION_STATUS_LABELS[raw.calibrationStatus] || 'Chưa kiểm chứng',
    strengths: reasons.filter((item) => item?.severity === 'POSITIVE').map(confidenceReasonText).filter(Boolean),
    limitations: reasons.filter((item) => item?.severity === 'LIMITATION' || item?.severity === 'BLOCKING').map(confidenceReasonText).filter(Boolean),
    upgrades: upgradesRaw.map(upgradeRequirementText).filter(Boolean),
    monetaryDiagnostics,
    disclaimer: 'Đây là độ vững của cơ sở phân tích, không phải xác suất đầu tư có lãi.'
  };
}

export const ASSET_CLASS_LABELS = Object.freeze({
  vietnam_equities: 'VN Cổ phiếu',
  gold: 'Vàng',
  usd: 'USD / Ngoại tệ',
  crypto: 'Crypto',
  cash: 'Tiền mặt'
});

export const ASSET_STANCE_LABELS = Object.freeze({
  increase: '↑ Tăng tỷ trọng',
  hold: '→ Giữ vị thế',
  reduce: '↓ Giảm tỷ trọng',
  avoid: '✕ Tránh / Hạn chế',
  watch: '◎ Quan sát'
});

export const ASSET_STANCE_CLASSES = Object.freeze({
  increase: 'asset-stance-increase',
  hold: 'asset-stance-hold',
  reduce: 'asset-stance-reduce',
  avoid: 'asset-stance-avoid',
  watch: 'asset-stance-watch'
});

export const PRIORITY_LABELS = Object.freeze({
  high: 'Cao',
  medium: 'Vừa',
  low: 'Thấp'
});

export function formatStrategistStance(stance) {
  return STANCE_LABELS[stance] || 'Trung lập';
}

export function formatEvidenceValue(item) {
  if (!item || item.value === null || item.value === undefined || item.status === 'unavailable') {
    return 'Chưa khả dụng';
  }
  const { value, unit } = item;
  if (unit === 'VND') return formatVNDReporting(value);
  if (unit === 'USD' || unit === 'USDT') return formatNativeAmount(value, unit);
  if (unit === 'USD/thùng') return `$${Number(value).toFixed(2)}/thùng`;
  if (unit === 'USD/oz') return `$${Number(value).toLocaleString('vi-VN')}/oz`;
  if (unit === 'CNY') return `${Number(value).toFixed(4)} CNY`;
  if (unit === 'điểm') return `${Number(value).toLocaleString('vi-VN')} điểm`;
  if (unit === 'percent' || unit === '%') return formatPercentVN(value, false);
  if (unit === 'percentage_point' || unit === 'điểm %') return formatPercentVN(value, false).replace('%', ' điểm %');
  if (typeof value === 'number') return Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 4 });
  return String(value);
}

export function buildMarketStrategistViewModel(raw) {
  const data = raw?.data || raw;
  if (!data || typeof data !== 'object') return null;
  const currentData = data.currentBrief && typeof data.currentBrief === 'object'
    ? data.currentBrief
    : data;
  const publishedData = data.publishedStrategy && typeof data.publishedStrategy === 'object'
    ? data.publishedStrategy
    : null;

  // Support structured brief, new strategist shape, and legacy brief shape
  const isStrategist = Boolean(
    (currentData.brief || currentData.marketOverview || data.marketOverview) &&
    (currentData.executiveDecision || data.executiveDecision || data.investmentOrientation || currentData.marketView)
  );

  if (!isStrategist) {
    return null;
  }

  const stance = currentData.executiveDecision?.stance || data.executiveDecision?.stance || data.investmentOrientation?.stance || currentData.marketView?.stance || 'neutral';
  const stanceLabel = formatStrategistStance(stance);
  const stanceClass = STANCE_CLASSES[stance] || 'stance-neutral';

  const conviction = currentData.executiveDecision?.conviction || data.executiveDecision?.conviction || currentData.marketView?.conviction || 'medium';
  const convictionLabel = CONVICTION_LABELS[conviction] || 'Trung bình';

  const isLlm = data.generationMode === 'llm' || data.generationMode === 'live_ai' || data.generationMode === 'gemini';
  const isCache = data.generationMode === 'cache';
  const isFallback = data.generationMode === 'deterministic_fallback' || !data.generationMode;

  const badgeLabel = isLlm ? 'AI Chiến lược' : isCache ? 'Dữ kiện lưu tạm' : 'Chiến lược xác định';
  const modeLabel = isLlm
    ? 'AI chiến lược gia tổng hợp từ dữ kiện đã kiểm chứng'
    : isCache
      ? 'Bản chiến lược từ dữ kiện thị trường tương ứng'
      : 'Chiến lược thị trường từ dữ kiện kinh tế và liên thị trường đã kiểm chứng';

  const fallbackNotice = isFallback
    ? 'Bản chiến lược hiện được tạo từ dữ liệu đã xác minh.'
    : null;
  const generationBadge = isLlm ? 'AI Live' : isCache ? 'Cache' : 'Xác định';

  const generatedAt = data.generatedAt ? formatPublishedTime(data.generatedAt) : 'Vừa xong';

  const confidence = currentData.executiveDecision?.confidence || data.executiveDecision?.confidence || data.confidence || (conviction === 'insufficient_evidence' ? 'INSUFFICIENT_EVIDENCE' : 'MEDIUM');
  const confidenceAssessment = buildConfidenceAssessmentViewModel(currentData.confidenceAssessment || data.confidenceAssessment);
  const confidenceLabel = CONFIDENCE_LABELS[confidence] || 'Trung bình';

  const executiveDecision = {
    stance,
    stanceLabel,
    stanceClass,
    conviction,
    convictionLabel,
    confidence,
    confidenceLabel,
    oneLineDecision: currentData.executiveDecision?.oneLineDecision || currentData.marketView?.headline || data.executiveDecision?.oneLineDecision || data.investmentOrientation?.rationale || '',
    actionNow: currentData.executiveDecision?.actionNow || currentData.marketView?.explanation || data.executiveDecision?.actionNow || data.investmentOrientation?.rationale || ''
  };

  const rawAssetStrategy = Array.isArray(currentData.assetStrategy) ? currentData.assetStrategy : [];
  const assetStrategy = rawAssetStrategy.map((item) => ({
    assetClass: item.assetClass,
    assetClassLabel: ASSET_CLASS_LABELS[item.assetClass] || item.assetClass,
    stance: item.stance,
    stanceLabel: ASSET_STANCE_LABELS[item.stance] || item.stance,
    stanceClass: ASSET_STANCE_CLASSES[item.stance] || 'asset-stance-watch',
    priority: item.priority || 'medium',
    priorityLabel: PRIORITY_LABELS[item.priority] || 'Vừa',
    rationale: item.rationale || '',
    evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds : []
  }));

  const preferredThemes = Array.isArray(currentData.preferredThemes)
    ? currentData.preferredThemes.map((item) => typeof item === 'string'
      ? { theme: item, stance: 'prefer', rationale: '', evidenceIds: [] }
      : item
    )
    : [];

  const avoidOrUnderweight = Array.isArray(currentData.avoidOrUnderweight)
    ? currentData.avoidOrUnderweight.map((item) => typeof item === 'string'
      ? { theme: item, reason: '', evidenceIds: [] }
      : item
    )
    : [];

  const keyDrivers = Array.isArray(currentData.keyDrivers) ? currentData.keyDrivers : [];
  const rawWatchNext = Array.isArray(currentData.watchNext) ? currentData.watchNext : [];

  const brief = currentData.brief || null;
  const rawMarketView = currentData.marketView || brief?.marketView || null;
  const rawWhy = currentData.why || brief?.why || null;
  const rawWhatChanged = currentData.whatChanged || brief?.whatChanged || null;
  const rawRisks = currentData.risks || brief?.risks || null;
  const rawWhatToWatch = currentData.whatToWatch || brief?.whatToWatch || null;
  const rawDataContext = currentData.dataContext || brief?.dataContext || null;
  const rawSources = currentData.sources || brief?.sources || null;

  const marketView = {
    stance,
    stanceLabel,
    stanceClass,
    conviction,
    convictionLabel,
    confidence,
    confidenceLabel,
    headline: rawMarketView?.headline || executiveDecision.oneLineDecision,
    explanation: rawMarketView?.explanation || executiveDecision.actionNow
  };

  const why = {
    factors: Array.isArray(rawWhy?.factors)
      ? rawWhy.factors
      : keyDrivers.map((k) => ({ factor: k.driver, evidenceIds: k.evidenceIds || [], signalIds: k.signalIds || [] })),
    summary: rawWhy?.summary || (keyDrivers[0]?.driver || '')
  };

  const whatChanged = {
    hasMaterialChange: Boolean(rawWhatChanged?.hasMaterialChange),
    materialChanges: Array.isArray(rawWhatChanged?.materialChanges)
      ? rawWhatChanged.materialChanges
      : (Array.isArray(data.materialChanges) ? data.materialChanges : []),
    summary: rawWhatChanged?.summary || (data.latestAssessmentResult === 'KEEP' ? 'Quan điểm thị trường tiếp tục được bảo lưu ổn định.' : '')
  };

  const risks = {
    keyRisks: Array.isArray(rawRisks?.keyRisks)
      ? rawRisks.keyRisks
      : (Array.isArray(data.risksAndInvalidation?.keyRisks) ? data.risksAndInvalidation.keyRisks : []),
    invalidationConditions: Array.isArray(rawRisks?.invalidationConditions)
      ? rawRisks.invalidationConditions
      : (Array.isArray(data.risksAndInvalidation?.invalidationConditions) ? data.risksAndInvalidation.invalidationConditions : [])
  };

  const whatToWatch = {
    items: Array.isArray(rawWhatToWatch?.items)
      ? rawWhatToWatch.items
      : rawWatchNext.map((w) => typeof w === 'string' ? { item: w, priority: 'medium', monitorCadence: 'daily' } : w)
  };

  const evidenceCoverage = currentData.evidenceCoverage || data.evidenceCoverage || null;
  const currentEvidenceDataAsOf = data.currentEvidenceDataAsOf
    || currentData.currentEvidenceDataAsOf
    || rawDataContext?.dataAsOf
    || evidenceCoverage?.dataAsOf
    || data.dataAsOf
    || null;
  const strategyDataAsOf = data.strategyDataAsOf || publishedData?.strategyDataAsOf || null;
  const dataAsOf = currentEvidenceDataAsOf;
  const hasMixedCadence = Boolean(evidenceCoverage?.hasMixedCadence || rawDataContext?.hasMixedCadence);
  const dataAsOfLabel = currentEvidenceDataAsOf
    ? `Bằng chứng hiện tại cập nhật đến: ${formatPublishedTime(currentEvidenceDataAsOf)}`
    : null;
  const strategyDataAsOfLabel = strategyDataAsOf
    ? `Chiến lược công bố theo dữ liệu đến: ${formatPublishedTime(strategyDataAsOf)}`
    : null;
  const mixedCadenceNotice = hasMixedCadence ? 'Nguồn có độ trễ khác nhau' : null;
  const cadenceLimitations = Array.isArray(evidenceCoverage?.cadenceLimitations)
    ? evidenceCoverage.cadenceLimitations
    : (Array.isArray(rawDataContext?.limitations) ? rawDataContext.limitations : []);

  const dataContext = {
    dataAsOf,
    freshness: rawDataContext?.freshness || (isFallback ? 'Đã xác thực' : 'Trực tiếp'),
    hasMixedCadence,
    limitations: cadenceLimitations
  };

  const evidence = Array.isArray(currentData.evidence) && currentData.evidence.length > 0
    ? currentData.evidence
    : (Array.isArray(rawSources?.evidence) ? rawSources.evidence : []);

  return {
    isStrategist: true,
    runId: data.runId || null,
    strategyId: data.strategyId || null,
    publishedStrategy: publishedData,
    strategyDataAsOf,
    strategyDataAsOfLabel,
    currentEvidenceDataAsOf,
    dataAsOf,
    dataAsOfLabel,
    hasMixedCadence,
    mixedCadenceNotice,
    cadenceLimitations,
    evidenceCoverage,
    badgeLabel,
    generationBadge,
    modeLabel,
    fallbackNotice,
    generatedAt,
    confidenceAssessment,
    executiveDecision,
    brief,
    marketView,
    why,
    whatChanged,
    risks,
    whatToWatch,
    dataContext,
    assetStrategy,
    preferredThemes,
    avoidOrUnderweight,
    marketOverview: {
      vietnam: currentData.marketOverview?.vietnam || '',
      global: currentData.marketOverview?.global || ''
    },
    keyDrivers,
    investmentOrientation: {
      stance,
      stanceLabel,
      stanceClass,
      preferredThemes: preferredThemes.map((t) => t.theme),
      pressuredThemes: avoidOrUnderweight.map((t) => t.theme),
      rationale: executiveDecision.actionNow || executiveDecision.oneLineDecision,
      evidenceIds: Array.isArray(currentData.investmentOrientation?.evidenceIds)
        ? currentData.investmentOrientation.evidenceIds
        : []
    },
    risksAndInvalidation: {
      keyRisks: risks.keyRisks,
      invalidationConditions: risks.invalidationConditions,
      evidenceIds: Array.isArray(currentData.risksAndInvalidation?.evidenceIds)
        ? currentData.risksAndInvalidation.evidenceIds
        : []
    },
    watchNext: whatToWatch.items,
    citations: currentData.citations || rawSources?.citations || { factObservationIds: [], articleIds: [] },
    evidence
  };
}
