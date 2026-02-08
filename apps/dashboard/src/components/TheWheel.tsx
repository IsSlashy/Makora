'use client';

import { useRef, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { OODAState, OODAPhase } from '@/hooks/useOODALoop';

const PHASES: { name: OODAPhase; kanji: string; desc: string }[] = [
  { name: 'OBSERVE', kanji: '観', desc: 'Reading on-chain portfolio state' },
  { name: 'ORIENT', kanji: '向', desc: 'Evaluating strategy & market context' },
  { name: 'DECIDE', kanji: '決', desc: 'Validating action against risk limits' },
  { name: 'ACT', kanji: '行', desc: 'Executing allocation decisions' },
];

const PHASE_INDEX_MAP: Record<string, number> = {
  OBSERVE: 0,
  ORIENT: 1,
  DECIDE: 2,
  ACT: 3,
};

interface TheWheelProps {
  oodaState: OODAState & { adaptations: number };
  sessionActive?: boolean;
  sessionPnlPct?: number;
  sessionPnlSol?: number;
  sessionTimeRemaining?: string;
  sessionStrategy?: string;
}

export const TheWheel = ({
  oodaState: ooda,
  sessionActive = false,
  sessionPnlPct,
  sessionPnlSol,
  sessionTimeRemaining,
  sessionStrategy,
}: TheWheelProps) => {
  const { publicKey } = useWallet();

  const activePhase = PHASE_INDEX_MAP[ooda.phase] ?? -1;
  const isAdapting = ooda.phase !== 'IDLE';
  const blendedApy = ooda.lastDecision?.blendedApy ?? 0;

  // Phase-locked rotation: wheel turns 90° on each OODA step
  const rotationRef = useRef(0);
  const prevPhaseRef = useRef<OODAPhase>('IDLE');
  const [rotation, setRotation] = useState(0);
  const [stepping, setStepping] = useState(false);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    const curr = ooda.phase;
    prevPhaseRef.current = curr;

    // Only rotate on actual phase transitions (not IDLE)
    if (curr === 'IDLE' || prev === curr) return;

    // Each forward step = +90°
    rotationRef.current += 90;
    setRotation(rotationRef.current);

    // Brief "stepping" state for the scale bump
    setStepping(true);
    const timer = setTimeout(() => setStepping(false), 400);
    return () => clearTimeout(timer);
  }, [ooda.phase]);

  // Subtitle logic
  const getSubtitle = () => {
    if (!publicKey) return 'Connect Wallet';
    if (sessionActive) return 'Session Active';
    if (isAdapting) return 'The Adaptive One';
    return 'Awaiting Mandate';
  };

  return (
    <div className="cursed-card p-4 flex flex-col items-center h-full relative overflow-hidden">
      {/* Kanji watermark */}
      <div className="kanji-watermark top-4 right-4">魔</div>

      {/* ── MAKORA title — pinned to top ── */}
      <div className="text-center mb-1">
        <h2
          className="font-display text-2xl lg:text-3xl tracking-[0.3em] leading-none"
          style={{
            background: 'linear-gradient(135deg, #6d28d9 0%, #8b5cf6 35%, #a78bfa 50%, #8b5cf6 65%, #6d28d9 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            filter: 'drop-shadow(0 0 20px rgba(139, 92, 246, 0.4))',
          }}
        >
          MAKORA
        </h2>
        <div
          className="text-[10px] md:text-[8px] tracking-[0.4em] uppercase mt-0.5 flex items-center justify-center gap-2"
          style={{
            background: 'linear-gradient(90deg, #4a4750, #8b5cf6 40%, #a78bfa 50%, #8b5cf6 60%, #4a4750)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {getSubtitle()}
          {sessionActive && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: '#8b5cf6' }}
            />
          )}
        </div>
      </div>

      {/* ── The Wheel — centered in remaining space ── */}
      <div className="flex-1 flex items-center justify-center w-full">
        <div className="relative w-44 h-44 sm:w-56 sm:h-56 lg:w-64 lg:h-64">
          {/* Outer glow ring */}
          <div
            className="absolute inset-[-16px] rounded-full transition-all duration-700"
            style={{
              background: `radial-gradient(circle, rgba(139, 92, 246, ${isAdapting || sessionActive ? 0.15 : 0.05}) 0%, transparent 70%)`,
            }}
          />

          {/* The actual Mahoraga wheel image — rotates 90° per OODA step */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              transform: `rotate(${rotation}deg) scale(${stepping ? 1.04 : 1})`,
              transition: 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            {/* Pulsing glow layer */}
            {(isAdapting || sessionActive) && (
              <div className="absolute inset-0 animate-wheel-pulse pointer-events-none" />
            )}
            <img
              src="/wheel.png"
              alt="Wheel of Adaptation"
              className="w-full h-full object-contain"
              style={{
                filter: 'invert(1) sepia(1) saturate(3) hue-rotate(230deg) brightness(0.85)',
                opacity: (!publicKey || (!sessionActive && !isAdapting)) ? 0.3 : 1,
                transition: 'opacity 0.5s',
              }}
            />
          </div>

          {/* OODA Phase indicators around the wheel */}
          {PHASES.map((phase, idx) => {
            const isActive = idx === activePhase;
            const angle = (idx * 90 - 90) * (Math.PI / 180);
            const radius = 58;
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
                  className={`flex flex-col items-center gap-0.5 transition-all duration-500 ${
                    isActive ? 'scale-110' : 'scale-90 opacity-30'
                  }`}
                >
                  <span
                    className="text-xl font-bold select-none"
                    style={{
                      color: isActive ? '#8b5cf6' : '#4a4750',
                      textShadow: isActive ? '0 0 20px rgba(139, 92, 246, 0.6)' : 'none',
                    }}
                  >
                    {phase.kanji}
                  </span>
                  <span
                    className="text-[10px] md:text-[8px] font-mono tracking-[0.15em] uppercase"
                    style={{ color: isActive ? '#8b5cf6' : '#4a4750' }}
                  >
                    {phase.name}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Session timer badge — near wheel when session is active */}
          {sessionActive && sessionTimeRemaining && (
            <div
              className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 text-[10px] font-mono tracking-wider text-cursed bg-bg-inner border border-cursed/30 rounded-sm"
            >
              {sessionTimeRemaining}
            </div>
          )}
        </div>
      </div>

      {/* ── Session P&L card (shown when session active or just completed) ── */}
      {sessionActive && sessionPnlSol !== undefined && (
        <div className="w-full max-w-xs mb-2">
          <div className="ink-divider mb-2" />
          <div className="flex items-center justify-between text-xs md:text-[10px] font-mono">
            <div>
              <div className="text-text-muted tracking-wider uppercase">Session P&L</div>
              <div className={`font-bold text-base ${(sessionPnlPct ?? 0) >= 0 ? 'text-positive' : 'text-negative'}`}>
                {(sessionPnlPct ?? 0) >= 0 ? '+' : ''}{(sessionPnlPct ?? 0).toFixed(2)}%
              </div>
            </div>
            <div className="w-px h-6 bg-cursed/20" />
            <div>
              <div className="text-text-muted tracking-wider uppercase">SOL</div>
              <div className={`font-bold text-base ${(sessionPnlSol ?? 0) >= 0 ? 'text-positive' : 'text-negative'}`}>
                {(sessionPnlSol ?? 0) >= 0 ? '+' : ''}{sessionPnlSol.toFixed(4)}
              </div>
            </div>
            <div className="w-px h-6 bg-cursed/20" />
            <div>
              <div className="text-text-muted tracking-wider uppercase">Strategy</div>
              <div className="font-bold text-base text-cursed capitalize">{sessionStrategy || '--'}</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Stats bar ── */}
      <div className="w-full max-w-xs">
        <div className="ink-divider mb-2" />
        <div className="flex items-center justify-between text-xs md:text-[10px] font-mono">
          <div className="text-center">
            <div className="text-text-muted tracking-wider uppercase mb-0.5">Cycles</div>
            <div className="text-cursed font-bold text-sm">{ooda.adaptations.toLocaleString()}</div>
          </div>
          <div className="w-px h-6 bg-cursed/20" />
          <div className="text-center">
            <div className="text-text-muted tracking-wider uppercase mb-0.5">Conf</div>
            <div className="text-cursed font-bold text-sm">
              {ooda.confidence > 0 ? `${ooda.confidence}%` : '--'}
            </div>
          </div>
          <div className="w-px h-6 bg-cursed/20" />
          <div className="text-center">
            <div className="text-text-muted tracking-wider uppercase mb-0.5">APY</div>
            <div className="text-cursed font-bold text-sm">
              {blendedApy > 0 ? `${blendedApy}%` : '--'}
            </div>
          </div>
          <div className="w-px h-6 bg-cursed/20" />
          <div className="text-center">
            <div className="text-text-muted tracking-wider uppercase mb-0.5">Phase</div>
            <div className="text-cursed font-bold text-sm">{ooda.phase}</div>
          </div>
        </div>
      </div>

      {/* ── Current phase description ── */}
      <div className="mt-2 text-center">
        <div className="text-[11px] md:text-[9px] text-text-muted font-mono tracking-wider">
          {ooda.phaseDescription}
        </div>
      </div>
    </div>
  );
};
