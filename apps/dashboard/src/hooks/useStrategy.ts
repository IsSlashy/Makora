'use client';

import { useState, useCallback, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { useStrategyProgram, getStrategyPDA, getAuditTrailPDA } from './useAnchorProgram';

export interface AuditEntryData {
  index: number;
  actionType: string;
  protocol: string;
  description: string;
  executed: boolean;
  success: boolean;
  timestamp: number;
}

export interface StrategyState {
  owner: PublicKey;
  agentAuthority: PublicKey;
  strategyType: { yield: {} } | { trading: {} } | { rebalance: {} } | { liquidity: {} };
  mode: { advisory: {} } | { auto: {} };
  confidenceThreshold: number;
  maxActionsPerCycle: number;
  targetAllocation: Array<{ symbol: number[]; targetPct: number }>;
  allocationCount: number;
  totalCycles: BN;
  totalActionsExecuted: BN;
  lastCycleAt: BN;
  createdAt: BN;
  bump: number;
}

export interface AuditTrailState {
  owner: PublicKey;
  head: number;
  count: number;
  entries: Array<{
    index: number;
    actionType: number[];
    protocol: number[];
    description: number[];
    executed: boolean;
    success: boolean;
    timestamp: BN;
  }>;
  bump: number;
}

function bytesToString(bytes: number[]): string {
  const end = bytes.indexOf(0);
  const slice = end === -1 ? bytes : bytes.slice(0, end);
  return String.fromCharCode(...slice);
}

function stringToFixedBytes(str: string, len: number): number[] {
  const bytes = new Array(len).fill(0);
  for (let i = 0; i < Math.min(str.length, len); i++) {
    bytes[i] = str.charCodeAt(i);
  }
  return bytes;
}

export function useStrategy() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const strategyProgram = useStrategyProgram();
  const [strategyState, setStrategyState] = useState<StrategyState | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntryData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTxSig, setLastTxSig] = useState<string | null>(null);

  const fetchStrategyState = useCallback(async () => {
    if (!publicKey || !strategyProgram) return;

    try {
      const [strategyPDA] = getStrategyPDA(publicKey);
      const account = await (strategyProgram.account as any).strategyAccount.fetch(strategyPDA);
      setStrategyState(account as any);
    } catch (e: any) {
      if (e.message?.includes('Account does not exist') || e.message?.includes('could not find')) {
        setStrategyState(null);
      }
    }

    try {
      const [auditPDA] = getAuditTrailPDA(publicKey);
      const auditAccount = await (strategyProgram.account as any).auditTrail.fetch(auditPDA);

      // Parse ring buffer entries
      const count = Math.min(auditAccount.count, 8);
      const entries: AuditEntryData[] = [];
      for (let i = 0; i < count; i++) {
        const idx = auditAccount.head > i
          ? (auditAccount.head - 1 - i) % 8
          : (8 + auditAccount.head - 1 - i) % 8;
        const entry = auditAccount.entries[idx];
        if (entry.timestamp.toNumber() > 0) {
          entries.push({
            index: entry.index,
            actionType: bytesToString(entry.actionType),
            protocol: bytesToString(entry.protocol),
            description: bytesToString(entry.description),
            executed: entry.executed,
            success: entry.success,
            timestamp: entry.timestamp.toNumber(),
          });
        }
      }
      setAuditEntries(entries);
    } catch {
      setAuditEntries([]);
    }
  }, [publicKey, strategyProgram]);

  // Single initial fetch on wallet connect (throttle middleware prevents 429 cascade)
  useEffect(() => {
    fetchStrategyState();
  }, [fetchStrategyState]);

  const initializeStrategy = useCallback(async (opts?: {
    strategyType?: number;
    confidenceThreshold?: number;
    maxActionsPerCycle?: number;
  }) => {
    if (!publicKey || !strategyProgram) throw new Error('Wallet not connected');

    setLoading(true);
    setError(null);
    try {
      // Default balanced allocation: SOL 35%, USDC 25%, mSOL 25%, JLP 15%
      const symbols = [
        stringToFixedBytes('SOL', 8),
        stringToFixedBytes('USDC', 8),
        stringToFixedBytes('mSOL', 8),
        stringToFixedBytes('JLP', 8),
      ];
      const pcts = [35, 25, 25, 15];

      const tx = await (strategyProgram.methods as any)
        .initialize(
          publicKey, // agent_authority = self
          opts?.strategyType ?? 0, // Yield
          0, // Advisory mode
          opts?.confidenceThreshold ?? 70,
          opts?.maxActionsPerCycle ?? 3,
          symbols,
          pcts,
        )
        .accounts({
          owner: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setLastTxSig(tx);
      await connection.confirmTransaction(tx, 'confirmed');
      await fetchStrategyState();
      return tx;
    } catch (e: any) {
      setError(e.message || 'Failed to initialize strategy');
      throw e;
    } finally {
      setLoading(false);
    }
  }, [publicKey, strategyProgram, connection, fetchStrategyState]);

  const updateStrategy = useCallback(async (
    strategyType: number,
    confidenceThreshold: number,
    maxActionsPerCycle: number,
    allocSymbols: string[],
    allocPcts: number[],
  ) => {
    if (!publicKey || !strategyProgram) throw new Error('Wallet not connected');

    setLoading(true);
    setError(null);
    try {
      const symbols = allocSymbols.map(s => stringToFixedBytes(s, 8));
      const tx = await (strategyProgram.methods as any)
        .updateStrategy(
          strategyType,
          confidenceThreshold,
          maxActionsPerCycle,
          symbols,
          allocPcts,
        )
        .accounts({
          authority: publicKey,
        })
        .rpc();

      setLastTxSig(tx);
      await connection.confirmTransaction(tx, 'confirmed');
      await fetchStrategyState();
      return tx;
    } catch (e: any) {
      setError(e.message || 'Failed to update strategy');
      throw e;
    } finally {
      setLoading(false);
    }
  }, [publicKey, strategyProgram, connection, fetchStrategyState]);

  const logAction = useCallback(async (
    actionType: string,
    protocol: string,
    description: string,
    executed: boolean,
    success: boolean,
  ) => {
    if (!publicKey || !strategyProgram) throw new Error('Wallet not connected');

    setLoading(true);
    setError(null);
    try {
      const tx = await (strategyProgram.methods as any)
        .logAction(
          actionType.slice(0, 16),
          protocol.slice(0, 16),
          description.slice(0, 64),
          executed,
          success,
        )
        .accounts({
          authority: publicKey,
          owner: publicKey,
        })
        .rpc();

      setLastTxSig(tx);
      await connection.confirmTransaction(tx, 'confirmed');
      await fetchStrategyState();
      return tx;
    } catch (e: any) {
      setError(e.message || 'Failed to log action');
      throw e;
    } finally {
      setLoading(false);
    }
  }, [publicKey, strategyProgram, connection, fetchStrategyState]);

  // Parse strategy type to string
  const strategyTypeString = strategyState
    ? Object.keys(strategyState.strategyType)[0]?.toUpperCase() ?? 'YIELD'
    : 'YIELD';

  const totalCycles = strategyState?.totalCycles?.toNumber() ?? 0;
  const totalActions = strategyState?.totalActionsExecuted?.toNumber() ?? 0;

  return {
    strategyState,
    auditEntries,
    strategyTypeString,
    totalCycles,
    totalActions,
    loading,
    error,
    lastTxSig,
    initializeStrategy,
    updateStrategy,
    logAction,
    fetchStrategyState,
  };
}
