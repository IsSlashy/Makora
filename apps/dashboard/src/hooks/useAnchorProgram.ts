'use client';

import { useMemo } from 'react';
import { useConnection, useAnchorWallet } from '@solana/wallet-adapter-react';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

import vaultIdl from '@/idl/makora_vault.json';
import strategyIdl from '@/idl/makora_strategy.json';

export const VAULT_PROGRAM_ID = new PublicKey('BTAd1ghiv4jKd4kREh14jCtHrVG6zDFNgLRNoF9pUgqw');
export const STRATEGY_PROGRAM_ID = new PublicKey('EH5sixTHAoLsdFox1bR3YUqgwf5VuX2BdXFew5wTE6dj');
export const PRIVACY_PROGRAM_ID = new PublicKey('C1qXFsB6oJgZLQnXwRi9mwrm3QshKMU8kGGUZTAa9xcM');

export function useAnchorProvider() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  return useMemo(() => {
    if (!wallet) return null;
    return new AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    });
  }, [connection, wallet]);
}

export function useVaultProgram() {
  const provider = useAnchorProvider();

  return useMemo(() => {
    if (!provider) return null;
    return new Program(vaultIdl as any, provider);
  }, [provider]);
}

export function useStrategyProgram() {
  const provider = useAnchorProvider();

  return useMemo(() => {
    if (!provider) return null;
    return new Program(strategyIdl as any, provider);
  }, [provider]);
}

/** Derive vault PDA for a given owner */
export function getVaultPDA(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), owner.toBuffer()],
    VAULT_PROGRAM_ID
  );
}

/** Derive strategy PDA for a given owner */
export function getStrategyPDA(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('strategy'), owner.toBuffer()],
    STRATEGY_PROGRAM_ID
  );
}

/** Derive audit trail PDA for a given owner */
export function getAuditTrailPDA(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('audit'), owner.toBuffer()],
    STRATEGY_PROGRAM_ID
  );
}
