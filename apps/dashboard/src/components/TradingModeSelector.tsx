'use client';

import { type TradingMode, TRADING_MODES } from '@/hooks/useOODALoop';

interface TradingModeSelectorProps {
  currentMode: TradingMode;
  onModeChange: (mode: TradingMode) => void;
  disabled?: boolean;
}

const MODE_ICONS: Record<TradingMode, string> = {
  invest: '📈', // Long-term growth
  perps: '⚡', // Fast trading
};

const MODE_COLORS: Record<TradingMode, { bg: string; border: string; text: string }> = {
  invest: {
    bg: 'bg-positive/10',
    border: 'border-positive/30',
    text: 'text-positive',
  },
  perps: {
    bg: 'bg-caution/10',
    border: 'border-caution/30',
    text: 'text-caution',
  },
};

export const TradingModeSelector = ({
  currentMode,
  onModeChange,
  disabled = false,
}: TradingModeSelectorProps) => {
  const modes: TradingMode[] = ['invest', 'perps'];

  return (
    <div className="flex gap-2">
      {modes.map((mode) => {
        const config = TRADING_MODES[mode];
        const colors = MODE_COLORS[mode];
        const isActive = currentMode === mode;

        return (
          <button
            key={mode}
            onClick={() => onModeChange(mode)}
            disabled={disabled}
            className={`
              flex items-center gap-2 px-3 py-2 text-[10px] font-mono tracking-wider uppercase
              border transition-all duration-200
              ${isActive
                ? `${colors.bg} ${colors.border} ${colors.text} font-bold`
                : 'bg-bg-inner border-cursed/15 text-text-muted hover:border-cursed/30'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
            title={config.description}
          >
            <span className="text-sm">{MODE_ICONS[mode]}</span>
            <span>{mode.toUpperCase()}</span>
            {isActive && (
              <span className="text-[10px] md:text-[8px] opacity-70">
                {mode === 'invest' ? '5min' : '20s'}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

// Compact version for header
export const TradingModeBadge = ({
  mode,
  onClick,
}: {
  mode: TradingMode;
  onClick?: () => void;
}) => {
  const config = TRADING_MODES[mode];
  const colors = MODE_COLORS[mode];

  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-1.5 px-2 py-1 min-h-[44px] md:min-h-0 text-[11px] md:text-[9px] font-mono tracking-wider uppercase
        ${colors.bg} ${colors.border} ${colors.text} border
        hover:opacity-80 transition-opacity
      `}
      title={config.description}
    >
      <span>{MODE_ICONS[mode]}</span>
      <span>{mode}</span>
      <span className="opacity-60">
        {mode === 'invest' ? '5m' : '20s'}
      </span>
    </button>
  );
};
