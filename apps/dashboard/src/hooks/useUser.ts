'use client';

import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useMemo } from 'react';

export interface MakoraUser {
  /** Privy user ID (e.g., 'did:privy:...') */
  userId: string | null;
  /** Display name — email, phone, or wallet abbreviation */
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
 * Works inside PrivyProvider.
 */
export function useUser(): MakoraUser {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();

  return useMemo(() => {
    // Find the Privy embedded wallet
    const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');
    const walletAddress = embeddedWallet?.address ?? '';

    let displayName = '';
    if (user?.email?.address) {
      displayName = user.email.address;
    } else if (user?.phone?.number) {
      displayName = user.phone.number;
    } else if (walletAddress) {
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
  }, [ready, authenticated, user, wallets, login, logout]);
}
