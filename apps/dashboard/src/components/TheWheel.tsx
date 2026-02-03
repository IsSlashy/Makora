'use client';

import { useEffect, useState } from 'react';

type OODAPhase = 'OBSERVE' | 'ORIENT' | 'DECIDE' | 'ACT';

const PHASES: { name: OODAPhase; kanji: string; desc: string }[] = [
  { name: 'OBSERVE', kanji: '観', desc: 'Market data ingestion' },
  { name: 'ORIENT', kanji: '向', desc: 'Pattern analysis' },
  { name: 'DECIDE', kanji: '決', desc: 'Strategy selection' },
  { name: 'ACT', kanji: '行', desc: 'Transaction execution' },
];

export const TheWheel = () => {
  const [activePhase, setActivePhase] = useState(0);
  const [adaptations, setAdaptations] = useState(1247);
  const [confidence, setConfidence] = useState(94);
  const [isAdapting, setIsAdapting] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsAdapting(true);
      setTimeout(() => setIsAdapting(false), 600);

      setActivePhase(prev => {
        const next = (prev + 1) % 4;
        if (next === 0) {
          setAdaptations(a => a + 1);
          setConfidence(92 + Math.floor(Math.random() * 7));
        }
        return next;
      });
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="cursed-card p-6 flex flex-col items-center justify-center h-full min-h-[500px] relative">
      {/* Kanji watermark */}
      <div className="kanji-watermark top-4 right-4">魔</div>

      {/* The Wheel */}
      <div className="relative w-72 h-72 lg:w-80 lg:h-80">
        {/* Outer glow ring */}
        <div
          className="absolute inset-[-20px] rounded-full transition-all duration-700"
          style={{
            background: `radial-gradient(circle, rgba(212, 168, 41, ${isAdapting ? 0.15 : 0.05}) 0%, transparent 70%)`,
          }}
        />

        {/* The actual Mahoraga wheel image */}
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            src="/wheel.png"
            alt="Wheel of Adaptation"
            className="w-full h-full object-contain animate-wheel-spin animate-wheel-pulse"
            style={{
              filter: 'invert(1) sepia(1) saturate(2) hue-rotate(10deg) brightness(0.9)',
            }}
          />
        </div>

        {/* OODA Phase indicators around the wheel */}
        {PHASES.map((phase, idx) => {
          const isActive = idx === activePhase;
          const angle = (idx * 90 - 90) * (Math.PI / 180);
          const radius = 52;
          const x = 50 + radius * Math.cos(angle);
          const y = 50 + radius * Math.sin(angle);

          return (
            <div
              key={phase.name}
              className="absolute transition-all duration-500"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div
                className={`flex flex-col items-center gap-1 transition-all duration-500 ${
                  isActive ? 'scale-110' : 'scale-90 opacity-30'
                }`}
              >
                <span
                  className="text-2xl font-bold select-none"
                  style={{
                    color: isActive ? '#d4a829' : '#4a4740',
                    textShadow: isActive ? '0 0 20px rgba(212, 168, 41, 0.6)' : 'none',
                  }}
                >
                  {phase.kanji}
                </span>
                <span
                  className="text-[9px] font-mono tracking-[0.2em] uppercase"
                  style={{ color: isActive ? '#d4a829' : '#4a4740' }}
                >
                  {phase.name}
                </span>
              </div>
            </div>
          );
        })}

        {/* Center info */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center z-10">
            <div className="font-display text-3xl tracking-[0.25em] text-cursed-gradient mb-1">
              MAKORA
            </div>
            <div className="text-[9px] text-text-muted tracking-[0.3em] uppercase mb-3">
              The Adaptive One
            </div>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="mt-8 w-full max-w-sm">
        <div className="ink-divider mb-4" />
        <div className="flex items-center justify-between text-[11px] font-mono">
          <div>
            <div className="text-text-muted tracking-wider uppercase mb-1">Adaptations</div>
            <div className="text-cursed font-bold text-lg">{adaptations.toLocaleString()}</div>
          </div>
          <div className="w-px h-8 bg-cursed/20" />
          <div>
            <div className="text-text-muted tracking-wider uppercase mb-1">Confidence</div>
            <div className="text-cursed font-bold text-lg">{confidence}%</div>
          </div>
          <div className="w-px h-8 bg-cursed/20" />
          <div>
            <div className="text-text-muted tracking-wider uppercase mb-1">Phase</div>
            <div className="text-cursed font-bold text-lg">{PHASES[activePhase].name}</div>
          </div>
        </div>
      </div>

      {/* Current phase description */}
      <div className="mt-4 text-center">
        <div className="text-[10px] text-text-muted font-mono tracking-wider">
          {PHASES[activePhase].desc}
        </div>
      </div>
    </div>
  );
};
