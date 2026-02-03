'use client';

import { useEffect, useState } from 'react';

type OODAPhase = 'OBSERVE' | 'ORIENT' | 'DECIDE' | 'ACT';

export const TheWheel = () => {
  const [activePhase, setActivePhase] = useState<OODAPhase>('OBSERVE');
  const [adaptationCount, setAdaptationCount] = useState(1247);
  const [confidence, setConfidence] = useState(94);

  useEffect(() => {
    const phases: OODAPhase[] = ['OBSERVE', 'ORIENT', 'DECIDE', 'ACT'];
    let currentIndex = 0;

    const interval = setInterval(() => {
      currentIndex = (currentIndex + 1) % 4;
      setActivePhase(phases[currentIndex]);

      // Simulate adaptation count and confidence changes
      if (currentIndex === 0) {
        setAdaptationCount(prev => prev + 1);
        setConfidence(92 + Math.floor(Math.random() * 7));
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const phases: { name: OODAPhase; color: string; position: number }[] = [
    { name: 'OBSERVE', color: '#10b981', position: 0 },
    { name: 'ORIENT', color: '#3b82f6', position: 90 },
    { name: 'DECIDE', color: '#f59e0b', position: 180 },
    { name: 'ACT', color: '#8b5cf6', position: 270 },
  ];

  return (
    <div className="glass-card p-8 flex flex-col items-center justify-center h-full">
      <div className="relative w-80 h-80">
        {/* Outer ring */}
        <svg className="absolute inset-0 animate-spin-slow" viewBox="0 0 200 200">
          <defs>
            <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.6" />
            </linearGradient>
          </defs>
          <circle
            cx="100"
            cy="100"
            r="85"
            fill="none"
            stroke="url(#ringGradient)"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
        </svg>

        {/* OODA phases */}
        <div className="absolute inset-0">
          {phases.map(({ name, color, position }) => {
            const isActive = activePhase === name;
            const angle = (position * Math.PI) / 180;
            const radius = 95;
            const x = 100 + radius * Math.cos(angle - Math.PI / 2);
            const y = 100 + radius * Math.sin(angle - Math.PI / 2);

            return (
              <div
                key={name}
                className="absolute transition-all duration-500"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div
                  className={`px-4 py-2 rounded-lg font-bold text-sm transition-all duration-500 ${
                    isActive
                      ? 'scale-110 shadow-lg'
                      : 'scale-90 opacity-40'
                  }`}
                  style={{
                    backgroundColor: isActive ? color : 'rgba(139, 92, 246, 0.1)',
                    color: isActive ? '#fff' : color,
                    boxShadow: isActive ? `0 0 20px ${color}` : 'none',
                  }}
                >
                  {name}
                </div>
              </div>
            );
          })}
        </div>

        {/* Center hub */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-5xl font-bold gradient-text mb-2">MAKORA</div>
            <div className="text-sm text-text-secondary mb-4">Yield Optimizer</div>
            <div className="flex gap-6 text-xs">
              <div>
                <div className="text-text-secondary">Adaptations</div>
                <div className="text-accent font-bold">{adaptationCount.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-text-secondary">Confidence</div>
                <div className="text-accent font-bold">{confidence}%</div>
              </div>
            </div>
          </div>
        </div>

        {/* Inner glow */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="w-32 h-32 rounded-full animate-pulse-glow"
            style={{
              background: 'radial-gradient(circle, rgba(139, 92, 246, 0.2) 0%, transparent 70%)',
            }}
          />
        </div>
      </div>

      {/* Status indicator */}
      <div className="mt-6 text-center">
        <div className="text-lg font-semibold text-accent-light">
          Active Phase: <span className="text-accent">{activePhase}</span>
        </div>
      </div>
    </div>
  );
};
