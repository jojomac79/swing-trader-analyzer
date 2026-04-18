"use client";

import { useMemo, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

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

type HeadlineItem = {
  headline: string;
  source: string;
  url: string;
};

type MetaData = {
  symbol?: string;
  originalInput?: string;
  resolvedFromName?: boolean;
  resolvedDisplayName?: string | null;
  currentPrice?: string;
  nextEarnings?: string;
  nearExpiration?: string;
  farExpiration?: string | null;
  liveCallDebit?: LiveDebitSpread | null;
  livePutDebit?: LiveDebitSpread | null;
  liveBullPut?: LiveCreditSpread | null;
  liveBearCall?: LiveCreditSpread | null;
  liveCallDiagonal?: LiveDiagonalSpread | null;
  livePutDiagonal?: LiveDiagonalSpread | null;
  liveIronCondor?: LiveIronCondor | null;
  liveLongCall?: LiveLongOption | null;
  liveLongPut?: LiveLongOption | null;
  recentHeadlines?: HeadlineItem[];
};

type SelectedTradeCard =
  | { type: "callDebit"; spread: LiveDebitSpread }
  | { type: "putDebit"; spread: LiveDebitSpread }
  | { type: "bullPut"; spread: LiveCreditSpread }
  | { type: "bearCall"; spread: LiveCreditSpread }
  | { type: "callDiagonal"; spread: LiveDiagonalSpread }
  | { type: "putDiagonal"; spread: LiveDiagonalSpread }
  | { type: "ironCondor"; spread: LiveIronCondor }
  | null;

const USER_ID_KEY = "swing-trade-user-id";

function ensureAnonymousUserId(): string {
  if (typeof window === "undefined") return "";

  const cookieMatch = document.cookie.match(/(?:^|;\s*)anon_id=([^;]+)/);
  if (cookieMatch?.[1]) {
    const cookieId = decodeURIComponent(cookieMatch[1]);
    window.localStorage.setItem(USER_ID_KEY, cookieId);
    return cookieId;
  }

  let userId = window.localStorage.getItem(USER_ID_KEY);

  if (!userId) {
    userId = crypto.randomUUID();
    window.localStorage.setItem(USER_ID_KEY, userId);
  }

  document.cookie = `anon_id=${encodeURIComponent(
    userId
  )}; path=/; max-age=31536000; samesite=lax`;

  return userId;
}

function getBiasFromResult(result: string): "Bullish" | "Bearish" | "Neutral" | null {
  if (!result) return null;

  const match = result.match(/Overall Bias:\s*-\s*(Bullish|Bearish|Neutral)/i);
  if (!match?.[1]) return null;

  const bias = match[1].toLowerCase();

  if (bias === "bullish") return "Bullish";
  if (bias === "bearish") return "Bearish";
  if (bias === "neutral") return "Neutral";

  return null;
}

function getPreferredStrategy(result: string): string | null {
  if (!result) return null;

  const match = result.match(
    /Preferred Strategy:\s*-\s*(Call Debit Spread|Put Debit Spread|Bull Put Spread|Bear Call Spread|Call Diagonal|Put Diagonal|Iron Condor|No Trade)/i
  );

  return match?.[1] ?? null;
}

function getAltTradeText(result: string): string | null {
  if (!result) return null;

  const match = result.match(/Alt Trade Idea \(max risk\):\s*-\s*([^\n]+)/i);
  return match?.[1]?.trim() ?? null;
}

function pickFallbackTrade(
  meta: MetaData,
  bias: "Bullish" | "Bearish" | "Neutral" | null
): SelectedTradeCard {
  if (bias === "Bullish") {
    if (meta.liveCallDebit) return { type: "callDebit", spread: meta.liveCallDebit };
    if (meta.liveBullPut) return { type: "bullPut", spread: meta.liveBullPut };
    if (meta.liveCallDiagonal) return { type: "callDiagonal", spread: meta.liveCallDiagonal };
  }

  if (bias === "Bearish") {
    if (meta.livePutDebit) return { type: "putDebit", spread: meta.livePutDebit };
    if (meta.liveBearCall) return { type: "bearCall", spread: meta.liveBearCall };
    if (meta.livePutDiagonal) return { type: "putDiagonal", spread: meta.livePutDiagonal };
  }

  if (bias === "Neutral") {
    if (meta.liveIronCondor) return { type: "ironCondor", spread: meta.liveIronCondor };
  }

  if (meta.liveCallDebit) return { type: "callDebit", spread: meta.liveCallDebit };
  if (meta.livePutDebit) return { type: "putDebit", spread: meta.livePutDebit };
  if (meta.liveBullPut) return { type: "bullPut", spread: meta.liveBullPut };
  if (meta.liveBearCall) return { type: "bearCall", spread: meta.liveBearCall };
  if (meta.liveCallDiagonal) return { type: "callDiagonal", spread: meta.liveCallDiagonal };
  if (meta.livePutDiagonal) return { type: "putDiagonal", spread: meta.livePutDiagonal };
  if (meta.liveIronCondor) return { type: "ironCondor", spread: meta.liveIronCondor };

  return null;
}

function pickAltTrade(
  meta: MetaData,
  bias: "Bullish" | "Bearish" | "Neutral" | null
): LiveLongOption | null {
  if (bias === "Bullish" && meta.liveLongCall) return meta.liveLongCall;
  if (bias === "Bearish" && meta.liveLongPut) return meta.liveLongPut;
  return null;
}

function DebitCard({ spread }: { spread: LiveDebitSpread }) {
  const longLabel = spread.strategyType === "Call Debit Spread" ? "Long Call" : "Long Put";
  const shortLabel =
    spread.strategyType === "Call Debit Spread" ? "Short Call" : "Short Put";

  return (
    <div style={styles.tradeCard}>
      <h2 style={styles.cardTitle}>AI-Selected Trade Idea</h2>
      <div style={styles.tradeGrid}>
        <div>
          <strong>Strategy</strong>
          <br />
          {spread.strategyType}
        </div>
        <div>
          <strong>Expiration</strong>
          <br />
          {spread.expiration}
        </div>
        <div>
          <strong>{spread.strategyType === "Call Debit Spread" ? "Call Side" : "Put Side"}</strong>
          <br />
          {spread.longStrike} / {spread.shortStrike}
        </div>
        <div>
          <strong>Net Debit</strong>
          <br />${spread.netDebit.toFixed(2)}
        </div>
        <div>
          <strong>Breakeven</strong>
          <br />${spread.breakeven.toFixed(2)}
        </div>
        <div>
          <strong>Max Profit</strong>
          <br />${spread.maxProfit.toFixed(2)}
        </div>
        <div>
          <strong>Max Loss</strong>
          <br />${spread.maxLoss.toFixed(2)}
        </div>
      </div>

      <div style={styles.quoteRow}>
        <div>
          <strong>{longLabel} Bid/Ask</strong>
          <br />
          {spread.longBid.toFixed(2)} / {spread.longAsk.toFixed(2)}
        </div>
        <div>
          <strong>{shortLabel} Bid/Ask</strong>
          <br />
          {spread.shortBid.toFixed(2)} / {spread.shortAsk.toFixed(2)}
        </div>
      </div>
    </div>
  );
}

function CreditCard({ spread }: { spread: LiveCreditSpread }) {
  const shortLabel =
    spread.strategyType === "Bull Put Spread" ? "Short Put" : "Short Call";
  const longLabel =
    spread.strategyType === "Bull Put Spread" ? "Long Put" : "Long Call";
  const sideLabel = spread.strategyType === "Bull Put Spread" ? "Put Side" : "Call Side";

  return (
    <div style={styles.tradeCard}>
      <h2 style={styles.cardTitle}>AI-Selected Trade Idea</h2>
      <div style={styles.tradeGrid}>
        <div>
          <strong>Strategy</strong>
          <br />
          {spread.strategyType}
        </div>
        <div>
          <strong>Expiration</strong>
          <br />
          {spread.expiration}
        </div>
        <div>
          <strong>{sideLabel}</strong>
          <br />
          {spread.shortStrike} / {spread.longStrike}
        </div>
        <div>
          <strong>Total Credit</strong>
          <br />${spread.netCredit.toFixed(2)}
        </div>
        <div>
          <strong>Breakeven</strong>
          <br />${spread.breakeven.toFixed(2)}
        </div>
        <div>
          <strong>Max Profit</strong>
          <br />${spread.maxProfit.toFixed(2)}
        </div>
        <div>
          <strong>Max Loss</strong>
          <br />${spread.maxLoss.toFixed(2)}
        </div>
      </div>

      <div style={styles.quoteRow}>
        <div>
          <strong>{shortLabel} Bid/Ask</strong>
          <br />
          {spread.shortBid.toFixed(2)} / {spread.shortAsk.toFixed(2)}
        </div>
        <div>
          <strong>{longLabel} Bid/Ask</strong>
          <br />
          {spread.longBid.toFixed(2)} / {spread.longAsk.toFixed(2)}
        </div>
      </div>
    </div>
  );
}

function DiagonalCard({ spread }: { spread: LiveDiagonalSpread }) {
  const longLabel = spread.strategyType === "Call Diagonal" ? "Far Long Call" : "Far Long Put";
  const shortLabel =
    spread.strategyType === "Call Diagonal" ? "Near Short Call" : "Near Short Put";

  return (
    <div style={styles.tradeCard}>
      <h2 style={styles.cardTitle}>AI-Selected Trade Idea</h2>
      <div style={styles.tradeGrid}>
        <div>
          <strong>Strategy</strong>
          <br />
          {spread.strategyType}
        </div>
        <div>
          <strong>Near Expiration</strong>
          <br />
          {spread.nearExpiration}
        </div>
        <div>
          <strong>Far Expiration</strong>
          <br />
          {spread.farExpiration}
        </div>
        <div>
          <strong>{spread.strategyType === "Call Diagonal" ? "Call Side" : "Put Side"}</strong>
          <br />
          {spread.longStrike} / {spread.shortStrike}
        </div>
        <div>
          <strong>Net Debit</strong>
          <br />${spread.netDebit.toFixed(2)}
        </div>
        <div>
          <strong>Note</strong>
          <br />
          Path-dependent
        </div>
      </div>

      <div style={styles.quoteRow}>
        <div>
          <strong>{longLabel} Bid/Ask</strong>
          <br />
          {spread.longBid.toFixed(2)} / {spread.longAsk.toFixed(2)}
        </div>
        <div>
          <strong>{shortLabel} Bid/Ask</strong>
          <br />
          {spread.shortBid.toFixed(2)} / {spread.shortAsk.toFixed(2)}
        </div>
      </div>
    </div>
  );
}

function IronCondorCard({ spread }: { spread: LiveIronCondor }) {
  return (
    <div style={styles.tradeCard}>
      <h2 style={styles.cardTitle}>AI-Selected Trade Idea</h2>
      <div style={styles.tradeGrid}>
        <div>
          <strong>Strategy</strong>
          <br />
          {spread.strategyType}
        </div>
        <div>
          <strong>Expiration</strong>
          <br />
          {spread.expiration}
        </div>
        <div>
          <strong>Put Side</strong>
          <br />
          {spread.putShortStrike} / {spread.putLongStrike}
        </div>
        <div>
          <strong>Call Side</strong>
          <br />
          {spread.callShortStrike} / {spread.callLongStrike}
        </div>
        <div>
          <strong>Total Credit</strong>
          <br />${spread.totalCredit.toFixed(2)}
        </div>
        <div>
          <strong>Lower B/E</strong>
          <br />${spread.lowerBreakeven.toFixed(2)}
        </div>
        <div>
          <strong>Upper B/E</strong>
          <br />${spread.upperBreakeven.toFixed(2)}
        </div>
        <div>
          <strong>Max Profit</strong>
          <br />${spread.maxProfit.toFixed(2)}
        </div>
        <div>
          <strong>Max Loss</strong>
          <br />${spread.maxLoss.toFixed(2)}
        </div>
      </div>
    </div>
  );
}

function AltTradeCard({
  option,
  parsedLine,
}: {
  option: LiveLongOption;
  parsedLine: string | null;
}) {
  return (
    <div style={styles.altTradeCard}>
      <h3 style={styles.altCardTitle}>Alt Trade Idea (max risk)</h3>

      {parsedLine && <div style={styles.altTradeText}>{parsedLine}</div>}

      <div style={styles.tradeGrid}>
        <div>
          <strong>Strategy</strong>
          <br />
          {option.strategyType}
        </div>
        <div>
          <strong>Expiration</strong>
          <br />
          {option.expiration}
        </div>
        <div>
          <strong>Strike</strong>
          <br />
          {option.strike}
        </div>
        <div>
          <strong>Bid/Ask</strong>
          <br />
          {option.bid.toFixed(2)} / {option.ask.toFixed(2)}
        </div>
        <div>
          <strong>Estimated Mid</strong>
          <br />${option.mid.toFixed(2)}
        </div>
        <div>
          <strong>Max Risk</strong>
          <br />${option.maxRisk.toFixed(2)}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { data: session, status } = useSession();
  const isSignedIn = !!session?.user;
  const signedInUserId = session?.user?.email ?? "";

  const [ticker, setTicker] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<MetaData | null>(null);
  const [showGoogleGate, setShowGoogleGate] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [copied, setCopied] = useState(false);

  const bias = useMemo(() => getBiasFromResult(result), [result]);
  const preferredStrategy = useMemo(() => getPreferredStrategy(result), [result]);
  const altTradeText = useMemo(() => getAltTradeText(result), [result]);

  const selectedTradeCard = useMemo<SelectedTradeCard>(() => {
    if (!meta) return null;

    if (preferredStrategy === "Call Debit Spread" && meta.liveCallDebit) {
      return { type: "callDebit", spread: meta.liveCallDebit };
    }

    if (preferredStrategy === "Put Debit Spread" && meta.livePutDebit) {
      return { type: "putDebit", spread: meta.livePutDebit };
    }

    if (preferredStrategy === "Bull Put Spread" && meta.liveBullPut) {
      return { type: "bullPut", spread: meta.liveBullPut };
    }

    if (preferredStrategy === "Bear Call Spread" && meta.liveBearCall) {
      return { type: "bearCall", spread: meta.liveBearCall };
    }

    if (preferredStrategy === "Call Diagonal" && meta.liveCallDiagonal) {
      return { type: "callDiagonal", spread: meta.liveCallDiagonal };
    }

    if (preferredStrategy === "Put Diagonal" && meta.livePutDiagonal) {
      return { type: "putDiagonal", spread: meta.livePutDiagonal };
    }

    if (preferredStrategy === "Iron Condor" && meta.liveIronCondor) {
      return { type: "ironCondor", spread: meta.liveIronCondor };
    }

    if (preferredStrategy === "No Trade") {
      return null;
    }

    return pickFallbackTrade(meta, bias);
  }, [meta, preferredStrategy, bias]);

  const altTrade = useMemo(() => {
    if (!meta) return null;
    return pickAltTrade(meta, bias);
  }, [meta, bias]);

  const analyzeStock = async () => {
    if (!ticker.trim()) {
      setError("Enter a ticker or company name.");
      return;
    }

    setLoading(true);
    setError("");
    setResult("");
    setMeta(null);
    setCopied(false);
    setShowGoogleGate(false);
    setShowPaywall(false);

    try {
      const anonymousUserId = ensureAnonymousUserId();
      const userId = isSignedIn && signedInUserId ? signedInUserId : anonymousUserId;

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": userId,
        },
        body: JSON.stringify({ ticker }),
      });

      const data = await res.json();

      if (!res.ok) {
        const message = data.error || "Failed to analyze stock.";

        if (res.status === 403) {
          if (isSignedIn) {
            setShowPaywall(true);
          } else {
            setShowGoogleGate(true);
          }
        }

        throw new Error(message);
      }

      setResult(data.result ?? "");
      setMeta(data.meta ?? null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;

    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy analysis.");
    }
  };

  return (
    <main style={styles.main}>
      <div style={styles.container}>
        <div style={styles.heroRow}>
          <div style={styles.heroText}>
            <h1 style={styles.title}>Swing Trade Analyzer</h1>
            <p style={styles.subtitle}>
              Enter a ticker or company name. Get trade breakdowns with headlines,
              options context, and smarter strategy selection.
            </p>
          </div>

          <div style={styles.statusCard}>
            <div>
              <strong>Status:</strong>{" "}
              {status === "loading"
                ? "Checking sign-in..."
                : isSignedIn
                  ? `Signed in as ${session?.user?.email ?? "user"}`
                  : "Not signed in"}
            </div>

            {isSignedIn && (
              <button onClick={() => signOut()} style={styles.signOutButton}>
                Sign out
              </button>
            )}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            analyzeStock();
          }}
          style={styles.searchRow}
        >
          <input
            type="text"
            placeholder="Ticker or company (e.g. AAPL or Netflix)"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            style={styles.input}
            autoFocus
            disabled={loading || status === "loading"}
          />
          <button
            type="submit"
            disabled={loading || !ticker.trim() || status === "loading"}
            style={styles.button}
          >
            {loading ? "Scanning options chain..." : "Analyze"}
          </button>
        </form>

        {showGoogleGate && (
          <div style={styles.gateCard}>
            <h2 style={styles.cardTitle}>Unlock more analyses</h2>
            <p style={styles.gateText}>
              Your no-login usage is tapped out. Continue with Google to unlock more.
            </p>

            <button onClick={() => signIn("google")} style={styles.googleButton}>
              <img
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                alt="Google"
                style={styles.googleIcon}
              />
              Continue with Google
            </button>
          </div>
        )}

        {showPaywall && (
          <div style={styles.paywallCard}>
            <h2 style={styles.cardTitle}>Free limit reached</h2>
            <p style={styles.gateText}>
              You’ve used today’s free analyses. Upgrade to Pro when you’re ready.
            </p>

            <div style={styles.paywallActions}>
              <button style={styles.upgradeButton}>Upgrade to Pro</button>
            </div>
          </div>
        )}

        {error && <div style={styles.error}>{error}</div>}

        {meta && (
          <div style={styles.metaCard}>
            <div>
              <strong>Symbol:</strong> {meta.symbol}
            </div>
            {meta.resolvedFromName && meta.originalInput && (
              <div>
                <strong>Resolved from:</strong> {meta.originalInput}
              </div>
            )}
            {meta.resolvedFromName && meta.resolvedDisplayName && (
              <div>
                <strong>Matched company:</strong> {meta.resolvedDisplayName}
              </div>
            )}
            <div>
              <strong>Current Price:</strong> ${meta.currentPrice}
            </div>
            <div>
              <strong>Next Earnings:</strong> {meta.nextEarnings}
            </div>
            {bias && (
              <div>
                <strong>AI Bias:</strong> {bias}
              </div>
            )}
            {preferredStrategy && (
              <div>
                <strong>Preferred Strategy:</strong> {preferredStrategy}
              </div>
            )}
          </div>
        )}

        {meta?.recentHeadlines && meta.recentHeadlines.length > 0 && (
          <div style={styles.headlinesCard}>
            <h2 style={styles.cardTitle}>Recent Headlines</h2>
            <div style={styles.headlinesList}>
              {meta.recentHeadlines.map((item, index) => (
                <a
                  key={`${item.url}-${index}`}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.headlineLink}
                >
                  <div style={styles.headlineTitle}>{item.headline}</div>
                  <div style={styles.headlineSource}>{item.source}</div>
                </a>
              ))}
            </div>
          </div>
        )}

        {selectedTradeCard?.type === "callDebit" && (
          <DebitCard spread={selectedTradeCard.spread} />
        )}

        {selectedTradeCard?.type === "putDebit" && (
          <DebitCard spread={selectedTradeCard.spread} />
        )}

        {selectedTradeCard?.type === "bullPut" && (
          <CreditCard spread={selectedTradeCard.spread} />
        )}

        {selectedTradeCard?.type === "bearCall" && (
          <CreditCard spread={selectedTradeCard.spread} />
        )}

        {selectedTradeCard?.type === "callDiagonal" && (
          <DiagonalCard spread={selectedTradeCard.spread} />
        )}

        {selectedTradeCard?.type === "putDiagonal" && (
          <DiagonalCard spread={selectedTradeCard.spread} />
        )}

        {selectedTradeCard?.type === "ironCondor" && (
          <IronCondorCard spread={selectedTradeCard.spread} />
        )}

        {altTrade && <AltTradeCard option={altTrade} parsedLine={altTradeText} />}

        {result && (
          <div style={styles.resultCard}>
            <div style={styles.resultHeader}>
              <h2 style={styles.cardTitle}>Swing Trade Analysis</h2>
              <button onClick={handleCopy} style={styles.copyButton}>
                {copied ? "Copied" : "Copy analysis"}
              </button>
            </div>
            <pre style={styles.result}>{result}</pre>
          </div>
        )}
      </div>
    </main>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  main: {
    minHeight: "100vh",
    padding: "40px 16px",
    color: "#e5e7eb",
    background: "#0f172a",
  },
  container: {
    maxWidth: "1040px",
    margin: "0 auto",
  },
  heroRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "16px",
    flexWrap: "wrap",
    marginBottom: "24px",
  },
  heroText: {
    flex: 1,
    minWidth: "280px",
  },
  title: {
    margin: 0,
    fontSize: "2.1rem",
    lineHeight: 1.1,
    color: "#ffffff",
  },
  subtitle: {
    marginTop: "10px",
    marginBottom: 0,
    color: "#cbd5e1",
    lineHeight: 1.5,
    maxWidth: "640px",
  },
  statusCard: {
    background: "#111827",
    border: "1px solid #334155",
    borderRadius: "14px",
    padding: "14px 16px",
    minWidth: "260px",
    display: "grid",
    gap: "8px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
  },
  signOutButton: {
    marginTop: "4px",
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid #475569",
    background: "transparent",
    color: "#cbd5e1",
    cursor: "pointer",
    fontSize: "0.85rem",
    justifySelf: "start",
  },
  searchRow: {
    display: "flex",
    gap: "10px",
    marginBottom: "20px",
    flexWrap: "wrap",
  },
  input: {
    flex: 1,
    minWidth: "240px",
    padding: "12px 14px",
    fontSize: "1rem",
    border: "1px solid #334155",
    borderRadius: "10px",
    background: "#1e293b",
    color: "#fff",
    outline: "none",
  },
  button: {
    padding: "12px 18px",
    borderRadius: "10px",
    border: "none",
    background: "#22c55e",
    color: "#04130a",
    cursor: "pointer",
    fontSize: "1rem",
    fontWeight: 700,
    minWidth: "120px",
  },
  googleButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    alignSelf: "flex-start",
    padding: "12px 18px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#111827",
    cursor: "pointer",
    fontSize: "0.95rem",
    fontWeight: 700,
  },
  googleIcon: {
    width: "18px",
    height: "18px",
    display: "block",
    flexShrink: 0,
  },
  upgradeButton: {
    padding: "12px 18px",
    borderRadius: "10px",
    border: "none",
    background: "#f59e0b",
    color: "#111827",
    cursor: "pointer",
    fontSize: "0.95rem",
    fontWeight: 700,
  },
  copyButton: {
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid #475569",
    background: "#0f172a",
    color: "#e5e7eb",
    cursor: "pointer",
    fontSize: "0.9rem",
    fontWeight: 600,
  },
  error: {
    background: "#7f1d1d",
    color: "#fecaca",
    padding: "12px 14px",
    borderRadius: "10px",
    marginBottom: "16px",
    border: "1px solid #991b1b",
  },
  gateCard: {
    background: "#132035",
    border: "1px solid #334155",
    borderRadius: "14px",
    padding: "18px",
    marginBottom: "16px",
    display: "grid",
    gap: "12px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
  },
  paywallCard: {
    background: "#1f2937",
    border: "1px solid #475569",
    borderRadius: "14px",
    padding: "18px",
    marginBottom: "16px",
    display: "grid",
    gap: "12px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
  },
  paywallActions: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
  },
  metaCard: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "14px",
    padding: "16px",
    marginBottom: "16px",
    display: "flex",
    gap: "20px",
    flexWrap: "wrap",
  },
  headlinesCard: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "14px",
    padding: "16px",
    marginBottom: "16px",
  },
  headlinesList: {
    display: "grid",
    gap: "10px",
  },
  headlineLink: {
    display: "block",
    padding: "12px",
    borderRadius: "10px",
    border: "1px solid #334155",
    background: "#0f172a",
    color: "#e5e7eb",
    textDecoration: "none",
  },
  headlineTitle: {
    fontWeight: 700,
    marginBottom: "4px",
  },
  headlineSource: {
    fontSize: "0.9rem",
    color: "#94a3b8",
  },
  tradeCard: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "14px",
    padding: "16px",
    marginBottom: "16px",
  },
  altTradeCard: {
    background: "#18263f",
    border: "1px solid #334155",
    borderRadius: "14px",
    padding: "16px",
    marginBottom: "16px",
  },
  altCardTitle: {
    margin: 0,
    marginBottom: "10px",
    fontSize: "1.05rem",
    color: "#ffffff",
  },
  altTradeText: {
    marginBottom: "12px",
    color: "#cbd5e1",
    lineHeight: 1.6,
  },
  tradeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: "14px",
    marginBottom: "16px",
  },
  quoteRow: {
    display: "flex",
    gap: "24px",
    flexWrap: "wrap",
    paddingTop: "12px",
    borderTop: "1px solid #334155",
  },
  resultCard: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "14px",
    padding: "16px",
  },
  resultHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
    marginBottom: "8px",
  },
  cardTitle: {
    margin: 0,
    fontSize: "1.2rem",
    color: "#ffffff",
  },
  gateText: {
    margin: 0,
    color: "#cbd5e1",
    lineHeight: 1.6,
  },
  result: {
    whiteSpace: "pre-wrap",
    lineHeight: 1.7,
    margin: 0,
    color: "#e5e7eb",
    fontSize: "0.98rem",
  },
};