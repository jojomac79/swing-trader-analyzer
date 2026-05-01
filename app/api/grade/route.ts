import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { auth } from "@/auth";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Shared helpers (same as analyze route) ───────────────────────────────────
type FinnhubQuote = { c: number; h: number; l: number; o: number; pc: number; t: number };
type FinnhubEarningsItem = { date?: string; hour?: string; symbol?: string };
type FinnhubEarningsResponse = { earningsCalendar?: FinnhubEarningsItem[] };
type FinnhubNewsItem = { headline?: string; summary?: string; source?: string; url?: string; datetime?: number };
type FinnhubSearchResult = { description?: string; displaySymbol?: string; symbol?: string; type?: string };
type FinnhubSearchResponse = { count?: number; result?: FinnhubSearchResult[] };
type HeadlineItem = { headline: string; source: string; url: string };
type FinnhubCandles = { c?: number[]; h?: number[]; l?: number[]; o?: number[]; v?: number[]; t?: number[]; s?: string };
type AppUserRow = { user_id: string; daily_count: number; last_reset_date: string; is_premium: boolean; disclaimer_accepted: boolean };

type TechData = {
  rsi14: number | null; macdLine: number | null; macdSignal: number | null; macdHist: number | null;
  ema20: number | null; ema50: number | null; ema200: number | null;
  week52High: number | null; week52Low: number | null;
  weeklyResistance: number | null; weeklySupport: number | null;
  avgVolume20: number | null; currentVolume: number | null; volumeRatio: number | null;
  atr14: number | null; priceVsEma20: string | null; priceVsEma50: string | null; priceVsEma200: string | null;
};

// ─── User trade leg input ─────────────────────────────────────────────────────
type TradeLeg = {
  action: "buy" | "sell";
  type: "call" | "put" | "share";
  strike?: number | null;
  expiration?: string | null;
  premium?: number | null;
};

type GradeRequest = {
  ticker: string;
  legs: TradeLeg[];
  notes?: string;
};

function formatDate(date: Date): string { return date.toISOString().slice(0, 10); }

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") { const p = Number(value); return Number.isFinite(p) ? p : null; }
  return null;
}

const TICKER_ALIASES: Record<string, string> = {
  disney: "DIS", "walt disney": "DIS", google: "GOOGL", alphabet: "GOOGL",
  facebook: "META", "meta platforms": "META", meta: "META", netflix: "NFLX",
  apple: "AAPL", amazon: "AMZN", microsoft: "MSFT", tesla: "TSLA",
  nvidia: "NVDA", shopify: "SHOP", spotify: "SPOT", coinbase: "COIN",
  palantir: "PLTR", snowflake: "SNOW", robinhood: "HOOD", uber: "UBER",
  lyft: "LYFT", airbnb: "ABNB", pinterest: "PINS", snapchat: "SNAP", snap: "SNAP",
  amd: "AMD", intel: "INTC", qualcomm: "QCOM", broadcom: "AVGO",
  salesforce: "CRM", oracle: "ORCL", ibm: "IBM", paypal: "PYPL",
  square: "SQ", block: "SQ", visa: "V", mastercard: "MA",
  jpmorgan: "JPM", "jp morgan": "JPM", "bank of america": "BAC",
  "wells fargo": "WFC", goldman: "GS", "goldman sachs": "GS", "morgan stanley": "MS",
  exxon: "XOM", chevron: "CVX", pfizer: "PFE", moderna: "MRNA",
  unitedhealth: "UNH", "united health": "UNH", walmart: "WMT",
  "home depot": "HD", target: "TGT", costco: "COST", nike: "NKE",
  boeing: "BA", ford: "F", "general motors": "GM", "general electric": "GE", ge: "GE",
  amc: "AMC", gamestop: "GME", sofi: "SOFI", rivian: "RIVN", lucid: "LCID",
};

function looksLikeTicker(input: string): boolean { return /^[A-Z.\-]{1,6}$/.test(input.trim().toUpperCase()); }

function scoreSearchResult(result: FinnhubSearchResult, rawInput: string): number {
  const input = rawInput.trim().toLowerCase();
  const symbol = (result.symbol ?? "").toLowerCase();
  const displaySymbol = (result.displaySymbol ?? "").toLowerCase();
  const description = (result.description ?? "").toLowerCase();
  const type = (result.type ?? "").toLowerCase();
  let score = 0;
  if (type === "common stock") score += 40;
  if (type === "adr") score += 10;
  if (type.includes("etf")) score -= 10;
  if (type.includes("fund")) score -= 15;
  if (symbol === input || displaySymbol === input) score += 100;
  if (description === input) score += 90;
  if (description.startsWith(input)) score += 45;
  if (description.includes(input)) score += 25;
  if (symbol.startsWith(input) || displaySymbol.startsWith(input)) score += 20;
  if (description.split(/\s+/).some((w) => w === input)) score += 60;
  if (symbol.includes(".") || displaySymbol.includes(".")) score -= 10;
  return score;
}

async function resolveInputToSymbol(rawInput: string, finnhubKey: string) {
  const trimmed = rawInput.trim();
  const upper = trimmed.toUpperCase();
  if (looksLikeTicker(upper)) return { symbol: upper, resolvedDisplayName: null };
  const aliasKey = trimmed.toLowerCase();
  if (TICKER_ALIASES[aliasKey]) return { symbol: TICKER_ALIASES[aliasKey], resolvedDisplayName: trimmed };
  const searchRes = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(trimmed)}&token=${finnhubKey}`, { cache: "no-store" });
  if (!searchRes.ok) throw new Error("Failed to resolve company name to ticker.");
  const searchData = (await searchRes.json()) as FinnhubSearchResponse;
  const results = Array.isArray(searchData.result) ? searchData.result : [];
  const best = [...results].filter((i) => i.symbol && i.description).sort((a, b) => scoreSearchResult(b, trimmed) - scoreSearchResult(a, trimmed))[0];
  if (!best?.symbol) throw new Error(`Could not find a ticker match for "${trimmed}".`);
  return { symbol: best.symbol, resolvedDisplayName: best.description ?? null };
}

function buildNewsKeywords(symbol: string, companyName: string | null): string[] {
  const keywords = new Set<string>([symbol.toLowerCase()]);
  if (companyName) {
    const cleaned = companyName.replace(/\b(inc|corp|corporation|holdings|group|plc|ltd|limited|co)\.?\b/gi, "").replace(/[.,]/g, " ").trim();
    if (cleaned) { keywords.add(cleaned.toLowerCase()); cleaned.split(/\s+/).forEach((p) => { if (p.length >= 3) keywords.add(p.toLowerCase()); }); }
  }
  return [...keywords];
}

function isRelevantHeadline(item: FinnhubNewsItem, keywords: string[]): boolean {
  const text = `${item.headline ?? ""} ${item.summary ?? ""}`.toLowerCase();
  return keywords.some((k) => text.includes(k));
}

// ─── Technical analysis (same as analyze route) ───────────────────────────────
function calcEMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return Math.round(ema * 100) / 100;
}

function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 10) / 10;
}

function calcMACD(closes: number[]): { macd: number | null; signal: number | null; hist: number | null } {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  if (ema12 === null || ema26 === null) return { macd: null, signal: null, hist: null };
  const macdLine = Math.round((ema12 - ema26) * 1000) / 1000;
  const macdValues: number[] = [];
  for (let i = Math.max(0, closes.length - 35); i <= closes.length - 1; i++) {
    const e12 = calcEMA(closes.slice(0, i + 1), 12);
    const e26 = calcEMA(closes.slice(0, i + 1), 26);
    if (e12 !== null && e26 !== null) macdValues.push(e12 - e26);
  }
  const signalLine = macdValues.length >= 9 ? calcEMA(macdValues, 9) : null;
  const hist = signalLine !== null ? Math.round((macdLine - signalLine) * 1000) / 1000 : null;
  return { macd: macdLine, signal: signalLine, hist };
}

function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number | null {
  if (highs.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const recent = trs.slice(-period);
  return Math.round((recent.reduce((a, b) => a + b, 0) / period) * 100) / 100;
}

function buildTechData(candles: FinnhubCandles, price: number): TechData {
  const closes = candles.c ?? [];
  const highs = candles.h ?? [];
  const lows = candles.l ?? [];
  const volumes = candles.v ?? [];
  const rsi14 = calcRSI(closes);
  const { macd: macdLine, signal: macdSignal, hist: macdHist } = calcMACD(closes);
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  const atr14 = calcATR(highs, lows, closes);
  const week52High = highs.length ? Math.round(Math.max(...highs) * 100) / 100 : null;
  const week52Low = lows.length ? Math.round(Math.min(...lows) * 100) / 100 : null;
  const weeklyHighs = highs.slice(-20);
  const weeklyLows = lows.slice(-20);
  const weeklyResistance = weeklyHighs.length ? Math.round(Math.max(...weeklyHighs) * 100) / 100 : null;
  const weeklySupport = weeklyLows.length ? Math.round(Math.min(...weeklyLows) * 100) / 100 : null;
  const avgVolume20 = volumes.length >= 20 ? Math.round(volumes.slice(-20).reduce((a, b) => a + b, 0) / 20) : null;
  const currentVolume = volumes.length ? volumes[volumes.length - 1] : null;
  const volumeRatio = avgVolume20 && currentVolume ? Math.round((currentVolume / avgVolume20) * 100) / 100 : null;
  return {
    rsi14, macdLine, macdSignal, macdHist, ema20, ema50, ema200, atr14,
    week52High, week52Low, weeklyResistance, weeklySupport,
    avgVolume20, currentVolume, volumeRatio,
    priceVsEma20: ema20 ? (price > ema20 ? "above" : "below") : null,
    priceVsEma50: ema50 ? (price > ema50 ? "above" : "below") : null,
    priceVsEma200: ema200 ? (price > ema200 ? "above" : "below") : null,
  };
}

function buildTechnicalSection(tech: TechData): string {
  const lines: string[] = ["TECHNICAL ANALYSIS (Daily):"];
  if (tech.rsi14 !== null) {
    const sig = tech.rsi14 >= 70 ? "Overbought" : tech.rsi14 <= 30 ? "Oversold" : tech.rsi14 >= 55 ? "Bullish" : tech.rsi14 <= 45 ? "Bearish" : "Neutral";
    lines.push(`- RSI(14): ${tech.rsi14} — ${sig}`);
  }
  if (tech.macdLine !== null && tech.macdSignal !== null) {
    lines.push(`- MACD: ${tech.macdLine} | Signal: ${tech.macdSignal} | Hist: ${tech.macdHist} — ${tech.macdLine > tech.macdSignal ? "Bullish crossover" : "Bearish crossover"}`);
  }
  if (tech.atr14 !== null) lines.push(`- ATR(14): $${tech.atr14} (daily range)`);
  if (tech.ema20 !== null) lines.push(`- EMA20: $${tech.ema20} — price is ${tech.priceVsEma20}`);
  if (tech.ema50 !== null) lines.push(`- EMA50: $${tech.ema50} — price is ${tech.priceVsEma50}`);
  const bullishMAs = [tech.priceVsEma20, tech.priceVsEma50, tech.priceVsEma200].filter(x => x === "above").length;
  lines.push(`- MA Trend: Price above ${bullishMAs}/3 key EMAs`);
  if (tech.weeklyResistance !== null) lines.push(`- 4-Week Resistance: $${tech.weeklyResistance}`);
  if (tech.weeklySupport !== null) lines.push(`- 4-Week Support: $${tech.weeklySupport}`);
  if (tech.volumeRatio !== null) {
    const vs = tech.volumeRatio >= 1.5 ? "High volume" : tech.volumeRatio < 0.7 ? "Low volume" : "Normal volume";
    lines.push(`- Volume Ratio vs 20d avg: ${tech.volumeRatio}x — ${vs}`);
  }
  return lines.join("\n");
}

// ─── Format user trade for prompt ─────────────────────────────────────────────
function formatTradeLegs(legs: TradeLeg[]): string {
  return legs.map((leg, i) => {
    const action = leg.action.toUpperCase();
    const type = leg.type.toUpperCase();
    const strike = leg.strike != null ? `$${leg.strike} strike` : "";
    const exp = leg.expiration ? `exp ${leg.expiration}` : "";
    const prem = leg.premium != null ? `@ $${leg.premium}` : "";
    return `Leg ${i + 1}: ${action} ${type} ${[strike, exp, prem].filter(Boolean).join(" ")}`.trim();
  }).join("\n");
}

function inferTradeType(legs: TradeLeg[]): string {
  if (legs.length === 1) {
    const l = legs[0];
    if (l.type === "share") return l.action === "buy" ? "Long Stock" : "Short Stock";
    return `${l.action === "buy" ? "Long" : "Short"} ${l.type === "call" ? "Call" : "Put"}`;
  }
  if (legs.length === 2) {
    const types = legs.map(l => l.type);
    const actions = legs.map(l => l.action);
    const exps = legs.map(l => l.expiration).filter(Boolean);

    // Check for diagonal FIRST — different expirations always means diagonal
    if (exps.length === 2 && exps[0] !== exps[1]) {
      if (types.every(t => t === "call")) return "Call Diagonal Spread";
      if (types.every(t => t === "put")) return "Put Diagonal Spread";
      return "Diagonal Spread";
    }

    // Same expiration — standard vertical spreads
    if (types.every(t => t === "call")) {
      if (actions[0] === "buy" && actions[1] === "sell") return "Call Debit Spread";
      if (actions[0] === "sell" && actions[1] === "buy") return "Bear Call Spread";
    }
    if (types.every(t => t === "put")) {
      if (actions[0] === "buy" && actions[1] === "sell") return "Put Debit Spread";
      if (actions[0] === "sell" && actions[1] === "buy") return "Bull Put Spread";
    }
  }
  if (legs.length === 4) return "Iron Condor / Combo";
  return `${legs.length}-Leg Strategy`;
}

const FREE_DAILY_LIMIT = 2;

export async function POST(req: Request) {
  try {
    const session = await auth();
    const email = session?.user?.email;

    const DEV_PREMIUM_EMAIL = "jojomac79@gmail.com";
    const isDevPremium = !!email && email.toLowerCase() === DEV_PREMIUM_EMAIL.toLowerCase();

    if (!email) {
      return NextResponse.json({ error: "Sign in with Google to use the grader.", limitType: "anon_limit" }, { status: 401 });
    }

    const userId = email;
    const todayKey = new Date().toISOString().slice(0, 10);

    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from("app_users")
      .select("user_id, daily_count, last_reset_date, is_premium, disclaimer_accepted")
      .eq("user_id", userId)
      .maybeSingle<AppUserRow>();

    if (fetchError) return NextResponse.json({ error: "Failed to check usage." }, { status: 500 });

    let userData: AppUserRow;
    if (!existingUser) {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from("app_users")
        .insert([{ user_id: userId, daily_count: 0, last_reset_date: todayKey, is_premium: false }])
        .select("user_id, daily_count, last_reset_date, is_premium, disclaimer_accepted")
        .single<AppUserRow>();
      if (insertError || !inserted) return NextResponse.json({ error: "Failed to create usage record." }, { status: 500 });
      userData = inserted;
    } else {
      userData = existingUser;
    }

    if (isDevPremium) userData.is_premium = true;

    if (!userData.disclaimer_accepted) {
      return NextResponse.json({ error: "Please accept the disclaimer before using the grader.", limitType: "disclaimer_required" }, { status: 403 });
    }

    if (userData.last_reset_date !== todayKey) {
      await supabaseAdmin.from("app_users").update({ daily_count: 0, last_reset_date: todayKey }).eq("user_id", userId);
      userData.daily_count = 0;
    }

    if (!userData.is_premium && userData.daily_count >= FREE_DAILY_LIMIT) {
      return NextResponse.json({ error: "Daily limit reached. Upgrade to Pro for unlimited access.", limitType: "signed_in_limit" }, { status: 403 });
    }

    await supabaseAdmin.from("app_users").update({ daily_count: userData.daily_count + 1 }).eq("user_id", userId);

    const body = (await req.json()) as GradeRequest;
    const { ticker, legs, notes } = body;

    if (!ticker || typeof ticker !== "string") return NextResponse.json({ error: "Ticker is required." }, { status: 400 });
    if (!legs || !Array.isArray(legs) || legs.length === 0) return NextResponse.json({ error: "At least one trade leg is required." }, { status: 400 });
    if (legs.length > 4) return NextResponse.json({ error: "Maximum 4 legs supported." }, { status: 400 });

    const finnhubKey = process.env.FINNHUB_API_KEY;
    const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;

    if (!finnhubKey) return NextResponse.json({ error: "Missing FINNHUB_API_KEY" }, { status: 500 });
    if (!alphaKey) return NextResponse.json({ error: "Missing ALPHA_VANTAGE_API_KEY" }, { status: 500 });
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });

    const resolved = await resolveInputToSymbol(ticker, finnhubKey);
    const symbol = resolved.symbol;
    const sym = encodeURIComponent(symbol);

    const today = new Date();
    const sixtyDaysOut = new Date(); sixtyDaysOut.setDate(today.getDate() + 60);
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(today.getDate() - 7);

    const [quoteRes, earningsRes, newsRes, candleRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${finnhubKey}`, { cache: "no-store" }),
      fetch(`https://finnhub.io/api/v1/calendar/earnings?symbol=${sym}&from=${formatDate(today)}&to=${formatDate(sixtyDaysOut)}&token=${finnhubKey}`, { cache: "no-store" }),
      fetch(`https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${formatDate(sevenDaysAgo)}&to=${formatDate(today)}&token=${finnhubKey}`, { cache: "no-store" }),
      fetch(`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${sym}&outputsize=compact&apikey=${alphaKey}`, { cache: "no-store" }),
    ]);

    if (!quoteRes.ok) return NextResponse.json({ error: `Failed to fetch quote for ${symbol}.` }, { status: 500 });

    const quoteData = (await quoteRes.json()) as FinnhubQuote;
    const earningsData = earningsRes.ok ? (await earningsRes.json()) as FinnhubEarningsResponse : { earningsCalendar: [] };
    const newsData = newsRes.ok ? (await newsRes.json()) as FinnhubNewsItem[] : [];
    const candleData = candleRes.ok ? (await candleRes.json()) as Record<string, unknown> : null;

    let parsedCandles: FinnhubCandles | null = null;
    if (candleData) {
      const timeSeries = candleData["Time Series (Daily)"] as Record<string, Record<string, string>> | undefined;
      if (timeSeries) {
        const dates = Object.keys(timeSeries).sort();
        const c: number[] = [], h: number[] = [], l: number[] = [], o: number[] = [], v: number[] = [];
        for (const date of dates) {
          const day = timeSeries[date];
          c.push(parseFloat(day["4. close"]));
          h.push(parseFloat(day["2. high"]));
          l.push(parseFloat(day["3. low"]));
          o.push(parseFloat(day["1. open"]));
          v.push(parseFloat(day["5. volume"]));
        }
        parsedCandles = { c, h, l, o, v, s: "ok" };
      }
    }

    const currentPriceNumber = typeof quoteData.c === "number" && quoteData.c > 0 ? quoteData.c : null;
    if (!currentPriceNumber) return NextResponse.json({ error: `Could not determine price for ${symbol}.` }, { status: 500 });
    const currentPrice = currentPriceNumber.toFixed(2);

    const techData = parsedCandles && parsedCandles.c && parsedCandles.c.length > 0
      ? buildTechData(parsedCandles, currentPriceNumber)
      : null;
    const technicalSection = techData ? buildTechnicalSection(techData) : "No technical data available.";

    const nextEarnings = earningsData.earningsCalendar?.length
      ? earningsData.earningsCalendar[0].date || "Upcoming"
      : "No upcoming earnings in next 60 days";

    const keywords = buildNewsKeywords(symbol, resolved.resolvedDisplayName);
    const validNews = Array.isArray(newsData) ? newsData.filter((i) => i.headline && i.source && i.url) : [];
    const filteredNews = validNews.filter((i) => isRelevantHeadline(i, keywords));
    const recentHeadlines: HeadlineItem[] = (filteredNews.length ? filteredNews : validNews)
      .slice(0, 5).map((i) => ({ headline: i.headline!, source: i.source!, url: i.url! }));

    const headlinesSection = recentHeadlines.length
      ? `RECENT HEADLINES:\n${recentHeadlines.map((h, i) => `${i + 1}. ${h.headline} (${h.source})`).join("\n")}`
      : "RECENT HEADLINES:\nNo relevant recent headlines found.";

    const tradeType = inferTradeType(legs);
    const tradeLegsFormatted = formatTradeLegs(legs);

    const isDiagonal = tradeType.includes("Diagonal");
    const isCredit = tradeType.includes("Bull Put") || tradeType.includes("Bear Call");
    const isDebit = tradeType.includes("Debit");
    const isCondor = tradeType.includes("Condor");

    const structureContext = isDiagonal
      ? `\nSTRATEGY CONTEXT — DIAGONAL SPREAD:
This is intentionally a diagonal spread (different expirations). Do NOT grade it as if it were a vertical spread or complain about mismatched expirations — the trader knows what they're doing.
Grade it on:
- Does the direction make sense given the technicals?
- Is the near-term short strike positioned well (above resistance for calls, below support for puts)?
- Does the far expiration give enough time for the move to develop?
- Is the net debit reasonable relative to the width between strikes?
- Does earnings timing affect either leg?
- Is the short leg at risk of being blown through on earnings?`
      : isCredit
      ? `\nSTRATEGY CONTEXT — CREDIT SPREAD:
Grade on: PoP and strike placement relative to S/R, premium collected vs max loss, whether the short strike is safely beyond key levels, and whether theta decay works in the trader's favor.`
      : isDebit
      ? `\nSTRATEGY CONTEXT — DEBIT SPREAD:
Grade on: Whether the direction and momentum justify paying for this spread, whether the long strike gives a realistic path to profit, R:R relative to current premium.`
      : isCondor
      ? `\nSTRATEGY CONTEXT — IRON CONDOR:
Grade on: Whether the market is actually range-bound, whether both short strikes are outside key S/R levels, and whether the credit collected justifies the risk.`
      : "";

    const prompt = `You are a sharp, experienced options trader reviewing a trade submitted by a user.

STOCK: ${symbol}${resolved.resolvedDisplayName ? ` (${resolved.resolvedDisplayName})` : ""}
Current Price: $${currentPrice}
Next Earnings: ${nextEarnings}

USER'S TRADE:
Strategy Type: ${tradeType}
${tradeLegsFormatted}
${notes ? `\nTrader's Notes: ${notes}` : ""}
${structureContext}

${technicalSection}

${headlinesSection}

Grade this trade and explain your reasoning. Be direct, honest, and trader-focused.
Grade the trade AS THE STRATEGY IT IS — do not suggest the trader "fix" the structure unless it is genuinely broken or inappropriate for the conditions.

GRADING CRITERIA:
- Does the direction align with the current technical setup?
- Is this the right structure for current market conditions?
- Is timing sound relative to earnings, RSI, EMA alignment?
- Are the strikes placed intelligently relative to support/resistance?
- Is premium risk appropriate?
- For diagonals specifically: does the short leg placement and near expiry make sense?

Format EXACTLY as follows:

Grade: (A / B / C / D / F)

Verdict: (One punchy sentence summing up the trade)

Technical Alignment:
- RSI/MACD: (how momentum supports or contradicts this trade)
- EMA Setup: (does price action support the direction?)
- Support/Resistance: (are strikes placed well or poorly relative to S/R?)

Fundamental/News Context:
- (Key headline or earnings risk that affects this trade)
- (Any macro or sector consideration)

What's Working:
- (Best thing about this trade)
- (Second positive if there is one)

What's Wrong / What to Watch:
- (Biggest risk or flaw in the trade)
- (What would invalidate it — specific price level)
- (One suggestion to improve or manage the trade if applicable)

Bottom Line:
- (One clear, direct sentence on whether to take this trade, adjust it, or pass)

Tone: Direct. Honest. No sugar-coating. Trader-to-trader.`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    });

    const outputText = message.content[0]?.type === "text" ? message.content[0].text : "";

    return NextResponse.json({
      result: outputText,
      meta: {
        symbol,
        resolvedDisplayName: resolved.resolvedDisplayName,
        currentPrice,
        nextEarnings,
        tradeType,
        legs,
        recentHeadlines,
        techData,
      },
    });
  } catch (error) {
    console.error("Grade error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Something went wrong." }, { status: 500 });
  }
}
