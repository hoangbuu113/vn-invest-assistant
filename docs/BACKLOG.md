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

- **Gold**:
  - `UNKNOWN`: Exact instrument and price reference source (e.g., domestic SJC/PNJ physical gold in VND/lượng vs international spot XAU/USD).
- **Funds**:
  - `UNKNOWN`: Specific handling differences between exchange-traded ETFs (continuous intraday pricing) vs open-ended mutual funds (periodic NAV pricing).
- **Crypto**:
  - `UNKNOWN`: Market data provider selection for crypto assets.
  - `UNKNOWN`: Exact selection and maintenance methodology for the Top ~40 crypto assets.
  - `UNKNOWN`: Inclusion vs exclusion rules for USD-pegged stablecoins (e.g., USDT, USDC).
- **FX & Cross-Currency Valuation**:
  - `UNKNOWN`: Primary FX rate provider and fallback mechanism for non-VND asset conversion.
