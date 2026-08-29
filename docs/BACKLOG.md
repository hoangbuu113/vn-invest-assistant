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

- **Multicurrency Transaction Accounting**:
  - `UNKNOWN`: Database schema, acquisition-time FX storage, and realized/unrealized P/L calculation engine for non-VND asset trading.
- **Multicurrency Cash**:
  - `UNKNOWN`: Multi-currency cash account architecture and cash ledger conversion tracking.
- **Foreign Exchange History**:
  - `UNKNOWN`: USD/VND historical daily bar timezone alignment and provider selection for FX historical time series.
- **Funds**:
  - `UNKNOWN`: Open-ended mutual fund NAV strike mechanics, provider onboarding, and subscription/redemption flows (deferred beyond priority ETF foundation).
- **Provider Redundancy**:
  - `UNKNOWN`: Provider failover orchestration and multi-source redundancy policy.
