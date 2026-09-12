import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const REVERSAL_MODAL_PATH = path.join(REPO_ROOT, 'client', 'src', 'components', 'ReversalModal.jsx');

async function loadReversalModalFunctions() {
  const { transformWithOxc } = await import('../../client/node_modules/vite/dist/node/index.js');
  const source = fs.readFileSync(REVERSAL_MODAL_PATH, 'utf8');
  const { code } = await transformWithOxc(source, 'ReversalModal.jsx', {});

  const functionSlice = code
    .slice(
      code.indexOf('function getStableTargetKey'),
      code.indexOf('export default function ReversalModal')
    )
    .replace(/export\s+/g, '');

  const factory = new Function(
    'getClientUUID',
    `${functionSlice}\nreturn { getStableTargetKey, createReversalIdempotencyManager };`
  );

  let counter = 1;
  const mockGetUuid = () => `mock-uuid-${counter++}`;
  const fns = factory(mockGetUuid);
  return { ...fns, source, mockGetUuid };
}

describe('Portfolio P1B — ReversalModal Idempotency Lifecycle Contract', () => {
  test('1. same target + network failure => retry uses SAME Idempotency-Key', async () => {
    const { createReversalIdempotencyManager, mockGetUuid } = await loadReversalModalFunctions();
    const manager = createReversalIdempotencyManager({ getUuid: mockGetUuid });

    const target = { type: 'TRANSACTION', item: { id: 'tx-001' } };
    const { idempotencyKey: firstKey } = manager.sync(true, target);
    assert.equal(firstKey, 'mock-uuid-1');

    // First submit begins
    assert.equal(manager.canSubmit(), true);
    assert.equal(manager.beginSubmit(), true);
    assert.equal(manager.getIdempotencyKey(), 'mock-uuid-1');

    // Network disconnect / timeout occurs => failure handler runs
    manager.handleFailure();
    assert.equal(manager.isSubmitting(), false);

    // User retries from the same open modal => MUST retain the exact same idempotency key
    assert.equal(manager.canSubmit(), true);
    assert.equal(manager.beginSubmit(), true);
    assert.equal(manager.getIdempotencyKey(), 'mock-uuid-1', 'Retry must preserve original idempotency key');
  });

  test('2. same target + rerender => SAME key', async () => {
    const { createReversalIdempotencyManager, mockGetUuid } = await loadReversalModalFunctions();
    const manager = createReversalIdempotencyManager({ getUuid: mockGetUuid });

    const target = { type: 'CASH', item: { id: 'cash-001' } };
    manager.sync(true, target);
    const keyBefore = manager.getIdempotencyKey();
    assert.equal(keyBefore, 'mock-uuid-1');

    // Simulated React re-render: sync called again with same props
    const { isNewIntent } = manager.sync(true, target);
    assert.equal(isNewIntent, false, 'Re-render with same target must not trigger new intent');
    assert.equal(manager.getIdempotencyKey(), keyBefore, 'Re-render must not rotate key');
  });

  test('3. same target object recreated with same stable ID => SAME key', async () => {
    const { createReversalIdempotencyManager, mockGetUuid } = await loadReversalModalFunctions();
    const manager = createReversalIdempotencyManager({ getUuid: mockGetUuid });

    const initialTarget = { type: 'TRANSACTION', item: { id: 'tx-abc-123' }, title: 'Tx 1' };
    manager.sync(true, initialTarget);
    const keyBefore = manager.getIdempotencyKey();

    // Parent re-renders and instantiates a brand new target object reference with identical type & id
    const recreatedTarget = { type: 'TRANSACTION', item: { id: 'tx-abc-123' }, title: 'Tx 1' };
    assert.notEqual(initialTarget, recreatedTarget);

    const { isNewIntent } = manager.sync(true, recreatedTarget);
    assert.equal(isNewIntent, false, 'Recreated object reference with identical ID must not trigger new intent');
    assert.equal(manager.getIdempotencyKey(), keyBefore, 'Idempotency key must remain identical');
  });

  test('4. close/reopen new intent => NEW key', async () => {
    const { createReversalIdempotencyManager, mockGetUuid } = await loadReversalModalFunctions();
    const manager = createReversalIdempotencyManager({ getUuid: mockGetUuid });

    const target = { type: 'TRANSACTION', item: { id: 'tx-001' } };
    manager.sync(true, target);
    const firstIntentKey = manager.getIdempotencyKey();
    assert.equal(firstIntentKey, 'mock-uuid-1');

    // Modal closes
    manager.sync(false, null);
    assert.equal(manager.getIdempotencyKey(), null);

    // Modal re-opens for another intent (even on same transaction)
    const { isNewIntent, idempotencyKey: secondIntentKey } = manager.sync(true, target);
    assert.equal(isNewIntent, true, 'Re-opening modal must initiate a fresh reversal intent');
    assert.equal(secondIntentKey, 'mock-uuid-2');
    assert.notEqual(secondIntentKey, firstIntentKey, 'Fresh intent must receive a distinct UUID key');
  });

  test('5. different target => NEW key', async () => {
    const { createReversalIdempotencyManager, mockGetUuid } = await loadReversalModalFunctions();
    const manager = createReversalIdempotencyManager({ getUuid: mockGetUuid });

    const targetA = { type: 'TRANSACTION', item: { id: 'tx-A' } };
    manager.sync(true, targetA);
    const keyA = manager.getIdempotencyKey();
    assert.equal(keyA, 'mock-uuid-1');

    // While open, target switches to target B
    const targetB = { type: 'TRANSACTION', item: { id: 'tx-B' } };
    const { isNewIntent, idempotencyKey: keyB } = manager.sync(true, targetB);
    assert.equal(isNewIntent, true, 'Switching target must trigger new intent');
    assert.equal(keyB, 'mock-uuid-2');
    assert.notEqual(keyB, keyA);
  });

  test('6. rapid double submit cannot create two concurrent economic requests', async () => {
    const { createReversalIdempotencyManager, mockGetUuid } = await loadReversalModalFunctions();
    const manager = createReversalIdempotencyManager({ getUuid: mockGetUuid });

    const target = { type: 'CASH', item: { id: 'cash-002' } };
    manager.sync(true, target);

    // Click 1: in-flight lock acquired
    assert.equal(manager.canSubmit(), true);
    const click1Allowed = manager.beginSubmit();
    assert.equal(click1Allowed, true, 'First click must be permitted');
    assert.equal(manager.isSubmitting(), true);

    // Click 2 (rapid microsecond double click while click 1 is still in-flight)
    assert.equal(manager.canSubmit(), false, 'canSubmit must be false while in-flight');
    const click2Allowed = manager.beginSubmit();
    assert.equal(click2Allowed, false, 'Synchronous guard must reject secondary click');

    // Click 1 completes with verified success
    manager.handleSuccess();
    assert.equal(manager.isSuccess(), true);
    assert.equal(manager.canSubmit(), false, 'Submit must remain blocked after success');
    assert.equal(manager.beginSubmit(), false);
  });

  test('7. Source Code Invariants: No failure rotation in catch & stable target dependency', async () => {
    const { source } = await loadReversalModalFunctions();

    // Invariant 1: catch block must NOT regenerate idempotency key
    assert.doesNotMatch(
      source,
      /catch\s*\([^)]*\)\s*\{[^}]*idempotencyKeyRef\.current\s*=\s*getClientUUID\(\)/,
      'Catch block must not rotate idempotencyKeyRef.current'
    );
    assert.doesNotMatch(
      source,
      /catch\s*\([^)]*\)\s*\{[^}]*getClientUUID\(\)/,
      'Catch block must not call getClientUUID'
    );

    // Invariant 2: useEffect must not depend directly on raw target object
    assert.doesNotMatch(
      source,
      /useEffect\(\(\)\s*=>\s*\{[^}]*\},\s*\[\s*isOpen\s*,\s*target\s*\]\)/,
      'useEffect must depend on stableTargetKey rather than raw target object'
    );
    assert.match(
      source,
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[\s*isOpen\s*,\s*stableTargetKey\s*\]\)/,
      'useEffect must depend on [isOpen, stableTargetKey]'
    );
  });
});
