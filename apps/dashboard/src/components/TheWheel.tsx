'use client';

import { useRef, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { OODAState, OODAPhase } from '@/hooks/useOODALoop';

const PHASES: { name: OODAPhase; kanji: string }[] = [
  { name: 'OBSERVE', kanji: '観' },
  { name: 'ORIENT', kanji: '向' },
  { name: 'DECIDE', kanji: '決' },
  { name: 'ACT', kanji: '行' },
];

const PHASE_INDEX_MAP: Record<string, number> = {
  OBSERVE: 0, ORIENT: 1, DECIDE: 2, ACT: 3,
};

interface TheWheelProps {
  oodaState: OODAState & { adaptations: number };
  sessionActive?: boolean;
  sessionPnlPct?: number;
  sessionPnlSol?: number;
  sessionTimeRemaining?: string;
  sessionStrategy?: string;
  // Agent status from Telegram bot (polled via /api/agent/status)
  agentPhase?: OODAPhase;
  agentPhaseDescription?: string;
  agentCycleCount?: number;
  agentConfidence?: number;
}

export const TheWheel = ({
  oodaState: ooda,
  sessionActive = false,
  sessionPnlPct,
  sessionPnlSol,
  sessionTimeRemaining,
  sessionStrategy,
  agentPhase = 'IDLE',
  agentPhaseDescription,
  agentCycleCount = 0,
  agentConfidence = 0,
}: TheWheelProps) => {
  const { publicKey } = useWallet();

  // Effective phase: prefer agent phase (from bot) over local OODA phase
  const effectivePhase = agentPhase !== 'IDLE' ? agentPhase : ooda.phase;
  const activePhase = PHASE_INDEX_MAP[effectivePhase] ?? -1;
  const isAdapting = effectivePhase !== 'IDLE';
  const blendedApy = ooda.lastDecision?.blendedApy ?? 0;

  // Effective stats: merge agent + local
  const effectiveCycles = agentCycleCount > 0 ? agentCycleCount + ooda.adaptations : ooda.adaptations;
  const effectiveConfidence = agentConfidence > 0 ? agentConfidence : ooda.confidence;
  const effectiveDescription = agentPhase !== 'IDLE' && agentPhaseDescription
    ? agentPhaseDescription
    : ooda.phaseDescription;

  // Phase-locked rotation: wheel turns 90deg on each phase change
  const rotationRef = useRef(0);
  const prevPhaseRef = useRef<OODAPhase>('IDLE');
  const [rotation, setRotation] = useState(0);
  const [stepping, setStepping] = useState(false);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    const curr = effectivePhase;
    prevPhaseRef.current = curr;
    if (curr === 'IDLE' || prev === curr) return;
    rotationRef.current += 90;
    setRotation(rotationRef.current);
    setStepping(true);
    const timer = setTimeout(() => setStepping(false), 400);
    return () => clearTimeout(timer);
  }, [effectivePhase]);

  const getSubtitle = () => {
    if (!publicKey) return 'Connect Wallet';
    if (agentPhase !== 'IDLE') return 'Bot Active';
    if (sessionActive) return 'Session Active';
    if (isAdapting) return 'The Adaptive One';
    return 'Awaiting Mandate';
  };

  return (
    <div className="cursed-card p-4 h-full flex flex-col items-center relative overflow-hidden">
      {/* Kanji watermark */}
      <div className="kanji-watermark top-4 right-4">魔</div>

      {/* Title */}
      <div className="text-center mb-2">
        <h2
          className="font-display text-xl tracking-[0.3em] leading-none"
          style={{
            background: 'linear-gradient(135deg, #6d28d9 0%, #8b5cf6 35%, #a78bfa 50%, #8b5cf6 65%, #6d28d9 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            filter: 'drop-shadow(0 0 12px rgba(139, 92, 246, 0.3))',
          }}
        >
          MAKORA
        </h2>
        <div
          className="text-[9px] tracking-[0.3em] uppercase mt-0.5 flex items-center justify-center gap-1.5"
          style={{
            background: 'linear-gradient(90deg, #4a4750, #8b5cf6 40%, #a78bfa 50%, #8b5cf6 60%, #4a4750)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {getSubtitle()}
          {(sessionActive || agentPhase !== 'IDLE') && (
            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#8b5cf6' }} />
          )}
        </div>
      </div>

      {/* Wheel + OODA phases */}
      <div className="flex-1 flex items-center justify-center w-full">
        <div className="relative w-28 h-28 sm:w-36 sm:h-36">
          {/* Glow ring */}
          <div
            className="absolute inset-[-8px] rounded-full transition-all duration-700"
            style={{
              background: `radial-gradient(circle, rgba(139, 92, 246, ${isAdapting || sessionActive ? 0.15 : 0.05}) 0%, transparent 70%)`,
            }}
          />

          {/* Wheel image */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              transform: `rotate(${rotation}deg) scale(${stepping ? 1.05 : 1})`,
              transition: 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            {(isAdapting || sessionActive) && (
              <div className="absolute inset-0 animate-wheel-pulse pointer-events-none" />
            )}
            <img
              src="/wheel.png"
              alt="Wheel of Adaptation"
              className="w-full h-full object-contain"
              style={{
                filter: 'invert(1) sepia(1) saturate(3) hue-rotate(230deg) brightness(0.85)',
                opacity: !publicKey ? 0.2 : (isAdapting || sessionActive) ? 1 : 0.6,
                transition: 'opacity 0.5s',
              }}
            />
          </div>

          {/* OODA Phase kanji indicators around the wheel */}
          {PHASES.map((phase, idx) => {
            const isActive = idx === activePhase;
            const angle = (idx * 90 - 90) * (Math.PI / 180);
            const radius = 56;
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
                <div className={`flex flex-col items-center gap-0 transition-all duration-500 ${
                  isActive ? 'scale-110' : 'scale-90 opacity-30'
                }`}>
                  <span
                    className="text-base font-bold select-none"
                    style={{
                      color: isActive ? '#8b5cf6' : '#4a4750',
                      textShadow: isActive ? '0 0 12px rgba(139, 92, 246, 0.6)' : 'none',
                    }}
                  >
                    {phase.kanji}
                  </span>
                  <span
                    className="text-[7px] font-mono tracking-[0.1em] uppercase"
                    style={{ color: isActive ? '#8b5cf6' : '#4a4750' }}
                  >
                    {phase.name}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Session timer badge */}
          {sessionActive && sessionTimeRemaining && (
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[9px] font-mono tracking-wider text-cursed bg-bg-inner border border-cursed/30 rounded-sm">
              {sessionTimeRemaining}
            </div>
          )}
        </div>
      </div>

      {/* Phase description */}
      {effectiveDescription && effectivePhase !== 'IDLE' && (
        <div className="w-full text-center mb-1">
          <div className="text-[8px] text-text-muted/70 font-mono tracking-wider truncate px-2">
            {effectiveDescription}
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div className="w-full mt-auto">
        <div className="ink-divider mb-2" />
        <div className="flex items-center justify-between text-[10px] font-mono">
          <div className="text-center">
            <div className="text-text-muted tracking-wider uppercase mb-0.5" style={{ fontSize: '7px' }}>Cycles</div>
            <div className="text-cursed font-bold">{effectiveCycles.toLocaleString()}</div>
          </div>
          <div className="w-px h-5 bg-cursed/20" />
          <div className="text-center">
            <div className="text-text-muted tracking-wider uppercase mb-0.5" style={{ fontSize: '7px' }}>Conf</div>
            <div className="text-cursed font-bold">{effectiveConfidence > 0 ? `${effectiveConfidence}%` : '--'}</div>
          </div>
          <div className="w-px h-5 bg-cursed/20" />
          <div className="text-center">
            <div className="text-text-muted tracking-wider uppercase mb-0.5" style={{ fontSize: '7px' }}>APY</div>
            <div className="text-cursed font-bold">{blendedApy > 0 ? `${blendedApy}%` : '--'}</div>
          </div>
          <div className="w-px h-5 bg-cursed/20" />
          <div className="text-center">
            <div className="text-text-muted tracking-wider uppercase mb-0.5" style={{ fontSize: '7px' }}>Phase</div>
            <div className="text-cursed font-bold">{effectivePhase}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
