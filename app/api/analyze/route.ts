import OpenAI from "openai";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { auth } from "@/auth";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type FinnhubQuote = {
  c: number;
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
};

type FinnhubEarningsItem = {
  date?: string;
  hour?: string;
  symbol?: string;
};

type FinnhubEarningsResponse = {
  earningsCalendar?: FinnhubEarningsItem[];
};

type FinnhubNewsItem = {
  headline?: string;
  summary?: string;
  source?: string;
  url?: string;
  datetime?: number;
};

type FinnhubSearchResult = {
  description?: string;
  displaySymbol?: string;
  symbol?: string;
  type?: string;
};

type FinnhubSearchResponse = {
  count?: number;
  result?: FinnhubSearchResult[];
};

type HeadlineItem = {
  headline: string;
  source: string;
  url: string;
};

type TradierExpirationsResponse = {
  expirations?: {
    date?: string[] | string;
  };
};

type TradierOptionContract = {
  symbol?: string;
  description?: string;
  exch?: string;
  type?: string;
  option_type?: "put" | "call";
  strike?: number | string;
  expiration_date?: string;
  bid?: number | string | null;
  ask?: number | string | null;
  last?: number | string | null;
  volume?: number | string | null;
  open_interest?: number | string | null;
};

type TradierChainResponse = {
  options?: {
    option?: TradierOptionContract[] | TradierOptionContract;
  };
};

type LiveCreditSpread = {
  strategyType: "Bull Put Spread" | "Bear Call Spread";
  expiration: string;
  shortStrike: number;
  longStrike: number;
  shortBid: number;
  shortAsk: number;
  longBid: number;
  longAsk: number;
  shortMid: number;
  longMid: number;
  netCredit: number;
  width: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number;
};

type LiveDebitSpread = {
  strategyType: "Call Debit Spread" | "Put Debit Spread";
  expiration: string;
  longStrike: number;
  shortStrike: number;
  longBid: number;
  longAsk: number;
  shortBid: number;
  shortAsk: number;
  longMid: number;
  shortMid: number;
  netDebit: number;
  width: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number;
};

type LiveIronCondor = {
  strategyType: "Iron Condor";
  expiration: string;
  putShortStrike: number;
  putLongStrike: number;
  callShortStrike: number;
  callLongStrike: number;
  putCredit: number;
  callCredit: number;
  totalCredit: number;
  width: number;
  maxProfit: number;
  maxLoss: number;
  lowerBreakeven: number;
  upperBreakeven: number;
};

type LiveDiagonalSpread = {
  strategyType: "Call Diagonal" | "Put Diagonal";
  nearExpiration: string;
  farExpiration: string;
  longStrike: number;
  shortStrike: number;
  longBid: number;
  longAsk: number;
  shortBid: number;
  shortAsk: number;
  longMid: number;
  shortMid: number;
  netDebit: number;
};

type LiveLongOption = {
  strategyType: "Long Call" | "Long Put";
  expiration: string;
  strike: number;
  bid: number;
  ask: number;
  mid: number;
  maxRisk: number;
};

type AppUserRow = {
  user_id: string;
  daily_count: number;
  last_reset_date: string;
  is_premium: boolean;
};

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseDateSafe(dateString: string | null | undefined): Date | null {
  if (!dateString) return null;
  const d = new Date(dateString);
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

  if (symbol.includes(".") || displaySymbol.includes(".")) score -= 10;

  return score;
}

async function resolveInputToSymbol(
  rawInput: string,
  finnhubKey: string
): Promise<{
  symbol: string;
  resolvedFromName: boolean;
  originalInput: string;
  resolvedDisplayName: string | null;
}> {
  const trimmed = rawInput.trim();
  const upper = trimmed.toUpperCase();

  if (looksLikeTicker(upper)) {
    return {
      symbol: upper,
      resolvedFromName: false,
      originalInput: trimmed,
      resolvedDisplayName: null,
    };
  }

  const searchUrl = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(
    trimmed
  )}&token=${finnhubKey}`;

  const searchRes = await fetch(searchUrl, { cache: "no-store" });
  if (!searchRes.ok) {
    throw new Error("Failed to resolve company name to ticker.");
  }

  const searchData = (await searchRes.json()) as FinnhubSearchResponse;
  const results = Array.isArray(searchData.result) ? searchData.result : [];

  const best = [...results]
    .filter((item) => item.symbol && item.description)
    .sort((a, b) => scoreSearchResult(b, trimmed) - scoreSearchResult(a, trimmed))[0];

  if (!best?.symbol) {
    throw new Error(`Could not find a ticker match for "${trimmed}".`);
  }

  return {
    symbol: best.symbol,
    resolvedFromName: true,
    originalInput: trimmed,
    resolvedDisplayName: best.description ?? null,
  };
}

function buildNewsKeywords(symbol: string, companyName: string | null): string[] {
  const keywords = new Set<string>();

  keywords.add(symbol.toLowerCase());

  if (companyName) {
    const cleaned = companyName
      .replace(
        /\b(inc|inc\.|corp|corp\.|corporation|holdings|group|plc|ltd|limited|co|co\.)\b/gi,
        ""
      )
      .replace(/[.,]/g, " ")
      .trim();

    if (cleaned) {
      keywords.add(cleaned.toLowerCase());

      cleaned.split(/\s+/).forEach((part) => {
        if (part.length >= 4) keywords.add(part.toLowerCase());
      });
    }
  }

  return [...keywords];
}

function isRelevantHeadline(item: FinnhubNewsItem, keywords: string[]): boolean {
  const text = `${item.headline ?? ""} ${item.summary ?? ""}`.toLowerCase();
  return keywords.some((keyword) => text.includes(keyword));
}

function chooseNearExpiration(expirations: string[], earningsDate: string): string | null {
  if (!expirations.length) return null;

  const today = new Date();
  const earnings = parseDateSafe(earningsDate);

  const validFutureExpirations = expirations
    .map((exp) => ({ raw: exp, date: parseDateSafe(exp) }))
    .filter((x) => x.date && x.date >= today) as { raw: string; date: Date }[];

  if (!validFutureExpirations.length) return null;

  if (earnings) {
    const beforeEarnings = validFutureExpirations.filter((x) => x.date <= earnings);
    if (beforeEarnings.length > 0) {
      return beforeEarnings[beforeEarnings.length - 1].raw;
    }
  }

  return validFutureExpirations[0].raw;
}

function chooseFarExpiration(expirations: string[], nearExpiration: string): string | null {
  const near = parseDateSafe(nearExpiration);
  if (!near) return null;

  const later = expirations
    .map((exp) => ({ raw: exp, date: parseDateSafe(exp) }))
    .filter((x) => x.date && x.date > near) as { raw: string; date: Date }[];

  if (!later.length) return null;

  const atLeastTwoWeeksLater =
    later.find((x) => x.date.getTime() - near.getTime() >= 14 * 24 * 60 * 60 * 1000) ??
    later[0];

  return atLeastTwoWeeksLater.raw;
}

function getCalls(options: TradierOptionContract[]) {
  return options
    .filter((o) => o.option_type === "call")
    .map((o) => ({
      strike: toNumber(o.strike),
      bid: toNumber(o.bid),
      ask: toNumber(o.ask),
    }))
    .filter(
      (o): o is { strike: number; bid: number; ask: number } =>
        o.strike !== null &&
        o.bid !== null &&
        o.ask !== null &&
        o.bid >= 0 &&
        o.ask >= 0 &&
        o.ask >= o.bid
    )
    .sort((a, b) => a.strike - b.strike);
}

function getPuts(options: TradierOptionContract[]) {
  return options
    .filter((o) => o.option_type === "put")
    .map((o) => ({
      strike: toNumber(o.strike),
      bid: toNumber(o.bid),
      ask: toNumber(o.ask),
    }))
    .filter(
      (o): o is { strike: number; bid: number; ask: number } =>
        o.strike !== null &&
        o.bid !== null &&
        o.ask !== null &&
        o.bid >= 0 &&
        o.ask >= 0 &&
        o.ask >= o.bid
    )
    .sort((a, b) => a.strike - b.strike);
}

function buildBullPutSpread(
  options: TradierOptionContract[],
  currentPrice: number
): LiveCreditSpread | null {
  const puts = getPuts(options);
  if (puts.length < 2) return null;

  const shortPut = [...puts].reverse().find((p) => p.strike < currentPrice) ?? null;
  if (!shortPut) return null;

  const longPut =
    puts.find((p) => p.strike === shortPut.strike - 5) ??
    [...puts].reverse().find((p) => p.strike < shortPut.strike) ??
    null;

  if (!longPut) return null;

  const width = shortPut.strike - longPut.strike;
  if (width <= 0) return null;

  const shortMid = (shortPut.bid + shortPut.ask) / 2;
  const longMid = (longPut.bid + longPut.ask) / 2;
  const netCredit = shortMid - longMid;

  if (netCredit <= 0 || netCredit >= width) return null;

  return {
    strategyType: "Bull Put Spread",
    expiration: "",
    shortStrike: shortPut.strike,
    longStrike: longPut.strike,
    shortBid: shortPut.bid,
    shortAsk: shortPut.ask,
    longBid: longPut.bid,
    longAsk: longPut.ask,
    shortMid,
    longMid,
    netCredit,
    width,
    maxProfit: netCredit * 100,
    maxLoss: (width - netCredit) * 100,
    breakeven: shortPut.strike - netCredit,
  };
}

function buildBearCallSpread(
  options: TradierOptionContract[],
  currentPrice: number
): LiveCreditSpread | null {
  const calls = getCalls(options);
  if (calls.length < 2) return null;

  const shortCall = calls.find((c) => c.strike > currentPrice) ?? null;
  if (!shortCall) return null;

  const longCall =
    calls.find((c) => c.strike === shortCall.strike + 5) ??
    calls.find((c) => c.strike > shortCall.strike) ??
    null;

  if (!longCall) return null;

  const width = longCall.strike - shortCall.strike;
  if (width <= 0) return null;

  const shortMid = (shortCall.bid + shortCall.ask) / 2;
  const longMid = (longCall.bid + longCall.ask) / 2;
  const netCredit = shortMid - longMid;

  if (netCredit <= 0 || netCredit >= width) return null;

  return {
    strategyType: "Bear Call Spread",
    expiration: "",
    shortStrike: shortCall.strike,
    longStrike: longCall.strike,
    shortBid: shortCall.bid,
    shortAsk: shortCall.ask,
    longBid: longCall.bid,
    longAsk: longCall.ask,
    shortMid,
    longMid,
    netCredit,
    width,
    maxProfit: netCredit * 100,
    maxLoss: (width - netCredit) * 100,
    breakeven: shortCall.strike + netCredit,
  };
}

function buildCallDebitSpread(
  options: TradierOptionContract[],
  currentPrice: number
): LiveDebitSpread | null {
  const calls = getCalls(options);
  if (calls.length < 2) return null;

  const longCall =
    calls.find((c) => c.strike >= currentPrice) ??
    [...calls].reverse().find((c) => c.strike < currentPrice) ??
    null;

  if (!longCall) return null;

  const shortCall =
    calls.find((c) => c.strike === longCall.strike + 5) ??
    calls.find((c) => c.strike > longCall.strike) ??
    null;

  if (!shortCall) return null;

  const width = shortCall.strike - longCall.strike;
  if (width <= 0) return null;

  const longMid = (longCall.bid + longCall.ask) / 2;
  const shortMid = (shortCall.bid + shortCall.ask) / 2;
  const netDebit = longMid - shortMid;

  if (netDebit <= 0 || netDebit >= width) return null;

  return {
    strategyType: "Call Debit Spread",
    expiration: "",
    longStrike: longCall.strike,
    shortStrike: shortCall.strike,
    longBid: longCall.bid,
    longAsk: longCall.ask,
    shortBid: shortCall.bid,
    shortAsk: shortCall.ask,
    longMid,
    shortMid,
    netDebit,
    width,
    maxProfit: (width - netDebit) * 100,
    maxLoss: netDebit * 100,
    breakeven: longCall.strike + netDebit,
  };
}

function buildPutDebitSpread(
  options: TradierOptionContract[],
  currentPrice: number
): LiveDebitSpread | null {
  const puts = getPuts(options);
  if (puts.length < 2) return null;

  const longPut =
    [...puts].reverse().find((p) => p.strike <= currentPrice) ??
    puts.find((p) => p.strike > currentPrice) ??
    null;

  if (!longPut) return null;

  const shortPut =
    puts.find((p) => p.strike === longPut.strike - 5) ??
    [...puts].reverse().find((p) => p.strike < longPut.strike) ??
    null;

  if (!shortPut) return null;

  const width = longPut.strike - shortPut.strike;
  if (width <= 0) return null;

  const longMid = (longPut.bid + longPut.ask) / 2;
  const shortMid = (shortPut.bid + shortPut.ask) / 2;
  const netDebit = longMid - shortMid;

  if (netDebit <= 0 || netDebit >= width) return null;

  return {
    strategyType: "Put Debit Spread",
    expiration: "",
    longStrike: longPut.strike,
    shortStrike: shortPut.strike,
    longBid: longPut.bid,
    longAsk: longPut.ask,
    shortBid: shortPut.bid,
    shortAsk: shortPut.ask,
    longMid,
    shortMid,
    netDebit,
    width,
    maxProfit: (width - netDebit) * 100,
    maxLoss: netDebit * 100,
    breakeven: longPut.strike - netDebit,
  };
}

function buildCallDiagonal(
  nearOptions: TradierOptionContract[],
  farOptions: TradierOptionContract[],
  currentPrice: number,
  nearExpiration: string,
  farExpiration: string
): LiveDiagonalSpread | null {
  const nearCalls = getCalls(nearOptions);
  const farCalls = getCalls(farOptions);
  if (!nearCalls.length || !farCalls.length) return null;

  const longCall =
    farCalls.find((c) => c.strike >= currentPrice) ??
    [...farCalls].reverse().find((c) => c.strike < currentPrice) ??
    null;
  if (!longCall) return null;

  const shortCall =
    nearCalls.find((c) => c.strike >= longCall.strike + 2.5) ??
    nearCalls.find((c) => c.strike > longCall.strike) ??
    nearCalls.find((c) => c.strike >= currentPrice) ??
    null;
  if (!shortCall) return null;

  const longMid = (longCall.bid + longCall.ask) / 2;
  const shortMid = (shortCall.bid + shortCall.ask) / 2;
  const netDebit = longMid - shortMid;

  if (netDebit <= 0) return null;

  return {
    strategyType: "Call Diagonal",
    nearExpiration,
    farExpiration,
    longStrike: longCall.strike,
    shortStrike: shortCall.strike,
    longBid: longCall.bid,
    longAsk: longCall.ask,
    shortBid: shortCall.bid,
    shortAsk: shortCall.ask,
    longMid,
    shortMid,
    netDebit,
  };
}

function buildPutDiagonal(
  nearOptions: TradierOptionContract[],
  farOptions: TradierOptionContract[],
  currentPrice: number,
  nearExpiration: string,
  farExpiration: string
): LiveDiagonalSpread | null {
  const nearPuts = getPuts(nearOptions);
  const farPuts = getPuts(farOptions);
  if (!nearPuts.length || !farPuts.length) return null;

  const longPut =
    [...farPuts].reverse().find((p) => p.strike <= currentPrice) ??
    farPuts.find((p) => p.strike > currentPrice) ??
    null;
  if (!longPut) return null;

  const shortPut =
    [...nearPuts].reverse().find((p) => p.strike <= longPut.strike - 2.5) ??
    [...nearPuts].reverse().find((p) => p.strike < longPut.strike) ??
    [...nearPuts].reverse().find((p) => p.strike <= currentPrice) ??
    null;
  if (!shortPut) return null;

  const longMid = (longPut.bid + longPut.ask) / 2;
  const shortMid = (shortPut.bid + shortPut.ask) / 2;
  const netDebit = longMid - shortMid;

  if (netDebit <= 0) return null;

  return {
    strategyType: "Put Diagonal",
    nearExpiration,
    farExpiration,
    longStrike: longPut.strike,
    shortStrike: shortPut.strike,
    longBid: longPut.bid,
    longAsk: longPut.ask,
    shortBid: shortPut.bid,
    shortAsk: shortPut.ask,
    longMid,
    shortMid,
    netDebit,
  };
}

function buildIronCondor(
  bullPut: LiveCreditSpread | null,
  bearCall: LiveCreditSpread | null
): LiveIronCondor | null {
  if (!bullPut || !bearCall) return null;
  if (bullPut.expiration !== bearCall.expiration) return null;
  if (Math.abs(bullPut.width - bearCall.width) > 0.0001) return null;
  if (bullPut.shortStrike >= bearCall.shortStrike) return null;

  const width = bullPut.width;
  const totalCredit = bullPut.netCredit + bearCall.netCredit;

  if (totalCredit <= 0 || totalCredit >= width) return null;

  return {
    strategyType: "Iron Condor",
    expiration: bullPut.expiration,
    putShortStrike: bullPut.shortStrike,
    putLongStrike: bullPut.longStrike,
    callShortStrike: bearCall.shortStrike,
    callLongStrike: bearCall.longStrike,
    putCredit: bullPut.netCredit,
    callCredit: bearCall.netCredit,
    totalCredit,
    width,
    maxProfit: totalCredit * 100,
    maxLoss: (width - totalCredit) * 100,
    lowerBreakeven: bullPut.shortStrike - totalCredit,
    upperBreakeven: bearCall.shortStrike + totalCredit,
  };
}

function buildLongCall(
  options: TradierOptionContract[],
  currentPrice: number,
  expiration: string
): LiveLongOption | null {
  const calls = getCalls(options);
  if (!calls.length) return null;

  const contract =
    calls.find((c) => c.strike >= currentPrice) ??
    [...calls].reverse().find((c) => c.strike < currentPrice) ??
    null;

  if (!contract) return null;

  const mid = (contract.bid + contract.ask) / 2;

  return {
    strategyType: "Long Call",
    expiration,
    strike: contract.strike,
    bid: contract.bid,
    ask: contract.ask,
    mid,
    maxRisk: contract.ask * 100,
  };
}

function buildLongPut(
  options: TradierOptionContract[],
  currentPrice: number,
  expiration: string
): LiveLongOption | null {
  const puts = getPuts(options);
  if (!puts.length) return null;

  const contract =
    [...puts].reverse().find((p) => p.strike <= currentPrice) ??
    puts.find((p) => p.strike > currentPrice) ??
    null;

  if (!contract) return null;

  const mid = (contract.bid + contract.ask) / 2;

  return {
    strategyType: "Long Put",
    expiration,
    strike: contract.strike,
    bid: contract.bid,
    ask: contract.ask,
    mid,
    maxRisk: contract.ask * 100,
  };
}

function buildStrategySection(args: {
  callDebit: LiveDebitSpread | null;
  putDebit: LiveDebitSpread | null;
  bullPut: LiveCreditSpread | null;
  bearCall: LiveCreditSpread | null;
  callDiagonal: LiveDiagonalSpread | null;
  putDiagonal: LiveDiagonalSpread | null;
  ironCondor: LiveIronCondor | null;
  longCall: LiveLongOption | null;
  longPut: LiveLongOption | null;
}) {
  const sections: string[] = [];

  if (args.callDebit) {
    sections.push(`
LIVE STRATEGY CANDIDATE:
- Strategy Type: ${args.callDebit.strategyType}
- Expiration: ${args.callDebit.expiration}
- Buy Call: ${args.callDebit.longStrike}
- Sell Call: ${args.callDebit.shortStrike}
- Long Call Bid/Ask: ${args.callDebit.longBid.toFixed(2)} / ${args.callDebit.longAsk.toFixed(2)}
- Short Call Bid/Ask: ${args.callDebit.shortBid.toFixed(2)} / ${args.callDebit.shortAsk.toFixed(2)}
- Estimated Net Debit: ${args.callDebit.netDebit.toFixed(2)}
- Width: ${args.callDebit.width.toFixed(2)}
- Max Profit: $${args.callDebit.maxProfit.toFixed(2)}
- Max Loss: $${args.callDebit.maxLoss.toFixed(2)}
- Breakeven: $${args.callDebit.breakeven.toFixed(2)}
`);
  }

  if (args.putDebit) {
    sections.push(`
LIVE STRATEGY CANDIDATE:
- Strategy Type: ${args.putDebit.strategyType}
- Expiration: ${args.putDebit.expiration}
- Buy Put: ${args.putDebit.longStrike}
- Sell Put: ${args.putDebit.shortStrike}
- Long Put Bid/Ask: ${args.putDebit.longBid.toFixed(2)} / ${args.putDebit.longAsk.toFixed(2)}
- Short Put Bid/Ask: ${args.putDebit.shortBid.toFixed(2)} / ${args.putDebit.shortAsk.toFixed(2)}
- Estimated Net Debit: ${args.putDebit.netDebit.toFixed(2)}
- Width: ${args.putDebit.width.toFixed(2)}
- Max Profit: $${args.putDebit.maxProfit.toFixed(2)}
- Max Loss: $${args.putDebit.maxLoss.toFixed(2)}
- Breakeven: $${args.putDebit.breakeven.toFixed(2)}
`);
  }

  if (args.bullPut) {
    sections.push(`
LIVE STRATEGY CANDIDATE:
- Strategy Type: ${args.bullPut.strategyType}
- Expiration: ${args.bullPut.expiration}
- Sell Put: ${args.bullPut.shortStrike}
- Buy Put: ${args.bullPut.longStrike}
- Short Put Bid/Ask: ${args.bullPut.shortBid.toFixed(2)} / ${args.bullPut.shortAsk.toFixed(2)}
- Long Put Bid/Ask: ${args.bullPut.longBid.toFixed(2)} / ${args.bullPut.longAsk.toFixed(2)}
- Estimated Net Credit: ${args.bullPut.netCredit.toFixed(2)}
- Width: ${args.bullPut.width.toFixed(2)}
- Max Profit: $${args.bullPut.maxProfit.toFixed(2)}
- Max Loss: $${args.bullPut.maxLoss.toFixed(2)}
- Breakeven: $${args.bullPut.breakeven.toFixed(2)}
`);
  }

  if (args.bearCall) {
    sections.push(`
LIVE STRATEGY CANDIDATE:
- Strategy Type: ${args.bearCall.strategyType}
- Expiration: ${args.bearCall.expiration}
- Sell Call: ${args.bearCall.shortStrike}
- Buy Call: ${args.bearCall.longStrike}
- Short Call Bid/Ask: ${args.bearCall.shortBid.toFixed(2)} / ${args.bearCall.shortAsk.toFixed(2)}
- Long Call Bid/Ask: ${args.bearCall.longBid.toFixed(2)} / ${args.bearCall.longAsk.toFixed(2)}
- Estimated Net Credit: ${args.bearCall.netCredit.toFixed(2)}
- Width: ${args.bearCall.width.toFixed(2)}
- Max Profit: $${args.bearCall.maxProfit.toFixed(2)}
- Max Loss: $${args.bearCall.maxLoss.toFixed(2)}
- Breakeven: $${args.bearCall.breakeven.toFixed(2)}
`);
  }

  if (args.callDiagonal) {
    sections.push(`
LIVE STRATEGY CANDIDATE:
- Strategy Type: ${args.callDiagonal.strategyType}
- Near Expiration: ${args.callDiagonal.nearExpiration}
- Far Expiration: ${args.callDiagonal.farExpiration}
- Buy Far-Dated Call: ${args.callDiagonal.longStrike}
- Sell Near-Dated Call: ${args.callDiagonal.shortStrike}
- Long Call Bid/Ask: ${args.callDiagonal.longBid.toFixed(2)} / ${args.callDiagonal.longAsk.toFixed(2)}
- Short Call Bid/Ask: ${args.callDiagonal.shortBid.toFixed(2)} / ${args.callDiagonal.shortAsk.toFixed(2)}
- Estimated Net Debit: ${args.callDiagonal.netDebit.toFixed(2)}
- Note: Diagonal spread payoff is path-dependent. Do not invent exact max profit.
`);
  }

  if (args.putDiagonal) {
    sections.push(`
LIVE STRATEGY CANDIDATE:
- Strategy Type: ${args.putDiagonal.strategyType}
- Near Expiration: ${args.putDiagonal.nearExpiration}
- Far Expiration: ${args.putDiagonal.farExpiration}
- Buy Far-Dated Put: ${args.putDiagonal.longStrike}
- Sell Near-Dated Put: ${args.putDiagonal.shortStrike}
- Long Put Bid/Ask: ${args.putDiagonal.longBid.toFixed(2)} / ${args.putDiagonal.longAsk.toFixed(2)}
- Short Put Bid/Ask: ${args.putDiagonal.shortBid.toFixed(2)} / ${args.putDiagonal.shortAsk.toFixed(2)}
- Estimated Net Debit: ${args.putDiagonal.netDebit.toFixed(2)}
- Note: Diagonal spread payoff is path-dependent. Do not invent exact max profit.
`);
  }

  if (args.ironCondor) {
    sections.push(`
LIVE STRATEGY CANDIDATE:
- Strategy Type: ${args.ironCondor.strategyType}
- Expiration: ${args.ironCondor.expiration}
- Put Side: Sell ${args.ironCondor.putShortStrike} Put / Buy ${args.ironCondor.putLongStrike} Put
- Call Side: Sell ${args.ironCondor.callShortStrike} Call / Buy ${args.ironCondor.callLongStrike} Call
- Put Credit: ${args.ironCondor.putCredit.toFixed(2)}
- Call Credit: ${args.ironCondor.callCredit.toFixed(2)}
- Total Credit: ${args.ironCondor.totalCredit.toFixed(2)}
- Wing Width: ${args.ironCondor.width.toFixed(2)}
- Max Profit: $${args.ironCondor.maxProfit.toFixed(2)}
- Max Loss: $${args.ironCondor.maxLoss.toFixed(2)}
- Lower Breakeven: $${args.ironCondor.lowerBreakeven.toFixed(2)}
- Upper Breakeven: $${args.ironCondor.upperBreakeven.toFixed(2)}
`);
  }

  if (args.longCall) {
    sections.push(`
ALT TRADE IDEA (MAX RISK):
- Strategy Type: ${args.longCall.strategyType}
- Expiration: ${args.longCall.expiration}
- Strike: ${args.longCall.strike}
- Bid/Ask: ${args.longCall.bid.toFixed(2)} / ${args.longCall.ask.toFixed(2)}
- Estimated Mid: ${args.longCall.mid.toFixed(2)}
- Max Risk: $${args.longCall.maxRisk.toFixed(2)}
`);
  }

  if (args.longPut) {
    sections.push(`
ALT TRADE IDEA (MAX RISK):
- Strategy Type: ${args.longPut.strategyType}
- Expiration: ${args.longPut.expiration}
- Strike: ${args.longPut.strike}
- Bid/Ask: ${args.longPut.bid.toFixed(2)} / ${args.longPut.ask.toFixed(2)}
- Estimated Mid: ${args.longPut.mid.toFixed(2)}
- Max Risk: $${args.longPut.maxRisk.toFixed(2)}
`);
  }

  if (!sections.length) {
    return `
LIVE STRATEGY CANDIDATES:
- No valid live candidate was found from the current option chains.
- If discussing strategies, stay conceptual and avoid exact premium math.
`;
  }

  return `${sections.join("\n")}
IMPORTANT:
- Use only the live strategies shown above.
- If a strategy is not listed above, do not invent exact quotes for it.
- Pick the best-fit strategy based on bias, conviction, expected timing, and whether theta helps or hurts.
`;
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    const email = session?.user?.email;
    const fallbackUserId = req.headers.get("x-user-id");
    const userId = email || fallbackUserId;

    if (!userId) {
      return NextResponse.json({ error: "Missing user identity." }, { status: 401 });
    }

    const todayKey = new Date().toISOString().slice(0, 10);

    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from("app_users")
      .select("user_id, daily_count, last_reset_date, is_premium")
      .eq("user_id", userId)
      .maybeSingle<AppUserRow>();

    if (fetchError) {
      console.error("Supabase fetch error:", fetchError);
      return NextResponse.json({ error: "Failed to check usage." }, { status: 500 });
    }

    let userData = existingUser;

    if (!userData) {
      const { data: insertedUser, error: insertError } = await supabaseAdmin
        .from("app_users")
        .insert([
          {
            user_id: userId,
            daily_count: 0,
            last_reset_date: todayKey,
            is_premium: false,
          },
        ])
        .select("user_id, daily_count, last_reset_date, is_premium")
        .single<AppUserRow>();

      if (insertError) {
        console.error("Supabase insert error:", insertError);
        return NextResponse.json({ error: "Failed to create usage record." }, { status: 500 });
      }

      userData = insertedUser;
    }

    if (userData.last_reset_date !== todayKey) {
      const { error: resetError } = await supabaseAdmin
        .from("app_users")
        .update({
          daily_count: 0,
          last_reset_date: todayKey,
        })
        .eq("user_id", userId);

      if (resetError) {
        console.error("Supabase reset error:", resetError);
        return NextResponse.json({ error: "Failed to reset daily usage." }, { status: 500 });
      }

      userData.daily_count = 0;
      userData.last_reset_date = todayKey;
    }

    if (userData.daily_count >= 3 && !userData.is_premium) {
      return NextResponse.json(
        { error: "Daily limit reached. Sign in or upgrade for more access." },
        { status: 403 }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("app_users")
      .update({ daily_count: userData.daily_count + 1 })
      .eq("user_id", userId);

    if (updateError) {
      console.error("Supabase update error:", updateError);
      return NextResponse.json({ error: "Failed to update usage." }, { status: 500 });
    }

    const { ticker } = await req.json();

    if (!ticker || typeof ticker !== "string") {
      return NextResponse.json({ error: "Ticker is required." }, { status: 400 });
    }

    const finnhubKey = process.env.FINNHUB_API_KEY;
    const tradierKey = process.env.TRADIER_API_KEY;

    if (!finnhubKey) {
      return NextResponse.json(
        { error: "Missing FINNHUB_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    if (!tradierKey) {
      return NextResponse.json(
        { error: "Missing TRADIER_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    const resolved = await resolveInputToSymbol(ticker, finnhubKey);
    const symbol = resolved.symbol;

    const today = new Date();
    const sixtyDaysOut = new Date();
    sixtyDaysOut.setDate(today.getDate() + 60);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 7);

    const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(
      symbol
    )}&token=${finnhubKey}`;

    const earningsUrl =
      `https://finnhub.io/api/v1/calendar/earnings?symbol=${encodeURIComponent(symbol)}` +
      `&from=${formatDate(today)}&to=${formatDate(sixtyDaysOut)}&token=${finnhubKey}`;

    const newsUrl =
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}` +
      `&from=${formatDate(sevenDaysAgo)}&to=${formatDate(today)}&token=${finnhubKey}`;

    const [quoteRes, earningsRes, newsRes] = await Promise.all([
      fetch(quoteUrl, { cache: "no-store" }),
      fetch(earningsUrl, { cache: "no-store" }),
      fetch(newsUrl, { cache: "no-store" }),
    ]);

    if (!quoteRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch quote data for ${symbol}.` },
        { status: 500 }
      );
    }

    if (!earningsRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch earnings data for ${symbol}.` },
        { status: 500 }
      );
    }

    if (!newsRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch recent headlines for ${symbol}.` },
        { status: 500 }
      );
    }

    const quoteData = (await quoteRes.json()) as FinnhubQuote;
    const earningsData = (await earningsRes.json()) as FinnhubEarningsResponse;
    const newsData = (await newsRes.json()) as FinnhubNewsItem[];

    const newsKeywords = buildNewsKeywords(symbol, resolved.resolvedDisplayName);

    const filteredNews = Array.isArray(newsData)
      ? newsData
          .filter((item) => item.headline && item.source && item.url)
          .filter((item) => isRelevantHeadline(item, newsKeywords))
      : [];

    const recentHeadlines: HeadlineItem[] = filteredNews.slice(0, 5).map((item) => ({
      headline: item.headline!,
      source: item.source!,
      url: item.url!,
    }));

    const currentPriceNumber =
      typeof quoteData.c === "number" && quoteData.c > 0 ? quoteData.c : null;

    if (!currentPriceNumber) {
      return NextResponse.json(
        { error: `Could not determine current price for ${symbol}.` },
        { status: 500 }
      );
    }

    const currentPrice = currentPriceNumber.toFixed(2);

    const nextEarnings =
      earningsData.earningsCalendar && earningsData.earningsCalendar.length > 0
        ? earningsData.earningsCalendar[0].date || "Upcoming"
        : "No upcoming earnings found in next 60 days";

    const expirationsRes = await fetch(
      `https://api.tradier.com/v1/markets/options/expirations?symbol=${encodeURIComponent(
        symbol
      )}&includeAllRoots=true`,
      {
        headers: {
          Authorization: `Bearer ${tradierKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!expirationsRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch Tradier expirations for ${symbol}.` },
        { status: 500 }
      );
    }

    const expirationsData = (await expirationsRes.json()) as TradierExpirationsResponse;
    const expirations = normalizeExpirations(expirationsData);

    const nearExpiration = chooseNearExpiration(expirations, nextEarnings);
    if (!nearExpiration) {
      return NextResponse.json(
        { error: `No usable Tradier expiration found for ${symbol}.` },
        { status: 500 }
      );
    }

    const farExpiration = chooseFarExpiration(expirations, nearExpiration);

    const nearChainRes = await fetch(
      `https://api.tradier.com/v1/markets/options/chains?symbol=${encodeURIComponent(
        symbol
      )}&expiration=${encodeURIComponent(nearExpiration)}&greeks=false`,
      {
        headers: {
          Authorization: `Bearer ${tradierKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!nearChainRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch Tradier options chain for ${symbol}.` },
        { status: 500 }
      );
    }

    const nearChainData = (await nearChainRes.json()) as TradierChainResponse;
    const nearOptions = normalizeOptions(nearChainData);

    let farOptions: TradierOptionContract[] = [];
    if (farExpiration) {
      const farChainRes = await fetch(
        `https://api.tradier.com/v1/markets/options/chains?symbol=${encodeURIComponent(
          symbol
        )}&expiration=${encodeURIComponent(farExpiration)}&greeks=false`,
        {
          headers: {
            Authorization: `Bearer ${tradierKey}`,
            Accept: "application/json",
          },
          cache: "no-store",
        }
      );

      if (farChainRes.ok) {
        const farChainData = (await farChainRes.json()) as TradierChainResponse;
        farOptions = normalizeOptions(farChainData);
      }
    }

    let liveCallDebit = buildCallDebitSpread(nearOptions, currentPriceNumber);
    let livePutDebit = buildPutDebitSpread(nearOptions, currentPriceNumber);
    let liveBullPut = buildBullPutSpread(nearOptions, currentPriceNumber);
    let liveBearCall = buildBearCallSpread(nearOptions, currentPriceNumber);

    if (liveCallDebit) liveCallDebit.expiration = nearExpiration;
    if (livePutDebit) livePutDebit.expiration = nearExpiration;
    if (liveBullPut) liveBullPut.expiration = nearExpiration;
    if (liveBearCall) liveBearCall.expiration = nearExpiration;

    const liveCallDiagonal =
      farExpiration && farOptions.length
        ? buildCallDiagonal(
            nearOptions,
            farOptions,
            currentPriceNumber,
            nearExpiration,
            farExpiration
          )
        : null;

    const livePutDiagonal =
      farExpiration && farOptions.length
        ? buildPutDiagonal(
            nearOptions,
            farOptions,
            currentPriceNumber,
            nearExpiration,
            farExpiration
          )
        : null;

    const liveIronCondor = buildIronCondor(liveBullPut, liveBearCall);
    const liveLongCall = buildLongCall(nearOptions, currentPriceNumber, nearExpiration);
    const liveLongPut = buildLongPut(nearOptions, currentPriceNumber, nearExpiration);

    const strategySection = buildStrategySection({
      callDebit: liveCallDebit,
      putDebit: livePutDebit,
      bullPut: liveBullPut,
      bearCall: liveBearCall,
      callDiagonal: liveCallDiagonal,
      putDiagonal: livePutDiagonal,
      ironCondor: liveIronCondor,
      longCall: liveLongCall,
      longPut: liveLongPut,
    });

    const headlinesSection =
      recentHeadlines.length > 0
        ? `
RECENT HEADLINES:
${recentHeadlines
  .map((item, index) => `${index + 1}. ${item.headline} (${item.source})`)
  .join("\n")}
`
        : `
RECENT HEADLINES:
- No tightly relevant recent headlines found.
`;

    const resolutionSection = resolved.resolvedFromName
      ? `Input Resolved:
- Original input: ${resolved.originalInput}
- Resolved ticker: ${resolved.symbol}
- Resolved company: ${resolved.resolvedDisplayName ?? "Unknown"}
`
      : `Input Resolved:
- Original input: ${resolved.originalInput}
- Resolved ticker: ${resolved.symbol}
`;

    const prompt = `
You are a sharp, no-BS stock trader.

Analyze the stock: ${symbol}
Current Price: $${currentPrice}
Next Earnings Date: ${nextEarnings}

${resolutionSection}
${headlinesSection}
${strategySection}

Your job is to pick the best-fit strategy from the following allowed list only:
- Call Debit Spread
- Put Debit Spread
- Bull Put Spread
- Bear Call Spread
- Call Diagonal
- Put Diagonal
- Iron Condor
- No Trade

Also consider an Alt Trade Idea (max risk):
- Bullish setups can use the live Long Call if available
- Bearish setups can use the live Long Put if available
- Neutral setups usually should not use an alt trade idea

Pick based on:
- direction
- conviction
- expected speed of move
- whether theta helps
- whether range-bound conditions are more likely than trend

Rules:
- Use the provided headlines as supporting context only.
- Do not invent live pricing for strategies not shown above.
- If diagonal spreads are considered, note that payoff is path-dependent.
- Use Bullish or Bearish when evidence leans that way.
- Use Neutral only when the setup is mixed or range-bound.
- If there is no good live candidate, choose No Trade.

Format EXACTLY like this:

Overall Bias:
- (Bullish / Bearish / Neutral)
- (Low / Medium / High conviction)
- (One sentence explaining why)

Preferred Strategy:
- (One of: Call Debit Spread / Put Debit Spread / Bull Put Spread / Bear Call Spread / Call Diagonal / Put Diagonal / Iron Condor / No Trade)
- (One sentence explaining why this structure fits better than the others)

Bull Case:
- (What is actually driving upside right now?)
- (Why would buyers step in?)
- (What narrative supports the move?)

Bear Case:
- (What could realistically go wrong?)
- (Where is the weakness?)
- (What would cause selling pressure?)

Key Risks:
- (What invalidates the bull case?)
- (What is the biggest unknown?)
- (What near-term risk matters most?)

Short-Term Outlook (1-4 weeks):
- (Most likely scenario)
- (What to watch next)
- (What would change the direction)

Trade Idea:
- (Use the chosen live strategy if one exists)
- (Include the real live expiration info, strikes, and debit/credit math that was provided)
- (If diagonal, mention near expiration, far expiration, and that payoff is path-dependent)
- (If No Trade, say what confirmation would be needed)
- (Keep it educational, not a directive)

Alt Trade Idea (max risk):
- (For bullish setups, use the live Long Call if available)
- (For bearish setups, use the live Long Put if available)
- (For neutral or if unavailable, say None)
- (Include strike, expiration, premium, and max risk if available)

Tone:
- Direct
- Concise
- Trader-focused
- No fluff
- No textbook language
- No financial-advisor wording
`;

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    return NextResponse.json({
      result: response.output_text,
      meta: {
        symbol,
        originalInput: resolved.originalInput,
        resolvedFromName: resolved.resolvedFromName,
        resolvedDisplayName: resolved.resolvedDisplayName,
        currentPrice,
        nextEarnings,
        nearExpiration,
        farExpiration,
        liveCallDebit,
        livePutDebit,
        liveBullPut,
        liveBearCall,
        liveCallDiagonal,
        livePutDiagonal,
        liveIronCondor,
        liveLongCall,
        liveLongPut,
        recentHeadlines,
      },
    });
  } catch (error) {
    console.error("Analyze error:", error);
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}