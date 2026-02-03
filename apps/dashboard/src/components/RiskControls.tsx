'use client';

import { useState } from 'react';

export const RiskControls = () => {
  const [maxPosition, setMaxPosition] = useState(20);
  const [maxSlippage, setMaxSlippage] = useState(1);
  const [dailyLossLimit, setDailyLossLimit] = useState(5);
  const [circuitBreaker, setCircuitBreaker] = useState(true);

  return (
    <div className="cursed-card p-5 animate-fade-up">
      <div className="flex items-center justify-between mb-5">
        <div className="section-title">Risk Controls</div>
        <div className={`text-[10px] font-mono tracking-wider px-2 py-0.5 border ${
          circuitBreaker
            ? 'text-positive border-positive/30 bg-positive/8'
            : 'text-negative border-negative/30 bg-negative/8'
        }`}>
          {circuitBreaker ? 'ARMED' : 'TRIPPED'}
        </div>
      </div>

      <div className="space-y-5">
        {/* Max Position */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-text-muted tracking-wider uppercase">Max Position</span>
            <span className="text-xs font-mono font-bold text-cursed">{maxPosition}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={maxPosition}
            onChange={(e) => setMaxPosition(Number(e.target.value))}
            className="w-full cursor-pointer"
            style={{
              background: `linear-gradient(to right, #d4a829 0%, #d4a829 ${maxPosition}%, #08080e ${maxPosition}%, #08080e 100%)`,
            }}
          />
        </div>

        {/* Max Slippage */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-text-muted tracking-wider uppercase">Max Slippage</span>
            <span className="text-xs font-mono font-bold text-cursed">{maxSlippage.toFixed(1)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="5"
            step="0.1"
            value={maxSlippage}
            onChange={(e) => setMaxSlippage(Number(e.target.value))}
            className="w-full cursor-pointer"
            style={{
              background: `linear-gradient(to right, #d4a829 0%, #d4a829 ${(maxSlippage / 5) * 100}%, #08080e ${(maxSlippage / 5) * 100}%, #08080e 100%)`,
            }}
          />
        </div>

        {/* Daily Loss */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-text-muted tracking-wider uppercase">Daily Loss Limit</span>
            <span className="text-xs font-mono font-bold text-cursed">{dailyLossLimit}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="20"
            value={dailyLossLimit}
            onChange={(e) => setDailyLossLimit(Number(e.target.value))}
            className="w-full cursor-pointer"
            style={{
              background: `linear-gradient(to right, #d4a829 0%, #d4a829 ${(dailyLossLimit / 20) * 100}%, #08080e ${(dailyLossLimit / 20) * 100}%, #08080e 100%)`,
            }}
          />
        </div>

        <div className="ink-divider" />

        {/* Circuit Breaker Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-mono font-bold text-text-primary mb-0.5">Circuit Breaker</div>
            <div className="text-[9px] font-mono text-text-muted">Auto-halt on threshold breach</div>
          </div>
          <button
            onClick={() => setCircuitBreaker(!circuitBreaker)}
            className={`relative w-10 h-5 transition-colors ${
              circuitBreaker ? 'bg-cursed/30' : 'bg-bg-inner'
            } border ${circuitBreaker ? 'border-cursed/40' : 'border-text-muted/20'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 transition-transform ${
              circuitBreaker ? 'left-5 bg-cursed' : 'left-0.5 bg-text-muted'
            }`} />
          </button>
        </div>

        {/* Emergency Stop */}
        <button className="w-full px-3 py-2.5 text-[10px] font-mono tracking-[0.2em] uppercase bg-negative/10 border border-negative/30 text-negative hover:bg-negative/20 transition-colors font-bold">
          EMERGENCY HALT
        </button>

        <div className="ink-divider" />

        {/* Metrics */}
        <div className="space-y-2">
          <div className="flex justify-between text-[11px] font-mono">
            <span className="text-text-muted">Risk Score</span>
            <span className="text-positive">Low (2.3/10)</span>
          </div>
          <div className="flex justify-between text-[11px] font-mono">
            <span className="text-text-muted">Today P&L</span>
            <span className="text-positive">+$295.40</span>
          </div>
          <div className="flex justify-between text-[11px] font-mono">
            <span className="text-text-muted">Max Exposure</span>
            <span className="text-text-primary">SOL 45%</span>
          </div>
        </div>
      </div>
    </div>
  );
};
