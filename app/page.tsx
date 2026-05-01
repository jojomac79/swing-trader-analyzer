"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type TouchEvent } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

// ─── Types ────────────────────────────────────────────────────────────────────
type LiveCreditSpread = {
  strategyType: "Bull Put Spread" | "Bear Call Spread";
  expiration: string; shortStrike: number; longStrike: number;
  shortBid: number; shortAsk: number; longBid: number; longAsk: number;
  shortMid: number; longMid: number; netCredit: number; width: number;
  maxProfit: number; maxLoss: number; breakeven: number;
  pop: number | null; pop50: number | null; riskReward: number;
  returnOnRisk?: number; maxLossToProfitRatio?: number;
  qualityLabel?: "Trader-Grade Setup" | "Low Return Setup";
  passesTradeFilter?: boolean;
};

type LiveDebitSpread = {
  strategyType: "Call Debit Spread" | "Put Debit Spread";
  expiration: string; longStrike: number; shortStrike: number;
  longBid: number; longAsk: number; shortBid: number; shortAsk: number;
  longMid: number; shortMid: number; netDebit: number; width: number;
  maxProfit: number; maxLoss: number; breakeven: number;
  pop: number | null; pop50: number | null; riskReward: number;
};

type LiveIronCondor = {
  strategyType: "Iron Condor"; expiration: string;
  putShortStrike: number; putLongStrike: number;
  callShortStrike: number; callLongStrike: number;
  putCredit: number; callCredit: number; totalCredit: number;
  width: number; maxProfit: number; maxLoss: number;
  lowerBreakeven: number; upperBreakeven: number;
  pop: number | null; pop50: number | null; riskReward: number;
  returnOnRisk?: number; maxLossToProfitRatio?: number;
  qualityLabel?: "Trader-Grade Setup" | "Low Return Setup";
  passesTradeFilter?: boolean;
};

type LiveDiagonalSpread = {
  strategyType: "Call Diagonal" | "Put Diagonal";
  nearExpiration: string; farExpiration: string;
  longStrike: number; shortStrike: number;
  longBid: number; longAsk: number; shortBid: number; shortAsk: number;
  longMid: number; shortMid: number; netDebit: number;
};

type LiveLongOption = {
  strategyType: "Long Call" | "Long Put";
  expiration: string; strike: number; bid: number; ask: number; mid: number; maxRisk: number;
};

type HeadlineItem = { headline: string; source: string; url: string; };

type TradeFilters = {
  minReturnOnRisk: number;
  idealReturnOnRisk: number;
  maxLossToProfitRatio: number;
  preferredShortDeltaMin: number;
  preferredShortDeltaMax: number;
};

type MetaData = {
  symbol?: string; originalInput?: string;
  resolvedFromName?: boolean; resolvedDisplayName?: string | null;
  currentPrice?: string; nextEarnings?: string;
  selectedExpiration?: string | null; nearExpiration?: string; farExpiration?: string | null;
  liveCallDebit?: LiveDebitSpread | null; livePutDebit?: LiveDebitSpread | null;
  liveBullPut?: LiveCreditSpread | null; liveBearCall?: LiveCreditSpread | null;
  liveBullPutSpread?: LiveCreditSpread | null; liveBearCallSpread?: LiveCreditSpread | null;
  liveCallDiagonal?: LiveDiagonalSpread | null; livePutDiagonal?: LiveDiagonalSpread | null;
  liveIronCondor?: LiveIronCondor | null; liveLongCall?: LiveLongOption | null; liveLongPut?: LiveLongOption | null;
  recentHeadlines?: HeadlineItem[];
  tradeFilters?: TradeFilters | null;
  techData?: {
    rsi14: number | null; macdLine: number | null; macdSignal: number | null; macdHist: number | null;
    ema20: number | null; ema50: number | null; ema200: number | null;
    week52High: number | null; week52Low: number | null;
    weeklyResistance: number | null; weeklySupport: number | null;
    avgVolume20: number | null; currentVolume: number | null; volumeRatio: number | null;
    atr14: number | null; priceVsEma20: string | null; priceVsEma50: string | null; priceVsEma200: string | null;
  } | null;
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

function getBiasFromResult(result: string): "Bullish" | "Bearish" | "Neutral" | null {
  if (!result) return null;
  const clean = result.replace(/\*\*/g, "");
  const match = clean.match(/Overall Bias:\s*[\r\n\-\s]*(Bullish|Bearish|Neutral)/i);
  if (!match?.[1]) return null;
  const bias = match[1].toLowerCase();
  if (bias === "bullish") return "Bullish";
  if (bias === "bearish") return "Bearish";
  if (bias === "neutral") return "Neutral";
  return null;
}

function getConfidenceScore(result: string): string | null {
  if (!result) return null;
  const clean = result.replace(/\*\*/g, "");
  const match = clean.match(/Confidence:\s*([\d.]+\/10)/i);
  return match?.[1] ?? null;
}

function getTradeTarget(result: string): string | null {
  if (!result) return null;
  const clean = result.replace(/\*\*/g, "");
  const match = clean.match(/Target:\s*([^\n]+)/i);
  return match?.[1]?.trim() ?? null;
}

function getTradeInvalidate(result: string): string | null {
  if (!result) return null;
  const clean = result.replace(/\*\*/g, "");
  const match = clean.match(/Invalidate:\s*([^\n]+)/i);
  return match?.[1]?.trim() ?? null;
}

function getPreferredStrategy(result: string): string | null {
  if (!result) return null;
  const clean = result.replace(/\*\*/g, "");
  const match = clean.match(/Preferred Strategy:\s*[-\s]*(Call Debit Spread|Put Debit Spread|Bull Put Spread|Bear Call Spread|Call Diagonal|Put Diagonal|Iron Condor|No Trade)/i);
  return match?.[1] ?? null;
}

function getAltTradeText(result: string): string | null {
  if (!result) return null;
  const match = result.match(/Alt Trade Idea \(max risk\):\s*-\s*([^\n]+)/i);
  return match?.[1]?.trim().replace(/\*\*/g, "") ?? null;
}

function pickFallbackTrade(meta: MetaData, bias: "Bullish" | "Bearish" | "Neutral" | null): SelectedTradeCard {
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
  return null;
}

function pickAltTrade(meta: MetaData, bias: "Bullish" | "Bearish" | "Neutral" | null): LiveLongOption | null {
  if (bias === "Bullish" && meta.liveLongCall) return meta.liveLongCall;
  if (bias === "Bearish" && meta.liveLongPut) return meta.liveLongPut;
  return null;
}

function normalizeMetaData(raw: MetaData | null | undefined): MetaData | null {
  if (!raw) return null;
  return {
    ...raw,
    selectedExpiration: raw.selectedExpiration ?? raw.nearExpiration ?? null,
    nearExpiration: raw.nearExpiration ?? raw.selectedExpiration ?? undefined,
    liveBullPut: raw.liveBullPut ?? raw.liveBullPutSpread ?? null,
    liveBearCall: raw.liveBearCall ?? raw.liveBearCallSpread ?? null,
    liveBullPutSpread: raw.liveBullPutSpread ?? raw.liveBullPut ?? null,
    liveBearCallSpread: raw.liveBearCallSpread ?? raw.liveBearCall ?? null,
  };
}

function getQualityColor(label?: "Trader-Grade Setup" | "Low Return Setup"): string {
  return label === "Trader-Grade Setup" ? "#22c55e" : "#f59e0b";
}

function getPopColor(pop: number): string {
  if (pop >= 70) return "#22c55e";
  if (pop >= 50) return "#f59e0b";
  return "#ef4444";
}

// ─── Animated ellipsis hook ───────────────────────────────────────────────────
function useAnimatedDots(active: boolean): string {
  const [dots, setDots] = useState("");
  useEffect(() => {
    if (!active) { setDots(""); return; }
    const id = setInterval(() => setDots(d => d.length >= 3 ? "" : d + "."), 400);
    return () => clearInterval(id);
  }, [active]);
  return dots;
}

function TradeSummaryCard({ bias, confidence, strategy, target, invalidate, onViewAnalysis }: {
  bias: "Bullish" | "Bearish" | "Neutral" | null;
  confidence: string | null; strategy: string | null;
  target: string | null; invalidate: string | null;
  onViewAnalysis?: () => void;
}) {
  if (!bias && !strategy) return null;
  const biasColor = bias === "Bullish" ? "#22c55e" : bias === "Bearish" ? "#ef4444" : "#f59e0b";
  const biasIcon = bias === "Bullish" ? "📈" : bias === "Bearish" ? "📉" : "↔️";
  return (
    <div style={styles.summaryCard}>
      <div style={styles.summaryHeader}>
        <span style={styles.summaryIcon}>🎯</span>
        <span style={styles.summaryTitle}>PREFERRED TRADE SUMMARY</span>
        {onViewAnalysis && (
          <button onClick={onViewAnalysis} style={styles.summaryActionButton}>
            {strategy === "No Trade" ? "View analysis" : "Why this trade?"}
          </button>
        )}
      </div>
      <div style={styles.summaryGrid}>
        {bias && <div style={styles.summaryItem}><span style={styles.summaryLabel}>Bias</span><span style={{ ...styles.summaryValue, color: biasColor }}>{biasIcon} {bias}</span></div>}
        {confidence && <div style={styles.summaryItem}><span style={styles.summaryLabel}>Confidence</span><span style={{ ...styles.summaryValue, color: "#f59e0b" }}>{confidence}</span></div>}
        {strategy && strategy !== "No Trade" && <div style={{ ...styles.summaryItem, gridColumn: "1 / -1" }}><span style={styles.summaryLabel}>Best Play</span><span style={{ ...styles.summaryValue, color: "#e5e7eb", fontSize: "0.95rem" }}>→ {strategy}</span></div>}
        {target && <div style={styles.summaryItem}><span style={styles.summaryLabel}>Target</span><span style={{ ...styles.summaryValue, color: "#22c55e", fontSize: "0.85rem" }}>{target}</span></div>}
        {invalidate && <div style={styles.summaryItem}><span style={styles.summaryLabel}>Invalidate</span><span style={{ ...styles.summaryValue, color: "#ef4444", fontSize: "0.85rem" }}>{invalidate}</span></div>}
        {strategy === "No Trade" && <div style={{ ...styles.summaryItem, gridColumn: "1 / -1" }}><span style={{ color: "#94a3b8", fontSize: "0.88rem" }}>⏸ No clear edge — wait for confirmation</span></div>}
      </div>
    </div>
  );
}

function StatBar({ pop, pop50, riskReward }: { pop: number | null; pop50: number | null; riskReward: number }) {
  return (
    <div style={styles.statBar}>
      <div style={styles.statItem}>
        <span style={styles.statLabel}>R:R <span style={styles.statLabelSub}>(Risk/Reward)</span></span>
        <span style={styles.statValue}>{riskReward.toFixed(2)}:1</span>
      </div>
      {pop != null && <div style={styles.statItem}><span style={styles.statLabel}>PoP <span style={styles.statLabelSub}>(Probability of Profit)</span></span><span style={{ ...styles.statValue, color: getPopColor(pop) }}>{pop}%</span></div>}
      {pop50 != null && <div style={styles.statItem}><span style={styles.statLabel}>PoP50 <span style={styles.statLabelSub}>(Prob. of 50% Profit)</span></span><span style={{ ...styles.statValue, color: getPopColor(pop50) }}>{pop50}%</span></div>}
    </div>
  );
}


function CollapsibleTradeSection({
  icon,
  title,
  subtitle,
  badge,
  accent,
  badgeStyle,
  children,
  defaultCollapsed = true,
}: {
  icon: string;
  title: string;
  subtitle: string;
  badge?: string;
  accent: string;
  badgeStyle?: CSSProperties;
  children: ReactNode;
  defaultCollapsed?: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <div style={{ ...styles.collapsibleShell, borderColor: `${accent}55`, boxShadow: `0 10px 30px ${accent}18` }}>
      <button
        type="button"
        onClick={() => setIsCollapsed((v) => !v)}
        style={{
          ...styles.collapsibleHeaderButton,
          background: isCollapsed ? `${accent}14` : `${accent}0d`,
        }}
      >
        <div style={styles.collapsibleHeaderLeft}>
          <div style={{ ...styles.collapsibleIconWrap, boxShadow: `0 0 0 1px ${accent}55 inset` }}>
            <span style={styles.collapsibleIcon}>{icon}</span>
          </div>
          <div style={styles.collapsibleTitleWrap}>
            <div style={styles.collapsibleTitleRow}>
              <span style={styles.collapsibleTitle}>{title}</span>
              {badge && <span style={{ ...styles.collapsibleBadge, ...(badgeStyle ?? {}) }}>{badge}</span>}
            </div>
            <span style={styles.collapsibleSubtitle}>{isCollapsed ? "Tap to expand" : subtitle}</span>
          </div>
        </div>
        <span style={styles.collapsibleChevron}>{isCollapsed ? "▾" : "▴"}</span>
      </button>
      {!isCollapsed && <div style={styles.collapsibleBody}>{children}</div>}
    </div>
  );
}

function AdvancedCardActions({ onTutorial, onGrade }: { onTutorial: () => void; onGrade?: () => void }) {
  return (
    <div style={styles.advancedCardActions}>
      <button onClick={onTutorial} style={styles.tutorialBtn}>📖 How it works</button>
      {onGrade && (
        <button onClick={onGrade} style={{ ...styles.tutorialBtn, background: "#6366f1", color: "#fff", border: "1px solid #6366f1", fontWeight: 700 }}>
          🎯 Grade This Trade
        </button>
      )}
    </div>
  );
}


function DebitCard({ spread, currentPrice, onTutorial, onGrade }: { spread: LiveDebitSpread; currentPrice: string; onTutorial: () => void; onGrade?: () => void }) {
  const longLabel = spread.strategyType === "Call Debit Spread" ? "Long Call" : "Long Put";
  const shortLabel = spread.strategyType === "Call Debit Spread" ? "Short Call" : "Short Put";
  const price = parseFloat(currentPrice);
  const stopLoss = spread.strategyType === "Call Debit Spread" ? (price * 0.95).toFixed(2) : (price * 1.05).toFixed(2);

  return (
    <CollapsibleTradeSection
      icon="⚡"
      title="Advanced Trade Idea"
      subtitle="Expanded multi-leg setup with live options data."
      badge={spread.strategyType}
      accent="#60a5fa"
      badgeStyle={{ background: "#1e3a5f", color: "#93c5fd" }}
    >
      <div style={styles.tradeCard}>
        <AdvancedCardActions onTutorial={onTutorial} onGrade={onGrade} />
        <div style={styles.tradeGrid}>
          <div><strong>Strategy</strong><br />{spread.strategyType}</div>
          <div><strong>Expiration</strong><br />{spread.expiration}</div>
          <div><strong>{spread.strategyType === "Call Debit Spread" ? "Call Side" : "Put Side"}</strong><br />{spread.longStrike} / {spread.shortStrike}</div>
          <div><strong>Net Debit</strong><br />${spread.netDebit.toFixed(2)}</div>
          <div><strong>Breakeven</strong><br />${spread.breakeven.toFixed(2)}</div>
          <div><strong>Max Profit</strong><br />${spread.maxProfit.toFixed(2)}</div>
          <div><strong>Max Loss</strong><br />${spread.maxLoss.toFixed(2)}</div>
          <div><strong>Stop Loss (Underlying)</strong><br /><span style={{ color: "#ef4444", fontWeight: 700 }}>${stopLoss}</span></div>
        </div>
        <div style={styles.quoteRow}>
          <div><strong>{longLabel} Bid/Ask</strong><br />{spread.longBid.toFixed(2)} / {spread.longAsk.toFixed(2)}</div>
          <div><strong>{shortLabel} Bid/Ask</strong><br />{spread.shortBid.toFixed(2)} / {spread.shortAsk.toFixed(2)}</div>
        </div>
        <StatBar pop={spread.pop} pop50={spread.pop50} riskReward={spread.riskReward} />
        <div style={styles.brokerLabel}>🏦 Recommended brokerages for this setup</div>
        <a href="https://tastytrade.com/welcome/?referralCode=WZQ7CK6HGE" target="_blank" rel="noopener noreferrer" style={styles.affiliateBar}>
          <span style={styles.affiliateBarLeft}><span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>🍒</span><span><strong>Trade on tastytrade</strong> — built for options traders &amp; multi-leg setups</span></span>
          <span style={styles.affiliateCta}>Open Account →</span>
        </a>
        <a href="https://trade.tradier.com/raf-open/?mwr=c21d7953" target="_blank" rel="noopener noreferrer" style={{ ...styles.affiliateBar, marginTop: "8px", background: "#0a1a2e", borderColor: "#1e3a5f" }}>
          <span style={{ ...styles.affiliateBarLeft, color: "#60a5fa" }}><span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>📈</span><span><strong>Trade on Tradier</strong> — low-cost options &amp; powerful API-driven platform</span></span>
          <span style={{ ...styles.affiliateCta, color: "#60a5fa" }}>Open Account →</span>
        </a>
      </div>
    </CollapsibleTradeSection>
  );
}


function CreditCard({ spread, currentPrice, onTutorial, onGrade }: { spread: LiveCreditSpread; currentPrice: string; onTutorial: () => void; onGrade?: () => void }) {
  const shortLabel = spread.strategyType === "Bull Put Spread" ? "Short Put" : "Short Call";
  const longLabel = spread.strategyType === "Bull Put Spread" ? "Long Put" : "Long Call";
  const sideLabel = spread.strategyType === "Bull Put Spread" ? "Put Side" : "Call Side";
  const price = parseFloat(currentPrice);
  const stopLoss = spread.strategyType === "Bull Put Spread" ? (price * 0.95).toFixed(2) : (price * 1.05).toFixed(2);

  return (
    <CollapsibleTradeSection
      icon="⚡"
      title="Advanced Trade Idea"
      subtitle="Expanded multi-leg setup with live options data."
      badge={spread.strategyType}
      accent="#60a5fa"
      badgeStyle={{ background: "#1e3a5f", color: "#93c5fd" }}
    >
      <div style={styles.tradeCard}>
        <AdvancedCardActions onTutorial={onTutorial} onGrade={onGrade} />
        <div style={styles.tradeGrid}>
          <div><strong>Strategy</strong><br />{spread.strategyType}</div>
          <div><strong>Expiration</strong><br />{spread.expiration}</div>
          <div><strong>{sideLabel}</strong><br />{spread.shortStrike} / {spread.longStrike}</div>
          <div><strong>Total Credit</strong><br />${spread.netCredit.toFixed(2)}</div>
          <div><strong>Breakeven</strong><br />${spread.breakeven.toFixed(2)}</div>
          <div><strong>Max Profit</strong><br />${spread.maxProfit.toFixed(2)}</div>
          <div><strong>Max Loss</strong><br />${spread.maxLoss.toFixed(2)}</div>
          <div><strong>Stop Loss (Underlying)</strong><br /><span style={{ color: "#ef4444", fontWeight: 700 }}>${stopLoss}</span></div>
        </div>
        <div style={styles.quoteRow}>
          <div><strong>{shortLabel} Bid/Ask</strong><br />{spread.shortBid.toFixed(2)} / {spread.shortAsk.toFixed(2)}</div>
          <div><strong>{longLabel} Bid/Ask</strong><br />{spread.longBid.toFixed(2)} / {spread.longAsk.toFixed(2)}</div>
        </div>
        <StatBar pop={spread.pop} pop50={spread.pop50} riskReward={spread.riskReward} />
        {spread.qualityLabel && (
          <div style={styles.setupQualityBox}>
            <div><strong>Setup Quality:</strong> <span style={{ color: getQualityColor(spread.qualityLabel) }}>{spread.qualityLabel}</span></div>
            {typeof spread.returnOnRisk === "number" && <div><strong>Return on Risk:</strong> {(spread.returnOnRisk * 100).toFixed(1)}%</div>}
            {typeof spread.maxLossToProfitRatio === "number" && <div><strong>Max Loss to Profit:</strong> {spread.maxLossToProfitRatio.toFixed(2)}:1</div>}
          </div>
        )}
        <div style={styles.brokerLabel}>🏦 Recommended brokerages for this setup</div>
        <a href="https://tastytrade.com/welcome/?referralCode=WZQ7CK6HGE" target="_blank" rel="noopener noreferrer" style={styles.affiliateBar}>
          <span style={styles.affiliateBarLeft}><span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>🍒</span><span><strong>Trade on tastytrade</strong> — built for options traders &amp; multi-leg setups</span></span>
          <span style={styles.affiliateCta}>Open Account →</span>
        </a>
        <a href="https://trade.tradier.com/raf-open/?mwr=c21d7953" target="_blank" rel="noopener noreferrer" style={{ ...styles.affiliateBar, marginTop: "8px", background: "#0a1a2e", borderColor: "#1e3a5f" }}>
          <span style={{ ...styles.affiliateBarLeft, color: "#60a5fa" }}><span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>📈</span><span><strong>Trade on Tradier</strong> — low-cost options &amp; powerful API-driven platform</span></span>
          <span style={{ ...styles.affiliateCta, color: "#60a5fa" }}>Open Account →</span>
        </a>
      </div>
    </CollapsibleTradeSection>
  );
}


function DiagonalCard({ spread, currentPrice, onTutorial, onGrade }: { spread: LiveDiagonalSpread; currentPrice: string; onTutorial: () => void; onGrade?: () => void }) {
  const longLabel = spread.strategyType === "Call Diagonal" ? "Far Long Call" : "Far Long Put";
  const shortLabel = spread.strategyType === "Call Diagonal" ? "Near Short Call" : "Near Short Put";
  const price = parseFloat(currentPrice);
  const stopLoss = spread.strategyType === "Call Diagonal" ? (price * 0.95).toFixed(2) : (price * 1.05).toFixed(2);

  return (
    <CollapsibleTradeSection
      icon="⚡"
      title="Advanced Trade Idea"
      subtitle="Expanded multi-leg setup with live options data."
      badge={spread.strategyType}
      accent="#60a5fa"
      badgeStyle={{ background: "#1e3a5f", color: "#93c5fd" }}
    >
      <div style={styles.tradeCard}>
        <AdvancedCardActions onTutorial={onTutorial} onGrade={onGrade} />
        <div style={styles.tradeGrid}>
          <div><strong>Strategy</strong><br />{spread.strategyType}</div>
          <div><strong>Near Exp</strong><br />{spread.nearExpiration}</div>
          <div><strong>Far Exp</strong><br />{spread.farExpiration}</div>
          <div><strong>{spread.strategyType === "Call Diagonal" ? "Call Side" : "Put Side"}</strong><br />{spread.longStrike} / {spread.shortStrike}</div>
          <div><strong>Net Debit</strong><br />${spread.netDebit.toFixed(2)}</div>
          <div><strong>Note</strong><br />Path-dependent</div>
          <div><strong>Stop Loss (Underlying)</strong><br /><span style={{ color: "#ef4444", fontWeight: 700 }}>${stopLoss}</span></div>
        </div>
        <div style={styles.quoteRow}>
          <div><strong>{longLabel} Bid/Ask</strong><br />{spread.longBid.toFixed(2)} / {spread.longAsk.toFixed(2)}</div>
          <div><strong>{shortLabel} Bid/Ask</strong><br />{spread.shortBid.toFixed(2)} / {spread.shortAsk.toFixed(2)}</div>
        </div>
        <div style={styles.brokerLabel}>🏦 Recommended brokerages for this setup</div>
        <a href="https://tastytrade.com/welcome/?referralCode=WZQ7CK6HGE" target="_blank" rel="noopener noreferrer" style={styles.affiliateBar}>
          <span style={styles.affiliateBarLeft}><span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>🍒</span><span><strong>Trade on tastytrade</strong> — built for options traders &amp; multi-leg setups</span></span>
          <span style={styles.affiliateCta}>Open Account →</span>
        </a>
        <a href="https://trade.tradier.com/raf-open/?mwr=c21d7953" target="_blank" rel="noopener noreferrer" style={{ ...styles.affiliateBar, marginTop: "8px", background: "#0a1a2e", borderColor: "#1e3a5f" }}>
          <span style={{ ...styles.affiliateBarLeft, color: "#60a5fa" }}><span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>📈</span><span><strong>Trade on Tradier</strong> — low-cost options &amp; powerful API-driven platform</span></span>
          <span style={{ ...styles.affiliateCta, color: "#60a5fa" }}>Open Account →</span>
        </a>
      </div>
    </CollapsibleTradeSection>
  );
}


function IronCondorCard({ spread, currentPrice, onTutorial, onGrade }: { spread: LiveIronCondor; currentPrice: string; onTutorial: () => void; onGrade?: () => void }) {
  const price = parseFloat(currentPrice);
  const lowerStop = (price * 0.95).toFixed(2);
  const upperStop = (price * 1.05).toFixed(2);

  return (
    <CollapsibleTradeSection
      icon="⚡"
      title="Advanced Trade Idea"
      subtitle="Expanded multi-leg setup with live options data."
      badge={spread.strategyType}
      accent="#60a5fa"
      badgeStyle={{ background: "#1e3a5f", color: "#93c5fd" }}
    >
      <div style={styles.tradeCard}>
        <AdvancedCardActions onTutorial={onTutorial} onGrade={onGrade} />
        <div style={styles.tradeGrid}>
          <div><strong>Strategy</strong><br />{spread.strategyType}</div>
          <div><strong>Expiration</strong><br />{spread.expiration}</div>
          <div><strong>Put Side</strong><br />{spread.putShortStrike} / {spread.putLongStrike}</div>
          <div><strong>Call Side</strong><br />{spread.callShortStrike} / {spread.callLongStrike}</div>
          <div><strong>Total Credit</strong><br />${spread.totalCredit.toFixed(2)}</div>
          <div><strong>Lower B/E</strong><br />${spread.lowerBreakeven.toFixed(2)}</div>
          <div><strong>Upper B/E</strong><br />${spread.upperBreakeven.toFixed(2)}</div>
          <div><strong>Max Profit</strong><br />${spread.maxProfit.toFixed(2)}</div>
          <div><strong>Max Loss</strong><br />${spread.maxLoss.toFixed(2)}</div>
          <div><strong>Stop Loss (Underlying)</strong><br /><span style={{ color: "#ef4444", fontWeight: 700 }}>${lowerStop} / ${upperStop}</span></div>
        </div>
        <StatBar pop={spread.pop} pop50={spread.pop50} riskReward={spread.riskReward} />
        {spread.qualityLabel && (
          <div style={styles.setupQualityBox}>
            <div><strong>Setup Quality:</strong> <span style={{ color: getQualityColor(spread.qualityLabel) }}>{spread.qualityLabel}</span></div>
            {typeof spread.returnOnRisk === "number" && <div><strong>Return on Risk:</strong> {(spread.returnOnRisk * 100).toFixed(1)}%</div>}
            {typeof spread.maxLossToProfitRatio === "number" && <div><strong>Max Loss to Profit:</strong> {spread.maxLossToProfitRatio.toFixed(2)}:1</div>}
          </div>
        )}
        <div style={styles.brokerLabel}>🏦 Recommended brokerages for this setup</div>
        <a href="https://tastytrade.com/welcome/?referralCode=WZQ7CK6HGE" target="_blank" rel="noopener noreferrer" style={styles.affiliateBar}>
          <span style={styles.affiliateBarLeft}><span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>🍒</span><span><strong>Trade on tastytrade</strong> — built for options traders &amp; multi-leg setups</span></span>
          <span style={styles.affiliateCta}>Open Account →</span>
        </a>
        <a href="https://trade.tradier.com/raf-open/?mwr=c21d7953" target="_blank" rel="noopener noreferrer" style={{ ...styles.affiliateBar, marginTop: "8px", background: "#0a1a2e", borderColor: "#1e3a5f" }}>
          <span style={{ ...styles.affiliateBarLeft, color: "#60a5fa" }}><span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>📈</span><span><strong>Trade on Tradier</strong> — low-cost options &amp; powerful API-driven platform</span></span>
          <span style={{ ...styles.affiliateCta, color: "#60a5fa" }}>Open Account →</span>
        </a>
      </div>
    </CollapsibleTradeSection>
  );
}

function TradeFiltersCard({ filters }: { filters: TradeFilters }) {
  return (
    <CollapsibleTradeSection
      icon="🧮"
      title="Trade Filters"
      subtitle="Guardrails that keep premium-selling setups from getting too weak or too risky."
      badge="Risk Rules"
      accent="#a78bfa"
      badgeStyle={{ background: "#312e81", color: "#c4b5fd" }}
    >
      <div style={styles.filterCard}>
        <p style={styles.filterIntro}>
          Plain English: the app is trying not to recommend junky little premium plays just because the PoP looks cute.
        </p>
        <div style={{ ...styles.beginnerNote, marginBottom: "14px" }}>
          <strong>What this means:</strong> credit spreads and condors need decent payout, reasonable downside, and short strikes in a safer sweet spot.
        </div>
        <div style={styles.filterGrid}>
          <div style={styles.filterItem}>
            <strong>Minimum Return on Risk</strong><br />
            {(filters.minReturnOnRisk * 100).toFixed(0)}%
            <div style={styles.filterNote}>
              Translation: if a premium-selling trade pays less than this versus the max risk, it&apos;s too weak and should usually get tossed.
            </div>
          </div>
          <div style={styles.filterItem}>
            <strong>Ideal Return on Risk</strong><br />
            {(filters.idealReturnOnRisk * 100).toFixed(0)}%
            <div style={styles.filterNote}>
              Translation: this is the healthier target zone. If a credit setup reaches this, it&apos;s a much more respectable payout.
            </div>
          </div>
          <div style={styles.filterItem}>
            <strong>Max Loss to Profit Ratio</strong><br />
            {filters.maxLossToProfitRatio}:1
            <div style={styles.filterNote}>
              Translation: the app won&apos;t bless a trade where you&apos;re risking a stupid amount just to make a tiny credit.
            </div>
          </div>
          <div style={styles.filterItem}>
            <strong>Preferred Short Delta Range</strong><br />
            {filters.preferredShortDeltaMin.toFixed(2)} - {filters.preferredShortDeltaMax.toFixed(2)}
            <div style={styles.filterNote}>
              Translation: for credit spreads, this is the preferred zone for the short strike so it&apos;s not too aggressive or too far OTM for crumbs.
            </div>
          </div>
        </div>
      </div>
    </CollapsibleTradeSection>
  );
}

function TechCard({ tech }: { tech: NonNullable<MetaData["techData"]> }) {
  const rsiColor = tech.rsi14 !== null
    ? tech.rsi14 >= 70 ? "#ef4444" : tech.rsi14 <= 30 ? "#22c55e" : tech.rsi14 >= 55 ? "#22c55e" : tech.rsi14 <= 45 ? "#ef4444" : "#94a3b8"
    : "#94a3b8";
  const macdBullish = tech.macdLine !== null && tech.macdSignal !== null && tech.macdLine > tech.macdSignal;
  const volColor = tech.volumeRatio !== null ? tech.volumeRatio >= 1.5 ? "#22c55e" : tech.volumeRatio < 0.7 ? "#f59e0b" : "#94a3b8" : "#94a3b8";
  return (
    <div style={styles.techCard}>
      <h2 style={styles.cardTitle}>📊 Technical Analysis</h2>
      <div style={styles.techGrid}>
        <div style={styles.techItem}>
          <span style={styles.techLabel}>RSI (14)</span>
          <span style={{ ...styles.techValue, color: rsiColor }}>{tech.rsi14 ?? "—"}</span>
          <span style={styles.techNote}>{tech.rsi14 !== null ? (tech.rsi14 >= 70 ? "Overbought" : tech.rsi14 <= 30 ? "Oversold" : tech.rsi14 >= 55 ? "Bullish" : tech.rsi14 <= 45 ? "Bearish" : "Neutral") : "—"}</span>
        </div>
        <div style={styles.techItem}>
          <span style={styles.techLabel}>MACD</span>
          <span style={{ ...styles.techValue, color: macdBullish ? "#22c55e" : "#ef4444" }}>{tech.macdLine?.toFixed(3) ?? "—"}</span>
          <span style={styles.techNote}>Signal: {tech.macdSignal?.toFixed(3) ?? "—"}</span>
        </div>
        <div style={styles.techItem}>
          <span style={styles.techLabel}>MACD Hist</span>
          <span style={{ ...styles.techValue, color: (tech.macdHist ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>{tech.macdHist?.toFixed(3) ?? "—"}</span>
          <span style={styles.techNote}>{(tech.macdHist ?? 0) >= 0 ? "Bullish" : "Bearish"}</span>
        </div>
        <div style={styles.techItem}>
          <span style={styles.techLabel}>ATR (14)</span>
          <span style={styles.techValue}>{tech.atr14 !== null ? `$${tech.atr14}` : "—"}</span>
          <span style={styles.techNote}>Daily range</span>
        </div>
        <div style={styles.techItem}>
          <span style={styles.techLabel}>EMA 20</span>
          <span style={styles.techValue}>{tech.ema20 !== null ? `$${tech.ema20}` : "—"}</span>
          <span style={{ ...styles.techNote, color: tech.priceVsEma20 === "above" ? "#22c55e" : "#ef4444" }}>{tech.priceVsEma20 ? `Price ${tech.priceVsEma20}` : "—"}</span>
        </div>
        <div style={styles.techItem}>
          <span style={styles.techLabel}>EMA 50</span>
          <span style={styles.techValue}>{tech.ema50 !== null ? `$${tech.ema50}` : "—"}</span>
          <span style={{ ...styles.techNote, color: tech.priceVsEma50 === "above" ? "#22c55e" : "#ef4444" }}>{tech.priceVsEma50 ? `Price ${tech.priceVsEma50}` : "—"}</span>
        </div>
        <div style={styles.techItem}>
          <span style={styles.techLabel}>4-Wk Resist</span>
          <span style={{ ...styles.techValue, color: "#ef4444" }}>{tech.weeklyResistance !== null ? `$${tech.weeklyResistance}` : "—"}</span>
          <span style={styles.techNote}>Recent high</span>
        </div>
        <div style={styles.techItem}>
          <span style={styles.techLabel}>4-Wk Support</span>
          <span style={{ ...styles.techValue, color: "#22c55e" }}>{tech.weeklySupport !== null ? `$${tech.weeklySupport}` : "—"}</span>
          <span style={styles.techNote}>Recent low</span>
        </div>
        <div style={styles.techItem}>
          <span style={styles.techLabel}>Vol Ratio</span>
          <span style={{ ...styles.techValue, color: volColor }}>{tech.volumeRatio !== null ? `${tech.volumeRatio}x` : "—"}</span>
          <span style={styles.techNote}>vs 20d avg</span>
        </div>
      </div>
    </div>
  );
}


function BeginnerCard({ bias, symbol, currentPrice }: { bias: "Bullish" | "Bearish"; symbol: string; currentPrice: string }) {
  const isBullish = bias === "Bullish";
  const price = parseFloat(currentPrice);
  const stopLoss = isBullish ? (price * 0.95).toFixed(2) : (price * 1.05).toFixed(2);

  return (
    <CollapsibleTradeSection
      icon="🟢"
      title="Beginner Trade Idea"
      subtitle="Simple directional play with shares only."
      badge="Shares Only"
      accent="#22c55e"
      badgeStyle={{ background: "#166534", color: "#bbf7d0" }}
    >
      <div style={styles.beginnerCard}>
        <p style={styles.beginnerSubtitle}>Simple directional play — no options required.</p>
        <div style={styles.tradeGrid}>
          <div><strong>Action</strong><br /><span style={{ color: isBullish ? "#22c55e" : "#ef4444", fontWeight: 700, fontSize: "1.1rem" }}>{isBullish ? "Buy Shares" : "Short Shares"}</span></div>
          <div><strong>Symbol</strong><br />{symbol}</div>
          <div><strong>Current Price</strong><br />${currentPrice}</div>
          <div><strong>Stop Loss</strong><br /><span style={{ color: "#ef4444", fontWeight: 700 }}>${stopLoss}</span></div>
        </div>
        <div style={styles.beginnerNote}><strong>How it works:</strong> {isBullish ? "Buy shares and hold while the stock moves up. Sell when your target is hit or your thesis changes." : "Borrow and sell shares now, buy them back cheaper later. Profit from the price decline."}</div>
        <div style={styles.beginnerWarning}>⚠️ {isBullish ? "Risk: Stock could decline. Only invest what you can afford to lose." : "Risk: Shorting has theoretically unlimited loss if the stock rises. Use a stop loss."}</div>
        <div style={styles.brokerLabel}>🏦 Recommended brokerages for this setup</div>
        <a href="https://join.robinhood.com/josephm-5b8d2b" target="_blank" rel="noopener noreferrer" style={styles.affiliateBar}>
          <span style={styles.affiliateBarLeft}><img src="https://robinhood.com/favicon.ico" alt="Robinhood" style={{ width: "18px", height: "18px", borderRadius: "4px", flexShrink: 0 }} /><span><strong>Trade on Robinhood</strong> — simple stock trading for beginner-friendly execution</span></span>
          <span style={styles.affiliateCta}>Open Account →</span>
        </a>
        <a href="https://trade.tradier.com/raf-open/?mwr=c21d7953" target="_blank" rel="noopener noreferrer" style={{ ...styles.affiliateBar, marginTop: "8px", background: "#0a1a2e", borderColor: "#1e3a5f" }}>
          <span style={{ ...styles.affiliateBarLeft, color: "#60a5fa" }}><span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>📈</span><span><strong>Trade on Tradier</strong> — low-cost options &amp; powerful API-driven platform</span></span>
          <span style={{ ...styles.affiliateCta, color: "#60a5fa" }}>Open Account →</span>
        </a>
      </div>
    </CollapsibleTradeSection>
  );
}


function AltTradeCard({ option, parsedLine, currentPrice, onGrade }: { option: LiveLongOption; parsedLine: string | null; currentPrice: string; onGrade?: () => void }) {
  const price = parseFloat(currentPrice);
  const stopLoss = option.strategyType === "Long Call" ? (price * 0.95).toFixed(2) : (price * 1.05).toFixed(2);

  return (
    <CollapsibleTradeSection
      icon="🎯"
      title="Max Risk Trade Idea"
      subtitle="Simpler single-leg option alternative."
      badge={option.strategyType}
      accent="#f59e0b"
      badgeStyle={{ background: "#3b2503", color: "#fcd34d" }}
    >
      <div style={styles.altTradeCard}>
        {parsedLine && <div style={styles.altTradeText}>{parsedLine}</div>}
        <div style={styles.tradeGrid}>
          <div><strong>Strategy</strong><br />{option.strategyType}</div>
          <div><strong>Expiration</strong><br />{option.expiration}</div>
          <div><strong>Strike</strong><br />{option.strike}</div>
          <div><strong>Bid/Ask</strong><br />{option.bid.toFixed(2)} / {option.ask.toFixed(2)}</div>
          <div><strong>Estimated Mid</strong><br />${option.mid.toFixed(2)}</div>
          <div><strong>Max Risk</strong><br />${option.maxRisk.toFixed(2)}</div>
          <div><strong>Stop Loss (Underlying)</strong><br /><span style={{ color: "#ef4444", fontWeight: 700 }}>${stopLoss}</span></div>
        </div>
        {onGrade && (
          <button onClick={onGrade} style={{ marginTop: "14px", width: "100%", padding: "11px", borderRadius: "10px", border: "1px solid #6366f1", background: "#1e1b4b", color: "#a5b4fc", cursor: "pointer", fontSize: "0.9rem", fontWeight: 700 }}>
            🎯 Grade This Trade
          </button>
        )}
      </div>
    </CollapsibleTradeSection>
  );
}

function getMarketStatus(): { label: string; color: string } {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);

  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const day = dayMap[weekday] ?? 0;
  const totalMinutes = hour * 60 + minute;

  const preMarketStart = 4 * 60;
  const regularOpen = 9 * 60 + 30;
  const regularClose = 16 * 60;
  const afterHoursClose = 20 * 60;

  if (day === 0 || day === 6) {
    return { label: "🔴 Market Closed", color: "#f87171" };
  }

  if (totalMinutes >= preMarketStart && totalMinutes < regularOpen) {
    return { label: "🟡 Pre-Market", color: "#fbbf24" };
  }

  if (totalMinutes >= regularOpen && totalMinutes < regularClose) {
    return { label: "🟢 Market Open", color: "#4ade80" };
  }

  if (totalMinutes >= regularClose && totalMinutes < afterHoursClose) {
    return { label: "🔵 After Hours", color: "#60a5fa" };
  }

  return { label: "🔴 Market Closed", color: "#f87171" };
}


// ─── Main component ───────────────────────────────────────────────────────────
export default function Home() {
  const { data: session, status } = useSession();
  const isSignedIn = !!session?.user;
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [disclaimerLoading, setDisclaimerLoading] = useState(false);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradePlan, setUpgradePlan] = useState<"monthly" | "yearly">("monthly");
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [ticker, setTicker] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<MetaData | null>(null);
  const [showGoogleGate, setShowGoogleGate] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallAttemptedAgain, setPaywallAttemptedAgain] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showFullAnalysis, setShowFullAnalysis] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // ─── Tab system ───────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"analyze" | "grade">("analyze");

  // ─── Grade My Trade state ─────────────────────────────────────────────────
  type TradeLeg = { action: "buy" | "sell"; type: "call" | "put" | "share"; strike: string; expiration: string; premium: string; };
  const emptyLeg = (): TradeLeg => ({ action: "buy", type: "call", strike: "", expiration: "", premium: "" });
  const [gradeTicker, setGradeTicker] = useState("");
  const [gradeLegs, setGradeLegs] = useState<TradeLeg[]>([emptyLeg()]);
  const [gradeNotes, setGradeNotes] = useState("");
  const [gradeResult, setGradeResult] = useState("");
  const [gradeMeta, setGradeMeta] = useState<{ symbol?: string; resolvedDisplayName?: string | null; currentPrice?: string; nextEarnings?: string; tradeType?: string; recentHeadlines?: { headline: string; source: string; url: string }[] } | null>(null);
  const [gradeLoading, setGradeLoading] = useState(false);
  const [gradeError, setGradeError] = useState("");
  type OptionStrike = { strike: number; call: { bid: number; ask: number; mid: number } | null; put: { bid: number; ask: number; mid: number } | null };
  const [expirations, setExpirations] = useState<string[]>([]);
  const [strikes, setStrikes] = useState<OptionStrike[]>([]);
  const [loadedExpiration, setLoadedExpiration] = useState<string>("");
  const [expLoading, setExpLoading] = useState(false);
  const [expSymbol, setExpSymbol] = useState(""); // which ticker we already loaded for

  const loadExpirations = async (tickerVal: string, force = false) => {
    const t = tickerVal.trim();
    if (!t) return;
    if (!force && t === expSymbol) return; // skip on blur if already loaded, but not on button click
    if (!isSignedIn) { setGradeError("Sign in to load expiration dates."); return; }
    setExpLoading(true);
    setGradeError("");
    setExpirations([]); setStrikes([]); setLoadedExpiration("");
    try {
      const res = await fetch(`/api/expirations?ticker=${encodeURIComponent(t)}`);
      const data = await res.json();
      if (!res.ok) {
        setGradeError(data.error ?? `Could not load dates for ${t}.`);
        return;
      }
      if (data.expirations && data.expirations.length > 0) {
        setExpirations(data.expirations);
        setExpSymbol(data.symbol ?? t);
        setStrikes(data.strikes ?? []);
        setLoadedExpiration(data.loadedExpiration ?? data.expirations[0] ?? "");
        setGradeLegs(prev => prev.map((leg, i) => i === 0 && !leg.expiration
          ? { ...leg, expiration: data.loadedExpiration ?? data.expirations[0] ?? "" }
          : leg
        ));
      } else {
        setGradeError(`No options found for ${data.symbol ?? t}. Check the ticker.`);
      }
    } catch (err) {
      setGradeError(err instanceof Error ? err.message : "Failed to load expiration dates.");
    } finally { setExpLoading(false); }
  };

  // When user changes expiration, fetch that expiration's chain for live premiums
  const loadChainForExpiration = async (exp: string) => {
    if (!exp || !expSymbol) return;
    if (exp === loadedExpiration) return;
    try {
      const res = await fetch(`/api/expirations?ticker=${encodeURIComponent(expSymbol)}&expiration=${encodeURIComponent(exp)}`);
      const data = await res.json();
      if (res.ok && data.strikes) {
        setStrikes(data.strikes);
        setLoadedExpiration(exp);
      }
    } catch (err) {
      console.error("Failed to load chain:", err);
    }
  };

  // Auto-fill premium when strike or type changes
  const autoFillPremium = (legIdx: number, strike: string, type: "call" | "put" | "share") => {
    if (type === "share" || !strike) return;
    const strikeNum = parseFloat(strike);
    const match = strikes.find(s => s.strike === strikeNum);
    if (!match) return;
    const side = type === "call" ? match.call : match.put;
    if (!side) return;
    setGradeLegs(prev => prev.map((l, i) => i === legIdx ? { ...l, premium: side.mid.toFixed(2) } : l));
  };
  const [upgradeSheetOffset, setUpgradeSheetOffset] = useState(0);
  const upgradeSheetStartY = useRef<number | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    fetch("/api/disclaimer-status").then((r) => r.json()).then((d) => {
      if (d.accepted) { setDisclaimerAccepted(true); } else { setShowDisclaimer(true); }
      setIsPremium(!!d.isPremium);
    }).catch(() => {});
  }, [isSignedIn]);

  useEffect(() => {
    if (isSignedIn) { setShowGoogleGate(false); setShowPaywall(false); setError(""); }
  }, [isSignedIn]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!showUpgradeModal) {
      setUpgradeSheetOffset(0);
      upgradeSheetStartY.current = null;
    }
  }, [showUpgradeModal]);

  const bias = useMemo(() => getBiasFromResult(result), [result]);
  const analyzeDots = useAnimatedDots(loading);
  const gradeDots = useAnimatedDots(gradeLoading);
  const expDots = useAnimatedDots(expLoading);
  const preferredStrategy = useMemo(() => getPreferredStrategy(result), [result]);
  const altTradeText = useMemo(() => getAltTradeText(result), [result]);
  const confidenceScore = useMemo(() => getConfidenceScore(result), [result]);
  const tradeTarget = useMemo(() => getTradeTarget(result), [result]);
  const tradeInvalidate = useMemo(() => getTradeInvalidate(result), [result]);

  const selectedTradeCard = useMemo<SelectedTradeCard>(() => {
    if (!meta) return null;
    if (preferredStrategy === "Call Debit Spread" && meta.liveCallDebit) return { type: "callDebit", spread: meta.liveCallDebit };
    if (preferredStrategy === "Put Debit Spread" && meta.livePutDebit) return { type: "putDebit", spread: meta.livePutDebit };
    if (preferredStrategy === "Bull Put Spread" && meta.liveBullPut) return { type: "bullPut", spread: meta.liveBullPut };
    if (preferredStrategy === "Bear Call Spread" && meta.liveBearCall) return { type: "bearCall", spread: meta.liveBearCall };
    if (preferredStrategy === "Call Diagonal" && meta.liveCallDiagonal) return { type: "callDiagonal", spread: meta.liveCallDiagonal };
    if (preferredStrategy === "Put Diagonal" && meta.livePutDiagonal) return { type: "putDiagonal", spread: meta.livePutDiagonal };
    if (preferredStrategy === "Iron Condor" && meta.liveIronCondor) return { type: "ironCondor", spread: meta.liveIronCondor };
    // No Trade or unmatched strategy — still show best available live candidate for reference
    return pickFallbackTrade(meta, bias);
  }, [meta, preferredStrategy, bias]);

  const altTrade = useMemo(() => { if (!meta) return null; return pickAltTrade(meta, bias); }, [meta, bias]);
  const marketStatus = useMemo(() => getMarketStatus(), []);

  const handleUpgradeSheetTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (!isMobile) return;
    upgradeSheetStartY.current = e.touches[0].clientY;
  };

  const handleUpgradeSheetTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (!isMobile || upgradeSheetStartY.current == null) return;
    const delta = e.touches[0].clientY - upgradeSheetStartY.current;
    setUpgradeSheetOffset(delta > 0 ? delta : 0);
  };

  const handleUpgradeSheetTouchEnd = () => {
    if (!isMobile) return;
    if (upgradeSheetOffset > 140) {
      setShowUpgradeModal(false);
    }
    setUpgradeSheetOffset(0);
    upgradeSheetStartY.current = null;
  };

  const analyzeStock = async () => {
    if (!ticker.trim()) { setError("Enter a ticker or company name."); return; }
    if (!isSignedIn) { setShowGoogleGate(true); return; }
    if (!disclaimerAccepted) { setShowDisclaimer(true); return; }
    if (showPaywall && !isPremium) {
      setPaywallAttemptedAgain(true);
      setError("Daily limit reached. Upgrade to Pro for unlimited access.");
      return;
    }

    setLoading(true); setError(""); setResult(""); setMeta(null); setCopied(false);
    setShowGoogleGate(false); setShowFullAnalysis(false); setPaywallAttemptedAgain(false);
    try {
      const res = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker }) });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403) {
          if (data.limitType === "anon_limit") { setShowGoogleGate(true); return; }
          if (data.limitType === "disclaimer_required") { setShowDisclaimer(true); return; }
          setShowPaywall(true);
          setPaywallAttemptedAgain(false);
          return;
        }
        if (res.status === 401) { setShowGoogleGate(true); return; }
        throw new Error(data.error || "Failed to analyze stock.");
      }
      setShowPaywall(false);
      setPaywallAttemptedAgain(false);
      setResult(data.result ?? ""); setMeta(normalizeMetaData(data.meta ?? null));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setLoading(false); }
  };

  const gradeMyTrade = async () => {
    if (!gradeTicker.trim()) { setGradeError("Enter a ticker or company name."); return; }
    if (!isSignedIn) { setShowGoogleGate(true); return; }
    if (!disclaimerAccepted) { setShowDisclaimer(true); return; }
    if (showPaywall && !isPremium) { setShowUpgradeModal(true); return; }
    // Validate every non-share leg has a strike selected
    const missingStrike = gradeLegs.findIndex(l => l.type !== "share" && !l.strike);
    if (missingStrike !== -1) {
      setGradeError(`Leg ${missingStrike + 1} is missing a strike price — select one from the dropdown.`);
      return;
    }
    setGradeLoading(true); setGradeError(""); setGradeResult(""); setGradeMeta(null);
    try {
      const legsPayload = gradeLegs.map(l => ({
        action: l.action,
        type: l.type,
        strike: l.strike ? parseFloat(l.strike) : null,
        expiration: l.expiration || null,
        premium: l.premium ? parseFloat(l.premium) : null,
      }));
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: gradeTicker, legs: legsPayload, notes: gradeNotes }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403) {
          if (data.limitType === "anon_limit") { setShowGoogleGate(true); return; }
          if (data.limitType === "disclaimer_required") { setShowDisclaimer(true); return; }
          setShowUpgradeModal(true); return;
        }
        if (res.status === 401) { setShowGoogleGate(true); return; }
        throw new Error(data.error || "Failed to grade trade.");
      }
      setGradeResult(data.result ?? "");
      setGradeMeta(data.meta ?? null);
    } catch (err: unknown) {
      setGradeError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setGradeLoading(false); }
  };

  // ── Grade This Trade — prefills grade form and auto-grades from a live strategy card ──
  const gradeThisTrade = async (ticker: string, legs: { action: "buy" | "sell"; type: "call" | "put" | "share"; strike: string; expiration: string; premium: string }[]) => {
    if (!isSignedIn) { setShowGoogleGate(true); return; }
    if (!disclaimerAccepted) { setShowDisclaimer(true); return; }
    if (showPaywall && !isPremium) { setShowUpgradeModal(true); return; }

    // Clear everything immediately before any async work
    setGradeResult("");
    setGradeMeta(null);
    setGradeError("");
    setGradeLoading(true);

    // Switch tab and pre-fill form
    setActiveTab("grade");
    setResult(""); setMeta(null);
    setGradeTicker(ticker);
    setGradeLegs(legs);
    setGradeNotes("");
    setExpirations([]); setStrikes([]); setLoadedExpiration(""); setExpSymbol("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const legsPayload = legs.map(l => ({
        action: l.action,
        type: l.type,
        strike: l.strike ? parseFloat(l.strike) : null,
        expiration: l.expiration || null,
        premium: l.premium ? parseFloat(l.premium) : null,
      }));
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, legs: legsPayload, notes: "" }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403) {
          if (data.limitType === "anon_limit") { setShowGoogleGate(true); return; }
          if (data.limitType === "disclaimer_required") { setShowDisclaimer(true); return; }
          setShowUpgradeModal(true); return;
        }
        if (res.status === 401) { setShowGoogleGate(true); return; }
        throw new Error(data.error || "Failed to grade trade.");
      }
      setGradeResult(data.result ?? "");
      setGradeMeta(data.meta ?? null);
      // Also load expiration dates in background so the form is usable if they want to tweak
      loadExpirations(ticker, true).catch(() => {});
    } catch (err: unknown) {
      setGradeError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setGradeLoading(false); }
  };

  const gradeFromSpread = (spread: LiveDebitSpread | LiveCreditSpread | LiveIronCondor | LiveDiagonalSpread, ticker: string, cardType: string) => {
    let legs: { action: "buy" | "sell"; type: "call" | "put" | "share"; strike: string; expiration: string; premium: string }[] = [];

    if (cardType === "callDebit" || cardType === "putDebit") {
      const s = spread as LiveDebitSpread;
      const isCall = cardType === "callDebit";
      legs = [
        { action: "buy", type: isCall ? "call" : "put", strike: s.longStrike.toString(), expiration: s.expiration, premium: s.longMid.toFixed(2) },
        { action: "sell", type: isCall ? "call" : "put", strike: s.shortStrike.toString(), expiration: s.expiration, premium: s.shortMid.toFixed(2) },
      ];
    } else if (cardType === "bullPut" || cardType === "bearCall") {
      const s = spread as LiveCreditSpread;
      const isCall = cardType === "bearCall";
      legs = [
        { action: "sell", type: isCall ? "call" : "put", strike: s.shortStrike.toString(), expiration: s.expiration, premium: s.shortMid.toFixed(2) },
        { action: "buy", type: isCall ? "call" : "put", strike: s.longStrike.toString(), expiration: s.expiration, premium: s.longMid.toFixed(2) },
      ];
    } else if (cardType === "ironCondor") {
      const s = spread as LiveIronCondor;
      legs = [
        { action: "sell", type: "put", strike: s.putShortStrike.toString(), expiration: s.expiration, premium: "" },
        { action: "buy", type: "put", strike: s.putLongStrike.toString(), expiration: s.expiration, premium: "" },
        { action: "sell", type: "call", strike: s.callShortStrike.toString(), expiration: s.expiration, premium: "" },
        { action: "buy", type: "call", strike: s.callLongStrike.toString(), expiration: s.expiration, premium: "" },
      ];
    } else if (cardType === "callDiagonal" || cardType === "putDiagonal") {
      const s = spread as LiveDiagonalSpread;
      const isCall = cardType === "callDiagonal";
      legs = [
        { action: "buy", type: isCall ? "call" : "put", strike: s.longStrike.toString(), expiration: s.farExpiration, premium: s.longMid.toFixed(2) },
        { action: "sell", type: isCall ? "call" : "put", strike: s.shortStrike.toString(), expiration: s.nearExpiration, premium: s.shortMid.toFixed(2) },
      ];
    }

    if (legs.length > 0) gradeThisTrade(ticker, legs);
  };

  const gradeFromOption = (option: LiveLongOption, ticker: string) => {
    const isCall = option.strategyType === "Long Call";
    gradeThisTrade(ticker, [
      { action: "buy", type: isCall ? "call" : "put", strike: option.strike.toString(), expiration: option.expiration, premium: option.mid.toFixed(2) },
    ]);
  };

  const handleManageSubscription = async () => {
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setError("Could not open billing portal. Please try again.");
    } catch { setError("Could not open billing portal. Please try again."); }
  };

  const handleUpgrade = async () => {
    setUpgradeLoading(true); setError("");
    try {
      const pricesRes = await fetch("/api/stripe/prices");
      const prices = await pricesRes.json();
      const priceId = upgradePlan === "yearly" ? prices.yearly : prices.monthly;
      if (!priceId) { setError(`Price ID is empty for ${upgradePlan} plan.`); setUpgradeLoading(false); return; }
      const res = await fetch("/api/stripe/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priceId }) });
      const data = await res.json();
      if (data.url) { window.location.href = data.url; } else { setError(data.error || "Checkout failed — no URL returned."); }
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to start checkout."); }
    finally { setUpgradeLoading(false); }
  };

  const handleCopy = async () => {
    if (!result) return;
    try { await navigator.clipboard.writeText(result); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }
    catch { setError("Could not copy analysis."); }
  };

  return (
    <main style={styles.main}>

      {showDisclaimer && (
        <div style={styles.disclaimerOverlay}>
          <div style={styles.disclaimerModal}>
            <h2 style={styles.disclaimerTitle}>⚠️ Disclaimer</h2>
            <div style={styles.disclaimerScroll}>
              <p style={styles.disclaimerMeta}>Last Updated: April 21, 2026</p>
              <p style={styles.disclaimerText}>Please read this disclaimer carefully before using the Swing Trade Analyzer ("the Site"). By accessing or using the Site, you agree to be bound by the terms described below.</p>
              <p style={styles.disclaimerText}>All content, tools, and information provided on this Site are for <strong>informational and educational purposes only</strong>. Nothing on this Site constitutes, or should be interpreted as, financial, investment, legal, tax, or any other form of professional advice.</p>
              <p style={styles.disclaimerSubtitle}>High-Risk Investment Warning</p>
              <p style={styles.disclaimerText}>Trading stocks, options, futures, and other financial instruments is inherently risky and carries the potential for substantial losses. Before deciding to trade, carefully consider your investment objectives, experience level, and risk tolerance. You could sustain a loss of some or all of your initial investment and should never trade with money you cannot afford to lose.</p>
              <p style={styles.disclaimerSubtitle}>AI-Generated Content Disclaimer</p>
              <p style={styles.disclaimerText}>This Site uses artificial intelligence to generate trade analysis, strategy suggestions, and market commentary. You acknowledge and agree that:</p>
              <ul style={styles.disclaimerList}>
                <li><strong>Not Financial Advice:</strong> AI-generated content is provided for informational purposes only and has not been reviewed or approved by a licensed financial professional.</li>
                <li><strong>For Informational Purposes Only:</strong> AI outputs are based on data and algorithms and should be treated as one tool among many — not as a definitive recommendation.</li>
                <li><strong>Risk of Errors:</strong> AI models are subject to errors, biases, and limitations and may produce inaccurate, incomplete, or outdated information.</li>
                <li><strong>Do Not Rely Solely on AI:</strong> Never make a financial decision based solely on AI-generated content. Always conduct your own research and/or consult a qualified financial advisor.</li>
              </ul>
              <p style={styles.disclaimerSubtitle}>No Guarantees or Warranties</p>
              <p style={styles.disclaimerText}>All information on this Site is provided "as is," without warranty of any kind, express or implied. Any reliance you place on such information is strictly at your own risk.</p>
              <p style={styles.disclaimerSubtitle}>Limitation of Liability</p>
              <p style={styles.disclaimerText}>Under no circumstances shall the Swing Trade Analyzer, its operators, or affiliates be liable for any direct, indirect, incidental, special, or consequential damages arising from your use of this Site.</p>
              <p style={styles.disclaimerSubtitle}>Affiliate Disclosure</p>
              <p style={styles.disclaimerText}>This Site may contain affiliate links to third-party brokerage platforms. If you click one of these links and open an account, we may receive a commission at no additional cost to you. Brokerage recommendations are for informational purposes only and are not personalized financial advice.</p>
              <p style={styles.disclaimerSubtitle}>Acceptance</p>
              <p style={styles.disclaimerText}>By continuing to use this Site, you confirm that you have read, understood, and agreed to this disclaimer. If you do not agree, please do not use this Site.</p>
            </div>
            <button disabled={disclaimerLoading} onClick={async () => {
              if (!disclaimerAccepted && isSignedIn) {
                setDisclaimerLoading(true);
                try { await fetch("/api/accept-disclaimer", { method: "POST" }); } catch { }
                finally { setDisclaimerLoading(false); }
                setDisclaimerAccepted(true);
              }
              setError(""); setShowDisclaimer(false);
            }} style={styles.disclaimerButton}>
              {disclaimerLoading ? "Saving..." : disclaimerAccepted ? "Close" : "I Understand, Continue"}
            </button>
          </div>
        </div>
      )}

      {showPrivacyPolicy && (
        <div style={styles.disclaimerOverlay}>
          <div style={styles.disclaimerModal}>
            <h2 style={styles.disclaimerTitle}>🔒 Privacy Policy</h2>
            <div style={styles.disclaimerScroll}>
              <p style={styles.disclaimerMeta}>Last Updated: April 21, 2026</p>
              <p style={styles.disclaimerText}>This Privacy Policy explains how Swing Trade Analyzer collects, uses, and protects your information when you use our website.</p>
              <p style={styles.disclaimerSubtitle}>Information We Collect</p>
              <p style={styles.disclaimerText}>When you sign in with Google, we receive your email address and basic profile information. We use your email address solely to identify your account, track usage limits, and manage your subscription status. We do not collect passwords or payment card details — payment processing is handled entirely by Stripe.</p>
              <p style={styles.disclaimerSubtitle}>How We Use Your Information</p>
              <p style={styles.disclaimerText}>We use your information to provide and improve the service, enforce daily usage limits, manage Pro subscriptions, and record your acceptance of our disclaimer. We do not sell, rent, or share your personal information with third parties for marketing purposes.</p>
              <p style={styles.disclaimerSubtitle}>Third-Party Services</p>
              <ul style={styles.disclaimerList}>
                <li><strong>Google OAuth</strong> — for sign-in authentication</li>
                <li><strong>Stripe</strong> — for payment processing</li>
                <li><strong>Supabase</strong> — for secure database storage</li>
                <li><strong>Anthropic (Claude AI)</strong> — for generating trade analysis</li>
                <li><strong>Finnhub & Tradier</strong> — for real-time market data</li>
              </ul>
              <p style={styles.disclaimerSubtitle}>Cookies</p>
              <p style={styles.disclaimerText}>We use cookies solely for authentication purposes. We do not use tracking or advertising cookies.</p>
              <p style={styles.disclaimerSubtitle}>Children's Privacy</p>
              <p style={styles.disclaimerText}>This service is not directed at individuals under the age of 18.</p>
              <p style={styles.disclaimerSubtitle}>Contact</p>
              <p style={styles.disclaimerText}>For any privacy-related questions, please contact us through the site.</p>
            </div>
            <button onClick={() => setShowPrivacyPolicy(false)} style={styles.disclaimerButton}>Close</button>
          </div>
        </div>
      )}

      <div style={styles.container}>

        <div style={styles.heroRow}>
          <div style={styles.heroText}>
            {/* ── Tab switcher ── */}
            <div style={styles.tabRow}>
              <button
                onClick={() => {
                  setActiveTab("analyze");
                  setError("");
                  setGradeError("");
                  setGradeResult("");
                  setGradeMeta(null);
                }}
                style={{ ...styles.tabBtn, ...(activeTab === "analyze" ? styles.tabBtnActive : {}) }}
              >
                📈 Swing Trade Analyzer
              </button>
              <button
                onClick={() => {
                  setActiveTab("grade");
                  setError("");
                  setGradeError("");
                  setResult("");
                  setMeta(null);
                }}
                style={{ ...styles.tabBtn, ...(activeTab === "grade" ? styles.tabBtnActiveGrade : {}) }}
              >
                🎯 Grade My Trade <span style={{ fontSize: "0.6rem", fontWeight: 800, background: "#f59e0b", color: "#111827", padding: "2px 5px", borderRadius: "6px", marginLeft: "6px", verticalAlign: "middle" }}>NEW</span>
              </button>
            </div>
            <p style={styles.subtitle}>
              {activeTab === "analyze"
                ? "Enter a ticker or company name. Get trade breakdowns with real-time options data, earnings context, and AI-selected strategy."
                : "Enter your trade idea. Get an honest AI grade based on current technicals, news, and market conditions."}
            </p>
            <div style={{ ...styles.marketStatus, color: marketStatus.color }}>{marketStatus.label}</div>
          </div>
          <div style={styles.statusCard}>
            <div>
              <strong>Status:</strong>{" "}
              {status === "loading" ? "Checking sign-in..." : isSignedIn ? `Signed in as ${session?.user?.email ?? "user"}` : "Not signed in"}
              {isSignedIn && isPremium && <span style={styles.proBadge}>⚡ Pro</span>}
            </div>
            {isSignedIn ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {!isPremium && <button onClick={() => setShowUpgradeModal(true)} style={styles.upgradeButton}>⚡ Upgrade to Pro</button>}
                {isPremium && <button onClick={handleManageSubscription} style={styles.manageSubButton}>Manage Subscription</button>}
                <button onClick={() => { setShowGoogleGate(false); setShowPaywall(false); setError(""); signOut(); }} style={styles.signOutButton}>Sign out</button>
              </div>
            ) : status !== "loading" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <button onClick={() => signIn("google", { callbackUrl: window.location.href })} style={styles.googleButton}>
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style={styles.googleIcon} />
                  Unlock your free analysis → Continue with Google
                </button>
                <div style={{ fontSize: "0.8rem", color: "#94a3b8", lineHeight: 1.35 }}>
                  3 free analyses/day • No spam. Never had it, never will.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Analyzer tab ── */}
        {activeTab === "analyze" && (
          <form onSubmit={(e) => { e.preventDefault(); analyzeStock(); }} style={styles.searchRow}>
            <input type="text" placeholder="Ticker or company (e.g. AAPL or Netflix)" value={ticker} onChange={(e) => setTicker(e.target.value)} style={styles.input} autoFocus disabled={loading || status === "loading"} />
            <button type="submit" disabled={loading || !ticker.trim() || status === "loading"} style={styles.button}>
              {loading ? `Scanning Options Chain${analyzeDots}` : "Analyze"}
            </button>
          </form>
        )}

        {/* ── Grade My Trade tab ── */}
        {activeTab === "grade" && (
          <div style={styles.gradeForm}>
            {/* Ticker row with Load Expirations */}
            <div style={{ display: "flex", gap: "10px", marginBottom: "12px", flexWrap: "wrap" as const }}>
              <input
                type="text"
                placeholder="Ticker or company (e.g. AAPL or Tesla)"
                value={gradeTicker}
                onChange={(e) => { setGradeTicker(e.target.value); setExpSymbol(""); setExpirations([]); }}
                onBlur={() => loadExpirations(gradeTicker, false)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); loadExpirations(gradeTicker, true); } }}
                style={{ ...styles.input, flex: 1 }}
                disabled={gradeLoading || status === "loading"}
              />
              <button
                onClick={() => loadExpirations(gradeTicker, true)}
                disabled={!gradeTicker.trim() || expLoading || !isSignedIn}
                style={{ ...styles.button, background: expirations.length ? "#22c55e" : "#6366f1", color: expirations.length ? "#04130a" : "#fff", minWidth: "unset", padding: "12px 20px", fontSize: "0.9rem", fontWeight: 800 }}
              >
                {expLoading ? `Loading${expDots}` : expirations.length ? `✓ ${expirations.length} Dates` : "Load Dates →"}
              </button>
            </div>
            {expirations.length === 0 && gradeTicker.trim() && !expLoading && (
              <div style={{ fontSize: "0.8rem", color: "#64748b", marginBottom: "10px" }}>
                Enter a ticker and press Enter or click <strong style={{ color: "#6366f1" }}>Load Dates →</strong> to fetch real expiration dates.
              </div>
            )}
            <div style={styles.gradeLegsWrap}>
              {gradeLegs.map((leg, idx) => (
                <div key={idx} style={styles.gradeLegCard}>
                  <div style={styles.gradeLegHeader}>
                    <span style={styles.gradeLegLabel}>Leg {idx + 1}</span>
                    {idx > 0 && (
                      <button onClick={() => setGradeLegs(prev => prev.filter((_, i) => i !== idx))} style={styles.gradeLegRemove}>✕ Remove</button>
                    )}
                  </div>
                  <div style={styles.gradeLegRow}>
                    <div style={styles.gradeLegField}>
                      <label style={styles.gradeLegFieldLabel}>Action</label>
                      <select value={leg.action} onChange={e => setGradeLegs(prev => prev.map((l, i) => i === idx ? { ...l, action: e.target.value as "buy" | "sell" } : l))} style={styles.gradeSelect}>
                        <option value="buy">Buy</option>
                        <option value="sell">Sell</option>
                      </select>
                    </div>
                    <div style={styles.gradeLegField}>
                      <label style={styles.gradeLegFieldLabel}>Type</label>
                      <select
                        value={leg.type}
                        onChange={e => {
                          const newType = e.target.value as "call" | "put" | "share";
                          setGradeLegs(prev => prev.map((l, i) => i === idx ? { ...l, type: newType, premium: "" } : l));
                          autoFillPremium(idx, leg.strike, newType);
                        }}
                        style={styles.gradeSelect}
                      >
                        <option value="call">Call</option>
                        <option value="put">Put</option>
                        <option value="share">Share</option>
                      </select>
                    </div>
                    {leg.type !== "share" && (
                      <>
                        <div style={styles.gradeLegField}>
                          <label style={styles.gradeLegFieldLabel}>Expiration</label>
                          {expirations.length > 0 ? (
                            <select
                              value={leg.expiration}
                              onChange={e => {
                                const newExp = e.target.value;
                                setGradeLegs(prev => prev.map((l, i) => i === idx ? { ...l, expiration: newExp, premium: "" } : l));
                                loadChainForExpiration(newExp);
                              }}
                              style={styles.gradeSelect}
                            >
                              <option value="">Select date...</option>
                              {expirations.map(d => (
                                <option key={d} value={d}>{d}</option>
                              ))}
                            </select>
                          ) : (
                            <input type="text" placeholder="Load dates first ↑" value={leg.expiration}
                              onChange={e => setGradeLegs(prev => prev.map((l, i) => i === idx ? { ...l, expiration: e.target.value } : l))}
                              style={{ ...styles.gradeInput, color: "#64748b" }}
                            />
                          )}
                        </div>
                        <div style={styles.gradeLegField}>
                          <label style={styles.gradeLegFieldLabel}>Strike</label>
                          {strikes.length > 0 ? (
                            <select
                              value={leg.strike}
                              onChange={e => {
                                const newStrike = e.target.value;
                                setGradeLegs(prev => prev.map((l, i) => i === idx ? { ...l, strike: newStrike } : l));
                                autoFillPremium(idx, newStrike, leg.type as "call" | "put");
                                if (newStrike) setGradeError(""); // clear error once strike is picked
                              }}
                              style={{ ...styles.gradeSelect, borderColor: !leg.strike && gradeError.includes(`Leg ${idx + 1}`) ? "#ef4444" : "#334155" }}
                            >
                              <option value="">Select strike...</option>
                              {strikes.map(s => {
                                const side = leg.type === "call" ? s.call : s.put;
                                const midLabel = side ? ` · mid $${side.mid.toFixed(2)}` : "";
                                return (
                                  <option key={s.strike} value={s.strike.toString()}>
                                    ${s.strike}{midLabel}
                                  </option>
                                );
                              })}
                            </select>
                          ) : (
                            <input type="number" placeholder="e.g. 150" value={leg.strike}
                              onChange={e => {
                                setGradeLegs(prev => prev.map((l, i) => i === idx ? { ...l, strike: e.target.value } : l));
                                if (e.target.value) setGradeError("");
                              }}
                              style={{ ...styles.gradeInput, borderColor: !leg.strike && gradeError.includes(`Leg ${idx + 1}`) ? "#ef4444" : "#334155" }}
                            />
                          )}
                        </div>
                        <div style={styles.gradeLegField}>
                          <label style={styles.gradeLegFieldLabel}>
                            Premium
                            {leg.premium && strikes.length > 0 && <span style={{ color: "#22c55e", marginLeft: "6px", fontSize: "0.65rem" }}>● live mid</span>}
                          </label>
                          <input
                            type="number" step="0.01"
                            placeholder={strikes.length > 0 ? "Auto-filled from live chain" : "e.g. 2.50"}
                            value={leg.premium}
                            onChange={e => setGradeLegs(prev => prev.map((l, i) => i === idx ? { ...l, premium: e.target.value } : l))}
                            style={{ ...styles.gradeInput, borderColor: leg.premium && strikes.length > 0 ? "#166534" : "#334155" }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {gradeLegs.length < 4 && (
                <button onClick={() => setGradeLegs(prev => [...prev, { action: "buy", type: "call", strike: "", expiration: expirations[0] ?? "", premium: "" }])} style={styles.gradeAddLegBtn}>
                  + Add a Leg
                </button>
              )}
            </div>
            <div style={styles.gradeLegField}>
              <label style={styles.gradeLegFieldLabel}>Notes (optional)</label>
              <input
                type="text"
                placeholder="e.g. Playing the bounce off EMA50, holding through earnings"
                value={gradeNotes}
                onChange={e => setGradeNotes(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); gradeMyTrade(); } }}
                style={{ ...styles.gradeInput, width: "100%" }}
              />
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
              <button
                onClick={gradeMyTrade}
                disabled={gradeLoading || !gradeTicker.trim() || status === "loading"}
                style={{ ...styles.button, flex: 1 }}
              >
                {gradeLoading ? `Grading your trade${gradeDots}` : "Grade My Trade"}
              </button>
              {(gradeResult || gradeLegs.some(l => l.strike || l.expiration || l.premium) || gradeTicker) && (
                <button
                  onClick={() => {
                    setGradeTicker("");
                    setGradeLegs([{ action: "buy", type: "call", strike: "", expiration: "", premium: "" }]);
                    setGradeNotes("");
                    setGradeResult("");
                    setGradeMeta(null);
                    setGradeError("");
                    setExpirations([]);
                    setStrikes([]);
                    setLoadedExpiration("");
                    setExpSymbol("");
                  }}
                  style={{ padding: "12px 20px", borderRadius: "10px", border: "1px solid #ef4444", background: "#1c0a0a", color: "#ef4444", cursor: "pointer", fontSize: "0.95rem", fontWeight: 700, whiteSpace: "nowrap" as const }}
                >
                  ✕ Clear
                </button>
              )}
            </div>
          </div>
        )}

        {showGoogleGate && (
          <div style={styles.gateCard}>
            <h2 style={styles.cardTitle}>Sign in to use the analyzer</h2>
            <p style={styles.gateText}>Unlock your free trade breakdowns with one click.</p>
            <button onClick={() => signIn("google", { callbackUrl: window.location.href })} style={styles.googleButton}>
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style={styles.googleIcon} />
              Unlock your free analysis → Continue with Google
            </button>
            <div style={{ fontSize: "0.8rem", color: "#94a3b8", lineHeight: 1.35 }}>
              3 free analyses/day • No spam. Never had it, never will.
            </div>
          </div>
        )}

        {showPaywall && (
          <div style={styles.paywallCard}>
            <h2 style={styles.cardTitle}>You've used your 3 free analyses today</h2>
            <p style={styles.gateText}>Unlock unlimited trade ideas 👇</p>
            <div style={styles.paywallActions}><button onClick={() => setShowUpgradeModal(true)} style={styles.upgradeButton}>Upgrade to Pro →</button></div>
          </div>
        )}

        {showUpgradeModal && (
          <div style={styles.upgradeOverlay} onClick={() => setShowUpgradeModal(false)}>
            <div
              style={
                isMobile
                  ? { ...styles.upgradeBottomSheet, transform: `translateY(${upgradeSheetOffset}px)` }
                  : styles.upgradeModalWide
              }
              onClick={(e) => e.stopPropagation()}
              onTouchStart={handleUpgradeSheetTouchStart}
              onTouchMove={handleUpgradeSheetTouchMove}
              onTouchEnd={handleUpgradeSheetTouchEnd}
            >
              {isMobile && (
                <div style={styles.sheetHandleWrap}>
                  <div style={styles.sheetHandle} />
                </div>
              )}
              <button onClick={() => setShowUpgradeModal(false)} style={styles.upgradeCloseBtn}>✕</button>
              <div style={styles.upgradeModalHeader}>
                <div style={styles.upgradeBadge}>🚀 Early Access Pricing</div>
                <h2 style={styles.upgradeTitle}>Choose Your Plan</h2>
                <p style={styles.upgradeSubtitle}>Unlock unlimited analyses and more powerful tools.</p>
              </div>
              <div style={isMobile ? styles.pricingGridMobile : styles.pricingGrid}>
                <div style={styles.proCard}>
                  <div style={styles.proCardBadge}>⚡ Pro</div>
                  <div style={styles.planToggle}>
                    <button onClick={() => setUpgradePlan("monthly")} style={{ ...styles.planToggleBtn, ...(upgradePlan === "monthly" ? styles.planToggleBtnActive : {}) }}>Monthly</button>
                    <button onClick={() => setUpgradePlan("yearly")} style={{ ...styles.planToggleBtn, ...(upgradePlan === "yearly" ? styles.planToggleBtnActive : {}) }}>Yearly <span style={styles.bestValueBadge}>Save $12</span></button>
                  </div>
                  <div style={styles.proCardPrice}>
                    {upgradePlan === "monthly" ? (<><span style={styles.priceAmount}>$9.99</span><span style={styles.pricePer}>/mo</span></>) : (<><span style={styles.priceStrike}>$120</span><span style={styles.priceAmount}>$107.99</span><span style={styles.pricePer}>/yr</span></>)}
                  </div>
                  {upgradePlan === "yearly" && <div style={styles.priceSavings}>Save $12 vs monthly</div>}
                  <div style={styles.cardDivider} />
                  <div style={styles.proFeatureList}>
                    <div style={styles.proFeature}>✅ Unlimited analyses/day</div>
                    <div style={styles.proFeature}>✅ Real-time options chain</div>
                    <div style={styles.proFeature}>✅ AI strategy selection</div>
                    <div style={styles.proFeature}>✅ Early access pricing — locked forever</div>
                  </div>
                  <button onClick={handleUpgrade} disabled={upgradeLoading} style={styles.upgradeCheckoutBtn}>
                    {upgradeLoading ? "Redirecting..." : `Get Pro — ${upgradePlan === "monthly" ? "$9.99/mo" : "$107.99/yr"}`}
                  </button>
                  <p style={styles.upgradeDisclaimer}>Secure checkout via Stripe. Cancel anytime.</p>
                </div>
                <div style={styles.premiumCard}>
                  <div style={styles.premiumCardBadge}>🔮 Coming Soon</div>
                  <div style={styles.premiumCardPrice}><span style={styles.premiumPriceAmount}>$19.99</span><span style={styles.premiumPricePer}>/mo</span></div>
                  <div style={{ height: "20px" }} />
                  <div style={styles.cardDivider} />
                  <div style={styles.premiumFeatureList}>
                    <div style={styles.premiumFeature}>📈 Historical Performance</div>
                    <div style={styles.premiumFeature}>🎯 Trade of the Day</div>
                    <div style={styles.premiumFeature}>📊 Earnings Pro</div>
                    <div style={styles.premiumFeature}>📝 Paper Trader Pro</div>
                    <div style={styles.premiumFeature}>⚡ All Pro features included</div>
                  </div>
                  <div style={styles.getPremiumBtn}>Get Premium <span style={{ fontSize: "0.7rem", marginLeft: "6px", opacity: 0.6 }}>— Coming Soon</span></div>
                  <p style={{ ...styles.upgradeDisclaimer, opacity: 0.4 }}>Notify me when available</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (!showPaywall || paywallAttemptedAgain) && activeTab === "analyze" && <div style={styles.error}>{error}</div>}
        {gradeError && activeTab === "grade" && <div style={styles.error}>{gradeError}</div>}

        {meta && (
          <div style={styles.metaCard}>
            <div><strong>Symbol:</strong> {meta.symbol}</div>
            {meta.resolvedFromName && meta.originalInput && <div><strong>Resolved from:</strong> {meta.originalInput}</div>}
            {meta.resolvedFromName && meta.resolvedDisplayName && <div><strong>Company:</strong> {meta.resolvedDisplayName}</div>}
            <div><strong>Price:</strong> ${meta.currentPrice}</div>
            <div><strong>Next Earnings:</strong> {meta.nextEarnings}</div>
            {meta.selectedExpiration && <div><strong>Selected Expiration:</strong> {meta.selectedExpiration}</div>}
            {bias && <div><strong>AI Bias:</strong> <span style={{ color: bias === "Bullish" ? "#22c55e" : bias === "Bearish" ? "#ef4444" : "#f59e0b" }}>{bias}</span></div>}
            {preferredStrategy && <div><strong>Strategy:</strong> {preferredStrategy}</div>}
          </div>
        )}

        {result && <TradeSummaryCard bias={bias} confidence={confidenceScore} strategy={preferredStrategy} target={tradeTarget} invalidate={tradeInvalidate} onViewAnalysis={() => setShowFullAnalysis(v => !v)} />}

        {meta?.tradeFilters && <TradeFiltersCard filters={meta.tradeFilters} />}

        {meta?.techData && <TechCard tech={meta.techData} />}

        {meta && (bias === "Bullish" || bias === "Bearish") && <BeginnerCard bias={bias} symbol={meta.symbol ?? ""} currentPrice={meta.currentPrice ?? ""} />}

        {preferredStrategy === "No Trade" && selectedTradeCard && (
          <div style={{ background: "#1c1008", border: "1px solid #92400e", borderRadius: "10px", padding: "10px 14px", marginBottom: "8px", fontSize: "0.83rem", color: "#fbbf24", display: "flex", alignItems: "center", gap: "8px" }}>
            <span>⚠️</span>
            <span><strong>No Trade recommended</strong> — setup doesn't meet quality criteria. The card below shows the best available live structure for reference only. Read the full analysis before acting.</span>
          </div>
        )}
        {selectedTradeCard?.type === "callDebit" && <DebitCard spread={selectedTradeCard.spread} currentPrice={meta?.currentPrice ?? "0"} onTutorial={() => setShowTutorial(true)} onGrade={() => gradeFromSpread(selectedTradeCard.spread, meta?.symbol ?? "", "callDebit")} />}
        {selectedTradeCard?.type === "putDebit" && <DebitCard spread={selectedTradeCard.spread} currentPrice={meta?.currentPrice ?? "0"} onTutorial={() => setShowTutorial(true)} onGrade={() => gradeFromSpread(selectedTradeCard.spread, meta?.symbol ?? "", "putDebit")} />}
        {selectedTradeCard?.type === "bullPut" && <CreditCard spread={selectedTradeCard.spread} currentPrice={meta?.currentPrice ?? "0"} onTutorial={() => setShowTutorial(true)} onGrade={() => gradeFromSpread(selectedTradeCard.spread, meta?.symbol ?? "", "bullPut")} />}
        {selectedTradeCard?.type === "bearCall" && <CreditCard spread={selectedTradeCard.spread} currentPrice={meta?.currentPrice ?? "0"} onTutorial={() => setShowTutorial(true)} onGrade={() => gradeFromSpread(selectedTradeCard.spread, meta?.symbol ?? "", "bearCall")} />}
        {selectedTradeCard?.type === "callDiagonal" && <DiagonalCard spread={selectedTradeCard.spread} currentPrice={meta?.currentPrice ?? "0"} onTutorial={() => setShowTutorial(true)} onGrade={() => gradeFromSpread(selectedTradeCard.spread, meta?.symbol ?? "", "callDiagonal")} />}
        {selectedTradeCard?.type === "putDiagonal" && <DiagonalCard spread={selectedTradeCard.spread} currentPrice={meta?.currentPrice ?? "0"} onTutorial={() => setShowTutorial(true)} onGrade={() => gradeFromSpread(selectedTradeCard.spread, meta?.symbol ?? "", "putDiagonal")} />}
        {selectedTradeCard?.type === "ironCondor" && <IronCondorCard spread={selectedTradeCard.spread} currentPrice={meta?.currentPrice ?? "0"} onTutorial={() => setShowTutorial(true)} onGrade={() => gradeFromSpread(selectedTradeCard.spread, meta?.symbol ?? "", "ironCondor")} />}
        {altTrade && <AltTradeCard option={altTrade} parsedLine={altTradeText} currentPrice={meta?.currentPrice ?? "0"} onGrade={() => gradeFromOption(altTrade, meta?.symbol ?? "")} />}

        {meta?.recentHeadlines && meta.recentHeadlines.length > 0 && (
          <div style={styles.headlinesCard}>
            <h2 style={styles.cardTitle}>Recent Headlines</h2>
            <div style={styles.headlinesList}>
              {meta.recentHeadlines.map((item, index) => (
                <a key={`${item.url}-${index}`} href={item.url} target="_blank" rel="noopener noreferrer" style={styles.headlineLink}>
                  <div style={styles.headlineTitle}>{item.headline}</div>
                  <div style={styles.headlineSource}>{item.source}</div>
                </a>
              ))}
            </div>
          </div>
        )}

        {result && (
          <div style={styles.resultCard}>
            <div style={styles.resultHeader}>
              <h2 style={styles.cardTitle}>Swing Trade Analysis</h2>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button onClick={() => setShowFullAnalysis(v => !v)} style={styles.copyButton}>{showFullAnalysis ? "Hide Analysis ▲" : "View Full Analysis ▼"}</button>
                <button onClick={handleCopy} style={styles.copyButton}>{copied ? "Copied" : "Copy"}</button>
              </div>
            </div>
            {showFullAnalysis && <pre style={styles.result}>{result}</pre>}
          </div>
        )}

        {showTutorial && (
          <div style={styles.upgradeOverlay} onClick={() => setShowTutorial(false)}>
            <div style={styles.tutorialModal} onClick={(e) => e.stopPropagation()}>
              <div style={styles.resultHeader}>
                <h2 style={styles.cardTitle}>📖 Options Spread Strategies</h2>
                <button onClick={() => setShowTutorial(false)} style={styles.copyButton}>Close</button>
              </div>
              <div style={styles.tutorialContent}>
                <div style={styles.tutorialSection}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <div style={styles.tutorialStratTitle}>📈 Call Debit Spread <span style={styles.tutorialBias}>Bullish</span></div>
                    <a href="https://www.investopedia.com/terms/b/bullcallspread.asp" target="_blank" rel="noopener noreferrer" style={styles.learnMoreLink}>Learn more ↗</a>
                  </div>
                  <p style={styles.tutorialText}>Buy a call, sell a higher-strike call. Pay a net debit upfront. Profit if the stock rises above your breakeven by expiration.</p>
                  <div style={styles.exampleBox}>
                    <div style={styles.exampleLabel}>Example — Stock at $50</div>
                    <div style={styles.exampleRow}><span style={styles.exampleBuy}>BUY</span> $50 Call @ $2.50</div>
                    <div style={styles.exampleRow}><span style={styles.exampleSell}>SELL</span> $55 Call @ $1.00</div>
                    <div style={styles.exampleStats}>Net Debit: $1.50 · Max Profit: $3.50 · Breakeven: $51.50</div>
                  </div>
                </div>
                <div style={styles.tutorialSection}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <div style={styles.tutorialStratTitle}>📉 Put Debit Spread <span style={{ ...styles.tutorialBias, background: "#3f1010", color: "#f87171" }}>Bearish</span></div>
                    <a href="https://www.investopedia.com/terms/b/bearputspread.asp" target="_blank" rel="noopener noreferrer" style={styles.learnMoreLink}>Learn more ↗</a>
                  </div>
                  <p style={styles.tutorialText}>Buy a put, sell a lower-strike put. Profit if the stock falls below your breakeven. Max loss is the debit paid.</p>
                  <div style={styles.exampleBox}>
                    <div style={styles.exampleLabel}>Example — Stock at $50</div>
                    <div style={styles.exampleRow}><span style={styles.exampleBuy}>BUY</span> $50 Put @ $2.50</div>
                    <div style={styles.exampleRow}><span style={styles.exampleSell}>SELL</span> $45 Put @ $1.00</div>
                    <div style={styles.exampleStats}>Net Debit: $1.50 · Max Profit: $3.50 · Breakeven: $48.50</div>
                  </div>
                </div>
                <div style={styles.tutorialSection}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <div style={styles.tutorialStratTitle}>💰 Bull Put Spread <span style={styles.tutorialBias}>Bullish/Neutral</span></div>
                    <a href="https://www.investopedia.com/terms/b/bullputspread.asp" target="_blank" rel="noopener noreferrer" style={styles.learnMoreLink}>Learn more ↗</a>
                  </div>
                  <p style={styles.tutorialText}>Sell a put, buy a lower-strike put. Collect a net credit upfront. Profit if the stock stays above your short strike.</p>
                  <div style={styles.exampleBox}>
                    <div style={styles.exampleLabel}>Example — Stock at $50</div>
                    <div style={styles.exampleRow}><span style={styles.exampleSell}>SELL</span> $47 Put @ $1.50</div>
                    <div style={styles.exampleRow}><span style={styles.exampleBuy}>BUY</span> $44 Put @ $0.50</div>
                    <div style={styles.exampleStats}>Net Credit: $1.00 · Max Profit: $100 · Max Loss: $200</div>
                  </div>
                </div>
                <div style={styles.tutorialSection}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <div style={styles.tutorialStratTitle}>🐻 Bear Call Spread <span style={{ ...styles.tutorialBias, background: "#3f1010", color: "#f87171" }}>Bearish/Neutral</span></div>
                    <a href="https://www.investopedia.com/terms/b/bearcallspread.asp" target="_blank" rel="noopener noreferrer" style={styles.learnMoreLink}>Learn more ↗</a>
                  </div>
                  <p style={styles.tutorialText}>Sell a call, buy a higher-strike call. Collect credit. Profit if the stock stays below your short strike.</p>
                  <div style={styles.exampleBox}>
                    <div style={styles.exampleLabel}>Example — Stock at $50</div>
                    <div style={styles.exampleRow}><span style={styles.exampleSell}>SELL</span> $53 Call @ $1.50</div>
                    <div style={styles.exampleRow}><span style={styles.exampleBuy}>BUY</span> $56 Call @ $0.50</div>
                    <div style={styles.exampleStats}>Net Credit: $1.00 · Max Profit: $100 · Max Loss: $200</div>
                  </div>
                </div>
                <div style={styles.tutorialSection}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <div style={styles.tutorialStratTitle}>🦅 Iron Condor <span style={{ ...styles.tutorialBias, background: "#1a2a1a", color: "#86efac" }}>Neutral</span></div>
                    <a href="https://www.investopedia.com/terms/i/ironcondor.asp" target="_blank" rel="noopener noreferrer" style={styles.learnMoreLink}>Learn more ↗</a>
                  </div>
                  <p style={styles.tutorialText}>Bull Put Spread + Bear Call Spread combined. Profit when the stock stays in a range. Ideal in low-volatility, sideways markets.</p>
                  <div style={styles.exampleBox}>
                    <div style={styles.exampleLabel}>Example — Stock at $50</div>
                    <div style={{ ...styles.exampleRow, color: "#94a3b8", fontSize: "0.75rem", marginBottom: "4px" }}>Put side:</div>
                    <div style={styles.exampleRow}><span style={styles.exampleSell}>SELL</span> $47 Put · <span style={styles.exampleBuy}>BUY</span> $44 Put</div>
                    <div style={{ ...styles.exampleRow, color: "#94a3b8", fontSize: "0.75rem", margin: "4px 0" }}>Call side:</div>
                    <div style={styles.exampleRow}><span style={styles.exampleSell}>SELL</span> $53 Call · <span style={styles.exampleBuy}>BUY</span> $56 Call</div>
                    <div style={styles.exampleStats}>Total Credit: $2.00 · Profit zone: $47–$53</div>
                  </div>
                </div>
                <div style={styles.tutorialSection}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <div style={styles.tutorialStratTitle}>📅 Diagonal Spreads <span style={styles.tutorialBias}>Directional</span></div>
                    <a href="https://www.investopedia.com/terms/d/diagonalspread.asp" target="_blank" rel="noopener noreferrer" style={styles.learnMoreLink}>Learn more ↗</a>
                  </div>
                  <p style={styles.tutorialText}>Buy a longer-dated option, sell a shorter-dated one at a different strike. Profits from time decay on the short leg. Payoff is path-dependent.</p>
                  <div style={styles.exampleBox}>
                    <div style={styles.exampleLabel}>Example — Stock at $50 (Call Diagonal)</div>
                    <div style={styles.exampleRow}><span style={styles.exampleBuy}>BUY</span> $50 Call, 60 days out @ $4.00</div>
                    <div style={styles.exampleRow}><span style={styles.exampleSell}>SELL</span> $52 Call, 30 days out @ $1.50</div>
                    <div style={styles.exampleStats}>Net Debit: $2.50 · Short leg decays faster · Repeat monthly</div>
                  </div>
                </div>
                <div style={{ ...styles.tutorialSection, borderBottom: "none", marginBottom: 0, paddingBottom: 0 }}>
                  <div style={styles.tutorialStratTitle}>📌 Key Terms</div>
                  <p style={styles.tutorialText}><strong>PoP</strong> — Probability of Profit. Higher is safer but lower reward.</p>
                  <p style={styles.tutorialText}><strong>R:R</strong> — Risk/Reward ratio. 2:1 means you make $2 for every $1 risked.</p>
                  <p style={styles.tutorialText}><strong>Breakeven</strong> — The stock price at expiration where you neither profit nor lose.</p>
                  <p style={{ ...styles.tutorialText, marginBottom: 0 }}><strong>Stop Loss</strong> — Exit the trade if the underlying stock hits this price to limit losses.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Grade My Trade results ── */}
        {activeTab === "grade" && gradeMeta && (
          <div style={styles.metaCard}>
            <div><strong>Symbol:</strong> {gradeMeta.symbol}</div>
            {gradeMeta.resolvedDisplayName && <div><strong>Company:</strong> {gradeMeta.resolvedDisplayName}</div>}
            <div><strong>Price:</strong> ${gradeMeta.currentPrice}</div>
            <div><strong>Next Earnings:</strong> {gradeMeta.nextEarnings}</div>
            {gradeMeta.tradeType && <div><strong>Trade Type:</strong> {gradeMeta.tradeType}</div>}
          </div>
        )}

        {activeTab === "grade" && gradeResult && (() => {
          const gradeMatch = gradeResult.match(/Grade:\s*([A-F][+-]?)/i);
          const grade = gradeMatch?.[1]?.toUpperCase() ?? null;
          const gradeColor = grade?.startsWith("A") ? "#22c55e" : grade?.startsWith("B") ? "#86efac" : grade?.startsWith("C") ? "#f59e0b" : grade?.startsWith("D") ? "#f97316" : "#ef4444";
          return (
            <div style={{ ...styles.resultCard, marginBottom: "16px" }}>
              <div style={styles.resultHeader}>
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  {grade && (
                    <div style={{ fontSize: "3rem", fontWeight: 900, color: gradeColor, lineHeight: 1, minWidth: "52px", textAlign: "center" as const }}>{grade}</div>
                  )}
                  <h2 style={styles.cardTitle}>Trade Grade</h2>
                </div>
              </div>
              <pre style={styles.result}>{gradeResult}</pre>
            </div>
          );
        })()}

        {activeTab === "grade" && gradeMeta?.recentHeadlines && gradeMeta.recentHeadlines.length > 0 && (
          <div style={styles.headlinesCard}>
            <h2 style={styles.cardTitle}>Recent Headlines</h2>
            <div style={styles.headlinesList}>
              {gradeMeta.recentHeadlines.map((item, index) => (
                <a key={`${item.url}-${index}`} href={item.url} target="_blank" rel="noopener noreferrer" style={styles.headlineLink}>
                  <div style={styles.headlineTitle}>{item.headline}</div>
                  <div style={styles.headlineSource}>{item.source}</div>
                </a>
              ))}
            </div>
          </div>
        )}

        <div style={styles.footer}>
          <button onClick={() => setShowDisclaimer(true)} style={styles.disclaimerLink}>View Disclaimer</button>
          <span style={styles.footerDivider}>·</span>
          <button onClick={() => setShowPrivacyPolicy(true)} style={styles.disclaimerLink}>Privacy Policy</button>
        </div>

      </div>
    </main>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles: { [key: string]: CSSProperties } = {
  main: { minHeight: "100vh", padding: "40px 16px", color: "#e5e7eb", background: "#0f172a" },
  // ─── Tab styles ─────────────────────────────────────────────────────────────
  tabRow: { display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" as const },
  tabBtn: { padding: "10px 18px", borderRadius: "10px", border: "1px solid #334155", background: "#1e293b", color: "#94a3b8", cursor: "pointer", fontSize: "1rem", fontWeight: 700, transition: "all 0.15s" },
  tabBtnActive: { background: "#22c55e", color: "#04130a", border: "1px solid #22c55e" },
  tabBtnActiveGrade: { background: "#6366f1", color: "#ffffff", border: "1px solid #6366f1" },
  // ─── Grade My Trade form styles ──────────────────────────────────────────────
  gradeForm: { marginBottom: "20px" },
  gradeLegsWrap: { display: "flex", flexDirection: "column" as const, gap: "10px", marginBottom: "12px" },
  gradeLegCard: { background: "#1e293b", border: "1px solid #334155", borderRadius: "12px", padding: "14px" },
  gradeLegHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" },
  gradeLegLabel: { fontSize: "0.75rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.08em" },
  gradeLegRemove: { background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, padding: "2px 6px" },
  gradeLegRow: { display: "flex", gap: "10px", flexWrap: "wrap" as const },
  gradeLegField: { display: "flex", flexDirection: "column" as const, gap: "4px", minWidth: "100px", flex: 1 },
  gradeLegFieldLabel: { fontSize: "0.7rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase" as const },
  gradeSelect: { padding: "8px 10px", borderRadius: "8px", border: "1px solid #334155", background: "#0f172a", color: "#e5e7eb", fontSize: "0.92rem", cursor: "pointer", outline: "none" },
  gradeInput: { padding: "8px 10px", borderRadius: "8px", border: "1px solid #334155", background: "#0f172a", color: "#e5e7eb", fontSize: "0.92rem", outline: "none" },
  gradeAddLegBtn: { padding: "10px 14px", borderRadius: "10px", border: "1px dashed #334155", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: "0.88rem", fontWeight: 600, textAlign: "center" as const },
  summaryCard: { background: "#111827", border: "1px solid #334155", borderRadius: "14px", padding: "16px 18px", marginBottom: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.3)" },
  summaryHeader: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" },
  summaryIcon: { fontSize: "1rem" },
  summaryTitle: { fontSize: "0.72rem", fontWeight: 800, color: "#64748b", letterSpacing: "0.12em", textTransform: "uppercase" as const },
  summaryActionButton: { marginLeft: "auto", padding: "6px 10px", borderRadius: "8px", border: "1px solid #334155", background: "#0f172a", color: "#cbd5e1", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700 },
  collapsibleShell: { background: "#111827", border: "1px solid #334155", borderRadius: "16px", marginBottom: "16px", overflow: "hidden" as const },
  collapsibleHeaderButton: { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "14px 16px", border: "none", cursor: "pointer", textAlign: "left" as const },
  collapsibleHeaderLeft: { display: "flex", alignItems: "center", gap: "12px", minWidth: 0, flex: 1 },
  collapsibleIconWrap: { width: "34px", height: "34px", borderRadius: "999px", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", flexShrink: 0 },
  collapsibleIcon: { fontSize: "1rem", lineHeight: 1 },
  collapsibleTitleWrap: { minWidth: 0, display: "flex", flexDirection: "column" as const, gap: "3px" },
  collapsibleTitleRow: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" as const },
  collapsibleTitle: { fontSize: "1.02rem", fontWeight: 800, color: "#ffffff" },
  collapsibleSubtitle: { fontSize: "0.82rem", color: "#94a3b8", whiteSpace: "normal" as const },
  collapsibleBadge: { fontSize: "0.68rem", fontWeight: 800, padding: "3px 8px", borderRadius: "999px", letterSpacing: "0.04em" },
  collapsibleChevron: { fontSize: "1rem", color: "#cbd5e1", flexShrink: 0 },
  collapsibleBody: { padding: "16px", borderTop: "1px solid #1e293b", background: "#0f172a" },
  advancedCardActions: { display: "flex", justifyContent: "flex-end", marginBottom: "12px" },
  summaryGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" },
  summaryItem: { display: "flex", flexDirection: "column" as const, gap: "3px" },
  summaryLabel: { fontSize: "0.68rem", color: "#475569", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.08em" },
  summaryValue: { fontSize: "1.1rem", fontWeight: 700, color: "#e5e7eb", lineHeight: 1.3 },
  container: { maxWidth: "1100px", margin: "0 auto" },
  heroRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap", marginBottom: "24px" },
  heroText: { flex: 1, minWidth: "280px" },
  title: { margin: 0, fontSize: "2.1rem", lineHeight: 1.1, color: "#ffffff" },
  subtitle: { marginTop: "10px", marginBottom: 0, color: "#cbd5e1", lineHeight: 1.5, maxWidth: "640px" },
  marketStatus: { marginTop: "10px", fontSize: "0.95rem", fontWeight: 500, color: "#94a3b8" },
  statusCard: { background: "#111827", border: "1px solid #334155", borderRadius: "14px", padding: "14px 16px", minWidth: "300px", display: "grid", gap: "8px", boxShadow: "0 10px 30px rgba(0,0,0,0.18)" },
  manageSubButton: { padding: "8px 12px", borderRadius: "8px", border: "1px solid #475569", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: "0.85rem", justifySelf: "start" as const },
  signOutButton: { padding: "8px 12px", borderRadius: "8px", border: "1px solid #334155", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: "0.85rem", justifySelf: "start" as const },
  searchRow: { display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" },
  input: { flex: 1, minWidth: "240px", padding: "12px 14px", fontSize: "1rem", border: "1px solid #334155", borderRadius: "10px", background: "#1e293b", color: "#fff", outline: "none" },
  button: { padding: "12px 18px", borderRadius: "10px", border: "none", background: "#22c55e", color: "#04130a", cursor: "pointer", fontSize: "1rem", fontWeight: 700, minWidth: "120px" },
  googleButton: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "10px", alignSelf: "flex-start", padding: "12px 18px", borderRadius: "10px", border: "1px solid #cbd5e1", background: "#ffffff", color: "#111827", cursor: "pointer", fontSize: "0.95rem", fontWeight: 700, lineHeight: 1.25, textAlign: "center" as const },
  googleIcon: { width: "18px", height: "18px", display: "block", flexShrink: 0 },
  upgradeButton: { padding: "12px 18px", borderRadius: "10px", border: "none", background: "#f59e0b", color: "#111827", cursor: "pointer", fontSize: "0.95rem", fontWeight: 700 },
  copyButton: { padding: "8px 12px", borderRadius: "8px", border: "1px solid #475569", background: "#0f172a", color: "#e5e7eb", cursor: "pointer", fontSize: "0.9rem", fontWeight: 600 },
  error: { background: "#7f1d1d", color: "#fecaca", padding: "12px 14px", borderRadius: "10px", marginBottom: "16px", border: "1px solid #991b1b" },
  gateCard: { background: "#132035", border: "1px solid #334155", borderRadius: "14px", padding: "18px", marginBottom: "16px", display: "grid", gap: "12px", boxShadow: "0 10px 30px rgba(0,0,0,0.18)" },
  paywallCard: { background: "#1f2937", border: "1px solid #475569", borderRadius: "14px", padding: "18px", marginBottom: "16px", display: "grid", gap: "12px", boxShadow: "0 10px 30px rgba(0,0,0,0.18)" },
  paywallActions: { display: "flex", gap: "12px", flexWrap: "wrap" },
  metaCard: { background: "#1e293b", border: "1px solid #334155", borderRadius: "14px", padding: "16px", marginBottom: "16px", display: "flex", gap: "20px", flexWrap: "wrap" },
  filterIntro: {
    margin: "0 0 14px 0",
    color: "#cbd5e1",
    fontSize: "0.92rem",
    lineHeight: 1.5,
  },
  filterItem: {
    background: "rgba(15, 23, 42, 0.35)",
    border: "1px solid rgba(148, 163, 184, 0.16)",
    borderRadius: "12px",
    padding: "12px",
    color: "#e5e7eb",
  },
  filterNote: {
    marginTop: "6px",
    color: "#94a3b8",
    fontSize: "0.82rem",
    lineHeight: 1.45,
  },
  filterCard: { background: "#1e293b", border: "1px solid #334155", borderRadius: "14px", padding: "16px", marginBottom: "16px" },
  filterGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "10px", color: "#cbd5e1", fontSize: "0.9rem" },
  techCard: { background: "#1e293b", border: "1px solid #334155", borderRadius: "14px", padding: "16px", marginBottom: "16px" },
  techGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "10px", marginTop: "12px" },
  techItem: { display: "flex", flexDirection: "column" as const, gap: "2px", background: "#0f172a", borderRadius: "8px", padding: "10px" },
  techLabel: { fontSize: "0.68rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em" },
  techValue: { fontSize: "1.05rem", fontWeight: 700, color: "#e5e7eb" },
  techNote: { fontSize: "0.72rem", color: "#64748b" },
  beginnerCard: { padding: 0, marginBottom: 0 },
  beginnerHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" },
  beginnerBadge: { background: "#166534", color: "#86efac", fontSize: "0.72rem", fontWeight: 700, padding: "3px 8px", borderRadius: "10px" },
  beginnerSubtitle: { margin: "0 0 14px", color: "#86efac", fontSize: "0.88rem" },
  beginnerNote: { marginTop: "14px", padding: "10px 12px", background: "#052e16", borderRadius: "8px", fontSize: "0.85rem", color: "#bbf7d0", lineHeight: 1.6 },
  beginnerWarning: { marginTop: "8px", padding: "10px 12px", background: "#1c1000", borderRadius: "8px", fontSize: "0.82rem", color: "#fde68a", lineHeight: 1.5 },
  tutorialBtn: { padding: "4px 10px", borderRadius: "6px", border: "1px solid #334155", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600, whiteSpace: "nowrap" as const },
  tutorialModal: { background: "#111827", border: "1px solid #334155", borderRadius: "16px", padding: "24px", maxWidth: "560px", width: "100%", maxHeight: "85vh", overflowY: "auto" as const, boxShadow: "0 25px 60px rgba(0,0,0,0.5)" },
  tutorialContent: { marginTop: "16px" },
  tutorialSection: { marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid #1e293b" },
  tutorialStratTitle: { fontWeight: 700, color: "#e5e7eb", marginBottom: "8px", fontSize: "0.95rem" },
  tutorialText: { color: "#94a3b8", fontSize: "0.85rem", lineHeight: 1.6, margin: "0 0 6px" },
  headlinesCard: { background: "#1e293b", border: "1px solid #334155", borderRadius: "14px", padding: "16px", marginBottom: "16px" },
  headlinesList: { display: "grid", gap: "10px" },
  headlineLink: { display: "block", padding: "12px", borderRadius: "10px", border: "1px solid #334155", background: "#0f172a", color: "#e5e7eb", textDecoration: "none" },
  headlineTitle: { fontWeight: 700, marginBottom: "4px" },
  headlineSource: { fontSize: "0.9rem", color: "#94a3b8" },
  tradeCard: { padding: 0, marginBottom: 0 },
  altTradeCard: { padding: 0, marginBottom: 0 },
  altCardTitle: { margin: 0, marginBottom: "10px", fontSize: "1.05rem", color: "#ffffff" },
  altTradeText: { marginBottom: "12px", color: "#cbd5e1", lineHeight: 1.6 },
  tradeGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "14px", marginBottom: "16px" },
  quoteRow: { display: "flex", gap: "24px", flexWrap: "wrap", paddingTop: "12px", borderTop: "1px solid #334155" },
  statBar: { display: "flex", gap: "0", marginTop: "14px", borderRadius: "10px", overflow: "hidden", border: "1px solid #334155" },
  setupQualityBox: { marginTop: "12px", padding: "10px 12px", borderRadius: "10px", background: "#0f172a", border: "1px solid #1e293b", color: "#cbd5e1", fontSize: "0.84rem", display: "flex", flexDirection: "column" as const, gap: "6px" },
  statItem: { flex: 1, display: "flex", flexDirection: "column" as const, alignItems: "center", padding: "10px 8px", background: "#0f172a", borderRight: "1px solid #334155", gap: "4px", textAlign: "center" as const },
  statLabel: { fontSize: "0.7rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.08em" },
  statLabelSub: { fontSize: "0.65rem", color: "#475569", fontWeight: 400, textTransform: "none" as const, letterSpacing: "0", display: "block", marginTop: "1px" },
  statValue: { fontSize: "1.05rem", fontWeight: 700, color: "#e5e7eb" },
  resultCard: { background: "#1e293b", border: "1px solid #334155", borderRadius: "14px", padding: "16px" },
  resultHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", marginBottom: "8px" },
  cardTitle: { margin: 0, fontSize: "1.2rem", color: "#ffffff" },
  gateText: { margin: 0, color: "#cbd5e1", lineHeight: 1.6 },
  result: { whiteSpace: "pre-wrap", lineHeight: 1.7, margin: 0, color: "#e5e7eb", fontSize: "0.98rem" },
  proBadge: { marginLeft: "8px", background: "#22c55e", color: "#04130a", fontSize: "0.7rem", fontWeight: 800, padding: "2px 7px", borderRadius: "10px", verticalAlign: "middle" },
  upgradeOverlay: { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0" },
  upgradeModalWide: { background: "#111827", border: "1px solid #334155", borderRadius: "16px", padding: "28px 28px 24px", maxWidth: "720px", width: "100%", boxShadow: "0 25px 60px rgba(0,0,0,0.5)", position: "relative" as const },
  upgradeBottomSheet: { position: "relative", width: "100%", maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", background: "linear-gradient(180deg, #0f172a 0%, #111827 100%)", borderTop: "1px solid #334155", borderLeft: "1px solid #334155", borderRight: "1px solid #334155", borderRadius: "22px 22px 0 0", padding: "12px 16px 28px", boxShadow: "0 -20px 60px rgba(0,0,0,0.55)", touchAction: "pan-y", transition: "transform 0.22s ease" },
  upgradeModalHeader: { marginBottom: "20px", display: "flex", flexDirection: "column" as const, gap: "8px" },
  pricingGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" },
  proCard: { background: "#0f2a1a", border: "2px solid #22c55e", borderRadius: "14px", padding: "20px", display: "flex", flexDirection: "column" as const, gap: "10px" },
  proCardBadge: { display: "inline-block", alignSelf: "flex-start" as const, background: "#052e16", color: "#22c55e", fontSize: "0.72rem", fontWeight: 800, padding: "3px 9px", borderRadius: "10px", letterSpacing: "0.05em" },
  proCardPrice: { display: "flex", alignItems: "baseline", gap: "4px", flexWrap: "wrap" as const },
  proFeatureList: { display: "flex", flexDirection: "column" as const, gap: "7px", flex: 1 },
  proFeature: { fontSize: "0.82rem", color: "#bbf7d0" },
  cardDivider: { borderTop: "1px solid #1e293b", margin: "2px 0" },
  premiumCard: { background: "#0a0a12", border: "1px solid #1e293b", borderRadius: "14px", padding: "20px", display: "flex", flexDirection: "column" as const, gap: "10px", opacity: 0.6, cursor: "not-allowed" as const },
  premiumCardBadge: { display: "inline-block", alignSelf: "flex-start" as const, background: "#1e1a3f", color: "#a78bfa", fontSize: "0.72rem", fontWeight: 800, padding: "3px 9px", borderRadius: "10px", letterSpacing: "0.05em" },
  premiumCardPrice: { display: "flex", alignItems: "baseline", gap: "4px" },
  premiumPriceAmount: { fontSize: "2.2rem", fontWeight: 800, color: "#475569" },
  premiumPricePer: { fontSize: "1rem", color: "#334155" },
  premiumFeatureList: { display: "flex", flexDirection: "column" as const, gap: "7px", flex: 1 },
  premiumFeature: { fontSize: "0.82rem", color: "#475569" },
  getPremiumBtn: { padding: "11px", borderRadius: "10px", border: "1px solid #1e293b", background: "#0f172a", color: "#334155", fontSize: "0.9rem", fontWeight: 700, textAlign: "center" as const, display: "flex", alignItems: "center", justifyContent: "center" },
  upgradeBadge: { background: "#1e3a5f", color: "#60a5fa", padding: "4px 10px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 700, alignSelf: "flex-start" as const },
  upgradeTitle: { margin: 0, fontSize: "1.5rem", color: "#ffffff", fontWeight: 800 },
  upgradeSubtitle: { margin: 0, color: "#94a3b8", fontSize: "0.9rem" },
  planToggle: { display: "flex", background: "#0f172a", borderRadius: "10px", padding: "4px", gap: "4px" },
  planToggleBtn: { flex: 1, padding: "8px 12px", borderRadius: "8px", border: "none", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: "0.9rem", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" },
  planToggleBtnActive: { background: "#1e293b", color: "#ffffff" },
  bestValueBadge: { background: "#22c55e", color: "#04130a", fontSize: "0.65rem", fontWeight: 800, padding: "2px 6px", borderRadius: "10px" },
  priceStrike: { fontSize: "1.1rem", color: "#64748b", textDecoration: "line-through" },
  priceAmount: { fontSize: "2.4rem", fontWeight: 800, color: "#ffffff" },
  pricePer: { fontSize: "1rem", color: "#94a3b8" },
  priceSavings: { width: "100%", fontSize: "0.8rem", color: "#22c55e", fontWeight: 600 },
  upgradeCheckoutBtn: { padding: "13px", borderRadius: "10px", border: "none", background: "#22c55e", color: "#04130a", cursor: "pointer", fontSize: "0.95rem", fontWeight: 800, width: "100%" },
  upgradeDisclaimer: { margin: 0, fontSize: "0.72rem", color: "#475569", textAlign: "center" as const },
  upgradeCloseBtn: { position: "absolute" as const, top: "16px", right: "16px", background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "1.1rem", padding: "4px 8px" },
  sheetHandleWrap: { display: "flex", justifyContent: "center", alignItems: "center", paddingBottom: "8px" },
  sheetHandle: { width: "46px", height: "5px", borderRadius: "999px", background: "#475569" },
  footer: { marginTop: "32px", paddingTop: "16px", borderTop: "1px solid #1e293b", textAlign: "center" as const, display: "flex", justifyContent: "center", alignItems: "center", gap: "8px" },
  footerDivider: { color: "#334155", fontSize: "0.8rem" },
  disclaimerLink: { background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: "0.8rem", textDecoration: "underline", padding: 0 },
  brokerLabel: { marginTop: "14px", marginBottom: "8px", fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" as const, color: "#94a3b8" },
  affiliateBar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "14px", padding: "10px 14px", borderRadius: "10px", background: "#0f1f0f", border: "1px solid #166534", textDecoration: "none", color: "#86efac", gap: "12px" },
  affiliateBarLeft: { display: "flex", alignItems: "center", gap: "8px", fontSize: "0.82rem", color: "#86efac" },
  affiliateCta: { fontSize: "0.78rem", fontWeight: 700, color: "#22c55e", whiteSpace: "nowrap" as const, flexShrink: 0 },
  tutorialBias: { display: "inline-block", marginLeft: "8px", fontSize: "0.7rem", fontWeight: 700, padding: "2px 7px", borderRadius: "8px", background: "#0f2a1a", color: "#86efac", verticalAlign: "middle" },
  learnMoreLink: { fontSize: "0.75rem", color: "#60a5fa", textDecoration: "none", fontWeight: 600, flexShrink: 0 },
  exampleBox: { background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "10px 12px", marginTop: "8px" },
  exampleLabel: { fontSize: "0.7rem", color: "#475569", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: "6px" },
  exampleRow: { fontSize: "0.83rem", color: "#cbd5e1", marginBottom: "3px", display: "flex", alignItems: "center", gap: "6px" },
  exampleBuy: { display: "inline-block", background: "#052e16", color: "#86efac", fontSize: "0.65rem", fontWeight: 800, padding: "1px 5px", borderRadius: "4px" },
  exampleSell: { display: "inline-block", background: "#3f1010", color: "#f87171", fontSize: "0.65rem", fontWeight: 800, padding: "1px 5px", borderRadius: "4px" },
  exampleStats: { marginTop: "6px", fontSize: "0.75rem", color: "#64748b", borderTop: "1px solid #1e293b", paddingTop: "6px" },
  disclaimerOverlay: { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0" },
  disclaimerModal: { background: "#111827", border: "1px solid #334155", borderRadius: "16px 16px 0 0", padding: "24px 20px 32px", maxWidth: "580px", width: "100%", maxHeight: "85vh", boxShadow: "0 -10px 40px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column" as const, gap: "12px" },
  disclaimerScroll: { overflowY: "auto" as const, flex: 1, display: "flex", flexDirection: "column" as const, gap: "10px", paddingRight: "4px", minHeight: 0 },
  disclaimerTitle: { margin: 0, fontSize: "1.3rem", color: "#ffffff", textAlign: "center" as const },
  disclaimerMeta: { margin: 0, fontSize: "0.75rem", color: "#475569", textAlign: "center" as const },
  disclaimerSubtitle: { margin: "4px 0 0", fontSize: "0.9rem", fontWeight: 700, color: "#e5e7eb" },
  disclaimerText: { margin: 0, color: "#cbd5e1", lineHeight: 1.7, fontSize: "0.88rem" },
  disclaimerList: { margin: "4px 0 0", paddingLeft: "20px", color: "#cbd5e1", lineHeight: 1.8, fontSize: "0.88rem", display: "flex", flexDirection: "column" as const, gap: "6px" },
  disclaimerButton: { flexShrink: 0, padding: "13px", borderRadius: "10px", border: "none", background: "#22c55e", color: "#04130a", cursor: "pointer", fontSize: "1rem", fontWeight: 700, width: "100%" },
};
