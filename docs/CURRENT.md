# Current Project Status

## LATEST VERIFIED CHECKPOINT
- **Commits**:
  - `e292f68` — `feat: integrate multi-asset consumers and crypto realtime` (Feature 24A)
  - `2e2edde` — `feat: complete multi-asset capability integration` (Feature 24B)
- **Branch**: `main`
- **Feature 24 Implementation Status**: COMPLETE (24A Backend & 24B Frontend)
- **Automated Test Suite**:
  - Latest Full Backend Regression: 424/424 PASS (Features 01–24 complete test coverage)
  - Focused Multi-Asset Provider / History Gate: 34/34 PASS
  - Client Build: Production build clean (`vite build` PASS in 1.43s)
- **Git Working Tree**: Clean before docs reconciliation
- **GitHub Remote**: Local git authority (no push without explicit approval)

## CURRENT PHASE
MULTI-ASSET CAPABILITY INTEGRATION, REALTIME REFERENCE & DETERMINISTIC ANALYSIS

## CURRENT NEXT PROJECT TASK
Feature 25 — Portfolio Performance & Benchmarking. See `docs/ROADMAP.md`.

---

## PRODUCTION & LIVE PROVIDER VERIFIED PATHS
- **Yahoo Finance**: Vietnamese listed equities & exchange-traded ETFs (`VCB`, `FPT`, `HPG`, `VNM`, `E1VFVN30`, `FUEVFVND`, `FUESSVFL`). Completed daily OHLCV history with `Asia/Ho_Chi_Minh` timezone semantics.
- **CoinGecko**: Cryptocurrency spot snapshots and completed daily close-only history (40 canonical assets: `BTC`, `ETH`, `SOL`, `BNB`, `XRP`, `TRX`, `HYPE`, `ZEC`, `DOGE`, `RAIN`, `XMR`, `LINK`, `WBT`, `ADA`, `XLM`, `BCH`, `GRAM`, `LTC`, `HBAR`, `AVAX`, `SHIB`, `SUI`, `UNI`, `NEAR`, `TAO`, `PUMP`, `AAVE`, `ASTER`, `WLFI`, `ONDO`, `ENA`, `MORPHO`, `PEPE`, `DOT`, `WLD`, `ETC`, `POL`, `LIT`, `ATOM`, `JUP`) via explicit immutable coin IDs. `UTC` daily calendar semantics; completed periods only; close-only (`open`, `high`, `low`, `volume` are `null`). Authoritative source for canonical Crypto valuation, holdings, alerts, comparison, and Feature 22 analysis. Multi-chunk retrieval supports full 366-day calendar-year lookbacks with deduplication and in-memory caching.
- **Binance Public WebSocket**: Realtime crypto market reference (~35/40 pairs) via shared backend miniTicker stream (`wss://stream.binance.com:9443/ws/!miniTicker@arr`). Quoted in `USDT` (`referenceOnly = true`), polled by Asset Detail frontend approximately every 2 seconds. Does NOT feed portfolio valuation, holdings, watchlist, alerts, comparison, or Feature 22 analysis. 5 assets without Binance pairs (`HYPE`, `RAIN`, `WBT`, `XMR`, `LIT`) fall back cleanly to canonical CoinGecko USD snapshot.
- **Alpha Vantage**:
  - Gold Spot snapshot and completed daily close-only history (`XAU/USD`) via `GOLD_SILVER_SPOT` with `symbol=XAU`. `UTC` daily calendar semantics; completed periods only; close-only.
  - Multi-asset global news acquisition (`NEWS_SENTIMENT` with broad topics `economy_macro,commodities,forex`) for Gold, FX, and global macroeconomic context. Upstream sentiment, sentiment labels, and relevance scores are strictly discarded.
  - Sanitized rate-limit / quota handling returning safe `PROVIDER_RATE_LIMITED` without exposing raw upstream marketing bodies or subscription URLs.
- **Twelve Data**: Direct `USD -> VND` FX exchange rate resolution. Current snapshot supported; history intentionally UNSUPPORTED because provider daily timezone boundary cannot currently be reconciled confidently with canonical asset timezone.
- **CafeF**: Official public RSS feeds for Vietnamese stock, company, macroeconomic, and international market news (4 feeds: `thi-truong-chung-khoan`, `doanh-nghiep`, `vi-mo-dau-tu`, `tai-chinh-quoc-te`).
- **CoinDesk**: Official public RSS feed for cryptocurrency news (`https://www.coindesk.com/arc/outboundfeeds/rss/`).

---

## CURRENT MULTI-ASSET INTEGRATION & FRONTEND CAPABILITIES (FEATURE 24)
- **Centralized Financial Formatter**: Exactly one authoritative formatting module (`client/src/utils/formatting.js`) managing native currency amounts (`formatNativeAmount`), market changes (`formatMarketChange`), market contexts (`formatMarketContext`), and asset types (`formatAssetType`).
- **Native Quote Currency Display Invariant**:
  - VN Stocks / ETFs: `VND`
  - Canonical Crypto Snapshots / History / Analysis / Alerts: `USD`
  - Binance Crypto Realtime Reference: `USDT`
  - Gold Spot (`XAU/USD`): `USD`
  - Portfolio Reporting Values: strictly `VND`
  - Zero hard-coded universal `₫`, `VND`, `USD`, `USDT`, or `HOSE`.
- **Capability-Aware History & Analysis**:
  - Range coverage (`5/5 kỳ có dữ liệu`) is strictly separated from metric capability (`Một số chỉ số nội ngày không áp dụng` when `ohlc = false`).
  - Legacy Feature 07 `Giai đoạn tăng giá: 0 / 0` presentation branch is retired; universal V2 metrics (range positions, distance below high, positive close transitions, daily volatility, max drawdown) are bound directly.
  - Completed history card badge displays *"Dữ liệu lịch sử đã hoàn tất"*; analysis badge displays *"Dựa trên dữ liệu đã hoàn tất"*.
- **Authoritative Multi-Asset Comparison**:
  - Direct consumption of backend `base100.series` across canonical common dates.
  - Zero client-side array-index matching, zero date borrowing, zero forward-filling, and zero synthetic interpolation.
  - Native quote currencies preserved in comparison table; raw prices across different currencies are not treated as directly comparable. Zero ranking, scoring, or recommendations.
- **Universal Watchlist & Dashboard**:
  - Column `THỊ TRƯỜNG` displays canonical market contexts (`HOSE`, `24/7`, `24/5`).
  - Stale universal `~15p` latency badges removed; replaced with provider-neutral wording: *"Dữ liệu theo thời điểm cập nhật của nhà cung cấp"*.
- **Price Alerts V1**:
  - Alert target price uses native `quote_currency` (e.g. `USD` for BTC, `VND` for FPT).
  - Informational notice clearly discloses: *"Cảnh báo được kiểm tra khi bạn làm mới dữ liệu trong ứng dụng. Thời điểm giá phụ thuộc nguồn dữ liệu của tài sản."*
- **Ledger Gating & Currency Notice**:
  - Transaction and Opening Position modals enforce VND-only trading authority before submit, with explicit visible informational banners: *"📌 Lưu ý: Hiện chỉ hỗ trợ ghi nhận giao dịch mua/bán cho tài sản định giá bằng VND."*

---

## FINANCIAL DEVELOPMENT BASELINE
- Authoritative Holdings: 2 rows (`E1VFVN30`: 111,003 @ 35,000 VND; `FPT`: 12 @ 35,000 VND)
- Authoritative Transactions: 1 row (`SELL` `E1VFVN30`: 12,121 @ 40,000 VND)
- Authoritative Cash Ledger: 3 rows (`OPENING_BALANCE`: 100,000,000; `SELL`: 484,840,000; `DEPOSIT`: 21,212,112)
- Authoritative Current Cash: 606,052,112 VND
- Remote Canonical Universe: 49 assets total (40 crypto, 7 VN stocks/ETFs, 1 gold spot, 1 FX context) across 4 verified providers

---

## COMPLETED FEATURES SUMMARY (01–24)

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
- **Feature 24**: Existing Feature Multi-Asset Integration (COMPLETE):
  - **24A**: Backend / Canonical Capability Integration (`e292f68`): Canonical CoinGecko USD snapshot authority, Binance Spot shared WebSocket realtime USDT reference for Asset Detail, CoinGecko 366-day calendar-year retrieval, sanitized provider errors.
  - **24B**: Frontend Capability-Aware Integration (`2e2edde`): Centralized native currency formatting, Base 100 common-date comparison, Analysis V2 presentation with clean coverage/capability separation, provider-neutral freshness badges, and VND-only ledger gating notices.
