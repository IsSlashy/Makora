'use client';

import { useState } from 'react';

export const RiskControls = () => {
  const [maxPosition, setMaxPosition] = useState(20);
  const [maxSlippage, setMaxSlippage] = useState(1);
  const [dailyLossLimit, setDailyLossLimit] = useState(5);
  const [circuitBreakerActive, setCircuitBreakerActive] = useState(true);

  return (
    <div className="glass-card p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-text-primary">Risk Controls</h2>
        <div className={`px-3 py-1 rounded-full text-sm font-medium ${
          circuitBreakerActive
            ? 'bg-green-500/20 text-green-500'
            : 'bg-red-500/20 text-red-500'
        }`}>
          {circuitBreakerActive ? 'ACTIVE' : 'TRIGGERED'}
        </div>
      </div>

      <div className="space-y-6">
        {/* Max Position Size */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-text-primary">
              Max Position Size
            </label>
            <span className="text-accent font-bold">{maxPosition}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={maxPosition}
            onChange={(e) => setMaxPosition(Number(e.target.value))}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${maxPosition}%, #1a0a2e ${maxPosition}%, #1a0a2e 100%)`,
            }}
          />
          <div className="flex justify-between text-xs text-text-secondary mt-1">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>

        {/* Max Slippage */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-text-primary">
              Max Slippage
            </label>
            <span className="text-accent font-bold">{maxSlippage.toFixed(1)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="5"
            step="0.1"
            value={maxSlippage}
            onChange={(e) => setMaxSlippage(Number(e.target.value))}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${(maxSlippage / 5) * 100}%, #1a0a2e ${(maxSlippage / 5) * 100}%, #1a0a2e 100%)`,
            }}
          />
          <div className="flex justify-between text-xs text-text-secondary mt-1">
            <span>0%</span>
            <span>2.5%</span>
            <span>5%</span>
          </div>
        </div>

        {/* Daily Loss Limit */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-text-primary">
              Daily Loss Limit
            </label>
            <span className="text-accent font-bold">{dailyLossLimit}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="20"
            value={dailyLossLimit}
            onChange={(e) => setDailyLossLimit(Number(e.target.value))}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${(dailyLossLimit / 20) * 100}%, #1a0a2e ${(dailyLossLimit / 20) * 100}%, #1a0a2e 100%)`,
            }}
          />
          <div className="flex justify-between text-xs text-text-secondary mt-1">
            <span>0%</span>
            <span>10%</span>
            <span>20%</span>
          </div>
        </div>

        {/* Circuit Breaker Status */}
        <div className="pt-4 border-t border-accent/20">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-medium text-text-primary mb-1">
                Circuit Breaker
              </div>
              <div className="text-xs text-text-secondary">
                Automatically halts trading on risk threshold breach
              </div>
            </div>
            <button
              onClick={() => setCircuitBreakerActive(!circuitBreakerActive)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                circuitBreakerActive ? 'bg-accent' : 'bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  circuitBreakerActive ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Emergency Stop */}
        <button className="w-full px-4 py-3 rounded-lg bg-red-500/20 border border-red-500/50 hover:bg-red-500/30 transition-colors text-red-500 font-bold">
          🛑 EMERGENCY STOP
        </button>

        {/* Risk Metrics */}
        <div className="pt-4 border-t border-accent/20 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">Current Risk Score</span>
            <span className="text-green-500 font-medium">Low (2.3/10)</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">Today's P&L</span>
            <span className="text-green-500 font-medium">+$295.40 (+2.43%)</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">Largest Position</span>
            <span className="text-text-primary font-medium">SOL (45%)</span>
          </div>
        </div>
      </div>

      <style jsx>{`
        input[type='range']::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #8b5cf6;
          cursor: pointer;
          box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
        }
        input[type='range']::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #8b5cf6;
          cursor: pointer;
          border: none;
          box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
        }
      `}</style>
    </div>
  );
};
