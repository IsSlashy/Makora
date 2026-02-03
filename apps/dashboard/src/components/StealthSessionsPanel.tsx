'use client';

import type { OODAState, SessionInfo } from '@/hooks/useOODALoop';

interface StealthSessionsPanelProps {
  oodaState: OODAState;
}

function formatTime(ms: number): string {
  if (ms <= 0) return '--:--';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'active': return 'text-positive';
    case 'trading': return 'text-cursed';
    case 'funding': return 'text-text-muted';
    case 'sweeping': return 'text-warning';
    case 'closed': return 'text-negative';
    default: return 'text-text-muted';
  }
}

export const StealthSessionsPanel = ({ oodaState }: StealthSessionsPanelProps) => {
  const { stealthSessions, totalInSession, stealthActive } = oodaState;
  const sessionCount = stealthSessions.length;

  return (
    <div className="cursed-card p-5 animate-fade-up">
      <div className="flex items-center justify-between mb-4">
        <div className="section-title">Stealth Sessions</div>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              stealthActive
                ? 'bg-positive animate-pulse'
                : 'bg-text-muted/30'
            }`}
          />
          <span className={`text-[9px] font-mono tracking-[0.15em] uppercase ${
            stealthActive ? 'text-positive' : 'text-text-muted'
          }`}>
            {stealthActive ? 'STEALTH MODE' : 'INACTIVE'}
          </span>
        </div>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <div className="text-[9px] text-text-muted font-mono uppercase tracking-wider mb-1">
            Active
          </div>
          <div className="text-lg font-bold font-mono text-text-primary">
            {sessionCount}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-text-muted font-mono uppercase tracking-wider mb-1">
            In Session
          </div>
          <div className="text-lg font-bold font-mono text-positive">
            {totalInSession.toFixed(4)}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-text-muted font-mono uppercase tracking-wider mb-1">
            Max Slots
          </div>
          <div className="text-lg font-bold font-mono text-text-primary">
            3
          </div>
        </div>
      </div>

      {/* Session slots */}
      <div className="space-y-2">
        {stealthSessions.length > 0 ? (
          stealthSessions.map((session: SessionInfo) => (
            <div
              key={session.id}
              className="bg-bg-inner border border-cursed/10 p-3"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    session.status === 'active' ? 'bg-positive' :
                    session.status === 'trading' ? 'bg-cursed animate-pulse' :
                    'bg-text-muted/30'
                  }`} />
                  <span className="text-[10px] font-mono text-text-primary">
                    {truncateAddress(session.walletAddress)}
                  </span>
                </div>
                <span className={`text-[9px] font-mono uppercase ${statusColor(session.status)}`}>
                  {session.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-text-muted">
                  {session.fundedAmount.toFixed(4)} SOL
                </span>
                <span className="text-[10px] font-mono text-text-muted">
                  {session.tradeCount} trades
                </span>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-4">
            <div className="text-[10px] text-text-muted font-mono">
              No active sessions
            </div>
            <div className="text-[9px] text-text-muted/60 font-mono mt-1">
              Sessions activate when vault is in Auto mode
            </div>
          </div>
        )}

        {/* Empty slots */}
        {Array.from({ length: Math.max(0, 3 - sessionCount) }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="bg-bg-inner/50 border border-dashed border-cursed/8 p-3"
          >
            <div className="flex items-center justify-center">
              <span className="text-[9px] font-mono text-text-muted/30 uppercase tracking-wider">
                Slot {sessionCount + i + 1} — Available
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="ink-divider mt-4 mb-3" />

      {/* Session rotation info */}
      <div className="text-[9px] font-mono text-text-muted/60 leading-relaxed">
        Ephemeral wallets rotate every 8-12 min. Funds split across 2-3 wallets
        with randomized amounts to break on-chain traceability.
      </div>
    </div>
  );
};
