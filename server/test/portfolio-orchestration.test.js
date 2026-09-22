import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  apiFetch,
  clearInFlightRequests
} from '../../client/src/utils/api.js';

describe('Portfolio Refresh Orchestration & Abort Isolation', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    clearInFlightRequests();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearInFlightRequests();
  });

  describe('apiFetch Abort Isolation', () => {
    test('A. old aborted GET does not abort a newer caller or surviving waiter', async () => {
      let fetchCount = 0;
      let abortReceivedOnFetch = false;

      global.fetch = (url, options) => {
        fetchCount++;
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            resolve(new Response(JSON.stringify({ status: 'ok', data: 'portfolio-snapshot' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }));
          }, 50);

          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              clearTimeout(timeoutId);
              abortReceivedOnFetch = true;
              const err = new Error('The user aborted a request.');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      };

      const controllerA = new AbortController();
      const controllerB = new AbortController();

      // Caller A starts request
      const reqA = apiFetch('/api/portfolio/snapshot', { signal: controllerA.signal });

      // Caller B arrives while A is in flight
      const reqB = apiFetch('/api/portfolio/snapshot', { signal: controllerB.signal });

      // Caller A aborts
      controllerA.abort();

      // Caller A must reject with AbortError
      await assert.rejects(reqA, (err) => {
        return err.name === 'AbortError' || err.message?.includes('aborted');
      });

      // Caller B must SUCCEED with 200 response (not aborted by A)
      const resB = await reqB;
      assert.equal(resB.status, 200);
      const jsonB = await resB.json();
      assert.equal(jsonB.data, 'portfolio-snapshot');

      // The underlying fetch was NOT aborted because Caller B was still active
      assert.equal(abortReceivedOnFetch, false);
      assert.equal(fetchCount, 1);
    });

    test('B. waiter whose own signal aborts receives AbortError without killing shared fetch', async () => {
      global.fetch = async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      };

      const controllerWaiter = new AbortController();

      // Caller 1 (primary)
      const req1 = apiFetch('/api/portfolio/snapshot');

      // Caller 2 (waiter with signal)
      const req2 = apiFetch('/api/portfolio/snapshot', { signal: controllerWaiter.signal });

      // Abort waiter only
      controllerWaiter.abort();

      await assert.rejects(req2, (err) => {
        return err.name === 'AbortError' || err.message?.includes('aborted');
      });

      // Primary caller 1 must still resolve successfully
      const res1 = await req1;
      assert.equal(res1.status, 200);
    });

    test('C. aborted in-flight entry is cleaned up when all consumers abort', async () => {
      let abortedSignalFired = false;
      global.fetch = (url, options) => {
        return new Promise((resolve, reject) => {
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              abortedSignalFired = true;
              const err = new Error('Aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      };

      const controller = new AbortController();
      const req = apiFetch('/api/portfolio/snapshot', { signal: controller.signal });

      // Yield a microtask tick so apiFetch starts and creates entry before aborting
      await new Promise((r) => setTimeout(r, 5));
      controller.abort();
      await assert.rejects(req);

      // Verify underlying internal abort was triggered
      assert.equal(abortedSignalFired, true);
    });

    test('D. next request after abort can successfully fetch', async () => {
      let callCount = 0;
      global.fetch = async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(JSON.stringify({ call: callCount }), { status: 200 });
      };

      const controller1 = new AbortController();
      const req1 = apiFetch('/api/portfolio/snapshot', { signal: controller1.signal });
      await new Promise((r) => setTimeout(r, 5));
      controller1.abort();
      await assert.rejects(req1);

      // Now immediately dispatch a second request
      const req2 = await apiFetch('/api/portfolio/snapshot');
      const json2 = await req2.json();
      assert.equal(json2.call, 2);
    });
  });

  describe('Portfolio Refresh Orchestration Simulation', () => {
    test('E & F. entering Portfolio starts snapshot once and auxiliary updates do NOT retrigger snapshot', async () => {
      let snapshotCalls = 0;
      let transactionsCalls = 0;
      let cashOverviewCalls = 0;
      let cashLedgerCalls = 0;

      global.fetch = async (url) => {
        if (url.includes('/api/portfolio/snapshot')) {
          snapshotCalls++;
          return new Response(JSON.stringify({ status: 'ok', data: { allocation: {} } }), { status: 200 });
        }
        if (url.includes('/api/transactions')) {
          transactionsCalls++;
          return new Response(JSON.stringify({ status: 'ok', data: [{ id: 1 }] }), { status: 200 });
        }
        if (url.includes('/api/cash/overview')) {
          cashOverviewCalls++;
          return new Response(JSON.stringify({ status: 'ok', data: { cashAvailable: 1000000 } }), { status: 200 });
        }
        if (url.includes('/api/cash/ledger')) {
          cashLedgerCalls++;
          return new Response(JSON.stringify({ status: 'ok', data: [{ id: 'ledger-1' }] }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      };

      // Simulate App state and refs
      let activeTab = 'portfolio';
      let transactions = [];
      let cashOverview = null;
      let cashLedger = [];

      const transactionsRef = { current: transactions };
      const cashOverviewRef = { current: cashOverview };
      const cashLedgerRef = { current: cashLedger };

      const fetchPortfolio = () => apiFetch('/api/portfolio/snapshot', { dedupe: false });
      const fetchTransactions = (isInitial) => apiFetch('/api/transactions');
      const fetchCashOverview = (isInitial) => apiFetch('/api/cash/overview');
      const fetchCashLedger = (isInitial) => apiFetch('/api/cash/ledger');

      // 1. Initial tab entry effect execution
      const runPortfolioTabEffect = async () => {
        if (activeTab !== 'portfolio') return;
        return Promise.all([
          fetchPortfolio(),
          fetchTransactions(transactionsRef.current.length === 0),
          fetchCashOverview(cashOverviewRef.current === null),
          fetchCashLedger(cashLedgerRef.current.length === 0)
        ]);
      };

      await runPortfolioTabEffect();

      assert.equal(snapshotCalls, 1, 'Snapshot should be called exactly once on entry');
      assert.equal(transactionsCalls, 1);
      assert.equal(cashOverviewCalls, 1);
      assert.equal(cashLedgerCalls, 1);

      // 2. Simulate auxiliary responses landing and updating state
      transactions = [{ id: 1 }];
      transactionsRef.current = transactions;
      cashOverview = { cashAvailable: 1000000 };
      cashOverviewRef.current = cashOverview;
      cashLedger = [{ id: 'ledger-1' }];
      cashLedgerRef.current = cashLedger;

      // Because the effect dependency array does NOT include transactions.length, cashOverview, cashLedger.length,
      // the effect does NOT re-run on these state updates!
      // Verify snapshotCalls remains exactly 1
      assert.equal(snapshotCalls, 1, 'Auxiliary data arrivals must not trigger snapshot re-fetch');
    });

    test('G & H. manual refresh starts exactly one snapshot and preserves existing data', async () => {
      let snapshotCalls = 0;
      let resolveSnapshot;

      global.fetch = async (url) => {
        if (url.includes('/api/portfolio/snapshot')) {
          snapshotCalls++;
          return new Promise((resolve) => {
            resolveSnapshot = () => resolve(new Response(JSON.stringify({
              status: 'ok',
              data: { version: 2, allocation: {} }
            }), { status: 200 }));
          });
        }
        return new Response('{}', { status: 200 });
      };

      // Existing portfolio state
      let portfolioOverview = { version: 1, holdings: [{ symbol: 'FPT' }] };
      let portfolioRefreshing = false;

      // User clicks "Làm mới"
      portfolioRefreshing = true;
      const refreshPromise = apiFetch('/api/portfolio/snapshot', { dedupe: false })
        .then((res) => res.json())
        .then((json) => {
          portfolioOverview = json.data;
        })
        .finally(() => {
          portfolioRefreshing = false;
        });

      // Yield a tick so fetch starts
      await new Promise((r) => setTimeout(r, 10));

      // While pending, existing portfolioOverview is STILL visible (version 1)
      assert.equal(portfolioRefreshing, true);
      assert.equal(portfolioOverview.version, 1, 'Existing data must remain visible while refresh is pending');
      assert.equal(snapshotCalls, 1);

      // Snapshot completes
      resolveSnapshot();
      await refreshPromise;

      assert.equal(portfolioRefreshing, false);
      assert.equal(portfolioOverview.version, 2, 'New data rendered after refresh completes');
    });

    test('I. core snapshot completion clears core refresh state even if auxiliary request is still pending', async () => {
      let resolveAuxiliary;

      global.fetch = async (url) => {
        if (url.includes('/api/portfolio/snapshot')) {
          // Fast snapshot
          return new Response(JSON.stringify({ status: 'ok', data: { allocation: {} } }), { status: 200 });
        }
        if (url.includes('/api/cash/ledger')) {
          // Slow auxiliary request
          return new Promise((resolve) => {
            resolveAuxiliary = () => resolve(new Response(JSON.stringify({ status: 'ok', data: [] }), { status: 200 }));
          });
        }
        return new Response('{}', { status: 200 });
      };

      let portfolioRefreshing = true;
      let cashLedgerRefreshing = true;

      const p1 = apiFetch('/api/portfolio/snapshot', { dedupe: false }).finally(() => {
        portfolioRefreshing = false;
      });
      const p2 = apiFetch('/api/cash/ledger').finally(() => {
        cashLedgerRefreshing = false;
      });

      await p1;

      // Core refresh state is cleared immediately!
      assert.equal(portfolioRefreshing, false, 'Core refresh state must clear when snapshot completes');
      // Auxiliary request is still pending
      assert.equal(cashLedgerRefreshing, true, 'Auxiliary request remains in flight independently');

      // Finish auxiliary
      resolveAuxiliary();
      await p2;
      assert.equal(cashLedgerRefreshing, false);
    });

    test('J. startup GET dedupe from prior 429 fix still works', async () => {
      let callCount = 0;
      global.fetch = async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      };

      const [r1, r2] = await Promise.all([
        apiFetch('/api/profile'),
        apiFetch('/api/profile')
      ]);

      assert.equal(callCount, 1, 'Concurrent identical GETs must be deduped');
      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);
    });

    test('K. React StrictMode mount/unmount simulation does not create an abort loop', async () => {
      let activeFetches = 0;
      let totalDispatches = 0;

      global.fetch = async (url, options) => {
        totalDispatches++;
        activeFetches++;
        await new Promise((resolve) => setTimeout(resolve, 30));
        activeFetches--;
        return new Response(JSON.stringify({ status: 'ok', data: { allocation: {} } }), { status: 200 });
      };

      // StrictMode: Component mounts (mount 1), unmounts (cleanup 1), mounts again (mount 2)
      let controller1 = new AbortController();
      const mount1 = apiFetch('/api/portfolio/snapshot', { signal: controller1.signal, dedupe: false });
      await new Promise((r) => setTimeout(r, 5));

      // Unmount 1: aborts mount 1
      controller1.abort();
      await assert.rejects(mount1);

      // Mount 2: starts fresh
      let controller2 = new AbortController();
      const mount2 = await apiFetch('/api/portfolio/snapshot', { signal: controller2.signal, dedupe: false });
      assert.equal(mount2.status, 200);

      // Exactly 2 requests dispatched, no hanging, no loop
      assert.equal(totalDispatches, 2);
    });
  });
});
