# QuantEdge — Stock Analysis Platform

A complete, fully functional web application for professional stock market analysis and AI-powered reporting.

## Features

- **Authentication** — Simple login/registration with localStorage (max 2 analyst accounts)
- **Dashboard** — Watchlist with live quotes via Yahoo Finance, interactive price charts, FRED macro indicators
- **Stock Analysis** — One-click AI analysis combining price data, fundamentals, news, congressional trades, and insider activity
- **AI Report** — Structured report: Business Overview, Key Metrics, Macro Context, Sentiment, Red Flags, Bull/Bear Case, Analyst Score /10
- **Reports** — Save, annotate, and export reports as PDF (jsPDF)
- **Settings** — Manage API keys, toggle AI backend (Groq free / OpenAI)

## Quick Start

1. Clone or download this repo
2. Open `index.html` in your browser (or deploy to Netlify/GitHub Pages)
3. Register an account
4. Go to **Settings** and add your API keys
5. Start analyzing!

## API Keys Needed

| Service | Purpose | Cost | Get it at |
|---------|---------|------|----------|
| **Groq** | AI inference (LLaMA 3) | Free | https://console.groq.com |
| **FRED** | Macro indicators | Free | https://fred.stlouisfed.org/docs/api/api_key.html |
| **Alpha Vantage** | Stock fundamentals | Free (25/day) | https://www.alphavantage.co/support/#api-key |
| **NewsAPI** | Financial headlines | Free (100/day) | https://newsapi.org/register |
| **Quiver Quantitative** | Congressional & insider trades | Free tier | https://www.quiverquant.com/signup |
| **OpenAI** (optional) | GPT-4o-mini fallback | Paid | https://platform.openai.com |

## Architecture

- `index.html` — Full app layout and UI
- `style.css` — Custom styles on top of TailwindCSS CDN
- `app.js` — All logic: auth, API calls, chart rendering, AI, PDF export

No build step, no npm, no frameworks. Pure HTML + CSS + Vanilla JS.

## Deployment

Drag the 3 files to [Netlify Drop](https://app.netlify.com/drop) or push to GitHub and enable GitHub Pages.

## Tech Stack

- TailwindCSS (CDN)
- Chart.js (CDN)
- jsPDF (CDN)
- Yahoo Finance via allorigins CORS proxy
- FRED API
- Groq API (LLaMA 3 — free)
- Alpha Vantage / NewsAPI / Quiver Quant
