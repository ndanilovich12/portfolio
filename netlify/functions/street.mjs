// Wall Street data for Bull Run: analyst ratings, earnings history, next earnings date,
// key stats, company profile, recent headlines and (optionally) the analyst price target.
// Keys live in Netlify environment variables, never in the page:
//   FINNHUB_KEY  (required)  free key from https://finnhub.io
//   FMP_KEY      (optional)  free key from https://financialmodelingprep.com, adds price targets
// GET /api/street?symbol=AAPL

const FINNHUB = "https://finnhub.io/api/v1";
const FMP = "https://financialmodelingprep.com/stable";
const TTL_MS = 30 * 60 * 1000; // cache each symbol for 30 minutes to stay far under the free limits
const cache = new Map();

const env = (k) => (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];
const day = (d) => d.toISOString().slice(0, 10);
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

function json(body, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}

async function get(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 7000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export default async (req) => {
  const url = new URL(req.url);
  const sym = (url.searchParams.get("symbol") || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) return json({ error: "Use a ticker symbol like AAPL." }, 400);

  const key = env("FINNHUB_KEY");
  if (!key) return json({ configured: false, symbol: sym });

  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < TTL_MS) return json(hit.body, 200, 600);

  const now = new Date();
  const from = day(now);
  const to = day(new Date(now.getTime() + 120 * 864e5));
  const weekAgo = day(new Date(now.getTime() - 7 * 864e5));
  const q = (path) => get(`${FINNHUB}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(key)}`);

  const fmpKey = env("FMP_KEY");
  const [rec, earn, cal, met, prof, news, pt] = await Promise.all([
    q(`/stock/recommendation?symbol=${sym}`),
    q(`/stock/earnings?symbol=${sym}&limit=4`),
    q(`/calendar/earnings?from=${from}&to=${to}&symbol=${sym}`),
    q(`/stock/metric?symbol=${sym}&metric=all`),
    q(`/stock/profile2?symbol=${sym}`),
    q(`/company-news?symbol=${sym}&from=${weekAgo}&to=${from}`),
    fmpKey ? get(`${FMP}/price-target-consensus?symbol=${sym}&apikey=${encodeURIComponent(fmpKey)}`) : Promise.resolve(null),
  ]);

  const recs = (Array.isArray(rec) ? rec : [])
    .filter((r) => r && r.period)
    .sort((a, b) => (a.period < b.period ? 1 : -1))
    .slice(0, 4)
    .map((r) => ({
      period: r.period,
      strongBuy: r.strongBuy || 0,
      buy: r.buy || 0,
      hold: r.hold || 0,
      sell: r.sell || 0,
      strongSell: r.strongSell || 0,
    }));

  const earnings = (Array.isArray(earn) ? earn : [])
    .filter((e) => e && e.period)
    .sort((a, b) => (a.period < b.period ? 1 : -1))
    .slice(0, 4)
    .map((e) => ({
      period: e.period,
      actual: num(e.actual),
      estimate: num(e.estimate),
      surprisePercent: num(e.surprisePercent),
    }));

  const upcoming = (cal && Array.isArray(cal.earningsCalendar) ? cal.earningsCalendar : [])
    .filter((e) => e && e.date && e.date >= from)
    .sort((a, b) => (a.date > b.date ? 1 : -1))[0];
  const next = upcoming
    ? {
        date: upcoming.date,
        hour: upcoming.hour || "",
        epsEstimate: num(upcoming.epsEstimate),
        revenueEstimate: num(upcoming.revenueEstimate),
      }
    : null;

  const m = (met && met.metric) || {};
  const metrics = {
    pe: num(m.peTTM) ?? num(m.peBasicExclExtraTTM),
    high52: num(m["52WeekHigh"]),
    low52: num(m["52WeekLow"]),
    beta: num(m.beta),
    dividendYield: num(m.currentDividendYieldTTM) ?? num(m.dividendYieldIndicatedAnnual),
    revenueGrowth: num(m.revenueGrowthTTMYoy),
    epsGrowth: num(m.epsGrowthTTMYoy),
    netMargin: num(m.netProfitMarginTTM),
  };

  const profile = prof && prof.name
    ? {
        name: prof.name,
        industry: prof.finnhubIndustry || "",
        marketCapMillions: num(prof.marketCapitalization),
        weburl: prof.weburl || "",
      }
    : null;

  const headlines = (Array.isArray(news) ? news : [])
    .filter((n) => n && n.headline && n.url)
    .sort((a, b) => (b.datetime || 0) - (a.datetime || 0))
    .slice(0, 5)
    .map((n) => ({ headline: n.headline, source: n.source || "", url: n.url, time: n.datetime || null }));

  const t = Array.isArray(pt) ? pt[0] : pt;
  const target = t && (num(t.targetConsensus) || num(t.targetMedian))
    ? {
        consensus: num(t.targetConsensus),
        median: num(t.targetMedian),
        high: num(t.targetHigh),
        low: num(t.targetLow),
      }
    : null;

  const body = {
    configured: true,
    symbol: sym,
    asOf: now.toISOString(),
    sources: target ? ["Finnhub", "Financial Modeling Prep"] : ["Finnhub"],
    recs,
    earnings,
    next,
    metrics,
    profile,
    news: headlines,
    target,
  };
  cache.set(sym, { at: Date.now(), body });
  return json(body, 200, 600);
};

export const config = { path: "/api/street" };
