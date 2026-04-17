"use client";

import { useEffect, useMemo, useState } from "react";
import { signIn, useSession } from "next-auth/react";

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

type UsageState = {
  date: string;
  anonymousUses: number;
  authedUses: number;
  bonusUses: number;
};

const STORAGE_KEY = "swing-trade-usage-v1";
const USER_ID_KEY = "swing-trade-user-id";
const ANON_FREE_USES = 1;
const AUTHED_FREE_USES = 2;
const BONUS_USES_PER_DAY = 1;
const AD_TIMER_SECONDS = 10;

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getDefaultUsageState(): UsageState {
  return {
    date: getTodayKey(),
    anonymousUses: 0,
    authedUses: 0,
    bonusUses: 0,
  };
}

function ensureAnonymousUserId(): string {
  if (typeof window === "undefined") return "";

  let userId = window.localStorage.getItem(USER_ID_KEY);

  if (!userId) {
    userId = crypto.randomUUID();
    window.localStorage.setItem(USER_ID_KEY, userId);
  }

  return userId;
}

function readUsageState(): UsageState {
  if (typeof window === "undefined") return getDefaultUsageState();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultUsageState();

    const parsed = JSON.parse(raw) as Partial<UsageState>;
    const today = getTodayKey();

    if (parsed.date !== today) {
      return getDefaultUsageState();
    }

    return {
      date: today,
      anonymousUses: parsed.anonymousUses ?? 0,
      authedUses: parsed.authedUses ?? 0,
      bonusUses: parsed.bonusUses ?? 0,
    };
  } catch {
    return getDefaultUsageState();
  }
}

function writeUsageState(nextState: UsageState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
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
  const { data: session, status } = useSession();
  const isSignedIn = !!session?.user;
  const signedInUserId = session?.user?.email ?? "";

  const [ticker, setTicker] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<MetaData | null>(null);
  const [usage, setUsage] = useState<UsageState>(getDefaultUsageState());
  const [watchingAd, setWatchingAd] = useState(false);
  const [adCountdown, setAdCountdown] = useState(AD_TIMER_SECONDS);

  useEffect(() => {
    ensureAnonymousUserId();
    setUsage(readUsageState());
  }, []);

  useEffect(() => {
    if (!watchingAd) return;

    if (adCountdown <= 0) {
      const nextUsage = {
        ...usage,
        bonusUses: Math.min(usage.bonusUses + 1, BONUS_USES_PER_DAY),
      };
      setUsage(nextUsage);
      writeUsageState(nextUsage);
      setWatchingAd(false);
      setAdCountdown(AD_TIMER_SECONDS);
      return;
    }

    const timer = window.setTimeout(() => {
      setAdCountdown((prev) => prev - 1);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [watchingAd, adCountdown, usage]);

  const usageSummary = useMemo(() => {
    const anonymousRemaining = Math.max(ANON_FREE_USES - usage.anonymousUses, 0);
    const authedRemaining = isSignedIn
      ? Math.max(AUTHED_FREE_USES - usage.authedUses, 0)
      : AUTHED_FREE_USES;
    const bonusRemaining = Math.max(BONUS_USES_PER_DAY - usage.bonusUses, 0);

    return {
      anonymousRemaining,
      authedRemaining,
      bonusRemaining,
      totalUsed: usage.anonymousUses + usage.authedUses + usage.bonusUses,
    };
  }, [usage, isSignedIn]);

  const getGateStatus = () => {
    if (usage.anonymousUses < ANON_FREE_USES) {
      return {
        allowed: true,
        nextBucket: "anonymous" as const,
        reason: "Your first analysis today is free.",
      };
    }

    if (isSignedIn && usage.authedUses < AUTHED_FREE_USES) {
      return {
        allowed: true,
        nextBucket: "authed" as const,
        reason: "Signed-in free analyses are still available.",
      };
    }

    if (usage.bonusUses > 0) {
      return {
        allowed: true,
        nextBucket: "bonus" as const,
        reason: "Your bonus analysis is available.",
      };
    }

    return {
      allowed: false,
      nextBucket: null,
      reason: isSignedIn
        ? "You hit today’s free limit. Upgrade for unlimited analyses."
        : "Use your free analysis, then sign in with Google to unlock more.",
    };
  };

  const consumeUse = (bucket: "anonymous" | "authed" | "bonus") => {
    const nextUsage = { ...usage };

    if (bucket === "anonymous") nextUsage.anonymousUses += 1;
    if (bucket === "authed") nextUsage.authedUses += 1;
    if (bucket === "bonus") {
      nextUsage.bonusUses = Math.max(nextUsage.bonusUses - 1, 0);
    }

    setUsage(nextUsage);
    writeUsageState(nextUsage);
  };

  const analyzeStock = async () => {
    const gate = getGateStatus();

    if (!gate.allowed || !gate.nextBucket) {
      setError(gate.reason);
      return;
    }

    setLoading(true);
    setError("");
    setResult("");
    setMeta(null);

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
        throw new Error(data.error || "Failed to analyze stock.");
      }

      setResult(data.result);
      setMeta(data.meta ?? null);
      consumeUse(gate.nextBucket);
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const startBonusTimer = () => {
    if (usage.bonusUses >= BONUS_USES_PER_DAY || watchingAd) return;
    setWatchingAd(true);
    setAdCountdown(AD_TIMER_SECONDS);
  };

  const gate = getGateStatus();
  const needsGoogleGate = usage.anonymousUses >= ANON_FREE_USES && !isSignedIn;
  const hitPaywall = !gate.allowed && isSignedIn && usage.bonusUses === 0;

  return (
    <main style={styles.main}>
      <div style={styles.container}>
        <div style={styles.heroRow}>
          <div style={styles.heroText}>
            <h1 style={styles.title}>Swing Trade Analyzer</h1>
            <p style={styles.subtitle}>
              1 free analysis with no login. Sign in after that to unlock 2 more today.
            </p>
          </div>

          <div style={styles.usagePill}>
            <div>
              <strong>Today:</strong> {usageSummary.totalUsed} used
            </div>
            <div>
              <strong>Anonymous left:</strong> {usageSummary.anonymousRemaining}
            </div>
            <div>
              <strong>Signed-in left:</strong> {usageSummary.authedRemaining}
            </div>
            <div>
              <strong>Bonus left:</strong> {usageSummary.bonusRemaining}
            </div>
            <div>
              <strong>Status:</strong>{" "}
              {status === "loading"
                ? "Checking sign-in..."
                : isSignedIn
                  ? `Signed in as ${session?.user?.email ?? "user"}`
                  : "Not signed in"}
            </div>
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
          />
          <button
            type="submit"
            disabled={loading || !ticker.trim() || status === "loading"}
            style={styles.button}
          >
            {loading ? "Analyzing..." : "Analyze"}
          </button>
        </form>

        {needsGoogleGate && (
          <div style={styles.gateCard}>
            <h2 style={styles.cardTitle}>Unlock 2 more free analyses today</h2>
            <p style={styles.gateText}>
              Your no-login freebie is gone. Continue with Google to unlock the next two.
            </p>

            <button onClick={() => signIn("google")} style={styles.googleButton}>
              <img
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                alt="Google"
                style={styles.googleIcon}
              />
              Continue with Google
            </button>

            <p style={styles.helperText}>
              If this button does nothing, check your auth route, provider wrapper,
              layout wrapper, env vars, redirect URI, and Google test-user setup.
            </p>
          </div>
        )}

        {hitPaywall && (
          <div style={styles.paywallCard}>
            <h2 style={styles.cardTitle}>Free limit reached</h2>
            <p style={styles.gateText}>
              You’ve used your free analyses for today. Upgrade for unlimited analyses,
              or unlock one bonus use.
            </p>

            <div style={styles.paywallActions}>
              <button style={styles.upgradeButton}>Upgrade to Pro</button>
              <button
                onClick={startBonusTimer}
                disabled={watchingAd || usage.bonusUses >= BONUS_USES_PER_DAY}
                style={styles.secondaryButton}
              >
                {watchingAd
                  ? `Watching sponsor timer... ${adCountdown}s`
                  : usage.bonusUses >= BONUS_USES_PER_DAY
                    ? "Bonus already unlocked"
                    : "Watch sponsor timer for +1"}
              </button>
            </div>

            <p style={styles.helperText}>
              Replace the sponsor timer with a real rewarded ad later. For now this keeps
              the flow testable.
            </p>
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
  usagePill: {
    background: "#111827",
    border: "1px solid #334155",
    borderRadius: "14px",
    padding: "14px 16px",
    minWidth: "260px",
    display: "grid",
    gap: "6px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
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
  secondaryButton: {
    padding: "12px 18px",
    borderRadius: "10px",
    border: "1px solid #475569",
    background: "#1e293b",
    color: "#e5e7eb",
    cursor: "pointer",
    fontSize: "0.95rem",
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
  cardTitle: {
    margin: 0,
    marginBottom: "8px",
    fontSize: "1.2rem",
    color: "#ffffff",
  },
  gateText: {
    margin: 0,
    color: "#cbd5e1",
    lineHeight: 1.6,
  },
  helperText: {
    margin: 0,
    fontSize: "0.9rem",
    color: "#94a3b8",
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