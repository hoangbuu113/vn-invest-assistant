# Project Strategic Roadmap & Execution Policy

This document serves as the durable strategic memory for project sequencing, feature dependencies, token/verification policies, and release milestones for the VN Invest Assistant.

---

## 1. Document Roles & Hierarchy

- **`docs/ROADMAP.md`**: Strategic memory, long-term feature sequencing, verification policy, and batching strategy.
- **`docs/CURRENT.md`**: Live operational state, immediate checkpoint, active task, and recent completed summaries.
- **`docs/DECISIONS.md`**: Authoritative, durable architectural and product decisions.
- **`docs/ASSET_MODEL.md`**: Cross-feature contract for multi-asset identity, calendars, prices, FX, and ledger authority.
- **`docs/PROJECT.md`**: Core product identity, target audience, stack, and non-goals.

---

## 2. Completed Historical V1 Features (01–30)

All 30 planned V1 roadmap features have been designed, implemented, hardened, and verified:

- **Feature 01**: Asset Browser (`/api/assets`)
- **Feature 02**: Market Snapshot (`/api/market/:symbol`)
- **Feature 03**: News Feed (`/api/news`)
- **Feature 04**: Investor Profile (`/api/profile`)
- **Feature 05**: Portfolio Overview (`/api/portfolio/overview`)
- **Feature 06**: Historical Price & Trend (`/api/market/:symbol/history`)
- **Feature 07**: Deterministic Asset Analysis (`/api/analysis/:symbol`)
- **Feature 08**: Watchlist / Danh sách theo dõi (`/api/watchlist`)
- **Feature 09**: Personal Investment Dashboard / Tổng quan
- **Feature 10**: Portfolio Composition & Concentration (`/api/portfolio/composition`)
- **Feature 11**: Asset Comparison / So sánh tài sản (`base100.series`)
- **Feature 12**: Price Alerts V1 / Cảnh báo giá (`/api/alerts`)
- **Feature 13**: Personalized Relevant News / Tin của tôi (`/api/news/personalized`)
- **Feature 14**: Transaction Ledger / Sổ lệnh giao dịch (`/api/transactions`)
- **Feature 15**: Cash / Capital Ledger / Sổ dòng tiền (`/api/cash/*`)
- **Feature 16**: Canonical Multi-Asset Foundation
- **Feature 17**: Ledger Authority & Position Integrity
- **Feature 18**: Market Provider Abstraction
- **Feature 19**: FX & Cross-Currency Valuation Foundation
- **Feature 20**: Real Multi-Asset Providers & Controlled Universe (49 canonical assets)
  - **Feature 20A**: Representative Real Multi-Asset Providers
  - **Feature 20B**: Controlled Crypto Universe Expansion
- **Feature 21**: Asset-Class Market & Historical Semantics (`VN_EXCHANGE`, `CONTINUOUS_24_7`, `GLOBAL_24_5`)
- **Feature 22**: Deterministic Asset Analysis V2 (`methodologyVersion = "v2"`)
- **Feature 23**: Multi-Asset News Foundation (CafeF, CoinDesk, Alpha Vantage)
- **Feature 24**: Existing Feature Multi-Asset Integration
  - **Feature 24A**: Backend / Canonical Capability Integration
  - **Feature 24B**: Frontend Capability-Aware Integration
- **Feature 25**: Portfolio Performance & Benchmarking
- **Feature 26**: Crypto Market Data Reliability & Hybrid Quote Authority (CoinGecko USD + Binance USDT)
- **Feature 27**: Vietnam Market Regime Foundation (NSO CPI, SBV money market, unprovisioned market breadth)
- **Feature 28**: Deterministic Opportunity Engine (`GET /api/opportunities`)
- **Feature 29**: Guarded AI Investment Brief (`POST /api/investment-brief`)
- **Feature 30**: Release Hardening & Production Gate

---

## 3. V1.1 Production Improvements (Post-V1 Architecture Upgrades)

Post-V1 engineering is structured as targeted **V1.1 Improvements** (NOT Feature 31+):

### V1.1 Improvement 12: Web Push Alert Delivery Engine
- **Scope**: Transitioned price alerts from refresh-only evaluation to background scheduler evaluation (Cloudflare Worker cron `*/15 * * * *` -> `POST /api/internal/alerts/evaluate` with `ALERT_SCHEDULER_TOKEN`).
- **Engine**: First-party Web Push delivery engine (`web-push`, RFC 8291 / RFC 8292).
- **Per-Device Delivery**: Multi-device subscriptions (`public.push_subscriptions`) with fanout deliveries (`public.alert_notification_deliveries`).
- **Resilience**: Bounded retry (up to 3 attempts, 15m backoff, automatic cleanup of 404/410 expired subscriptions).
- **Delivery Semantics**: Push service acceptance (`sent`) verified; best-effort display without unrealistic delivery guarantees.

### V1.1 Improvement 13: Public Multi-User Supabase Authentication & Profile Isolation
- **Scope**: Replaced single-owner access control with public multi-user Supabase Auth (email/password).
- **Retirement**: Completely retired `OwnerGate`, `OWNER_ACCESS_TOKEN` browser auth, HMAC session tokens, and session cookies (`vn_invest_owner_session`).
- **Isolation**: Each authenticated user maps 1:1 to an isolated `investor_profile` (`user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id)`).
- **Clean Start**: Every new user starts with `cash_available = 0`, 0 holdings, 0 transactions, and 0 synthetic records.
- **Cleanup**: The unowned 20,000,000 VND legacy profile was treated as disposable test data and permanently purged.

### V1.1 Improvement 19 & 25: Cross-Currency Accounting Foundation
- **Scope**: Dual-settlement VND-basis cross-currency accounting foundation.
- **Valuation**: Crypto and Gold spot current VND valuations operate through current USD/VND authority.
- **Historical Invariant**: Historical non-VND portfolio performance remains truthfully unavailable when historical FX authority is missing.

### V1.1 Improvement 27: Macro & Regime Hardening
- **Scope**: CPI reliability improvements active (NSO CPI archive cross-checks).
- **Truthful Degradation**: SBV money-market rates remain truthfully unavailable under upstream WAF (`OFFICIAL_DATA_UNAVAILABLE`) without fabricating fake interest rates.
- **Market Breadth**: Retained as `NOT_DEFENSIBLE_FOR_V1.1` (`status: 'unavailable'`, `reason: 'SOURCE_NOT_PROVISIONED'`).

---

## 4. V1.3 Market Intelligence & Evidence Architecture Upgrades (LOCAL COMPLETE)

V1.3 delivers institutional-grade market intelligence, historical evidence replay, strategy stability, data health observability, and deterministic opportunity screening:

### Feature 01C: Strategy Stability & Publication Safety
- **Two-Clock Lifecycle**: Decoupled continuous fast-clock evidence evaluation from patient slow-clock strategy publication (`STABLE`, `WATCH`, `REVIEW_REQUIRED`, `EVALUATING`).
- **Deterministic Materiality**: State mutations occur only on evaluated evidence changes or multi-source consensus; identical evidence produces deterministic `KEEP`.
- **Atomic Publication RPC**: Transactional RPC `publish_strategy_version_atomic` in PostgreSQL with concurrency locks and rollback protection.
- **Production Safety**: Silent fallback to in-memory strategy storage in production is removed.
- **Shadow Replay**: Evaluates historical strategy stability without lookahead bias.
- **Hysteresis Thresholds Policy**: Numeric hysteresis thresholds were intentionally not calibrated due to partial historical coverage across complete economic cycles; quantitative stability is governed deterministically without arbitrary fabricated thresholds.

### Feature 01D: Historical As-Of Evidence Replay & Claim Corroboration
- **Replay Safety Contract**: Time-travel evidence projection strictly as-of timestamp $T$.
- **System-Knowable Authority**: Ingestion authority enforces `asOf >= max(sourceAvailableAt, firstSeenAt)`.
- **Claim Corroboration**: Evidence links track multi-source independent corroboration and contradiction preservation.

### Feature 01E: Observability & Data Health
- **Deterministic Health States**: `HEALTHY`, `DEGRADED`, `FAILED`, `UNKNOWN` with strict precedence (`FAILED` > `DEGRADED` > `UNKNOWN` > `HEALTHY`).
- **Domain Invariant**: `job execution health != domain / data conclusion`.
- **Durable Checkpoints**: Checkpoints persist to `public.market_context_collector_checkpoints`. Production DB is strictly authoritative.
- **Public Observability Route**: `GET /api/system/data-health` reads durable checkpoints without external provider dependencies.

### Feature 01F: Vietnam Equity Evidence Foundation
- **Canonical Evidence Model**: `public.vn_equity_evidence_observations` stores immutable evidence vintages for Vietnamese equities.
- **Replay Timestamps**: Enforces `system_knowable_at >= first_seen_at` and `system_knowable_at >= source_available_at`.
- **Scope Boundary**: Price evidence is supported; issuer disclosures remain truthfully declared as `SOURCE_NOT_PROVISIONED`. Fundamentals are extended by the separate V1A contract below.

### Fundamentals V1A: Providerless Official-Filing Evidence Foundation
- **Scope**: Manual, administrator-authorized ingestion of official filings for canonically classified industrial/non-financial Vietnam-listed stocks only.
- **Evidence Contract**: Immutable, DB-unique logical filing revisions plus decimal-safe, source-located facts. Fact-level temporal identity preserves balance-sheet instants separately from quarter, YTD, half-year, and annual duration values.
- **Truthfulness**: No vendor, crawler, parser, seeded financial values, fabricated zero, or inferred missing facts. Only verified filings and verified facts enter the public projection.
- **Authority**: V1A filing/fact rows are the only trusted fundamentals path. Legacy generic fundamental observations are retained but excluded, and new generic-fundamental ingestion is prohibited.
- **Reads**: `GET /api/equities/:symbol/fundamentals` exposes annual, quarter, and YTD/interim periods without conflation, plus statement scope, audit status, source provenance, revision lineage, and explicit availability. Supported issuers with no filing are `NOT_INGESTED`; issuer-host ingestion without governed domain metadata is `SOURCE_NOT_PROVISIONED`.
- **Risk Tier**: HIGH RISK because it adds forward database structures and a privileged ingestion boundary; full server regression, executable migration verification, client build, and diff checks are required.

### Feature 01G: Deterministic Equity Opportunity Engine
- **Deterministic Screening**: Categorizes Vietnam equities into `QUALIFIED`, `WATCH`, `INSUFFICIENT_EVIDENCE`, `REJECTED`.
- **Policy Invariant**: `QUALIFIED` is currently reserved pending calibrated valuation/liquidity policies; valid closes evaluate to `WATCH`.
- **No Opaque Scores**: Zero opaque numerical scores, recommendations, price targets, or probabilities.
- **AI Explanation Boundary**: AI explanations are bounded strictly by cited candidate evidence; ungrounded numbers and forbidden action/speculative terms trigger deterministic fallback.
- **Qualification Immutability**: AI explanation failure never promotes, demotes, or mutates candidate qualification status.

---

## 5. Product Purpose & Non-Goals

- **Core Product Purpose**: Public multi-asset market intelligence and tracking showcase application.
- **Supporting Role**: Portfolio accounting is a supporting capability within the broader market intelligence workflow.
- **Non-Goals**:
  - Direct broker execution or automated trading.
  - Opaque speculative trading signals or fabricated confidence scores.
  - Fabricating rates when official data sources degrade or block under WAF.
  - Multi-hop FX conversions without authoritative rate sources.

---

## 6. Token & Cost Efficiency Policy

### Verification Tiers
- **LOW RISK**: Targeted UI checks, client build (`npm run build`).
- **MEDIUM RISK**: Affected route/unit tests, integration check, client build, git diff check.
- **HIGH RISK**: Full regression suite (`npm test`), migration history verification, remote database state checks, `git diff --check`.

### Golden Regression Batching
Comprehensive cross-feature golden regression tests are executed at strategic intervals:
- At major phase boundaries.
- Prior to production releases.
- Immediately following any change to core financial invariants.

---

## 7. Portfolio V1 Redesign Phase

Portfolio V1 remains a supporting personal tracking capability inside the broader market-intelligence product. Work must proceed from accounting/data authority to API projection and only then to UI restructuring.

### P0 — Correctness, Contracts, and Core UX
1. **COMPLETE (P0.1)** Establish an authoritative current-schema blank-database bootstrap, preserve immutable historical migrations, and prove the historical replay defect with disposable PostgreSQL tests.
2. **PARTIAL (P0.1 accounting-time scope complete)** Linked tracked-cash BUY/SELL and position reconstruction now align on transaction `executedAt`, with `createdAt` preserved as audit time and ambiguous history failing closed. Remaining authoritative current-price, FX, cash-validation, and completeness invariants continue in later P0 phases.
3. **COMPLETE (P0.1)** Enforce canonical portfolio asset eligibility at both server and database trust boundaries so reference-only instruments cannot bypass UI filtering.
4. **COMPLETE (P0.3)** Implement the governed completeness/freshness states: `AVAILABLE`, `PARTIAL`, `STALE`, `NOT_APPLICABLE`, `INSUFFICIENT_HISTORY`, `UNAVAILABLE`. Cash authority and historical-performance eligibility fail closed, and the reconciled current-state projection applies the vocabulary across Summary, Holdings, and Allocation.
5. **COMPLETE (P0.2.1)** Allow cash-neutral existing positions to retain supported native acquisition price/currency without requiring or fabricating historical VND cost basis. Same-currency native P/L is separate from VND accounting P/L.
6. **COMPLETE (P0.3)** Produce one reconciled portfolio projection so Summary, Holdings, and Allocation share a snapshot ID, deterministic ledger checkpoint, valuation time, and source timestamps.
7. **COMPLETE (P0.4)** Rebuild Summary around total portfolio value, cash, invested market value, valid unrealized P/L, and valuation/data state, using only the reconciled snapshot.
8. **COMPLETE (P0.4)** Move Holdings directly after Summary and expose truthful native price/cost/P/L, VND valuation, weight, and as-of state in a desktop table and mobile expandable cards.
9. **COMPLETE (P0.4)** Build a compact cash-only Summary/Holdings experience with one empty state and secondary cash management. Cash-only performance remains provider-free, and benchmark/concentration are not fabricated.
10. **COMPLETE (P0.5)** Consolidate Performance around primary TWR, separate accounting P/L, conditional MWR/drawdown, sparse-history presentation, and the no-annualization-below-one-year rule.
11. **COMPLETE (P0.5)** Enforce benchmark eligibility and add user-selected/no-benchmark behavior with explicit currency/return-basis compatibility. VN-Index is VND-comparable; S&P 500 remains reference-only.
12. **COMPLETE (P0.6)** Simplify Allocation and Activity, preserving known-value-only and immutable-ledger semantics without duplicate totals. Top-3 concentration denominator strictly excludes cash; cash-only renders compact 100% cash / 0% invested without concentration UI; Activity shows max 5 recent events with toggleable full history; cash management remains secondary.
13. **COMPLETE (P0.7)** Portfolio V1 cleanup and final stabilization: removed dead imports and superseded Feature 10 CSS (~411 lines); verified single snapshot authority, desktop/mobile responsiveness, cash-only compact UX, and regression test suite.

### P1 — Accounting Detail and Reconciliation
- **COMPLETE (P1A)**: Idempotent financial writes across BUY, SELL, cash deposit, cash withdrawal, and opening position baseline creation. Governed by dedicated `public.portfolio_idempotency_records` table, advisory xact locks, request hashing (`IC001` on mismatch), and replay semantics (`replayed: true` + `Idempotent-Replayed: true` header).
- **COMPLETE (P1B)**: Auditable correction/reversal semantics across BUY, SELL, cash deposit, and cash withdrawal. Immutable append-only model via compensating rows (`BUY_REVERSAL`, `SELL_REVERSAL`, offsetting `DEPOSIT`/`WITHDRAWAL`), dedicated audit log `public.portfolio_reversals`, double-reversal prevention (`RC001`), chronological/LIFO dependency checks (`RC002`), trade-linked cash isolation (`RC003`), reversal immutability (`RC004`), and cash balance protection (`CL001`). UI integration with `ReversalModal` in Transaction History and Cash Management.
- **COMPLETE (P1C)**: Multi-asset Activity and transaction-history display uses `executionUnitPrice` + `priceCurrency` as the native execution authority. VND accounting basis is separately labelled, USDT remains distinct from USD, missing native metadata remains unavailable, reversal events preserve the native pair, and manual cash activity remains VND.
- Realized/unrealized P/L decomposition by asset and period.
- Explicit income/dividend and fee/tax detail after governed ledger event types exist.
- Richer transaction history with idempotent writes and auditable correction/reversal semantics.
- Secondary MWR and drawdown detail with eligibility explanations.
- Export and reconciliation artifacts for cash, positions, transactions, prices, and FX.

### P2 — Advanced Portfolio Analysis
- Contribution analytics.
- Governed composite benchmark support.
- Target allocation and drift tracking.
- Deeper portfolio analytics built only on reconciled snapshots and authoritative history.

### Deferred / Requires New Authoritative Data
- Sharpe ratio, beta, correlation, and diversification scores.
- Liquidity scoring.
- Sector/geographic analytics without authoritative classification metadata.
- Automatic tax estimation.
- Margin, short, leverage, and derivative analytics.
