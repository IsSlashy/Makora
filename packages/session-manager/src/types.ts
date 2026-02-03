import type { Keypair, PublicKey } from '@solana/web3.js';

export type SessionStatus = 'funding' | 'active' | 'trading' | 'sweeping' | 'closed';

export interface TradeRecord {
  signature?: string;
  action: string;
  amount: number;
  timestamp: number;
  success: boolean;
  error?: string;
}

export interface StealthSession {
  id: string;
  wallet: SessionWalletInfo;
  fundedAmount: number;
  startedAt: number;
  expiresAt: number;
  status: SessionStatus;
  trades: TradeRecord[];
}

export interface SessionWalletInfo {
  publicKey: PublicKey;
  createdAt: number;
  expiresAt: number;
  fundedAmount: number;
}

export interface SessionManagerConfig {
  /** Min/max session duration in ms. Default [480000, 720000] (8-12 min) */
  sessionDurationRange: [number, number];
  /** Max concurrent ephemeral wallets. Default 3 */
  maxConcurrentSessions: number;
  /** Minimum SOL per session wallet. Default 0.1 */
  minSplitSol: number;
  /** Vault program ID */
  vaultProgramId: PublicKey;
}

export interface ShieldedPathConfig {
  /** Privacy program ID */
  privacyProgramId: PublicKey;
  /** Shielded pool PDA */
  poolPDA: PublicKey;
  /** Whether to route through the shielded pool */
  enabled: boolean;
}

export const DEFAULT_SESSION_CONFIG: Omit<SessionManagerConfig, 'vaultProgramId'> = {
  sessionDurationRange: [480_000, 720_000],
  maxConcurrentSessions: 3,
  minSplitSol: 0.1,
};
