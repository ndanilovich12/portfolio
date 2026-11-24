# Nate Danilovich · portfolio

Live site: https://smallmarketsoftwares.netlify.app

| Page | What it is |
|---|---|
| `/` | Home. NOCO Payback and a live Bull Run card side by side, Agent Studio, experience, contact. |
| `/lab` | **Bull Run.** Real daily prices for large US stocks (any ticker can be added), trend and risk stats, a year-ahead simulation, a portfolio backtest and a CSV business analyzer. The Outlook card turns real data into small calls you can track: simulation odds, trend, analyst ratings, price targets and earnings history. |
| `/agents` | **Agent Studio.** Describe a job in a few answers and it designs an AI agent team: roles, handoffs, checks and every agent's instructions. Export it, or run it live with Claude, one visible call per agent. |
| `/noco-payback` | **NOCO Payback.** The UB AI for Good prototype: customer app and staff console on one calculation engine. |

## How it's built

Plain HTML, CSS and JavaScript. No framework, no chart library, no build step.

- `lab-core.js`: the statistics, forecast simulation and charts, shared by every page
- `tech-data.js`: saved daily closes (Yahoo Finance) so the pages work offline; the hosted site refreshes them
- `netlify/functions/street.mjs`: `/api/street`, Wall Street data from Finnhub (and price targets from Financial Modeling Prep if a key is set)
- `netlify/functions/agent.mjs`: `/api/agent`, runs one agent step on Claude, with per-visitor and daily caps
- `netlify.toml`: functions, the Yahoo Finance price proxy, and the old `/relay` link redirecting to `/agents`

## Settings (Netlify → Site configuration → Environment variables)

| Variable | Needed for |
|---|---|
| `FINNHUB_KEY` | Analyst ratings, earnings, key numbers and headlines in Bull Run |
| `FMP_KEY` (optional) | Analyst price targets |
| `ANTHROPIC_API_KEY` | Live runs in Agent Studio |
| `ANTHROPIC_MODEL` (optional) | Defaults to `claude-haiku-4-5` |
| `AGENT_DAILY_CAP` / `AGENT_VISITOR_CAP` (optional) | Model calls per day for the whole site (default 300) and per visitor (default 24) |

Without the keys, every page still works: Bull Run uses prices and its own statistics, and Agent Studio designs and exports teams.

Statistics and simulations only. Nothing here is investment advice.
