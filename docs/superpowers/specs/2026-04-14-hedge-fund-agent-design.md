# Meridian Capital — AI Hedge Fund Agent System
**Date:** 2026-04-14  
**Status:** Approved

---

## Context

The user wants an autonomous AI hedge fund that uses real money via the Alpaca brokerage API to research, decide, and execute stock trades with the goal of generating profit. Six specialized AI agents (powered by Claude) each work independently at their "desks" and convene in a conference room where a Portfolio Manager agent makes final decisions. A full web dashboard visualizes the office in real time. Three operating modes (Simulation, Paper, Live) allow safe testing before risking real capital. All trades are gated behind hard safety controls and a kill switch.

---

## Architecture

**Stack:** Next.js 14 (App Router) + shadcn/ui + Tailwind CSS  
**AI:** Anthropic Claude API (`claude-sonnet-4-6`) — one instance per agent  
**Brokerage:** Alpaca Markets API (paper + live)  
**Market Data:** Yahoo Finance (yfinance via API route), Alpha Vantage (free tier)  
**Persistence:** SQLite via `better-sqlite3` — trade log, agent memory, performance history  
**Real-time:** Server-Sent Events (SSE) — streams agent activity to dashboard  
**Self-learning:** Per-agent memory table; outcomes written after trade close; injected into agent system prompts  

---

## Agent Roster

| ID | Name | Role | Responsibility |
|----|------|------|---------------|
| `pm` | Morgan | Portfolio Manager | Reads all agent reports, makes final BUY/SELL/PASS/HOLD decisions, sets position sizes |
| `researcher` | Alex | Research Analyst | SEC filings, earnings reports, news sentiment, competitive analysis |
| `quant` | Sam | Quant Analyst | RSI, MACD, Bollinger Bands, Monte Carlo simulations, entry/exit signals |
| `risk` | Drew | Risk Manager | VaR, max drawdown, position sizing, stop-loss levels, portfolio exposure |
| `macro` | Jordan | Macro Strategist | Interest rates, sector rotation, macro headwinds, Fed policy, earnings calendar |
| `trader` | Riley | Trader | Formats and executes approved orders via Alpaca API, monitors fills |

Each agent runs on an independent loop. They do not communicate with each other directly — they write reports that the PM reads. Agents only interact in the conference room (meeting mode).

---

## Operating Modes

### 1. Simulation Mode
- Uses historical OHLCV data (Yahoo Finance)
- User selects a date range and starting capital
- Agents trade as if it were live — they do not know it is historical data
- Outcomes recorded and compared to reality
- **Accuracy score** tracked per agent per trade
- No Alpaca account required

### 2. Paper Trading Mode
- Connects to Alpaca paper trading account
- Real live market prices, zero real money
- Full end-to-end test of the live pipeline
- Agents run on real market hours schedule

### 3. Live Trading Mode
- Connects to Alpaca live account
- Real money, real trades
- All safety controls enforced (see below)
- Requires explicit user activation toggle — off by default
- UI shows a persistent red "LIVE" banner when active

---

## Dashboard UI

### Main View — The Office Floor
Two-panel layout:

**Left panel — Research Floor**
- Four agent desk cards: Researcher, Quant, Risk, Macro
- Each card shows: agent name, current task description, latest finding (streaming)
- Status dot: green (active), yellow (thinking), grey (idle)
- Click any desk → opens a full-screen agent workscreen showing their full reasoning log

**Right panel — Conference Room**
- PM (Morgan) card always visible with current thesis and budget
- Progress indicators per agent (% complete on current analysis)
- "Call Meeting" button — triggers all agents to submit final reports to PM
- PM reasons through reports and announces decision
- Decision log (BUY/SELL/PASS history with reasoning)

### Agent Workscreen (on desk click)
- Full scrollable thought stream for that agent
- Current task, tools used, findings, confidence level
- Past performance stats for that agent

### Portfolio Dashboard (top bar)
- Total budget, deployed capital, available cash
- Open positions with unrealized P&L
- Today's P&L, all-time P&L
- Kill switch button

---

## Hedge Fund Workflow

### Research Cycle (runs continuously)
1. Agents independently scan their domains (news, technicals, risk, macro)
2. Each agent maintains a watchlist of 5–10 candidate stocks
3. Agents write structured reports to the database every 5 minutes

### Investment Committee (triggered when agent flags a strong opportunity)
1. Researcher or Quant flags a stock with conviction level ≥ 7/10
2. PM calls a meeting — all agents submit a report on that specific stock
3. Reports cover: thesis, risks, entry price, target price, stop loss, position size suggestion
4. PM reads all reports and issues a decision:
   - **BUY** — approves purchase, specifies size
   - **PASS** — declines with reasoning
   - **HOLD** — already own it, maintain position
   - **SELL** — exit existing position
5. If BUY/SELL: Riley (Trader) executes via Alpaca API
6. Outcome tracked in DB; agents' memory updated when trade closes

### Exit Logic
- Target price hit → Trader proposes SELL → PM approves
- Stop loss hit → automatic SELL (no PM gate, safety override)
- Macro strategist flags deteriorating conditions → PM calls emergency meeting

---

## Safety Controls

| Control | Default | Description |
|---------|---------|-------------|
| Budget cap | User-set | Agents can never deploy more than the configured budget |
| Max position size | 15% | No single stock > 15% of total portfolio |
| Daily loss limit | 5% | Kill switch fires if portfolio drops ≥ 5% in one trading day |
| Stop loss | 8% | Hard stop on every position, no exceptions |
| PM approval gate | Always on | Every trade requires PM decision — no agent can trade directly |
| Live mode guard | Off by default | User must explicitly toggle Live mode; Paper is the default |
| Kill switch | Dashboard button | Cancels all open orders, halts all agent loops immediately |

---

## Self-Learning System

**Per-agent memory (SQLite table: `agent_memory`):**
- `agent_id`, `stock`, `prediction`, `actual_outcome`, `p_and_l`, `timestamp`, `lesson`
- After each closed trade, a Claude call generates a `lesson` string: what the agent got right/wrong and what to watch for next time
- Lessons injected into agent system prompt as: "Past lessons from your trade history: ..."

**PM accuracy weighting:**
- PM tracks each agent's prediction accuracy over the last 30 trades
- Lower-accuracy agents' reports are weighted less in the PM's reasoning
- Accuracy score shown on each agent desk card

---

## Data Sources

| Source | Usage | Cost |
|--------|-------|------|
| Yahoo Finance (yfinance) | OHLCV, earnings, fundamentals | Free |
| Alpha Vantage | News sentiment, technical indicators | Free tier (25 req/day) |
| Alpaca Market Data | Real-time quotes, order book | Free with Alpaca account |
| SEC EDGAR | 10-K, 10-Q filings | Free |

---

## File Structure

```
/app
  /page.tsx                  — office dashboard (main view)
  /api
    /agents/route.ts          — agent orchestration engine
    /alpaca/route.ts          — brokerage API wrapper
    /market-data/route.ts     — data fetching (yfinance, alpha vantage)
    /stream/route.ts          — SSE stream for real-time agent activity
  /conference/page.tsx        — conference room view
  /portfolio/page.tsx         — positions and P&L

/lib
  /agents
    /pm.ts                    — Portfolio Manager agent
    /researcher.ts            — Research Analyst agent
    /quant.ts                 — Quant Analyst agent
    /risk.ts                  — Risk Manager agent
    /macro.ts                 — Macro Strategist agent
    /trader.ts                — Trader agent
    /base-agent.ts            — shared agent interface and memory injection
  /alpaca.ts                  — Alpaca SDK wrapper
  /db.ts                      — SQLite setup and queries
  /safety.ts                  — kill switch, daily loss monitor, position limits
  /simulation.ts              — historical replay engine

/components
  /office
    /AgentDesk.tsx            — individual desk card
    /ConferenceRoom.tsx        — conference room with PM
    /AgentWorkscreen.tsx       — full workscreen modal
    /KillSwitch.tsx            — emergency halt button
  /portfolio
    /PositionsTable.tsx
    /PnLChart.tsx
  /ModeToggle.tsx              — Simulation / Paper / Live selector
```

---

## Verification Plan

1. **Simulation mode**: Run a 30-day historical simulation on AAPL, MSFT, NVDA with $10,000. Verify agents produce reports, PM makes decisions, trades are logged with outcomes.
2. **Accuracy tracking**: After simulation completes, check that accuracy scores are calculated per agent and injected into next session's prompts.
3. **Paper trading**: Connect Alpaca paper account, run for one trading session, verify orders appear in Alpaca dashboard.
4. **Safety controls**: Manually trigger daily loss limit (mock a 5% drop in DB), verify kill switch fires and halts all agents.
5. **Live mode guard**: Verify Live toggle requires confirmation dialog and that Paper is the default on fresh start.
6. **Self-learning**: Close a simulated trade at a loss, verify a `lesson` is generated and appears in that agent's next system prompt.
