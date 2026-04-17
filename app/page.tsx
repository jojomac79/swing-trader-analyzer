"use client";

import { useState } from "react";

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

type MetaData = {
  symbol?: string;
  currentPrice?: string;
  nextEarnings?: string;
  selectedExpiration?: string;
  liveBullPutSpread?: LiveVerticalSpread | null;
  liveBearCallSpread?: LiveVerticalSpread | null;
};

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

export default function Home() {
  const [ticker, setTicker] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<MetaData | null>(null);

  const analyzeStock = async () => {
    setLoading(true);
    setError("");
    setResult("");
    setMeta(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ticker }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to analyze stock.");
      }

      setResult(data.result);
      setMeta(data.meta ?? null);
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={styles.main}>
      <div style={styles.container}>
        <h1 style={styles.title}>Swing Trade Analyzer</h1>

        <div style={styles.searchRow}>
          <input
            type="text"
            placeholder="Ticker (e.g. AAPL)"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            style={styles.input}
          />
          <button
            onClick={analyzeStock}
            disabled={loading || !ticker.trim()}
            style={styles.button}
          >
            {loading ? "Analyzing..." : "Analyze"}
          </button>
        </div>

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
          </div>
        )}

        {(meta?.liveBullPutSpread || meta?.liveBearCallSpread) && (
          <div style={styles.spreadCardsWrapper}>
            {meta?.liveBullPutSpread && (
              <SpreadCard
                title="Live Bull Put Spread"
                spread={meta.liveBullPutSpread}
              />
            )}

            {meta?.liveBearCallSpread && (
              <SpreadCard
                title="Live Bear Call Spread"
                spread={meta.liveBearCallSpread}
              />
            )}
          </div>
        )}

        {result && (
          <div style={styles.resultCard}>
            <h2 style={styles.cardTitle}>AI Analysis</h2>
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
    background: "#f5f5f5",
    padding: "32px 16px",
    fontFamily: "Arial, sans-serif",
  },
  container: {
    maxWidth: "1000px",
    margin: "0 auto",
  },
  title: {
    fontSize: "2rem",
    marginBottom: "20px",
  },
  searchRow: {
    display: "flex",
    gap: "10px",
    marginBottom: "20px",
  },
  input: {
    flex: 1,
    padding: "12px",
    fontSize: "1rem",
    border: "1px solid #ccc",
    borderRadius: "8px",
  },
  button: {
    padding: "12px 18px",
    borderRadius: "8px",
    border: "none",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
    fontSize: "1rem",
  },
  error: {
    background: "#ffe5e5",
    color: "#b00020",
    padding: "12px",
    borderRadius: "8px",
    marginBottom: "16px",
  },
  metaCard: {
    background: "#fff",
    border: "1px solid #e5e5e5",
    borderRadius: "12px",
    padding: "16px",
    marginBottom: "16px",
    display: "flex",
    gap: "20px",
    flexWrap: "wrap",
  },
  spreadCardsWrapper: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "16px",
    marginBottom: "16px",
  },
  spreadCard: {
    background: "#fff",
    border: "1px solid #e5e5e5",
    borderRadius: "12px",
    padding: "16px",
  },
  resultCard: {
    background: "#fff",
    border: "1px solid #e5e5e5",
    borderRadius: "12px",
    padding: "16px",
  },
  cardTitle: {
    marginTop: 0,
    marginBottom: "14px",
    fontSize: "1.2rem",
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
    borderTop: "1px solid #eee",
  },
  result: {
    whiteSpace: "pre-wrap",
    lineHeight: 1.6,
    margin: 0,
  },
};