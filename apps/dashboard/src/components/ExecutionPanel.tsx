'use client';

import type { ExecutionResultEntry, PositionSnapshotData } from '@/hooks/useOODALoop';
import type { useTradeGuard } from '@/hooks/useTradeGuard';

interface ExecutionPanelProps {
  executionResults: ExecutionResultEntry[];
  positionSnapshot: PositionSnapshotData | null;
  isAutoMode: boolean;
  confidence: number;
  tradeGuard?: ReturnType<typeof useTradeGuard>;
}

export const ExecutionPanel = ({
  executionResults,
  positionSnapshot,
  isAutoMode,
  confidence,
  tradeGuard,
}: ExecutionPanelProps) => {
  const successCount = executionResults.filter(r => r.success && !r.simulated).length;
  const simulatedCount = executionResults.filter(r => r.success && r.simulated).length;
  const failedCount = executionResults.filter(r => !r.success).length;
  const vetoedCount = executionResults.filter(r => !r.riskAssessment.approved).length;

  const gs = tradeGuard?.state;
  const gc = tradeGuard?.config;

  // HARDCODED devnet for hackathon
  const explorerCluster = '?cluster=devnet';

  return (
    <div className="cursed-card p-5 animate-fade-up h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="section-title">Execution Engine</div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 text-[9px] font-mono tracking-wider uppercase ${
            isAutoMode ? 'text-positive' : 'text-text-muted'
          }`}>
            <span className={`w-1.5 h-1.5 ${isAutoMode ? 'bg-positive animate-pulse' : 'bg-text-muted'}`} />
            {isAutoMode ? 'AUTO' : 'ADVISORY'}
          </span>
          <span className="text-[9px] font-mono text-text-muted tracking-wider">
            {confidence}% CONF
          </span>
        </div>
      </div>

      {/* Trade Guard P&L Banner */}
      {gs && gs.sessionStartValue > 0 && (
        <div className={`mb-3 p-2.5 border ${
          gs.dailyLimitHalted
            ? 'bg-negative/8 border-negative/30'
            : gs.pnlPct >= 0
              ? 'bg-positive/5 border-positive/15'
              : 'bg-caution/5 border-caution/15'
        }`}>
          <div className="flex items-center justify-between">
            <div className="text-[9px] font-mono tracking-[0.15em] uppercase text-text-muted">Session P&L</div>
            <div className={`text-[12px] font-mono font-bold ${
              gs.pnlPct >= 0 ? 'text-positive' : gs.pnlPct > -(gc?.maxDailyLossPct ?? 10) ? 'text-caution' : 'text-negative'
            }`}>
              {gs.pnlPct >= 0 ? '+' : ''}{gs.pnlPct.toFixed(2)}% ({gs.pnlSol >= 0 ? '+' : ''}{gs.pnlSol.toFixed(4)} SOL)
            </div>
          </div>
          <div className="flex items-center justify-between mt-1">
            <div className="text-[8px] font-mono text-text-muted">
              Start: {gs.sessionStartValue.toFixed(4)} SOL | Now: {gs.currentValue.toFixed(4)} SOL
            </div>
            <div className="text-[8px] font-mono text-text-muted">
              Trades: {gs.dailyTradeCount}/{gc?.maxDailyTrades ?? 20}
            </div>
          </div>
          {gs.dailyLimitHalted && (
            <div className="mt-1.5 text-[9px] font-mono text-negative font-bold tracking-wider animate-pulse">
              DAILY LOSS LIMIT HIT — EXECUTION HALTED
            </div>
          )}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className="bg-bg-inner border border-positive/15 p-2.5 text-center">
          <div className="text-[18px] font-mono text-positive font-bold">{successCount}</div>
          <div className="text-[8px] font-mono text-text-muted tracking-[0.2em] uppercase mt-0.5">Executed</div>
        </div>
        <div className="bg-bg-inner border border-cursed/15 p-2.5 text-center">
          <div className="text-[18px] font-mono text-cursed font-bold">{simulatedCount}</div>
          <div className="text-[8px] font-mono text-text-muted tracking-[0.2em] uppercase mt-0.5">Simulated</div>
        </div>
        <div className="bg-bg-inner border border-negative/15 p-2.5 text-center">
          <div className="text-[18px] font-mono text-negative font-bold">{failedCount}</div>
          <div className="text-[8px] font-mono text-text-muted tracking-[0.2em] uppercase mt-0.5">Failed</div>
        </div>
        <div className="bg-bg-inner border border-caution/15 p-2.5 text-center">
          <div className="text-[18px] font-mono text-caution font-bold">{vetoedCount}</div>
          <div className="text-[8px] font-mono text-text-muted tracking-[0.2em] uppercase mt-0.5">Vetoed</div>
        </div>
      </div>

      {/* Current positions */}
      {positionSnapshot && positionSnapshot.positions.length > 0 && (
        <div className="mb-4">
          <div className="text-[9px] font-mono text-cursed tracking-[0.2em] uppercase mb-2 font-bold">
            Current Positions
          </div>
          <div className="space-y-1">
            {positionSnapshot.positions.map((pos) => {
              // Show stop-loss P&L if tracked
              const tracked = gs?.trackedPositions?.find(tp => tp.symbol === pos.symbol);
              return (
                <div key={pos.mint} className="flex items-center justify-between bg-bg-inner border border-cursed/8 px-2.5 py-1.5">
                  <span className="text-[10px] font-mono text-text-primary font-bold">{pos.symbol}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-text-secondary">{pos.uiAmount.toFixed(4)}</span>
                    {tracked && tracked.symbol !== 'SOL' && (
                      <span className={`text-[9px] font-mono ${
                        tracked.pnlPct >= 0 ? 'text-positive' : tracked.pnlPct > -(gc?.stopLossPct ?? 8) ? 'text-caution' : 'text-negative'
                      }`}>
                        {tracked.pnlPct >= 0 ? '+' : ''}{tracked.pnlPct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {positionSnapshot.allocation.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {positionSnapshot.allocation.map((a) => (
                <span key={a.symbol} className="text-[9px] font-mono bg-cursed/8 border border-cursed/15 px-2 py-0.5 text-text-secondary">
                  {a.symbol} {a.pct}%
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Execution results */}
      <div className="text-[9px] font-mono text-cursed tracking-[0.2em] uppercase mb-2 font-bold">
        Last Execution Results
      </div>
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
        {executionResults.length === 0 && (
          <div className="flex items-center justify-center h-24">
            <div className="text-[10px] text-text-muted font-mono tracking-wider text-center">
              {isAutoMode
                ? 'Waiting for next execution cycle...'
                : 'Switch to Auto mode to enable autonomous execution'}
            </div>
          </div>
        )}

        {executionResults.map((result, idx) => {
          const riskColor = result.riskAssessment.approved
            ? result.riskAssessment.riskScore > 50 ? 'text-caution' : 'text-positive'
            : 'text-negative';
          const statusColor = result.success ? 'border-positive/20' : 'border-negative/20';
          const statusDot = result.success ? 'bg-positive' : 'bg-negative';

          return (
            <div key={idx} className={`p-2.5 bg-bg-inner border ${statusColor} transition-all hover:translate-x-0.5`}>
              <div className="flex items-start gap-2">
                <div className={`w-1.5 h-1.5 mt-1.5 flex-shrink-0 ${statusDot}`} />
                <div className="flex-1 min-w-0">
                  {/* Action description */}
                  <div className="text-[10px] text-text-primary font-mono leading-relaxed truncate">
                    {result.action}
                  </div>

                  {/* Protocol + risk + simulated badge */}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[9px] font-mono text-text-muted uppercase">{result.protocol}</span>
                    <span className={`text-[9px] font-mono ${riskColor}`}>
                      Risk: {result.riskAssessment.riskScore}/100
                    </span>
                    {result.simulated && (
                      <span className="text-[8px] font-mono tracking-wider px-1.5 py-0.5 bg-caution/10 border border-caution/20 text-caution uppercase">
                        SIM
                      </span>
                    )}
                  </div>

                  {/* Quote info */}
                  {result.quote && (
                    <div className="text-[9px] font-mono text-text-muted mt-0.5">
                      In: {result.quote.inputAmount} | Out: {result.quote.expectedOutput}
                      {result.quote.priceImpactPct > 0 && (
                        <span className={result.quote.priceImpactPct > 1 ? 'text-caution' : ''}>
                          {' '}| Impact: {result.quote.priceImpactPct.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  )}

                  {/* Error */}
                  {result.error && (
                    <div className="text-[9px] font-mono text-negative/80 mt-0.5 truncate">
                      {result.error}
                    </div>
                  )}

                  {/* Tx signature with Explorer link */}
                  {result.signature && (
                    <a
                      href={`https://explorer.solana.com/tx/${result.signature}${explorerCluster}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[9px] font-mono text-cursed/60 hover:text-cursed transition-colors mt-0.5 inline-block"
                    >
                      TX: {result.signature.slice(0, 16)}...
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
