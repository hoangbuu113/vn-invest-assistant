# Project Overview: Vietnam Personal Investment Assistant

## 1. Purpose
A personal investment analysis application designed for learning full-stack and vibe coding while serving as a practical, real-life tool for tracking and analyzing investment opportunities in Vietnam and across priority global asset classes.

## 2. Target User
- Single user — personal use only.

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

## 6. Core Product Goals
- Ingest and normalize market data across priority asset classes.
- Provide deterministic quantitative analysis, trends, and comparisons.
- Track personal holdings, immutable transaction history, and auditable cash flows.
- Monitor price alerts and relevant market news deterministically.
- Maintain transparent data integrity (never fabricate missing prices, timestamps, or FX rates).

## 7. Non-Goals
- Does **NOT** execute trades or place broker orders.
- Does **NOT** connect to brokerage APIs for trade execution.
- Does **NOT** automatically invest money or manage funds autonomously.

## 8. Analysis & AI Principles
- Quantitative metrics, valuations, and rankings are strictly deterministic facts derived from data, rules, or quantitative formulas.
- Large Language Models (LLMs) must **NOT** invent financial numbers, valuations, or scores from intuition alone.
- AI is strictly used to interpret, summarize, and explain evidence and context transparently.
