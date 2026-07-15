import { NextResponse } from "next/server";
import { auth } from "@/auth";

type FinnhubSearchResult = { description?: string; displaySymbol?: string; symbol?: string; type?: string };
type FinnhubSearchResponse = { count?: number; result?: FinnhubSearchResult[] };

// Tastytrade types
type TTNestedStrike = { "strike-price": string; call: string; put: string };
type TTNestedExpiration = { "expiration-date": string; "days-to-expiration": number; strikes: TTNestedStrike[] };
type TTNestedChainItem = { "underlying-symbol": string; expirations: TTNestedExpiration[] };
type TTNestedResponse = { data: { items: TTNestedChainItem[] } };
type TTMarketDataItem = { symbol: string; bid?: string | number; ask?: string | number; delta?: string | number };
type TTMarketDataResponse = { data: { items: TTMarketDataItem[] } };

export type OptionStrike = {
  strike: number;
  call: { bid: number; ask: number; mid: number } | null;
  put: { bid: number; ask: number; mid: number } | null;
};

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

async function resolveToSymbol(rawInput: string, finnhubKey: string): Promise<string> {
  const trimmed = rawInput.trim();
  const upper = trimmed.toUpperCase();
  if (looksLikeTicker(upper)) return upper;
  const aliasKey = trimmed.toLowerCase();
  if (TICKER_ALIASES[aliasKey]) return TICKER_ALIASES[aliasKey];
  const searchRes = await fetch(
    `https://finnhub.io/api/v1/search?q=${encodeURIComponent(trimmed)}&token=${finnhubKey}`,
    { cache: "no-store" }
  );
  if (!searchRes.ok) throw new Error("Failed to resolve ticker.");
  const searchData = (await searchRes.json()) as FinnhubSearchResponse;
  const results = Array.isArray(searchData.result) ? searchData.result : [];
  const best = [...results]
    .filter((i) => i.symbol && i.description)
    .sort((a, b) => scoreSearchResult(b, trimmed) - scoreSearchResult(a, trimmed))[0];
  if (!best?.symbol) throw new Error(`Could not find ticker for "${trimmed}".`);
  return best.symbol;
}

const TASTY_BASE = "https://api.tastytrade.com";
let cachedTTSession: { token: string; expiresAt: number } | null = null;

async function getTTSessionToken(): Promise<string> {
  const now = Date.now();
  if (cachedTTSession && cachedTTSession.expiresAt > now + 60_000) return cachedTTSession.token;
  const clientSecret = process.env.TASTYTRADE_CLIENT_SECRET;
  const refreshToken = process.env.TASTYTRADE_REFRESH_TOKEN;
  if (!clientSecret || !refreshToken) throw new Error("Missing TASTYTRADE_CLIENT_SECRET or TASTYTRADE_REFRESH_TOKEN");
  const res = await fetch(`${TASTY_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_secret: clientSecret,
    }).toString(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Tastytrade OAuth failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const token = data.access_token;
  const expiresIn = (data.expires_in ?? 900) * 1000;
  cachedTTSession = { token, expiresAt: now + expiresIn - 60_000 };
  return token;
}

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get("ticker");
    const expiration = searchParams.get("expiration");

    if (!ticker) return NextResponse.json({ error: "Ticker required." }, { status: 400 });

    const finnhubKey = process.env.FINNHUB_API_KEY;
    if (!finnhubKey) return NextResponse.json({ error: "Missing FINNHUB_API_KEY." }, { status: 500 });
    if (!process.env.TASTYTRADE_CLIENT_SECRET || !process.env.TASTYTRADE_REFRESH_TOKEN) {
      return NextResponse.json({ error: "Missing Tastytrade credentials." }, { status: 500 });
    }

    const symbol = await resolveToSymbol(ticker, finnhubKey);
    const ttToken = await getTTSessionToken();

    // Fetch full nested chain (all expirations + strikes)
    const chainRes = await fetch(`${TASTY_BASE}/option-chains/${encodeURIComponent(symbol)}/nested`, {
      headers: { Authorization: ttToken, Accept: "application/json" },
      cache: "no-store",
    });
    if (!chainRes.ok) {
      return NextResponse.json({ error: `Could not fetch options for ${symbol}.` }, { status: 500 });
    }

    const chainData = (await chainRes.json()) as TTNestedResponse;
    const allExpirations: TTNestedExpiration[] = chainData.data?.items?.[0]?.expirations ?? [];

    const today = new Date().toISOString().slice(0, 10);
    const futureExps = allExpirations.filter(e => e["expiration-date"] >= today);
    const expirationDates = futureExps.map(e => e["expiration-date"]);

    if (!expirationDates.length) {
      return NextResponse.json({ error: `No options found for ${symbol}.` }, { status: 500 });
    }

    // Get chain for the requested (or nearest) expiration
    const targetExp = expiration ?? expirationDates[0];
    const expData = futureExps.find(e => e["expiration-date"] === targetExp);

    let strikes: OptionStrike[] = [];

    if (expData?.strikes.length) {
      // Collect all OCC symbols for this expiration to quote
      const occSymbols = expData.strikes.flatMap(s => [s.call, s.put]).slice(0, 200);

      // Fetch quotes
      const params = occSymbols.map(s => `symbols[]=${encodeURIComponent(s)}`).join("&");
      const quoteRes = await fetch(
        `${TASTY_BASE}/market-data/by-type?instrument-type=Equity%20Option&${params}`,
        { headers: { Authorization: ttToken, Accept: "application/json" }, cache: "no-store" }
      );

      const quoteMap = new Map<string, TTMarketDataItem>();
      if (quoteRes.ok) {
        const quoteData = (await quoteRes.json()) as TTMarketDataResponse;
        for (const item of quoteData.data?.items ?? []) {
          if (item.symbol) quoteMap.set(item.symbol, item);
        }
      }

      // Build strike map
      const strikeMap = new Map<number, OptionStrike>();
      for (const s of expData.strikes) {
        const strikeNum = parseFloat(s["strike-price"]);
        if (!strikeMap.has(strikeNum)) strikeMap.set(strikeNum, { strike: strikeNum, call: null, put: null });
        const entry = strikeMap.get(strikeNum)!;

        for (const side of ["call", "put"] as const) {
          const q = quoteMap.get(s[side]);
          if (q) {
            const bid = parseFloat(String(q.bid ?? 0));
            const ask = parseFloat(String(q.ask ?? 0));
            if (ask >= bid && bid >= 0) {
              const mid = Math.round(((bid + ask) / 2) * 100) / 100;
              entry[side] = { bid, ask, mid };
            }
          }
        }
      }

      strikes = [...strikeMap.values()].sort((a, b) => a.strike - b.strike);
    }

    return NextResponse.json({ symbol, expirations: expirationDates, strikes, loadedExpiration: targetExp });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Something went wrong." },
      { status: 500 }
    );
  }
}
