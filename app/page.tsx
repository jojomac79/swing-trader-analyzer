"use client";

import { useMemo, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

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

type HeadlineItem = {
  headline: string;
  source: string;
  url: string;
};

type MetaData = {
  symbol?: string;
  currentPrice?: string;
  nextEarnings?: string;
  selectedExpiration?: string;
  liveBullPutSpread?: LiveVerticalSpread | null;
  liveBearCallSpread?: LiveVerticalSpread | null;
  liveIronCondor?: LiveIronCondor | null;
  recentHeadlines?: HeadlineItem[];
};

type SelectedTradeCard =
  | {
      type: "bullPut";
      title: string;
      spread: LiveVerticalSpread;
    }
  | {
      type: "bearCall";
      title: string;
      spread: LiveVerticalSpread;
    }
  | {
      type: "ironCondor";
      title: string;
      spread: LiveIronCondor;
    }
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

function SpreadCard({
  title,
  spread,
}: {
  title: string;
  spread: LiveVerticalSpread;
}) {
  const shortLabel =
    spread.strategyType === "Bull Put Spread" ? "Short Put" : "Short Call";
  const longLabel =
    spread.strategyType === "Bull Put Spread" ? "Long Put" : "Long Call";

  return (
    <div style={styles.spreadCard}>
      <h2 style={styles.cardTitle}>{title}</h2>

      <div style={styles.spreadGrid}>
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
          <strong>Strikes</strong>
          <br />
          {spread.shortStrike} / {spread.longStrike}
        </div>
        <div>
          <strong>Net Credit</strong>
          <br />
          ${spread.netCredit.toFixed(2)}
        </div>
        <div>
          <strong>Breakeven</strong>
          <br />
          ${spread.breakeven.toFixed(2)}
        </div>
        <div>
          <strong>Max Profit</strong>
          <br />
          ${spread.maxProfit.toFixed(2)}
        </div>
        <div>
          <strong>Max Loss</strong>
          <br />
          ${spread.maxLoss.toFixed(2)}
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

function IronCondorCard({
  title,
  spread,
}: {
  title: string;
  spread: LiveIronCondor;
}) {
  return (
    <div style={styles.spreadCard}>
      <h2 style={styles.cardTitle}>{title}</h2>

      <div style={styles.spreadGrid}>
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
          <br />
          ${spread.totalCredit.toFixed(2)}
        </div>
        <div>
          <strong>Lower B/E</strong>
          <br />
          ${spread.lowerBreakeven.toFixed(2)}
        </div>
        <div>
          <strong>Upper B/E</strong>
          <br />
          ${spread.upperBreakeven.toFixed(2)}
        </div>
        <div>
          <strong>Max Profit</strong>
          <br />
          ${spread.maxProfit.toFixed(2)}
        </div>
        <div>
          <strong>Max Loss</strong>
          <br />
          ${spread.maxLoss.toFixed(2)}
        </div>
      </div>

      <div style={styles.quoteRow}>
        <div>
          <strong>Put Credit</strong>
          <br />
          ${spread.putCredit.toFixed(2)}
        </div>
        <div>
          <strong>Call Credit</strong>
          <br />
          ${spread.callCredit.toFixed(2)}
        </div>
        <div>
          <strong>Wing Width</strong>
          <br />
          {spread.width.toFixed(2)}
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

  const selectedTradeCard = useMemo<SelectedTradeCard>(() => {
    if (!meta || !bias) return null;

    if (bias === "Bullish" && meta.liveBullPutSpread) {
      return {
        type: "bullPut",
        title: "AI-Selected Trade Idea",
        spread: meta.liveBullPutSpread,
      };
    }

    if (bias === "Bearish" && meta.liveBearCallSpread) {
      return {
        type: "bearCall",
        title: "AI-Selected Trade Idea",
        spread: meta.liveBearCallSpread,
      };
    }

    if (bias === "Neutral" && meta.liveIronCondor) {
      return {
        type: "ironCondor",
        title: "AI-Selected Trade Idea",
        spread: meta.liveIronCondor,
      };
    }

    return null;
  }, [meta, bias]);

  const analyzeStock = async () => {
    if (!ticker.trim()) {
      setError("Enter a ticker.");
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
              AI trade breakdowns with live options context and recent headlines.
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
            placeholder="Ticker (e.g. AAPL)"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
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
            <div>
              <strong>Current Price:</strong> ${meta.currentPrice}
            </div>
            <div>
              <strong>Next Earnings:</strong> {meta.nextEarnings}
            </div>
            {meta.selectedExpiration && (
              <div>
                <strong>Selected Expiration:</strong> {meta.selectedExpiration}
              </div>
            )}
            {bias && (
              <div>
                <strong>AI Bias:</strong> {bias}
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

        {selectedTradeCard?.type === "bullPut" && (
          <div style={styles.spreadCardsWrapper}>
            <SpreadCard
              title={selectedTradeCard.title}
              spread={selectedTradeCard.spread}
            />
          </div>
        )}

        {selectedTradeCard?.type === "bearCall" && (
          <div style={styles.spreadCardsWrapper}>
            <SpreadCard
              title={selectedTradeCard.title}
              spread={selectedTradeCard.spread}
            />
          </div>
        )}

        {selectedTradeCard?.type === "ironCondor" && (
          <div style={styles.spreadCardsWrapper}>
            <IronCondorCard
              title={selectedTradeCard.title}
              spread={selectedTradeCard.spread}
            />
          </div>
        )}

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
  spreadCardsWrapper: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "16px",
    marginBottom: "16px",
  },
  spreadCard: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "14px",
    padding: "16px",
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
  spreadGrid: {
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
  result: {
    whiteSpace: "pre-wrap",
    lineHeight: 1.7,
    margin: 0,
    color: "#e5e7eb",
    fontSize: "0.98rem",
  },
};