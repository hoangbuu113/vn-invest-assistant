# Canonical Multi-Asset Architecture Contract

This document defines the canonical architectural and conceptual model for multi-asset management across all features in VN Invest Assistant.

---

## 1. Current Implementation Status (Features 16–23)

Features 16 through 23 establish the canonical schema, ledger authority, provider abstraction, FX valuation, full controlled multi-asset universe, normalized historical semantics, deterministic multi-asset analysis, and multi-source news foundation:

- **Verified Production Universe (49 Canonical Assets)**:
  - **Vietnamese Equities & ETFs** (`VN_EXCHANGE`, `Asia/Ho_Chi_Minh`, `VND`, `share`):
    - `VCB`, `FPT`, `HPG`, `VNM`, `E1VFVN30`, `FUEVFVND`, `FUESSVFL`
    - Provider mapping: `yahoo` $\rightarrow$ `<SYMBOL>.VN`
    - History: Completed daily OHLCV bars supported
    - News: CafeF 4-feed official RSS integration
  - **Cryptocurrencies (40 Canonical Assets)** (`CONTINUOUS_24_7`, `UTC`, `USD`, `coin`):
    - `BTC` (`bitcoin`), `ETH` (`ethereum`), `SOL` (`solana`), `BNB` (`binancecoin`), `XRP` (`ripple`), `TRX` (`tron`), `HYPE` (`hyperliquid`), `ZEC` (`zcash`), `DOGE` (`dogecoin`), `RAIN` (`rain`), `XMR` (`monero`), `LINK` (`chainlink`), `WBT` (`whitebit`), `ADA` (`cardano`), `XLM` (`stellar`), `BCH` (`bitcoin-cash`), `GRAM` (`the-open-network`), `LTC` (`litecoin`), `HBAR` (`hedera-hashgraph`), `AVAX` (`avalanche-2`), `SHIB` (`shiba-inu`), `SUI` (`sui`), `UNI` (`uniswap`), `NEAR` (`near`), `TAO` (`bittensor`), `PUMP` (`pump-fun`), `AAVE` (`aave`), `ASTER` (`aster-2`), `WLFI` (`world-liberty-financial`), `ONDO` (`ondo-finance`), `ENA` (`ethena`), `MORPHO` (`morpho`), `PEPE` (`pepe`), `DOT` (`polkadot`), `WLD` (`worldcoin-wld`), `ETC` (`ethereum-classic`), `POL` (`polygon-ecosystem-token`), `LIT` (`lighter`), `ATOM` (`cosmos`), `JUP` (`jupiter-exchange-solana`)
    - Provider mapping: `coingecko` $\rightarrow$ `<EXPLICIT_COINGECKO_ID>`
    - History: Completed UTC daily close-only bars supported (`open`, `high`, `low`, `volume` are `null`)
    - News: CoinDesk official RSS integration with contextual ticker disambiguation
  - **Gold Spot** (`GLOBAL_24_5`, `UTC`, base: `XAU`, quote: `USD`, `oz`):
    - `XAU/USD` (provider: `alphavantage` $\rightarrow$ `XAU` via `GOLD_SILVER_SPOT`)
    - History: Completed daily close-only bars supported
    - News: Alpha Vantage commodities/macro context with verified Gold alias matching (`XAU`, `vàng`, `gold bullion`, etc.)
  - **Foreign Exchange Context** (`GLOBAL_24_5`, `Asia/Ho_Chi_Minh`, base: `USD`, quote: `VND`, unit: `null`):
    - `USD/VND` (provider: `twelvedata` $\rightarrow$ `USD/VND`)
    - Snapshot: Live exchange rate supported; History: Intentionally unsupported pending verified timezone reconciliation
    - News: Alpha Vantage forex/macro context with explicit exchange-rate/pair disambiguation (lone `USD` never matches)

- **Implemented Multi-Asset Capabilities**:
  - Authoritative internal asset identity via UUID (`public.assets.id`).
  - Strict decoupling of internal canonical asset identity from third-party provider symbols (`public.asset_provider_mappings`).
  - Dedicated opening-position baseline authority (`public.position_opening_baselines`) with locked correction upon subsequent ledger activity.
  - Multi-provider market adapter architecture (`server/src/providers/`):
    $$\text{Canonical Asset} \longrightarrow \text{Explicit Provider Mapping} \longrightarrow \text{Provider Adapter} \longrightarrow \text{Normalized Snapshot / History}$$
  - Multi-source news architecture (`server/src/news/`):
    $$\text{Source Adapter} \longrightarrow \text{Sanitization} \longrightarrow \text{Deduplication} \longrightarrow \text{Relevance Engine} \longrightarrow \text{Canonical News Feed}$$
  - Universal reporting currency is strictly `VND`; native non-VND asset valuations are converted on demand via direct `quoteCurrency -> VND` FX rates.
  - Multi-asset calendar and historical bar engine (`server/src/history.js`) with calendar-window lookbacks (`1W`, `1M`, `3M`, `6M`, `1Y`) and current-day exclusivity.
  - Provider-neutral deterministic analysis V2 over completed canonical daily history, with universal completed-close metrics and capability-gated OHLC metrics.
  - Database trigger guard (`enforce_vnd_portfolio_transaction_asset`) strictly enforcing VND-only transaction accounting until multi-currency FX accounting is implemented.

- **Current Intentional Limitations**:
  - USD/VND historical bars remain unsupported due to unresolved daily timezone compatibility.
  - USD/VND deterministic analysis remains unsupported until trustworthy completed historical capability exists.
  - Crypto and Gold Spot history is close-only, so OHLC-dependent analysis metrics remain explicitly unavailable for those assets.
  - Non-VND cost basis and unrealized P/L remain unavailable until acquisition-time FX accounting exists.
  - Non-VND BUY/SELL transactions are strictly blocked at database trigger level.
  - The single VND cash ledger remains authoritative for all cash operations (no multi-currency cash balances).
  - Open-ended mutual funds (NAV scheduled) remain deferred.
  - No article database persistence (news is dynamically cached in memory with per-source TTLs).

---

## 2. Asset Identity

The internal canonical identity of an asset is strictly decoupled from third-party provider symbols (such as Yahoo's `.VN` suffix).

### Minimum Conceptual Model
- **Internal Asset ID**: Unique persistent identifier (`UUID` or canonical key).
- **Canonical Symbol**: Human-recognized ticker / code (e.g. `FPT`, `E1VFVN30`, `BTC`, `USD/VND`).
- **Canonical Name**: Full descriptive name (e.g. `Công ty Cổ phần FPT`, `Bitcoin`).
- **Asset Type**: High-level asset classification (e.g. stock, etf, fund, gold, fx, crypto).
- **Market / Venue**: Trading venue or geographic context (e.g. `HOSE`, `HNX`, `GLOBAL`, `VIETNAM`).
- **Native / Quote Currency**: Explicit currency in which prices are quoted (e.g. `VND`, `USD`).
- **Base Currency**: Applicable for pairs such as FX or crypto pairs (e.g. `USD` in `USD/VND`, `BTC` in `BTC/USD`).
- **Provider Mappings**: Adapter dictionary mapping internal assets to provider-specific identifiers.
- **Market / Calendar Policy**: Associated trading hours and calendar evaluation rules.

> [!IMPORTANT]
> Internal asset identity must **never** equal provider symbol identity. Business logic and client code must consume canonical assets, never provider-formatted ticker strings.

---

## 3. Priority Asset Types

The conceptual model accommodates the following priority asset classes:

- **Stock**: Listed equity shares (e.g. Vietnamese equities on HOSE/HNX).
- **ETF**: Exchange-traded funds priced continuously during market sessions.
- **Fund**: Open-ended mutual funds with periodic NAV valuation.
- **Gold**: Spot bullion instruments (Gold Spot `XAU/USD`).
- **FX**: Foreign exchange currency pairs (initially `USD/VND` market context).
- **Crypto**: Liquid major cryptocurrencies (audited 40-asset canonical universe).

---

## 4. Market-Time Semantics

Trading hours, session closures, and candle boundaries vary fundamentally by asset class:

- **Vietnam Equities & ETFs (`VN_EXCHANGE`)**: Standard exchange sessions with defined opening, lunch break, and closing auctions on Vietnamese business days (`Asia/Ho_Chi_Minh`).
- **Crypto (`CONTINUOUS_24_7`)**: Continuous **24/7/365** trading with no weekend or holiday session closures (`UTC`).
- **FX (`GLOBAL_24_5`)**: Continuous 24/5 global interbank trading sessions.
- **Gold (`GLOBAL_24_5`)**: Global spot continuous trading on business days (`UTC`).
- **Funds (`NAV_SCHEDULED`)**: Periodic Net Asset Value (NAV) strike times.

> [!WARNING]
> There is **no single universal daily candle completion rule**. Feature 07's current-day session exclusion applies specifically to Vietnamese equity sessions and must not be blindly assumed for 24/7 or global instruments.

---

## 5. Price Semantics

All normalized market price data must explicitly carry provenance:

- **Price Value**: Exact numeric quote (`> 0`).
- **Quote Currency**: Explicit currency (e.g. `VND`, `USD`).
- **Timestamp**: Provenance time of quote generation (missing source timestamps remain `null`).
- **Provider / Source**: Identifier of data provider (`yahoo`, `coingecko`, `alphavantage`, `twelvedata`).
- **Freshness / Availability**: Contextual status flags (`available`, `delayed`, `unavailable`).

> [!IMPORTANT]
> Missing market prices or failed quotes must **never** be fabricated as zero. They must produce explicit unavailable states.

---

## 6. Historical Bar Semantics

Historical time series analysis requires asset-aware handling:

- **Canonical History Pipeline**:
  $$\text{Provider Raw Data} \longrightarrow \text{Provider Parsing} \longrightarrow \text{Market-Policy Normalization} \longrightarrow \text{Completed Canonical Daily Bars}$$
- **Timezone & Business-Day Authority**: Timestamps and daily boundaries reflect the asset's canonical timezone (`Asia/Ho_Chi_Minh` for Vietnam stocks, `UTC` for crypto and gold spot).
- **Completed Period Invariant**: Completed history strictly excludes the ongoing / uncompleted market date.
- **Calendar Lookback Windows**: Ranges (`1W`, `1M`, `3M`, `6M`, `1Y`) use canonical calendar subtraction, not fixed observation counts.
- **Truthful Incomplete Candle Representation**:
  - Missing candle fields (`open`, `high`, `low`, `volume`) are strictly preserved as `null`.
  - Missing values $\neq 0$.
  - Close-only providers (CoinGecko, Alpha Vantage Gold Spot) must **never** fabricate synthetic OHLC or volume fields from close prices.

---

## 7. Portfolio Currency & FX Semantics

- **Reporting Currency**: **VND** is the authoritative reporting currency for aggregate portfolio valuation.
- **Valuation Pipeline for Non-VND Assets**:
  $$\text{Native Market Value} \xrightarrow{\text{Explicit FX Rate}} \text{VND Reporting Value}$$
- **FX Conversion Provenance**:
  - Every FX conversion must track the FX rate value, rate timestamp, and rate provider.
  - If a required FX rate is missing or unavailable, the asset valuation must yield an explicit **partial valuation** (`valuationStatus: 'partial'`).
  - **Never** assume an FX rate of 1.0 or silently bypass conversion.

---

## 8. Ledger Authority & Financial Mutations

The double-ledger architecture is the sole authoritative mechanism for portfolio balance mutations:

- **Position Authority**:
  $$\text{Immutable Portfolio Transactions (BUY / SELL)} \longrightarrow \text{Holdings Read-Model / Cache}$$
- **Cash Authority**:
  $$\text{Immutable Cash Ledger (DEPOSIT / WITHDRAWAL / BUY / SELL)} \longrightarrow \text{Available Cash Read-Model / Cache}$$
- No competing independent financial source-of-truth paths exist. Direct profile cash edits are completely removed, and direct holdings CRUD is legacy compatibility only.

---

## 9. Quantity Semantics

- The asset model supports **fractional quantities** with full numeric precision for asset classes that permit fractions (Crypto, Gold, Funds, FX).
- Integer-share restrictions apply strictly as asset-class specific validation rules (e.g. Vietnamese stock lot sizes) and must not be imposed globally across the architecture.

---

## 10. Provider Abstraction

- Feature components (Dashboard, Portfolio, Analysis, Alerts, Watchlist, News) request data through normalized service contracts (`getMarketSnapshot(asset)`, `getHistoricalBars(asset, range)`, `getNewsFeed()`).
- Specific provider adapters (`server/src/providers/`):
  - **Yahoo Finance**: Vietnamese listed equities & ETFs.
  - **CoinGecko**: 40 canonical cryptocurrencies.
  - **Alpha Vantage**: Gold Spot (`XAU/USD`).
  - **Twelve Data**: `USD/VND` exchange rate.
- Application code must never build provider-specific query parameters directly.

---

## 11. News & Relevance Semantics (Feature 23)

- **Canonical Identity Authority**:
  - The canonical asset UUID (`assetId`) is the sole authoritative identity linking news articles to assets in `relatedAssets`.
  - Matching utilizes canonical symbols, full names, verified aliases, and contextual disambiguation, but the resulting relationship references the asset UUID.
- **Current Asset-Class News Sources**:
  - **Vietnamese Equities & ETFs**: CafeF official 4-feed RSS.
  - **Crypto**: CoinDesk official public RSS.
  - **Gold Spot (`XAU/USD`)**: Alpha Vantage commodities/macro context.
  - **USD/VND Foreign Exchange**: Alpha Vantage forex/macro context.
  - **Global Macro / Economy**: Alpha Vantage economy_macro topics and CafeF macro feeds.
- **Relevance Rules & Non-Inference**:
  - Articles from a given source family do **not** automatically relate to all assets in that class. Every asset relationship requires explicit textual evidence (`SYMBOL_EXACT`, `NAME_EXACT`, `VERIFIED_ALIAS`).
  - General macroeconomic or industry articles without individual asset mentions remain valid in the public feed with `relatedAssets = []`.
- **Application-Level Aliases**:
  - No database alias table was introduced; verified aliases (e.g. Gold spot `XAU`, `vàng`, `vàng miếng`, `vàng sjc`) and ambiguous ticker protection rules (e.g. `USD/VND`, `RAIN`, `SOL`) reside in version-controlled application logic.

---

## 12. Quantitative Analysis Semantics

- **Provider-Neutral Capability Model**:
  - Analysis consumes canonical asset metadata, completed canonical daily history, and `historyCapabilities`:
    - `close`
    - `ohlc`
    - `volume`
  - Provider names and payload formats do not select formulas. Provider provenance may remain metadata only.
  - Capability availability and per-window metric availability are distinct: an asset may support a capability globally while a specific window still has insufficient or incomplete observations.
- **Current Analysis Support Matrix**:
  - **`VN_EXCHANGE` stock / ETF**:
    - Completed-close metrics are supported.
    - OHLC metrics are supported when canonical OHLC is complete for the evaluated window.
    - Current Yahoo canonical history includes volume, but Feature 22 adds no volume-analysis methodology.
  - **`CONTINUOUS_24_7` crypto**:
    - Completed-close analysis is supported.
    - OHLC analysis is unsupported with current close-only canonical history.
    - Daily volatility is a non-annualized sample statistic despite continuous 24/7 trading.
  - **`GLOBAL_24_5` Gold Spot (`XAU/USD`)**:
    - Completed-close analysis is supported.
    - OHLC analysis is unsupported with current close-only canonical history.
  - **`GLOBAL_24_5` USD/VND**:
    - Snapshot is supported.
    - History and deterministic analysis are unsupported pending trustworthy completed historical capability.
- **Metric Classes**:
  1. **Cross-Asset Universal**: Mathematically sound completed-close metrics, including period price change, highest/lowest completed close, completed-close range position, distance below highest completed close, positive close transition ratio, non-annualized sample daily volatility, and maximum completed-close drawdown.
  2. **Capability-Dependent**: Metrics requiring canonical OHLC are available only when `historyCapabilities.ohlc=true` and the evaluated window contains complete OHLC observations.
  3. **Explicitly Unavailable or Unsupported**: Missing capability or history is expressed through machine-readable metric/analysis status, never forced to zero and never synthesized from close.
- **Interpretation Boundary**: Analysis V2 is deterministic metrics only. It produces no recommendation, score, confidence percentage, prediction, or forecast.

---

## 13. Known Unresolved Architectural Decisions (Explicit UNKNOWN)

The following items are intentionally open questions and remain classified as `UNKNOWN` until explicitly decided in future roadmap phases:

- `UNKNOWN`: Open-ended mutual fund NAV strike mechanics and provider onboarding (deferred).
- `UNKNOWN`: Provider failover orchestration and multi-source redundancy policy (deferred).
- `UNKNOWN`: Multi-currency cash accounts and acquisition-time FX cost basis accounting for non-VND asset trading.
- `UNKNOWN`: USD/VND historical daily bar timezone alignment and provider selection for FX historical time series.
