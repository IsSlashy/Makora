'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useVault } from '@/hooks/useVault';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import type { AgentRiskParams } from '@/hooks/useOODALoop';

interface RiskControlsProps {
  isAgentAutoMode?: boolean;
  onSetAutoMode?: (auto: boolean) => void;
  signingMode?: 'agent' | 'wallet';
  onSetSigningMode?: (mode: 'agent' | 'wallet') => void;
  agentRiskParams?: AgentRiskParams | null;
  walletBalance?: number;
  vaultBalance?: number;
}

export const RiskControls = ({
  isAgentAutoMode,
  onSetAutoMode,
  signingMode = 'wallet',
  onSetSigningMode,
  agentRiskParams,
  walletBalance,
  vaultBalance,
}: RiskControlsProps) => {
  const { publicKey } = useWallet();
  const { vaultState, setMode } = useVault();
  const { addActivity } = useActivityFeed();
  const [modeLoading, setModeLoading] = useState(false);
  const [emergencyHalt, setEmergencyHalt] = useState(false);

  const onChainAuto = vaultState ? Object.keys(vaultState.mode)[0] !== 'advisory' : false;
  const isAutoMode = onChainAuto || (isAgentAutoMode ?? false);

  const handleEmergencyHalt = () => {
    setEmergencyHalt(true);
    addActivity({ action: 'EMERGENCY HALT activated — all operations paused', status: 'warning' });
  };

  const handleResetHalt = () => {
    setEmergencyHalt(false);
    addActivity({ action: 'Emergency halt released — operations resumed', status: 'success' });
  };

  // Source label
  const sourceLabel = agentRiskParams
    ? agentRiskParams.source === 'agent'
      ? 'SET BY MOLTBOT'
      : agentRiskParams.source === 'vault'
        ? 'FROM ON-CHAIN VAULT'
        : 'DEFAULTS (awaiting agent analysis)'
    : 'DEFAULTS (awaiting agent analysis)';

  const sourceColor = agentRiskParams?.source === 'agent'
    ? 'text-positive'
    : agentRiskParams?.source === 'vault'
      ? 'text-cursed'
      : 'text-text-muted';

  // Display values
  const maxPos = agentRiskParams?.maxPositionPct ?? 20;
  const maxSlip = agentRiskParams?.maxSlippageBps ?? 100;
  const dailyLoss = agentRiskParams?.dailyLossLimitPct ?? 5;
  const stopLoss = agentRiskParams?.stopLossPct ?? 8;

  // Risk score from current params
  const riskScoreNum = (() => {
    const posRisk = maxPos / 100 * 3;
    const slipRisk = maxSlip / 5000 * 2;
    const lossRisk = dailyLoss / 20 * 5;
    return Math.min(10, Math.max(0, posRisk + slipRisk + lossRisk));
  })();
  const riskScore = riskScoreNum.toFixed(1);
  const riskLabel = riskScoreNum <= 3 ? 'Low' : riskScoreNum <= 6 ? 'Medium' : 'High';
  const riskColor = riskScoreNum <= 3 ? 'text-positive' : riskScoreNum <= 6 ? 'text-caution' : 'text-negative';

  return (
    <div className="cursed-card p-5 animate-fade-up">
      <div className="flex items-center justify-between mb-5">
        <div className="section-title">Risk Controls</div>
        <div className={`text-[10px] font-mono tracking-wider px-2 py-0.5 border ${
          emergencyHalt
            ? 'text-negative border-negative/30 bg-negative/8 animate-pulse'
            : 'text-positive border-positive/30 bg-positive/8'
        }`}>
          {emergencyHalt ? 'HALTED' : 'ARMED'}
        </div>
      </div>

      {!publicKey ? (
        <div className="text-[10px] text-text-muted font-mono text-center py-6 tracking-wider">
          Connect wallet to manage risk controls
        </div>
      ) : (
        <div className="space-y-4">
          {/* Source indicator */}
          <div className={`text-[9px] font-mono tracking-wider ${sourceColor}`}>
            {sourceLabel}
          </div>

          {/* Read-only 2x2 Risk Params Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-bg-inner border border-cursed/10 p-3">
              <div className="text-[9px] font-mono text-text-muted tracking-wider uppercase mb-1">Max Position</div>
              <div className="text-lg font-mono font-bold text-cursed">{maxPos}%</div>
            </div>
            <div className="bg-bg-inner border border-cursed/10 p-3">
              <div className="text-[9px] font-mono text-text-muted tracking-wider uppercase mb-1">Max Slippage</div>
              <div className="text-lg font-mono font-bold text-cursed">{maxSlip}<span className="text-[10px] text-text-muted ml-0.5">bps</span></div>
            </div>
            <div className="bg-bg-inner border border-cursed/10 p-3">
              <div className="text-[9px] font-mono text-text-muted tracking-wider uppercase mb-1">Daily Loss Limit</div>
              <div className="text-lg font-mono font-bold text-caution">{dailyLoss}%</div>
            </div>
            <div className="bg-bg-inner border border-cursed/10 p-3">
              <div className="text-[9px] font-mono text-text-muted tracking-wider uppercase mb-1">Stop Loss</div>
              <div className="text-lg font-mono font-bold text-negative">{stopLoss}%</div>
            </div>
          </div>

          {/* Agent Budget vs Your Funds */}
          {(walletBalance !== undefined || vaultBalance !== undefined) && (
            <>
              <div className="ink-divider" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[9px] font-mono text-text-muted tracking-wider uppercase mb-1">Agent Budget (Vault)</div>
                  <div className="text-sm font-mono font-bold text-positive">
                    {(vaultBalance ?? 0) > 0 ? `${vaultBalance!.toFixed(4)} SOL` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] font-mono text-text-muted tracking-wider uppercase mb-1">Your Funds (Wallet)</div>
                  <div className="text-sm font-mono font-bold text-text-primary">
                    {walletBalance !== undefined ? `${walletBalance.toFixed(4)} SOL` : '—'}
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="ink-divider" />

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

          {/* Metrics + Toggles */}
          <div className="space-y-2">
            <div className="flex justify-between text-[11px] font-mono">
              <span className="text-text-muted">Risk Score</span>
              <span className={riskColor}>{riskLabel} ({riskScore}/10)</span>
            </div>
            <div className="flex justify-between text-[11px] font-mono">
              <span className="text-text-muted">Vault</span>
              <span className="text-text-primary">{vaultState ? 'Active' : 'Not initialized'}</span>
            </div>

            {/* Agent Mode Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-mono font-bold text-text-primary mb-0.5">Agent Mode</div>
                <div className="text-[9px] font-mono text-text-muted">
                  {isAutoMode ? 'Agent executes autonomously' : 'Agent suggests, you confirm'}
                </div>
                {!vaultState && isAutoMode && (
                  <div className="text-[8px] font-mono text-caution mt-0.5">LOCAL MODE — no on-chain vault</div>
                )}
              </div>
              <button
                disabled={modeLoading}
                onClick={async () => {
                  const nextMode = isAutoMode ? 'advisory' : 'auto';
                  setModeLoading(true);
                  try {
                    if (vaultState) {
                      await setMode(nextMode);
                    }
                    onSetAutoMode?.(nextMode === 'auto');
                    addActivity({
                      action: `Agent mode set to ${nextMode === 'auto' ? 'AUTO' : 'ADVISORY'}${!vaultState ? ' (local)' : ''}`,
                      status: nextMode === 'auto' ? 'success' : 'adapt',
                    });
                  } catch (e: any) {
                    onSetAutoMode?.(nextMode === 'auto');
                    addActivity({
                      action: `Agent mode set to ${nextMode === 'auto' ? 'AUTO' : 'ADVISORY'} (local — on-chain: ${e.message?.slice(0, 40) || 'error'})`,
                      status: 'warning',
                    });
                  } finally {
                    setModeLoading(false);
                  }
                }}
                className={`relative w-10 h-5 transition-colors ${
                  isAutoMode ? 'bg-positive/30' : 'bg-bg-inner'
                } border ${isAutoMode ? 'border-positive/40' : 'border-text-muted/20'} ${
                  modeLoading ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                }`}
              >
                <span className={`absolute top-0.5 w-4 h-4 transition-transform ${
                  isAutoMode ? 'left-5 bg-positive' : 'left-0.5 bg-text-muted'
                }`} />
              </button>
            </div>

            {/* Signing Mode Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-mono font-bold text-text-primary mb-0.5">Signing Mode</div>
                <div className="text-[9px] font-mono text-text-muted">
                  {signingMode === 'agent' ? 'Server keypair signs txs' : 'Wallet approves each tx'}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    onSetSigningMode?.('wallet');
                    addActivity({ action: 'Signing mode → WALLET (manual approval)', status: 'adapt' });
                  }}
                  className={`px-2 py-1 text-[9px] font-mono tracking-wider border transition-colors ${
                    signingMode === 'wallet'
                      ? 'text-cursed border-cursed/40 bg-cursed/10'
                      : 'text-text-muted border-text-muted/20 hover:border-text-muted/40'
                  }`}
                >
                  WALLET
                </button>
                <button
                  onClick={() => {
                    onSetSigningMode?.('agent');
                    addActivity({ action: 'Signing mode → AGENT (autonomous)', status: 'warning' });
                  }}
                  className={`px-2 py-1 text-[9px] font-mono tracking-wider border transition-colors ${
                    signingMode === 'agent'
                      ? 'text-negative border-negative/40 bg-negative/10'
                      : 'text-text-muted border-text-muted/20 hover:border-text-muted/40'
                  }`}
                >
                  AGENT
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
