# Current Project Status

## Latest Verified Repository Checkpoint
- Portfolio V1 P0.7 implementation base: `6c90275 fix: repair portfolio allocation syntax`; P0.1 through P0.6 remain the verified accounting, data, snapshot, Summary, Holdings, Performance, Allocation, and Activity foundations beneath it.
- Branch: `main`; production/remote migration state is intentionally unchanged by this implementation task.
- Tracked working tree was clean before P0.7 implementation; pre-existing untracked `server/artifacts/` remains preserved and untouched.
- Runtime architecture remains Cloudflare Workers Static Assets/frontend proxy and scheduler, Render Node.js/Express backend, and Supabase PostgreSQL/Auth.
- This checkpoint records repository behavior inspected on 2026-09-11. Exact production migration parity and deployment revision were not queried in this implementation phase.

## Current Phase
Portfolio V1 P0.7 Cleanup & Final Stabilization is implemented locally. Superseded Feature 10 CSS (~411 lines) and dead imports are safely removed; single snapshot authority drives Summary, Holdings, and Allocation; historical Performance and benchmarks remain separated; cash-only and mobile responsive UX verified; all regression tests from P0.1–P0.6 pass cleanly.
Portfolio P1A Idempotent Financial Writes is implemented and verified locally. Mutation endpoints (BUY/SELL transactions, cash deposits, cash withdrawals, opening position baselines) enforce strict idempotency via dedicated storage `public.portfolio_idempotency_records`, transactional advisory locking, parameter hash validation (`IC001` on conflict), and transparent replay returning cached response payloads with `Idempotent-Replayed: true` (HTTP 200). Frontend modals generate, attach, and rotate idempotency keys. All 1515 backend tests and client Vite production build pass cleanly.

## Portfolio — Verified Working Today
- Supabase Auth user identity resolves through `investor_profile.user_id` to private `investor_profile.id`; protected Express routes pass that profile ID to service-role data access and profile-scoped financial RPCs.
- VND is the reporting currency. Native quote currency is retained, and non-VND current valuation requires explicit supported FX evidence.
- Cash ledger records opening balance, deposits, withdrawals, and cash-settled BUY/SELL effects. BUY/SELL, holdings projection, linked cash entry, and cached profile cash update execute in one PostgreSQL function transaction.
- Portfolio transactions are immutable BUY/SELL records. Cost basis uses weighted average; partial SELL preserves average cost; realized P/L uses `(VND execution basis - pre-sale average cost) × sold quantity`.
- Opening positions establish cash-neutral known state, can be corrected/cancelled before ledger activity, and lock after a transaction.
- Portfolio overview returns cash, holdings, current VND market value, cost basis, unrealized P/L, FX metadata, and partial-valuation states without valuing an unpriced holding at zero.
- Composition derives from one overview inside its own request and distinguishes complete, partial, unavailable, and cash-only allocation bases.
- `GET /api/portfolio/snapshot` obtains one Portfolio overview and derives Summary, Holdings, and Allocation from that exact payload. Each block carries one deterministic `snapshotId`; the response also exposes a deterministic ledger-state checkpoint, calculation boundary, valuation coverage, and per-source price/FX timestamps.
- Performance exposes daily chained end-of-day TWR, XIRR/MWR, wealth-index drawdown, accounting P/L, coverage reasons, and completed-date series for 1W/1M/3M/6M/1Y.
- Missing or malformed authoritative cash is exposed as unavailable/partial rather than zero. Confirmed authoritative zero remains a valid zero.
- MWR/XIRR is annualized only when the evaluated cash-flow span is at least 365 days; shorter or unsolved cases return a null metric with an explicit reason.
- Historical valuation carry-forward is limited by the asset market policy: VN/global weekday markets may carry a completed close across weekend non-trading dates, while a missing subsequent trading-day close is stale and ineligible for TWR, MWR, drawdown, and end-period P/L.
- Benchmark comparison supports VN-Index price return (VND comparable) and S&P 500 price return (USD reference-only), using common dates and Base100 normalization.

## Portfolio P0.1 — Implemented and Verified Locally (Not Deployed)
- The authoritative current-schema bootstrap can build Portfolio-critical objects on a blank PostgreSQL database. Immutable chronological migrations are preserved; the old migration directory is documented as requiring a base schema rather than being rewritten.
- Linked tracked-cash BUY/SELL effects use the immutable transaction `executedAt` as economic time while `createdAt` remains the actual recording/audit time. Historical reads reconcile that authority through `portfolio_transaction_id` and fail closed if linkage is ambiguous.
- Canonical `assets.portfolio_eligibility` governs Portfolio entry. Current stocks, ETFs, funds, Gold, and Crypto remain eligible; `USD/VND` is `REFERENCE_ONLY`. Express routes and PostgreSQL triggers both enforce the rule.
- Migration `20260908000000_portfolio_v1_accounting_foundation.sql` remains unapplied remotely; no production database or deployment was changed.

## Portfolio P0.2 — Implemented and Verified Locally (Not Deployed)
- Cash RPC normalization rejects absent, empty, nonnumeric, non-finite, and negative authoritative balances. Portfolio overview and composition retain useful priced-holding facts but expose unavailable cash, null total portfolio value, and null allocation weights when the cash authority cannot be read.
- Performance reconstructs cash with strict authoritative values. XIRR spans below one year return `INSUFFICIENT_HISTORY`; ambiguous/no-root outcomes remain unavailable and never become zero.
- Historical marks use canonical asset market policy. Weekend carry remains valid for weekday markets; continuous markets and missing subsequent trading sessions cannot receive unbounded carry-forward.
- Cash-only performance makes zero market-history provider calls, keeps authoritative cash/total value available, invested value at zero, concentration absent, benchmark comparison not applicable in the client, and short-history annualized MWR absent.
- Local verification: focused Portfolio correctness tests 151/151 PASS; full backend 1444/1444 PASS; client and Worker production build PASS; `git diff --check` PASS.

## Portfolio P0.2.1 — Implemented Locally (Not Deployed)
- Existing-position entry uses the already-persisted `execution_unit_price` and `price_currency` fields as the native acquisition-cost pair. A supported non-VND position can be recorded without inventing `opening_average_cost`/`holdings.average_cost` in VND.
- Historical VND cost basis remains nullable and is never backfilled using current FX. Current VND market value may still use the canonical current USD snapshot plus authoritative current USD/VND valuation FX.
- Native unrealized P/L is exposed only when an unmodified opening position has a current price in exactly the same currency. Binance USDT is display-only for this purpose and never replaces CoinGecko USD accounting valuation; USDT is not treated as USD.
- Opening-position create/correct remains profile-scoped, portfolio-eligibility-gated, and cash-neutral. Existing VND and verified historical VND-basis rows are preserved without rewriting.
- Forward migration `20260909000000_portfolio_native_opening_cost.sql` is local and unapplied remotely.
- Local verification: focused native-opening-position tests 11/11 PASS; full backend 1455/1455 PASS; client and Worker production build PASS; `git diff --check` PASS.

## Portfolio P0.3 — Implemented Locally (Not Deployed)
- `GET /api/portfolio/snapshot` is authoritative for current Summary, Holdings, and Allocation acquisition. The browser updates all three atomically from one response; legacy overview/composition endpoints remain for compatibility only.
- `ledgerRevision` is explicitly a deterministic checkpoint over the cash and holding state actually read, not a fabricated database transaction snapshot. `snapshotId` additionally includes the exact valuation, price, FX, P/L, and source-as-of inputs used.
- Current-state completeness uses `AVAILABLE`, `PARTIAL`, `STALE`, `NOT_APPLICABLE`, `INSUFFICIENT_HISTORY`, and `UNAVAILABLE`. Unknown cash, price, FX, cost basis, and P/L remain null; confirmed zero remains zero.
- Holdings expose canonical asset identity/class/unit, native price and currency, current VND value, native and VND cost/P/L where valid, valuation state, and price/FX provenance timestamps without duplicating financial logic in the client.
- A cash-only portfolio returns authoritative cash/total, zero invested value, an empty holdings list, 100% cash allocation, and `NOT_APPLICABLE` concentration while making zero price, realtime, FX, or history calls.
- Local verification: focused Portfolio snapshot/accounting tests 62/62 PASS; full backend 1469/1469 PASS; client and Worker production build PASS; `git diff --check` PASS.

## Portfolio P0.4 — Implemented Locally (Not Deployed)
- One compact Summary now leads with total portfolio value, followed by authoritative cash, invested market value, valid unrealized P/L, snapshot state, and valuation time. Missing current-state values remain unavailable rather than becoming zero.
- Holdings immediately follow Summary. Desktop uses a compact table; mobile uses expandable cards. Both expose asset identity, quantity/unit, current/native price, native average cost where known, valid-currency unrealized P/L, VND market value, snapshot allocation weight, and price state/time.
- Native USDT acquisition cost and P/L remain USDT; current VND market value remains separately marked approximate for non-VND assets. Unknown historical VND cost/P/L is never fabricated.
- Cash-only Summary shows authoritative cash/total and confirmed zero invested value, followed by one compact empty-holdings message and the two primary portfolio actions. Deposit/withdraw actions remain available behind the secondary cash-management control.
- Performance remains on its separate historical/EOD request and clock. Allocation remains the P0.3 snapshot projection, and immutable transaction/cash activity remains available below it.
- Local verification: focused Portfolio display/snapshot/native-cost tests 40/40 PASS; full backend 1478/1478 PASS; client and Worker production build PASS; desktop/mobile visual check PASS; `git diff --check` PASS.

## Portfolio P0.5 — Implemented Locally (Not Deployed)
- Performance is one compact historical/EOD block. TWR and valid VND accounting P/L are primary; MWR/XIRR, drawdown, realized P/L during the period, and unrealized P/L at period end remain distinct secondary facts.
- The measured start/end dates, valid observation count, and historical/EOD clock are explicit. One to three observations use a compact summary instead of a large chart; missing or failed metrics remain unavailable rather than becoming zero.
- MWR/XIRR below 365 days remains `INSUFFICIENT_HISTORY`. Zero drawdown is reported as no drawdown observed during the measured period, without implying no risk and without meaningless peak/trough dates.
- Benchmark defaults to no selection. VN-Index is an eligible VND price-return comparison on common dates; S&P 500 remains a USD reference-only series. Compatible differences are labelled in percentage points and never as alpha.
- Cash-only performance remains provider-free and compact: no chart or benchmark request is made, while any valid historical/accounting facts remain visible.
- The block is responsive at desktop and 390px mobile width with one contained chart and no horizontal overflow. Summary, Holdings, Allocation, Activity, and their current-state snapshot semantics are unchanged.
- Local verification: focused performance/benchmark/Portfolio display tests 88/88 PASS; full backend 1493/1493 PASS; client and Worker production build PASS; desktop/mobile visual check PASS; `git diff --check` PASS.

## Portfolio P0.6 — Implemented Locally (Not Deployed)
- Allocation is simplified into a compact, informative horizontal presentation: dual segmented bar (Tiền mặt % vs Đang đầu tư %), top-3 concentration strictly on invested assets only (excluding cash from denominator), largest holding chip, and asset-type breakdown list.
- Cash-only allocation (e.g. 200,000,000 VND cash, 0 holdings) renders compactly as Tiền mặt 100% / Đang đầu tư 0% with concentration `NOT_APPLICABLE`, suppressing giant donuts, empty asset panels, largest holding, and top-3 stats.
- Partial and stale valuation states are preserved truthfully: unpriced assets remain visible with `—` instead of fake 0, and stale marks display "Dữ liệu cũ" with provenance time.
- Activity is redesigned to "Hoạt động gần đây" showing MAX 5 latest relevant events (BUY, SELL, opening positions, cash deposits/withdrawals/opening balance) with truthful currency semantics and no fake VND.
- Full ledger history is accessible via `[Xem toàn bộ lịch sử]` toggle, cleanly reusing existing transaction and cash components without duplicate ledgers.
- Cash management actions (`[Nạp tiền]`, `[Rút tiền]`) remain secondary behind `[Quản lý tiền mặt]`; primary user actions remain `[Ghi giao dịch]` and `[Khai báo tài sản đang có]`.
- Governed empty states: confirmed cash = 0 and holdings = 0 displays "Chưa có tài sản trong danh mục." with primary/secondary CTAs; fatal snapshot load error displays "Không thể tải dữ liệu danh mục." with retry action and never maps to empty portfolio; activity load error is displayed separately.
- Mobile layout (~390px) verified: no horizontal overflow, responsive wrapping, compact cards.
- Local verification: focused tests 12/12 PASS; core portfolio tests 86/86 PASS; full backend 1505/1505 PASS; client and Worker production build PASS; `git diff --check` PASS.

## Portfolio P0.7 — Implemented Locally (Not Deployed)
- Superseded Feature 10 composition & donut styles (~411 lines) safely removed from `client/src/index.css`, reducing production client CSS bundle size from ~112.8 kB to ~106.7 kB.
- Dead imports `TransactionHistorySection` and `CashManagementSection` removed from `client/src/App.jsx` (both components are encapsulated inside `PortfolioActivitySection`).
- Verified single snapshot authority: `GET /api/portfolio/snapshot` drives Summary, Holdings, and Allocation; frontend performs zero independent financial calculations.
- Preserved historical domain separation: Performance (TWR/MWR/drawdown) and benchmarks maintain independent historical queries.
- Preserved native-cost baseline for existing positions (crypto/gold native acquisition price/currency without fake VND historical cost; USDT != USD).
- Preserved governed six-state vocabulary: `AVAILABLE`, `PARTIAL`, `STALE`, `NOT_APPLICABLE`, `INSUFFICIENT_HISTORY`, `UNAVAILABLE`.
- Verified cash-only experience: compact 100% cash / 0% invested, concentration `NOT_APPLICABLE`, no oversized charts.
- Local verification: focused Portfolio test suite 93/93 PASS; full backend regression 1505/1505 PASS; client and Worker production build PASS; `git diff --check` PASS; Vite dev server loads without error overlay.

## Portfolio — Partial
- Performance and benchmark remain historical/EOD projections separate from the P0.3 current Summary/Holdings/Allocation snapshot clock.
- Historical performance supports only holdings that can be valued directly in VND. Historical non-VND performance remains unavailable because authoritative historical FX is not integrated.
- Transaction entry supports cross-currency execution metadata, but transaction-history rendering presents the VND accounting price as though it were the only execution price/currency.

## Portfolio — Missing
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

## Portfolio P0.1–P0.6 Verification and Remaining Blockers
- Disposable PostgreSQL execution reproduces two historical rebuild facts: the chronological migration directory has no initial-schema migration, and the immutable cross-currency migration references cash-ledger columns absent from its historical predecessor. Production may still be correct because it was evolved from an existing base; no production data was queried or changed here.
- The supported rebuild contract is the full current `server/db/schema.sql` bootstrap. Historical applied migrations remain audit history, and future changes continue through forward migrations. The new P0.1 forward migration changes no historical financial row.
- P0.1 closes the linked BUY/SELL economic-time split and the UI-only portfolio-eligibility bypass for future writes, while historical reads reconcile immutable legacy linkage without rewriting ledger records.
- P0.6 simplifies visible Allocation and Activity without modifying underlying financial accounting formulas.

Remaining blockers:
1. Historical FX authority for non-VND performance remains unavailable.

## Next Work
Continue with next Portfolio V1 priorities according to roadmap.
