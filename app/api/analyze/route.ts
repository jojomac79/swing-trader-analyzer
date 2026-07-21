import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { auth } from "@/auth";
import { createMessageWithRetry, claudeErrorMessage } from "@/lib/callClaude";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

type FinnhubQuote = { c: number; h: number; l: number; o: number; pc: number; t: number };
type FinnhubEarningsItem = { date?: string; hour?: string; symbol?: string };
type FinnhubEarningsResponse = { earningsCalendar?: FinnhubEarningsItem[] };
type FinnhubNewsItem = { headline?: string; summary?: string; source?: string; url?: string; datetime?: number };
type FinnhubSearchResult = { description?: string; displaySymbol?: string; symbol?: string; type?: string };
type FinnhubSearchResponse = { count?: number; result?: FinnhubSearchResult[] };
type HeadlineItem = { headline: string; source: string; url: string };
type TradierExpirationsResponse = { expirations?: { date?: string[] | string } };
type TradierOptionContract = {
  symbol?: string; option_type?: "put" | "call"; strike?: number | string;
  bid?: number | string | null; ask?: number | string | null;
  greeks?: { delta?: number | string | null; mid_iv?: number | string | null; smv_vol?: number | string | null } | null;
};
type TradierChainResponse = { options?: { option?: TradierOptionContract[] | TradierOptionContract } };
type LiveCreditSpread = {
  strategyType: "Bull Put Spread" | "Bear Call Spread"; expiration: string;
  shortStrike: number; longStrike: number; shortBid: number; shortAsk: number;
  longBid: number; longAsk: number; shortMid: number; longMid: number;
  netCredit: number; width: number; maxProfit: number; maxLoss: number;
  breakeven: number; pop: number | null; pop50: number | null; riskReward: number;
};
type LiveDebitSpread = {
  strategyType: "Call Debit Spread" | "Put Debit Spread"; expiration: string;
  longStrike: number; shortStrike: number; longBid: number; longAsk: number;
  shortBid: number; shortAsk: number; longMid: number; shortMid: number;
  netDebit: number; width: number; maxProfit: number; maxLoss: number;
  breakeven: number; pop: number | null; pop50: number | null; riskReward: number;
};
type LiveIronCondor = {
  strategyType: "Iron Condor"; expiration: string;
  putShortStrike: number; putLongStrike: number; callShortStrike: number; callLongStrike: number;
  putCredit: number; callCredit: number; totalCredit: number; width: number;
  maxProfit: number; maxLoss: number; lowerBreakeven: number; upperBreakeven: number;
  pop: number | null; pop50: number | null; riskReward: number;
};
type LiveDiagonalSpread = {
  strategyType: "Call Diagonal" | "Put Diagonal"; nearExpiration: string; farExpiration: string;
  longStrike: number; shortStrike: number; longBid: number; longAsk: number;
  shortBid: number; shortAsk: number; longMid: number; shortMid: number; netDebit: number;
};
type LiveLongOption = {
  strategyType: "Long Call" | "Long Put"; expiration: string;
  strike: number; bid: number; ask: number; mid: number; maxRisk: number;
};
type AppUserRow = { user_id: string; daily_count: number; last_reset_date: string; is_premium: boolean; disclaimer_accepted: boolean };

type FinnhubCandles = { c?: number[]; h?: number[]; l?: number[]; o?: number[]; v?: number[]; t?: number[]; s?: string };
type FinnhubIndicator = { technicalAnalysis?: { signal?: string }; trend?: { adx?: number }; indicators?: Record<string, number[][]> };
type TechData = {
  rsi14: number | null; macdLine: number | null; macdSignal: number | null; macdHist: number | null;
  ema20: number | null; ema50: number | null; ema200: number | null;
  week52High: number | null; week52Low: number | null;
  weeklyResistance: number | null; weeklySupport: number | null;
  avgVolume20: number | null; currentVolume: number | null; volumeRatio: number | null;
  atr14: number | null; priceVsEma20: string | null; priceVsEma50: string | null; priceVsEma200: string | null;
};

function formatDate(date: Date): string { return date.toISOString().slice(0, 10); }

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") { const p = Number(value); return Number.isFinite(p) ? p : null; }
  return null;
}

function parseDateSafe(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeExpirations(data: TradierExpirationsResponse): string[] {
  const raw = data.expirations?.date;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function normalizeOptions(data: TradierChainResponse): TradierOptionContract[] {
  const raw = data.options?.option;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
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

function looksLikeTicker(input: string): boolean {
  return /^[A-Z.\-]{1,6}$/.test(input.trim().toUpperCase());
}

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
  if (looksLikeTicker(upper)) return { symbol: upper, resolvedFromName: false, originalInput: trimmed, resolvedDisplayName: null };
  const aliasKey = trimmed.toLowerCase();
  if (TICKER_ALIASES[aliasKey]) return { symbol: TICKER_ALIASES[aliasKey], resolvedFromName: true, originalInput: trimmed, resolvedDisplayName: trimmed };
  const searchRes = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(trimmed)}&token=${finnhubKey}`, { cache: "no-store" });
  if (!searchRes.ok) throw new Error("Failed to resolve company name to ticker.");
  const searchData = (await searchRes.json()) as FinnhubSearchResponse;
  const results = Array.isArray(searchData.result) ? searchData.result : [];
  const best = [...results].filter((i) => i.symbol && i.description).sort((a, b) => scoreSearchResult(b, trimmed) - scoreSearchResult(a, trimmed))[0];
  if (!best?.symbol) throw new Error(`Could not find a ticker match for "${trimmed}".`);
  return { symbol: best.symbol, resolvedFromName: true, originalInput: trimmed, resolvedDisplayName: best.description ?? null };
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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dte(expDate: Date): number {
  return Math.round((expDate.getTime() - Date.now()) / MS_PER_DAY);
}

// Target expiration for BOTH credit and debit strategies: ~45 DTE.
// This is the widely-cited trader consensus sweet spot (popularized by
// tastytrade's mechanical "sell/enter at 45 DTE, manage at 21 DTE" research):
// far enough out to keep theta decay manageable and give directional debit
// trades runway before time-value crush, but not so far that capital gets
// tied up or gamma risk becomes negligible.
const TARGET_DTE = 45;
const DTE_BAND = 15; // acceptable window: 30–60 DTE around the target

function chooseExpirationNearTarget(expirations: string[], earningsDate: string): string | null {
  if (!expirations.length) return null;
  const earnings = parseDateSafe(earningsDate);
  const today = new Date();

  const valid = expirations
    .map((e) => ({ raw: e, date: parseDateSafe(e) }))
    .filter((x): x is { raw: string; date: Date } => x.date !== null && x.date > today)
    .map((x) => ({ ...x, d: dte(x.date) }));

  if (!valid.length) return null;

  const closestToTarget = (pool: typeof valid) =>
    pool.slice().sort((a, b) => Math.abs(a.d - TARGET_DTE) - Math.abs(b.d - TARGET_DTE))[0].raw;

  // Prefer 30–60 DTE, stop before earnings if possible
  const band = valid.filter((x) => x.d >= TARGET_DTE - DTE_BAND && x.d <= TARGET_DTE + DTE_BAND);
  const bandBeforeEarnings = band.filter((x) => !earnings || x.date < earnings);
  if (bandBeforeEarnings.length) return closestToTarget(bandBeforeEarnings);

  // Fallback: 30–60 DTE even if earnings falls inside the window
  if (band.length) return closestToTarget(band);

  // Fallback: widen to anything with at least 14 DTE, pick nearest to 45
  const minDte = valid.filter((x) => x.d >= 14);
  if (minDte.length) return closestToTarget(minDte);

  // Last resort: nearest available expiration to the target, period
  return closestToTarget(valid);
}

// Both credit strategies (bull put, bear call, condor) and debit strategies
// (call/put debit, long options, diagonals) now target the same ~45 DTE
// expiration — see chooseExpirationNearTarget above.
function chooseCreditExpiration(expirations: string[], earningsDate: string): string | null {
  return chooseExpirationNearTarget(expirations, earningsDate);
}

function chooseDebitExpiration(expirations: string[], earningsDate: string): string | null {
  return chooseExpirationNearTarget(expirations, earningsDate);
}

// Legacy wrapper used for far expiration (diagonals)
function chooseNearExpiration(expirations: string[], earningsDate: string): string | null {
  return chooseCreditExpiration(expirations, earningsDate);
}

function chooseFarExpiration(expirations: string[], nearExpiration: string): string | null {
  const near = parseDateSafe(nearExpiration);
  if (!near) return null;
  const later = expirations.map((e) => ({ raw: e, date: parseDateSafe(e) })).filter((x): x is { raw: string; date: Date } => x.date !== null && x.date > near);
  if (!later.length) return null;
  return (later.find((x) => x.date.getTime() - near.getTime() >= 14 * 24 * 60 * 60 * 1000) ?? later[0]).raw;
}

// Nearest available expiration to an arbitrary target DTE — used to sample
// the IV term structure at points other than the strategy's chosen expiration.
function closestExpirationToDte(expirations: string[], targetDte: number, exclude: string[] = []): string | null {
  const today = new Date();
  const candidates = expirations
    .filter((e) => !exclude.includes(e))
    .map((e) => ({ raw: e, date: parseDateSafe(e) }))
    .filter((x): x is { raw: string; date: Date } => x.date !== null && x.date > today)
    .map((x) => ({ ...x, d: dte(x.date) }));
  if (!candidates.length) return null;
  return candidates.slice().sort((a, b) => Math.abs(a.d - targetDte) - Math.abs(b.d - targetDte))[0].raw;
}

// At-the-money implied vol for one expiration's chain — averages the call and
// put mid_iv at the strike closest to spot (falls back to whichever side has
// usable data). Tradier returns IV as a decimal (0.42 = 42%); we scale to a
// percent for readability.
function getAtmIV(options: TradierOptionContract[], price: number): number | null {
  const withIv = (list: { strike: number; iv: number | null }[]) =>
    list.filter((x): x is { strike: number; iv: number } => x.iv !== null);

  const calls = withIv(options.filter((o) => o.option_type === "call")
    .map((o) => ({ strike: toNumber(o.strike) ?? NaN, iv: toNumber(o.greeks?.mid_iv ?? o.greeks?.smv_vol ?? null) }))
    .filter((o) => !Number.isNaN(o.strike)));
  const puts = withIv(options.filter((o) => o.option_type === "put")
    .map((o) => ({ strike: toNumber(o.strike) ?? NaN, iv: toNumber(o.greeks?.mid_iv ?? o.greeks?.smv_vol ?? null) }))
    .filter((o) => !Number.isNaN(o.strike)));

  const closest = (list: { strike: number; iv: number }[]) =>
    list.length ? list.slice().sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price))[0] : null;

  const atmCall = closest(calls);
  const atmPut = closest(puts);

  if (atmCall && atmPut) return Math.round(((atmCall.iv + atmPut.iv) / 2) * 1000) / 10; // decimal -> percent, 1dp
  if (atmCall) return Math.round(atmCall.iv * 1000) / 10;
  if (atmPut) return Math.round(atmPut.iv * 1000) / 10;
  return null;
}

// 20-day annualized realized (historical) volatility from daily closes —
// the "is IV actually rich or cheap" baseline to compare the term structure against.
function calcRealizedVol(closes: number[], period = 20): number | null {
  if (closes.length < period + 1) return null;
  const recent = closes.slice(-(period + 1));
  const logReturns: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    if (recent[i - 1] > 0 && recent[i] > 0) logReturns.push(Math.log(recent[i] / recent[i - 1]));
  }
  if (logReturns.length < 2) return null;
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (logReturns.length - 1);
  const dailyStdev = Math.sqrt(variance);
  const annualized = dailyStdev * Math.sqrt(252);
  return Math.round(annualized * 1000) / 10; // decimal -> percent, 1dp
}

type VolTermPoint = { expiration: string; dte: number; atmIV: number | null };

function buildVolSection(points: VolTermPoint[], realizedVol: number | null): string {
  if (!points.length) return "";
  const lines = ["IMPLIED VOLATILITY TERM STRUCTURE (ATM, by expiration):"];
  points.forEach((p) => {
    lines.push(`- ${p.dte} DTE (${p.expiration}): ${p.atmIV != null ? `${p.atmIV}% IV` : "IV unavailable"}`);
  });

  const withIv = points.filter((p) => p.atmIV != null) as { expiration: string; dte: number; atmIV: number }[];
  if (withIv.length >= 2) {
    const shortest = withIv[0];
    const longest = withIv[withIv.length - 1];
    const slope = longest.atmIV - shortest.atmIV;
    const shape = Math.abs(slope) < 1.5 ? "flat" : slope > 0 ? "contango (further-dated options pricier — normal)" : "backwardation (near-dated options pricier — often event risk priced in)";
    lines.push(`- Term structure shape: ${shape} (${shortest.dte}D ${shortest.atmIV}% → ${longest.dte}D ${longest.atmIV}%)`);
  }

  if (realizedVol != null) {
    lines.push(`- 20-day realized volatility: ${realizedVol}%`);
    const midPoint = withIv.find((p) => Math.abs(p.dte - 45) <= 15) ?? withIv[0];
    if (midPoint) {
      const ratio = Math.round((midPoint.atmIV / realizedVol) * 100) / 100;
      const read = ratio >= 1.15 ? "IV running rich vs realized — favors selling premium (credit strategies)"
        : ratio <= 0.9 ? "IV running cheap vs realized — favors buying premium (debit strategies)"
        : "IV roughly in line with realized — no strong edge either way";
      lines.push(`- IV/RV ratio (~${midPoint.dte} DTE): ${ratio} — ${read}`);
    }
  }

  return lines.join("\n");
}

function computeCreditSpreadPop(d: number | null): number | null { return d == null ? null : Math.round((1 - Math.abs(d)) * 100); }
function computeDebitSpreadPop(d: number | null): number | null { return d == null ? null : Math.round(Math.abs(d) * 100); }
function computePop50(pop: number | null): number | null { return pop == null ? null : Math.round((pop + 50) / 2); }

function getCalls(options: TradierOptionContract[]) {
  return options.filter((o) => o.option_type === "call")
    .map((o) => ({ strike: toNumber(o.strike), bid: toNumber(o.bid), ask: toNumber(o.ask), delta: toNumber(o.greeks?.delta ?? null) }))
    .filter((o): o is { strike: number; bid: number; ask: number; delta: number | null } => o.strike !== null && o.bid !== null && o.ask !== null && o.bid >= 0 && o.ask >= o.bid)
    .sort((a, b) => a.strike - b.strike);
}

function getPuts(options: TradierOptionContract[]) {
  return options.filter((o) => o.option_type === "put")
    .map((o) => ({ strike: toNumber(o.strike), bid: toNumber(o.bid), ask: toNumber(o.ask), delta: toNumber(o.greeks?.delta ?? null) }))
    .filter((o): o is { strike: number; bid: number; ask: number; delta: number | null } => o.strike !== null && o.bid !== null && o.ask !== null && o.bid >= 0 && o.ask >= o.bid)
    .sort((a, b) => a.strike - b.strike);
}

// Choose wing width scaled to stock price and ATR
// Avoids $5-wide spreads on $14 stocks (long leg worthless) or $5-wide on $500 stocks (meaningless)
function chooseWingWidth(price: number, atr: number): number {
  // Target: ~1x ATR wide, snapped to common strike increments
  // Minimum $1 wide, maximum $20 wide
  const raw = Math.max(atr * 1.0, 1);
  // Snap to nearest: $1 for <$50, $2.50 for $50-$150, $5 for $150+
  if (price < 50)  return Math.max(1,  Math.round(raw));
  if (price < 150) return Math.max(2.5, Math.round(raw / 2.5) * 2.5);
  return Math.max(5, Math.round(raw / 5) * 5);
}

function buildBullPutSpread(options: TradierOptionContract[], price: number, minGap = 0, atr = 0): LiveCreditSpread | null {
  const puts = getPuts(options);
  if (puts.length < 2) return null;

  // Short put gap: for standalone spreads use 0.5x ATR min; condor passes its own minGap
  const effectiveMinGap = minGap > 0 ? minGap : Math.max(atr * 0.5, 0);
  const maxShortStrike = effectiveMinGap > 0 ? price - effectiveMinGap : price;
  const short = [...puts].reverse().find((p) => p.strike < maxShortStrike) ?? null;
  if (!short) return null;

  // Wing width: scale to price/ATR rather than hardcode $5
  const wingWidth = atr > 0 ? chooseWingWidth(price, atr) : 5;
  const long = puts.find((p) => p.strike === short.strike - wingWidth)
    ?? puts.find((p) => p.strike === short.strike - 5)
    ?? [...puts].reverse().find((p) => p.strike < short.strike) ?? null;
  if (!long) return null;

  const width = short.strike - long.strike;
  if (width <= 0) return null;
  const shortMid = (short.bid + short.ask) / 2, longMid = (long.bid + long.ask) / 2;
  const netCredit = shortMid - longMid;
  if (netCredit <= 0 || netCredit >= width) return null;
  const pop = computeCreditSpreadPop(short.delta);
  return { strategyType: "Bull Put Spread", expiration: "", shortStrike: short.strike, longStrike: long.strike, shortBid: short.bid, shortAsk: short.ask, longBid: long.bid, longAsk: long.ask, shortMid, longMid, netCredit, width, maxProfit: netCredit * 100, maxLoss: (width - netCredit) * 100, breakeven: short.strike - netCredit, pop, pop50: computePop50(pop), riskReward: Math.round((netCredit / (width - netCredit)) * 100) / 100 };
}

function buildBearCallSpread(options: TradierOptionContract[], price: number, minGap = 0, atr = 0): LiveCreditSpread | null {
  const calls = getCalls(options);
  if (calls.length < 2) return null;

  const effectiveMinGap = minGap > 0 ? minGap : Math.max(atr * 0.5, 0);
  const minShortStrike = effectiveMinGap > 0 ? price + effectiveMinGap : price;
  const short = calls.find((c) => c.strike > minShortStrike) ?? null;
  if (!short) return null;

  const wingWidth = atr > 0 ? chooseWingWidth(price, atr) : 5;
  const long = calls.find((c) => c.strike === short.strike + wingWidth)
    ?? calls.find((c) => c.strike === short.strike + 5)
    ?? calls.find((c) => c.strike > short.strike) ?? null;
  if (!long) return null;

  const width = long.strike - short.strike;
  if (width <= 0) return null;
  const shortMid = (short.bid + short.ask) / 2, longMid = (long.bid + long.ask) / 2;
  const netCredit = shortMid - longMid;
  if (netCredit <= 0 || netCredit >= width) return null;
  const pop = computeCreditSpreadPop(short.delta);
  return { strategyType: "Bear Call Spread", expiration: "", shortStrike: short.strike, longStrike: long.strike, shortBid: short.bid, shortAsk: short.ask, longBid: long.bid, longAsk: long.ask, shortMid, longMid, netCredit, width, maxProfit: netCredit * 100, maxLoss: (width - netCredit) * 100, breakeven: short.strike + netCredit, pop, pop50: computePop50(pop), riskReward: Math.round((netCredit / (width - netCredit)) * 100) / 100 };
}

function buildCallDebitSpread(options: TradierOptionContract[], price: number, atr = 0): LiveDebitSpread | null {
  const calls = getCalls(options);
  if (calls.length < 2) return null;
  const long = calls.find((c) => c.strike >= price) ?? [...calls].reverse().find((c) => c.strike < price) ?? null;
  if (!long) return null;
  const wingWidth = atr > 0 ? chooseWingWidth(price, atr) : 5;
  const short = calls.find((c) => c.strike === long.strike + wingWidth)
    ?? calls.find((c) => c.strike === long.strike + 5)
    ?? calls.find((c) => c.strike > long.strike) ?? null;
  if (!short) return null;
  const width = short.strike - long.strike;
  if (width <= 0) return null;
  const longMid = (long.bid + long.ask) / 2, shortMid = (short.bid + short.ask) / 2;
  const netDebit = longMid - shortMid;
  if (netDebit <= 0 || netDebit >= width) return null;
  const pop = computeDebitSpreadPop(long.delta);
  return { strategyType: "Call Debit Spread", expiration: "", longStrike: long.strike, shortStrike: short.strike, longBid: long.bid, longAsk: long.ask, shortBid: short.bid, shortAsk: short.ask, longMid, shortMid, netDebit, width, maxProfit: (width - netDebit) * 100, maxLoss: netDebit * 100, breakeven: long.strike + netDebit, pop, pop50: computePop50(pop), riskReward: Math.round(((width - netDebit) / netDebit) * 100) / 100 };
}

function buildPutDebitSpread(options: TradierOptionContract[], price: number, atr = 0): LiveDebitSpread | null {
  const puts = getPuts(options);
  if (puts.length < 2) return null;
  const long = [...puts].reverse().find((p) => p.strike <= price) ?? puts.find((p) => p.strike > price) ?? null;
  if (!long) return null;
  const wingWidth = atr > 0 ? chooseWingWidth(price, atr) : 5;
  const short = puts.find((p) => p.strike === long.strike - wingWidth)
    ?? puts.find((p) => p.strike === long.strike - 5)
    ?? [...puts].reverse().find((p) => p.strike < long.strike) ?? null;
  if (!short) return null;
  const width = long.strike - short.strike;
  if (width <= 0) return null;
  const longMid = (long.bid + long.ask) / 2, shortMid = (short.bid + short.ask) / 2;
  const netDebit = longMid - shortMid;
  if (netDebit <= 0 || netDebit >= width) return null;
  const pop = computeDebitSpreadPop(long.delta);
  return { strategyType: "Put Debit Spread", expiration: "", longStrike: long.strike, shortStrike: short.strike, longBid: long.bid, longAsk: long.ask, shortBid: short.bid, shortAsk: short.ask, longMid, shortMid, netDebit, width, maxProfit: (width - netDebit) * 100, maxLoss: netDebit * 100, breakeven: long.strike - netDebit, pop, pop50: computePop50(pop), riskReward: Math.round(((width - netDebit) / netDebit) * 100) / 100 };
}

function buildCallDiagonal(near: TradierOptionContract[], far: TradierOptionContract[], price: number, nearExp: string, farExp: string): LiveDiagonalSpread | null {
  const nearCalls = getCalls(near), farCalls = getCalls(far);
  if (!nearCalls.length || !farCalls.length) return null;
  const longCall = farCalls.find((c) => c.strike >= price) ?? [...farCalls].reverse().find((c) => c.strike < price) ?? null;
  if (!longCall) return null;
  const shortCall = nearCalls.find((c) => c.strike >= longCall.strike + 2.5) ?? nearCalls.find((c) => c.strike > longCall.strike) ?? nearCalls.find((c) => c.strike >= price) ?? null;
  if (!shortCall) return null;
  const longMid = (longCall.bid + longCall.ask) / 2, shortMid = (shortCall.bid + shortCall.ask) / 2;
  const netDebit = longMid - shortMid;
  if (netDebit <= 0) return null;
  return { strategyType: "Call Diagonal", nearExpiration: nearExp, farExpiration: farExp, longStrike: longCall.strike, shortStrike: shortCall.strike, longBid: longCall.bid, longAsk: longCall.ask, shortBid: shortCall.bid, shortAsk: shortCall.ask, longMid, shortMid, netDebit };
}

function buildPutDiagonal(near: TradierOptionContract[], far: TradierOptionContract[], price: number, nearExp: string, farExp: string): LiveDiagonalSpread | null {
  const nearPuts = getPuts(near), farPuts = getPuts(far);
  if (!nearPuts.length || !farPuts.length) return null;
  const longPut = [...farPuts].reverse().find((p) => p.strike <= price) ?? farPuts.find((p) => p.strike > price) ?? null;
  if (!longPut) return null;
  const shortPut = [...nearPuts].reverse().find((p) => p.strike <= longPut.strike - 2.5) ?? [...nearPuts].reverse().find((p) => p.strike < longPut.strike) ?? [...nearPuts].reverse().find((p) => p.strike <= price) ?? null;
  if (!shortPut) return null;
  const longMid = (longPut.bid + longPut.ask) / 2, shortMid = (shortPut.bid + shortPut.ask) / 2;
  const netDebit = longMid - shortMid;
  if (netDebit <= 0) return null;
  return { strategyType: "Put Diagonal", nearExpiration: nearExp, farExpiration: farExp, longStrike: longPut.strike, shortStrike: shortPut.strike, longBid: longPut.bid, longAsk: longPut.ask, shortBid: shortPut.bid, shortAsk: shortPut.ask, longMid, shortMid, netDebit };
}

function buildIronCondor(bullPut: LiveCreditSpread | null, bearCall: LiveCreditSpread | null): LiveIronCondor | null {
  if (!bullPut || !bearCall || bullPut.expiration !== bearCall.expiration || Math.abs(bullPut.width - bearCall.width) > 0.0001 || bullPut.shortStrike >= bearCall.shortStrike) return null;
  const totalCredit = bullPut.netCredit + bearCall.netCredit;
  if (totalCredit <= 0 || totalCredit >= bullPut.width) return null;
  const pop = bullPut.pop != null && bearCall.pop != null ? Math.round((bullPut.pop + bearCall.pop) / 2) : bullPut.pop ?? bearCall.pop ?? null;
  return { strategyType: "Iron Condor", expiration: bullPut.expiration, putShortStrike: bullPut.shortStrike, putLongStrike: bullPut.longStrike, callShortStrike: bearCall.shortStrike, callLongStrike: bearCall.longStrike, putCredit: bullPut.netCredit, callCredit: bearCall.netCredit, totalCredit, width: bullPut.width, maxProfit: totalCredit * 100, maxLoss: (bullPut.width - totalCredit) * 100, lowerBreakeven: bullPut.shortStrike - totalCredit, upperBreakeven: bearCall.shortStrike + totalCredit, pop, pop50: computePop50(pop), riskReward: Math.round((totalCredit / (bullPut.width - totalCredit)) * 100) / 100 };
}

function buildLongCall(options: TradierOptionContract[], price: number, exp: string): LiveLongOption | null {
  const calls = getCalls(options);
  if (!calls.length) return null;
  const c = calls.find((x) => x.strike >= price) ?? [...calls].reverse().find((x) => x.strike < price) ?? null;
  if (!c) return null;
  const mid = (c.bid + c.ask) / 2;
  return { strategyType: "Long Call", expiration: exp, strike: c.strike, bid: c.bid, ask: c.ask, mid, maxRisk: c.ask * 100 };
}

function buildLongPut(options: TradierOptionContract[], price: number, exp: string): LiveLongOption | null {
  const puts = getPuts(options);
  if (!puts.length) return null;
  const p = [...puts].reverse().find((x) => x.strike <= price) ?? puts.find((x) => x.strike > price) ?? null;
  if (!p) return null;
  const mid = (p.bid + p.ask) / 2;
  return { strategyType: "Long Put", expiration: exp, strike: p.strike, bid: p.bid, ask: p.ask, mid, maxRisk: p.ask * 100 };
}

function buildStrategySection(args: { callDebit: LiveDebitSpread | null; putDebit: LiveDebitSpread | null; bullPut: LiveCreditSpread | null; bearCall: LiveCreditSpread | null; callDiagonal: LiveDiagonalSpread | null; putDiagonal: LiveDiagonalSpread | null; ironCondor: LiveIronCondor | null; longCall: LiveLongOption | null; longPut: LiveLongOption | null }) {
  const sections: string[] = [];
  if (args.callDebit) sections.push(`LIVE STRATEGY CANDIDATE:\n- Strategy Type: ${args.callDebit.strategyType}\n- Expiration: ${args.callDebit.expiration}\n- Buy Call: ${args.callDebit.longStrike} | Sell Call: ${args.callDebit.shortStrike}\n- Long Call Bid/Ask: ${args.callDebit.longBid.toFixed(2)} / ${args.callDebit.longAsk.toFixed(2)}\n- Short Call Bid/Ask: ${args.callDebit.shortBid.toFixed(2)} / ${args.callDebit.shortAsk.toFixed(2)}\n- Net Debit: ${args.callDebit.netDebit.toFixed(2)} | Width: ${args.callDebit.width.toFixed(2)}\n- Max Profit: $${args.callDebit.maxProfit.toFixed(2)} | Max Loss: $${args.callDebit.maxLoss.toFixed(2)}\n- Breakeven: $${args.callDebit.breakeven.toFixed(2)} | R:R: ${args.callDebit.riskReward.toFixed(2)}:1${args.callDebit.pop != null ? ` | PoP: ${args.callDebit.pop}%` : ""}`);
  if (args.putDebit) sections.push(`LIVE STRATEGY CANDIDATE:\n- Strategy Type: ${args.putDebit.strategyType}\n- Expiration: ${args.putDebit.expiration}\n- Buy Put: ${args.putDebit.longStrike} | Sell Put: ${args.putDebit.shortStrike}\n- Long Put Bid/Ask: ${args.putDebit.longBid.toFixed(2)} / ${args.putDebit.longAsk.toFixed(2)}\n- Short Put Bid/Ask: ${args.putDebit.shortBid.toFixed(2)} / ${args.putDebit.shortAsk.toFixed(2)}\n- Net Debit: ${args.putDebit.netDebit.toFixed(2)} | Width: ${args.putDebit.width.toFixed(2)}\n- Max Profit: $${args.putDebit.maxProfit.toFixed(2)} | Max Loss: $${args.putDebit.maxLoss.toFixed(2)}\n- Breakeven: $${args.putDebit.breakeven.toFixed(2)} | R:R: ${args.putDebit.riskReward.toFixed(2)}:1${args.putDebit.pop != null ? ` | PoP: ${args.putDebit.pop}%` : ""}`);
  if (args.bullPut) sections.push(`LIVE STRATEGY CANDIDATE:\n- Strategy Type: ${args.bullPut.strategyType}\n- Expiration: ${args.bullPut.expiration}\n- Sell Put: ${args.bullPut.shortStrike} | Buy Put: ${args.bullPut.longStrike}\n- Short Put Bid/Ask: ${args.bullPut.shortBid.toFixed(2)} / ${args.bullPut.shortAsk.toFixed(2)}\n- Long Put Bid/Ask: ${args.bullPut.longBid.toFixed(2)} / ${args.bullPut.longAsk.toFixed(2)}\n- Net Credit: ${args.bullPut.netCredit.toFixed(2)} | Width: ${args.bullPut.width.toFixed(2)}\n- Max Profit: $${args.bullPut.maxProfit.toFixed(2)} | Max Loss: $${args.bullPut.maxLoss.toFixed(2)}\n- Breakeven: $${args.bullPut.breakeven.toFixed(2)} | R:R: ${args.bullPut.riskReward.toFixed(2)}:1${args.bullPut.pop != null ? ` | PoP: ${args.bullPut.pop}%` : ""}`);
  if (args.bearCall) sections.push(`LIVE STRATEGY CANDIDATE:\n- Strategy Type: ${args.bearCall.strategyType}\n- Expiration: ${args.bearCall.expiration}\n- Sell Call: ${args.bearCall.shortStrike} | Buy Call: ${args.bearCall.longStrike}\n- Short Call Bid/Ask: ${args.bearCall.shortBid.toFixed(2)} / ${args.bearCall.shortAsk.toFixed(2)}\n- Long Call Bid/Ask: ${args.bearCall.longBid.toFixed(2)} / ${args.bearCall.longAsk.toFixed(2)}\n- Net Credit: ${args.bearCall.netCredit.toFixed(2)} | Width: ${args.bearCall.width.toFixed(2)}\n- Max Profit: $${args.bearCall.maxProfit.toFixed(2)} | Max Loss: $${args.bearCall.maxLoss.toFixed(2)}\n- Breakeven: $${args.bearCall.breakeven.toFixed(2)} | R:R: ${args.bearCall.riskReward.toFixed(2)}:1${args.bearCall.pop != null ? ` | PoP: ${args.bearCall.pop}%` : ""}`);
  if (args.callDiagonal) sections.push(`LIVE STRATEGY CANDIDATE:\n- Strategy Type: ${args.callDiagonal.strategyType}\n- Near Exp: ${args.callDiagonal.nearExpiration} | Far Exp: ${args.callDiagonal.farExpiration}\n- Buy Far Call: ${args.callDiagonal.longStrike} | Sell Near Call: ${args.callDiagonal.shortStrike}\n- Net Debit: ${args.callDiagonal.netDebit.toFixed(2)} (path-dependent payoff)`);
  if (args.putDiagonal) sections.push(`LIVE STRATEGY CANDIDATE:\n- Strategy Type: ${args.putDiagonal.strategyType}\n- Near Exp: ${args.putDiagonal.nearExpiration} | Far Exp: ${args.putDiagonal.farExpiration}\n- Buy Far Put: ${args.putDiagonal.longStrike} | Sell Near Put: ${args.putDiagonal.shortStrike}\n- Net Debit: ${args.putDiagonal.netDebit.toFixed(2)} (path-dependent payoff)`);
  if (args.ironCondor) sections.push(`LIVE STRATEGY CANDIDATE:\n- Strategy Type: ${args.ironCondor.strategyType}\n- Expiration: ${args.ironCondor.expiration}\n- Put Side: Sell ${args.ironCondor.putShortStrike} / Buy ${args.ironCondor.putLongStrike}\n- Call Side: Sell ${args.ironCondor.callShortStrike} / Buy ${args.ironCondor.callLongStrike}\n- Total Credit: ${args.ironCondor.totalCredit.toFixed(2)} | Width: ${args.ironCondor.width.toFixed(2)}\n- Max Profit: $${args.ironCondor.maxProfit.toFixed(2)} | Max Loss: $${args.ironCondor.maxLoss.toFixed(2)}\n- Lower B/E: $${args.ironCondor.lowerBreakeven.toFixed(2)} | Upper B/E: $${args.ironCondor.upperBreakeven.toFixed(2)}${args.ironCondor.pop != null ? ` | PoP: ${args.ironCondor.pop}%` : ""}`);
  if (args.longCall) sections.push(`ALT TRADE IDEA (MAX RISK):\n- Strategy Type: ${args.longCall.strategyType}\n- Expiration: ${args.longCall.expiration} | Strike: ${args.longCall.strike}\n- Bid/Ask: ${args.longCall.bid.toFixed(2)} / ${args.longCall.ask.toFixed(2)} | Mid: $${args.longCall.mid.toFixed(2)}\n- Max Risk: $${args.longCall.maxRisk.toFixed(2)}`);
  if (args.longPut) sections.push(`ALT TRADE IDEA (MAX RISK):\n- Strategy Type: ${args.longPut.strategyType}\n- Expiration: ${args.longPut.expiration} | Strike: ${args.longPut.strike}\n- Bid/Ask: ${args.longPut.bid.toFixed(2)} / ${args.longPut.ask.toFixed(2)} | Mid: $${args.longPut.mid.toFixed(2)}\n- Max Risk: $${args.longPut.maxRisk.toFixed(2)}`);
  if (!sections.length) return "LIVE STRATEGY CANDIDATES:\n- No valid candidate found. Stay conceptual, avoid inventing premiums.\n";
  return sections.join("\n\n") + "\n\nIMPORTANT: Use only the live strategies shown above. Do not invent premiums for strategies not listed.\n";
}

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
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}

function calcMACD(closes: number[]): { macd: number | null; signal: number | null; hist: number | null } {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  if (ema12 === null || ema26 === null) return { macd: null, signal: null, hist: null };
  const macdLine = Math.round((ema12 - ema26) * 1000) / 1000;
  // Signal is 9-period EMA of MACD — approximate using last 9 MACD values
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

  // Weekly S/R: last 4 weeks high/low
  const weeklyCandles = closes.slice(-20);
  const weeklyHighs = highs.slice(-20);
  const weeklyLows = lows.slice(-20);
  const weeklyResistance = weeklyHighs.length ? Math.round(Math.max(...weeklyHighs) * 100) / 100 : null;
  const weeklySupport = weeklyLows.length ? Math.round(Math.min(...weeklyLows) * 100) / 100 : null;

  // Volume ratio: current vs 20-day avg
  const avgVolume20 = volumes.length >= 20
    ? Math.round(volumes.slice(-20).reduce((a, b) => a + b, 0) / 20)
    : null;
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

function buildTechnicalSection(tech: TechData, price: number): string {
  const lines: string[] = ["TECHNICAL ANALYSIS:"];

  // Momentum
  if (tech.rsi14 !== null) {
    const rsiSignal = tech.rsi14 >= 70 ? "Overbought" : tech.rsi14 <= 30 ? "Oversold" : tech.rsi14 >= 55 ? "Bullish" : tech.rsi14 <= 45 ? "Bearish" : "Neutral";
    lines.push(`- RSI(14): ${tech.rsi14} — ${rsiSignal}`);
  }
  if (tech.macdLine !== null && tech.macdSignal !== null) {
    const macdSignal = tech.macdLine > tech.macdSignal ? "Bullish crossover" : "Bearish crossover";
    lines.push(`- MACD: ${tech.macdLine} | Signal: ${tech.macdSignal} | Hist: ${tech.macdHist} — ${macdSignal}`);
  }
  if (tech.atr14 !== null) lines.push(`- ATR(14): $${tech.atr14} (daily range)`);

  // Moving averages
  if (tech.ema20 !== null) lines.push(`- EMA20: $${tech.ema20} — price is ${tech.priceVsEma20}`);
  if (tech.ema50 !== null) lines.push(`- EMA50: $${tech.ema50} — price is ${tech.priceVsEma50}`);
  if (tech.ema200 !== null) lines.push(`- EMA200: $${tech.ema200} — price is ${tech.priceVsEma200}`);

  // Trend summary
  const bullishMAs = [tech.priceVsEma20, tech.priceVsEma50, tech.priceVsEma200].filter(x => x === "above").length;
  lines.push(`- MA Trend: Price above ${bullishMAs}/3 key EMAs`);

  // Support/Resistance
  if (tech.week52High !== null) lines.push(`- 52-Week High: $${tech.week52High}`);
  if (tech.week52Low !== null) lines.push(`- 52-Week Low: $${tech.week52Low}`);
  if (tech.weeklyResistance !== null) lines.push(`- 4-Week Resistance: $${tech.weeklyResistance}`);
  if (tech.weeklySupport !== null) lines.push(`- 4-Week Support: $${tech.weeklySupport}`);

  // Volume
  if (tech.volumeRatio !== null) {
    const volSignal = tech.volumeRatio >= 1.5 ? "High volume — strong conviction" : tech.volumeRatio < 0.7 ? "Low volume — weak conviction" : "Normal volume";
    lines.push(`- Volume Ratio vs 20d avg: ${tech.volumeRatio}x — ${volSignal}`);
  }

  return lines.join("\n");
}

// ─── Gated regime strategy selection ─────────────────────────────────────────

type MarketRegime = "trend" | "moderate" | "neutral";

type BiasSignal = {
  bias: "Bullish" | "Bearish" | "Neutral";
  confidence: number; // 1-10
  trendStrength: "weak" | "moderate" | "strong";
  momentum: "bullish" | "bearish" | "mixed";
  regime: MarketRegime;
};

type StrategyKind = "callDebit" | "putDebit" | "bullPut" | "bearCall" | "callDiagonal" | "putDiagonal" | "ironCondor";

type RankedStrategy = {
  kind: StrategyKind;
  score: number;
  reason: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function inferBiasSignal(tech: TechData | null): BiasSignal {
  if (!tech) {
    return { bias: "Neutral", confidence: 5, trendStrength: "weak", momentum: "mixed", regime: "neutral" };
  }

  let bull = 0;
  let bear = 0;

  if (tech.rsi14 !== null) {
    if (tech.rsi14 >= 60 && tech.rsi14 < 75) bull += 1.25;
    else if (tech.rsi14 <= 40 && tech.rsi14 > 25) bear += 1.25;
    else if (tech.rsi14 >= 75) bear += 0.75;  // overbought — lean against
    else if (tech.rsi14 <= 25) bull += 0.75;  // oversold bounce
  }

  if (tech.macdLine !== null && tech.macdSignal !== null) {
    if (tech.macdLine > tech.macdSignal) bull += 1.25;
    if (tech.macdLine < tech.macdSignal) bear += 1.25;
  }

  if (tech.priceVsEma20 === "above") bull += 0.75;
  else if (tech.priceVsEma20 === "below") bear += 0.75;

  if (tech.priceVsEma50 === "above") bull += 1;
  else if (tech.priceVsEma50 === "below") bear += 1;

  if (tech.priceVsEma200 === "above") bull += 1.25;
  else if (tech.priceVsEma200 === "below") bear += 1.25;

  if (tech.volumeRatio !== null && tech.volumeRatio >= 1.4) {
    if (bull > bear) bull += 0.75;
    else if (bear > bull) bear += 0.75;
  }

  const diff = bull - bear;
  const absDiff = Math.abs(diff);
  const confidence = clamp(5 + absDiff * 1.3, 1, 10);

  const trendVotes = [tech.priceVsEma20, tech.priceVsEma50, tech.priceVsEma200].filter(x => x === "above" || x === "below");
  const alignedAbove = trendVotes.filter(x => x === "above").length;
  const alignedBelow = trendVotes.filter(x => x === "below").length;

  let trendStrength: BiasSignal["trendStrength"] = "weak";
  if (Math.max(alignedAbove, alignedBelow) >= 3) trendStrength = "strong";
  else if (Math.max(alignedAbove, alignedBelow) >= 2) trendStrength = "moderate";

  let bias: BiasSignal["bias"] = "Neutral";
  if (diff >= 1.25) bias = "Bullish";
  else if (diff <= -1.25) bias = "Bearish";

  let momentum: BiasSignal["momentum"] = "mixed";
  if (tech.macdLine !== null && tech.macdSignal !== null) {
    if (tech.macdLine > tech.macdSignal) momentum = "bullish";
    else if (tech.macdLine < tech.macdSignal) momentum = "bearish";
  }

  // ── STEP 1: Classify the market regime ──────────────────────────────────────
  // trend   = strong conviction + aligned trend → debit spreads
  // moderate = any lean with some signal → credit spreads
  // neutral  = genuinely flat, no signal at all → condor (rare)
  let regime: MarketRegime;
  if (confidence >= 7.0 && trendStrength === "strong") {
    regime = "trend";
  } else if (bias !== "Neutral" || confidence >= 5.5) {
    // moderate covers: any directional bias OR confidence above 5.5
    // this is the most common case — credit spreads live here
    regime = "moderate";
  } else {
    // neutral only when bias is genuinely flat AND confidence is low
    regime = "neutral";
  }

  return { bias, confidence, trendStrength, momentum, regime };
}

// ── Score helpers (only called within their allowed gate) ────────────────────

function scoreCreditSpread(s: LiveCreditSpread, signal: BiasSignal, tech: TechData | null, isBull: boolean): number {
  let score = 0;
  if (isBull && signal.bias === "Bullish") score += 20;
  if (!isBull && signal.bias === "Bearish") score += 20;
  if (s.pop !== null) score += Math.max(0, s.pop - 60) * 0.8;
  score += s.riskReward * 8;
  // bonus: short strike is beyond nearby S/R
  if (isBull && tech?.weeklySupport != null && s.shortStrike < tech.weeklySupport) score += 10;
  if (!isBull && tech?.weeklyResistance != null && s.shortStrike > tech.weeklyResistance) score += 10;
  // penalty: chasing extremes
  if (isBull && tech?.rsi14 != null && tech.rsi14 >= 72) score -= 12;
  if (!isBull && tech?.rsi14 != null && tech.rsi14 <= 28) score -= 12;
  return score;
}

function scoreDebitSpread(s: LiveDebitSpread, signal: BiasSignal, tech: TechData | null, isBull: boolean): number {
  let score = 0;
  if (isBull && signal.bias === "Bullish") score += 18;
  if (!isBull && signal.bias === "Bearish") score += 18;
  if (signal.momentum === (isBull ? "bullish" : "bearish")) score += 10;
  score += s.riskReward * 6;
  if (s.pop !== null) score += Math.max(0, s.pop - 45) * 0.4;
  if (tech?.volumeRatio != null && tech.volumeRatio >= 1.5) score += 5;
  return score;
}

function scoreIronCondor(s: LiveIronCondor, signal: BiasSignal, tech: TechData | null, price: number): number {
  let score = 50; // base — condor only runs in neutral gate so it starts ahead
  if (signal.confidence <= 5) score += 10;
  if (signal.trendStrength === "weak") score += 10;
  if (s.pop !== null) score += Math.max(0, s.pop - 55) * 0.6;
  score += s.riskReward * 6;
  if (tech?.volumeRatio != null && tech.volumeRatio < 1.1) score += 8;
  if (tech?.weeklySupport != null && tech?.weeklyResistance != null) {
    if (price > tech.weeklySupport && price < tech.weeklyResistance) score += 8;
  }
  return score;
}

// ── STEP 2+3: Gate then score ────────────────────────────────────────────────

function selectGatedStrategies(args: {
  signal: BiasSignal;
  tech: TechData | null;
  price: number;
  liveCallDebit: LiveDebitSpread | null;
  livePutDebit: LiveDebitSpread | null;
  liveBullPut: LiveCreditSpread | null;
  liveBearCall: LiveCreditSpread | null;
  liveCallDiagonal: LiveDiagonalSpread | null;
  livePutDiagonal: LiveDiagonalSpread | null;
  liveIronCondor: LiveIronCondor | null;
}): RankedStrategy[] {
  const { signal, tech, price } = args;
  const candidates: RankedStrategy[] = [];

  if (signal.regime === "trend") {
    // ── TREND: only directional plays ────────────────────────────────────────
    if (signal.bias !== "Bearish" && args.liveCallDebit) {
      candidates.push({ kind: "callDebit", score: scoreDebitSpread(args.liveCallDebit, signal, tech, true), reason: "Strong trend + conviction — full directional exposure justified." });
    }
    if (signal.bias !== "Bullish" && args.livePutDebit) {
      candidates.push({ kind: "putDebit", score: scoreDebitSpread(args.livePutDebit, signal, tech, false), reason: "Strong downtrend — put debit captures directional move." });
    }
    if (signal.bias !== "Bearish" && args.liveCallDiagonal) {
      candidates.push({ kind: "callDiagonal", score: 55, reason: "Trend regime but diagonal softens theta burn if move is gradual." });
    }
    if (signal.bias !== "Bullish" && args.livePutDiagonal) {
      candidates.push({ kind: "putDiagonal", score: 55, reason: "Downtrend regime but diagonal fits if collapse isn't immediate." });
    }
  }

  else if (signal.regime === "moderate") {
    // ── MODERATE: credit spreads dominate ────────────────────────────────────
    // When bias is clearly bearish, skip bull put. When clearly bullish, skip bear call.
    // When neutral/mixed, add BOTH and let scoring decide — highest PoP + R:R wins.
    if (signal.bias !== "Bearish" && args.liveBullPut) {
      const reason = signal.bias === "Bullish"
        ? "Moderate bullish setup — bull put collects premium below support."
        : "Mixed signals — bull put offers higher PoP than directional debit.";
      candidates.push({ kind: "bullPut", score: scoreCreditSpread(args.liveBullPut, signal, tech, true), reason });
    }
    if (signal.bias !== "Bullish" && args.liveBearCall) {
      const reason = signal.bias === "Bearish"
        ? "Moderate bearish setup — bear call captures premium above resistance."
        : "Mixed signals — bear call offers higher PoP than directional debit.";
      candidates.push({ kind: "bearCall", score: scoreCreditSpread(args.liveBearCall, signal, tech, false), reason });
    }
    // diagonals only as fallback if no credit spreads exist
    if (candidates.length === 0) {
      if (signal.bias !== "Bearish" && args.liveCallDiagonal) {
        candidates.push({ kind: "callDiagonal", score: 50, reason: "No credit spreads available — diagonal is next best moderate play." });
      }
      if (signal.bias !== "Bullish" && args.livePutDiagonal) {
        candidates.push({ kind: "putDiagonal", score: 50, reason: "No credit spreads available — put diagonal is next best moderate play." });
      }
    }

    // Escape hatch: allow debit spreads in moderate regime only when momentum clearly confirms.
    // Credit spreads still dominate — debit gets a -8 score penalty so it only wins when the setup is genuinely strong.
    const allowModerateDebit = signal.confidence >= 6.5 && signal.trendStrength !== "weak";
    if (allowModerateDebit) {
      if (signal.bias === "Bullish" && signal.momentum === "bullish" && args.liveCallDebit) {
        candidates.push({ kind: "callDebit", score: scoreDebitSpread(args.liveCallDebit, signal, tech, true) - 8, reason: "Moderate bullish setup with confirmed momentum — call debit allowed, but credit spreads still get priority." });
      }
      if (signal.bias === "Bearish" && signal.momentum === "bearish" && args.livePutDebit) {
        candidates.push({ kind: "putDebit", score: scoreDebitSpread(args.livePutDebit, signal, tech, false) - 8, reason: "Moderate bearish setup with confirmed momentum — put debit allowed, but credit spreads still get priority." });
      }
    }
  }

  else {
    // ── NEUTRAL: condor first, credit spreads as fallback ─────────────────────
    if (args.liveIronCondor) {
      candidates.push({ kind: "ironCondor", score: scoreIronCondor(args.liveIronCondor, signal, tech, price), reason: "Neutral/range-bound — condor collects on both sides." });
    }
    if (candidates.length === 0) {
      if (args.liveBullPut) {
        candidates.push({ kind: "bullPut", score: scoreCreditSpread(args.liveBullPut, signal, tech, true), reason: "No condor — bull put is safest fallback in low-conviction environment." });
      }
      if (args.liveBearCall) {
        candidates.push({ kind: "bearCall", score: scoreCreditSpread(args.liveBearCall, signal, tech, false), reason: "No condor — bear call captures elevated premium above current range." });
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

// ─── Free tier limits ─────────────────────────────────────────────────────────
const FREE_DAILY_LIMIT = 2; // signed-in free users; anon users are blocked entirely

export async function POST(req: Request) {
  try {
    const session = await auth();
    const email = session?.user?.email;

    const DEV_PREMIUM_EMAILS = ["jojomac79@gmail.com", "411oakyates@gmail.com"];
    const isDevPremium = !!email && DEV_PREMIUM_EMAILS.some((e) => e.toLowerCase() === email.toLowerCase());

    // Sign-in is required to use the app — no anonymous access
    const isSignedIn = !!email;
    if (!isSignedIn) {
      return NextResponse.json(
        { error: "Sign in with Google to use the analyzer.", limitType: "anon_limit" },
        { status: 401 }
      );
    }
    const userId = email;

    const todayKey = new Date().toISOString().slice(0, 10);

    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from("app_users").select("user_id, daily_count, last_reset_date, is_premium, disclaimer_accepted")
      .eq("user_id", userId).maybeSingle<AppUserRow>();
    if (fetchError) return NextResponse.json({ error: "Failed to check usage." }, { status: 500 });

    let userData: AppUserRow;
    if (!existingUser) {
      const { data: ins, error: insErr } = await supabaseAdmin.from("app_users")
        .insert([{ user_id: userId, daily_count: 0, last_reset_date: todayKey, is_premium: false }])
        .select("user_id, daily_count, last_reset_date, is_premium, disclaimer_accepted").single<AppUserRow>();
      if (insErr || !ins) return NextResponse.json({ error: "Failed to create usage record." }, { status: 500 });
      userData = ins;
    } else {
      userData = existingUser;
    }

    // Persist the dev-premium flag, not just set it in memory — otherwise
    // /api/disclaimer-status (which reads is_premium straight from the DB)
    // never sees it and the Pro badge / Manage Subscription UI stays wrong.
    if (isDevPremium && !userData.is_premium) {
      await supabaseAdmin.from("app_users").update({ is_premium: true }).eq("user_id", userId);
      userData.is_premium = true;
    }

    // Block if disclaimer not accepted
    if (!userData.disclaimer_accepted) {
      return NextResponse.json(
        { error: "Please accept the disclaimer before analyzing.", limitType: "disclaimer_required" },
        { status: 403 }
      );
    }

    // Reset count if it's a new day
    if (userData.last_reset_date !== todayKey) {
      await supabaseAdmin.from("app_users").update({ daily_count: 0, last_reset_date: todayKey }).eq("user_id", userId);
      userData.daily_count = 0;
    }

    // Enforce limits — premium users bypass entirely
    if (!userData.is_premium) {
      if (userData.daily_count >= FREE_DAILY_LIMIT) {
        return NextResponse.json(
          { error: "Daily limit reached. Upgrade to Pro for unlimited access.", limitType: "signed_in_limit" },
          { status: 403 }
        );
      }
    }

    await supabaseAdmin.from("app_users").update({ daily_count: userData.daily_count + 1 }).eq("user_id", userId);

    const { ticker } = await req.json();
    if (!ticker || typeof ticker !== "string") return NextResponse.json({ error: "Ticker is required." }, { status: 400 });

    const finnhubKey = process.env.FINNHUB_API_KEY;
    const tradierKey = process.env.TRADIER_API_KEY;
    if (!finnhubKey) return NextResponse.json({ error: "Missing FINNHUB_API_KEY" }, { status: 500 });
    if (!tradierKey) return NextResponse.json({ error: "Missing TRADIER_API_KEY" }, { status: 500 });
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });

    const resolved = await resolveInputToSymbol(ticker, finnhubKey);
    const symbol = resolved.symbol;
    const sym = encodeURIComponent(symbol);

    const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!alphaKey) return NextResponse.json({ error: "Missing ALPHA_VANTAGE_API_KEY" }, { status: 500 });

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
    if (!earningsRes.ok) return NextResponse.json({ error: `Failed to fetch earnings for ${symbol}.` }, { status: 500 });

    const quoteData = (await quoteRes.json()) as FinnhubQuote;
    const earningsData = (await earningsRes.json()) as FinnhubEarningsResponse;
    const newsData = newsRes.ok ? (await newsRes.json()) as FinnhubNewsItem[] : [];
    const candleData = candleRes.ok ? (await candleRes.json()) as FinnhubCandles : null;


    // Parse Alpha Vantage TIME_SERIES_DAILY into FinnhubCandles format
    let parsedCandles: FinnhubCandles | null = null;
    if (candleData) {
      const raw = candleData as unknown as Record<string, unknown>;
      const timeSeries = raw["Time Series (Daily)"] as Record<string, Record<string, string>> | undefined;
      if (timeSeries) {
        const dates = Object.keys(timeSeries).sort(); // ascending
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

    // Build technical analysis from candles
    const techData = parsedCandles && parsedCandles.c && parsedCandles.c.length > 0
      ? buildTechData(parsedCandles, currentPriceNumber)
      : null;
    const technicalSection = techData ? buildTechnicalSection(techData, currentPriceNumber) : "";

    const nextEarnings = earningsData.earningsCalendar?.length
      ? earningsData.earningsCalendar[0].date || "Upcoming"
      : "No upcoming earnings found in next 60 days";

    const keywords = buildNewsKeywords(symbol, resolved.resolvedDisplayName);
    const validNews = Array.isArray(newsData) ? newsData.filter((i) => i.headline && i.source && i.url) : [];
    const filtered = validNews.filter((i) => isRelevantHeadline(i, keywords));
    const recentHeadlines: HeadlineItem[] = (filtered.length ? filtered : validNews).slice(0, 5).map((i) => ({ headline: i.headline!, source: i.source!, url: i.url! }));

    const expRes = await fetch(`https://api.tradier.com/v1/markets/options/expirations?symbol=${sym}&includeAllRoots=true`, { headers: { Authorization: `Bearer ${tradierKey}`, Accept: "application/json" }, cache: "no-store" });
    if (!expRes.ok) return NextResponse.json({ error: `Failed to fetch expirations for ${symbol}.` }, { status: 500 });

    const expirations = normalizeExpirations((await expRes.json()) as TradierExpirationsResponse);

    // ── Pick expirations by strategy type ────────────────────────────────────
    // Both credit and debit strategies now target the same ~45 DTE sweet spot
    const creditExpiration = chooseCreditExpiration(expirations, nextEarnings);
    const debitExpiration  = chooseDebitExpiration(expirations, nextEarnings);

    if (!creditExpiration && !debitExpiration) {
      return NextResponse.json({ error: `No usable expiration for ${symbol}.` }, { status: 500 });
    }

    // Use credit expiration as the "near" reference (for UI display + diagonals)
    const nearExpiration = creditExpiration ?? debitExpiration!;
    const farExpiration  = chooseFarExpiration(expirations, nearExpiration);

    // ── IV term structure sampling (informational only — does not affect
    // which expiration gets traded, see chooseExpirationNearTarget) ──────────
    const volShortExpiration = closestExpirationToDte(expirations, 25, [nearExpiration]);
    const volLongExpiration  = closestExpirationToDte(expirations, 60, [nearExpiration, ...(volShortExpiration ? [volShortExpiration] : [])]);

    // Fetch chains — may need separate fetches for credit/debit expirations plus vol-sampling points
    const uniqueExps = [...new Set([
      creditExpiration, debitExpiration, volShortExpiration, volLongExpiration,
    ].filter(Boolean) as string[])];

    const chainMap: Record<string, TradierOptionContract[]> = {};
    await Promise.all(uniqueExps.map(async (exp) => {
      const res = await fetch(
        `https://api.tradier.com/v1/markets/options/chains?symbol=${sym}&expiration=${encodeURIComponent(exp)}&greeks=true`,
        { headers: { Authorization: `Bearer ${tradierKey}`, Accept: "application/json" }, cache: "no-store" }
      );
      if (res.ok) chainMap[exp] = normalizeOptions((await res.json()) as TradierChainResponse);
    }));

    const creditOptions = creditExpiration ? (chainMap[creditExpiration] ?? []) : [];
    const debitOptions  = debitExpiration  ? (chainMap[debitExpiration]  ?? []) : [];
    const nearOptions   = creditOptions.length ? creditOptions : debitOptions; // fallback for diagonals

    let farOptions: TradierOptionContract[] = [];
    if (farExpiration) {
      const farRes = await fetch(
        `https://api.tradier.com/v1/markets/options/chains?symbol=${sym}&expiration=${encodeURIComponent(farExpiration)}&greeks=true`,
        { headers: { Authorization: `Bearer ${tradierKey}`, Accept: "application/json" }, cache: "no-store" }
      );
      if (farRes.ok) farOptions = normalizeOptions((await farRes.json()) as TradierChainResponse);
    }

    // ── IV term structure + realized vol (informational, see buildVolSection) ──
    const volSampleExps = [...new Set([volShortExpiration, nearExpiration, volLongExpiration].filter(Boolean) as string[])];
    const volTermStructure: VolTermPoint[] = volSampleExps
      .map((exp) => {
        const d = parseDateSafe(exp);
        if (!d) return null;
        const chain = chainMap[exp] ?? [];
        return { expiration: exp, dte: dte(d), atmIV: chain.length ? getAtmIV(chain, currentPriceNumber) : null };
      })
      .filter((x): x is VolTermPoint => x !== null)
      .sort((a, b) => a.dte - b.dte);

    const realizedVol20 = parsedCandles?.c ? calcRealizedVol(parsedCandles.c, 20) : null;
    const volSection = buildVolSection(volTermStructure, realizedVol20);

    // ── Build strategies using appropriate expiration chains ─────────────────
    const atrGap = techData?.atr14 ?? 0;
    const condorMinGap = Math.max(atrGap * 1.0, 1);

    // Debit spreads: use debitOptions (~45 DTE) for adequate runway before theta crush
    let liveCallDebit = debitExpiration && debitOptions.length ? buildCallDebitSpread(debitOptions, currentPriceNumber, atrGap) : null;
    let livePutDebit  = debitExpiration && debitOptions.length ? buildPutDebitSpread(debitOptions, currentPriceNumber, atrGap) : null;
    if (liveCallDebit) liveCallDebit.expiration = debitExpiration!;
    if (livePutDebit)  livePutDebit.expiration  = debitExpiration!;

    // Credit spreads: use creditOptions (~45 DTE) for optimal theta burn
    let liveBullPut  = creditExpiration && creditOptions.length ? buildBullPutSpread(creditOptions, currentPriceNumber, 0, atrGap) : null;
    let liveBearCall = creditExpiration && creditOptions.length ? buildBearCallSpread(creditOptions, currentPriceNumber, 0, atrGap) : null;
    if (liveBullPut)  liveBullPut.expiration  = creditExpiration!;
    if (liveBearCall) liveBearCall.expiration = creditExpiration!;

    // Diagonals: near = credit exp, far = far exp
    const liveCallDiagonal = farExpiration && nearOptions.length && farOptions.length
      ? buildCallDiagonal(nearOptions, farOptions, currentPriceNumber, nearExpiration, farExpiration) : null;
    const livePutDiagonal  = farExpiration && nearOptions.length && farOptions.length
      ? buildPutDiagonal(nearOptions, farOptions, currentPriceNumber, nearExpiration, farExpiration) : null;

    // Iron Condor: credit expiration with ATR-based gap
    const condorBullPut  = creditExpiration && creditOptions.length ? buildBullPutSpread(creditOptions, currentPriceNumber, condorMinGap, atrGap) : null;
    const condorBearCall = creditExpiration && creditOptions.length ? buildBearCallSpread(creditOptions, currentPriceNumber, condorMinGap, atrGap) : null;
    if (condorBullPut)  condorBullPut.expiration  = creditExpiration!;
    if (condorBearCall) condorBearCall.expiration = creditExpiration!;
    const liveIronCondor = buildIronCondor(condorBullPut, condorBearCall);

    // Long options: use debit expiration for adequate time value
    const liveLongCall = debitExpiration && debitOptions.length ? buildLongCall(debitOptions, currentPriceNumber, debitExpiration) : null;
    const liveLongPut  = debitExpiration && debitOptions.length ? buildLongPut(debitOptions, currentPriceNumber, debitExpiration) : null;

    const resolutionSection = resolved.resolvedFromName
      ? `Input Resolved:\n- Original: ${resolved.originalInput}\n- Ticker: ${symbol}\n- Company: ${resolved.resolvedDisplayName ?? "Unknown"}`
      : `Input Resolved:\n- Ticker: ${symbol}`;

    const headlinesSection = recentHeadlines.length
      ? `RECENT HEADLINES:\n${recentHeadlines.map((h, i) => `${i + 1}. ${h.headline} (${h.source})`).join("\n")}`
      : "RECENT HEADLINES:\n- No relevant recent headlines found.";

    // ── Gated regime selection ───────────────────────────────────────────────
    const biasSignal = inferBiasSignal(techData);

    const gatedCandidates = selectGatedStrategies({
      signal: biasSignal,
      tech: techData,
      price: currentPriceNumber,
      liveCallDebit,
      livePutDebit,
      liveBullPut,
      liveBearCall,
      liveCallDiagonal,
      livePutDiagonal,
      liveIronCondor,
    });

    // ── Quality gate — only force No Trade on genuinely bad setups ──────────────
    const earningsDateParsed = nextEarnings !== "No upcoming earnings found in next 60 days"
      ? new Date(nextEarnings) : null;
    const nearExpDate = new Date(nearExpiration);
    const earningsInsideWindow = earningsDateParsed !== null && earningsDateParsed <= nearExpDate;

    const topCandidate = gatedCandidates[0] ?? null;

    const noTradeReasons: string[] = [];

    // 1. No candidates at all — genuinely nothing to show
    if (!topCandidate) {
      noTradeReasons.push("No valid strategy candidates found in current market regime.");
    }

    // 2. Iron condor credit dangerously thin (< 10% of wing width) — not just suboptimal
    if (topCandidate?.kind === "ironCondor" && liveIronCondor) {
      const creditRatio = liveIronCondor.totalCredit / liveIronCondor.width;
      if (creditRatio < 0.10) {
        noTradeReasons.push(`Iron condor credit ($${liveIronCondor.totalCredit.toFixed(2)}) is only ${(creditRatio * 100).toFixed(0)}% of wing width — not enough premium to justify the risk.`);
      }
    }

    // 3. Credit spread PoP critically low (< 52%) — short strike essentially at the money
    if (topCandidate?.kind === "bullPut" && liveBullPut?.pop != null && liveBullPut.pop < 52) {
      noTradeReasons.push(`Bull put PoP (${liveBullPut.pop}%) is critically low — short strike is essentially at the money.`);
    }
    if (topCandidate?.kind === "bearCall" && liveBearCall?.pop != null && liveBearCall.pop < 52) {
      noTradeReasons.push(`Bear call PoP (${liveBearCall.pop}%) is critically low — short strike is essentially at the money.`);
    }

    // 4. Earnings inside expiry — pass as a WARNING to Claude, not a hard gate
    // Claude will factor this in naturally from the earnings date in the prompt
    const earningsWarning = earningsInsideWindow
      ? `⚠️ EARNINGS WARNING: Earnings on ${nextEarnings} fall INSIDE the ${nearExpiration} expiration window — flag this prominently in the analysis and factor it into the grade.`
      : "";

    const forceNoTrade = noTradeReasons.length > 0;

    const regimeLabel =
      biasSignal.regime === "trend" ? `TREND (confidence ${biasSignal.confidence.toFixed(1)}/10, ${biasSignal.trendStrength} trend) → directional plays only` :
      biasSignal.regime === "moderate" ? `MODERATE (confidence ${biasSignal.confidence.toFixed(1)}/10) → credit spreads preferred` :
      `NEUTRAL (confidence ${biasSignal.confidence.toFixed(1)}/10, weak trend) → condor / range plays`;

    const gatedSection = forceNoTrade
      ? `MARKET REGIME: ${regimeLabel}

QUALITY GATE: NO TRADE — do not recommend a strategy. Reasons:
${noTradeReasons.map(r => `- ${r}`).join("\n")}

Tell the user clearly why no trade is recommended and what they should wait for.`
      : gatedCandidates.length
      ? `MARKET REGIME: ${regimeLabel}
${earningsWarning ? "\n" + earningsWarning : ""}

GATED STRATEGY SHORTLIST (scored within this regime only — pick from these):
${gatedCandidates.map((r, i) => `${i + 1}. ${r.kind} — score ${r.score.toFixed(1)} — ${r.reason}`).join("\n")}`
      : `MARKET REGIME: ${regimeLabel}
${earningsWarning ? "\n" + earningsWarning : ""}

GATED STRATEGY SHORTLIST:
- No valid candidates in this regime. Use No Trade.`;

    const prompt = `You are a sharp, no-BS stock trader with deep technical analysis expertise.

Analyze the stock: ${symbol}
Current Price: $${currentPrice}
Next Earnings Date: ${nextEarnings}

${resolutionSection}

${technicalSection ? technicalSection + "\n" : ""}
${volSection ? volSection + "\n" : ""}
${headlinesSection}

${gatedSection}

${buildStrategySection({ callDebit: liveCallDebit, putDebit: livePutDebit, bullPut: liveBullPut, bearCall: liveBearCall, callDiagonal: liveCallDiagonal, putDiagonal: livePutDiagonal, ironCondor: liveIronCondor, longCall: liveLongCall, longPut: liveLongPut })}

STRATEGY SELECTION RULES:
- If the QUALITY GATE says NO TRADE, you MUST recommend No Trade. Do not override it. Explain clearly why.
- If no quality gate, use the GATED STRATEGY SHORTLIST as your menu — pick from it only.
- The #1 ranked strategy in the shortlist is strongly preferred. Only pick #2 or lower with a specific reason.
- In TREND regime: debit spreads or diagonals only. Credit spreads are not appropriate here.
- In MODERATE regime: credit spreads dominate. Diagonals are only a fallback if no credit spread exists.
- In NEUTRAL regime: iron condor first. Credit spreads only if no condor is available.
- Do not invent live pricing for strategies not shown in the live candidates section.
- Use the IV term structure / IV-vs-realized-vol context as color for your reasoning (e.g. confidence, whether premium looks rich or cheap) — it does not override the regime-based strategy selection above.
- Use headlines as context only.
- If diagonal, note payoff is path-dependent.
- No Trade is a valid and sometimes correct answer — never force a trade just because candidates exist.

Format EXACTLY (no markdown bold on the first bullet of Overall Bias or Preferred Strategy):

Overall Bias:
- (Bullish / Bearish / Neutral) ← plain text, no bold
- Confidence: (X/10) ← a number like 6/10 or 7.5/10, no other text on this line
- (One sentence explaining why)

Preferred Strategy:
- (Strategy name exactly as written) ← plain text, no bold, must be one of: Call Debit Spread / Put Debit Spread / Bull Put Spread / Bear Call Spread / Call Diagonal / Put Diagonal / Iron Condor / No Trade
- (One sentence on why this structure fits the current regime)

Bull Case:
- (Upside driver)
- (Why buyers step in)
- (Narrative supporting the move)

Bear Case:
- (What could go wrong)
- (Where is the weakness)
- (What causes selling pressure)

Key Risks:
- (What invalidates the bull case)
- (Biggest unknown)
- (Near-term risk)

Short-Term Outlook (1-4 weeks):
- (Most likely scenario)
- (What to watch next)
- (What would change direction)

Trade Idea:
- (Live strategy with real strikes, expiration, debit/credit)
- Target: (price target or % profit target, e.g. "50% of max profit" or "$X price target")
- Invalidate: (specific price level that breaks the thesis)
- (If diagonal, mention path-dependent payoff)
- (If No Trade, say what confirmation is needed)

Alt Trade Idea (max risk):
- (Long Call for bullish / Long Put for bearish / None for neutral)
- (Strike, expiration, premium, max risk)

Tone: Direct. Concise. Trader-focused. No fluff. No financial-advisor wording.`;

    const message = await createMessageWithRetry(anthropic, {
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const outputText = message.content[0].type === "text" ? message.content[0].text : "";

    return NextResponse.json({
      result: outputText,
      meta: {
        symbol, originalInput: resolved.originalInput,
        resolvedFromName: resolved.resolvedFromName, resolvedDisplayName: resolved.resolvedDisplayName,
        currentPrice, nextEarnings, nearExpiration, farExpiration,
        liveCallDebit, livePutDebit, liveBullPut, liveBearCall,
        liveCallDiagonal, livePutDiagonal, liveIronCondor, liveLongCall, liveLongPut,
        recentHeadlines, techData,
        volTermStructure, realizedVol20,
      },
    });
  } catch (error) {
    console.error("Analyze error:", error);
    return NextResponse.json({ error: claudeErrorMessage(error) }, { status: 500 });
  }
}
