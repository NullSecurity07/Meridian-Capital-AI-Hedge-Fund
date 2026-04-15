# Meridian Capital — AI Hedge Fund

An autonomous multi-agent trading system powered by free LLMs (Groq / Ollama). Six AI agents research, debate, and execute trades against a real brokerage (Alpaca paper trading) while a live dashboard lets you watch every decision unfold in real time.

> **Default mode:** Paper trading with Alpaca. No real money moves unless you explicitly set `TRADING_MODE=live`.

---

## How it works

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MERIDIAN CAPITAL                             │
│                                                                     │
│   Watchlist (32 symbols across 7 sectors + inverse ETFs)           │
│   NVDA  AAPL  MSFT  GOOGL  AMZN  META  TSLA  AMD  CRM  NFLX ...   │
│   JPM   GS    LLY   UNH    XOM   CVX   CAT   WMT  COST  SH  PSQ   │
│                            │                                        │
│                  every 15 minutes                                   │
│                            ▼                                        │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │                   ANALYSIS PIPELINE                         │  │
│   │                                                             │  │
│   │  1. ALEX (Researcher) ──► news, fundamentals, earnings      │  │
│   │       │  conviction < 5 → SKIP (saves API calls)           │  │
│   │       ▼                                                     │  │
│   │  2. SAM (Quant)  ──────► RSI, support/resistance, OHLCV    │  │
│   │       ▼                                                     │  │
│   │  3. JORDAN (Macro) ────► Fed policy, sector rotation,      │  │
│   │       │                  market cycle, risk-on/off          │  │
│   │       ▼                                                     │  │
│   │  4. DREW (Risk) ───────► position sizing, stop-loss,        │  │
│   │       │  veto = true → BLOCK TRADE                         │  │
│   │       ▼                                                     │  │
│   │  5. MORGAN (PM) ───────► reads all 4 reports, decides      │  │
│   │       │                  BUY / SELL / HOLD / PASS           │  │
│   │       ▼                                                     │  │
│   │  6. RILEY (Trader) ────► executes via Alpaca API            │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                            │                                        │
│                            ▼                                        │
│              SQLite DB  ◄──────►  Next.js Dashboard                │
│              (trades, positions,   (SSE real-time stream)           │
│               memory, reports)                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## The Agents

| Agent | Name | Role | What they actually do |
|---|---|---|---|
| `researcher` | Alex | Research Analyst | Pulls live news via Alpha Vantage, reads P/E, market cap, earnings date. Sets conviction 1–10. If conviction < 5 the whole pipeline short-circuits — saves API calls. |
| `quant` | Sam | Quant Analyst | Fetches 90 days of OHLCV bars from Yahoo Finance, computes RSI(14), 20-day support/resistance. Gives a technical signal. |
| `macro` | Jordan | Macro Strategist | Reads broad market news (SPY) + the stock's news. Classifies market cycle (early-bull → late-bear), rate sensitivity, and whether now is a good entry. |
| `risk` | Drew | Risk Manager | Hard-limits position size vs portfolio. Can issue a **veto** — which the PM cannot override, no matter what. |
| `pm` | Morgan | Portfolio Manager | Reads all four reports and makes the final BUY / SELL / HOLD / PASS call. Aware of inverse ETFs (SH/PSQ) for hedging in bear cycles. |
| `trader` | Riley | Trader | Submits market orders to Alpaca. Enforces a 24-hour minimum hold time to prevent noise trading. Writes a lesson to agent memory after every closed position. |

---

## Self-learning feedback loop

Every time a position closes with a SELL, the actual P&L is computed and written back as a lesson for both the researcher and PM:

```
Trade closes (SELL)
        │
        ▼
  Was it profitable?
   YES ──► "NVDA: bought $850, sold $920, gained +8.2%. Thesis worked — look for similar setups."
   NO  ──► "NVDA: bought $850, sold $780, lost -8.2%. Avoid similar conditions or tighten stop loss."
        │
        ▼
  Stored in agent_memory table (SQLite)
        │
        ▼
  Next time Alex or Morgan analyze NVDA:
  their system prompt includes the last 5 lessons → they adapt
```

---

## Safety system

Four independent layers prevent catastrophic loss:

```
┌──────────────────────────────────────────────────────┐
│                   SAFETY LAYERS                      │
│                                                      │
│  1. POSITION LIMIT  ──  max 15% of portfolio        │
│     per single position. Hard block in trader.ts.   │
│                                                      │
│  2. BUDGET LIMIT  ────  cannot spend more cash      │
│     than currently available. Hard block.            │
│                                                      │
│  3. STOP LOSS  ───────  8% below entry price.       │
│     Checked every cycle on all open positions.      │
│     Emergency sell bypasses kill switch.            │
│                                                      │
│  4. DAILY LOSS LIMIT  ─  5% loss vs start of day.  │
│     Triggers kill switch. All trading halts.        │
│     Only manual deactivation restores trading.      │
│                                                      │
│  5. KILL SWITCH  ─────  manual override button      │
│     on the dashboard. Instant halt. Persists        │
│     across hot-reloads (pinned to globalThis).      │
└──────────────────────────────────────────────────────┘
```

All limits apply to **paper and live** modes equally. The only way real money moves is `TRADING_MODE=live` + a live Alpaca key — paper keys physically cannot touch real accounts.

---

## Beating the S&P 500

The watchlist is deliberately diversified across sectors so the system can find alpha where the index is weak:

```
TECH (your index exposure)     HEDGE (when market turns)
NVDA  AAPL  MSFT               SH  ──  inverse S&P 500
GOOGL AMZN  META               PSQ ──  inverse NASDAQ
TSLA  AMD   CRM  NFLX
                                DEFENSIVE (low tech correlation)
FINANCIALS                     LLY  UNH  JNJ  ABBV  (healthcare)
JPM  GS  V  MA                 WMT  COST  PG         (consumer)

ENERGY (inflation hedge)       INDUSTRIALS (late-cycle)
XOM  CVX  COP                  CAT  HON  LMT
```

When Jordan (Macro) detects a bear cycle, Morgan is instructed to BUY `SH` or `PSQ` — this means the fund profits from a market decline rather than just sitting in cash.

---

## Dashboard

```
┌──────────────────────────────────────────────────────────────────┐
│  MERIDIAN CAPITAL  ●  PAPER TRADING          [▶ START] [■ STOP] │
│  Quick: [NVDA] [AAPL] [MSFT] [GOOGL] [AMZN]                    │
├────────────────────────────┬─────────────────────────────────────┤
│    TRADING FLOOR           │         CONFERENCE ROOM             │
│                            │                                     │
│  🧑‍💻 Alex    📊 Sam       │    🧠 Morgan                        │
│  [●] Active [○] Idle      │    Meeting: NVDA                    │
│                            │    ┌─────────────────────────────┐  │
│  🌍 Jordan  ⚠️  Drew       │    │ Alex:  BUY  (conviction 8)  │  │
│  [●] Active [●] Active    │    │ Sam:   BUY  (RSI 42)        │  │
│                            │    │ Jordan:HOLD (late-bull)     │  │
│  💹 Riley                  │    │ Drew:  BUY  (no veto)       │  │
│  [●] Executing             │    └─────────────────────────────┘  │
├────────────────────────────┼─────────────────────────────────────┤
│    PORTFOLIO               │         SAFETY                      │
│                            │                                     │
│  Value:   $10,842          │  Kill Switch  [OFF] ← click to halt│
│  Cash:    $6,210           │                                     │
│  P&L:     +$842  (+8.4%)   │  Daily Loss   ████░░░░  2.1% / 5% │
│                            │                                     │
│  NVDA  5 shares  +$312     │  Position Max    15%               │
│  LLY   2 shares  +$198     │  Stop Loss        8%               │
├────────────────────────────┼─────────────────────────────────────┤
│    BENCHMARKS              │         ACTIVITY FEED               │
│                            │                                     │
│  Portfolio  +8.4%  ████    │  14:32  Riley: BUY 5x NVDA $846   │
│  S&P 500    +3.1%  ██      │  14:31  Morgan: Decision — BUY     │
│  NASDAQ     +4.2%  ██      │  14:30  Drew: No veto. Risk low.   │
│  Nifty 50   +1.8%  █       │  14:29  Sam: RSI 42, uptrend      │
│  Sensex     +2.1%  █       │  14:28  Alex: Strong thesis (8/10) │
└────────────────────────────┴─────────────────────────────────────┘
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| AI / LLM | Groq free tier (`llama-3.3-70b-versatile`) or Ollama local |
| Database | SQLite via `better-sqlite3` |
| Real-time UI | Server-Sent Events (SSE) |
| Brokerage | Alpaca (paper & live) |
| Market data | Yahoo Finance (free, no key) + Alpha Vantage (optional) |
| Tests | Vitest — 68 tests across 13 files |

---

## Setup

### Prerequisites
- Node.js 20+
- A free [Groq](https://console.groq.com) account (no credit card)
- A free [Alpaca](https://alpaca.markets) paper trading account (no credit card)

### 1. Clone and install

```bash
git clone https://github.com/your-username/meridian-capital
cd meridian-capital
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
GROQ_API_KEY=gsk_...          # from console.groq.com
ALPACA_PAPER_KEY=PK...        # from alpaca.markets → Paper Account
ALPACA_PAPER_SECRET=...
ALPHA_VANTAGE_KEY=            # optional — leave blank to skip news
TRADING_MODE=paper
```

### 3. Run

```bash
npm run dev        # development (with hot reload)
npm run build && npm start   # production
```

Open [http://localhost:3000](http://localhost:3000)

### 4. Run tests

```bash
npm test
```

---

## Deploy to Replit (free, no credit card)

### Step 1 — Push to GitHub

```bash
git add .
git commit -m "initial commit"
git push
```

### Step 2 — Import on Replit

1. Go to [replit.com](https://replit.com) → sign in with GitHub (no card needed)
2. **Create Repl** → **Import from GitHub** → paste your repo URL
3. Replit detects the `.replit` config automatically

### Step 3 — Add Secrets

In the Replit sidebar, click the **lock icon (Secrets)** and add:

| Key | Value |
|---|---|
| `GROQ_API_KEY` | your Groq API key |
| `ALPACA_PAPER_KEY` | your Alpaca paper key |
| `ALPACA_PAPER_SECRET` | your Alpaca paper secret |
| `ALPHA_VANTAGE_KEY` | your Alpha Vantage key (optional) |
| `TRADING_MODE` | `paper` |

### Step 4 — Click Run

First launch takes ~3 minutes (compiles `better-sqlite3`, builds Next.js). Every restart after that takes ~10 seconds.

### Step 5 — Keep it awake with UptimeRobot

Replit's free tier sleeps after ~1 hour of inactivity. Fix it for free:

1. Create a free account at [uptimerobot.com](https://uptimerobot.com) (no card)
2. **Add New Monitor** → HTTP(s)
3. URL: `https://your-repl-name.your-username.repl.co/api/ping`
4. Interval: **every 5 minutes**

The `/api/ping` endpoint returns:
```json
{ "status": "ok", "orchestrator": "running", "ts": 1744123456789 }
```

---

## Configuration reference

All configured via `lib/orchestrator-singleton.ts` or at runtime via the dashboard:

| Parameter | Default | Description |
|---|---|---|
| `budget` | `$10,000` | Starting capital |
| `maxPositionPct` | `15%` | Max % of portfolio in one position |
| `dailyLossLimitPct` | `5%` | Daily drawdown before kill switch fires |
| `stopLossPct` | `8%` | Per-position stop loss below entry |
| `intervalMs` | `15 min` | Time between symbol analyses |
| `watchlist` | 32 symbols | Symbols to analyze (edit the array to customize) |
| `TRADING_MODE` | `paper` | `simulation` \| `paper` \| `live` |

### Trading modes

| Mode | What happens |
|---|---|
| `simulation` | Fake orders, fake fills, portfolio tracked in SQLite only |
| `paper` | Real orders on Alpaca paper account (fake money, real market prices) |
| `live` | Real orders with real money — requires `ALPACA_LIVE_KEY` |

---

## API routes

| Route | Method | Description |
|---|---|---|
| `/api/stream` | GET | SSE stream — real-time agent events |
| `/api/portfolio` | GET | Current portfolio value, positions, trades |
| `/api/trading/analyze` | POST `{ symbol }` | Trigger immediate analysis of one symbol |
| `/api/safety` | GET | Kill switch state, loss limits |
| `/api/safety` | POST `{ action: "activate"\|"deactivate" }` | Toggle kill switch |
| `/api/benchmarks` | GET | S&P 500, NASDAQ, Nifty 50, Sensex returns vs portfolio |
| `/api/benchmarks` | POST | Force-refresh benchmark prices |
| `/api/agents` | GET | Agent list with accuracy scores |
| `/api/ping` | GET | Keep-alive endpoint (for UptimeRobot) |

---

## Project structure

```
meridian-capital/
├── app/
│   ├── page.tsx                  # RPG-style dashboard (client component)
│   └── api/
│       ├── stream/               # SSE broadcaster
│       ├── portfolio/            # Portfolio + positions
│       ├── trading/analyze/      # On-demand symbol analysis
│       ├── safety/               # Kill switch control
│       ├── benchmarks/           # Index comparison
│       ├── agents/               # Agent list + accuracy
│       └── ping/                 # UptimeRobot keep-alive
├── lib/
│   ├── agents/
│   │   ├── base-agent.ts         # LLM client (Groq / Ollama)
│   │   ├── researcher.ts         # Alex — fundamentals + news
│   │   ├── quant.ts              # Sam — RSI, technicals
│   │   ├── macro.ts              # Jordan — macro environment
│   │   ├── risk.ts               # Drew — position limits + veto
│   │   ├── pm.ts                 # Morgan — final decision
│   │   ├── trader.ts             # Riley — execution + memory
│   │   └── orchestrator.ts       # Pipeline + stop-loss loop
│   ├── db.ts                     # All SQLite queries
│   ├── db-singleton.ts           # Single DB connection
│   ├── market-data.ts            # Yahoo Finance + Alpha Vantage
│   ├── benchmarks.ts             # Index price tracking
│   ├── safety.ts                 # Kill switch + limit checks
│   ├── sse.ts                    # Real-time event broadcaster
│   └── orchestrator-singleton.ts # Config + watchlist
├── types/index.ts                # All TypeScript interfaces
├── tests/                        # 68 Vitest tests
├── .replit                       # Replit run config
└── replit.nix                    # Nix deps (Node 20 + build tools)
```

---

## License

MIT
