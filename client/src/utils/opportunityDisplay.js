export const OPPORTUNITY_STATE_LABELS = Object.freeze({
  eligible: 'Đủ dữ liệu',
  insufficient_data: 'Chưa đủ dữ liệu',
  unsupported: 'Chưa hỗ trợ',
  excluded: 'Không thuộc phạm vi'
});

export const OPPORTUNITY_REASON_LABELS = Object.freeze({
  NON_INVESTMENT_CONTEXT: 'Tài sản chỉ dùng làm bối cảnh thị trường',
  ASSET_INACTIVE: 'Tài sản hiện không hoạt động',
  UNSUPPORTED_ASSET_CLASS: 'Nhóm tài sản chưa có phương pháp phù hợp',
  UNSUPPORTED_HISTORY: 'Lịch sử giá chưa được hỗ trợ',
  UNSUPPORTED_MARKET_POLICY: 'Lịch thị trường chưa được hỗ trợ',
  UNSUPPORTED_PROVIDER: 'Nhà cung cấp chưa hỗ trợ dữ liệu cần thiết',
  UNSUPPORTED_ANALYSIS_METHODOLOGY: 'Phiên bản phân tích chưa tương thích',
  INCOMPLETE_HISTORY: 'Khoảng lịch sử chưa đầy đủ',
  PERIOD_UNAVAILABLE: 'Kỳ phân tích chưa khả dụng',
  INSUFFICIENT_BARS: 'Chưa đủ giá đóng cửa đã hoàn tất',
  PROVIDER_UNAVAILABLE: 'Nguồn dữ liệu tạm thời không khả dụng',
  PROVIDER_RATE_LIMITED: 'Nguồn dữ liệu đang giới hạn yêu cầu',
  PROVIDER_TIMEOUT: 'Nguồn dữ liệu phản hồi quá thời gian',
  MALFORMED_PROVIDER_RESPONSE: 'Nguồn dữ liệu trả về định dạng không hợp lệ',
  ANALYSIS_UNAVAILABLE: 'Phân tích hiện chưa khả dụng',
  INSUFFICIENT_COHORT_SIZE: 'Nhóm có dưới 10 tài sản đủ dữ liệu',
  CANDIDATE_NOT_ELIGIBLE: 'Chưa đủ dữ liệu để đánh giá mức phù hợp',
  ABOVE_COHORT_RISK_CUTOFF: 'Biến động hoặc sụt giảm vượt ngưỡng tương đối của nhóm'
});

export function opportunityReasonLabel(reason) {
  return OPPORTUNITY_REASON_LABELS[reason] || 'Dữ liệu cần thiết chưa khả dụng';
}

export function buildOpportunityViewModel(payload) {
  const cohorts = Array.isArray(payload?.cohorts) ? payload.cohorts : [];
  return {
    methodologyVersion: payload?.methodologyVersion || null,
    status: payload?.status || 'unavailable',
    partial: payload?.partial === true,
    generatedAt: typeof payload?.generatedAt === 'string' ? payload.generatedAt : null,
    analysisRangeProxy: typeof payload?.analysisRangeProxy === 'string' ? payload.analysisRangeProxy : null,
    profileContext: payload?.profileContext || null,
    cohorts: cohorts.map((cohort) => ({
      id: cohort?.id || null,
      label: cohort?.label || cohort?.id || 'Nhóm tài sản',
      eligibleCohortSize: Number.isInteger(cohort?.eligibleCohortSize) ? cohort.eligibleCohortSize : 0,
      profileFitCutoffs: cohort?.profileFitCutoffs || null,
      candidates: Array.isArray(cohort?.candidates) ? cohort.candidates : []
    })),
    excludedCandidates: Array.isArray(payload?.excludedCandidates) ? payload.excludedCandidates : [],
    vietnamRegime: payload?.vietnamRegime || null,
    portfolioContext: payload?.portfolioContext || null,
    holdingsContext: payload?.holdingsContext || null,
    watchlistContext: payload?.watchlistContext || null,
    methodology: payload?.methodology || null
  };
}
