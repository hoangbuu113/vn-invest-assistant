import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_SRC_DIR = path.resolve(__dirname, '../../client/src');
const CLIENT_DIST_DIR = path.resolve(__dirname, '../../client/dist');

describe('Application Startup Performance Optimization & Critical Path Invariants', () => {
  test('App.jsx accepts initialProfile and avoids redundant profile fetch', async () => {
    const appSource = await readFile(path.join(CLIENT_SRC_DIR, 'App.jsx'), 'utf8');

    // App signature accepts initialProfile
    assert.match(
      appSource,
      /function\s+App\(\s*\{\s*onLogout,\s*user:\s*initialUser,\s*profile:\s*initialProfile\s*\}\s*\)/,
      'App component must accept initialProfile from AuthGate'
    );

    // Profile state initializes with initialProfile
    assert.match(
      appSource,
      /const\s*\[profile,\s*setProfile\]\s*=\s*useState\(initialProfile\s*\|\|\s*null\);/,
      'Profile state must initialize with initialProfile if provided'
    );

    // Initial mount effect must check for initialProfile before fetching profile
    assert.match(
      appSource,
      /if\s*\(!initialProfile\)\s*\{\s*fetchProfile\(/,
      'App mount effect must skip fetchProfile when initialProfile is provided'
    );
  });

  test('Heavy and non-dashboard components are lazy-loaded with React.lazy', async () => {
    const appSource = await readFile(path.join(CLIENT_SRC_DIR, 'App.jsx'), 'utf8');

    const expectedLazyComponents = [
      'Fintech3DOrb',
      'PriceHistoryChart',
      'AssetAnalysisSection',
      'EquityFundamentalsSection',
      'PortfolioCompositionSection',
      'AssetComparisonSection',
      'PortfolioPerformanceSection',
      'PortfolioSummaryHoldings',
      'PortfolioActivitySection',
      'OpportunitySection',
      'OpeningPositionModal',
      'PriceAlertModal',
      'TransactionModal',
      'CashMovementModal'
    ];

    for (const comp of expectedLazyComponents) {
      const lazyRegex = new RegExp(`const\\s+${comp}\\s*=\\s*React\\.lazy\\(`);
      assert.match(
        appSource,
        lazyRegex,
        `Expected ${comp} to be lazy-loaded with React.lazy()`
      );

      // Ensure no static import of the same component at top of file
      const staticImportRegex = new RegExp(`import\\s+.*\\b${comp}\\b.*from`);
      assert.doesNotMatch(
        appSource,
        staticImportRegex,
        `Expected ${comp} to NOT be statically imported at top level`
      );
    }
  });

  test('Off-screen data fetches are deferred until relevant tab is active', async () => {
    const appSource = await readFile(path.join(CLIENT_SRC_DIR, 'App.jsx'), 'utf8');

    // Holdings fetch deferred to profile tab or modal
    assert.match(
      appSource,
      /activeTab === 'profile' \|\| isOpeningPositionModalOpen/,
      'Holdings fetch must be deferred until profile tab or modal open'
    );

    // Assets catalog fetch deferred to assets tab or modal
    assert.match(
      appSource,
      /activeTab === 'assets' \|\| isAlertModalOpen \|\| isTransactionModalOpen/,
      'Assets catalog fetch must be deferred until assets tab or modal open'
    );

    // Personalized news fetch deferred to news tab
    assert.match(
      appSource,
      /activeTab === 'news'/,
      'Personalized news fetch must be deferred until news tab is active'
    );

    // Portfolio activity/cash fetches deferred to portfolio tab
    assert.match(
      appSource,
      /activeTab === 'portfolio'/,
      'Transactions and cash ledger fetches must be deferred until portfolio tab is active'
    );
  });

  test('Built index.html excludes Three.js from initial modulepreload', async () => {
    const indexHtml = await readFile(path.join(CLIENT_DIST_DIR, 'index.html'), 'utf8');

    // Three.js chunk must NOT be preloaded in index.html
    assert.doesNotMatch(
      indexHtml,
      /three-[A-Za-z0-9_-]+\.js/,
      'Three.js chunk must not be in critical path modulepreload of index.html'
    );

    // Verify preload tags count is kept minimal (< 5 modulepreloads)
    const modulepreloads = indexHtml.match(/<link rel="modulepreload"/g) || [];
    assert.ok(
      modulepreloads.length <= 4,
      `Expected 4 or fewer modulepreload links in index.html, found ${modulepreloads.length}`
    );
  });
});
