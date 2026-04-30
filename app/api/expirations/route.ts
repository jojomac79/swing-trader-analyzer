import { NextResponse } from "next/server";
import { auth } from "@/auth";

type FinnhubSearchResult = { description?: string; displaySymbol?: string; symbol?: string; type?: string };
type FinnhubSearchResponse = { count?: number; result?: FinnhubSearchResult[] };
type TradierExpirationsResponse = { expirations?: { date?: string[] | string } };

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

function normalizeExpirations(data: TradierExpirationsResponse): string[] {
  const raw = data.expirations?.date;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

export async function GET(req: Request) {
  try {
    // Auth check — must be signed in
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get("ticker");
    if (!ticker) return NextResponse.json({ error: "Ticker required." }, { status: 400 });

    const finnhubKey = process.env.FINNHUB_API_KEY;
    const tradierKey = process.env.TRADIER_API_KEY;
    if (!finnhubKey || !tradierKey) {
      return NextResponse.json({ error: "Missing API keys." }, { status: 500 });
    }

    const symbol = await resolveToSymbol(ticker, finnhubKey);
    const sym = encodeURIComponent(symbol);

    const expRes = await fetch(
      `https://api.tradier.com/v1/markets/options/expirations?symbol=${sym}&includeAllRoots=true`,
      {
        headers: { Authorization: `Bearer ${tradierKey}`, Accept: "application/json" },
        cache: "no-store",
      }
    );

    if (!expRes.ok) {
      return NextResponse.json({ error: `Could not fetch expirations for ${symbol}.` }, { status: 500 });
    }

    const data = (await expRes.json()) as TradierExpirationsResponse;
    const expirations = normalizeExpirations(data);

    // Only return future dates
    const today = new Date().toISOString().slice(0, 10);
    const future = expirations.filter((d) => d >= today);

    return NextResponse.json({ symbol, expirations: future });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Something went wrong." },
      { status: 500 }
    );
  }
}
