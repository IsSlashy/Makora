'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useVault } from '@/hooks/useVault';
import { useActivityFeed } from '@/hooks/useActivityFeed';

export const RiskControls = () => {
  const { publicKey } = useWallet();
  const { vaultState, initializeVault, setMode, loading: vaultLoading } = useVault();
  const { addActivity } = useActivityFeed();
  const [modeLoading, setModeLoading] = useState(false);

  // Local slider state — initialized from on-chain when available
  const [maxPosition, setMaxPosition] = useState(20);
  const [maxSlippage, setMaxSlippage] = useState(1);
  const [dailyLossLimit, setDailyLossLimit] = useState(5);
  const [circuitBreaker, setCircuitBreaker] = useState(true);
  const [emergencyHalt, setEmergencyHalt] = useState(false);

  // Sync from on-chain state
  useEffect(() => {
    if (vaultState?.riskLimits) {
      setMaxPosition(vaultState.riskLimits.maxPositionSizePct);
      setMaxSlippage(vaultState.riskLimits.maxSlippageBps / 100); // bps to %
      setDailyLossLimit(vaultState.riskLimits.maxDailyLossPct);
    }
  }, [vaultState]);

  // Compute risk score from current settings
  const riskScore = (() => {
    const posRisk = maxPosition / 100 * 3;
    const slipRisk = maxSlippage / 5 * 2;
    const lossRisk = dailyLossLimit / 20 * 5;
    return Math.min(10, Math.max(0, posRisk + slipRisk + lossRisk)).toFixed(1);
  })();

  const riskLabel = parseFloat(riskScore) <= 3 ? 'Low' : parseFloat(riskScore) <= 6 ? 'Medium' : 'High';
  const riskColor = parseFloat(riskScore) <= 3 ? 'text-positive' : parseFloat(riskScore) <= 6 ? 'text-caution' : 'text-negative';
  const isAutoMode = vaultState ? Object.keys(vaultState.mode)[0] !== 'advisory' : false;

  const handleEmergencyHalt = () => {
    setEmergencyHalt(true);
    setCircuitBreaker(false);
    addActivity({ action: 'EMERGENCY HALT activated — all operations paused', status: 'warning' });
  };

  const handleResetHalt = () => {
    setEmergencyHalt(false);
    setCircuitBreaker(true);
    addActivity({ action: 'Emergency halt released — operations resumed', status: 'success' });
  };

  const handleSliderChange = useCallback((name: string, value: number) => {
    addActivity({
      action: `Risk limit updated: ${name} = ${value}${name === 'Max Slippage' ? '%' : name === 'Max Position' || name === 'Daily Loss' ? '%' : ''}`,
      status: 'adapt',
    });
  }, [addActivity]);

  return (
    <div className="cursed-card p-5 animate-fade-up">
      <div className="flex items-center justify-between mb-5">
        <div className="section-title">Risk Controls</div>
        <div className={`text-[10px] font-mono tracking-wider px-2 py-0.5 border ${
          emergencyHalt
            ? 'text-negative border-negative/30 bg-negative/8 animate-pulse'
            : circuitBreaker
              ? 'text-positive border-positive/30 bg-positive/8'
              : 'text-negative border-negative/30 bg-negative/8'
        }`}>
          {emergencyHalt ? 'HALTED' : circuitBreaker ? 'ARMED' : 'TRIPPED'}
        </div>
      </div>

      {!publicKey ? (
        <div className="text-[10px] text-text-muted font-mono text-center py-6 tracking-wider">
          Connect wallet to manage risk controls
        </div>
      ) : (
        <div className="space-y-5">
          {/* Source indicator */}
          <div className="text-[9px] font-mono text-text-muted tracking-wider">
            {vaultState ? '● ON-CHAIN LIMITS' : '● LOCAL (init vault to store on-chain)'}
          </div>

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
              onChange={(e) => {
                const val = Number(e.target.value);
                setMaxPosition(val);
              }}
              onMouseUp={() => handleSliderChange('Max Position', maxPosition)}
              onTouchEnd={() => handleSliderChange('Max Position', maxPosition)}
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
              onChange={(e) => {
                const val = Number(e.target.value);
                setMaxSlippage(val);
              }}
              onMouseUp={() => handleSliderChange('Max Slippage', maxSlippage)}
              onTouchEnd={() => handleSliderChange('Max Slippage', maxSlippage)}
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
              onChange={(e) => {
                const val = Number(e.target.value);
                setDailyLossLimit(val);
              }}
              onMouseUp={() => handleSliderChange('Daily Loss', dailyLossLimit)}
              onTouchEnd={() => handleSliderChange('Daily Loss', dailyLossLimit)}
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
              onClick={() => {
                const next = !circuitBreaker;
                setCircuitBreaker(next);
                addActivity({
                  action: `Circuit breaker ${next ? 'armed' : 'disarmed'}`,
                  status: next ? 'success' : 'warning',
                });
              }}
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
          {!emergencyHalt ? (
            <button
              onClick={handleEmergencyHalt}
              className="w-full px-3 py-2.5 text-[10px] font-mono tracking-[0.2em] uppercase bg-negative/10 border border-negative/30 text-negative hover:bg-negative/20 transition-colors font-bold"
            >
              EMERGENCY HALT
            </button>
          ) : (
            <button
              onClick={handleResetHalt}
              className="w-full px-3 py-2.5 text-[10px] font-mono tracking-[0.2em] uppercase bg-positive/10 border border-positive/30 text-positive hover:bg-positive/20 transition-colors font-bold animate-pulse"
            >
              RELEASE HALT
            </button>
          )}

          <div className="ink-divider" />

          {/* Metrics */}
          <div className="space-y-2">
            <div className="flex justify-between text-[11px] font-mono">
              <span className="text-text-muted">Risk Score</span>
              <span className={riskColor}>{riskLabel} ({riskScore}/10)</span>
            </div>
            <div className="flex justify-between text-[11px] font-mono">
              <span className="text-text-muted">Vault</span>
              <span className="text-text-primary">{vaultState ? 'Active' : 'Not initialized'}</span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-mono font-bold text-text-primary mb-0.5">Agent Mode</div>
                <div className="text-[9px] font-mono text-text-muted">
                  {isAutoMode ? 'Agent can execute autonomously' : 'Agent suggests, you confirm'}
                </div>
              </div>
              <button
                disabled={!vaultState || modeLoading}
                onClick={async () => {
                  if (!vaultState) return;
                  const nextMode = isAutoMode ? 'advisory' : 'auto';
                  setModeLoading(true);
                  try {
                    await setMode(nextMode);
                    addActivity({
                      action: `Agent mode set to ${nextMode === 'auto' ? 'AUTO' : 'ADVISORY'}`,
                      status: nextMode === 'auto' ? 'success' : 'adapt',
                    });
                  } catch (e: any) {
                    addActivity({
                      action: `Mode change failed: ${e.message?.slice(0, 60) || 'unknown error'}`,
                      status: 'error',
                    });
                  } finally {
                    setModeLoading(false);
                  }
                }}
                className={`relative w-10 h-5 transition-colors ${
                  isAutoMode ? 'bg-positive/30' : 'bg-bg-inner'
                } border ${isAutoMode ? 'border-positive/40' : 'border-text-muted/20'} ${
                  !vaultState || modeLoading ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                }`}
              >
                <span className={`absolute top-0.5 w-4 h-4 transition-transform ${
                  isAutoMode ? 'left-5 bg-positive' : 'left-0.5 bg-text-muted'
                }`} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
