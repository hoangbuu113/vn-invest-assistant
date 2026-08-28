# Confirmed Product & Architectural Decisions

The following architectural and product decisions are confirmed and authoritative across the project:

---

## 1. General Product & User Model
- **Target User**: Single-user application (personal use only; no multi-tenant or authentication complexity in V1).
- **Reporting Currency**: **VND** is the universal portfolio reporting currency. Native quote currencies are preserved and converted using explicit FX rates. Missing FX rates produce partial/unavailable valuations, never assumed 1:1 conversions.
- **Scope of Execution**: Strictly analysis, tracking, and decision support. No trade execution, no broker order placement, and no automated fund management.
- **AI Principles**: All quantitative metrics, valuations, and rankings are deterministic facts computed by models/formulas. LLMs explain and summarize facts; they never fabricate financial figures or ratings.

---

## 2. Multi-Asset Strategy & Market Semantics
- **Priority Asset Universe**:
  1. Vietnamese stocks
  2. ETFs / funds
  3. Gold
  4. USD / FX (initially USD/VND)
  5. Crypto (~Top 40 major/liquid assets)
- **Market Calendars & Time Semantics**:
  - Vietnam equities follow exchange session trading hours.
  - Crypto operates 24/7 with no exchange session closes.
  - FX and commodities have independent global trading sessions.
  - There is no single universal "daily bar completion" rule; market calendars and completed-bar logic are asset-class specific.
- **Symbol & Provider Independence**: Canonical asset identity (`id`, `symbol`, `name`, `asset_type`, `quote_currency`) is decoupled from provider-specific ticker symbols (such as Yahoo `.VN`). Feature code must not construct provider-specific ticker strings.
- **Analysis Specialization**: Quantitative analysis rules must be tailored to asset-class mechanics; equity-specific metrics are not blindly applied to crypto, gold, or FX.

---

## 3. Financial Authority & Double-Ledger Architecture
- **Position Authority (Transaction Ledger — Feature 14)**:
  - `public.portfolio_transactions` is the canonical immutable record of position changes (BUY / SELL).
  - Positions use the **weighted-average cost** method: `((prevQty * prevAvgCost) + (buyQty * buyPrice)) / (prevQty + buyQty)`.
  - Realized P/L is computed upon SELL as `(sellPrice - preSellAvgCost) * sellQuantity` and persisted directly on the transaction record.
  - Existing holdings predating Feature 14 are valid opening positions; historical transactions are not fabricated.
- **Cash Authority (Cash Ledger — Feature 15)**:
  - `public.cash_ledger_entries` is the authoritative source of truth for cash capital.
  - Opening cash baseline represents cash at Feature 15 activation, **NOT** lifetime starting wealth or initial deposit.
  - Movements: `OPENING_BALANCE`, `DEPOSIT`, `WITHDRAWAL`, `BUY` (cash outflow), `SELL` (cash inflow).
  - BUY and SELL cash mutations execute atomically with portfolio transaction logging and holding updates in PostgreSQL.
  - No negative cash balances are permitted in V1 (withdrawals or buys exceeding available cash are rejected).
  - The `investor_profile.cash_available` column and `holdings` table serve strictly as synchronized read caches / compatibility layers, not competing independent financial authorities.
  - The frontend never calculates authoritative cash totals or positions itself.
- **Deprecation of Direct Mutations**:
  - Direct user-facing cash editing is removed. Cash changes must go through deposit/withdrawal ledger operations.
  - Direct holdings CRUD (`POST`/`PUT`/`DELETE /api/holdings`) is retained solely for legacy backend compatibility; new position changes are recorded via immutable transactions.

---

## 4. Valuation, Market Data & Precision Invariants
- **Valuation Strategy (Feature 05)**:
  - Portfolio metrics (cost basis, market value, unrealized P/L, total portfolio value) are computed on demand from authoritative holdings + latest prices. They are not stored as independent persisted truth.
  - A holding is priced only when market price is finite and > 0.
  - Missing market data or FX rates produce explicit partial valuation (`valuationStatus: 'partial'`), never fake 0 prices or fabricated valuations.
- **Numerical Precision**: Intermediate financial calculations retain full floating-point/numeric precision without premature two-decimal rounding. Rounding is presentation-only.
- **Data Labeling**: Market snapshots are clearly disclosed as delayed (~15 min for equities) with explicit timestamp provenance. Missing source timestamps remain `null`.

---

## 5. Cross-Feature Relationships
- **Portfolio Overview (Feature 05)**: Combines holdings + cash overview + market data on demand.
- **Portfolio Composition (Feature 10)**: Derives allocations and concentration metrics purely from Feature 05 portfolio valuation.
- **Asset Comparison (Feature 11)**: Consumes canonical Feature 07 analysis and historical price metrics across 2–4 selected assets without client-side formula recalculation.
- **Price Alerts (Feature 12)**: One-shot persistent alert lifecycle (`active` -> `triggered`) evaluated deterministically against canonical market snapshots.
- **Personalized Relevant News (Feature 13)**: Dynamic token matching against current holdings and watchlist assets; acts as a filtered view of the canonical news feed without a separate ingestion pipeline.
- **Personal Investment Dashboard (Feature 09)**: High-level overview coordinating summary metrics, watchlist movers, and latest news. Expansion is frozen until multi-asset foundation contracts are established.
