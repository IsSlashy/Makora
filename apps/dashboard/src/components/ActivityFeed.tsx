'use client';

import { useEffect, useState } from 'react';

interface Activity {
  id: string;
  time: string;
  action: string;
  status: 'success' | 'info' | 'warning';
  icon: string;
}

export const ActivityFeed = () => {
  const [activities, setActivities] = useState<Activity[]>([
    {
      id: '1',
      time: new Date(Date.now() - 5 * 60000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      action: 'Swapped 10 SOL → 245.3 USDC via Jupiter',
      status: 'success',
      icon: '✓',
    },
    {
      id: '2',
      time: new Date(Date.now() - 10 * 60000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      action: 'Risk check: Position size OK (15% < 20%)',
      status: 'success',
      icon: '✓',
    },
    {
      id: '3',
      time: new Date(Date.now() - 12 * 60000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      action: 'Strategy adapted: Yield → Rebalance',
      status: 'info',
      icon: '⟳',
    },
    {
      id: '4',
      time: new Date(Date.now() - 17 * 60000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      action: 'Shielded 5 SOL (ZK proof verified)',
      status: 'success',
      icon: '🔒',
    },
    {
      id: '5',
      time: new Date(Date.now() - 23 * 60000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      action: 'Deposited 20 SOL to Marinade (7.2% APY)',
      status: 'success',
      icon: '✓',
    },
    {
      id: '6',
      time: new Date(Date.now() - 28 * 60000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      action: 'Market analysis: Volatility increased to 32%',
      status: 'warning',
      icon: '⚠',
    },
  ]);

  useEffect(() => {
    // Simulate new activities
    const interval = setInterval(() => {
      const newActivity: Activity = {
        id: Date.now().toString(),
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        action: getRandomAction(),
        status: 'success',
        icon: '✓',
      };

      setActivities(prev => [newActivity, ...prev].slice(0, 10));
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  const getRandomAction = () => {
    const actions = [
      'Portfolio rebalanced successfully',
      'Collected 0.45 SOL from Marinade rewards',
      'Risk parameters validated',
      'Market data refreshed',
      'Strategy confidence updated to 96%',
    ];
    return actions[Math.floor(Math.random() * actions.length)];
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'bg-green-500/20 text-green-500 border-green-500/30';
      case 'info': return 'bg-blue-500/20 text-blue-500 border-blue-500/30';
      case 'warning': return 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30';
      default: return 'bg-gray-500/20 text-gray-500 border-gray-500/30';
    }
  };

  return (
    <div className="glass-card p-6 animate-fade-in h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-text-primary">Activity Feed</h2>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <span>Live</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
        {activities.map((activity) => (
          <div
            key={activity.id}
            className={`p-3 rounded-lg border transition-all hover:scale-[1.02] ${getStatusColor(activity.status)}`}
          >
            <div className="flex items-start gap-3">
              <span className="text-lg flex-shrink-0 mt-0.5">{activity.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary mb-1">{activity.action}</div>
                <div className="text-xs text-text-secondary">{activity.time}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: var(--bg-secondary);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: var(--accent);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: var(--accent-light);
        }
      `}</style>
    </div>
  );
};
