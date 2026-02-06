'use client';

import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useWallet } from '@solana/wallet-adapter-react';

export const ActivityFeed = () => {
  const { activities } = useActivityFeed();
  const { publicKey } = useWallet();

  const getStatusIndicator = (status: string) => {
    switch (status) {
      case 'success': return { color: 'bg-positive', border: 'border-positive/20' };
      case 'adapt': return { color: 'bg-cursed', border: 'border-cursed/20' };
      case 'shield': return { color: 'bg-shadow-purple', border: 'border-shadow-purple/20' };
      case 'warning': return { color: 'bg-caution', border: 'border-caution/20' };
      case 'error': return { color: 'bg-negative', border: 'border-negative/20' };
      default: return { color: 'bg-text-muted', border: 'border-text-muted/20' };
    }
  };

  return (
    <div className="cursed-card p-5 animate-fade-up h-full flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <div className="section-title">Activity</div>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 ${publicKey ? 'bg-positive animate-pulse' : 'bg-text-muted'}`} />
          <span className="text-[12px] md:text-[10px] font-mono text-text-muted tracking-wider uppercase">
            {publicKey ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
        {activities.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-[12px] md:text-[10px] text-text-muted font-mono tracking-wider text-center">
              {publicKey
                ? 'Waiting for first OODA cycle...'
                : 'Connect wallet to see live activity'}
            </div>
          </div>
        )}
        {activities.map((activity) => {
          const indicator = getStatusIndicator(activity.status);
          return (
            <div
              key={activity.id}
              className={`p-2.5 bg-bg-inner border ${indicator.border} transition-all hover:translate-x-0.5`}
            >
              <div className="flex items-start gap-2.5">
                <div className={`w-1.5 h-1.5 mt-1.5 flex-shrink-0 ${indicator.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-text-primary font-mono leading-relaxed">
                    {activity.action}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] md:text-[9px] text-text-muted font-mono">
                      {activity.time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    {activity.txSig && (
                      <a
                        href={`https://explorer.solana.com/tx/${activity.txSig}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] md:text-[9px] font-mono text-cursed/60 hover:text-cursed transition-colors"
                      >
                        {activity.txSig.slice(0, 8)}...
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
