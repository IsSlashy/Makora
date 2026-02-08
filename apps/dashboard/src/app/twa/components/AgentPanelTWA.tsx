'use client';

import { useEffect, useState, useCallback } from 'react';

type AgentPhase = 'IDLE' | 'OBSERVE' | 'ORIENT' | 'DECIDE' | 'ACT';

interface AgentAction {
  timestamp: number;
  phase: AgentPhase;
  description: string;
  tool?: string;
  result?: string;
}

interface AgentStatusData {
  phase: AgentPhase;
  phaseDescription: string;
  lastUpdate: number;
  cycleCount: number;
  confidence: number;
  sentiment?: string;
  actions: AgentAction[];
}

const PHASE_COLORS: Record<AgentPhase, string> = {
  IDLE: '#504a60',
  OBSERVE: '#8b5cf6',
  ORIENT: '#a78bfa',
  DECIDE: '#6d28d9',
  ACT: '#22c55e',
};

const PHASE_KANJI: Record<AgentPhase, string> = {
  IDLE: '待',
  OBSERVE: '観',
  ORIENT: '向',
  DECIDE: '決',
  ACT: '行',
};

function timeAgo(ts: number): string {
  if (!ts) return '--';
  const diff = Date.now() - ts;
  if (diff < 5000) return 'now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

export function AgentPanelTWA() {
  const [status, setStatus] = useState<AgentStatusData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/status');
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (loading) {
    return (
      <div className="cursed-card p-4">
        <div className="section-title mb-3">AGENT STATUS</div>
        <div className="text-text-muted text-xs font-mono animate-pulse">Connecting to agent...</div>
      </div>
    );
  }

  const phase = status?.phase ?? 'IDLE';
  const isActive = phase !== 'IDLE';
  const phaseColor = PHASE_COLORS[phase];

  return (
    <div className="space-y-3">
      {/* Current Phase */}
      <div className="cursed-card p-4">
        <div className="section-title mb-3">AGENT STATUS</div>

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span
              className="text-4xl font-bold select-none"
              style={{ color: phaseColor, textShadow: isActive ? `0 0 20px ${phaseColor}60` : 'none' }}
            >
              {PHASE_KANJI[phase]}
            </span>
            <div>
              <div
                className="text-sm font-mono font-bold tracking-wider uppercase"
                style={{ color: phaseColor }}
              >
                {phase}
              </div>
              <div className="text-[10px] font-mono text-text-muted mt-0.5">
                {status?.phaseDescription || 'Waiting for bot activity'}
              </div>
            </div>
          </div>
          {isActive && (
            <span
              className="inline-block w-2.5 h-2.5 rounded-full animate-pulse"
              style={{ background: phaseColor }}
            />
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between text-xs font-mono">
          <div className="text-center flex-1">
            <div className="text-[8px] text-text-muted tracking-wider uppercase mb-0.5">Cycles</div>
            <div className="text-cursed font-bold">{status?.cycleCount ?? 0}</div>
          </div>
          <div className="w-px h-5 bg-cursed/15" />
          <div className="text-center flex-1">
            <div className="text-[8px] text-text-muted tracking-wider uppercase mb-0.5">Confidence</div>
            <div className="text-cursed font-bold">{status?.confidence ? `${status.confidence}%` : '--'}</div>
          </div>
          <div className="w-px h-5 bg-cursed/15" />
          <div className="text-center flex-1">
            <div className="text-[8px] text-text-muted tracking-wider uppercase mb-0.5">Last Update</div>
            <div className="text-cursed font-bold">{timeAgo(status?.lastUpdate ?? 0)}</div>
          </div>
        </div>
      </div>

      {/* OODA Pipeline */}
      <div className="cursed-card p-4">
        <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider mb-3">OODA Pipeline</div>
        <div className="flex items-center justify-between gap-1">
          {(['OBSERVE', 'ORIENT', 'DECIDE', 'ACT'] as AgentPhase[]).map((p, i) => {
            const isCurrent = phase === p;
            const isPast = isActive && ['OBSERVE', 'ORIENT', 'DECIDE', 'ACT'].indexOf(phase) > i;
            const color = PHASE_COLORS[p];

            return (
              <div key={p} className="flex items-center flex-1">
                <div className="flex-1 flex flex-col items-center gap-1">
                  <span
                    className="text-lg font-bold select-none transition-all duration-300"
                    style={{
                      color: isCurrent ? color : isPast ? `${color}80` : '#2a2530',
                      textShadow: isCurrent ? `0 0 12px ${color}60` : 'none',
                      transform: isCurrent ? 'scale(1.2)' : 'scale(1)',
                    }}
                  >
                    {PHASE_KANJI[p]}
                  </span>
                  <span
                    className="text-[7px] font-mono tracking-wider uppercase"
                    style={{ color: isCurrent ? color : isPast ? `${color}80` : '#2a2530' }}
                  >
                    {p}
                  </span>
                </div>
                {i < 3 && (
                  <div
                    className="w-3 h-px mx-0.5"
                    style={{ background: isPast ? `${PHASE_COLORS[(['OBSERVE', 'ORIENT', 'DECIDE', 'ACT'] as AgentPhase[])[i + 1]]}40` : '#1a1520' }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Actions */}
      <div className="cursed-card p-4">
        <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider mb-3">Recent Actions</div>
        {status?.actions && status.actions.length > 0 ? (
          <div className="space-y-1.5">
            {[...status.actions].reverse().slice(0, 10).map((action, i) => (
              <div key={i} className="flex items-start gap-2 py-1 border-t border-cursed/5 first:border-0">
                <span
                  className="text-[8px] font-mono font-bold tracking-wider uppercase px-1 py-0.5 rounded-sm shrink-0 mt-0.5"
                  style={{
                    color: PHASE_COLORS[action.phase],
                    background: `${PHASE_COLORS[action.phase]}12`,
                  }}
                >
                  {action.phase}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-mono text-text-primary truncate">
                    {action.description}
                  </div>
                  {action.tool && (
                    <span className="text-[8px] font-mono text-text-muted">
                      tool: {action.tool}
                    </span>
                  )}
                </div>
                <span className="text-[8px] font-mono text-text-muted shrink-0">
                  {timeAgo(action.timestamp)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-text-muted text-xs font-mono">
            No actions yet — send a message to the bot in Telegram to see live activity here.
          </div>
        )}
      </div>
    </div>
  );
}
