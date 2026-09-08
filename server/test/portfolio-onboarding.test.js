import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ONBOARDING_STATES,
  deriveOnboardingState,
  buildPortfolioOnboardingViewModel,
  getPerformanceEmptyStateGuidance
} from '../../client/src/utils/portfolioOnboarding.js';

describe('V1.1 Improvement 10 — State-Aware Portfolio Onboarding', () => {
  test('derives exact onboarding states according to cash and holdings conditions', () => {
    // State A: No capital & no holdings
    assert.equal(deriveOnboardingState({ cashAvailable: 0, holdingsCount: 0 }), ONBOARDING_STATES.STATE_A);
    assert.equal(deriveOnboardingState({ cashAvailable: null, holdingsCount: 0 }), ONBOARDING_STATES.CASH_UNAVAILABLE);
    assert.equal(deriveOnboardingState({ cashAvailable: -5000, holdingsCount: 0 }), ONBOARDING_STATES.CASH_UNAVAILABLE);
    assert.equal(deriveOnboardingState({}), ONBOARDING_STATES.CASH_UNAVAILABLE);

    // State B: Cash ready & no holdings (current production state: 20M cash, 0 holdings)
    assert.equal(deriveOnboardingState({ cashAvailable: 20000000, holdingsCount: 0 }), ONBOARDING_STATES.STATE_B);
    assert.equal(deriveOnboardingState({ cashAvailable: 1, holdingsCount: 0 }), ONBOARDING_STATES.STATE_B);

    // State C: Holdings exist (normal portfolio mode)
    assert.equal(deriveOnboardingState({ cashAvailable: 0, holdingsCount: 1 }), ONBOARDING_STATES.STATE_C);
    assert.equal(deriveOnboardingState({ cashAvailable: 20000000, holdingsCount: 3 }), ONBOARDING_STATES.STATE_C);
  });

  test('builds accurate view model for STATE A (no capital, no holdings)', () => {
    const model = buildPortfolioOnboardingViewModel({ cashAvailable: 0, holdingsCount: 0 });

    assert.equal(model.shouldRender, true);
    assert.equal(model.state, ONBOARDING_STATES.STATE_A);
    assert.equal(model.title, 'Thiết lập danh mục của bạn');
    assert.equal(model.formattedCash, null);
    assert.equal(model.badge, 'Khởi đầu danh mục');

    // Actions in State A
    assert.equal(model.primaryActions.length, 2);
    assert.equal(model.primaryActions[0].id, 'deposit');
    assert.equal(model.primaryActions[0].label, 'Thêm tiền mặt');
    assert.equal(model.primaryActions[1].id, 'opening_position');
    assert.equal(model.primaryActions[1].label, 'Khai báo vị thế đang có');
    assert.equal(model.secondaryAction.id, 'buy');
    assert.equal(model.secondaryAction.label, 'Ghi giao dịch mua');
  });

  test('missing cash remains an explicit unavailable onboarding state instead of zero cash', () => {
    const model = buildPortfolioOnboardingViewModel({ cashAvailable: null, holdingsCount: 0 });
    assert.equal(model.state, ONBOARDING_STATES.CASH_UNAVAILABLE);
    assert.equal(model.formattedCash, null);
    assert.equal(model.primaryActions.length, 0);
    assert.match(model.description, /số dư có thẩm quyền/);
    assert.match(
      getPerformanceEmptyStateGuidance({ cashAvailable: null, holdingsCount: 0 }),
      /không khả dụng/
    );
  });

  test('builds accurate view model for STATE B (cash ready, no holdings - current 20M state)', () => {
    const model = buildPortfolioOnboardingViewModel({ cashAvailable: 20000000, holdingsCount: 0 });

    assert.equal(model.shouldRender, true);
    assert.equal(model.state, ONBOARDING_STATES.STATE_B);
    assert.equal(model.title, 'Tiền mặt đã sẵn sàng');
    assert.equal(model.formattedCash, '20.000.000 ₫');
    assert.equal(model.badge, 'Tiền mặt khả dụng');
    assert.match(model.description, /Bạn đã có tiền mặt trong danh mục/);

    // Primary actions must be Buy and Opening Position, NOT "Nạp tiền ban đầu"
    assert.equal(model.primaryActions.length, 2);
    assert.equal(model.primaryActions[0].id, 'buy');
    assert.equal(model.primaryActions[0].label, 'Ghi giao dịch mua');
    assert.match(model.primaryActions[0].helper, /Dùng cho giao dịch bạn thực hiện trong thời gian đang theo dõi/);

    assert.equal(model.primaryActions[1].id, 'opening_position');
    assert.equal(model.primaryActions[1].label, 'Khai báo vị thế đang có');
    assert.match(model.primaryActions[1].helper, /Không làm thay đổi số dư tiền mặt/);

    // Secondary action is cash management, not initial deposit prompt
    assert.equal(model.secondaryAction.id, 'cash_manage');
    assert.equal(model.secondaryAction.label, 'Quản lý tiền mặt');

    // Ensure "Nạp tiền ban đầu" is absent
    const allLabels = [...model.primaryActions.map(a => a.label), model.secondaryAction.label].join(' ');
    assert.equal(allLabels.includes('Nạp tiền ban đầu'), false);
  });

  test('returns shouldRender: false for STATE C (holdings exist)', () => {
    const model = buildPortfolioOnboardingViewModel({ cashAvailable: 20000000, holdingsCount: 2 });
    assert.equal(model.shouldRender, false);
    assert.equal(model.state, ONBOARDING_STATES.STATE_C);
  });

  test('provides state-aware contextual guidance for performance empty state', () => {
    // State A (no cash, no holdings)
    const guideA = getPerformanceEmptyStateGuidance({ cashAvailable: 0, holdingsCount: 0 });
    assert.match(guideA, /Hiệu suất sẽ xuất hiện sau khi danh mục có dữ liệu/);

    // State B (20M cash, no holdings)
    const guideB = getPerformanceEmptyStateGuidance({ cashAvailable: 20000000, holdingsCount: 0 });
    assert.match(guideB, /Bạn đã có tiền mặt/);
    assert.match(guideB, /Hãy ghi giao dịch mua hoặc khai báo vị thế/);

    // State C
    const guideC = getPerformanceEmptyStateGuidance({ cashAvailable: 20000000, holdingsCount: 5 });
    assert.match(guideC, /Hiệu suất sẽ xuất hiện/);
  });
});
