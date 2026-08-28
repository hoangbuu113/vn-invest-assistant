# Canonical Multi-Asset Architecture Contract

This document defines the canonical architectural and conceptual model for multi-asset management across all features in VN Invest Assistant.

---

## 1. Current Implementation Status (Features 16–20)

Features 16 through 20 establish the canonical schema, ledger authority, provider abstraction, FX valuation, and full controlled multi-asset universe:

- **Verified Production Universe (49 Canonical Assets)**:
  - **Vietnamese Equities & ETFs** (`VN_EXCHANGE`, `Asia/Ho_Chi_Minh`, `VND`, `share`):
    - `VCB`, `FPT`, `HPG`, `VNM`, `E1VFVN30`, `FUEVFVND`, `FUESSVFL`
    - Provider mapping: `yahoo` $\rightarrow$ `<SYMBOL>.VN`
  - **Cryptocurrencies (40 Canonical Assets)** (`CONTINUOUS_24_7`, `UTC`, `USD`, `coin`):
    - `BTC` (`bitcoin`), `ETH` (`ethereum`), `SOL` (`solana`), `BNB` (`binancecoin`), `XRP` (`ripple`), `TRX` (`tron`), `HYPE` (`hyperliquid`), `ZEC` (`zcash`), `DOGE` (`dogecoin`), `RAIN` (`rain`), `XMR` (`monero`), `LINK` (`chainlink`), `WBT` (`whitebit`), `ADA` (`cardano`), `XLM` (`stellar`), `BCH` (`bitcoin-cash`), `GRAM` (`the-open-network`), `LTC` (`litecoin`), `HBAR` (`hedera-hashgraph`), `AVAX` (`avalanche-2`), `SHIB` (`shiba-inu`), `SUI` (`sui`), `UNI` (`uniswap`), `NEAR` (`near`), `TAO` (`bittensor`), `PUMP` (`pump-fun`), `AAVE` (`aave`), `ASTER` (`aster-2`), `WLFI` (`world-liberty-financial`), `ONDO` (`ondo-finance`), `ENA` (`ethena`), `MORPHO` (`morpho`), `PEPE` (`pepe`), `DOT` (`polkadot`), `WLD` (`worldcoin-wld`), `ETC` (`ethereum-classic`), `POL` (`polygon-ecosystem-token`), `LIT` (`lighter`), `ATOM` (`cosmos`), `JUP` (`jupiter-exchange-solana`)
    - Provider mapping: `coingecko` $\rightarrow$ `<EXPLICIT_COINGECKO_ID>`
  - **Gold Spot** (`GLOBAL_24_5`, `UTC`, base: `XAU`, quote: `USD`, `oz`):
    - `XAU/USD` (provider: `alphavantage` $\rightarrow$ `XAU` via `GOLD_SILVER_SPOT`)
  - **Foreign Exchange Context** (`GLOBAL_24_5`, `Asia/Ho_Chi_Minh`, base: `USD`, quote: `VND`, unit: `null`):
    - `USD/VND` (provider: `twelvedata` $\rightarrow$ `USD/VND`)

- **Implemented Multi-Asset Capabilities**:
  - Authoritative internal asset identity via UUID (`public.assets.id`).
  - Strict decoupling of internal canonical asset identity from third-party provider symbols (`public.asset_provider_mappings`).
  - Dedicated opening-position baseline authority (`public.position_opening_baselines`) with locked correction upon subsequent ledger activity.
  - Multi-provider market adapter architecture (`server/src/providers/`):
    $$\text{Canonical Asset} \longrightarrow \text{Explicit Provider Mapping} \longrightarrow \text{Provider Adapter} \longrightarrow \text{Normalized Snapshot}$$
  - Universal reporting currency is strictly `VND`; native non-VND asset valuations are converted on demand via direct `quoteCurrency -> VND` FX rates.
  - Database trigger guard (`enforce_vnd_portfolio_transaction_asset`) strictly enforcing VND-only transaction accounting until multi-currency FX accounting is implemented.

- **Current Intentional Limitations**:
  - Specialized historical session, calendar, and candlestick rules for 24/7 crypto and global gold/FX are deferred to Feature 21; history requests for non-VN assets return explicit `UNSUPPORTED_MARKET_POLICY`.
  - Non-VND cost basis and unrealized P/L remain unavailable until acquisition-time FX accounting exists.
  - Non-VND BUY/SELL transactions are strictly blocked at database trigger level.
  - The single VND cash ledger remains authoritative for all cash operations (no multi-currency cash balances).
  - No automatic crypto-universe synchronization (universe maintenance is controlled and intentional).
  - Open-ended mutual funds (NAV scheduled) remain deferred.

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
- **Gold**: Physical or spot gold bullion instruments.
- **FX**: Foreign exchange currency pairs (initially USD/VND).
- **Crypto**: Liquid major cryptocurrencies (~Top 40 assets by market liquidity).

---

## 4. Market-Time Semantics

Trading hours, session closures, and candle boundaries vary fundamentally by asset class:

- **Vietnam Equities & ETFs**: Standard exchange sessions with defined opening, lunch break, and closing auctions on Vietnamese business days.
- **Crypto**: Continuous **24/7/365** trading with no weekend or holiday session closures.
- **FX**: Continuous 24/5 global interbank trading sessions.
- **Gold**: Session rules depend on the chosen instrument (domestic physical trading hours vs global spot continuous market).
- **Funds**: Daily or weekly Net Asset Value (NAV) strike times.

> [!WARNING]
> There is **no single universal daily candle completion rule**. Feature 07's current-day session exclusion applies specifically to Vietnamese equity sessions and must not be blindly assumed for 24/7 or global instruments.

---

## 5. Price Semantics

All normalized market price data must explicitly carry provenance:

- **Price Value**: Exact numeric quote (`> 0`).
- **Quote Currency**: Explicit currency (e.g. `VND`, `USD`).
- **Timestamp**: Provenance time of quote generation (missing source timestamps remain `null`).
- **Provider / Source**: Identifier of data provider.
- **Freshness / Availability**: Contextual status flags (`available`, `delayed`, `unavailable`).

> [!IMPORTANT]
> Missing market prices or failed quotes must **never** be fabricated as zero. They must produce explicit unavailable states.

---

## 6. Historical Bar Semantics

Historical time series analysis requires asset-aware handling:

- **Timezone Awareness**: Timestamps and daily boundaries must reflect the relevant market's local timezone (e.g. `Asia/Ho_Chi_Minh` for Vietnam stocks, `UTC` for crypto).
- **Completed vs Incomplete Bars**: Calculation engines must determine bar completion using the asset's specific calendar policy.
- **Missing Session Handling**: Trading holidays and non-trading days must be handled gracefully without synthesizing artificial flat bars.

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

- The asset model must support **fractional quantities** with full numeric precision for asset classes that permit fractions (Crypto, Gold, Funds, FX).
- Integer-share restrictions apply strictly as asset-class specific validation rules (e.g. Vietnamese stock lot sizes) and must not be imposed globally across the architecture.

---

## 10. Provider Abstraction

- Feature components (Dashboard, Portfolio, Analysis, Alerts, Watchlist) request data through normalized service contracts (`getMarketSnapshot(asset)`, `getHistoricalBars(asset, range)`).
- Specific provider adapters (Yahoo Finance, RSS parsers, future crypto/FX providers) encapsulate provider-specific network protocols, ticker formats, rate limits, and parsing logic.
- Application code must never build provider-specific query parameters directly.

---

## 11. News Semantics

- News feed contracts share a unified normalized schema (`id`, `title`, `summary`, `url`, `publishedAt`, `category`, `matchedAssets`).
- Different source families and category classifications are utilized for different asset markets (e.g. CafeF for Vietnamese corporate/macro news; specialized feeds for global FX or crypto).
- Asset matching utilizes unicode token-boundary matching against trusted canonical asset metadata.

---

## 12. Quantitative Analysis Semantics

- Analysis metrics must be mathematically valid for the underlying asset class.
- Metrics may be:
  1. **Cross-Asset Universal**: When mathematically sound across all asset classes (e.g. unadjusted percentage price change over completed lookback windows).
  2. **Class-Specialized**: When tailored to specific asset mechanics (e.g. exchange trading session breadth vs 24/7 continuous volatility).
  3. **Explicitly Unavailable**: When an equity-centric metric has no meaningful interpretation for an asset class (marked `unavailable`, never forced to 0).

---

## 13. Known Unresolved Architectural Decisions (Explicit UNKNOWN)

The following items are intentionally open questions and must remain classified as `UNKNOWN` until explicitly decided:

- `UNKNOWN`: Exact gold instrument definition and authoritative price source (domestic SJC VND vs international spot XAU/USD).
- `UNKNOWN`: ETF continuous trading vs open-ended mutual fund NAV strike mechanics.
- `UNKNOWN`: Selected provider for USD/VND and global FX rates.
- `UNKNOWN`: Selected provider for crypto market data and historical bars.
- `UNKNOWN`: Specific methodology for selecting and updating the Top ~40 crypto asset list.
- `UNKNOWN`: Inclusion vs exclusion criteria for USD-pegged stablecoins (USDT, USDC).
- `UNKNOWN`: Provider failover and multi-source redundancy policy.
