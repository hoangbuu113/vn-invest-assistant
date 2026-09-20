# Project Overview: VN Invest Assistant

## 1. Purpose
A public multi-user, Vietnam-focused multi-asset market intelligence and tracking application. Its primary focus is market intelligence, monitoring, multi-source news, macroeconomic context, price alerts, watchlists, cross-asset context, and evidence-bounded AI synthesis for Vietnam and priority global asset classes.

Portfolio is a personal multi-asset tracking capability that supports this broader market-intelligence product. Its purpose is to help each user know what they own, understand accounting P/L and portfolio performance, and understand the quality, coverage, and freshness of the data behind those values.

## 2. Target User & Architecture
- Public multi-user platform with Supabase authentication and strictly isolated per-profile data.

## 3. Approved Tech Stack
- **Frontend**: React + Vite + JavaScript
- **Backend**: Node.js + Express
- **Database & Persistence**: Supabase PostgreSQL

## 4. Priority Supported Asset Direction
1. **Vietnamese stocks**
2. **ETFs / funds**
3. **Gold**
4. **USD / FX** (initially USD/VND)
5. **Crypto** (~Top 40 major/liquid assets)

### Later / Deferred Asset Classes
- Deeper bank-deposit modeling
- Deeper bond modeling

## 5. Reporting Currency
- **VND** (all portfolio valuations and summaries normalize to Vietnamese Đồng; native quote currencies are preserved and converted via explicit FX rates).

### Portfolio V1 Scope
- Long-only assets plus cash.
- Holdings, cash movements, opening positions, and immutable BUY/SELL records are tracked per authenticated profile.
- Margin, short selling, derivatives, leverage, broker execution, and broker custody synchronization are not supported unless a later governed scope explicitly adds them.

## 6. Core Product Goals
- **Primary**: Deliver public market intelligence, macroeconomic regime tracking, multi-asset context, multi-source news, watchlists, price alerts, and future AI synthesis.
- **Supporting**: Track personal holdings, immutable transaction history, and auditable cash flows within isolated user profiles, with truthful valuation and freshness states.
- Accumulate append-only daily Portfolio valuation evidence from the first legitimate capture forward so performance can develop without fabricated historical prices, FX, or cash flows.
- Provide deterministic quantitative analysis, trends, and comparisons across Vietnam equities, crypto, gold, and FX.
- Maintain transparent data integrity (never fabricate missing prices, timestamps, or FX rates; missing is never zero).

## 7. Non-Goals
- Does **NOT** execute trades or place broker orders.
- Does **NOT** connect to brokerage APIs for trade execution.
- Does **NOT** automatically invest money or manage funds autonomously.

## 8. Analysis & AI Principles
- Quantitative metrics, valuations, and rankings are strictly deterministic facts derived from data, rules, or quantitative formulas.
- Large Language Models (LLMs) must **NOT** invent financial numbers, valuations, or scores from intuition alone.
- AI is strictly used to interpret, summarize, and explain evidence and context transparently.
