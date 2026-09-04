import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVietnamRegimeViewModel, formatRegimePercent } from '../../client/src/utils/regimeDisplay.js';
import {
  buildInvestmentBriefViewModel,
  buildCuratedSections,
  formatInvestmentBriefEvidence
} from '../../client/src/utils/investmentBriefDisplay.js';

const __filename = fileURLToPath(import.meta.url);
const testDir = path.dirname(__filename);
const clientDir = path.resolve(testDir, '..', '..', 'client', 'src');

test('V1.2 Improvement 01B — Market Intelligence UI presentation contract', async (t) => {
  await t.test('VietnamRegimePanel source satisfies truthful data & anti-fabrication invariants', () => {
    const source = fs.readFileSync(path.join(clientDir, 'components', 'VietnamRegimePanel.jsx'), 'utf8');

    // Truthful availability phrasing
    assert.match(source, /Chưa có nguồn dữ liệu đủ tin cậy/);
    assert.match(source, /Chưa đủ 8 tuần chính thức liên tục/);
    assert.match(source, /Chưa có số liệu CPI chính thức khả dụng/);
    assert.match(source, /Chưa có quan sát tuần chính thức khả dụng/);

    // Collapsed data quality drawer
    assert.match(source, /Nguồn & chất lượng dữ liệu/);
    assert.match(source, /Cơ quan Thống kê Quốc gia \(NSO\)/);
    assert.match(source, /Ngân hàng Nhà nước Việt Nam \(SBV\)/);

    // Prohibit speculative or predictive labeling
    assert.doesNotMatch(source, /bullish|bearish|confidence|overallScore|regimeLabel/i);

    // Never convert unavailable to zero
    assert.doesNotMatch(source, /0\.0%|0% \(mặc định\)/);
  });

  await t.test('InvestmentBriefPanel source satisfies truthful brief & non-debug UI contract', () => {
    const source = fs.readFileSync(path.join(clientDir, 'components', 'InvestmentBriefPanel.jsx'), 'utf8');

    // Title and button contract
    assert.match(source, /Bản tin thị trường/);
    assert.match(source, /Tạo bản tin/);
    assert.match(source, /Làm mới bản tin/);
    assert.match(source, /method:\s*'POST'/);

    // Single API call and no automatic mount trigger
    assert.equal((source.match(/apiFetch\('/g) || []).length, 1);
    assert.doesNotMatch(source, /useEffect\(\(\)\s*=>\s*\{[^}]*apiFetch/s);

    // Fallback notice when live AI is inactive
    assert.match(source, /Bản tóm tắt hiện được tạo từ dữ liệu đã xác minh/);

    // Raw evidence IDs not rendered in main prose
    assert.doesNotMatch(source, /investment-brief-evidence-list/);
    assert.match(source, /market-brief-details-drawer/);
  });

  await t.test('MarketNewsPreview source satisfies editorial presentation contract', () => {
    const source = fs.readFileSync(path.join(clientDir, 'components', 'MarketNewsPreview.jsx'), 'utf8');

    assert.match(source, /Tin tức đáng chú ý/);
    assert.match(source, /target="_blank"/);
    assert.match(source, /rel="noopener noreferrer"/);
    assert.match(source, /Xem tất cả/);
  });

  await t.test('MarketIntelligenceSection unifies regime, brief, and news components', () => {
    const source = fs.readFileSync(path.join(clientDir, 'components', 'MarketIntelligenceSection.jsx'), 'utf8');

    assert.match(source, /VietnamRegimePanel/);
    assert.match(source, /InvestmentBriefPanel/);
    assert.match(source, /MarketNewsPreview/);
  });

  await t.test('buildInvestmentBriefViewModel maps 4 curated user-facing sections', () => {
    const mockData = {
      status: 'ok',
      generationMode: 'deterministic_fallback',
      generatedAt: '2026-09-04T07:00:00.000Z',
      sections: {
        summary: [{ text: 'Lạm phát duy trì mức ổn định.', evidenceIds: ['cpi.yoy'] }],
        marketContext: [{ text: 'Thị trường liên ngân hàng thận trọng.', evidenceIds: ['on.rate'] }],
        portfolioObservations: [{ text: 'Danh mục chưa có tài sản mở vị thế.', evidenceIds: [] }],
        opportunityEvidence: [{ text: 'Cơ hội quan sát các nhóm ngành cơ bản.', evidenceIds: ['opp.1'] }],
        newsContext: [{ text: 'Tin tức kinh tế vĩ mô tích cực.', evidenceIds: ['news.1'] }],
        risksAndLimitations: [{ text: 'Hạn chế dữ liệu độ rộng thị trường.', evidenceIds: ['breadth.status'] }]
      },
      evidence: [
        { id: 'cpi.yoy', label: 'CPI YoY', value: 4.45, unit: 'percent' },
        { id: 'on.rate', label: 'Lãi suất ON', value: 4.2, unit: 'percent' }
      ]
    };

    const vm = buildInvestmentBriefViewModel(mockData);
    assert.equal(vm.curatedSections.length, 4);
    assert.equal(vm.curatedSections[0].label, '1. Diễn biến chính');
    assert.equal(vm.curatedSections[1].label, '2. Vì sao đáng chú ý');
    assert.equal(vm.curatedSections[2].label, '3. Điểm cần theo dõi');
    assert.equal(vm.curatedSections[3].label, '4. Tin tức ảnh hưởng');
    assert.equal(vm.badgeLabel, 'Tóm tắt dữ liệu');
    assert.equal(vm.fallbackNotice, 'Bản tóm tắt hiện được tạo từ dữ liệu đã xác minh.');
  });
});
