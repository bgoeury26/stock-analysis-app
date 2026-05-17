/* ============================================================
   QuantEdge — app.js
   Vanilla JS, no build step required
   ============================================================ */

'use strict';

// ─── CONSTANTS ──────────────────────────────────────────────
const MAX_USERS = 2;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes in ms
const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN'];

const FRED_SERIES = {
  'GDP Growth':    'A191RL1Q225SBEA',
  'Inflation':     'CPIAUCSL',
  'Unemployment':  'UNRATE',
  'Interest Rate': 'FEDFUNDS'
};

// ─── STATE ──────────────────────────────────────────────────
let currentUser = null;
let watchlist   = [];
let priceChart  = null;
let currentChartTicker  = null;
let currentChartPeriod  = '3mo';
let currentReportData   = null;

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSession();
  loadSettingsToForm();
});

function loadSession() {
  const session = lsGet('qe_session');
  if (session) {
    currentUser = session;
    showApp();
  }
}

// ─── AUTH ────────────────────────────────────────────────────
function toggleAuth() {
  const lf = document.getElementById('loginForm');
  const rf = document.getElementById('registerForm');
  lf.classList.toggle('hidden');
  rf.classList.toggle('hidden');
}

function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const pass  = document.getElementById('loginPassword').value;
  const users = lsGet('qe_users') || [];
  const user  = users.find(u => u.email === email && u.password === btoa(pass));
  if (!user) { showAuthError('loginError', 'Invalid email or password.'); return; }
  currentUser = { email: user.email, name: user.name };
  lsSet('qe_session', currentUser);
  showApp();
}

function handleRegister() {
  const name  = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const pass  = document.getElementById('regPassword').value;
  if (!name || !email || !pass) { showAuthError('regError', 'All fields required.'); return; }
  if (pass.length < 6) { showAuthError('regError', 'Password must be at least 6 characters.'); return; }
  const users = lsGet('qe_users') || [];
  if (users.length >= MAX_USERS) { showAuthError('regError', 'Maximum 2 accounts allowed.'); return; }
  if (users.find(u => u.email === email)) { showAuthError('regError', 'Email already registered.'); return; }
  users.push({ name, email, password: btoa(pass) });
  lsSet('qe_users', users);
  currentUser = { email, name };
  lsSet('qe_session', currentUser);
  showApp();
}

function handleLogout() {
  localStorage.removeItem('qe_session');
  currentUser = null;
  document.getElementById('mainApp').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('flex');
  document.getElementById('authOverlay').classList.remove('hidden');
}

function showAuthError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function showApp() {
  document.getElementById('authOverlay').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');
  document.getElementById('mainApp').classList.add('flex');
  document.getElementById('userDisplay').textContent = currentUser.name || currentUser.email;
  watchlist = lsGet('qe_watchlist') || [...DEFAULT_WATCHLIST];
  navigate('dashboard');
}

// ─── NAVIGATION ──────────────────────────────────────────────
function navigate(section) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.nav-btn[data-section="${section}"]`);
  if (btn) btn.classList.add('active');

  document.querySelectorAll('[id^="section-"]').forEach(s => s.classList.add('hidden'));
  document.getElementById(`section-${section}`).classList.remove('hidden');

  if (section === 'dashboard') initDashboard();
  if (section === 'reports')   renderReports();
  if (section === 'settings')  loadSettingsToForm();
}

// ─── DASHBOARD ───────────────────────────────────────────────
async function initDashboard() {
  renderWatchlist();
  fetchMacroIndicators();
  if (watchlist.length > 0) {
    await loadChart(watchlist[0], currentChartPeriod);
  }
}

function renderWatchlist() {
  const grid = document.getElementById('watchlistGrid');
  grid.innerHTML = '';
  if (watchlist.length === 0) {
    grid.innerHTML = '<p class="text-gray-500 text-sm col-span-4">Your watchlist is empty. Search and add a ticker above.</p>';
    return;
  }
  watchlist.forEach(ticker => {
    const card = document.createElement('div');
    card.className = 'stock-card bg-navy-800 border border-navy-600 rounded-2xl p-4 relative';
    card.id = `card-${ticker}`;
    card.innerHTML = `
      <button onclick="removeFromWatchlist('${ticker}')" class="absolute top-3 right-3 text-gray-600 hover:text-red-400 text-xs transition" title="Remove">✕</button>
      <div class="font-bold text-lg text-accent mb-1">${ticker}</div>
      <div class="text-xs text-gray-400 mb-3 ticker-name">Loading...</div>
      <div class="text-2xl font-bold mb-1 ticker-price">—</div>
      <div class="flex items-center gap-2 text-sm mb-3">
        <span class="ticker-change font-medium">—</span>
        <span class="ticker-changePct text-xs"></span>
      </div>
      <div class="grid grid-cols-2 gap-1 text-xs text-gray-400">
        <span>Vol: <span class="ticker-volume text-gray-300">—</span></span>
        <span>MCap: <span class="ticker-mcap text-gray-300">—</span></span>
      </div>
      <button onclick="loadChart('${ticker}', currentChartPeriod)" class="mt-3 w-full bg-navy-700 hover:bg-navy-600 text-xs py-1.5 rounded-lg transition">View Chart</button>
    `;
    grid.appendChild(card);
    fetchQuote(ticker);
  });
}

async function fetchQuote(ticker) {
  const cacheKey = `qe_quote_${ticker}`;
  const cached   = getCached(cacheKey);
  const card     = document.getElementById(`card-${ticker}`);
  if (!card) return;

  let data = cached;
  if (!data) {
    try {
      // Using allorigins CORS proxy to call Yahoo Finance v8 quote endpoint
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
      const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      const res  = await fetch(proxy);
      const json = await res.json();
      const parsed = JSON.parse(json.contents);
      const meta  = parsed?.chart?.result?.[0]?.meta;
      if (!meta) throw new Error('No meta');
      data = {
        name:      meta.shortName || meta.longName || ticker,
        price:     meta.regularMarketPrice,
        prev:      meta.chartPreviousClose || meta.previousClose,
        volume:    meta.regularMarketVolume,
        mcap:      meta.marketCap
      };
      setCached(cacheKey, data);
    } catch (e) {
      updateCardError(card, ticker);
      return;
    }
  }

  const change    = data.price - data.prev;
  const changePct = data.prev ? ((change / data.prev) * 100) : 0;
  const isPos     = change >= 0;

  card.querySelector('.ticker-name').textContent      = data.name;
  card.querySelector('.ticker-price').textContent     = data.price ? `$${data.price.toFixed(2)}` : '—';
  const chEl = card.querySelector('.ticker-change');
  chEl.textContent  = `${isPos ? '+' : ''}${change.toFixed(2)}`;
  chEl.className    = `ticker-change font-medium ${isPos ? 'text-green-400' : 'text-red-400'}`;
  card.querySelector('.ticker-changePct').textContent = `(${isPos ? '+' : ''}${changePct.toFixed(2)}%)`;
  card.querySelector('.ticker-changePct').className   = `ticker-changePct text-xs ${isPos ? 'text-green-400' : 'text-red-400'}`;
  card.querySelector('.ticker-volume').textContent    = data.volume ? fmtNum(data.volume) : '—';
  card.querySelector('.ticker-mcap').textContent      = data.mcap   ? fmtNum(data.mcap)   : '—';
}

function updateCardError(card, ticker) {
  card.querySelector('.ticker-name').textContent  = 'Data unavailable';
  card.querySelector('.ticker-price').textContent = '—';
}

async function addToWatchlist() {
  const input  = document.getElementById('searchTicker');
  const ticker = input.value.trim().toUpperCase();
  if (!ticker) return;
  if (watchlist.includes(ticker)) { showToast(`${ticker} already in watchlist`); input.value = ''; return; }
  watchlist.push(ticker);
  lsSet('qe_watchlist', watchlist);
  input.value = '';
  renderWatchlist();
  showToast(`${ticker} added to watchlist`);
}

function removeFromWatchlist(ticker) {
  watchlist = watchlist.filter(t => t !== ticker);
  lsSet('qe_watchlist', watchlist);
  renderWatchlist();
  showToast(`${ticker} removed`);
}

// ─── PRICE CHART ─────────────────────────────────────────────
async function loadChart(ticker, period) {
  currentChartTicker = ticker;
  currentChartPeriod = period;
  document.getElementById('chartTitle').textContent = `${ticker} — Price History`;
  document.getElementById('chartSpinner').style.display = 'flex';
  document.querySelector('canvas#priceChart').style.display = 'none';

  document.querySelectorAll('.period-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('onclick').includes(`'${period}'`));
  });

  const cacheKey = `qe_chart_${ticker}_${period}`;
  const cached   = getCached(cacheKey);
  let labels = [], prices = [];

  if (cached) {
    labels = cached.labels;
    prices = cached.prices;
  } else {
    try {
      const url   = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${period}`;
      const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      const res   = await fetch(proxy);
      const json  = await res.json();
      const data  = JSON.parse(json.contents);
      const result = data?.chart?.result?.[0];
      if (!result) throw new Error('No result');
      const ts    = result.timestamp;
      const close = result.indicators?.quote?.[0]?.close;
      labels = ts.map(t => new Date(t * 1000).toLocaleDateString());
      prices = close.map(p => p ? parseFloat(p.toFixed(2)) : null);
      setCached(cacheKey, { labels, prices });
    } catch (e) {
      document.getElementById('chartSpinner').style.display = 'none';
      showToast('Could not load chart data');
      return;
    }
  }

  document.getElementById('chartSpinner').style.display = 'none';
  const canvas = document.querySelector('canvas#priceChart');
  canvas.style.display = 'block';

  if (priceChart) priceChart.destroy();
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, 'rgba(0,212,170,0.25)');
  gradient.addColorStop(1, 'rgba(0,212,170,0)');

  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: ticker,
        data: prices,
        borderColor: '#00d4aa',
        backgroundColor: gradient,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { grid: { color: '#111d35' }, ticks: { color: '#6b7280', maxTicksLimit: 8 } },
        y: { grid: { color: '#111d35' }, ticks: { color: '#6b7280' } }
      }
    }
  });
}

function changeChartPeriod(period) {
  if (currentChartTicker) loadChart(currentChartTicker, period);
}

// ─── MACRO INDICATORS (FRED) ─────────────────────────────────
async function fetchMacroIndicators() {
  const grid    = document.getElementById('macroGrid');
  const fredKey = getKey('FRED');
  grid.innerHTML = '';

  for (const [label, series] of Object.entries(FRED_SERIES)) {
    const card = document.createElement('div');
    card.className = 'macro-card';
    card.innerHTML = `<div class="text-xs text-gray-400 mb-1">${label}</div><div class="text-xl font-bold text-accent" id="fred-${series}">—</div><div class="text-xs text-gray-500" id="fred-${series}-date"></div>`;
    grid.appendChild(card);
  }

  if (!fredKey) {
    grid.innerHTML = '<p class="text-gray-500 text-xs col-span-4">Add your FRED API key in Settings to load macro indicators.</p>';
    return;
  }

  for (const [label, series] of Object.entries(FRED_SERIES)) {
    fetchFredSeries(series, fredKey);
  }
}

async function fetchFredSeries(series, key) {
  const cacheKey = `qe_fred_${series}`;
  const cached   = getCached(cacheKey);
  let value = null, date = null;

  if (cached) {
    value = cached.value;
    date  = cached.date;
  } else {
    try {
      const url   = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${key}&file_type=json&limit=1&sort_order=desc`;
      const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      const res   = await fetch(proxy);
      const json  = await res.json();
      const data  = JSON.parse(json.contents);
      const obs   = data?.observations?.[0];
      value = obs?.value;
      date  = obs?.date;
      if (value && value !== '.') setCached(cacheKey, { value, date });
    } catch (e) {
      value = 'Error';
    }
  }

  const el   = document.getElementById(`fred-${series}`);
  const elD  = document.getElementById(`fred-${series}-date`);
  if (el) el.textContent = value && value !== '.' ? `${parseFloat(value).toFixed(2)}%` : '—';
  if (elD) elD.textContent = date || '';
}

// ─── AI ANALYSIS ─────────────────────────────────────────────
async function runAnalysis() {
  const ticker = document.getElementById('analysisTicker').value.trim().toUpperCase();
  if (!ticker) { showToast('Enter a ticker symbol'); return; }

  document.getElementById('analysisResult').classList.add('hidden');
  const spinner = document.getElementById('analysisSpinnerWrap');
  spinner.classList.remove('hidden');
  const statusEl = document.getElementById('analysisStatusText');

  const updateStatus = msg => { statusEl.textContent = msg; };

  try {
    updateStatus('Fetching price & quote data...');
    const quoteData = await fetchQuoteData(ticker);

    updateStatus('Fetching fundamentals (Alpha Vantage)...');
    const fundamentals = await fetchFundamentals(ticker);

    updateStatus('Fetching news headlines...');
    const news = await fetchNews(ticker);

    updateStatus('Fetching macro indicators...');
    const macro = await fetchMacroForAnalysis();

    updateStatus('Fetching congressional & insider trades...');
    const altData = await fetchAltData(ticker);

    updateStatus('Sending to AI for analysis...');
    const report = await generateAIReport(ticker, quoteData, fundamentals, news, macro, altData);

    spinner.classList.add('hidden');
    displayReport(ticker, report, { quoteData, fundamentals, news });
  } catch (err) {
    spinner.classList.add('hidden');
    showToast(`Analysis failed: ${err.message}`);
    console.error(err);
  }
}

async function fetchQuoteData(ticker) {
  const cacheKey = `qe_fullquote_${ticker}`;
  const cached   = getCached(cacheKey);
  if (cached) return cached;

  const url   = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=6mo`;
  const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const res   = await fetch(proxy);
  const json  = await res.json();
  const data  = JSON.parse(json.contents);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${ticker}`);

  const meta   = result.meta;
  const close  = result.indicators?.quote?.[0]?.close || [];
  const ts     = result.timestamp || [];
  const recent = close.filter(Boolean).slice(-20);
  const obj = {
    name:       meta.shortName || meta.longName || ticker,
    price:      meta.regularMarketPrice,
    prev:       meta.chartPreviousClose,
    high52:     meta.fiftyTwoWeekHigh,
    low52:      meta.fiftyTwoWeekLow,
    volume:     meta.regularMarketVolume,
    mcap:       meta.marketCap,
    currency:   meta.currency || 'USD',
    priceHistory: recent,
    dates:      ts.slice(-20).map(t => new Date(t * 1000).toISOString().slice(0,10))
  };
  setCached(cacheKey, obj);
  return obj;
}

async function fetchFundamentals(ticker) {
  const key = getKey('AlphaVantage');
  if (!key) return { note: 'Alpha Vantage key not set — add it in Settings.' };

  const cacheKey = `qe_fund_${ticker}`;
  const cached   = getCached(cacheKey);
  if (cached) return cached;

  try {
    const url   = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${key}`;
    const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res   = await fetch(proxy);
    const json  = await res.json();
    const d     = JSON.parse(json.contents);
    if (!d.Symbol) return { note: 'Fundamentals not available or API limit reached.' };
    const obj = {
      pe:           d.PERatio,
      peg:          d.PEGRatio,
      evEbitda:     d.EVToEBITDA,
      revenueGrowth:d.QuarterlyRevenueGrowthYOY,
      profitMargin: d.ProfitMargin,
      roe:          d.ReturnOnEquityTTM,
      debtEquity:   d.DebtToEquityRatio,
      eps:          d.EPS,
      dividendYield:d.DividendYield,
      beta:         d.Beta,
      description:  d.Description,
      sector:       d.Sector,
      industry:     d.Industry
    };
    setCached(cacheKey, obj);
    return obj;
  } catch (e) {
    return { note: 'Could not fetch fundamentals.' };
  }
}

async function fetchNews(ticker) {
  const key = getKey('NewsAPI');
  if (!key) return [];

  const cacheKey = `qe_news_${ticker}`;
  const cached   = getCached(cacheKey);
  if (cached) return cached;

  try {
    const url   = `https://newsapi.org/v2/everything?q=${ticker}+stock&language=en&pageSize=10&sortBy=publishedAt&apiKey=${key}`;
    // NewsAPI blocks CORS from browser; use allorigins proxy
    const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res   = await fetch(proxy);
    const json  = await res.json();
    const data  = JSON.parse(json.contents);
    const articles = (data.articles || []).slice(0, 8).map(a => ({
      title:  a.title,
      source: a.source?.name,
      date:   a.publishedAt?.slice(0, 10)
    }));
    setCached(cacheKey, articles);
    return articles;
  } catch (e) {
    return [];
  }
}

async function fetchMacroForAnalysis() {
  const key = getKey('FRED');
  if (!key) return {};
  const result = {};
  for (const [label, series] of Object.entries(FRED_SERIES)) {
    const cacheKey = `qe_fred_${series}`;
    const cached   = getCached(cacheKey);
    if (cached) result[label] = cached.value;
    else {
      try {
        const url   = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${key}&file_type=json&limit=1&sort_order=desc`;
        const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
        const res   = await fetch(proxy);
        const json  = await res.json();
        const data  = JSON.parse(json.contents);
        const obs   = data?.observations?.[0];
        if (obs?.value) { result[label] = obs.value; setCached(cacheKey, { value: obs.value, date: obs.date }); }
      } catch (e) {}
    }
  }
  return result;
}

async function fetchAltData(ticker) {
  const key = getKey('Quiver');
  const result = { congressional: [], insider: [] };
  if (!key) return result;

  // Congressional trades
  try {
    const cacheKey = `qe_congress_${ticker}`;
    const cached   = getCached(cacheKey);
    if (cached) {
      result.congressional = cached;
    } else {
      const url   = `https://api.quiverquant.com/beta/historical/congresstrading/${ticker}`;
      const res   = await fetch(url, { headers: { Authorization: `Token ${key}` } });
      const data  = await res.json();
      const trades = (Array.isArray(data) ? data : []).slice(0, 5);
      result.congressional = trades;
      setCached(cacheKey, trades);
    }
  } catch (e) {}

  // Insider trades
  try {
    const cacheKey = `qe_insider_${ticker}`;
    const cached   = getCached(cacheKey);
    if (cached) {
      result.insider = cached;
    } else {
      const url  = `https://api.quiverquant.com/beta/historical/insiders/${ticker}`;
      const res  = await fetch(url, { headers: { Authorization: `Token ${key}` } });
      const data = await res.json();
      const trades = (Array.isArray(data) ? data : []).slice(0, 5);
      result.insider = trades;
      setCached(cacheKey, trades);
    }
  } catch (e) {}

  return result;
}

async function generateAIReport(ticker, quoteData, fundamentals, news, macro, altData) {
  const backend = getSettings().aiBackend || 'groq';
  const key     = backend === 'groq' ? getKey('Groq') : getKey('OpenAI');
  if (!key) throw new Error(`No ${backend === 'groq' ? 'Groq' : 'OpenAI'} API key. Add it in Settings.`);

  const prompt = buildAnalysisPrompt(ticker, quoteData, fundamentals, news, macro, altData);

  if (backend === 'groq') {
    return callGroq(key, prompt);
  } else {
    return callOpenAI(key, prompt);
  }
}

function buildAnalysisPrompt(ticker, q, f, news, macro, alt) {
  return `You are a professional equity analyst. Provide a structured investment report for ${ticker} (${q.name}).

CURRENT MARKET DATA:
- Price: ${q.currency} ${q.price} | 52W High: ${q.high52} | 52W Low: ${q.low52}
- Market Cap: ${fmtNum(q.mcap)} | Volume: ${fmtNum(q.volume)}
- Recent 20-day close prices: ${q.priceHistory.map(p => p?.toFixed(2)).join(', ')}

FUNDAMENTALS:
- Sector: ${f.sector || 'N/A'} | Industry: ${f.industry || 'N/A'}
- P/E: ${f.pe || 'N/A'} | PEG: ${f.peg || 'N/A'} | EV/EBITDA: ${f.evEbitda || 'N/A'}
- Revenue Growth (YoY): ${f.revenueGrowth || 'N/A'} | Profit Margin: ${f.profitMargin || 'N/A'}
- ROE: ${f.roe || 'N/A'} | Debt/Equity: ${f.debtEquity || 'N/A'} | Beta: ${f.beta || 'N/A'}
- EPS: ${f.eps || 'N/A'} | Dividend Yield: ${f.dividendYield || 'N/A'}
${f.note ? '- Note: ' + f.note : ''}

MACROECONOMIC CONTEXT:
${Object.entries(macro).map(([k, v]) => `- ${k}: ${v}%`).join('\n') || 'No macro data available'}

RECENT NEWS HEADLINES:
${news.length ? news.map(n => `- [${n.date}] ${n.title} (${n.source})`).join('\n') : 'No news available'}

CONGRESSIONAL TRADES (recent):
${alt.congressional.length ? JSON.stringify(alt.congressional.slice(0,3)) : 'None available'}

INSIDER TRADES (recent):
${alt.insider.length ? JSON.stringify(alt.insider.slice(0,3)) : 'None available'}

BUSINESS DESCRIPTION:
${f.description ? f.description.slice(0, 500) : 'Not available'}

Please generate a complete analyst report with EXACTLY these sections in this order:

## Business Overview
[2-3 sentences about the business model and market position]

## Key Financial Metrics
[Evaluate the P/E, EV/EBITDA, margins, growth, and balance sheet quality]

## Macroeconomic Context
[How do current rates, inflation, GDP growth affect this company?]

## Sentiment Analysis
[Analyze news tone and congressional/insider activity]

## Red Flags & Risks
[List key risks and concerns as bullet points]

## Bull Case
[3 reasons to be optimistic, as bullet points]

## Bear Case
[3 reasons to be cautious, as bullet points]

## Final Analyst Score
[Give a score X/10 with one sentence justification. Format: SCORE: X/10 — justification]

Be concise, data-driven, and professional. Do not repeat data unnecessarily.`;
}

async function callGroq(key, prompt) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama3-70b-8192',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2000
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err?.error?.message || 'Groq API error');
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'No response from Groq.';
}

async function callOpenAI(key, prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2000
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err?.error?.message || 'OpenAI API error');
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'No response from OpenAI.';
}

// ─── DISPLAY REPORT ──────────────────────────────────────────
function displayReport(ticker, reportText, rawData) {
  currentReportData = { ticker, reportText, rawData, date: new Date().toISOString() };

  document.getElementById('analysisTickerTitle').textContent = `${ticker} — AI Analysis Report`;
  const container = document.getElementById('analysisContent');
  container.innerHTML = '';

  // Parse sections from markdown-ish report
  const sections = parseReportSections(reportText);
  sections.forEach(({ heading, content }) => {
    const div = document.createElement('div');
    div.className = 'report-section';
    if (heading.toLowerCase().includes('score')) {
      const match = content.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
      const score = match ? parseFloat(match[1]) : null;
      const color = score ? (score >= 7 ? '#00d4aa' : score >= 5 ? '#fbbf24' : '#f87171') : '#9ca3af';
      div.innerHTML = `<h3>${heading}</h3>
        <div class="flex items-center gap-4 mt-2">
          ${score !== null ? `<div class="score-badge" style="color:${color};border-color:${color}">${score}</div>` : ''}
          <p>${content}</p>
        </div>`;
    } else {
      div.innerHTML = `<h3>${heading}</h3>${markdownToHtml(content)}`;
    }
    container.appendChild(div);
  });

  // Metrics table from rawData
  if (rawData.quoteData || rawData.fundamentals) {
    const metricsDiv = document.createElement('div');
    metricsDiv.className = 'report-section';
    metricsDiv.innerHTML = `<h3>Quick Reference Metrics</h3>${buildMetricsTable(rawData.quoteData, rawData.fundamentals)}`;
    container.insertBefore(metricsDiv, container.firstChild);
  }

  // News section
  if (rawData.news && rawData.news.length) {
    const newsDiv = document.createElement('div');
    newsDiv.className = 'report-section';
    newsDiv.innerHTML = `<h3>Recent News</h3><div class="mt-1">${rawData.news.map(n => `<div class="news-item"><a href="#" class="text-gray-200 hover:text-accent">${n.title}</a> <span class="text-gray-500">${n.source} · ${n.date}</span></div>`).join('')}</div>`;
    container.appendChild(newsDiv);
  }

  // Annotation
  const annotDiv = document.createElement('div');
  annotDiv.className = 'report-section';
  annotDiv.innerHTML = `<h3>Analyst Notes</h3><textarea class="annotation mt-2" rows="4" placeholder="Add your manual notes or annotations here..."></textarea>`;
  container.appendChild(annotDiv);

  document.getElementById('analysisResult').classList.remove('hidden');
}

function parseReportSections(text) {
  const sections = [];
  const lines    = text.split('\n');
  let current    = null;

  lines.forEach(line => {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { heading: headingMatch[1].trim(), content: '' };
    } else if (current) {
      current.content += line + '\n';
    }
  });
  if (current) sections.push(current);

  // Fallback if AI doesn't use ## headers
  if (!sections.length) {
    sections.push({ heading: 'Analysis Report', content: text });
  }
  return sections;
}

function markdownToHtml(text) {
  return text
    .replace(/^\*\*(.+?)\*\*/gm, '<strong>$1</strong>')
    .replace(/^- (.+)/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[ulopli])/gm, '')
    .trim();
}

function buildMetricsTable(q, f) {
  const rows = [
    ['Price', q?.price ? `$${q.price.toFixed(2)}` : '—'],
    ['52W High', q?.high52 ? `$${q.high52.toFixed(2)}` : '—'],
    ['52W Low',  q?.low52  ? `$${q.low52.toFixed(2)}`  : '—'],
    ['Market Cap', q?.mcap ? fmtNum(q.mcap) : '—'],
    ['P/E Ratio', f?.pe || '—'],
    ['EV/EBITDA', f?.evEbitda || '—'],
    ['Revenue Growth', f?.revenueGrowth || '—'],
    ['Profit Margin', f?.profitMargin || '—'],
    ['ROE', f?.roe || '—'],
    ['Beta', f?.beta || '—'],
  ];
  return `<table class="metric-table w-full mt-2"><tbody>${rows.map(([k,v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</tbody></table>`;
}

// ─── SAVE REPORT ─────────────────────────────────────────────
function saveReport() {
  if (!currentReportData) return;
  const annotation = document.querySelector('textarea.annotation')?.value || '';
  const report = { ...currentReportData, annotation, id: Date.now() };
  const reports = lsGet('qe_reports') || [];
  reports.unshift(report);
  lsSet('qe_reports', reports);
  showToast('Report saved!');
}

// ─── REPORTS PAGE ─────────────────────────────────────────────
function renderReports() {
  const container = document.getElementById('reportsList');
  const empty     = document.getElementById('reportsEmpty');
  const reports   = lsGet('qe_reports') || [];

  container.innerHTML = '';
  if (!reports.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  reports.forEach(r => {
    const div = document.createElement('div');
    div.className = 'bg-navy-800 border border-navy-600 rounded-2xl p-6';
    div.innerHTML = `
      <div class="flex items-start justify-between mb-4">
        <div>
          <h2 class="text-lg font-bold text-accent">${r.ticker}</h2>
          <p class="text-xs text-gray-400">${new Date(r.date).toLocaleString()}</p>
        </div>
        <div class="flex gap-2">
          <button onclick="exportPDF(${r.id})" class="bg-navy-700 hover:bg-navy-600 border border-navy-500 px-3 py-1.5 rounded-lg text-xs transition">Export PDF</button>
          <button onclick="deleteReport(${r.id})" class="bg-red-900 hover:bg-red-800 border border-red-700 px-3 py-1.5 rounded-lg text-xs transition">Delete</button>
        </div>
      </div>
      <div class="text-sm text-gray-300 whitespace-pre-wrap max-h-64 overflow-y-auto bg-navy-900 rounded-lg p-4 mb-3">${r.reportText}</div>
      ${r.annotation ? `<div class="mt-2"><p class="text-xs text-gray-400 mb-1">Analyst Notes:</p><p class="text-sm text-gray-300 bg-navy-900 rounded-lg p-3">${r.annotation}</p></div>` : ''}
    `;
    container.appendChild(div);
  });
}

function deleteReport(id) {
  let reports = lsGet('qe_reports') || [];
  reports = reports.filter(r => r.id !== id);
  lsSet('qe_reports', reports);
  renderReports();
  showToast('Report deleted');
}

function exportPDF(id) {
  const reports = lsGet('qe_reports') || [];
  const report  = reports.find(r => r.id === id);
  if (!report) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  const margin  = 50;
  const maxW    = doc.internal.pageSize.getWidth() - margin * 2;
  let y = margin;

  // Header
  doc.setFontSize(22);
  doc.setTextColor(0, 212, 170);
  doc.text(`QuantEdge — ${report.ticker} Analysis`, margin, y); y += 30;

  doc.setFontSize(10);
  doc.setTextColor(150, 150, 150);
  doc.text(`Generated: ${new Date(report.date).toLocaleString()}`, margin, y); y += 25;

  doc.setFontSize(11);
  doc.setTextColor(230, 230, 230);

  const lines = doc.splitTextToSize(report.reportText, maxW);
  lines.forEach(line => {
    if (y > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; }
    doc.text(line, margin, y); y += 15;
  });

  if (report.annotation) {
    y += 10;
    doc.setTextColor(0, 212, 170);
    doc.text('Analyst Notes:', margin, y); y += 18;
    doc.setTextColor(200, 200, 200);
    const noteLines = doc.splitTextToSize(report.annotation, maxW);
    noteLines.forEach(line => {
      if (y > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; }
      doc.text(line, margin, y); y += 15;
    });
  }

  doc.save(`QuantEdge_${report.ticker}_${report.id}.pdf`);
  showToast('PDF exported!');
}

// ─── SETTINGS ────────────────────────────────────────────────
function loadSettingsToForm() {
  const s = getSettings();
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('keyGroq',         s.keys?.Groq);
  setVal('keyOpenAI',       s.keys?.OpenAI);
  setVal('keyFRED',         s.keys?.FRED);
  setVal('keyAlphaVantage', s.keys?.AlphaVantage);
  setVal('keyNewsAPI',      s.keys?.NewsAPI);
  setVal('keyQuiver',       s.keys?.Quiver);
  // AI backend radio
  const backend = s.aiBackend || 'groq';
  const radio   = document.querySelector(`input[name="aiBackend"][value="${backend}"]`);
  if (radio) radio.checked = true;
}

function saveSettings() {
  const getV = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const backend = document.querySelector('input[name="aiBackend"]:checked')?.value || 'groq';
  const settings = {
    aiBackend: backend,
    keys: {
      Groq:         getV('keyGroq'),
      OpenAI:       getV('keyOpenAI'),
      FRED:         getV('keyFRED'),
      AlphaVantage: getV('keyAlphaVantage'),
      NewsAPI:      getV('keyNewsAPI'),
      Quiver:       getV('keyQuiver')
    }
  };
  lsSet('qe_settings', settings);
  const el = document.getElementById('settingsSaved');
  if (el) { el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 3000); }
  showToast('Settings saved!');
}

function clearCache() {
  const keep = ['qe_users', 'qe_session', 'qe_watchlist', 'qe_settings', 'qe_reports'];
  Object.keys(localStorage).forEach(k => { if (k.startsWith('qe_') && !keep.includes(k)) localStorage.removeItem(k); });
  showToast('Cache cleared');
}

// ─── HELPERS ─────────────────────────────────────────────────
function getSettings() { return lsGet('qe_settings') || {}; }
function getKey(name)  { return getSettings()?.keys?.[name] || ''; }

function lsGet(key)       { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } }
function lsSet(key, val)  { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn('localStorage error', e); } }

function getCached(key) {
  try {
    const item = localStorage.getItem(key);
    if (!item) return null;
    const { ts, data } = JSON.parse(item);
    if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function setCached(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
}

function fmtNum(n) {
  if (!n && n !== 0) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3)  return `$${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.querySelector('div').textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 3000);
}
