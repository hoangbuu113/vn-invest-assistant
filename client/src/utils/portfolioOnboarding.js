import { formatVNDReporting } from './formatting.js';

export const ONBOARDING_STATES = Object.freeze({
  STATE_A: 'NO_CAPITAL_NO_HOLDINGS',
  STATE_B: 'CASH_READY_NO_HOLDINGS',
  STATE_C: 'HOLDINGS_EXIST'
});

export function deriveOnboardingState({ cashAvailable = 0, holdingsCount = 0 } = {}) {
  const cash = typeof cashAvailable === 'number' && Number.isFinite(cashAvailable) ? cashAvailable : 0;
  const count = typeof holdingsCount === 'number' && Number.isFinite(holdingsCount) ? holdingsCount : 0;

  if (count > 0) {
    return ONBOARDING_STATES.STATE_C;
  }
  if (cash > 0) {
    return ONBOARDING_STATES.STATE_B;
  }
  return ONBOARDING_STATES.STATE_A;
}

export function buildPortfolioOnboardingViewModel({ cashAvailable = 0, holdingsCount = 0 } = {}) {
  const state = deriveOnboardingState({ cashAvailable, holdingsCount });
  const cash = typeof cashAvailable === 'number' && Number.isFinite(cashAvailable) ? cashAvailable : 0;

  if (state === ONBOARDING_STATES.STATE_C) {
    return {
      state,
      shouldRender: false
    };
  }

  if (state === ONBOARDING_STATES.STATE_B) {
    return {
      state,
      shouldRender: true,
      badge: 'Tiền mặt khả dụng',
      title: 'Tiền mặt đã sẵn sàng',
      formattedCash: formatVNDReporting(cash),
      description: 'Bạn đã có tiền mặt trong danh mục. Bước tiếp theo là ghi giao dịch mua mới hoặc khai báo tài sản bạn đã sở hữu từ trước.',
      primaryActions: [
        {
          id: 'buy',
          label: 'Ghi giao dịch mua',
          icon: '🛒',
          variant: 'primary',
          helper: 'Dùng cho giao dịch bạn thực hiện trong thời gian đang theo dõi danh mục.'
        },
        {
          id: 'opening_position',
          label: 'Khai báo vị thế đang có',
          icon: '📋',
          variant: 'secondary',
          helper: 'Dùng cho tài sản bạn đã sở hữu trước khi bắt đầu theo dõi. Không làm thay đổi số dư tiền mặt.'
        }
      ],
      secondaryAction: {
        id: 'cash_manage',
        label: 'Quản lý tiền mặt'
      }
    };
  }

  // STATE_A
  return {
    state,
    shouldRender: true,
    badge: 'Khởi đầu danh mục',
    title: 'Thiết lập danh mục của bạn',
    formattedCash: null,
    description: 'Bạn có thể thêm số dư tiền mặt VND để chuẩn bị mua, hoặc khai báo ngay các tài sản bạn đã sở hữu từ trước khi theo dõi.',
    primaryActions: [
      {
        id: 'deposit',
        label: 'Thêm tiền mặt',
        icon: '💵',
        variant: 'primary',
        helper: 'Ghi nhận số dư tiền mặt VND sẵn sàng đầu tư.'
      },
      {
        id: 'opening_position',
        label: 'Khai báo vị thế đang có',
        icon: '📋',
        variant: 'secondary',
        helper: 'Dùng cho tài sản bạn đã sở hữu trước khi bắt đầu theo dõi. Không làm thay đổi số dư tiền mặt.'
      }
    ],
    secondaryAction: {
      id: 'buy',
      label: 'Ghi giao dịch mua'
    }
  };
}

export function getPerformanceEmptyStateGuidance({ cashAvailable = 0, holdingsCount = 0 } = {}) {
  const state = deriveOnboardingState({ cashAvailable, holdingsCount });

  if (state === ONBOARDING_STATES.STATE_B) {
    return 'Bạn đã có tiền mặt. Hãy ghi giao dịch mua hoặc khai báo vị thế để bắt đầu theo dõi hiệu suất.';
  }
  if (state === ONBOARDING_STATES.STATE_A) {
    return 'Hiệu suất sẽ xuất hiện sau khi danh mục có dữ liệu để theo dõi.';
  }
  return 'Hiệu suất sẽ xuất hiện sau khi danh mục có dữ liệu để theo dõi.';
}

