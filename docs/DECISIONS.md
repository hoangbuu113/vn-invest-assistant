# Confirmed Product & Architectural Decisions

The following architectural and product decisions are confirmed and authoritative across the project:

---

## 1. General Product & User Model
- **Product Identity**: Public multi-asset market intelligence and tracking showcase application. Portfolio accounting is a supporting capability within the broader market intelligence workflow.
- **Target User & Multi-User Architecture**: Public multi-user application powered by standard Supabase Auth (email/password). Each authenticated user has an isolated `investor_profile` (`user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id)`). New profiles start clean with `cash_available = 0`, 0 holdings, and 0 transactions. Single-owner access controls (`OwnerGate`, `OWNER_ACCESS_TOKEN`, session cookies) and the disposable 20M test profile are permanently retired.
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
  - The single cash ledger remains strictly `VND`; the transaction ledger preserves native execution metadata while its authoritative accounting unit price and cost basis remain VND.
  - Non-VND BUY/SELL requires explicit governed execution currency, VND accounting basis, settlement mode, and FX provenance where applicable. A cash-neutral existing-position baseline may instead preserve supported native acquisition cost with its VND basis unknown. `USDT` is never silently treated as `USD`, and no multi-currency cash balance is implied.
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
  - Non-VND transaction records may carry an explicit authoritative VND acquisition basis. Cash-neutral opening positions may instead retain only their supported native acquisition price/currency and leave the authoritative VND basis null; current FX rates must never be used to fabricate missing historical acquisition cost.
  - Historical non-VND portfolio performance remains unavailable without authoritative historical FX aligned to the performance timeline.
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
  - Asset onboarding alone does not authorize accounting. Later governed cross-currency transaction support requires explicit VND basis and settlement metadata; it does not create foreign-currency cash accounts.
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
    - **Binance Spot**: Supplies truthful completed UTC daily OHLCV history in native `USDT` for all 40 canonical cryptocurrencies through explicit provider mappings. The current UTC day is excluded.
    - **Alpha Vantage**: Supplies truthful daily close-only history for Gold Spot (`XAU/USD`). Missing OHLCV fields remain `null`.
    - **Twelve Data**: `USD/VND` daily history remains intentionally unsupported (`UNSUPPORTED_MARKET_POLICY`) because provider daily timezone boundary cannot currently be reconciled confidently with canonical asset timezone.
  - **Snapshot vs History Invariant**:
    - Snapshot represents the current / delayed real-time market observation.
    - History represents finalized, completed canonical business periods.
    - Snapshot data must never fill or replace completed historical close bars.
  - **Analysis Invariant**:
    - Feature 21 owns completed canonical history and its capability metadata; metric eligibility is evaluated separately by Feature 22.
    - Close-only history is truthful complete history when the canonical capability declares `ohlc=false` and `volume=false`.
- **Deterministic Analysis V2 (Feature 22)**:
  - **Provider-Neutral Analysis Boundary**: Analysis consumes canonical asset metadata, completed canonical daily history, and provider-neutral `historyCapabilities` (`close`, `ohlc`, `volume`). Analysis methodology must not branch on provider names.
  - **Methodology Version**: Analysis responses use `methodologyVersion = "v2"`.
  - **Analysis Price**: `analysisPrice` is the last completed canonical daily close; snapshot values never enter analysis formulas.
  - **Period Price Change**: `priceChangePct = ((periodEndPrice / periodStartPrice) - 1) * 100` ("Biến động giá trong kỳ").
  - **Universal Completed-Close Metrics**: `highestCompletedClose`, `lowestCompletedClose`, `completedCloseRangePositionPct`, `distanceBelowHighestCompletedClosePct`, `positiveCloseTransitionRatio`, non-annualized `dailyVolatilityPct`, and completed-close `maxDrawdownPct`.
  - **OHLC Capability and Compatibility**: OHLC metrics are capability-dependent. Close-only history never fabricates OHLC; missing capability returns explicit machine-readable status (`METRIC_REQUIRES_OHLC`, `UNSUPPORTED_HISTORY`).
  - **Completeness and Sufficiency**: Feature 22 uses Feature 21 canonical history completeness and does not apply legacy fixed VN session thresholds across asset classes.
  - **Analysis Ranges**: Supported ranges are `1W`, `1M`, `3M`, `6M`, and `1Y`.
  - **Asset Support**: VN stocks and VN ETFs supported. Crypto supports universal completed-close and capability-dependent OHLC metrics using Binance completed daily history. Gold Spot supports universal completed-close metrics. USD/VND analysis remains unsupported until trustworthy completed historical capability exists.
  - **Interpretation Boundary**: Feature 22 is metrics only: no bullish/bearish label, positive/negative investment judgment, recommendation, opportunity score, risk score, confidence percentage, prediction, or forecast.
- **Numerical Precision**: Intermediate financial calculations retain full floating-point/numeric precision without premature two-decimal rounding. Rounding is presentation-only.
- **Data Labeling**: Market snapshots are clearly disclosed as delayed (~15 min for equities) with explicit timestamp provenance. Missing source timestamps remain `null`.

---

## 6. Multi-Asset News Foundation (Feature 23)

### A. News Architecture Pipeline
$$\text{Source Adapter} \longrightarrow \text{Canonical Validation / Sanitization} \longrightarrow \text{Cross-Source Aggregation} \longrightarrow \text{Deterministic Dedupe} \longrightarrow \text{Deterministic Relevance Engine} \longrightarrow \text{Public / Personalized Endpoints}$$
- Source-specific raw parsing and response structures remain isolated inside their respective adapters (`server/src/news/adapters/`).
- Generic aggregation, deduplication, relevance, and presentation layers must not depend on raw provider formats.

### B. Current Source Set
- **CafeF**: Vietnamese market, enterprise, macroeconomic, and international context via 4 official RSS feeds (`thi-truong-chung-khoan`, `doanh-nghiep`, `vi-mo-dau-tu`, `tai-chinh-quoc-te`).
- **CoinDesk**: Global cryptocurrency market context via official public RSS (`https://www.coindesk.com/arc/outboundfeeds/rss/`).
- **Alpha Vantage NEWS_SENTIMENT**: Global gold spot, foreign exchange, and macroeconomic context via single broad topic query (`economy_macro,commodities,forex`).
- **FXStreet**: Intentionally NOT used in Feature 23 because unauthenticated public access was verified unreliable.

### C. Alpha Vantage Content & Sentiment Boundary
- Feature 23 may consume article metadata (title, short provider excerpt, publisher/source name, URL, publication timestamp, deterministic topic/ticker context).
- Feature 23 **MUST discard** all upstream sentiment scores, sentiment labels, relevance scores, and confidence-like judgments.
- Third-party sentiment or relevance scores must never be converted or presented as project sentiment or relevance scores.

### D. Canonical News Identity & Relationship Authority
- `assetId` (canonical asset UUID) is the sole authority for asset relationships in `relatedAssets`.
- Symbol and name metadata are matching and presentation metadata only.
- One article may relate to multiple canonical assets, but it is emitted as a single deduplicated article with multiple items in `relatedAssets`.

### E. Deterministic Relevance Matching
- Allowed deterministic match reasons: `SYMBOL_EXACT`, `NAME_EXACT`, `VERIFIED_ALIAS`.
- Source category alone cannot create an asset relationship.
- Conservative false negatives are strictly preferred over false positives.
- Ambiguous ticker symbols require deterministic contextual disambiguation:
  - `USD/VND`: Requires explicit pair or central exchange-rate terms; lone `USD` never matches.
  - `RAIN`: Requires explicit token phrases (`Rain coin`, `Rain token`, `Rain crypto`); the English word "rain" never matches.
  - Short crypto tickers (`SOL`, `ADA`, `DOT`, `ATOM`, `UNI`, etc.): Require crypto context (CoinDesk source or crypto keywords); otherwise full asset name is required.
  - Gold Spot (`XAU/USD`): Matches verified aliases (`XAU`, `vàng`, `vàng miếng`, `vàng sjc`, `vàng nhẫn`, `gold bullion`, `gold spot`).
- General macroeconomic and industry articles without specific asset relationships remain valid with `relatedAssets = []`.

### F. Personalized News
- User asset universe is the union of holdings canonical UUIDs and watchlist canonical UUIDs ($\text{Holdings UUIDs} \cup \text{Watchlist UUIDs}$).
- An article is included in personalized news if its `relatedAssets` intersects the user's asset UUID set.
- Personalized news is derived from the unified news feed; no source-specific matching logic is introduced.
- One article appears once in personalized news even if it matches multiple assets owned or watchlisted by the user.
- General unlinked articles (`relatedAssets = []`) are excluded from personalized news.

### G. Content, Excerpts & Copyright Integrity
- Feature 23 retains only headline, short source-provided excerpt, source attribution, publication timestamp, outbound URL, and deterministic metadata.
- Never scrape full article pages, store full article bodies, or reproduce full article text.

### H. URL & Content Security
- Outbound URLs must use valid `http` or `https` schemes.
- Unsafe schemes (`javascript:`, `data:`, `file:`, `ftp:`) and credential-bearing URLs (`user:pass@`) are strictly rejected.
- Known tracking parameters (`utm_*`, `fbclid`, `gclid`, etc.) are stripped while semantic query parameters are preserved and sorted deterministically.
- Source HTML markup is cleaned and entity-decoded into plain text. Raw provider XML/HTML is never emitted to clients.

### I. Timestamp Semantics
- `publishedAt` must originate from upstream source metadata and carry explicit or verifiable timezone semantics.
- All valid timestamps are normalized to ISO-8601 UTC.
- Missing, invalid, date-only without time, or timezone-ambiguous timestamps are strictly rejected.
- Server current time is never substituted as publication timestamp.

### J. Deduplication Hierarchy
1. Exact normalized canonical URL.
2. Source-scoped article / GUID identity.
3. Conservative fallback: `sourceId` + exact normalized title + exact publication timestamp.
- No fuzzy-title AI deduplication.

### K. Failure & Partial Degradation Semantics
- Individual source failures must not fail the entire news feed.
- If at least one source responds successfully: Return HTTP 200 with `partial: true` metadata.
- If all live fetches fail but valid stale cache exists: Return HTTP 200 with stale source status and `partial: true`.
- If all sources fail and no usable cache exists: Return HTTP 503 `NEWS_SOURCES_UNAVAILABLE`.
- Successful empty source returns valid empty status (`empty`), not error.
- Filtering by a valid canonical `assetId` with zero matching news returns HTTP 200 with `data: []`.
- Filtering by an unknown or nonexistent `assetId` returns HTTP 404 `ASSET_NOT_FOUND`.

### L. Caching & Request Coalescing
- In-memory cache TTLs:
  - CafeF: 5-minute fresh TTL, 30-minute stale-if-error fallback.
  - CoinDesk: 5-minute fresh TTL, 30-minute stale-if-error fallback.
  - Alpha Vantage News: 24-hour fresh TTL, 72-hour maximum-age stale-if-error fallback. This optional daily enrichment budget leaves Alpha Vantage capacity for authoritative Gold snapshot/history acquisition.
- Successful empty results are cached to prevent hammering empty endpoints.
- Controlled source failures use bounded negative-cache cooldowns (1 minute for RSS sources; 24 hours for optional Alpha Vantage news) without creating or caching any article.
- Concurrent in-flight requests for the same source are coalesced into a single Promise.
- *Account Quota Clarification*: Feature 23 limits normal `NEWS_SENTIMENT` refresh frequency per process and honors a quota cooldown already observed by the authoritative Gold adapter. News-side failures never impose a longer Gold cooldown. Alpha Vantage quota is still account-wide and process-local caching cannot guarantee whole-account daily limits across restarts or other clients.

### M. Language Policy
- Original source language is preserved without automated translation (CafeF: Vietnamese `vi`, CoinDesk & Alpha Vantage: English `en`).

### N. Non-Financial & Non-Judgment Boundary
- Feature 23 does NOT provide sentiment scores, bullish/bearish indicators, impact scores, confidence percentages, investment recommendations, opportunity scores, or market predictions.

---

## 7. Cross-Feature Relationships
- **Portfolio Overview (Feature 05)**: Combines holdings + cash overview + market data on demand.
- **Portfolio Composition (Feature 10)**: Derives allocations and concentration metrics purely from Feature 05 portfolio valuation.
- **Asset Comparison (Feature 11)**: Consumes canonical Feature 07 analysis and historical price metrics across 2–4 selected assets without client-side formula recalculation.
- **Price Alerts (Feature 12)**: One-shot persistent alert lifecycle (`active` -> `triggered`) evaluated deterministically against canonical market snapshots.
- **Personalized Relevant News (Features 13 & 23)**: Deterministic UUID matching against current holdings and watchlist assets; acts as a filtered view of the canonical multi-asset news feed.
- **Personal Investment Dashboard (Feature 09)**: High-level overview coordinating summary metrics, watchlist movers, and multi-source market news preview.

---

## 8. Multi-Asset Capability Integration & Hybrid Crypto Authority (Features 24 & 26)

### A. Canonical Crypto Valuation vs Native Market-Data Boundary
- **Canonical Valuation Snapshot**: **CoinGecko** (quoted in `USD`) is the authoritative Crypto snapshot for portfolio/accounting valuation and other canonical snapshot consumers.
- **Realtime, History & Analysis**: **Binance Spot** (quoted in native `USDT`) is authoritative for rolling-24h realtime reference, completed UTC daily OHLCV history, and Feature 22 Analysis V2 inputs.
- **Accounting Isolation**: Canonical Crypto `quote_currency` remains `USD`. Binance `USDT` observations, history, analysis, and approximate VND references must never replace the CoinGecko USD valuation snapshot or enter portfolio/accounting calculations.
- **No Stablecoin Assumption**: The system does not assert or encode `1 USDT = 1 USD`.
- **Binance Service Architecture**:
  - One shared backend realtime stream connection (`wss://stream.binance.com:9443/ws/!miniTicker@arr`).
  - One shared multiplexed public historical WebSocket API connection (`wss://ws-api.binance.com:443/ws-api/v3`) for completed daily klines; no Binance REST history fallback.
  - Zero browser-direct connections; zero Binance API keys; zero account/trading APIs; zero broker execution.
  - Asset Detail frontend polls local backend approximately every 2 seconds for active crypto asset.
  - All 40 active Crypto assets use explicit Binance Spot `USDT` mappings; no provider symbol is inferred from a canonical ticker.

### B. Binance Resilience & Calendar Lookback Integrity
- A `1Y` lookback is a full calendar-year subtraction spanning up to 366 days.
- Binance daily-klines responses are normalized, deduplicated by canonical UTC date, sorted, filtered to exact Feature 21 calendar boundaries, and exclude the current UTC day.
- Completed history uses a shared in-memory cache, concurrent request coalescing, coverage-safe stale fallback, and a `CLOSED`/`OPEN`/`HALF_OPEN` circuit breaker.
- Realtime stream WebSocket, historical WebSocket API, and reference FX failures are isolated from one another.

### C. Frontend Native-Currency Invariant
- Native market values display using the relevant authority (`VND` for stocks/ETFs, CoinGecko `USD` for Crypto valuation snapshots, Binance `USDT` for Crypto realtime/history/analysis, and `USD` for Gold).
- Asset Detail may display a server-provided `≈VND` value beside Binance realtime. It is explicitly approximate, reference-only, non-accounting, and omitted when FX is unavailable.
- Portfolio reporting values are strictly `VND`.
- Exactly one centralized formatting module (`client/src/utils/formatting.js`) governs financial formatting across the frontend.
- Zero hard-coded `₫`, `VND`, `USD`, `USDT`, or `HOSE` when canonical metadata exists.

### D. Capability-Aware History & Analysis Integration
- Binance Crypto history is truthful completed OHLCV (`ohlc = true`, `volume = true`); Gold remains truthful close-only history (`ohlc = false`, `volume = false`). Range coverage remains separate from metric capability.
- Obsolete Feature 07 `0 / 0` breadth presentation branch is retired in favor of universal V2 metrics.
- Known unsupported capability (USD/VND history) yields an explicit unsupported state without issuing useless network requests or fabricating charts.

### E. Cross-Asset Comparison Integrity
- Relative comparison curves use Base 100 on canonical common dates only; zero array-index alignment, zero date borrowing, zero forward-filling, zero synthetic interpolation.
- Raw price levels across different currencies are not directly comparable; universal V2 metrics are displayed in native currencies. Zero ranking, scoring, or recommendations.

### F. Safe Provider Error Boundary & Universal Freshness
- Alpha Vantage upstream quota/rate-limit messages are sanitized to `PROVIDER_RATE_LIMITED` with safe Vietnamese messaging, never leaking raw provider bodies, premium advertisements, or URLs.
- Stale universal `~15 phút` text is removed from Gold, Crypto, Alerts, Watchlist, and Portfolio; replaced with truthful provider-neutral wording: *"Dữ liệu theo thời điểm cập nhật của nhà cung cấp"*.

### G. Ledger Authority & Non-VND Gating
- BUY/SELL for non-VND assets requires the governed VND-basis cross-currency contract and explicit settlement semantics. A cash-neutral opening position may preserve supported native acquisition cost while leaving historical VND basis unknown. Cash settlement and cash balances remain VND-only; Binance `USDT` reference prices never become canonical USD accounting values.

---

## 9. Vietnam Market Regime Foundation (Feature 27)

- **Independent Domain Contract**: Vietnam money-market, inflation, and market-breadth capabilities are reported independently. Partial official data is usable; one unavailable domain never fabricates values or blocks another valid domain.
- **Inflation Authority**: Official NSO Vietnam sources are the sole production authority. Reference periods, publication dates, and release provenance come from the official CPI archive; headline monthly CPI YoY values come from the official structured CPI chart series. The archive and chart current periods must agree, duplicate/ambiguous observations are rejected, and `threeMonthDeltaPp = CPI_YoY(M) - CPI_YoY(M-3)`. Missing M-3 yields `null`; YoY is never reconstructed from MoM values, and individual release-page fan-out is not part of the production path.
- **Money-Market Authority**: Official SBV weekly releases/PDFs are the sole production authority for the VND overnight interbank weekly average rate. Four-week comparison fields require eight distinct, consecutive verified official observations. Missing weeks are never interpolated; insufficient history preserves only the latest verified official rate.
- **Market-Breadth Boundary**: No production-quality representative source is provisioned. Breadth returns `status = "unavailable"` and `reason = "SOURCE_NOT_PROVISIONED"`; it is never reconstructed from the project's seven Vietnamese assets.
- **Interpretation Boundary**: Feature 27B exposes raw descriptive indicators and capability states only—no composite score, directional regime label, confidence percentage, prediction, or recommendation.
- **Persistence and Resilience**: Data is read through source-specific in-memory caches with request coalescing and bounded stale-if-error fallback. Feature 27 introduces no database table or migration.

---

## 10. Deterministic Opportunity Engine (Feature 28)

- **Methodology Version**: Opportunity responses use `methodologyVersion = "opportunity-v1"`. The engine is a transparent descriptive screen, not a recommendation, prediction, expected-return model, confidence estimate, or opaque score.
- **Cohort Boundary**: Candidates are ranked only within separate `VN_STOCK`, `VN_ETF`, `CRYPTO`, and `GOLD` cohorts. Cross-asset-class rank is prohibited. `USD/VND` is excluded with `NON_INVESTMENT_CONTEXT`; a singleton Gold cohort exposes evidence without a descriptive rank.
- **Investor-Horizon Proxy**: The current profile horizon maps deterministically to Analysis V2 ranges: `short -> 1M`, `medium -> 3M`, and `long -> 1Y`. The `1Y` mapping is disclosed as the longest available analysis proxy, not a complete long-term investment assessment.
- **Required Ranking Evidence**: Eligibility requires complete canonical history and available Analysis V2 `priceChangePct`, `positiveCloseTransitionRatio`, `dailyVolatilityPct`, and `maxDrawdownPct`. Missing required evidence is never converted to zero. Completed-close range position and distance below the highest completed close are visible evidence only and never affect rank.
- **Descriptive Screen and Rank**: `screenMatch = priceChangePct > 0 && positiveCloseTransitionRatio > 0.5`. Within each cohort, ordering is screen match first, then price change descending, positive-close-transition ratio descending, max drawdown ascending, daily volatility ascending, and canonical symbol ascending. This ordering is labelled only as *"Xếp hạng mô tả trong nhóm tài sản"*.
- **Profile-Fit Isolation**: Risk tolerance never reorders candidates. Cohort-relative volatility and drawdown thresholds are assessed only when a cohort has at least 10 eligible candidates, using independently visible nearest-rank P33/P67 cutoffs. Low risk requires both metrics at or below P33, moderate risk at or below P67, and high risk has no cap. Smaller cohorts return `not_assessed` with `INSUFFICIENT_COHORT_SIZE`; candidates outside a preference remain eligible and visible.
- **Context Isolation**: Holding state, watchlist state, current portfolio exposure, and shared Vietnam regime observations are visible context only. They never change screening or ranking. Partial portfolio valuation is labelled with its actual allocation basis.
- **Capability and Failure States**: Every canonical asset is represented truthfully as `eligible`, `insufficient_data`, `unsupported`, or `excluded`. Per-asset provider failures are isolated, missing data is not treated as worst rank, and a valid response with zero eligible candidates remains HTTP 200. HTTP 503 is reserved for genuine service-wide analysis acquisition failure with no usable evidence.
- **Architecture and Persistence**: Feature 28 reuses the canonical asset universe, Analysis V2/history path, investor profile, holdings, watchlist, portfolio composition, and Vietnam regime services behind `GET /api/opportunities`. Asset analysis is acquired with bounded concurrency. No database table, migration, or additional opportunity-specific market-data cache is introduced; existing provider history cache/coalescing remains authoritative where available.

---

## 11. Guarded AI Investment Brief (Feature 29)

- **Methodology and Authority**: Responses use `methodologyVersion = "ai-brief-v1"`. Existing deterministic portfolio, performance, composition, Analysis V2/opportunity, Vietnam regime, and personalized-news services remain the sole authorities for financial facts. The AI may explain supplied evidence but may not calculate or invent authoritative values.
- **Closed Fact Registry**: Every permitted datum is registered with a stable evidence identifier, exact source value, status, provenance, and domain-specific reference time. Missing or partial data remains explicit and is never converted to zero. The provider packet is bounded and excludes internal UUIDs, ledger rows, raw provider URLs/errors, secrets, and unrelated application state.
- **Evidence-Linked Output Boundary**: Every prose statement must cite at least one registered evidence identifier. Deterministic validation rejects unknown references, numeric or financial claims in prose, URLs, HTML, recommendation language, targets, forecasts, probabilities, confidence percentages, and invented scores. Rejected or malformed output is never shown as accepted AI output.
- **Untrusted News Boundary**: At most five sanitized personalized-news items may be supplied as untrusted context. Article text is data rather than instruction, must be attributed to its source when discussed, and cannot grant tools, browsing, or system access.
- **Provider Policy**: The only live adapter is OpenAI Responses API using `gpt-5.6-luna` with low reasoning, strict structured output, no tools, no retained conversation state, and `store = false`. Live generation requires both `AI_BRIEF_ENABLED=true` and a server-side `OPENAI_API_KEY`; the safe default is disabled. Secrets are never exposed to the client.
- **Fallback and Failure Semantics**: Disabled configuration, missing API key, timeout, provider failure, malformed output, or validation rejection yields an evidence-linked deterministic fallback. Failure of the authoritative portfolio core returns an unavailable response and prevents secondary acquisition or provider invocation.
- **Cost and Request Controls**: Generation is manual only. Identical fact packets share a fifteen-minute in-memory cache and concurrent requests are coalesced. Uncached live attempts are protected by a sixty-second process cooldown and a configurable daily process budget that defaults to twenty; cache hits consume no live-generation budget.
- **Privacy and Persistence**: The UI discloses that a minimized fact packet is sent to the configured AI provider only when live AI is enabled. Feature 29 adds no database table, migration, brief persistence, background schedule, automatic refresh, recommendation, prediction, confidence measure, or trading action.

---

## 12. Historical Single-Owner Security Boundary (Feature 30B1 — Retired)

- **Historical Context**: During V1 hardening, a single-owner credential model (`OWNER_ACCESS_TOKEN`) and signed session cookie (`vn_invest_owner_session`) were used for private route protection.
- **Retirement**: This architecture has been completely retired in V1.1 in favor of standard public multi-user Supabase Authentication.

---

## 13. Public Multi-User Architecture & Supabase Auth (V1.1 Improvements 12 & 13)

- **Authoritative Authentication**: Supabase Auth (email/password) is the sole browser authentication mechanism. Requests send a standard Bearer JWT in the `Authorization` header (`Authorization: Bearer <token>`).
- **Complete Retirement of Legacy Owner Auth**: `OwnerGate`, `OWNER_ACCESS_TOKEN` browser auth, HMAC session tokens, session cookies (`vn_invest_owner_session`), and `/api/owner/session` endpoints are permanently retired.
- **Multi-User Profile Model**: Every authenticated user maps 1:1 to an isolated `investor_profile` (`user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id)`).
- **Financial Data Safety Invariant**: The foreign key `investor_profile.user_id REFERENCES auth.users(id)` uses `ON DELETE RESTRICT`. Auth user deletion cannot cascade delete financial portfolios, holdings, cash ledgers, opening positions, or delivery history.
- **Empty Isolated Onboarding**: Authenticated users create an empty investor profile via `POST /api/profile` (`cash_available = 0`, 0 holdings, 0 transactions). Duplicate creation is conflict-safe and idempotent via `UNIQUE(user_id)`.
- **Zero Legacy Test Data**: The legacy unowned 20,000,000 VND profile was disposable test data and was permanently purged along with its child rows in migration `20260904010000_finalize_public_multi_user_auth.sql`. Function `claim_legacy_profile` and transitional routes `/api/auth/legacy-claim-status` and `/api/auth/claim-legacy-profile` are permanently removed.
- **Strict Profile Scoping & Anti-Spoofing**: All private financial endpoints resolve the profile strictly via `WHERE user_id = req.user.id`. Any client-supplied `profileId` in query params or body is completely ignored and cannot spoof other users' data.
- **Database Authority & Permission Model**: Private tables and financial RPCs are accessible exclusively by the backend's server-only Supabase `service_role` client. `anon` and `authenticated` Supabase roles have zero direct access to private tables.
- **Background Alert Scheduler & Web Push Delivery**: Price alerts evaluate on a 15-minute background cron schedule (`POST /api/internal/alerts/evaluate`), independently authenticated via `ALERT_SCHEDULER_TOKEN`. Web Push delivers notifications on a best-effort per-device model (`public.push_subscriptions`, `public.alert_notification_deliveries`) with bounded retry (max 3 attempts, 15-minute backoff).

---

## 14. V1.3 Market Intelligence, Evidence & Stability Architecture (Features 01C–01G)

### A. Strategy Stability & Publication Safety (Feature 01C)
- **Two-Clock Lifecycle**: Decoupled continuous fast-clock evidence evaluation from patient slow-clock strategy publication. Lifecycle state machine: `STABLE`, `WATCH`, `REVIEW_REQUIRED`, `EVALUATING`.
- **Deterministic Materiality**: State mutations occur strictly upon evaluated evidence changes, verified shocks, or confirmed multi-source consensus. Unchanged evidence or identical evaluations yield deterministic `KEEP`.
- **Atomic Publication RPC**: Transactional RPC `publish_strategy_version_atomic(p_new_version, p_expected_current_strategy_id)` in PostgreSQL guarantees transactional supersession and insertion with zero-published prevention, concurrency locking (`FOR UPDATE`), and automatic rollback on failure.
- **Production Safety**: Silent fallback to in-memory strategy storage in production is removed. Unavailability of database or RPC halts with an explicit error.
- **Hysteresis Thresholds Policy**: Numeric hysteresis thresholds remain intentionally uncalibrated due to partial historical coverage across complete economic cycles; quantitative stability is governed deterministically without arbitrary fabricated thresholds.

### B. Historical As-Of Evidence Replay (Feature 01D)
- **Replay Safety Contract**: Implemented historical as-of evidence projection engine. All evidence evaluations evaluate state strictly as-of an explicit timestamp $T$ with zero lookahead bias.
- **System-Knowable Timestamp Authority**: An observation is knowable to the system strictly when `asOf >= max(sourceAvailableAt, firstSeenAt)`. Publication timestamps alone cannot bypass system ingestion time, and future corrections or backfills never alter prior historical fingerprints.
- **Claim Corroboration & Contradiction**: Structured claims track independent corroboration and contradictory evidence without discarding minority sources.

### C. Observability & Data Health (Feature 01E)
- **Deterministic Health States**: `HEALTHY`, `DEGRADED`, `FAILED`, `UNKNOWN` with strict precedence (`FAILED` > `DEGRADED` > `UNKNOWN` > `HEALTHY`).
- **Domain vs Operational Health Invariant**: `job execution health != domain / data conclusion`. A collector or engine completing valid evaluation reporting empty or insufficient data is operationally `HEALTHY`. `DEGRADED` is strictly reserved for operational anomalies (partial persistence, WAF quarantine). `FAILED` is reserved for pipeline crashes, unhandled exceptions, or fatal DB failures.
- **Durable Checkpoints**: State persists to `public.market_context_collector_checkpoints`. Production DB is strictly authoritative; memory store is used only in explicit offline/test mode.
- **Public Observability Route**: `GET /api/system/data-health` reads durable checkpoints without external provider calls and returns HTTP 200 (or 503 if system status is `FAILED`), exposing zero secrets.

### D. Vietnam Equity Evidence (Feature 01F)
- **Canonical Stock Evidence Foundation**: Model and repository (`public.vn_equity_evidence_observations`) storing immutable evidence vintages for canonical Vietnam equities.
- **Replay-Safe Timestamp Invariants**: Enforces `system_knowable_at >= first_seen_at` and `system_knowable_at >= source_available_at`.
- **Scope Boundary**: Completed daily OHLCV bars are ingested via backend collector with delayed freshness provenance. Official corporate disclosures remain truthfully declared as `SOURCE_NOT_PROVISIONED`; fundamentals use the separate V1A decision below.

### D.1. Vietnam Equity Fundamentals V1A
- **Providerless Ingestion**: Official fundamentals enter only through the admin-authorized manual endpoint. No automated crawling, undocumented API, parser, commercial data vendor, or copied third-party table is an authority.
- **Single Authority**: V1A filing/fact evidence is the only authoritative fundamentals path. Existing generic fundamental observations are preserved only as legacy records, excluded from public/opportunity fundamentals, and cannot be newly ingested.
- **Eligibility Authority**: `assets.fundamentals_company_type` is canonical. V1A accepts `INDUSTRIAL` only; banks, securities firms, insurers, and unclassified issuers are unsupported rather than forced into an industrial metric model.
- **Immutable Corrections**: Filing and fact rows are insert-only to the service role. A correction must append exactly the next revision and identify one prior filing via `supersedes_filing_id`; replay as-of time uses `max(source_available_at, first_seen_at)`.
- **Canonical Filing Identity**: Persisted ticker, legal name, exchange, and company type are derived from `assets`. A filing requires `sourceDisclosureId` or document-byte SHA-256 evidence; DB unique indexes govern logical report/revision, disclosure, document, and one-child correction identities independent of URL query variants.
- **Source Governance**: SSC, HOSE, and HNX inputs require their governed HTTPS host families. `ISSUER` input is rejected until canonical issuer-domain metadata is available; domains are never invented from caller input.
- **Fact Temporal Contract**: Point-in-time balance-sheet metrics require `INSTANT`. Income and cash-flow metrics require coherent duration semantics. V1A enforces December fiscal-year windows and preserves quarter and YTD facts from the same filing as different temporal identities.
- **Numeric and Missing Semantics**: Financial facts use PostgreSQL `NUMERIC` and decimal strings at the API boundary. Explicit zero is valid. Missing is null with a reason and is never normalized to zero.
- **Trust Boundary**: Public projections admit numeric output only when both the filing and the individual fact are `VERIFIED`. Source URL, authority, filing identity, fact period, scope, audit status, source location, document hash when available, and verification metadata remain visible. `AVAILABLE` and `PARTIAL` are distinct UI states.
- **No Seeded Fundamentals**: The foundation creates no initial company financial values. Availability remains `NOT_INGESTED` until a filing is manually verified and persisted.
- **State Contract**: `UNSUPPORTED_COMPANY_TYPE` means taxonomy outside V1A; `NOT_INGESTED` means supported manual ingestion exists but no verified filing is present; `SOURCE_NOT_PROVISIONED` means that source path has no governed ingestion mechanism.

### E. Deterministic Equity Opportunity Engine (Feature 01G)
- **Deterministic Authority**: Evaluates Vietnam equity universe against persisted evidence into explicit categories: `QUALIFIED`, `WATCH`, `INSUFFICIENT_EVIDENCE`, `REJECTED`.
- **Policy Invariant**: Because no calibrated numeric qualification policy exists, `QUALIFIED` remains intentionally unused/reserved; current valid completed closes support `WATCH` only. Inactive assets evaluate to `REJECTED`.
- **No Opaque Opportunity Scores**: Zero opaque numerical scoring, zero buy/sell/hold ratings, zero price targets, and zero probability estimates.
- **AI Explanation Boundary**: AI generates explanations bounded strictly by candidate evidence. Any ungrounded numbers, schema violations, speculative language, or forbidden actions (`buy`, `sell`, `hold`, `mua`, `bán`, `giữ`, `target price`, `giá mục tiêu`, `probability`, `xác suất`, `confidence`, `expected return`) are deterministically rejected and fall back to evidence-linked deterministic prose.
- **Qualification Immutability**: AI explanation failure or rejection never alters or promotes `candidate.qualificationStatus`.
- **Route Namespace Preservation**: Public deterministic engine operates on `GET /api/equity-opportunities` and `GET /api/equity-opportunities/:symbol`. The existing private portfolio-aware `GET /api/opportunities` is fully preserved without modification.

---

## 15. Portfolio V1 Product & Methodology Contract

### A. Page Information Order
- Portfolio information order is governed as: **Summary → Holdings → Performance → Allocation → Activity**.
- Summary must foreground total portfolio value, cash, invested-asset market value, and the current valuation/data state.

### B. Performance Authority
- Time-weighted return (TWR) is the primary portfolio performance measure. A daily chained end-of-day implementation must disclose its timing convention and estimation limits.
- Accounting P/L is a separate measure and must not be presented as TWR or MWR.
- Money-weighted return (MWR/XIRR) is secondary/detail information. Failed or undefined XIRR is unavailable, never zero.
- Annualized performance must not be displayed for a history shorter than one year.
- Drawdown is conditional on a valid, sufficiently supported performance series; it is not a mandatory headline for every portfolio state.
- No claim of GIPS compliance is permitted.

### C. Benchmark Contract
- Benchmark selection is user-controlled and includes an explicit **no benchmark** state.
- A benchmark comparison is valid only when period, currency treatment, and return basis are compatible and visible.
- A simple portfolio-return minus benchmark-return result is labelled as a difference in **percentage points**, never as alpha.
- Price-return benchmarks must be explicitly labelled as price return. A currency-mismatched series may be shown only as clearly marked reference-only context, not as a directly comparable result.

### D. Data Completeness & Freshness
- Portfolio data states are: `AVAILABLE`, `PARTIAL`, `STALE`, `NOT_APPLICABLE`, `INSUFFICIENT_HISTORY`, and `UNAVAILABLE`.
- Missing, invalid, unavailable, or errored data must never silently become `0`, `0%`, an empty success result, or a ready state.
- `priceAsOf`, `fxAsOf`, portfolio valuation time, last successful refresh, last attempted refresh, and refresh outcome are distinct concepts.

### E. Accounting Boundaries
- Existing financial-authority decisions in Sections 4 and 5 remain canonical. For Portfolio V1 presentation and performance, deposits/withdrawals are external capital flows, tracked-cash BUY/SELL are internal transfers, and an opening position is cash-neutral known state.
- Dividends are investment income, not external contribution. Fees, taxes, income, adjustments, and transfers remain unsupported until explicitly modeled; they must not be inferred.
- Backend services are authoritative for governed financial calculations. The frontend may format and project returned values but must not independently recalculate portfolio metrics.

### F. Reconciled Snapshot Contract
- Summary, holdings, and allocation must reconcile to the same portfolio snapshot and ledger revision.
- A portfolio projection must expose enough identity and timing metadata to prove this reconciliation; separate request-time calculations are not considered one snapshot.

### G. Transaction Safety
- Financial writes require an idempotency contract so network retries cannot silently create duplicate economic events.
- Corrections and reversals must be explicit, auditable events or governed state transitions. Immutable ledger history must not be overwritten or deleted to conceal a correction.

### H. P0.1 Accounting Foundation
- Historical applied migrations remain immutable. Because the chronological migration directory lacks an initial-schema migration, authoritative blank-database rebuilds use the complete current `server/db/schema.sql` bootstrap; forward migrations are then applied normally. A disposable PostgreSQL test must keep this contract executable.
- For tracked-cash BUY/SELL, the linked portfolio transaction `executedAt` is the economic time for both the position and matching cash effect. `createdAt` remains the system recording/audit time and is never backdated.
- Historical reconstruction derives linked BUY/SELL cash timing from the immutable `portfolio_transaction_id` relationship. Missing, duplicate, profile-mismatched, or type-mismatched linkage is ambiguous and must fail closed; immutable historical rows are not rewritten.
- `assets.portfolio_eligibility` is the canonical Portfolio capability. Current investable stocks, ETFs, funds, Gold, and Crypto are `PORTFOLIO_ELIGIBLE`; `USD/VND` is `REFERENCE_ONLY`. The server boundary and database triggers both enforce this rule.

### I. P0.2 Data Correctness
- Authoritative cash is a valid finite non-negative ledger result or it is unavailable; absent, malformed, non-finite, and negative values never normalize to zero. Confirmed zero remains valid.
- Portfolio total value and allocation weights require authoritative cash. When cash is unavailable, priced-holding values may remain visible but total portfolio value and cash-inclusive weights remain null with partial/unavailable state.
- XIRR remains an annualized secondary metric and requires at least 365 calendar days between first and terminal aggregated cash flows. Shorter history is `INSUFFICIENT_HISTORY`; ambiguous/no-root cases are unavailable, never zero.
- Historical valuation marks may carry only across calendar dates that the canonical asset market policy identifies as weekend non-trading dates. A prior close cannot cross a missing expected trading session or a continuous-market date and remain performance-eligible.
- Historical stale marks may remain inspectable as last-known observations, but cannot enter performance TWR, MWR, drawdown, or historical end-period unrealized P/L. Current stale snapshots may retain displayable valuation/P/L only with explicit stale state.
- A cash-only portfolio requires no market-history acquisition. Cash and total remain valid when authoritative cash exists; invested value is zero, concentration and benchmark comparison are not applicable, and annualized MWR remains unavailable until sufficient history exists.

### J. P0.2.1 Native-Currency Opening Cost
- `position_opening_baselines.execution_unit_price` and `price_currency` are the canonical native acquisition-cost pair for cash-neutral existing-position declarations; no duplicate native-cost columns are introduced.
- `position_opening_baselines.opening_average_cost` and the holdings projection `average_cost` are optional authoritative historical VND basis fields. Unknown is `NULL`, never zero and never a conversion using current FX.
- Native unrealized P/L is permitted only against a current price in exactly the same currency and only while the opening position remains unmodified by later ledger activity. VND unrealized P/L remains unavailable without authoritative historical VND cost.
- Binance USDT may supply a display-only current reference for USDT-native opening cost. CoinGecko USD remains the canonical Crypto accounting snapshot, and no USDT/USD equivalence is assumed.

### K. P0.3 Unified Current-State Snapshot
- `GET /api/portfolio/snapshot` is the authoritative current-state read projection for Portfolio Summary, Holdings, and Allocation. Those blocks consume one response and one `snapshotId`; Performance and Benchmark retain their separate historical clocks.
- `ledgerRevision` is a deterministic state checkpoint derived from the exact cash/holding authority visible to the read. It is not represented as a PostgreSQL transaction snapshot or a globally monotonic ledger sequence.
- `snapshotId` is derived from that ledger checkpoint plus the exact price, FX, valuation, P/L, and source-as-of inputs used. Recalculating identical inputs preserves identity; a changed authoritative input changes identity.
- `valuationAsOf` is the explicit calculation boundary. Per-source `priceAsOf` and `fxAsOf` remain visible because provider observations are not transactionally simultaneous.
- Current-state metrics use the governed six-state vocabulary. A partial projection may expose known subtotals, but unknown cash, prices, FX, cost basis, or P/L remain null rather than zero.
- Legacy overview and composition routes remain temporarily available for compatibility and are not the current Portfolio page authority.

---

## 16. Portfolio P1A: Idempotent Financial Writes

- **Scope Boundary**: Governs mutation endpoints `POST /api/transactions` (BUY/SELL), `POST /api/cash/deposit`, `POST /api/cash/withdraw`, and `POST /api/positions/opening`. Reversals/corrections remain deferred to P1B.
- **Dedicated Storage**: Dedicated append-only table `public.portfolio_idempotency_records` tracks `(profile_id, idempotency_key)`, `operation_type`, `request_hash`, `response_payload`, and `resource_id`. RLS is enabled and accessible exclusively by `service_role`.
- **Concurrency & Advisory Locking**: Plpgsql functions acquire transactional advisory lock `PERFORM pg_advisory_xact_lock(hashtext(p_profile_id::TEXT), hashtext(v_idempotency_key))` prior to inspecting or inserting idempotency records, serializing parallel requests on the same key without table-level bottlenecks.
- **Payload Hash Validation (Conflict Semantics)**: MD5 hash of canonical parameters is compared with cached `request_hash`. Key reuse with differing parameters raises SQLSTATE `IC001` ('idempotency key reused with different parameters') which maps to HTTP 409 Conflict.
- **Replay Semantics**: Replaying identical requests returns cached response payload with `replayed: true` and HTTP response header `Idempotent-Replayed: true` (HTTP 200 OK). No duplicate transaction, cash movement, holding, or baseline rows are created.
- **Opening Position Pre-Check Invariant**: `create_opening_position` performs the idempotency check *before* checking whether an active opening position already exists, preventing duplicate-key retries from falsely failing with `OP003`/`OP005`.
- **Client Key Lifecycle**: Frontend modals (`TransactionModal`, `CashMovementModal`, `OpeningPositionModal`) generate client-side UUID keys upon modal open, attach `Idempotency-Key` headers on submit, and rotate keys upon verified success.

---

## 17. Portfolio P1B: Auditable Correction & Reversal Architecture

- **Core Immutability Invariant**: Historical financial rows in `public.portfolio_transactions` and `public.cash_ledger_entries` are strictly immutable. Corrections must NEVER delete or update original historical records in place.
- **Compensating Event Model**:
  $$\text{ORIGINAL EVENT} \longrightarrow \text{REVERSAL EVENT (compensating entry)} \longrightarrow \text{optional REPLACEMENT EVENT}$$
  - A reversed BUY produces a compensating transaction of type `'BUY_REVERSAL'` (with matching negative cash movement `'BUY_REVERSAL'`).
  - A reversed SELL produces a compensating transaction of type `'SELL_REVERSAL'` (with matching negative cash movement `'SELL_REVERSAL'`).
  - A reversed manual DEPOSIT produces an offsetting cash ledger entry of type `'WITHDRAWAL'` with `is_reversal = true`.
  - A reversed manual WITHDRAWAL produces an offsetting cash ledger entry of type `'DEPOSIT'` with `is_reversal = true`.
- **Audit Logging (`public.portfolio_reversals`)**:
  - Every reversal requires a mandatory non-empty textual reason and an authenticated profile ID.
  - Reversals are logged in `public.portfolio_reversals` linking `original_record_id`, `reversal_record_id`, `entity_type` (`'PORTFOLIO_TRANSACTION'` or `'CASH_LEDGER'`), `reason`, and `reversal_effective_at`.
  - Row Level Security (RLS) is enabled and restricted exclusively to `service_role`.
- **Integrity & Concurrency Controls**:
  - **Double Reversal Prevention (`RC001`)**: Attempting to reverse an already-reversed record raises SQLSTATE `RC001` (mapped to HTTP 409 Conflict).
  - **Chronological / Position Dependency (`RC002`)**:
    - Reversing a BUY requires that current holdings quantity $\ge$ bought quantity (cannot reverse a BUY if assets were already sold in subsequent transactions).
    - Reversing a SELL requires that no subsequent transactions have occurred on that asset (must reverse in strict reverse-chronological LIFO order to protect average-cost basis calculations).
  - **Trade-Linked Cash Isolation (`RC003`)**: Cash ledger entries originating from trades (`BUY`/`SELL`) cannot be reversed directly via the cash reversal endpoint; the parent portfolio transaction must be reversed.
  - **Reversal Immutability (`RC004`)**: Compensating reversal entries cannot themselves be reversed.
  - **Cash Balance Sufficiency (`CL001`)**: Reversing a SELL or a DEPOSIT requires sufficient available cash to fund the outflow; negative cash balances remain forbidden.
- **Transactional Advisory Locking**: RPCs acquire `pg_advisory_xact_lock` using profile ID and original record ID to serialize concurrent reversal attempts against the same record.
- **Performance & Time-Weighted Return (TWR) Integration**: Reversal events carry the exact economic timestamp (`executed_at` / `effective_at`) of the reversal action. Reversal rows adjust the cash balance, position quantities, and realized P/L atomically, allowing reconstruction engines to correctly compute historical accounting states.

---

## 18. Portfolio P1C: Multi-Asset Activity Display

- **Scope Boundary**: P1C changes only Activity and transaction-history presentation/normalization. It does not change database fields, API contracts, portfolio accounting, settlement, FX, or reversal behavior.
- **Native Execution Authority**: `executionUnitPrice` and `priceCurrency` are one canonical pair. They are the only authority for displaying execution unit price and native execution total for VND, USD, and USDT; USDT is never treated as USD.
- **VND Accounting Basis**: `price` remains the authoritative VND accounting unit price. For non-VND transactions, its unit value and total may be shown only as a separately labelled VND accounting basis, never substituted for native execution price.
- **Unavailable Metadata**: Missing or invalid native execution metadata renders as unavailable. The UI must not invent zero, VND, FX, or a historical native value.
- **Reversal and Cash Events**: `BUY_REVERSAL` and `SELL_REVERSAL` render the native pair copied from the original transaction. Manual cash movements are signed VND ledger amounts and are not transaction execution prices.
