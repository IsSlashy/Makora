'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useMemo } from 'react';

export interface MakoraUser {
  /** Privy user ID (e.g., 'did:privy:...') */
  userId: string | null;
  /** Display name — abbreviated wallet address */
  displayName: string;
  /** Solana wallet address from Privy embedded wallet */
  walletAddress: string;
  /** Whether the user is authenticated */
  authenticated: boolean;
  /** Whether we're still loading auth state */
  loading: boolean;
  /** Privy login function */
  login: () => void;
  /** Privy logout function */
  logout: () => Promise<void>;
}

/**
 * Combines Privy auth + embedded wallet into a single user context.
 * Uses user.linkedAccounts to find the Solana embedded wallet
 * (useWallets() only returns EVM wallets).
 */
export function useUser(): MakoraUser {
  const { ready, authenticated, user, login, logout } = usePrivy();

  return useMemo(() => {
    // Find the Solana embedded wallet from linkedAccounts
    // useWallets() only returns EVM wallets — Solana wallets are in linkedAccounts
    let walletAddress = '';
    if (user?.linkedAccounts) {
      const solanaWallet = (user.linkedAccounts as any[]).find(
        (a) => a.type === 'wallet' && a.chainType === 'solana' && a.walletClientType === 'privy',
      );
      if (solanaWallet?.address) {
        walletAddress = solanaWallet.address;
      }
    }

    // Display name: always show wallet address abbreviation (not email)
    let displayName = '';
    if (walletAddress) {
      displayName = `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
    }

    return {
      userId: user?.id ?? null,
      displayName,
      walletAddress,
      authenticated: authenticated && ready,
      loading: !ready,
      login,
      logout,
    };
  }, [ready, authenticated, user, login, logout]);
}
