import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { auth } from "@/auth";

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
  greeks?: { delta?: number | string | null } | null;
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
type AppUserRow = { user_id: string; daily_count: number; last_reset_date: string; is_premium: boolean };

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

function chooseNearExpiration(expirations: string[], earningsDate: string): string | null {
  if (!expirations.length) return null;
  const today = new Date();
  const earnings = parseDateSafe(earningsDate);
  const valid = expirations.map((e) => ({ raw: e, date: parseDateSafe(e) })).filter((x): x is { raw: string; date: Date } => x.date !== null && x.date >= today);
  if (!valid.length) return null;
  if (earnings) { const before = valid.filter((x) => x.date <= earnings); if (before.length) return before[before.length - 1].raw; }
  return valid[0].raw;
}

function chooseFarExpiration(expirations: string[], nearExpiration: string): string | null {
  const near = parseDateSafe(nearExpiration);
  if (!near) return null;
  const later = expirations.map((e) => ({ raw: e, date: parseDateSafe(e) })).filter((x): x is { raw: string; date: Date } => x.date !== null && x.date > near);
  if (!later.length) return null;
  return (later.find((x) => x.date.getTime() - near.getTime() >= 14 * 24 * 60 * 60 * 1000) ?? later[0]).raw;
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

function buildBullPutSpread(options: TradierOptionContract[], price: number): LiveCreditSpread | null {
  const puts = getPuts(options);
  if (puts.length < 2) return null;
  const short = [...puts].reverse().find((p) => p.strike < price) ?? null;
  if (!short) return null;
  const long = puts.find((p) => p.strike === short.strike - 5) ?? [...puts].reverse().find((p) => p.strike < short.strike) ?? null;
  if (!long) return null;
  const width = short.strike - long.strike;
  if (width <= 0) return null;
  const shortMid = (short.bid + short.ask) / 2, longMid = (long.bid + long.ask) / 2;
  const netCredit = shortMid - longMid;
  if (netCredit <= 0 || netCredit >= width) return null;
  const pop = computeCreditSpreadPop(short.delta);
  return { strategyType: "Bull Put Spread", expiration: "", shortStrike: short.strike, longStrike: long.strike, shortBid: short.bid, shortAsk: short.ask, longBid: long.bid, longAsk: long.ask, shortMid, longMid, netCredit, width, maxProfit: netCredit * 100, maxLoss: (width - netCredit) * 100, breakeven: short.strike - netCredit, pop, pop50: computePop50(pop), riskReward: Math.round((netCredit / (width - netCredit)) * 100) / 100 };
}

function buildBearCallSpread(options: TradierOptionContract[], price: number): LiveCreditSpread | null {
  const calls = getCalls(options);
  if (calls.length < 2) return null;
  const short = calls.find((c) => c.strike > price) ?? null;
  if (!short) return null;
  const long = calls.find((c) => c.strike === short.strike + 5) ?? calls.find((c) => c.strike > short.strike) ?? null;
  if (!long) return null;
  const width = long.strike - short.strike;
  if (width <= 0) return null;
  const shortMid = (short.bid + short.ask) / 2, longMid = (long.bid + long.ask) / 2;
  const netCredit = shortMid - longMid;
  if (netCredit <= 0 || netCredit >= width) return null;
  const pop = computeCreditSpreadPop(short.delta);
  return { strategyType: "Bear Call Spread", expiration: "", shortStrike: short.strike, longStrike: long.strike, shortBid: short.bid, shortAsk: short.ask, longBid: long.bid, longAsk: long.ask, shortMid, longMid, netCredit, width, maxProfit: netCredit * 100, maxLoss: (width - netCredit) * 100, breakeven: short.strike + netCredit, pop, pop50: computePop50(pop), riskReward: Math.round((netCredit / (width - netCredit)) * 100) / 100 };
}

function buildCallDebitSpread(options: TradierOptionContract[], price: number): LiveDebitSpread | null {
  const calls = getCalls(options);
  if (calls.length < 2) return null;
  const long = calls.find((c) => c.strike >= price) ?? [...calls].reverse().find((c) => c.strike < price) ?? null;
  if (!long) return null;
  const short = calls.find((c) => c.strike === long.strike + 5) ?? calls.find((c) => c.strike > long.strike) ?? null;
  if (!short) return null;
  const width = short.strike - long.strike;
  if (width <= 0) return null;
  const longMid = (long.bid + long.ask) / 2, shortMid = (short.bid + short.ask) / 2;
  const netDebit = longMid - shortMid;
  if (netDebit <= 0 || netDebit >= width) return null;
  const pop = computeDebitSpreadPop(long.delta);
  return { strategyType: "Call Debit Spread", expiration: "", longStrike: long.strike, shortStrike: short.strike, longBid: long.bid, longAsk: long.ask, shortBid: short.bid, shortAsk: short.ask, longMid, shortMid, netDebit, width, maxProfit: (width - netDebit) * 100, maxLoss: netDebit * 100, breakeven: long.strike + netDebit, pop, pop50: computePop50(pop), riskReward: Math.round(((width - netDebit) / netDebit) * 100) / 100 };
}

function buildPutDebitSpread(options: TradierOptionContract[], price: number): LiveDebitSpread | null {
  const puts = getPuts(options);
  if (puts.length < 2) return null;
  const long = [...puts].reverse().find((p) => p.strike <= price) ?? puts.find((p) => p.strike > price) ?? null;
  if (!long) return null;
  const short = puts.find((p) => p.strike === long.strike - 5) ?? [...puts].reverse().find((p) => p.strike < long.strike) ?? null;
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

// ─── Free tier limits ─────────────────────────────────────────────────────────
const FREE_DAILY_LIMIT = 3; // signed-in free users; anon users are blocked entirely

export async function POST(req: Request) {
  try {
    const session = await auth();
    const email = session?.user?.email;

    const DEV_PREMIUM_EMAIL = "jojomac79@gmail.com";
    const isDevPremium = !!email && email.toLowerCase() === DEV_PREMIUM_EMAIL.toLowerCase();

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
      .from("app_users").select("user_id, daily_count, last_reset_date, is_premium")
      .eq("user_id", userId).maybeSingle<AppUserRow>();
    if (fetchError) return NextResponse.json({ error: "Failed to check usage." }, { status: 500 });

    let userData: AppUserRow;
    if (!existingUser) {
      const { data: ins, error: insErr } = await supabaseAdmin.from("app_users")
        .insert([{ user_id: userId, daily_count: 0, last_reset_date: todayKey, is_premium: false }])
        .select("user_id, daily_count, last_reset_date, is_premium").single<AppUserRow>();
      if (insErr || !ins) return NextResponse.json({ error: "Failed to create usage record." }, { status: 500 });
      userData = ins;
    } else {
      userData = existingUser;
    }

    if (isDevPremium) userData.is_premium = true;

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

    const today = new Date();
    const sixtyDaysOut = new Date(); sixtyDaysOut.setDate(today.getDate() + 60);
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(today.getDate() - 7);

    const [quoteRes, earningsRes, newsRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${finnhubKey}`, { cache: "no-store" }),
      fetch(`https://finnhub.io/api/v1/calendar/earnings?symbol=${sym}&from=${formatDate(today)}&to=${formatDate(sixtyDaysOut)}&token=${finnhubKey}`, { cache: "no-store" }),
      fetch(`https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${formatDate(sevenDaysAgo)}&to=${formatDate(today)}&token=${finnhubKey}`, { cache: "no-store" }),
    ]);

    if (!quoteRes.ok) return NextResponse.json({ error: `Failed to fetch quote for ${symbol}.` }, { status: 500 });
    if (!earningsRes.ok) return NextResponse.json({ error: `Failed to fetch earnings for ${symbol}.` }, { status: 500 });

    const quoteData = (await quoteRes.json()) as FinnhubQuote;
    const earningsData = (await earningsRes.json()) as FinnhubEarningsResponse;
    const newsData = newsRes.ok ? (await newsRes.json()) as FinnhubNewsItem[] : [];

    const currentPriceNumber = typeof quoteData.c === "number" && quoteData.c > 0 ? quoteData.c : null;
    if (!currentPriceNumber) return NextResponse.json({ error: `Could not determine price for ${symbol}.` }, { status: 500 });
    const currentPrice = currentPriceNumber.toFixed(2);

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
    const nearExpiration = chooseNearExpiration(expirations, nextEarnings);
    if (!nearExpiration) return NextResponse.json({ error: `No usable expiration for ${symbol}.` }, { status: 500 });
    const farExpiration = chooseFarExpiration(expirations, nearExpiration);

    const nearChainRes = await fetch(`https://api.tradier.com/v1/markets/options/chains?symbol=${sym}&expiration=${encodeURIComponent(nearExpiration)}&greeks=true`, { headers: { Authorization: `Bearer ${tradierKey}`, Accept: "application/json" }, cache: "no-store" });
    if (!nearChainRes.ok) return NextResponse.json({ error: `Failed to fetch options chain for ${symbol}.` }, { status: 500 });
    const nearOptions = normalizeOptions((await nearChainRes.json()) as TradierChainResponse);

    let farOptions: TradierOptionContract[] = [];
    if (farExpiration) {
      const farRes = await fetch(`https://api.tradier.com/v1/markets/options/chains?symbol=${sym}&expiration=${encodeURIComponent(farExpiration)}&greeks=true`, { headers: { Authorization: `Bearer ${tradierKey}`, Accept: "application/json" }, cache: "no-store" });
      if (farRes.ok) farOptions = normalizeOptions((await farRes.json()) as TradierChainResponse);
    }

    let liveCallDebit = buildCallDebitSpread(nearOptions, currentPriceNumber);
    let livePutDebit  = buildPutDebitSpread(nearOptions, currentPriceNumber);
    let liveBullPut   = buildBullPutSpread(nearOptions, currentPriceNumber);
    let liveBearCall  = buildBearCallSpread(nearOptions, currentPriceNumber);
    if (liveCallDebit) liveCallDebit.expiration = nearExpiration;
    if (livePutDebit)  livePutDebit.expiration  = nearExpiration;
    if (liveBullPut)   liveBullPut.expiration   = nearExpiration;
    if (liveBearCall)  liveBearCall.expiration  = nearExpiration;

    const liveCallDiagonal = farExpiration && farOptions.length ? buildCallDiagonal(nearOptions, farOptions, currentPriceNumber, nearExpiration, farExpiration) : null;
    const livePutDiagonal  = farExpiration && farOptions.length ? buildPutDiagonal(nearOptions, farOptions, currentPriceNumber, nearExpiration, farExpiration) : null;
    const liveIronCondor   = buildIronCondor(liveBullPut, liveBearCall);
    const liveLongCall     = buildLongCall(nearOptions, currentPriceNumber, nearExpiration);
    const liveLongPut      = buildLongPut(nearOptions, currentPriceNumber, nearExpiration);

    const resolutionSection = resolved.resolvedFromName
      ? `Input Resolved:\n- Original: ${resolved.originalInput}\n- Ticker: ${symbol}\n- Company: ${resolved.resolvedDisplayName ?? "Unknown"}`
      : `Input Resolved:\n- Ticker: ${symbol}`;

    const headlinesSection = recentHeadlines.length
      ? `RECENT HEADLINES:\n${recentHeadlines.map((h, i) => `${i + 1}. ${h.headline} (${h.source})`).join("\n")}`
      : "RECENT HEADLINES:\n- No relevant recent headlines found.";

    const prompt = `You are a sharp, no-BS stock trader.

Analyze the stock: ${symbol}
Current Price: $${currentPrice}
Next Earnings Date: ${nextEarnings}

${resolutionSection}

${headlinesSection}

${buildStrategySection({ callDebit: liveCallDebit, putDebit: livePutDebit, bullPut: liveBullPut, bearCall: liveBearCall, callDiagonal: liveCallDiagonal, putDiagonal: livePutDiagonal, ironCondor: liveIronCondor, longCall: liveLongCall, longPut: liveLongPut })}

Pick the best-fit strategy: Call Debit Spread / Put Debit Spread / Bull Put Spread / Bear Call Spread / Call Diagonal / Put Diagonal / Iron Condor / No Trade

Rules:
- Use headlines as supporting context only.
- Do not invent live pricing for strategies not shown above.
- If diagonal, note payoff is path-dependent.
- Bullish or Bearish when evidence leans that way. Neutral only when mixed.
- No Trade if no good live candidate exists.

Format EXACTLY (no markdown bold on the first bullet of Overall Bias or Preferred Strategy):

Overall Bias:
- (Bullish / Bearish / Neutral) ← plain text, no bold
- (Low / Medium / High conviction)
- (One sentence explaining why)

Preferred Strategy:
- (Strategy name exactly as written) ← plain text, no bold, must be one of: Call Debit Spread / Put Debit Spread / Bull Put Spread / Bear Call Spread / Call Diagonal / Put Diagonal / Iron Condor / No Trade
- (One sentence on why this structure fits)

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
- (If diagonal, mention path-dependent payoff)
- (If No Trade, say what confirmation is needed)

Alt Trade Idea (max risk):
- (Long Call for bullish / Long Put for bearish / None for neutral)
- (Strike, expiration, premium, max risk)

Tone: Direct. Concise. Trader-focused. No fluff. No financial-advisor wording.`;

    const message = await anthropic.messages.create({
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
        recentHeadlines,
      },
    });
  } catch (error) {
    console.error("Analyze error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Something went wrong." }, { status: 500 });
  }
}
