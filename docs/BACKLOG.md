# Backlog & Deferred Scope

The following items are deferred for future phases and are strictly marked as **LATER** (out of current scope):

---

## 1. Deferred Feature Areas & Deep Modeling
- **[LATER] Deeper Bond Analytics**: Yield-to-maturity, duration, coupon schedules, and credit risk modeling.
- **[LATER] Deeper Bank-Deposit Modeling**: Term deposits, maturity tracking, rolling interest accrual, and early withdrawal penalties.
- **[LATER] Deeper Fund / NAV Analytics**: Mutual funds, open-ended fund subscription/redemption flows, and benchmark tracking beyond the priority ETF foundation.
- **[LATER] Advanced Portfolio Analytics**: Value at Risk (VaR), Sharpe ratio, drawdown risk, and correlation matrices.
- **[LATER] Scenario Analysis & Stress Testing**: Macro shock simulations and interest rate / FX sensitivity analysis.
- **[LATER] Multi-User & Authentication**: Multi-tenant database isolation, user accounts, and OAuth.
- **[LATER] Broker Execution & Integration**: Direct order submission, portfolio auto-rebalancing, and broker account sync.
- **[LATER] Realtime Broker Streaming**: Sub-second Websocket feeds replacing polling/delayed snapshots.
- **[LATER] Background Notification Dispatch**: Push notifications, Webhook triggers, SMS, and email alerts.
- **[LATER] Advanced AI Recommendation Engine**: AI investment thesis generation, macro sentiment weighting, and portfolio recommendation layers.

---

## 2. Unresolved Product & Architectural Questions (UNKNOWN)

The following design decisions are unresolved and intentionally deferred. They must not be assumed or decided prematurely:

- **Historical Multicurrency Portfolio Performance**:
  - `UNKNOWN`: Authoritative historical FX series, timestamp alignment, and replay rules needed to value non-VND holdings through time. Current transaction-time VND basis and current valuation FX do not solve historical performance.
- **Multicurrency Cash**:
  - `UNKNOWN`: Multi-currency cash account architecture and cash ledger conversion tracking.
- **Foreign Exchange History**:
  - `UNKNOWN`: USD/VND historical daily bar timezone alignment and provider selection for FX historical time series.
- **Funds**:
  - `UNKNOWN`: Open-ended mutual fund NAV strike mechanics, provider onboarding, and subscription/redemption flows (deferred beyond priority ETF foundation).
- **Provider Redundancy**:
  - `UNKNOWN`: Provider failover orchestration and multi-source redundancy policy.

---

## 3. Portfolio V1 Concrete Work Items

Statuses describe the repository state after the 2026-09-09 P0.2 implementation and do not imply deployment or remote migration.

| Priority | Work item | Data dependency | Method dependency | Acceptance criteria | Status |
|---|---|---|---|---|---|
| P0 | Fresh-database rebuild reproducibility | Current schema bootstrap plus forward migrations | Preserve immutable applied history; explicitly test historical replay debt | A blank database builds the authoritative current Portfolio schema; disposable PostgreSQL tests reproduce the old migration mismatch; no financial backfill/fabrication | COMPLETE_P0.1 |
| P0 | Reconciled portfolio snapshot | Cash ledger revision, holdings projection revision, price/FX observations | One valuation boundary and stable `snapshotId` | Summary, holdings, and allocation carry the same snapshot/revision; repeated consumers cannot mix price/FX vintages | MISSING |
| P0 | Completeness/freshness contract | Provider timestamps, FX timestamps, refresh attempts/results | Governed six-state vocabulary | Every portfolio metric returns an explicit state/reason; missing/error/NaN never becomes zero or ready | PARTIAL_P0.2 |
| P0 | Cash validation trust boundary | `get_cash_overview` result | Fail closed on malformed/missing authority | Overview rejects unavailable/malformed authoritative cash rather than coercing it to zero | COMPLETE_P0.2 |
| P0 | Performance eligibility correction | Authority start, dated valuations, cash flows | No annualization below one year; explicit insufficient/not-applicable cases | Short history never displays annualized XIRR; failed XIRR remains null; cash-only and one-point cases have explicit states | COMPLETE_P0.2 |
| P0 | Historical transaction timing consistency | Transaction `executedAt`/`createdAt`, cash-ledger link, opening cutoff | Linked BUY/SELL use transaction execution as economic time; ambiguous history fails closed | A back-entered internal BUY/SELL cannot create a period where the position effect and matching cash effect occur on different dates | COMPLETE_P0.1 |
| P0 | Server-side portfolio asset eligibility | Canonical `assets.portfolio_eligibility` | Reference-only assets are never positions | Transaction and opening-position APIs/RPCs reject `USD/VND` and any non-investable canonical asset even when called outside the UI | COMPLETE_P0.1 |
| P0 | Benchmark eligibility and selection | Portfolio TWR series, benchmark bars, currency metadata | Same period/return basis/currency; explicit reference-only mode | User can select a compatible benchmark or none; price return labelled; percentage-point difference never called alpha | PARTIAL |
| P0 | Summary + holdings-first API/UI | Reconciled snapshot | Governed page order | Summary → Holdings → Performance → Allocation → Activity; core values and data state visible without scrolling past performance | MISSING |
| P0 | Cash-only experience | Cash authority and zero-position state | Applicability truth table | Approximately 200M VND cash/zero holdings shows known cash and 100% cash allocation without false investment, concentration, benchmark comparison, or annualized metrics | PARTIAL_P0.2 |
| P0 | Idempotent financial writes | Transaction/cash request identity | At-most-once economic event semantics | Retried POST cannot create duplicate deposit/withdrawal/BUY/SELL; response returns stable event identity | MISSING |
| P0 | Auditable correction/reversal | Immutable ledgers and links | Append-only reversal/correction policy | Erroneous financial events are corrected without update/delete or loss of audit trail | MISSING |
| P1 | Realized/unrealized decomposition | Transactions, holdings, dated marks | Period and cumulative P/L definitions | API and UI separate realized, unrealized, and total accounting P/L with coverage/as-of metadata | PARTIAL |
| P1 | Income/fees/taxes event model | New authoritative ledger event types | Dividends are income; fees/taxes affect cash/cost/performance exactly once | No fee/dividend/tax amount is inferred; supported events reconcile across cash, P/L, and performance | MISSING |
| P1 | Transaction/activity projection | Execution price/currency, VND basis, settlement, FX provenance | Immutable event display | History shows native execution and VND accounting values truthfully; no hard-coded VND-only rendering | DEFECT |
| P1 | Performance request efficiency | Ever-held asset identities and shared valuations | Fetch only required histories; reuse one performance result | Cash-only requests make zero asset-history calls; benchmark does not recompute portfolio performance independently | PARTIAL_P0.2 |
| P1 | Export/reconciliation | Snapshot, ledgers, price/FX evidence | Stable audit columns and totals | Export can reproduce cash, positions, cost basis, valuations, and P/L for a stated snapshot | MISSING |
| P2 | Contribution analytics | Reconciled historical snapshots | Deterministic contribution method | Contributions sum to governed portfolio result and expose missing-data limits | DEFERRED |
| P2 | Composite benchmark | Constituent benchmark histories and target weights | Rebalancing and currency methodology | Composite is reproducible and compatible with portfolio return basis | REQUIRES_NEW_DATA |
| P2 | Target allocation/drift | User target weights | Explicit normalization and cash treatment | Targets validate to 100%; drift is derived from one reconciled snapshot | DEFERRED |
| DEFER | Risk/liquidity/sector/geography analytics | Authoritative histories and classification metadata | Versioned risk and classification methodology | No metric ships from inferred, sparse, or proxy data | REQUIRES_NEW_DATA |
