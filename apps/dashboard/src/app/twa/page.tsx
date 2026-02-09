'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { TWAProviders, useTWAWallet } from './providers';
import { TheWheelTWA } from './components/TheWheelTWA';
import { SentimentPanelTWA } from './components/SentimentPanelTWA';
import { PortfolioCardTWA } from './components/PortfolioCardTWA';
import { PositionsPanelTWA } from './components/PositionsPanelTWA';
import { AgentPanelTWA } from './components/AgentPanelTWA';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PositionEntry {
  symbol: string;
  mint: string;
  balance: number;
  uiAmount: number;
  decimals: number;
}

interface PerpPosition {
  id: string;
  market: string;
  side: 'long' | 'short';
  leverage: number;
  collateralUsd: number;
  entryPrice: number;
  currentPrice?: number;
  unrealizedPnl?: number;
  unrealizedPnlPct?: number;
  openedAt: number;
}

interface PositionSnapshot {
  positions: PositionEntry[];
  allocation: Array<{ symbol: string; pct: number }>;
  totalValueSol: number;
  timestamp: number;
  perpPositions: PerpPosition[];
  perpSummary: {
    count: number;
    totalCollateral: number;
    totalExposure: number;
    totalUnrealizedPnl: number;
  };
}

interface SentimentReport {
  timestamp: number;
  overallScore: number;
  direction: string;
  confidence: number;
  signals: {
    fearGreed: { value: number; classification: string };
    rsi: Record<string, { value: number; signal: string }>;
    momentum: { trend: string; volatility: string; changePct: number };
    polymarket: { bias: string; conviction: number };
    tvl: { tvl: number; change24hPct: number };
    dexVolume: { volume24h: number; change24hPct: number };
  };
  recommendations: Array<{
    token: string;
    action: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
    confidence: number;
    reasons: string[];
  }>;
}

interface PolymarketData {
  cryptoMarkets: Array<{
    question: string;
    probability: number;
    volume24h: number;
    priceChange24h: number;
    relevance: string;
  }>;
  sentimentSummary: {
    overallBias: string;
    highConvictionCount: number;
    averageProbability: number;
  };
  fetchedAt: number;
}

// ─── Tab definitions ────────────────────────────────────────────────────────

type TabId = 'home' | 'sentiment' | 'portfolio' | 'markets' | 'agent';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '◎' },
  { id: 'sentiment', label: 'Signals', icon: '◈' },
  { id: 'portfolio', label: 'Portfolio', icon: '◆' },
  { id: 'agent', label: 'Agent', icon: '◉' },
];

// ─── Login Screen ────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="twa-app flex flex-col items-center justify-center h-screen gap-6 px-6">
      {/* Logo */}
      <div className="flex flex-col items-center gap-2">
        <span
          className="font-display text-3xl tracking-[0.3em]"
          style={{
            background: 'linear-gradient(135deg, #00B4D8, #00E5FF, #67EFFF)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          MAKORA
        </span>
        <span className="text-[10px] font-mono tracking-[0.2em] text-text-muted uppercase">
          Autonomous DeFi Agent
        </span>
      </div>

      {/* Description */}
      <div className="text-center max-w-xs">
        <p className="text-[11px] font-mono text-text-muted leading-relaxed">
          Leveraged perps, real-time sentiment, autonomous OODA trading cycles — all from Telegram.
        </p>
      </div>

      {/* Login button */}
      <button
        onClick={onLogin}
        className="px-8 py-3 rounded-sm font-mono text-sm font-bold tracking-wider uppercase transition-all"
        style={{
          background: 'linear-gradient(135deg, #00B4D8, #00E5FF)',
          color: '#050508',
        }}
      >
        Connect Wallet
      </button>

      <span className="text-[9px] font-mono text-text-muted">
        Powered by Privy — email, phone, or Telegram login
      </span>

      {/* Anonmesh branding */}
      <a
        href="https://x.com/anon0mesh"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-[10px] font-mono text-text-muted hover:text-cursed transition-colors mt-2"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        <span>@anon0mesh</span>
      </a>
    </div>
  );
}

// ─── Main Dashboard Content ─────────────────────────────────────────────────

function TWADashboard() {
  const { walletAddress, userId, authenticated, loading, login, logout, displayName } = useTWAWallet();
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [showWelcome, setShowWelcome] = useState(false);
  const [copied, setCopied] = useState(false);
  const prevAuthRef = useRef(false);
  const notifiedRef = useRef(false);

  // Show welcome banner on first login during this session
  useEffect(() => {
    if (authenticated && !prevAuthRef.current) {
      setShowWelcome(true);
      const timer = setTimeout(() => setShowWelcome(false), 8000);
      return () => clearTimeout(timer);
    }
    prevAuthRef.current = authenticated;
  }, [authenticated]);

  // Track whether bot was notified (for UI feedback)
  const [botNotified, setBotNotified] = useState<boolean | null>(null);

  // Notify Telegram bot when wallet becomes available (separate from welcome banner)
  useEffect(() => {
    if (!authenticated || !walletAddress || notifiedRef.current) return;
    notifiedRef.current = true;

    const tgWebApp = (window as any).Telegram?.WebApp;
    const tgUser = tgWebApp?.initDataUnsafe?.user;

    // Parse initData raw string as additional fallback (some TG clients
    // populate initData but leave initDataUnsafe empty)
    let initDataUserId: number | null = null;
    try {
      const raw = tgWebApp?.initData;
      if (raw && typeof raw === 'string') {
        const params = new URLSearchParams(raw);
        const userJson = params.get('user');
        if (userJson) {
          const parsed = JSON.parse(userJson);
          if (parsed?.id) initDataUserId = Number(parsed.id);
        }
        if (!initDataUserId) {
          const chatIdParam = params.get('chat_id');
          if (chatIdParam) initDataUserId = Number(chatIdParam);
        }
      }
    } catch { /* ignore parse errors */ }

    // Try Telegram WebApp context first, then initData, then URL param as fallback
    const urlChatId = new URLSearchParams(window.location.search).get('chatId');
    const chatId = tgUser?.id || tgWebApp?.initDataUnsafe?.chat?.id || initDataUserId || (urlChatId ? Number(urlChatId) : null);
    console.log('[TWA] notify check:', { chatId, tgUser: !!tgUser, initDataUserId, urlChatId, webApp: !!tgWebApp, wallet: walletAddress.slice(0, 8) });

    if (chatId) {
      fetch('/api/twa/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramUserId: chatId, walletAddress }),
      })
        .then(r => r.json())
        .then(d => { console.log('[TWA] notify result:', d); setBotNotified(d.ok === true); })
        .catch(e => { console.error('[TWA] notify error:', e); setBotNotified(false); });
    } else {
      console.warn('[TWA] No Telegram chatId found — not opened from Telegram?');
      setBotNotified(false);
    }
  }, [authenticated, walletAddress]);

  // Data state
  const [positionData, setPositionData] = useState<PositionSnapshot | null>(null);
  const [sentiment, setSentiment] = useState<SentimentReport | null>(null);
  const [polymarket, setPolymarket] = useState<PolymarketData | null>(null);
  const [vaultData, setVaultData] = useState<{ balanceSol: number; totalShielded: number; totalUnshielded: number } | null>(null);
  const [loadingState, setLoadingState] = useState({ positions: true, sentiment: true, polymarket: true });

  // Decision tick: incremented whenever positions or sentiment change
  const [decisionTick, setDecisionTick] = useState(0);
  const prevPerpCountRef = useRef(0);
  const prevScoreRef = useRef<number | null>(null);

  // Fetch positions — use userId for per-user isolation when available
  const fetchPositions = useCallback(async () => {
    if (!walletAddress) {
      setLoadingState(prev => ({ ...prev, positions: false }));
      return;
    }
    try {
      const params = new URLSearchParams({ wallet: walletAddress });
      if (userId) params.set('userId', userId);
      const res = await fetch(`/api/agent/positions?${params}`);
      if (res.ok) {
        const data: PositionSnapshot = await res.json();

        // Also fetch bot-synced perp positions from /api/perps
        try {
          const uid = userId || 'default';
          const perpsRes = await fetch(`/api/perps?userId=${uid}`);
          if (!perpsRes.ok) {
            const defaultRes = await fetch('/api/perps?userId=default');
            if (defaultRes.ok) {
              const botPerps = await defaultRes.json();
              if (botPerps.positions?.length > 0) {
                data.perpPositions = [...(data.perpPositions || []), ...botPerps.positions];
                data.perpSummary = {
                  count: data.perpPositions.length,
                  totalCollateral: (data.perpSummary?.totalCollateral || 0) + (botPerps.summary?.totalCollateral || 0),
                  totalExposure: (data.perpSummary?.totalExposure || 0) + (botPerps.summary?.totalExposure || 0),
                  totalUnrealizedPnl: (data.perpSummary?.totalUnrealizedPnl || 0) + (botPerps.summary?.totalUnrealizedPnl || 0),
                };
              }
            }
          } else {
            const botPerps = await perpsRes.json();
            if (botPerps.positions?.length > 0) {
              data.perpPositions = [...(data.perpPositions || []), ...botPerps.positions];
              data.perpSummary = {
                count: data.perpPositions.length,
                totalCollateral: (data.perpSummary?.totalCollateral || 0) + (botPerps.summary?.totalCollateral || 0),
                totalExposure: (data.perpSummary?.totalExposure || 0) + (botPerps.summary?.totalExposure || 0),
                totalUnrealizedPnl: (data.perpSummary?.totalUnrealizedPnl || 0) + (botPerps.summary?.totalUnrealizedPnl || 0),
              };
            }
          }
        } catch { /* silent — bot perps fetch is best-effort */ }

        setPositionData(data);

        // Tick on position count change (new position opened/closed = decision)
        const perpCount = data.perpPositions?.length ?? 0;
        if (perpCount !== prevPerpCountRef.current && prevPerpCountRef.current !== 0) {
          setDecisionTick(t => t + 1);
        }
        prevPerpCountRef.current = perpCount;
      }
    } catch { /* silent */ }
    setLoadingState(prev => ({ ...prev, positions: false }));
  }, [walletAddress, userId]);

  // Fetch sentiment
  const fetchSentiment = useCallback(async () => {
    try {
      const res = await fetch('/api/sentiment');
      if (res.ok) {
        const data: SentimentReport = await res.json();
        setSentiment(data);

        // Tick on sentiment direction change (market shift = decision)
        if (prevScoreRef.current !== null && data.overallScore !== prevScoreRef.current) {
          const scoreDelta = Math.abs(data.overallScore - prevScoreRef.current);
          if (scoreDelta >= 5) {
            setDecisionTick(t => t + 1);
          }
        }
        prevScoreRef.current = data.overallScore;
      }
    } catch { /* silent */ }
    setLoadingState(prev => ({ ...prev, sentiment: false }));
  }, []);

  // Fetch polymarket
  const fetchPolymarket = useCallback(async () => {
    try {
      const res = await fetch('/api/polymarket');
      if (res.ok) {
        const data: PolymarketData = await res.json();
        setPolymarket(data);
      }
    } catch { /* silent */ }
    setLoadingState(prev => ({ ...prev, polymarket: false }));
  }, []);

  // Fetch vault state from dashboard API (synced from bot)
  // Check both user-specific and 'default' key (bot may use either)
  const fetchVault = useCallback(async () => {
    try {
      // Try user-specific first, then fallback to 'default'
      for (const uid of [userId, 'default'].filter(Boolean)) {
        const res = await fetch(`/api/vault?userId=${uid}`);
        if (res.ok) {
          const data = await res.json();
          if (data.balanceSol > 0) {
            setVaultData(data);
            return;
          }
        }
      }
      // No vault data found
      setVaultData({ balanceSol: 0, totalShielded: 0, totalUnshielded: 0 });
    } catch { /* silent */ }
  }, [userId]);

  // Initial fetch — tick once when first data loads
  useEffect(() => {
    if (!authenticated) return;
    Promise.all([fetchPositions(), fetchSentiment(), fetchPolymarket(), fetchVault()]).then(() => {
      setDecisionTick(1); // Initial load = first tick
    });
  }, [authenticated, fetchPositions, fetchSentiment, fetchPolymarket, fetchVault]);

  // Polling
  useEffect(() => {
    if (!authenticated) return;
    const posInterval = setInterval(fetchPositions, 5000);
    const sentInterval = setInterval(fetchSentiment, 60000);
    const polyInterval = setInterval(fetchPolymarket, 60000);
    const vaultInterval = setInterval(fetchVault, 10000);
    return () => {
      clearInterval(posInterval);
      clearInterval(sentInterval);
      clearInterval(polyInterval);
      clearInterval(vaultInterval);
    };
  }, [authenticated, fetchPositions, fetchSentiment, fetchPolymarket, fetchVault]);

  // ─── Loading state ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="twa-app flex items-center justify-center h-screen">
        <div className="text-cursed font-mono text-sm animate-pulse">Loading...</div>
      </div>
    );
  }

  // ─── Login gate ────────────────────────────────────────────────────────
  if (!authenticated) {
    return <LoginScreen onLogin={login} />;
  }

  const positionCount = positionData?.perpPositions?.length ?? 0;

  // ─── Tab Content ──────────────────────────────────────────────────────────

  const renderTab = () => {
    switch (activeTab) {
      case 'home':
        return (
          <>
            {/* Welcome banner after first login */}
            {showWelcome && (
              <div className="px-3 pt-3">
                <div
                  className="cursed-card p-4 relative overflow-hidden"
                  style={{ borderColor: '#00E5FF40' }}
                >
                  <button
                    onClick={() => setShowWelcome(false)}
                    className="absolute top-2 right-3 text-text-muted text-xs hover:text-cursed"
                  >
                    x
                  </button>
                  <div className="text-[11px] font-mono font-bold text-cursed mb-1">
                    Wallet Connected
                  </div>
                  <div className="text-[10px] font-mono text-text-muted leading-relaxed">
                    {walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'Ready'}
                    {botNotified === true
                      ? ' — Check the chat, Makora is ready to trade!'
                      : botNotified === false
                        ? ' — Go back to the chat and type /start to link your wallet, then reopen the Dashboard.'
                        : ' — Linking to Makora...'}
                  </div>
                </div>
              </div>
            )}

            {/* Wheel */}
            <TheWheelTWA
              walletAddress={walletAddress}
              positionCount={positionCount}
              sentimentDirection={sentiment?.direction}
              sentimentScore={sentiment?.overallScore}
              decisionTick={decisionTick}
              totalValueSol={positionData?.totalValueSol ?? 0}
            />

            {/* Quick position summary */}
            {positionCount > 0 && (
              <div className="px-3 pb-3">
                <div className="cursed-card p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-mono tracking-wider uppercase text-text-muted">Open Positions</span>
                    <span className="text-[9px] font-mono text-cursed">{positionCount}</span>
                  </div>
                  {positionData?.perpPositions.slice(0, 3).map(pos => {
                    const pnl = pos.unrealizedPnlPct ?? 0;
                    const isProfit = pnl >= 0;
                    return (
                      <div key={pos.id} className="flex items-center justify-between py-1 border-t border-cursed/5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-[8px] font-mono font-bold uppercase px-1 py-0.5 rounded-sm"
                            style={{
                              color: pos.side === 'long' ? '#22c55e' : '#ef4444',
                              background: pos.side === 'long' ? '#22c55e12' : '#ef444412',
                            }}
                          >
                            {pos.side}
                          </span>
                          <span className="text-[11px] font-mono font-bold">{pos.market}</span>
                          <span className="text-[9px] font-mono text-text-muted">{pos.leverage}x</span>
                        </div>
                        <span className="text-[11px] font-mono font-bold" style={{ color: isProfit ? '#22c55e' : '#ef4444' }}>
                          {isProfit ? '+' : ''}{pnl.toFixed(2)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Sentiment mini */}
            {sentiment && (
              <div className="px-3 pb-3">
                <div className="cursed-card p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-mono tracking-wider uppercase text-text-muted">Market Sentiment</span>
                    <span
                      className="text-[9px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded-sm"
                      style={{
                        color: sentiment.direction.includes('buy') ? '#22c55e' : sentiment.direction.includes('sell') ? '#ef4444' : '#00E5FF',
                        background: sentiment.direction.includes('buy') ? '#22c55e12' : sentiment.direction.includes('sell') ? '#ef444412' : '#00E5FF12',
                      }}
                    >
                      {sentiment.direction.replace('_', ' ')}
                    </span>
                  </div>
                  {sentiment.recommendations.length > 0 && (
                    <div className="mt-2 flex items-center gap-3">
                      {sentiment.recommendations.map(r => (
                        <div key={r.token} className="flex items-center gap-1">
                          <span className="text-[10px] font-mono font-bold">{r.token}</span>
                          <span
                            className="text-[8px] font-mono uppercase"
                            style={{ color: r.action.includes('buy') ? '#22c55e' : r.action.includes('sell') ? '#ef4444' : '#00E5FF' }}
                          >
                            {r.action.replace('_', ' ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Live indicator */}
            <div className="px-3 pb-4">
              <div className="flex items-center justify-center gap-2 py-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#22c55e' }} />
                <span className="text-[9px] font-mono text-text-muted">Live — refreshing every 5s</span>
              </div>
            </div>
          </>
        );

      case 'sentiment':
        return (
          <div className="px-3 pt-3 pb-4">
            <SentimentPanelTWA report={sentiment} loading={loadingState.sentiment} />
          </div>
        );

      case 'portfolio':
        return (
          <div className="px-3 pt-3 pb-4 space-y-3">
            <PortfolioCardTWA
              solBalance={positionData?.positions.find(p => p.symbol === 'SOL')?.uiAmount ?? null}
              positions={positionData?.positions ?? []}
              allocation={positionData?.allocation ?? []}
              totalValueSol={positionData?.totalValueSol ?? 0}
              loading={loadingState.positions}
            />

            {/* ZK Vault Card — always visible */}
            <div className="cursed-card p-4">
              <div className="section-title mb-3">ZK SHIELDED VAULT</div>
              <div className="flex items-baseline gap-2 mb-3">
                <span className="text-xl font-bold font-mono" style={{ color: '#00E5FF' }}>
                  {(vaultData?.balanceSol ?? 0).toFixed(4)}
                </span>
                <span className="text-text-muted text-xs font-mono">SOL shielded</span>
              </div>
              <div className="flex gap-4 text-xs font-mono text-text-muted">
                <span>Total shielded: {(vaultData?.totalShielded ?? 0).toFixed(4)}</span>
                <span>Total unshielded: {(vaultData?.totalUnshielded ?? 0).toFixed(4)}</span>
              </div>
              {(vaultData?.balanceSol ?? 0) === 0 && (
                <div className="text-text-muted text-[10px] font-mono mt-2">
                  Use &quot;shield X SOL&quot; in chat to protect your funds
                </div>
              )}
            </div>

            <PositionsPanelTWA
              positions={positionData?.perpPositions ?? []}
              loading={loadingState.positions}
            />
          </div>
        );

      case 'agent':
        return (
          <div className="px-3 pt-3 pb-4">
            <AgentPanelTWA />
          </div>
        );

      case 'markets':
        return (
          <div className="px-3 pt-3 pb-4">
            <div className="cursed-card p-4">
              <div className="section-title mb-3">PREDICTION MARKETS</div>
              {loadingState.polymarket ? (
                <div className="text-text-muted text-xs font-mono animate-pulse">Loading markets...</div>
              ) : polymarket && polymarket.cryptoMarkets.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono mb-3">
                    <span className="text-text-muted">Overall Bias</span>
                    <span style={{
                      color: polymarket.sentimentSummary.overallBias === 'bullish' ? '#22c55e' :
                             polymarket.sentimentSummary.overallBias === 'bearish' ? '#ef4444' : '#00E5FF'
                    }}>
                      {polymarket.sentimentSummary.overallBias.toUpperCase()}
                    </span>
                  </div>
                  {polymarket.cryptoMarkets.slice(0, 8).map((market, i) => (
                    <div key={i} className="bg-bg-inner p-2.5 rounded-sm border border-cursed/10">
                      <div className="text-[10px] font-mono text-text-primary mb-1.5 leading-tight">
                        {market.question.length > 70 ? market.question.slice(0, 67) + '...' : market.question}
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono font-bold" style={{
                            color: market.probability > 0.6 ? '#22c55e' : market.probability < 0.4 ? '#ef4444' : '#00E5FF'
                          }}>
                            {(market.probability * 100).toFixed(0)}% YES
                          </span>
                          <span className="text-[9px] font-mono text-text-muted">
                            Vol: ${(market.volume24h / 1000).toFixed(0)}k
                          </span>
                        </div>
                        <span
                          className="text-[8px] font-mono tracking-wider uppercase px-1 py-0.5 rounded-sm"
                          style={{
                            color: market.relevance === 'high' ? '#00E5FF' : '#504a60',
                            background: market.relevance === 'high' ? '#00E5FF12' : 'transparent',
                          }}
                        >
                          {market.relevance}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-text-muted text-xs font-mono">No market data available</div>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <div className="twa-app">
      {/* Status bar */}
      <div className="twa-statusbar">
        <div className="flex items-center gap-2">
          <span
            className="font-display text-base tracking-[0.2em]"
            style={{
              background: 'linear-gradient(135deg, #00B4D8, #00E5FF, #67EFFF)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            MAKORA
          </span>
          {sentiment && (
            <span
              className="text-[8px] font-mono tracking-wider uppercase px-1.5 py-0.5 rounded-sm"
              style={{
                color: sentiment.direction.includes('buy') ? '#22c55e' : sentiment.direction.includes('sell') ? '#ef4444' : '#00E5FF',
                background: sentiment.direction.includes('buy') ? '#22c55e10' : sentiment.direction.includes('sell') ? '#ef444410' : '#00E5FF10',
              }}
            >
              {sentiment.direction.replace('_', ' ')}
            </span>
          )}
          <a
            href="https://x.com/anon0mesh"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[8px] font-mono text-text-muted hover:text-cursed transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            @anon0mesh
          </a>
        </div>
        <div className="flex items-center gap-2">
          {walletAddress && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(walletAddress).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }).catch(() => { /* fallback: no clipboard API in some WebViews */ });
              }}
              className="text-[8px] font-mono text-text-muted active:text-cursed transition-colors"
              title="Tap to copy full address"
            >
              {copied ? 'Copied!' : (displayName || `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`)}
            </button>
          )}
          {!walletAddress && displayName && (
            <span className="text-[8px] font-mono text-text-muted">{displayName}</span>
          )}
          {authenticated && (
            <button
              onClick={() => logout()}
              className="text-[7px] font-mono text-text-muted/50 hover:text-cursed uppercase tracking-wider"
            >
              logout
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="twa-content">
        {renderTab()}
      </div>

      {/* Bottom tab bar */}
      <div className="twa-tabbar">
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="twa-tab"
              style={{
                color: isActive ? '#00E5FF' : '#504a60',
              }}
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              <span className="text-[8px] font-mono tracking-wider uppercase">{tab.label}</span>
              {isActive && <div className="twa-tab-indicator" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page wrapper ───────────────────────────────────────────────────────────

export default function TWAPage() {
  return (
    <Suspense fallback={
      <div className="twa-page flex items-center justify-center h-screen">
        <div className="text-cursed font-mono text-sm animate-pulse">Loading Makora...</div>
      </div>
    }>
      <TWAProviders>
        <TWADashboard />
      </TWAProviders>
    </Suspense>
  );
}
