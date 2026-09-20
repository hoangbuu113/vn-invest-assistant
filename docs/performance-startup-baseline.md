# Application Startup Performance Baseline

**Date**: 2026-09-20  
**Environment**: Production (Cloudflare Workers + Render backend) & Local Canonical  
**Authoritative Commit**: `f8946e322fafb0a205c33ef60526a2e0a96f9e36` / `3e36c7d`  

---

## 1. Production Network & Bundle Baseline

### Static Assets (Cloudflare Workers)
| Asset | Role | Raw Size | Gzip Size | TTFB (ms) | Total Transfer (ms) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/` (`index.html`) | App Shell | 1.66 KB | 0.71 KB | 466.7 | 467.2 |
| `/assets/index-CzU37DbE.js` | Main App Entry | 568.51 KB | 144.07 KB | 79.0 | 245.1 |
| `/assets/three-DsjB4ozX.js` | Three.js Vendor | 526.13 KB | 131.13 KB | 73.6 | 138.7 |
| `/assets/supabase-CvgQCc3n.js` | Supabase Vendor | 209.11 KB | 54.11 KB | 66.9 | 78.1 |
| `/assets/framer-B3YAcDTO.js` | Framer Motion Vendor | 140.53 KB | 46.25 KB | 71.9 | 78.8 |
| `/assets/index-CVt5gomz.css` | Global CSS | 106.66 KB | 18.67 KB | 69.1 | 74.8 |
| `/assets/rolldown-runtime-*.js` | Runtime | 0.58 KB | 0.36 KB | 63.1 | 63.3 |
| **Total Critical Bundle** | | **1,553.18 KB** | **395.30 KB** | — | — |

**Key Finding**: `three-DsjB4ozX.js` (526 KB uncompressed / 131 KB gzip) is loaded unconditionally on initial startup via `<link rel="modulepreload">` solely because `Fintech3DOrb.jsx` is statically imported by `App.jsx`.

---

## 2. Initial API Network Requests (Initial Dashboard Mount)

When the user opens the application (landing on default `dashboard` tab), the following requests are triggered:

| # | Endpoint | Initiating Component / Hook | Status on Dashboard | Bottleneck Classification |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `GET /api/profile` | `AuthGate.jsx` | Critical | Required to establish profile |
| 2 | `GET /api/profile` | `App.jsx` (`fetchProfile`) | **DUPLICATE** | Redundant fetch (AuthGate already holds profile) |
| 3 | `GET /api/holdings` | `App.jsx` (`fetchHoldings`) | **OFF-SCREEN** | Only used on `profile` tab table |
| 4 | `GET /api/assets` | `App.jsx` (`useEffect`) | **OFF-SCREEN** | Only used on `assets` tab and inside modals |
| 5 | `GET /api/news` | `App.jsx` (`fetchNews`) | Needed | Rendered in `MarketNewsPreview` on Dashboard |
| 6 | `GET /api/news/personalized` | `App.jsx` (`fetchPersonalizedNews`) | **OFF-SCREEN** | Only used on `news` tab |
| 7 | `GET /api/portfolio/snapshot` | `App.jsx` (`fetchPortfolio`) | Needed | Rendered in Dashboard portfolio card |
| 8 | `GET /api/transactions` | `App.jsx` (`fetchTransactions`) | **OFF-SCREEN** | Only used on `portfolio` tab |
| 9 | `GET /api/cash/overview` | `App.jsx` (`fetchCashOverview`) | **OFF-SCREEN** | Only used on `portfolio` tab |
| 10 | `GET /api/cash/ledger` | `App.jsx` (`fetchCashLedger`) | **OFF-SCREEN** | Only used on `portfolio` tab |
| 11 | `GET /api/watchlist` | `App.jsx` (`fetchWatchlist`) | Needed | Rendered in Dashboard watchlist card |
| 12 | `GET /api/regime/vietnam` | `VietnamRegimePanel.jsx` | Needed | Rendered on Dashboard |
| 13-17 | `GET /api/market/:symbol` (5x) | `MarketTicker.jsx` | Needed | 5 concurrent requests for FPT, VCB, HPG, VNM, E1VFVN30 |
| 18+ | `GET /api/market/:symbol` | `App.jsx` (`fetchWatchlistMarketData`) | Needed | Triggered for each item in watchlist |

**Total Startup API Calls**: 17+ HTTP requests concurrently dispatched on initial load.  
**Avoidable Startup Calls**: 6 calls (`/api/profile` duplicate, `/api/holdings`, `/api/assets`, `/api/news/personalized`, `/api/transactions`, `/api/cash/overview`, `/api/cash/ledger`).

---

## 3. Backend Startup & Warm Latency Baseline

### Process Boot Time (Node.js Server)
- **Module Import Duration**: ~199.9 ms
- **App Factory (`createApp`)**: ~0.3 ms
- **Server Listen (`server.listen`)**: ~10.6 ms
- **Total Local Startup**: ~210.8 ms

### Warm API Latency (Render Production)
- `/api/health`: 291.2 ms
- `/api/db-health`: 619.9 ms (Supabase ping)

### Platform Cold-Start Behavior (Render Free/Starter Tier)
- If the Render backend has been idle for $>15$ minutes, the container spins down to 0 instances.
- Initial waking request can encounter 30–50s platform spin-up latency before HTTP responses begin.
- Application-level optimization cannot eliminate platform-level spin-up, but must render the UI shell and graceful loading skeletons immediately rather than appearing frozen.

---

## 4. Frontend Code Splitting Baseline

- **Route / Feature Lazy Loading**: Currently **NONE**.
- All tabs and modals are statically imported in `App.jsx`:
  - `TransactionModal` (74.4 KB)
  - `AssetComparisonSection` (37.8 KB)
  - `AssetAnalysisSection` (35.7 KB)
  - `OpeningPositionModal` (27.9 KB)
  - `InvestmentBriefPanel` (26.9 KB)
  - `PortfolioPerformanceSection` (23.8 KB)
  - `AlertCenterSection` (22.6 KB)
  - `TransactionHistorySection` (22.2 KB)
  - `OpportunitySection` (12.7 KB)
  - `PriceAlertModal` (12.6 KB)
  - `PortfolioSummaryHoldings` (12.2 KB)
  - `CashMovementModal` (11.7 KB)
  - `PortfolioCompositionSection` (11.3 KB)
  - `Fintech3DOrb` (10.1 KB + Three.js 526 KB)
  - `PriceHistoryChart` (10.0 KB)
  - `EquityFundamentalsSection` (7.1 KB)
  - `PortfolioActivitySection` (6.3 KB)

