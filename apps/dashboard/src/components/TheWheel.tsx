'use client';

import { useRef, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { OODAState, OODAPhase } from '@/hooks/useOODALoop';

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

  const isAdapting = ooda.phase !== 'IDLE';
  const blendedApy = ooda.lastDecision?.blendedApy ?? 0;

  // Phase-locked rotation
  const rotationRef = useRef(0);
  const prevPhaseRef = useRef<OODAPhase>('IDLE');
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    const curr = ooda.phase;
    prevPhaseRef.current = curr;
    if (curr === 'IDLE' || prev === curr) return;
    rotationRef.current += 90;
    setRotation(rotationRef.current);
  }, [ooda.phase]);

  const getSubtitle = () => {
    if (!publicKey) return 'Connect Wallet';
    if (sessionActive) return 'Session Active';
    if (isAdapting) return 'Adapting';
    return 'Idle';
  };

  return (
    <div className="cursed-card p-4 h-full flex flex-col">
      {/* Top row: wheel image + title + subtitle */}
      <div className="flex items-center gap-3 mb-3">
        <div className="relative w-14 h-14 flex-shrink-0">
          <div
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            <img
              src="/wheel.png"
              alt="Wheel"
              className="w-14 h-14 object-contain"
              style={{
                filter: 'invert(1) sepia(1) saturate(3) hue-rotate(230deg) brightness(0.85)',
                opacity: (!publicKey || (!sessionActive && !isAdapting)) ? 0.3 : 1,
                transition: 'opacity 0.5s',
              }}
            />
          </div>
          {(isAdapting || sessionActive) && (
            <div className="absolute inset-0 rounded-full animate-pulse"
              style={{ boxShadow: '0 0 12px rgba(139, 92, 246, 0.3)' }}
            />
          )}
        </div>
        <div>
          <h2
            className="font-display text-lg tracking-[0.2em] leading-none"
            style={{
              background: 'linear-gradient(135deg, #6d28d9 0%, #8b5cf6 35%, #a78bfa 50%, #8b5cf6 65%, #6d28d9 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            MAKORA
          </h2>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] font-mono text-text-muted tracking-wider uppercase">
              {getSubtitle()}
            </span>
            {sessionActive && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-cursed animate-pulse" />
            )}
          </div>
        </div>
      </div>

      {/* Phase indicator */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[9px] font-mono text-text-muted uppercase tracking-wider">Phase</span>
        <div className="flex-1 h-px bg-cursed/10" />
        <span className={`text-xs font-mono font-bold ${isAdapting ? 'text-cursed' : 'text-text-muted'}`}>
          {ooda.phase}
        </span>
      </div>

      {/* Phase description */}
      {ooda.phaseDescription && (
        <div className="text-[9px] text-text-muted/70 font-mono mb-3 leading-relaxed">
          {ooda.phaseDescription}
        </div>
      )}

      {/* Stats grid */}
      <div className="mt-auto grid grid-cols-4 gap-2 border-t border-cursed/10 pt-3">
        <div className="text-center">
          <div className="text-[8px] text-text-muted font-mono uppercase tracking-wider">Cycles</div>
          <div className="text-sm font-mono font-bold text-cursed">{ooda.adaptations.toLocaleString()}</div>
        </div>
        <div className="text-center">
          <div className="text-[8px] text-text-muted font-mono uppercase tracking-wider">Conf</div>
          <div className="text-sm font-mono font-bold text-cursed">
            {ooda.confidence > 0 ? `${ooda.confidence}%` : '--'}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[8px] text-text-muted font-mono uppercase tracking-wider">APY</div>
          <div className="text-sm font-mono font-bold text-cursed">
            {blendedApy > 0 ? `${blendedApy}%` : '--'}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[8px] text-text-muted font-mono uppercase tracking-wider">Time</div>
          <div className="text-sm font-mono font-bold text-cursed">
            {sessionActive && sessionTimeRemaining ? sessionTimeRemaining : '--'}
          </div>
        </div>
      </div>
    </div>
  );
};
