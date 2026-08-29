# Current Project Status

## LATEST VERIFIED CHECKPOINT
- **Commit**: `1573225`
- **Branch**: `main`
- **Feature 23 Implementation Commit**: `1573225`
- **Automated Test Suite**:
  - Latest Full Backend Regression: 379/379 PASS (Features 01–23 complete test coverage)
  - Targeted Multi-Asset News Tests: 35/35 PASS
  - Personalized News Tests: 14/14 PASS
- **Client Build**: Production build clean (`vite build` PASS)
- **Git Working Tree**: Clean
- **GitHub Remote**: No origin configured / remote state not verified (local git authority)

## CURRENT PHASE
MULTI-ASSET FOUNDATION, HISTORY, QUANTITATIVE ANALYSIS & NEWS

## CURRENT NEXT PROJECT TASK
Feature 24 — Existing Feature Multi-Asset Integration. See `docs/ROADMAP.md`.

---

## PRODUCTION & LIVE PROVIDER VERIFIED PATHS
- **Yahoo Finance**: Vietnamese listed equities & exchange-traded ETFs (`VCB`, `FPT`, `HPG`, `VNM`, `E1VFVN30`, `FUEVFVND`, `FUESSVFL`). Completed daily OHLCV history with `Asia/Ho_Chi_Minh` timezone semantics.
- **CoinGecko**: Cryptocurrency spot snapshots and completed daily close-only history (40 canonical assets: `BTC`, `ETH`, `SOL`, `BNB`, `XRP`, `TRX`, `HYPE`, `ZEC`, `DOGE`, `RAIN`, `XMR`, `LINK`, `WBT`, `ADA`, `XLM`, `BCH`, `GRAM`, `LTC`, `HBAR`, `AVAX`, `SHIB`, `SUI`, `UNI`, `NEAR`, `TAO`, `PUMP`, `AAVE`, `ASTER`, `WLFI`, `ONDO`, `ENA`, `MORPHO`, `PEPE`, `DOT`, `WLD`, `ETC`, `POL`, `LIT`, `ATOM`, `JUP`) via explicit immutable coin IDs. `UTC` daily calendar semantics; completed periods only; close-only (`open`, `high`, `low`, `volume` are `null`).
- **Alpha Vantage**:
  - Gold Spot snapshot and completed daily close-only history (`XAU/USD`) via `GOLD_SILVER_SPOT` with `symbol=XAU`. `UTC` daily calendar semantics; completed periods only; close-only.
  - Multi-asset global news acquisition (`NEWS_SENTIMENT` with broad topics `economy_macro,commodities,forex`) for Gold, FX, and global macroeconomic context. Upstream sentiment, sentiment labels, and relevance scores are strictly discarded.
- **Twelve Data**: Direct `USD -> VND` FX exchange rate resolution. Current snapshot supported; history intentionally UNSUPPORTED because provider daily timezone boundary cannot currently be reconciled confidently with canonical asset timezone.
- **CafeF**: Official public RSS feeds for Vietnamese stock, company, macroeconomic, and international market news (4 feeds: `thi-truong-chung-khoan`, `doanh-nghiep`, `vi-mo-dau-tu`, `tai-chinh-quoc-te`).
- **CoinDesk**: Official public RSS feed for cryptocurrency news (`https://www.coindesk.com/arc/outboundfeeds/rss/`).
- **FXStreet**: Intentionally NOT used in Feature 23 (unauthenticated public access was verified unreliable).

---

## CURRENT NEWS & RELEVANCE CAPABILITIES (FEATURE 23)
- **Unified Canonical Item**: Provider-neutral schema (`id`, `title`, `summary`, `url`, `publishedAt`, `source`, `sourceId`, `language`, `category`, `relatedAssets`).
- **Data Normalization & Sanitization**: Deterministic URL normalization (http/https validation, credential rejection, tracking parameter stripping, query sorting), HTML entity decoding, plain-text extraction, and strict ISO-8601 UTC timestamp normalization.
- **Deduplication Engine**: Deterministic multi-tier deduplication (normalized URL $\rightarrow$ source GUID $\rightarrow$ composite fallback `sourceId:title:publishedAt`) with deterministic tie-breaking.
- **Relevance Authority**: Canonical database asset UUID (`assetId`) is the sole authority for asset relationships in `relatedAssets`. Symbol and name are matching/display metadata only.
- **Conservative Disambiguation**:
  - Exact token-boundary matching for Vietnamese stocks/ETFs.
  - Gold Spot (`XAU/USD`) matches verified aliases (`XAU`, `vàng`, `vàng miếng`, `vàng sjc`, `vàng nhẫn`, `gold bullion`, `gold spot`).
  - `USD/VND` requires explicit pair or central exchange-rate terms; lone `USD` never matches.
  - `RAIN` token requires explicit token phrases (`Rain coin`, `Rain token`, `Rain crypto`); the common word "rain" never matches.
  - Short crypto tickers (`SOL`, `ADA`, `DOT`, `UNI`, etc.) require crypto context (CoinDesk or crypto keywords in article); otherwise full name is required.
- **Personalized News**: Evaluated purely by intersecting user holdings and watchlist canonical UUIDs with article `relatedAssets`. Unlinked general macro articles remain available in the general feed but are excluded from personalized news.
- **Resilience & Caching**:
  - Per-source in-memory cache: CafeF & CoinDesk (5m fresh / 30m stale-if-error); Alpha Vantage News (4h fresh / 24h stale-if-error).
  - In-flight request coalescing for identical source fetches. Successful empty results are cached.
  - Graceful partial degradation: Returns HTTP 200 with `partial: true` if at least one source responds or stale cache is available. HTTP 503 `NEWS_SOURCES_UNAVAILABLE` only if all sources fail and no cache exists.
- **Zero Inventions**: No article database persistence, no database migrations, no AI summaries, no sentiment scores, no recommendations, and no confidence percentages.

---

## CURRENT PUBLIC HISTORY CAPABILITIES
- **Supported Ranges**: `1W`, `1M`, `3M`, `6M`, `1Y`
- **Range Semantics**: Canonical calendar lookback windows (`1W` = 7 days, `1M`/`3M`/`6M` = calendar months, `1Y` = calendar year) with upper bound strictly exclusive of the current uncompleted market date.
- **Analysis Invariant**: Feature 22 consumes completed canonical history and provider-neutral history capabilities; assets without trustworthy completed history remain explicitly unsupported.

## CURRENT FEATURE 22 ANALYSIS CAPABILITIES
- **Methodology**: `methodologyVersion = "v2"`; deterministic, metrics-only, and provider-neutral.
- **VN Stocks & ETFs**: Supported with completed canonical daily history and capability-gated OHLC metrics.
- **Crypto & Gold Spot (`XAU/USD`)**: Supported with completed close-only canonical history and universal completed-close metrics.
- **USD/VND FX**: Analysis unsupported because trustworthy completed historical series remains unavailable.
- **Interpretation Boundary**: No recommendation, score, confidence percentage, prediction, or forecast.

## ASSET BROWSER & NEWS UI STATE
- **Asset Explorer**: Unified browser grouped by asset class with dynamic count filter pills, search, mobile responsive rows, and compact Crypto preview.
- **News UI**: Dynamic article source attribution (`Nguồn: CafeF`, `Nguồn: CoinDesk`, `Nguồn: Reuters`, etc.), multi-source category compatibility (`Vĩ mô`, `Thị trường`, `Doanh nghiệp`, `Quốc tế`, `Crypto`, `Vàng`, `Ngoại hối`, `Tin chung`), and preserved personalized news tab.

## FINANCIAL DEVELOPMENT BASELINE
- Authoritative Holdings: 2 rows (`E1VFVN30`: 111,003 @ 35,000 VND; `FPT`: 12 @ 35,000 VND)
- Authoritative Transactions: 1 row (`SELL` `E1VFVN30`: 12,121 @ 40,000 VND)
- Authoritative Cash Ledger: 3 rows (`OPENING_BALANCE`: 100,000,000; `SELL`: 484,840,000; `DEPOSIT`: 21,212,112)
- Authoritative Current Cash: 606,052,112 VND
- Remote Canonical Universe: 49 assets total (40 crypto, 7 VN stocks/ETFs, 1 gold spot, 1 FX context) across 4 verified providers

---

## COMPLETED FEATURES SUMMARY (01–23)

- **Features 01–03**: Asset Browser (`/api/assets`), Market Snapshot (delayed Yahoo Finance `/api/market/:symbol`), News Feed (CafeF RSS `/api/news`).
- **Feature 04**: Investor Profile (`GET`/`PUT /api/profile`), singleton enforcement, holdings management.
- **Feature 05**: Portfolio Overview (`/api/portfolio/overview`), on-demand full precision valuation, partial valuation handling, UI motion & visual tokens.
- **Feature 06**: Historical Price & Trend (`/api/market/:symbol/history`), standard ranges (`1W` to `1Y`), daily bars.
- **Feature 07**: Deterministic Asset Analysis (`/api/analysis/:symbol`), completed daily close lookback, breadth & range position metrics.
- **Feature 08**: Watchlist / Danh sách theo dõi (`/api/watchlist`), conflict-safe singleton tracking, failure-isolated market quotes.
- **Feature 09**: Personal Investment Dashboard / Tổng quan, cross-app overview, compact KPI summary, watchlist movers preview.
- **Feature 10**: Portfolio Composition & Concentration (`/api/portfolio/composition`), on-demand allocation, 2.5D Donut chart.
- **Feature 11**: Asset Comparison / So sánh tài sản, side-by-side deterministic metrics, normalized relative price chart.
- **Feature 12**: Price Alerts V1 / Cảnh báo giá (`/api/alerts`), one-shot lifecycle, deterministic batch evaluation.
- **Feature 13**: Personalized Relevant News / Tin của tôi (`/api/news/personalized`), dynamic holdings + watchlist token matching.
- **Feature 14**: Transaction Ledger / Sổ lệnh giao dịch (`/api/transactions`), immutable transaction log, atomic PostgreSQL RPC, weighted-average cost, realized P/L tracking.
- **Feature 15**: Cash / Capital Ledger / Sổ dòng tiền (`/api/cash/overview`, `/api/cash/ledger`, `/api/cash/deposit`, `/api/cash/withdraw`), atomic cash ledger, opening baseline, direct cash edit removed.
- **Feature 16**: Canonical Multi-Asset Foundation (authoritative asset UUID, decoupled provider mapping schema, VND transaction guard).
- **Feature 17**: Ledger Authority & Position Integrity (opening-position baselines without synthetic BUYs, locking upon subsequent trade, direct holdings DML denied).
- **Feature 18**: Market Provider Abstraction (provider-neutral snapshot/history boundary, adapter modularization).
- **Feature 19**: FX & Cross-Currency Valuation Foundation (VND universal reporting currency, decoupled native/reporting valuation, direct-to-VND conversion, partial valuation on missing FX, blocked non-VND transactions).
- **Feature 20**: Real Multi-Asset Providers & Controlled Universe (COMPLETE):
  - **20A**: Real Multi-Asset Provider Onboarding (Twelve Data FX, CoinGecko BTC/ETH/SOL, Alpha Vantage Gold Spot, Yahoo VN ETFs; 12 canonical assets total).
  - **20B**: Controlled Crypto Universe Expansion (Audited Top 100 Market Cap $\cap$ Top 100 24h Volume snapshot with deterministic exclusions; 40 liquid canonical crypto assets with explicit CoinGecko provider mappings).
- **Feature 21**: Asset-Class Market & Historical Semantics (COMPLETE):
  - Normalized multi-asset historical bar engine with asset-class specific calendar policies (`VN_EXCHANGE`, `CONTINUOUS_24_7`, `GLOBAL_24_5`).
  - Canonical calendar lookback windows (`1W`, `1M`, `3M`, `6M`, `1Y`) with current-date exclusivity.
  - Truthful representation: Yahoo OHLCV for VN equities/ETFs, CoinGecko close-only for 40 cryptos, Alpha Vantage close-only for Gold Spot, explicit unsupported error for USD/VND history.
- **Feature 22**: Deterministic Analysis V2 (COMPLETE):
  - Provider-neutral quantitative analysis over completed canonical daily history with `methodologyVersion = "v2"`.
  - VN stocks and ETFs support completed-close and capability-dependent OHLC metrics; crypto and Gold Spot support universal completed-close metrics without fabricated OHLCV.
  - USD/VND analysis remains explicitly unsupported until trustworthy completed historical capability exists.
- **Feature 23**: Multi-Asset News Foundation (COMPLETE):
  - Ingestion across CafeF (4 feeds), CoinDesk RSS, and Alpha Vantage broad topic news with upstream sentiment/relevance scores strictly scrubbed.
  - Canonical UUID-authoritative relevance engine with ambiguous ticker protection.
  - In-memory caching with per-source TTLs, in-flight request coalescing, and stale-if-error fallback.
  - Dynamic source attribution, extended categories, and query parameters (`limit`, `assetId`).
