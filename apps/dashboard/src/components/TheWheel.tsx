'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import type { OODAState, OODAPhase } from '@/hooks/useOODALoop';

const PHASES: { name: OODAPhase; kanji: string; desc: string }[] = [
  { name: 'OBSERVE', kanji: '観', desc: 'Reading on-chain portfolio state' },
  { name: 'ORIENT', kanji: '向', desc: 'Evaluating strategy & market context' },
  { name: 'DECIDE', kanji: '決', desc: 'Validating action against risk limits' },
  { name: 'ACT', kanji: '行', desc: 'Presenting recommendation' },
];

const PHASE_INDEX_MAP: Record<string, number> = {
  OBSERVE: 0,
  ORIENT: 1,
  DECIDE: 2,
  ACT: 3,
};

interface TheWheelProps {
  oodaState: OODAState & { adaptations: number };
}

export const TheWheel = ({ oodaState: ooda }: TheWheelProps) => {
  const { publicKey } = useWallet();

  const activePhase = PHASE_INDEX_MAP[ooda.phase] ?? -1;
  const isAdapting = ooda.phase !== 'IDLE';
  const blendedApy = ooda.lastDecision?.blendedApy ?? 0;

  return (
    <div className="cursed-card p-6 flex flex-col items-center justify-center h-full min-h-[500px] relative overflow-hidden">
      {/* Kanji watermark */}
      <div className="kanji-watermark top-6 right-6">魔</div>

      {/* The Wheel */}
      <div className="relative w-72 h-72 lg:w-80 lg:h-80 mt-8">
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
            className={`w-full h-full object-contain ${isAdapting ? 'animate-wheel-spin animate-wheel-pulse' : ''}`}
            style={{
              filter: 'invert(1) sepia(1) saturate(2) hue-rotate(10deg) brightness(0.9)',
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
            <div className="font-display text-2xl tracking-[0.25em] text-cursed-gradient mb-0.5">
              MAKORA
            </div>
            <div className="text-[8px] text-text-muted tracking-[0.3em] uppercase">
              {publicKey ? 'The Adaptive One' : 'Connect Wallet'}
            </div>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="mt-8 w-full max-w-md">
        <div className="ink-divider mb-4" />
        <div className="flex items-center justify-between text-[11px] font-mono">
          <div>
            <div className="text-text-muted tracking-wider uppercase mb-1">Adaptations</div>
            <div className="text-cursed font-bold text-lg">{ooda.adaptations.toLocaleString()}</div>
          </div>
          <div className="w-px h-8 bg-cursed/20" />
          <div>
            <div className="text-text-muted tracking-wider uppercase mb-1">Confidence</div>
            <div className="text-cursed font-bold text-lg">
              {ooda.confidence > 0 ? `${ooda.confidence}%` : '--'}
            </div>
          </div>
          <div className="w-px h-8 bg-cursed/20" />
          <div>
            <div className="text-text-muted tracking-wider uppercase mb-1">APY</div>
            <div className="text-cursed font-bold text-lg">
              {blendedApy > 0 ? `${blendedApy}%` : '--'}
            </div>
          </div>
          <div className="w-px h-8 bg-cursed/20" />
          <div>
            <div className="text-text-muted tracking-wider uppercase mb-1">Phase</div>
            <div className="text-cursed font-bold text-lg">{ooda.phase}</div>
          </div>
        </div>
      </div>

      {/* Current phase description */}
      <div className="mt-4 text-center">
        <div className="text-[10px] text-text-muted font-mono tracking-wider">
          {ooda.phaseDescription}
        </div>
        {ooda.lastDecision && (
          <div className="mt-2 text-[10px] text-cursed/70 font-mono">
            {ooda.lastDecision.recommendation}
          </div>
        )}
      </div>
    </div>
  );
};
