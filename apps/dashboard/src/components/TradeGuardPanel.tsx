'use client';

import type { TradeGuardState, TradeGuardConfig, PositionEntry } from '@/hooks/useTradeGuard';

interface TradeGuardPanelProps {
  state: TradeGuardState;
  config: TradeGuardConfig;
}

export const TradeGuardPanel = ({ state, config }: TradeGuardPanelProps) => {
  const {
    sessionStartValue,
    currentValue,
    pnlSol,
    pnlPct,
    dailyLimitHalted,
    dailyTradeCount,
    trackedPositions,
    cooldowns,
  } = state;

  const isActive = sessionStartValue > 0;
  const pnlPositive = pnlSol >= 0;
  const lossProgress = Math.min(100, Math.abs(Math.min(0, pnlPct)) / config.maxDailyLossPct * 100);
  const tradeProgress = Math.min(100, (dailyTradeCount / config.maxDailyTrades) * 100);

  // Active cooldowns
  const now = Date.now();
  const activeCooldowns = Object.entries(cooldowns).filter(([, exp]) => exp > now);

  return (
    <div className="cursed-card p-5 animate-fade-up">
      <div className="flex items-center justify-between mb-4">
        <div className="section-title">Trade Guard</div>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              dailyLimitHalted
                ? 'bg-negative animate-pulse'
                : isActive
                  ? 'bg-positive animate-pulse'
                  : 'bg-text-muted/30'
            }`}
          />
          <span className={`text-[9px] font-mono tracking-[0.15em] uppercase ${
            dailyLimitHalted ? 'text-negative' : isActive ? 'text-positive' : 'text-text-muted'
          }`}>
            {dailyLimitHalted ? 'HALTED' : isActive ? 'ACTIVE' : 'IDLE'}
          </span>
        </div>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <div className="text-[9px] text-text-muted font-mono uppercase tracking-wider mb-1">
            Session P&L
          </div>
          <div className={`text-lg font-bold font-mono ${pnlPositive ? 'text-positive' : 'text-negative'}`}>
            {pnlPositive ? '+' : ''}{pnlSol.toFixed(4)}
          </div>
          <div className={`text-[9px] font-mono ${pnlPositive ? 'text-positive/70' : 'text-negative/70'}`}>
            {pnlPositive ? '+' : ''}{pnlPct.toFixed(2)}%
          </div>
        </div>
        <div>
          <div className="text-[9px] text-text-muted font-mono uppercase tracking-wider mb-1">
            Trades
          </div>
          <div className="text-lg font-bold font-mono text-text-primary">
            {dailyTradeCount}
            <span className="text-[10px] text-text-muted font-normal">/{config.maxDailyTrades}</span>
          </div>
        </div>
        <div>
          <div className="text-[9px] text-text-muted font-mono uppercase tracking-wider mb-1">
            Portfolio
          </div>
          <div className="text-lg font-bold font-mono text-text-primary">
            {currentValue.toFixed(4)}
          </div>
          <div className="text-[9px] font-mono text-text-muted">
            SOL
          </div>
        </div>
      </div>

      {/* Daily loss limit bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] font-mono text-text-muted uppercase tracking-wider">
            Daily Loss Limit
          </span>
          <span className={`text-[9px] font-mono ${dailyLimitHalted ? 'text-negative' : 'text-text-muted'}`}>
            {Math.abs(Math.min(0, pnlPct)).toFixed(1)}% / {config.maxDailyLossPct}%
          </span>
        </div>
        <div className="h-1.5 bg-bg-inner rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 rounded-full ${
              lossProgress > 80 ? 'bg-negative' : lossProgress > 50 ? 'bg-warning' : 'bg-positive'
            }`}
            style={{ width: `${lossProgress}%` }}
          />
        </div>
      </div>

      {/* Trade count bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] font-mono text-text-muted uppercase tracking-wider">
            Trade Count
          </span>
          <span className="text-[9px] font-mono text-text-muted">
            {dailyTradeCount}/{config.maxDailyTrades}
          </span>
        </div>
        <div className="h-1.5 bg-bg-inner rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 rounded-full ${
              tradeProgress > 80 ? 'bg-warning' : 'bg-cursed/60'
            }`}
            style={{ width: `${tradeProgress}%` }}
          />
        </div>
      </div>

      {/* Tracked positions */}
      <div className="space-y-1.5">
        <div className="text-[9px] text-text-muted font-mono uppercase tracking-wider">
          Tracked Positions ({trackedPositions.length})
        </div>

        {trackedPositions.length > 0 ? (
          trackedPositions.map((pos: PositionEntry) => {
            const isNearStop = pos.pnlPct < -(config.stopLossPct * 0.6);
            const isTriggered = pos.pnlPct < -config.stopLossPct;
            const pnlColor = pos.pnlPct >= 0 ? 'text-positive' : isTriggered ? 'text-negative' : isNearStop ? 'text-warning' : 'text-negative/70';
            const cooldownExp = cooldowns[pos.symbol];
            const onCooldown = cooldownExp && cooldownExp > now;

            return (
              <div
                key={pos.symbol}
                className={`bg-bg-inner border p-2.5 ${
                  isTriggered ? 'border-negative/30' : 'border-cursed/10'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold text-text-primary">
                      {pos.symbol}
                    </span>
                    {isTriggered && (
                      <span className="text-[8px] font-mono text-negative uppercase tracking-wider">
                        STOP-LOSS
                      </span>
                    )}
                    {onCooldown && (
                      <span className="text-[8px] font-mono text-text-muted uppercase tracking-wider">
                        CD {Math.ceil((cooldownExp - now) / 1000)}s
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] font-mono font-bold ${pnlColor}`}>
                    {pos.pnlPct >= 0 ? '+' : ''}{pos.pnlPct.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[9px] font-mono text-text-muted">
                    Entry: {pos.entryPriceSol.toFixed(4)} SOL
                  </span>
                  <span className="text-[9px] font-mono text-text-muted">
                    Now: {pos.currentValueSol.toFixed(4)} SOL
                  </span>
                </div>
                {/* Stop-loss proximity bar */}
                <div className="mt-1.5 h-1 bg-bg-inner rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      isTriggered ? 'bg-negative' : isNearStop ? 'bg-warning' : 'bg-cursed/40'
                    }`}
                    style={{
                      width: `${Math.min(100, Math.abs(Math.min(0, pos.pnlPct)) / config.stopLossPct * 100)}%`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-end mt-0.5">
                  <span className="text-[8px] font-mono text-text-muted/50">
                    stop @ -{config.stopLossPct}%
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center py-3">
            <div className="text-[10px] text-text-muted font-mono">
              No positions tracked yet
            </div>
            <div className="text-[9px] text-text-muted/60 font-mono mt-1">
              Positions appear after the agent executes trades
            </div>
          </div>
        )}
      </div>

      {/* Config summary */}
      <div className="ink-divider mt-4 mb-3" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <div className="flex justify-between">
          <span className="text-[8px] font-mono text-text-muted/50 uppercase">Stop-Loss</span>
          <span className="text-[8px] font-mono text-text-muted">{config.stopLossPct}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[8px] font-mono text-text-muted/50 uppercase">Min Trade</span>
          <span className="text-[8px] font-mono text-text-muted">{config.minTradeSizeSol} SOL</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[8px] font-mono text-text-muted/50 uppercase">Cooldown</span>
          <span className="text-[8px] font-mono text-text-muted">{Math.round(config.cooldownMs / 60000)}min</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[8px] font-mono text-text-muted/50 uppercase">Daily Limit</span>
          <span className="text-[8px] font-mono text-text-muted">{config.maxDailyLossPct}%</span>
        </div>
      </div>
    </div>
  );
};
