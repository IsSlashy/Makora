'use client';

import { useState, useCallback, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { useVaultProgram, getVaultPDA } from './useAnchorProgram';

export interface VaultState {
  owner: PublicKey;
  agentAuthority: PublicKey;
  totalDeposited: BN;
  totalWithdrawn: BN;
  mode: { advisory: {} } | { auto: {} };
  riskLimits: {
    maxPositionSizePct: number;
    maxSlippageBps: number;
    maxDailyLossPct: number;
    minSolReserve: BN;
    maxProtocolExposurePct: number;
  };
  createdAt: BN;
  lastActionAt: BN;
  bump: number;
}

export function useVault() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const vaultProgram = useVaultProgram();
  const [vaultState, setVaultState] = useState<VaultState | null>(null);
  const [vaultBalance, setVaultBalance] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTxSig, setLastTxSig] = useState<string | null>(null);

  const fetchVaultState = useCallback(async () => {
    if (!publicKey || !vaultProgram) return;

    try {
      const [vaultPDA] = getVaultPDA(publicKey);
      const account = await (vaultProgram.account as any).vault.fetch(vaultPDA);
      setVaultState(account as any);

      // Get actual lamport balance of the vault PDA
      const balance = await connection.getBalance(vaultPDA);
      setVaultBalance(balance / LAMPORTS_PER_SOL);
      setError(null);
    } catch (e: any) {
      // Account doesn't exist yet — that's fine
      if (e.message?.includes('Account does not exist') || e.message?.includes('could not find')) {
        setVaultState(null);
        setVaultBalance(0);
      } else {
        console.error('fetchVaultState error:', e);
      }
    }
  }, [publicKey, vaultProgram, connection]);

  // Auto-fetch on wallet connect
  useEffect(() => {
    fetchVaultState();
  }, [fetchVaultState]);

  const initializeVault = useCallback(async (opts?: {
    maxPositionSizePct?: number;
    maxSlippageBps?: number;
    maxDailyLossPct?: number;
    minSolReserve?: number;
    maxProtocolExposurePct?: number;
  }) => {
    if (!publicKey || !vaultProgram) throw new Error('Wallet not connected');

    setLoading(true);
    setError(null);
    try {
      const tx = await (vaultProgram.methods as any)
        .initialize(
          publicKey, // agent_authority = self for now
          0, // mode = Advisory
          opts?.maxPositionSizePct ?? 20,
          opts?.maxSlippageBps ?? 100,
          opts?.maxDailyLossPct ?? 5,
          new BN((opts?.minSolReserve ?? 0.05) * LAMPORTS_PER_SOL),
          opts?.maxProtocolExposurePct ?? 50,
        )
        .accounts({
          owner: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setLastTxSig(tx);
      await connection.confirmTransaction(tx, 'confirmed');
      await fetchVaultState();
      return tx;
    } catch (e: any) {
      const msg = e.message || 'Failed to initialize vault';
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [publicKey, vaultProgram, connection, fetchVaultState]);

  const deposit = useCallback(async (solAmount: number) => {
    if (!publicKey || !vaultProgram) throw new Error('Wallet not connected');
    if (solAmount <= 0) throw new Error('Amount must be positive');

    setLoading(true);
    setError(null);
    try {
      const lamports = new BN(Math.floor(solAmount * LAMPORTS_PER_SOL));
      const tx = await (vaultProgram.methods as any)
        .deposit(lamports)
        .accounts({
          owner: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setLastTxSig(tx);
      await connection.confirmTransaction(tx, 'confirmed');
      await fetchVaultState();
      return tx;
    } catch (e: any) {
      const msg = e.message || 'Deposit failed';
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [publicKey, vaultProgram, connection, fetchVaultState]);

  const withdraw = useCallback(async (solAmount: number) => {
    if (!publicKey || !vaultProgram) throw new Error('Wallet not connected');
    if (solAmount <= 0) throw new Error('Amount must be positive');

    setLoading(true);
    setError(null);
    try {
      const lamports = new BN(Math.floor(solAmount * LAMPORTS_PER_SOL));
      const tx = await (vaultProgram.methods as any)
        .withdraw(lamports)
        .accounts({
          owner: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setLastTxSig(tx);
      await connection.confirmTransaction(tx, 'confirmed');
      await fetchVaultState();
      return tx;
    } catch (e: any) {
      const msg = e.message || 'Withdrawal failed';
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [publicKey, vaultProgram, connection, fetchVaultState]);

  const currentBalance = vaultState
    ? (vaultState.totalDeposited.sub(vaultState.totalWithdrawn)).toNumber() / LAMPORTS_PER_SOL
    : 0;

  return {
    vaultState,
    vaultBalance,
    currentBalance,
    loading,
    error,
    lastTxSig,
    initializeVault,
    deposit,
    withdraw,
    fetchVaultState,
  };
}
