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
- **Controlled Crypto Universe Expansion (Feature 20B)**:
  - **Universe Scope**: Default canonical crypto universe contains exactly 40 assets (3 existing from Feature 20A: `BTC`, `ETH`, `SOL`; 37 added in Feature 20B).
  - **Discovery Snapshot Policy**:
    - Candidate must concurrently satisfy: Top 100 CoinGecko market cap **AND** Top 100 CoinGecko 24h volume.
    - Deterministic category exclusions: verified stablecoins, wrapped assets, bridged representations, liquid staking derivatives, tokenized offchain funds/credit securities, and duplicate commodity exposure (`XAUT`, `PAXG`).
    - Candidates sorted by market-cap rank ascending, scanning downward until reaching exactly 40 eligible canonical assets.
  - **Durable Identity Policy**:
    - Market rank is discovery metadata only; rank is **NOT** persisted as canonical identity metadata.
    - Future rank changes or market fluctuations do not automatically mutate, delete, or deactivate canonical assets.
    - Canonical UUIDs are explicit, deterministic, and permanently stable across migrations, development seeds, and remote databases.
    - Explicit CoinGecko IDs (`provider_symbol`) in `public.asset_provider_mappings` represent provider identity; no ticker inference or runtime scraping.
    - Future universe expansions or deactivations require deliberate, controlled maintenance.
  - **Migration & Identity Safety Policy**:
    - Absent identity $\rightarrow$ INSERT.
    - Exact existing identity $\rightarrow$ NO-OP.
    - Symbol exists under a different UUID $\rightarrow$ FAIL LOUDLY (preflight exception).
    - UUID exists under a different symbol $\rightarrow$ FAIL LOUDLY (preflight exception).
    - Existing asset has incompatible semantics $\rightarrow$ FAIL LOUDLY.
    - Existing provider mapping has conflicting `provider_symbol` $\rightarrow$ FAIL LOUDLY.
    - `ON CONFLICT (symbol) DO UPDATE` is strictly prohibited for canonical assets to prevent silent identity corruption.
- **Asset-Class Market & Historical Semantics (Feature 21)**:
  - **Governing Authority**: Historical bar semantics and calendar boundaries are governed strictly by the canonical asset's `market_policy` and `market_timezone`, NOT by arbitrary third-party provider payload formatting.
  - **Business-Period Identity**: Canonical daily bar `date` (`YYYY-MM-DD`) represents the completed business day/period identity in the asset's canonical timezone. Provider timestamp is provenance metadata, not universal date identity.
  - **Completed Period Invariant**: Completed history strictly excludes the current, uncompleted canonical market date. An ongoing or incomplete market period is never silently synthesized or treated as completed.
  - **Calendar Lookback Range Semantics**:
    - `1W` = previous 7 calendar days before current canonical date.
    - `1M` / `3M` / `6M` = 1, 3, 6 calendar months subtracted from current canonical date.
    - `1Y` = 1 calendar year subtracted from current canonical date.
    - Upper bound is strictly exclusive of the current market date (`< current_canonical_date`).
    - Ranges represent calendar lookback windows, NOT fixed observation counts.
  - **Market Policy Rules**:
    - `VN_EXCHANGE`: Evaluated in canonical `Asia/Ho_Chi_Minh` timezone. Weekends and Vietnamese market holidays are non-trading days; provider gaps are preserved without synthetic candle fabrication.
    - `CONTINUOUS_24_7`: Evaluated in canonical `UTC` timezone. All 7 calendar days are valid trading days. The current UTC day is excluded until the next UTC midnight strike.
    - `GLOBAL_24_5`: Evaluated in asset's canonical timezone (`UTC` for Gold Spot). Weekends are excluded; exchange/trading holiday gaps are preserved.
  - **Provider History Rules**:
    - **Yahoo Finance**: Supplies truthful daily OHLCV bars for VN equities and ETFs.
    - **CoinGecko**: Supplies truthful daily close-only history for 40 canonical cryptocurrencies. Missing OHLC and volume remain `null` and are never synthesized from close.
    - **Alpha Vantage**: Supplies truthful daily close-only history for Gold Spot (`XAU/USD`). Missing OHLCV fields remain `null`.
    - **Twelve Data**: `USD/VND` daily history remains intentionally unsupported (`UNSUPPORTED_MARKET_POLICY`) because provider daily timezone boundary cannot currently be reconciled confidently with canonical asset timezone.
  - **Snapshot vs History Invariant**:
    - Snapshot represents the current / delayed real-time market observation.
    - History represents finalized, completed canonical business periods.
    - Snapshot data must never fill or replace completed historical close bars.
  - **Analysis Invariant**:
    - Feature 07 deterministic analysis remains restricted to `VN_EXCHANGE` assets.
    - Enabling multi-asset history does not automatically enable multi-asset quantitative analysis. Feature 22 owns multi-asset quantitative analysis generalization.
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
