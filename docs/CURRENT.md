# Current Project Status

## Latest Verified Repository Checkpoint
- Portfolio V1 P0.1 implementation baseline: `24bd932 docs: rebaseline portfolio v1`.
- Branch: `main`; production/remote migration state is intentionally unchanged by this implementation task.
- Tracked working tree was clean before this documentation task; pre-existing untracked `server/artifacts/` remains preserved and untouched.
- Runtime architecture remains Cloudflare Workers Static Assets/frontend proxy and scheduler, Render Node.js/Express backend, and Supabase PostgreSQL/Auth.
- This checkpoint records repository behavior inspected on 2026-09-08. Exact production migration parity and deployment revision were not queried in this documentation phase.

## Current Phase
Portfolio V1 P0.1 Accounting Foundation is implemented and locally verified. It establishes the rebuild, economic-time, and portfolio-eligibility trust boundaries; later reconciled-snapshot, completeness, performance, and UI phases remain pending.

## Portfolio — Verified Working Today
- Supabase Auth user identity resolves through `investor_profile.user_id` to private `investor_profile.id`; protected Express routes pass that profile ID to service-role data access and profile-scoped financial RPCs.
- VND is the reporting currency. Native quote currency is retained, and non-VND current valuation requires explicit supported FX evidence.
- Cash ledger records opening balance, deposits, withdrawals, and cash-settled BUY/SELL effects. BUY/SELL, holdings projection, linked cash entry, and cached profile cash update execute in one PostgreSQL function transaction.
- Portfolio transactions are immutable BUY/SELL records. Cost basis uses weighted average; partial SELL preserves average cost; realized P/L uses `(VND execution basis - pre-sale average cost) × sold quantity`.
- Opening positions establish cash-neutral known state, can be corrected/cancelled before ledger activity, and lock after a transaction.
- Portfolio overview returns cash, holdings, current VND market value, cost basis, unrealized P/L, FX metadata, and partial-valuation states without valuing an unpriced holding at zero.
- Composition derives from one overview inside its own request and distinguishes complete, partial, unavailable, and cash-only allocation bases.
- Performance exposes daily chained end-of-day TWR, XIRR/MWR, wealth-index drawdown, accounting P/L, coverage reasons, and completed-date series for 1W/1M/3M/6M/1Y.
- Benchmark comparison supports VN-Index price return (VND comparable) and S&P 500 price return (USD reference-only), using common dates and Base100 normalization.

## Portfolio P0.1 — Implemented and Verified Locally (Not Deployed)
- The authoritative current-schema bootstrap can build Portfolio-critical objects on a blank PostgreSQL database. Immutable chronological migrations are preserved; the old migration directory is documented as requiring a base schema rather than being rewritten.
- Linked tracked-cash BUY/SELL effects use the immutable transaction `executedAt` as economic time while `createdAt` remains the actual recording/audit time. Historical reads reconcile that authority through `portfolio_transaction_id` and fail closed if linkage is ambiguous.
- Canonical `assets.portfolio_eligibility` governs Portfolio entry. Current stocks, ETFs, funds, Gold, and Crypto remain eligible; `USD/VND` is `REFERENCE_ONLY`. Express routes and PostgreSQL triggers both enforce the rule.
- Migration `20260908000000_portfolio_v1_accounting_foundation.sql` remains unapplied remotely; no production database or deployment was changed.

## Portfolio — Partial
- Overview, composition, performance, and benchmark are separate requests. They do not share a portfolio snapshot ID, ledger revision, valuation timestamp, or atomic read boundary.
- Historical performance supports only holdings that can be valued directly in VND. Historical non-VND performance remains unavailable because authoritative historical FX is not integrated.
- Performance carries the latest completed close forward without a bounded market-calendar staleness rule.
- The current XIRR path annualizes any solvable positive date span; the governed no-annualization-below-one-year rule is not implemented.
- Benchmark choice is component-local and defaults to VN-Index. There is no persisted user selection and no explicit no-benchmark state.
- Portfolio UI currently orders Performance before Summary/Holdings and spreads related values across independently refreshed blocks.
- Transaction entry supports cross-currency execution metadata, but transaction-history rendering presents the VND accounting price as though it were the only execution price/currency.

## Portfolio — Missing
- One reconciled Summary/Holdings/Allocation snapshot contract with `snapshotId`, ledger revision, valuation time, and refresh metadata.
- Unified portfolio states: `AVAILABLE`, `PARTIAL`, `STALE`, `NOT_APPLICABLE`, `INSUFFICIENT_HISTORY`, `UNAVAILABLE`.
- Idempotency keys for financial writes and auditable transaction correction/reversal flows.
- Governed fee, tax, dividend/income, adjustment, and asset-transfer ledger events.
- Daily P/L and unified total/accounting P/L in the overview API.
- Historical FX authority for non-VND portfolio performance.

## Portfolio — Unverified Runtime Facts
- Provider availability and current price/FX freshness were not live-probed.
- Exact production DDL and migration contents were not remotely queried.
- The task authority reports the current portfolio as approximately 200,000,000 VND cash with zero holdings; this audit did not mutate or independently query that private production record.

## Broader Project State Preserved from the Previous Checkpoint

### Strategy Stability & Publication Safety (01C)
- Two-clock evidence evaluation and strategy publication remain separated. Lifecycle states remain `STABLE`, `WATCH`, `REVIEW_REQUIRED`, and `EVALUATING`; publication decisions remain deterministic `KEEP`, `REVIEW_REQUIRED`, or `PUBLISH_NEW` outcomes.
- Atomic persistence remains governed by `publish_strategy_version_atomic(p_new_version, p_expected_current_strategy_id)`, including expected-current locking and rollback on failure.
- Production strategy persistence is database-authoritative; silent memory publication fallback is not allowed.
- Historical shadow replay remains lookahead-safe. Numeric hysteresis thresholds remain intentionally uncalibrated rather than fabricated from incomplete cycle history.

### Historical As-Of Evidence Replay (01D)
- Replay remains bounded by an explicit as-of time and trusted system knowability: evidence is not admitted before `max(sourceAvailableAt, firstSeenAt)`; publication timestamps and caller flags cannot bypass system ingestion time.
- Structured claim corroboration and contradiction preservation remain part of the evidence model.

### Observability & Data Health (01E)
- Job health states remain `FAILED > DEGRADED > UNKNOWN > HEALTHY` with durable production checkpoints and provider-free `GET /api/system/data-health`.
- The nine observed paths remain market context, official macro/monetary, customs, news, claims reconciliation, market strategist, alerts, equity evidence, and opportunity refresh.
- Job execution health remains distinct from domain/data conclusions. Production checkpoints remain database-authoritative; memory is limited to explicit offline/test operation.

### Vietnam Equity Evidence (01F)
- Immutable, replay-safe Vietnam equity evidence vintages remain persisted in `public.vn_equity_evidence_observations`; the public provider-free equity-evidence read path remains implemented.
- Completed price evidence is supported; official fundamentals and issuer disclosures remain `SOURCE_NOT_PROVISIONED`.

### Deterministic Equity Opportunity Engine (01G)
- Evidence-bounded deterministic categories remain `QUALIFIED`, `WATCH`, `INSUFFICIENT_EVIDENCE`, and `REJECTED`, separate from AI explanation. No opaque score, target price, probability, or AI mutation of qualification is permitted.
- `QUALIFIED` remains reserved pending calibrated policy; supported evidence may yield `WATCH`.
- Public deterministic equity opportunities remain separate from the private portfolio-aware `/api/opportunities` route.

### Market Strategist, Confidence, and Monetary Evidence
- Immutable published strategy and current-evidence brief are separate projections with separate clocks.
- Confidence v2 remains deterministic and calibration-gated; AI cannot upgrade grades or remove evidence caps.
- Official monetary evidence uses scoped structured dependencies and replay-safe knowability. Source-access limitations remain explicit rather than substituted with unofficial evidence.

## Known Cross-Project Limitations Preserved
- Official Vietnam equity fundamentals and corporate disclosure providers remain unprovisioned.
- Strategy-stability numeric hysteresis thresholds remain intentionally uncalibrated rather than backfit.
- USD/VND historical bars/historical FX authority remain insufficient for non-VND portfolio performance.
- Gold spot history remains close-only where the configured provider cannot supply authoritative OHLC.

## Portfolio P0.1 Verification and Remaining Blockers
- Disposable PostgreSQL execution reproduces two historical rebuild facts: the chronological migration directory has no initial-schema migration, and the immutable cross-currency migration references cash-ledger columns absent from its historical predecessor. Production may still be correct because it was evolved from an existing base; no production data was queried or changed here.
- The supported rebuild contract is the full current `server/db/schema.sql` bootstrap. Historical applied migrations remain audit history, and future changes continue through forward migrations. The new P0.1 forward migration changes no historical financial row.
- P0.1 closes the linked BUY/SELL economic-time split and the UI-only portfolio-eligibility bypass for future writes, while historical reads reconcile immutable legacy linkage without rewriting ledger records.

Remaining blockers:
1. No reconciled portfolio snapshot/ledger-revision contract exists; independent Summary/Holdings/Allocation refreshes may describe different price/FX moments.
2. Short-history XIRR is annualized despite the governed Portfolio V1 methodology.
3. The six-state completeness/freshness contract and fail-closed cash validation remain incomplete.
4. Historical FX authority for non-VND performance remains unavailable.

## Next Work
Continue the Portfolio V1 P0 sequence in `docs/ROADMAP.md` with completeness/freshness and a single reconciled backend portfolio projection. UI redesign must follow those authorities rather than precede them.
