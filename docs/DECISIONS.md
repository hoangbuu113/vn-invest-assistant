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

## 3. Canonical Multi-Asset Foundation (Feature 16)
- **Canonical Asset Identity**:
  - The internal asset UUID (`public.assets.id`) is the sole canonical asset identifier across all application modules.
  - Canonical symbol (`symbol`) represents the universal human-readable ticker and is decoupled from provider-specific symbols.
  - Third-party provider symbols are stored explicitly in `public.asset_provider_mappings` (`asset_id`, `provider`, `provider_symbol`, `provider_market`).
- **Implemented Canonical Metadata**:
  - `market_code`: Canonical market or venue code (e.g. `HOSE`, `HNX`).
  - `quote_currency`: Currency in which prices are quoted (e.g. `VND`, `USD`).
  - `base_currency`: Base asset currency for pairs (e.g. `USD` in `USD/VND`, `BTC` in `BTC/USD`), or `NULL` for single instruments.
  - `market_policy`: Market trading schedule policy (`VN_EXCHANGE`, `CONTINUOUS_24_7`, `GLOBAL_24_5`, `NAV_SCHEDULED`, `INSTRUMENT_DEFINED`).
  - `market_timezone`: Standard IANA timezone string (e.g. `Asia/Ho_Chi_Minh`, `UTC`).
  - `quantity_unit`: Unit of position quantity (e.g. `share`, `unit`, `oz`, `coin`).
  - `is_active`: Operational status flag for active trading/tracking.
  - *Note*: The legacy `exchange` column is retained temporarily solely for backwards compatibility with un-migrated consumers; `market_code` is the canonical field.
- **Strict Provider Mappings & No Implicit Inference**:
  - Market data and history fetching require an explicit provider mapping in `public.asset_provider_mappings`.
  - Implicit symbol manipulation (such as automatically appending `.VN`) is completely removed. Unknown assets without explicit mappings fail safely without provider calls.
- **Multi-Asset Accounting Guard**:
  - The current single cash ledger and portfolio transaction engine operate strictly in `VND`.
  - Non-VND BUY/SELL transactions are blocked at the database trigger level (`enforce_vnd_portfolio_transaction_asset`) until multi-currency FX accounting is implemented. No silent currency conversion is permitted.
- **Zero-Loss Data Migration**:
  - Existing asset UUIDs are preserved in place without deletion or re-creation.
  - All existing holdings, portfolio transactions, cash ledger entries, watchlist items, and price alerts remain linked to their original asset UUIDs.

---

## 4. Financial Authority & Double-Ledger Architecture
- **Position Authority & Ledger Enforcement (Features 14 & 17)**:
  - `public.portfolio_transactions` is the canonical immutable record of position changes (BUY / SELL).
  - Positions use the **weighted-average cost** method: `((prevQty * prevAvgCost) + (buyQty * buyPrice)) / (prevQty + buyQty)`.
  - Realized P/L is computed upon SELL as `(sellPrice - preSellAvgCost) * sellQuantity` and persisted directly on the transaction record.
  - The `holdings` table serves purely as a synchronized projection / read model derived from opening baselines plus immutable transaction history. Direct application-role DML on `holdings` is denied at PostgreSQL level; mutations execute exclusively via SECURITY DEFINER RPCs.
  - Generic public holdings mutation endpoints (`POST`/`PUT`/`DELETE /api/holdings`) are retired; `GET /api/holdings` remains as read model query.
- **Cash Authority (Cash Ledger — Feature 15)**:
  - `public.cash_ledger_entries` is the authoritative source of truth for cash capital.
  - Opening cash baseline represents cash at Feature 15 activation, **NOT** lifetime starting wealth or initial deposit.
  - Movements: `OPENING_BALANCE`, `DEPOSIT`, `WITHDRAWAL`, `BUY` (cash outflow), `SELL` (cash inflow).
  - BUY and SELL cash mutations execute atomically with portfolio transaction logging and holding updates in PostgreSQL.
  - No negative cash balances are permitted in V1 (withdrawals or buys exceeding available cash are rejected).
  - The `investor_profile.cash_available` column and `holdings` table serve strictly as synchronized read caches / compatibility layers, not competing independent financial authorities.
  - The frontend never calculates authoritative cash totals or positions itself.
- **Opening Position Authority & Baseline Integrity (Feature 17)**:
  - Opening positions represent explicit baselines for already-owned assets predating active ledger tracking (`public.position_opening_baselines`).
  - Recording an opening position creates or updates the holding baseline but generates **NO** portfolio transaction record and **NO** cash movement (avoiding cash duplication and historical BUY fabrication).
  - Opening-position corrections or cancellations are permitted only prior to subsequent ledger activity for that asset. The first subsequent BUY or SELL transaction permanently locks the opening baseline.
  - After ledger activation on a position, all subsequent quantity and cost basis mutations must proceed exclusively through immutable BUY/SELL transactions in the Transaction Ledger.
  - Existing mixed positions (such as the verified `E1VFVN30` position with subsequent SELL history) are migrated and preserved at Feature 17 activation with a permanently locked baseline without replaying history or reconstructing synthetic prior quantities.
- **Deprecation of Direct Mutations**:
  - Direct user-facing cash editing is removed. Cash changes must go through deposit/withdrawal ledger operations.
  - Direct generic holdings CRUD (`POST`/`PUT`/`DELETE /api/holdings`) is retired in favor of explicit opening-position and transaction-driven operations.

---

## 5. Valuation, Market Data & Precision Invariants
- **Valuation Strategy (Feature 05)**:
  - Portfolio metrics (cost basis, market value, unrealized P/L, total portfolio value) are computed on demand from authoritative holdings + latest prices. They are not stored as independent persisted truth.
  - A holding is priced only when market price is finite and > 0.
  - Missing market data or FX rates produce explicit partial valuation (`valuationStatus: 'partial'`), never fake 0 prices or fabricated valuations.
- **FX & Cross-Currency Valuation Foundation (Feature 19)**:
  - Reporting currency is strictly **VND**.
  - Native market value and reporting VND market value are distinct properties.
  - VND assets bypass FX resolver; non-VND asset valuation requires an explicit, direct `quoteCurrency -> VND` FX rate.
  - Missing or invalid FX produces explicit partial valuation, never assumed 1:1 fallback or fake 0 prices.
  - No currency inversion or multi-hop FX conversion in V1.
  - FX resolution is provider-neutral and executed on demand without a persistent FX database table or caching subsystem in Feature 19.
  - Non-VND cost basis and unrealized P/L remain unavailable until acquisition-time FX accounting exists; current FX rates must never be used to fabricate historical acquisition-cost P/L.
  - Portfolio Composition consumes authoritative Feature 05 reporting values and never computes FX conversions independently.
- **Market Provider Abstraction (Feature 18)**:
  - Provider-specific market acquisition is decoupled behind provider adapters (`server/src/providers/`).
  - Market consumers (`/api/market/:symbol`, `/api/market/:symbol/history`, portfolio valuation, deterministic analysis) interact strictly through a provider-neutral boundary (`getMarketSnapshot`, `getMarketHistory`, `getAnalysisHistory`).
  - Each adapter owns its provider-specific URLs, request headers, response payload parsing, and error normalization.
  - Asset identity resolution uses canonical asset metadata + explicit mappings in `public.asset_provider_mappings`. No implicit symbol transformation (such as appending `.VN`) is allowed.
  - No fallback provider orchestration is implemented yet (clean unsupported errors if provider mapping is absent or unsupported).
  - Adding a future provider must not require consumer or business logic to construct provider symbols.
- **Representative Real Multi-Asset Providers (Feature 20A)**:
  - **Twelve Data**: Production provider for direct `USD/VND` FX exchange rate resolution.
  - **CoinGecko**: Production provider for crypto spot snapshots using explicit, immutable coin IDs (`bitcoin`, `ethereum`, `solana`).
  - **Alpha Vantage**: Production provider for Gold Spot (`XAU/USD`) using `GOLD_SILVER_SPOT` with `symbol=XAU` (spot bullion, NOT COMEX `GC=F` futures).
  - **Yahoo Finance**: Retained as production provider for Vietnamese equities and exchange-traded ETFs (`FUEVFVND.VN`, `FUESSVFL.VN`).
  - Canonical `USD/VND` asset is market context only; it is not a cash account and does not enable holding USD cash.
  - Non-VND asset onboarding does not enable trading; non-VND BUY/SELL transactions remain blocked at the database trigger level (`enforce_vnd_portfolio_transaction_asset`).
  - Asset calendar policies: crypto uses `CONTINUOUS_24_7` with `UTC` timezone; Gold Spot uses `GLOBAL_24_5` with `UTC` timezone.
  - Crypto and gold spot historical bars remain explicitly unsupported (`UNSUPPORTED_MARKET_POLICY`) until Feature 21.
  - Open-ended NAV mutual funds remain deferred.
- **Numerical Precision**: Intermediate financial calculations retain full floating-point/numeric precision without premature two-decimal rounding. Rounding is presentation-only.
- **Data Labeling**: Market snapshots are clearly disclosed as delayed (~15 min for equities) with explicit timestamp provenance. Missing source timestamps remain `null`.

---

## 6. Cross-Feature Relationships
- **Portfolio Overview (Feature 05)**: Combines holdings + cash overview + market data on demand.
- **Portfolio Composition (Feature 10)**: Derives allocations and concentration metrics purely from Feature 05 portfolio valuation.
- **Asset Comparison (Feature 11)**: Consumes canonical Feature 07 analysis and historical price metrics across 2–4 selected assets without client-side formula recalculation.
- **Price Alerts (Feature 12)**: One-shot persistent alert lifecycle (`active` -> `triggered`) evaluated deterministically against canonical market snapshots.
- **Personalized Relevant News (Feature 13)**: Dynamic token matching against current holdings and watchlist assets; acts as a filtered view of the canonical news feed without a separate ingestion pipeline.
- **Personal Investment Dashboard (Feature 09)**: High-level overview coordinating summary metrics, watchlist movers, and latest news. Expansion is frozen until multi-asset foundation contracts are established.
