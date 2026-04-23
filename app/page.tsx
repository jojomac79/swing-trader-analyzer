"use client";

import { useEffect, useMemo, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

// ─── Types ────────────────────────────────────────────────────────────────────
type LiveCreditSpread = {
  strategyType: "Bull Put Spread" | "Bear Call Spread";
  expiration: string; shortStrike: number; longStrike: number;
  shortBid: number; shortAsk: number; longBid: number; longAsk: number;
  shortMid: number; longMid: number; netCredit: number; width: number;
  maxProfit: number; maxLoss: number; breakeven: number;
  pop: number | null; pop50: number | null; riskReward: number;
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

type MetaData = {
  symbol?: string; originalInput?: string;
  resolvedFromName?: boolean; resolvedDisplayName?: string | null;
  currentPrice?: string; nextEarnings?: string;
  nearExpiration?: string; farExpiration?: string | null;
  liveCallDebit?: LiveDebitSpread | null; livePutDebit?: LiveDebitSpread | null;
  liveBullPut?: LiveCreditSpread | null; liveBearCall?: LiveCreditSpread | null;
  liveCallDiagonal?: LiveDiagonalSpread | null; livePutDiagonal?: LiveDiagonalSpread | null;
  liveIronCondor?: LiveIronCondor | null; liveLongCall?: LiveLongOption | null; liveLongPut?: LiveLongOption | null;
  recentHeadlines?: HeadlineItem[];
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

function getPopColor(pop: number): string {
  if (pop >= 70) return "#22c55e";
  if (pop >= 50) return "#f59e0b";
  return "#ef4444";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TradeSummaryCard({ bias, confidence, strategy, target, invalidate }: {
  bias: "Bullish" | "Bearish" | "Neutral" | null;
  confidence: string | null; strategy: string | null;
  target: string | null; invalidate: string | null;
}) {
  if (!bias && !strategy) return null;
  const biasColor = bias === "Bullish" ? "#22c55e" : bias === "Bearish" ? "#ef4444" : "#f59e0b";
  const biasIcon = bias === "Bullish" ? "📈" : bias === "Bearish" ? "📉" : "↔️";
  return (
    <div style={styles.summaryCard}>
      <div style={styles.summaryHeader}>
        <span style={styles.summaryIcon}>🎯</span>
        <span style={styles.summaryTitle}>PREFERRED TRADE SUMMARY</span>
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

function AdvancedCardHeader({ onTutorial }: { onTutorial: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
      <h2 style={{ margin: 0, fontSize: "1.2rem", color: "#ffffff" }}>⚡ Advanced Trade Idea</h2>
      <button onClick={onTutorial} style={styles.tutorialBtn}>📖 How it works</button>
    </div>
  );
}

function DebitCard({ spread, currentPrice, onTutorial }: { spread: LiveDebitSpread; currentPrice: string; onTutorial: () => void }) {
  const longLabel = spread.strategyType === "Call Debit Spread" ? "Long Call" : "Long Put";
  const shortLabel = spread.strategyType === "Call Debit Spread" ? "Short Call" : "Short Put";
  const price = parseFloat(currentPrice);
  const stopLoss = spread.strategyType === "Call Debit Spread" ? (price * 0.95).toFixed(2) : (price * 1.05).toFixed(2);
  return (
    <div style={styles.tradeCard}>
      <AdvancedCardHeader onTutorial={onTutorial} />
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
      <a href="https://join.robinhood.com/josephm-5b8d2b" target="_blank" rel="noopener noreferrer" style={styles.affiliateBar}>
        <span style={styles.affiliateBarLeft}><img src="https://robinhood.com/favicon.ico" alt="Robinhood" style={{ width: "18px", height: "18px", borderRadius: "4px", flexShrink: 0 }} /><span><strong>Trade on Robinhood</strong> — commission-free stocks &amp; ETFs</span></span>
        <span style={styles.affiliateCta}>Open Account →</span>
      </a>
    </div>
  );
}

function CreditCard({ spread, currentPrice, onTutorial }: { spread: LiveCreditSpread; currentPrice: string; onTutorial: () => void }) {
  const shortLabel = spread.strategyType === "Bull Put Spread" ? "Short Put" : "Short Call";
  const longLabel = spread.strategyType === "Bull Put Spread" ? "Long Put" : "Long Call";
  const sideLabel = spread.strategyType === "Bull Put Spread" ? "Put Side" : "Call Side";
  const price = parseFloat(currentPrice);
  const stopLoss = spread.strategyType === "Bull Put Spread" ? (price * 0.95).toFixed(2) : (price * 1.05).toFixed(2);
  return (
    <div style={styles.tradeCard}>
      <AdvancedCardHeader onTutorial={onTutorial} />
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
      <a href="https://join.robinhood.com/josephm-5b8d2b" target="_blank" rel="noopener noreferrer" style={styles.affiliateBar}>
        <span style={styles.affiliateBarLeft}><img src="https://robinhood.com/favicon.ico" alt="Robinhood" style={{ width: "18px", height: "18px", borderRadius: "4px", flexShrink: 0 }} /><span><strong>Trade on Robinhood</strong> — commission-free stocks &amp; ETFs</span></span>
        <span style={styles.affiliateCta}>Open Account →</span>
      </a>
    </div>
  );
}

function DiagonalCard({ spread, currentPrice, onTutorial }: { spread: LiveDiagonalSpread; currentPrice: string; onTutorial: () => void }) {
  const longLabel = spread.strategyType === "Call Diagonal" ? "Far Long Call" : "Far Long Put";
  const shortLabel = spread.strategyType === "Call Diagonal" ? "Near Short Call" : "Near Short Put";
  const price = parseFloat(currentPrice);
  const stopLoss = spread.strategyType === "Call Diagonal" ? (price * 0.95).toFixed(2) : (price * 1.05).toFixed(2);
  return (
    <div style={styles.tradeCard}>
      <AdvancedCardHeader onTutorial={onTutorial} />
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
      <a href="https://join.robinhood.com/josephm-5b8d2b" target="_blank" rel="noopener noreferrer" style={styles.affiliateBar}>
        <span style={styles.affiliateBarLeft}><img src="https://robinhood.com/favicon.ico" alt="Robinhood" style={{ width: "18px", height: "18px", borderRadius: "4px", flexShrink: 0 }} /><span><strong>Trade on Robinhood</strong> — commission-free stocks &amp; ETFs</span></span>
        <span style={styles.affiliateCta}>Open Account →</span>
      </a>
    </div>
  );
}

function IronCondorCard({ spread, currentPrice, onTutorial }: { spread: LiveIronCondor; currentPrice: string; onTutorial: () => void }) {
  const price = parseFloat(currentPrice);
  const lowerStop = (price * 0.95).toFixed(2);
  const upperStop = (price * 1.05).toFixed(2);
  return (
    <div style={styles.tradeCard}>
      <AdvancedCardHeader onTutorial={onTutorial} />
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
      <a href="https://join.robinhood.com/josephm-5b8d2b" target="_blank" rel="noopener noreferrer" style={styles.affiliateBar}>
        <span style={styles.affiliateBarLeft}><img src="https://robinhood.com/favicon.ico" alt="Robinhood" style={{ width: "18px", height: "18px", borderRadius: "4px", flexShrink: 0 }} /><span><strong>Trade on Robinhood</strong> — commission-free stocks &amp; ETFs</span></span>
        <span style={styles.affiliateCta}>Open Account →</span>
      </a>
    </div>
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
    <div style={styles.beginnerCard}>
      <div style={styles.beginnerHeader}>
        <h2 style={styles.cardTitle}>🟢 Beginner Trade Idea</h2>
        <span style={styles.beginnerBadge}>Shares Only</span>
      </div>
      <p style={styles.beginnerSubtitle}>Simple directional play — no options required.</p>
      <div style={styles.tradeGrid}>
        <div><strong>Action</strong><br /><span style={{ color: isBullish ? "#22c55e" : "#ef4444", fontWeight: 700, fontSize: "1.1rem" }}>{isBullish ? "Buy Shares" : "Short Shares"}</span></div>
        <div><strong>Symbol</strong><br />{symbol}</div>
        <div><strong>Current Price</strong><br />${currentPrice}</div>
        <div><strong>Stop Loss</strong><br /><span style={{ color: "#ef4444", fontWeight: 700 }}>${stopLoss}</span></div>
      </div>
      <div style={styles.beginnerNote}><strong>How it works:</strong> {isBullish ? "Buy shares and hold while the stock moves up. Sell when your target is hit or your thesis changes." : "Borrow and sell shares now, buy them back cheaper later. Profit from the price decline."}</div>
      <div style={styles.beginnerWarning}>⚠️ {isBullish ? "Risk: Stock could decline. Only invest what you can afford to lose." : "Risk: Shorting has theoretically unlimited loss if the stock rises. Use a stop loss."}</div>
      <a href="https://join.robinhood.com/josephm-5b8d2b" target="_blank" rel="noopener noreferrer" style={styles.affiliateBar}>
        <span style={styles.affiliateBarLeft}><img src="https://robinhood.com/favicon.ico" alt="Robinhood" style={{ width: "18px", height: "18px", borderRadius: "4px", flexShrink: 0 }} /><span><strong>Trade on Robinhood</strong> — commission-free stocks &amp; ETFs</span></span>
        <span style={styles.affiliateCta}>Open Account →</span>
      </a>
    </div>
  );
}

function AltTradeCard({ option, parsedLine, currentPrice }: { option: LiveLongOption; parsedLine: string | null; currentPrice: string }) {
  const price = parseFloat(currentPrice);
  const stopLoss = option.strategyType === "Long Call" ? (price * 0.95).toFixed(2) : (price * 1.05).toFixed(2);
  return (
    <div style={styles.altTradeCard}>
      <h3 style={styles.altCardTitle}>🎯 Max Risk Trade Idea</h3>
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
      <a href="https://join.robinhood.com/josephm-5b8d2b" target="_blank" rel="noopener noreferrer" style={styles.affiliateBar}>
        <span style={styles.affiliateBarLeft}><img src="https://robinhood.com/favicon.ico" alt="Robinhood" style={{ width: "18px", height: "18px", borderRadius: "4px", flexShrink: 0 }} /><span><strong>Trade on Robinhood</strong> — commission-free stocks &amp; ETFs</span></span>
        <span style={styles.affiliateCta}>Open Account →</span>
      </a>
    </div>
  );
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
  const [copied, setCopied] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showFullAnalysis, setShowFullAnalysis] = useState(false);

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

  const bias = useMemo(() => getBiasFromResult(result), [result]);
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
    if (preferredStrategy === "No Trade") return null;
    if (preferredStrategy) return null;
    return pickFallbackTrade(meta, bias);
  }, [meta, preferredStrategy, bias]);

  const altTrade = useMemo(() => { if (!meta) return null; return pickAltTrade(meta, bias); }, [meta, bias]);

  const analyzeStock = async () => {
    if (!ticker.trim()) { setError("Enter a ticker or company name."); return; }
    if (!isSignedIn) { setShowGoogleGate(true); return; }
    if (!disclaimerAccepted) { setShowDisclaimer(true); return; }
    setLoading(true); setError(""); setResult(""); setMeta(null); setCopied(false);
    setShowGoogleGate(false); setShowPaywall(false); setShowFullAnalysis(false);
    try {
      const res = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker }) });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403) {
          if (data.limitType === "anon_limit") setShowGoogleGate(true);
          else if (data.limitType === "disclaimer_required") setShowDisclaimer(true);
          else setShowPaywall(true);
        }
        if (res.status === 401) setShowGoogleGate(true);
        throw new Error(data.error || "Failed to analyze stock.");
      }
      setResult(data.result ?? ""); setMeta(data.meta ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setLoading(false); }
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
            <h1 style={styles.title}>Swing Trade Analyzer</h1>
            <p style={styles.subtitle}>Enter a ticker or company name. Get trade breakdowns with real-time options data, earnings context, and AI-selected strategy.</p>
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
                <div style={{ fontSize: "0.8rem", color: "#64748b" }}>3 free analyses/day with Google</div>
                <button onClick={() => signIn("google", { callbackUrl: window.location.href })} style={styles.googleButton}>
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style={styles.googleIcon} />
                  Sign in with Google
                </button>
              </div>
            )}
          </div>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); analyzeStock(); }} style={styles.searchRow}>
          <input type="text" placeholder="Ticker or company (e.g. AAPL or Netflix)" value={ticker} onChange={(e) => setTicker(e.target.value)} style={styles.input} autoFocus disabled={loading || status === "loading"} />
          <button type="submit" disabled={loading || !ticker.trim() || status === "loading"} style={styles.button}>
            {loading ? "Scanning Options Chain..." : "Analyze"}
          </button>
        </form>

        {showGoogleGate && (
          <div style={styles.gateCard}>
            <h2 style={styles.cardTitle}>Sign in to use the analyzer</h2>
            <p style={styles.gateText}>A free Google account gets you 3 analyses per day.</p>
            <button onClick={() => signIn("google", { callbackUrl: window.location.href })} style={styles.googleButton}>
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style={styles.googleIcon} />
              Continue with Google
            </button>
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
          <div style={styles.upgradeOverlay}>
            <div style={styles.upgradeModalWide}>
              <button onClick={() => setShowUpgradeModal(false)} style={styles.upgradeCloseBtn}>✕</button>
              <div style={styles.upgradeModalHeader}>
                <div style={styles.upgradeBadge}>🚀 Early Access Pricing</div>
                <h2 style={styles.upgradeTitle}>Choose Your Plan</h2>
                <p style={styles.upgradeSubtitle}>Unlock unlimited analyses and more powerful tools.</p>
              </div>
              <div style={styles.pricingGrid}>
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

        {error && <div style={styles.error}>{error}</div>}

        {meta && (
          <div style={styles.metaCard}>
            <div><strong>Symbol:</strong> {meta.symbol}</div>
            {meta.resolvedFromName && meta.originalInput && <div><strong>Resolved from:</strong> {meta.originalInput}</div>}
            {meta.resolvedFromName && meta.resolvedDisplayName && <div><strong>Company:</strong> {meta.resolvedDisplayName}</div>}
            <div><strong>Price:</strong> ${meta.currentPrice}</div>
            <div><strong>Next Earnings:</strong> {meta.nextEarnings}</div>
            {bias && <div><strong>AI Bias:</strong> <span style={{ color: bias === "Bullish" ? "#22c55e" : bias === "Bearish" ? "#ef4444" : "#f59e0b" }}>{bias}</span></div>}
            {preferredStrategy && <div><strong>Strategy:</strong> {preferredStrategy}</div>}
          </div>
        )}

        {result && <TradeSummaryCard bias={bias} confidence={confidenceScore} strategy={preferredStrategy} target={tradeTarget} invalidate={tradeInvalidate} />}

        {meta?.techData && <TechCard tech={meta.techData} />}

        {meta && (bias === "Bullish" || bias === "Bearish") && <BeginnerCard bias={bias} symbol={meta.symbol ?? ""} currentPrice={meta.currentPrice ?? ""} />}

        {selectedTradeCard?.type === "callDebit" && <DebitCard spread={selectedTradeCard.spread} currentPrice={meta?.currentPrice ?? "0"} onTutorial={() => setShowTutorial(true)} />}
        {selectedTradeCard?.type === "putDebit" && <DebitCard spread={selectedTradeCard.spread} currentPrice={meta?.currentPrice ?? "0"} onTutorial={() => setShowTutorial(true)} />}
        {selectedTradeCard?.type === "bullPut" && <CreditCard spread={selectedTradeCard.spread} currentPrice={meta?.currentPrice ?? "0"} onTutorial={() => setShowTutorial(true)} />}
        {selectedTradeCard?.type === "bearCall" && <CreditCard spread={selectedTradeCard.spread} currentPrice={meta?.currentPrice ?? "0"} onTutorial={() => setShowTutorial(true)} />}
        {selectedTradeCard?.type === "callDiagonal" && <DiagonalCard spread={selectedTradeCard.spread} currentPrice={meta?.currentPrice ?? "0"} onTutorial={() => setShowTutorial(true)} />}
        {selectedTradeCard?.type === "putDiagonal" && <DiagonalCard spread={selectedTradeCard.spread} currentPrice={meta?.currentPrice ?? "0"} onTutorial={() => setShowTutorial(true)} />}
        {selectedTradeCard?.type === "ironCondor" && <IronCondorCard spread={selectedTradeCard.spread} currentPrice={meta?.currentPrice ?? "0"} onTutorial={() => setShowTutorial(true)} />}
        {altTrade && <AltTradeCard option={altTrade} parsedLine={altTradeText} currentPrice={meta?.currentPrice ?? "0"} />}

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
const styles: { [key: string]: React.CSSProperties } = {
  main: { minHeight: "100vh", padding: "40px 16px", color: "#e5e7eb", background: "#0f172a" },
  summaryCard: { background: "#111827", border: "1px solid #334155", borderRadius: "14px", padding: "16px 18px", marginBottom: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.3)" },
  summaryHeader: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" },
  summaryIcon: { fontSize: "1rem" },
  summaryTitle: { fontSize: "0.72rem", fontWeight: 800, color: "#64748b", letterSpacing: "0.12em", textTransform: "uppercase" as const },
  summaryGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" },
  summaryItem: { display: "flex", flexDirection: "column" as const, gap: "3px" },
  summaryLabel: { fontSize: "0.68rem", color: "#475569", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.08em" },
  summaryValue: { fontSize: "1.1rem", fontWeight: 700, color: "#e5e7eb", lineHeight: 1.3 },
  container: { maxWidth: "1100px", margin: "0 auto" },
  heroRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap", marginBottom: "24px" },
  heroText: { flex: 1, minWidth: "280px" },
  title: { margin: 0, fontSize: "2.1rem", lineHeight: 1.1, color: "#ffffff" },
  subtitle: { marginTop: "10px", marginBottom: 0, color: "#cbd5e1", lineHeight: 1.5, maxWidth: "640px" },
  statusCard: { background: "#111827", border: "1px solid #334155", borderRadius: "14px", padding: "14px 16px", minWidth: "260px", display: "grid", gap: "8px", boxShadow: "0 10px 30px rgba(0,0,0,0.18)" },
  manageSubButton: { padding: "8px 12px", borderRadius: "8px", border: "1px solid #475569", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: "0.85rem", justifySelf: "start" as const },
  signOutButton: { padding: "8px 12px", borderRadius: "8px", border: "1px solid #334155", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: "0.85rem", justifySelf: "start" as const },
  searchRow: { display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" },
  input: { flex: 1, minWidth: "240px", padding: "12px 14px", fontSize: "1rem", border: "1px solid #334155", borderRadius: "10px", background: "#1e293b", color: "#fff", outline: "none" },
  button: { padding: "12px 18px", borderRadius: "10px", border: "none", background: "#22c55e", color: "#04130a", cursor: "pointer", fontSize: "1rem", fontWeight: 700, minWidth: "120px" },
  googleButton: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "10px", alignSelf: "flex-start", padding: "12px 18px", borderRadius: "10px", border: "1px solid #cbd5e1", background: "#ffffff", color: "#111827", cursor: "pointer", fontSize: "0.95rem", fontWeight: 700 },
  googleIcon: { width: "18px", height: "18px", display: "block", flexShrink: 0 },
  upgradeButton: { padding: "12px 18px", borderRadius: "10px", border: "none", background: "#f59e0b", color: "#111827", cursor: "pointer", fontSize: "0.95rem", fontWeight: 700 },
  copyButton: { padding: "8px 12px", borderRadius: "8px", border: "1px solid #475569", background: "#0f172a", color: "#e5e7eb", cursor: "pointer", fontSize: "0.9rem", fontWeight: 600 },
  error: { background: "#7f1d1d", color: "#fecaca", padding: "12px 14px", borderRadius: "10px", marginBottom: "16px", border: "1px solid #991b1b" },
  gateCard: { background: "#132035", border: "1px solid #334155", borderRadius: "14px", padding: "18px", marginBottom: "16px", display: "grid", gap: "12px", boxShadow: "0 10px 30px rgba(0,0,0,0.18)" },
  paywallCard: { background: "#1f2937", border: "1px solid #475569", borderRadius: "14px", padding: "18px", marginBottom: "16px", display: "grid", gap: "12px", boxShadow: "0 10px 30px rgba(0,0,0,0.18)" },
  paywallActions: { display: "flex", gap: "12px", flexWrap: "wrap" },
  metaCard: { background: "#1e293b", border: "1px solid #334155", borderRadius: "14px", padding: "16px", marginBottom: "16px", display: "flex", gap: "20px", flexWrap: "wrap" },
  techCard: { background: "#1e293b", border: "1px solid #334155", borderRadius: "14px", padding: "16px", marginBottom: "16px" },
  techGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "10px", marginTop: "12px" },
  techItem: { display: "flex", flexDirection: "column" as const, gap: "2px", background: "#0f172a", borderRadius: "8px", padding: "10px" },
  techLabel: { fontSize: "0.68rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em" },
  techValue: { fontSize: "1.05rem", fontWeight: 700, color: "#e5e7eb" },
  techNote: { fontSize: "0.72rem", color: "#64748b" },
  beginnerCard: { background: "#0f2a1a", border: "1px solid #166534", borderRadius: "14px", padding: "16px", marginBottom: "16px" },
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
  tradeCard: { background: "#1e293b", border: "1px solid #334155", borderRadius: "14px", padding: "16px", marginBottom: "16px" },
  altTradeCard: { background: "#18263f", border: "1px solid #334155", borderRadius: "14px", padding: "16px", marginBottom: "16px" },
  altCardTitle: { margin: 0, marginBottom: "10px", fontSize: "1.05rem", color: "#ffffff" },
  altTradeText: { marginBottom: "12px", color: "#cbd5e1", lineHeight: 1.6 },
  tradeGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "14px", marginBottom: "16px" },
  quoteRow: { display: "flex", gap: "24px", flexWrap: "wrap", paddingTop: "12px", borderTop: "1px solid #334155" },
  statBar: { display: "flex", gap: "0", marginTop: "14px", borderRadius: "10px", overflow: "hidden", border: "1px solid #334155" },
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
  upgradeOverlay: { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" },
  upgradeModalWide: { background: "#111827", border: "1px solid #334155", borderRadius: "16px", padding: "28px 28px 24px", maxWidth: "720px", width: "100%", boxShadow: "0 25px 60px rgba(0,0,0,0.5)", position: "relative" as const },
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
  footer: { marginTop: "32px", paddingTop: "16px", borderTop: "1px solid #1e293b", textAlign: "center" as const, display: "flex", justifyContent: "center", alignItems: "center", gap: "8px" },
  footerDivider: { color: "#334155", fontSize: "0.8rem" },
  disclaimerLink: { background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: "0.8rem", textDecoration: "underline", padding: 0 },
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
