import OpenAI from "openai";
import { NextResponse } from "next/server";

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

type LiveVerticalSpread = {
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

function chooseExpiration(expirations: string[], earningsDate: string): string | null {
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

function buildBullPutSpread(
  options: TradierOptionContract[],
  currentPrice: number
): LiveVerticalSpread | null {
  const puts = options
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
): LiveVerticalSpread | null {
  const calls = options
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

function buildIronCondor(
  bullPut: LiveVerticalSpread | null,
  bearCall: LiveVerticalSpread | null
): LiveIronCondor | null {
  if (!bullPut || !bearCall) return null;
  if (bullPut.expiration !== bearCall.expiration) return null;

  // Keep v1 simple: require equal width for clean math.
  if (Math.abs(bullPut.width - bearCall.width) > 0.0001) return null;

  // Sanity check: put side should be below call side.
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

function buildLiveSpreadSection(
  bullPutSpread: LiveVerticalSpread | null,
  bearCallSpread: LiveVerticalSpread | null,
  ironCondor: LiveIronCondor | null
): string {
  const sections: string[] = [];

  if (bullPutSpread) {
    sections.push(`
LIVE OPTIONS CANDIDATE (REAL DATA FROM TRADIER):
- Strategy Type: ${bullPutSpread.strategyType}
- Expiration: ${bullPutSpread.expiration}
- Sell Put: ${bullPutSpread.shortStrike}
- Buy Put: ${bullPutSpread.longStrike}
- Short Put Bid/Ask: ${bullPutSpread.shortBid.toFixed(2)} / ${bullPutSpread.shortAsk.toFixed(2)}
- Long Put Bid/Ask: ${bullPutSpread.longBid.toFixed(2)} / ${bullPutSpread.longAsk.toFixed(2)}
- Estimated Net Credit (midpoint-based): ${bullPutSpread.netCredit.toFixed(2)}
- Spread Width: ${bullPutSpread.width.toFixed(2)}
- Max Profit: $${bullPutSpread.maxProfit.toFixed(2)}
- Max Loss: $${bullPutSpread.maxLoss.toFixed(2)}
- Breakeven: $${bullPutSpread.breakeven.toFixed(2)}
`);
  }

  if (bearCallSpread) {
    sections.push(`
LIVE OPTIONS CANDIDATE (REAL DATA FROM TRADIER):
- Strategy Type: ${bearCallSpread.strategyType}
- Expiration: ${bearCallSpread.expiration}
- Sell Call: ${bearCallSpread.shortStrike}
- Buy Call: ${bearCallSpread.longStrike}
- Short Call Bid/Ask: ${bearCallSpread.shortBid.toFixed(2)} / ${bearCallSpread.shortAsk.toFixed(2)}
- Long Call Bid/Ask: ${bearCallSpread.longBid.toFixed(2)} / ${bearCallSpread.longAsk.toFixed(2)}
- Estimated Net Credit (midpoint-based): ${bearCallSpread.netCredit.toFixed(2)}
- Spread Width: ${bearCallSpread.width.toFixed(2)}
- Max Profit: $${bearCallSpread.maxProfit.toFixed(2)}
- Max Loss: $${bearCallSpread.maxLoss.toFixed(2)}
- Breakeven: $${bearCallSpread.breakeven.toFixed(2)}
`);
  }

  if (ironCondor) {
    sections.push(`
LIVE OPTIONS CANDIDATE (REAL DATA FROM TRADIER):
- Strategy Type: ${ironCondor.strategyType}
- Expiration: ${ironCondor.expiration}
- Put Side: Sell ${ironCondor.putShortStrike} Put / Buy ${ironCondor.putLongStrike} Put
- Call Side: Sell ${ironCondor.callShortStrike} Call / Buy ${ironCondor.callLongStrike} Call
- Put Credit: ${ironCondor.putCredit.toFixed(2)}
- Call Credit: ${ironCondor.callCredit.toFixed(2)}
- Total Credit: ${ironCondor.totalCredit.toFixed(2)}
- Wing Width: ${ironCondor.width.toFixed(2)}
- Max Profit: $${ironCondor.maxProfit.toFixed(2)}
- Max Loss: $${ironCondor.maxLoss.toFixed(2)}
- Lower Breakeven: $${ironCondor.lowerBreakeven.toFixed(2)}
- Upper Breakeven: $${ironCondor.upperBreakeven.toFixed(2)}
`);
  }

  if (!sections.length) {
    return `
LIVE OPTIONS CANDIDATES (REAL DATA FROM TRADIER):
- No valid bull put spread, bear call spread, or iron condor candidate was found from the current option chain.
- Do not invent exact live spread pricing.
- If discussing a strategy, keep it conceptual and avoid exact premium math.
`;
  }

  return `${sections.join("\n")}
IMPORTANT:
- These values are derived from live option quotes and should be treated as the real example spread math.
- Use the live spread that best matches the stated bias and setup.
- If the setup is bullish, prefer the live bull put spread if it fits.
- If the setup is bearish, prefer the live bear call spread if it fits.
- If the setup is neutral and range-bound, prefer the live iron condor if it fits.
- Do not invent exact live option pricing for unsupported strategies.
`;
}

export async function POST(req: Request) {
  try {
    const { ticker } = await req.json();

    if (!ticker || typeof ticker !== "string") {
      return NextResponse.json({ error: "Ticker is required." }, { status: 400 });
    }

    const symbol = ticker.trim().toUpperCase();
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

    const today = new Date();
    const sixtyDaysOut = new Date();
    sixtyDaysOut.setDate(today.getDate() + 60);

    const quoteUrl =
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`;

    const earningsUrl =
      `https://finnhub.io/api/v1/calendar/earnings?symbol=${encodeURIComponent(symbol)}` +
      `&from=${formatDate(today)}&to=${formatDate(sixtyDaysOut)}&token=${finnhubKey}`;

    const [quoteRes, earningsRes] = await Promise.all([
      fetch(quoteUrl, { cache: "no-store" }),
      fetch(earningsUrl, { cache: "no-store" }),
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

    const quoteData = (await quoteRes.json()) as FinnhubQuote;
    const earningsData = (await earningsRes.json()) as FinnhubEarningsResponse;

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
      `https://api.tradier.com/v1/markets/options/expirations?symbol=${encodeURIComponent(symbol)}&includeAllRoots=true`,
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
    const selectedExpiration = chooseExpiration(expirations, nextEarnings);

    if (!selectedExpiration) {
      return NextResponse.json(
        { error: `No usable Tradier expiration found for ${symbol}.` },
        { status: 500 }
      );
    }

    const chainRes = await fetch(
      `https://api.tradier.com/v1/markets/options/chains?symbol=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(selectedExpiration)}&greeks=false`,
      {
        headers: {
          Authorization: `Bearer ${tradierKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!chainRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch Tradier options chain for ${symbol}.` },
        { status: 500 }
      );
    }

    const chainData = (await chainRes.json()) as TradierChainResponse;
    const options = normalizeOptions(chainData);

    let liveBullPutSpread = buildBullPutSpread(options, currentPriceNumber);
    let liveBearCallSpread = buildBearCallSpread(options, currentPriceNumber);

    if (liveBullPutSpread) {
      liveBullPutSpread.expiration = selectedExpiration;
    }

    if (liveBearCallSpread) {
      liveBearCallSpread.expiration = selectedExpiration;
    }

    const liveIronCondor = buildIronCondor(
      liveBullPutSpread,
      liveBearCallSpread
    );

    const liveSpreadSection = buildLiveSpreadSection(
      liveBullPutSpread,
      liveBearCallSpread,
      liveIronCondor
    );

    const prompt = `
You are a sharp, no-BS stock trader.

Analyze the stock: ${symbol}
Current Price: $${currentPrice}
Next Earnings Date: ${nextEarnings}

${liveSpreadSection}

Your goal is to give a fast, actionable breakdown someone could use to think about a trade.

Use the provided current price as the anchor for all levels. Do not reference price levels far from the current price unless clearly justified.

Treat the provided earnings date/status as the source of truth. Do not assume earnings already happened if the provided earnings date is upcoming.

Do not default to Neutral just because earnings are upcoming or because the setup is not perfect.

Choose Bullish or Bearish when the balance of evidence clearly leans one way, even if conviction is modest.

Use Neutral only when the short-term setup is genuinely mixed, range-bound, or lacks a clear directional lean.

If the bias is Bullish or Bearish, reflect that lean in the trade idea. If the bias is Neutral, prefer range-bound or wait-for-confirmation ideas.

Prioritize plain price action, support/resistance, earnings timing, and obvious catalysts over technical indicators.

Only reference indicators like RSI, volume, or moving averages if you can tie them to a clear condition or price behavior. Otherwise omit them.

Do not overuse any single indicator or level across multiple sections.

If referencing a moving average, RSI, or volume, mention it only when it adds real clarity. Otherwise use plain language like "recent support," "range low," or "near-term resistance."

Do not assume recent earnings, guidance, news, or catalyst outcomes unless they are explicitly provided.

If you are not certain about a fresh fact, use conditional language such as "if," "could," or "watch for" instead of stating it as confirmed.

Never present unverified recent events as facts.

Base the analysis on general setup logic, known business model themes, and the provided context only.

If suggesting a trade idea, make sure it matches the stated bias and short-term outlook.

If a live options spread is provided, use it as the primary example when it fits the bias. Do not replace it with hypothetical spreads.

Do not pretend to know exact live premiums, Greeks, or implied volatility for any strategy unless they were explicitly provided above.

When giving a trade idea:
- Prefer the live bull put spread for modest bullish bias near support if it fits.
- Prefer the live bear call spread for modest bearish bias near resistance if it fits.
- Prefer the live iron condor for truly neutral, range-bound setups if it fits.
- Prefer call debit spreads or put debit spreads when directional conviction is stronger.
- Prefer diagonals only if you explicitly frame them as a more advanced idea around time decay and a directional lean.

Trade ideas must stay educational, conditional, and risk-aware.

Format EXACTLY like this:

Overall Bias:
- (Bullish / Bearish / Neutral)
- (Low / Medium / High conviction)
- (One sentence explaining why)

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
- (A possible options trade idea or way to think about the setup)
- (If using a live spread candidate, include the real expiration, strikes, credit, max profit, max loss, and breakeven / breakevens)
- (What would confirm it)
- (What would invalidate it)
- (Keep this educational and framed as an idea, not a directive)

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
        currentPrice,
        nextEarnings,
        selectedExpiration,
        liveBullPutSpread,
        liveBearCallSpread,
        liveIronCondor,
      },
    });
  } catch (error) {
    console.error("Analyze error:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}