'use client';

import { useEffect, useState } from 'react';

interface Activity {
  id: string;
  time: string;
  action: string;
  status: 'success' | 'adapt' | 'warning' | 'shield';
}

const INITIAL_ACTIVITIES: Omit<Activity, 'time'>[] = [
  { id: '1', action: 'Swapped 10 SOL to 245.3 USDC via Jupiter', status: 'success' },
  { id: '2', action: 'Risk check passed: position 15% < limit 20%', status: 'success' },
  { id: '3', action: 'Wheel turned: adapted strategy Yield to Rebalance', status: 'adapt' },
  { id: '4', action: 'Shielded 5 SOL into privacy pool (ZK verified)', status: 'shield' },
  { id: '5', action: 'Staked 20 SOL to Marinade at 7.2% APY', status: 'success' },
  { id: '6', action: 'Volatility spike detected: 32% — adjusting limits', status: 'warning' },
];

export const ActivityFeed = () => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const offsets = [5, 10, 12, 17, 23, 28];
    setActivities(INITIAL_ACTIVITIES.map((a, i) => ({
      ...a,
      time: new Date(Date.now() - offsets[i] * 60000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    })));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const actions = [
        { action: 'Portfolio rebalanced successfully', status: 'success' as const },
        { action: 'Wheel turned: new adaptation cycle complete', status: 'adapt' as const },
        { action: 'Collected 0.45 SOL from Marinade rewards', status: 'success' as const },
        { action: 'Strategy confidence updated to 96%', status: 'adapt' as const },
      ];
      const pick = actions[Math.floor(Math.random() * actions.length)];

      setActivities(prev => [{
        id: Date.now().toString(),
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        ...pick,
      }, ...prev].slice(0, 10));
    }, 12000);
    return () => clearInterval(interval);
  }, []);

  const getStatusIndicator = (status: string) => {
    switch (status) {
      case 'success': return { color: 'bg-positive', border: 'border-positive/20' };
      case 'adapt': return { color: 'bg-cursed', border: 'border-cursed/20' };
      case 'shield': return { color: 'bg-shadow-purple', border: 'border-shadow-purple/20' };
      case 'warning': return { color: 'bg-caution', border: 'border-caution/20' };
      default: return { color: 'bg-text-muted', border: 'border-text-muted/20' };
    }
  };

  return (
    <div className="cursed-card p-5 animate-fade-up h-full flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <div className="section-title">Activity</div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 bg-positive animate-pulse" />
          <span className="text-[10px] font-mono text-text-muted tracking-wider uppercase">Live</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
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
                  <div className="text-[11px] text-text-primary font-mono leading-relaxed">{activity.action}</div>
                  <div className="text-[9px] text-text-muted font-mono mt-0.5">{activity.time}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
