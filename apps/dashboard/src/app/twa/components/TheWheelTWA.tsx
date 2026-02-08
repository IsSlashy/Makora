'use client';

import { useRef, useEffect, useState } from 'react';

type OODAPhase = 'IDLE' | 'OBSERVE' | 'ORIENT' | 'DECIDE' | 'ACT';

const PHASES: { name: OODAPhase; kanji: string }[] = [
  { name: 'OBSERVE', kanji: '観' },
  { name: 'ORIENT', kanji: '向' },
  { name: 'DECIDE', kanji: '決' },
  { name: 'ACT', kanji: '行' },
];

interface TheWheelTWAProps {
  walletAddress: string;
  positionCount: number;
  sentimentDirection?: string;
  sentimentScore?: number;
  /** Incremented each time new data arrives — triggers a 90° rotation */
  decisionTick: number;
  totalValueSol: number;
}

export const TheWheelTWA = ({
  walletAddress,
  positionCount,
  sentimentDirection,
  sentimentScore,
  decisionTick,
  totalValueSol,
}: TheWheelTWAProps) => {
  const [rotation, setRotation] = useState(0);
  const [stepping, setStepping] = useState(false);
  const prevTickRef = useRef(decisionTick);
  const rotationRef = useRef(0);

  // Rotate 90° only when decisionTick changes (= new data / bot decision)
  useEffect(() => {
    if (decisionTick === prevTickRef.current) return;
    prevTickRef.current = decisionTick;

    rotationRef.current += 90;
    setRotation(rotationRef.current);
    setStepping(true);
    const t = setTimeout(() => setStepping(false), 500);
    return () => clearTimeout(t);
  }, [decisionTick]);

  // Derive active OODA phase from tick (cycles through 0-3)
  const activePhase = decisionTick > 0 ? decisionTick % 4 : -1;
  const isActive = !!walletAddress;

  return (
    <div className="flex flex-col items-center relative px-4 pt-6 pb-4">
      {/* Kanji watermark */}
      <div className="kanji-watermark top-0 right-2" style={{ fontSize: '7rem', opacity: 0.02 }}>魔</div>

      {/* MAKORA title */}
      <h2
        className="font-display text-3xl tracking-[0.3em] leading-none mb-1"
        style={{
          background: 'linear-gradient(135deg, #00B4D8 0%, #00E5FF 35%, #67EFFF 50%, #00E5FF 65%, #00B4D8 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          filter: 'drop-shadow(0 0 20px rgba(0, 229, 255, 0.4))',
        }}
      >
        MAKORA
      </h2>
      <div
        className="text-[9px] tracking-[0.5em] uppercase mb-4"
        style={{
          background: 'linear-gradient(90deg, #4a4750, #00E5FF 40%, #67EFFF 50%, #00E5FF 60%, #4a4750)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        {sentimentDirection ? sentimentDirection.replace('_', ' ') : 'the adaptive one'}
      </div>

      {/* Wheel */}
      <div className="relative w-44 h-44">
        {/* Glow ring */}
        <div
          className="absolute inset-[-20px] rounded-full"
          style={{
            background: `radial-gradient(circle, rgba(0, 229, 255, ${stepping ? 0.25 : isActive ? 0.1 : 0.03}) 0%, transparent 70%)`,
            transition: 'background 0.5s',
          }}
        />

        {/* Wheel image — only rotates on decision */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            transform: `rotate(${rotation}deg) scale(${stepping ? 1.06 : 1})`,
            transition: 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          <img
            src="/wheel.png"
            alt="Wheel"
            className="w-full h-full object-contain"
            style={{
              filter: 'invert(1) sepia(1) saturate(3) hue-rotate(160deg) brightness(0.85)',
              opacity: isActive && decisionTick > 0 ? 1 : 0.25,
              transition: 'opacity 0.5s',
            }}
          />
        </div>

        {/* OODA Phase indicators */}
        {PHASES.map((phase, idx) => {
          const isPhaseActive = idx === activePhase;
          const angle = (idx * 90 - 90) * (Math.PI / 180);
          const r = 58;
          const x = 50 + r * Math.cos(angle);
          const y = 50 + r * Math.sin(angle);

          return (
            <div
              key={phase.name}
              className="absolute transition-all duration-500"
              style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
            >
              <div className={`flex flex-col items-center gap-0.5 transition-all duration-500 ${isPhaseActive ? 'scale-110' : 'scale-90 opacity-25'}`}>
                <span
                  className="text-lg font-bold select-none"
                  style={{ color: isPhaseActive ? '#00E5FF' : '#3a3540', textShadow: isPhaseActive ? '0 0 20px rgba(0, 229, 255, 0.6)' : 'none' }}
                >
                  {phase.kanji}
                </span>
                <span
                  className="text-[8px] font-mono tracking-[0.15em] uppercase"
                  style={{ color: isPhaseActive ? '#00E5FF' : '#3a3540' }}
                >
                  {phase.name}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick stats row */}
      <div className="w-full max-w-xs mt-4">
        <div className="ink-divider mb-2" />
        <div className="flex items-center justify-between text-xs font-mono">
          <div className="text-center flex-1">
            <div className="text-[8px] text-text-muted tracking-wider uppercase mb-0.5">Portfolio</div>
            <div className="text-cursed font-bold">{totalValueSol > 0 ? `${totalValueSol.toFixed(2)} SOL` : '--'}</div>
          </div>
          <div className="w-px h-5 bg-cursed/15" />
          <div className="text-center flex-1">
            <div className="text-[8px] text-text-muted tracking-wider uppercase mb-0.5">Score</div>
            <div className="font-bold" style={{ color: (sentimentScore ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>
              {sentimentScore !== undefined ? `${sentimentScore >= 0 ? '+' : ''}${sentimentScore}` : '--'}
            </div>
          </div>
          <div className="w-px h-5 bg-cursed/15" />
          <div className="text-center flex-1">
            <div className="text-[8px] text-text-muted tracking-wider uppercase mb-0.5">Positions</div>
            <div className="text-cursed font-bold">{positionCount}</div>
          </div>
          <div className="w-px h-5 bg-cursed/15" />
          <div className="text-center flex-1">
            <div className="text-[8px] text-text-muted tracking-wider uppercase mb-0.5">Cycles</div>
            <div className="text-cursed font-bold">{decisionTick}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
