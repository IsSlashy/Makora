'use client';

import { useEffect, useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useVault } from '@/hooks/useVault';
import { useActivityFeed } from '@/hooks/useActivityFeed';

interface TokenBalance {
  symbol: string;
  amount: number;
  value: number;
  percentage: number;
}

export const PortfolioCard = () => {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { vaultState, vaultBalance, currentBalance, availableBalance, inSessionAmount, loading, error, initializeVault, deposit, withdraw, lastTxSig } = useVault();
  const { addActivity } = useActivityFeed();

  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [showActions, setShowActions] = useState(false);
  const [airdropping, setAirdropping] = useState(false);

  // Fetch real SOL balance
  const fetchBalance = useCallback(async () => {
    if (!publicKey) {
      setWalletBalance(0);
      return;
    }
    try {
      const balance = await connection.getBalance(publicKey);
      setWalletBalance(balance / LAMPORTS_PER_SOL);
    } catch (e) {
      console.error('Failed to fetch balance:', e);
    }
  }, [publicKey, connection]);

  useEffect(() => {
    fetchBalance();
    // No polling — OODA loop handles periodic updates to avoid 429 rate limits
  }, [fetchBalance]);

  const totalValue = walletBalance + vaultBalance + inSessionAmount;

  // Build token list from real data
  const tokens: TokenBalance[] = [];
  if (totalValue > 0) {
    if (walletBalance > 0) {
      tokens.push({
        symbol: 'SOL',
        amount: walletBalance,
        value: walletBalance,
        percentage: Math.round((walletBalance / totalValue) * 100),
      });
    }
    if (availableBalance > 0) {
      tokens.push({
        symbol: 'VAULT',
        amount: availableBalance,
        value: availableBalance,
        percentage: Math.round((availableBalance / totalValue) * 100),
      });
    }
    if (inSessionAmount > 0) {
      tokens.push({
        symbol: 'SESSION',
        amount: inSessionAmount,
        value: inSessionAmount,
        percentage: Math.round((inSessionAmount / totalValue) * 100),
      });
    }
  }

  const handleAirdrop = async () => {
    if (!publicKey) return;
    setAirdropping(true);
    try {
      const sig = await connection.requestAirdrop(publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, 'confirmed');
      addActivity({ action: 'Airdropped 2 SOL (devnet)', status: 'success', txSig: sig });
      await fetchBalance();
    } catch (e: any) {
      addActivity({ action: `Airdrop failed: ${e.message?.slice(0, 50)}`, status: 'error' });
    } finally {
      setAirdropping(false);
    }
  };

  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount);
    if (!amount || amount <= 0) return;
    try {
      const tx = await deposit(amount);
      addActivity({ action: `Deposited ${amount} SOL into vault`, status: 'success', txSig: tx });
      setDepositAmount('');
      await fetchBalance();
    } catch (e: any) {
      addActivity({ action: `Deposit failed: ${e.message?.slice(0, 50)}`, status: 'error' });
    }
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount <= 0) return;
    try {
      const tx = await withdraw(amount);
      addActivity({ action: `Withdrew ${amount} SOL from vault`, status: 'success', txSig: tx });
      setWithdrawAmount('');
      await fetchBalance();
    } catch (e: any) {
      addActivity({ action: `Withdraw failed: ${e.message?.slice(0, 50)}`, status: 'error' });
    }
  };

  const handleInitVault = async () => {
    try {
      const tx = await initializeVault();
      addActivity({ action: 'Vault initialized on-chain', status: 'success', txSig: tx });
      await fetchBalance();
    } catch (e: any) {
      addActivity({ action: `Vault init failed: ${e.message?.slice(0, 50)}`, status: 'error' });
    }
  };

  // No wallet connected
  if (!publicKey) {
    return (
      <div className="cursed-card p-5 animate-fade-up">
        <div className="section-title mb-5">Portfolio</div>
        <div className="flex flex-col items-center justify-center py-8">
          <div className="text-text-muted text-xs font-mono tracking-wider uppercase mb-2">
            No wallet connected
          </div>
          <div className="text-[10px] text-text-muted font-mono">
            Connect Phantom or Solflare to begin
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cursed-card p-5 animate-fade-up">
      <div className="flex items-center justify-between mb-5">
        <div className="section-title">Portfolio</div>
        <button
          onClick={handleAirdrop}
          disabled={airdropping}
          className="text-[9px] font-mono tracking-wider px-2 py-1 border border-cursed/20 text-cursed hover:bg-cursed/10 transition-colors uppercase disabled:opacity-50"
        >
          {airdropping ? 'AIRDROPPING...' : 'AIRDROP 2 SOL'}
        </button>
      </div>

      <div className="mb-4">
        <div className="text-3xl font-bold text-text-primary font-mono">
          {totalValue.toFixed(4)} SOL
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-text-muted text-[10px] font-mono">
            Wallet: {walletBalance.toFixed(4)}
          </span>
          {availableBalance > 0 && (
            <>
              <span className="text-text-muted text-[10px]">&middot;</span>
              <span className="text-cursed text-[10px] font-mono">
                Vault: {availableBalance.toFixed(4)}
              </span>
            </>
          )}
          {inSessionAmount > 0 && (
            <>
              <span className="text-text-muted text-[10px]">&middot;</span>
              <span className="text-positive text-[10px] font-mono">
                Session: {inSessionAmount.toFixed(4)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Token bars */}
      <div className="space-y-3">
        {tokens.map((token) => (
          <div key={token.symbol}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-text-primary">{token.symbol}</span>
                <span className="text-[10px] text-text-muted font-mono">
                  {token.amount.toFixed(4)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-text-muted ml-2">{token.percentage}%</span>
              </div>
            </div>
            <div className="relative h-[3px] bg-bg-inner">
              <div
                className="absolute left-0 top-0 h-full transition-all duration-500"
                style={{
                  width: `${token.percentage}%`,
                  background: token.symbol === 'VAULT'
                    ? 'linear-gradient(90deg, #6d28d9, #8b5cf6)'
                    : token.symbol === 'SESSION'
                      ? 'linear-gradient(90deg, #059669, #34d399)'
                      : 'linear-gradient(90deg, #a68520, #d4a829)',
                  boxShadow: token.symbol === 'VAULT'
                    ? '0 0 8px rgba(109, 40, 217, 0.4)'
                    : token.symbol === 'SESSION'
                      ? '0 0 8px rgba(5, 150, 105, 0.4)'
                      : '0 0 8px rgba(212, 168, 41, 0.3)',
                }}
              />
            </div>
          </div>
        ))}
        {tokens.length === 0 && (
          <div className="text-[10px] text-text-muted font-mono text-center py-2">
            No balance — airdrop SOL to get started
          </div>
        )}
      </div>

      <div className="ink-divider mt-4 mb-3" />

      {/* Vault actions */}
      {!vaultState ? (
        <button
          onClick={handleInitVault}
          disabled={loading}
          className="w-full px-3 py-2 text-[10px] font-mono tracking-[0.15em] uppercase bg-cursed/10 border border-cursed/30 text-cursed hover:bg-cursed/20 transition-colors font-bold disabled:opacity-50"
        >
          {loading ? 'INITIALIZING...' : 'INITIALIZE VAULT'}
        </button>
      ) : (
        <>
          <button
            onClick={() => setShowActions(!showActions)}
            className="w-full flex items-center justify-between text-[10px] font-mono text-text-muted tracking-wider uppercase hover:text-cursed transition-colors"
          >
            <span>Vault Actions</span>
            <span>{showActions ? '−' : '+'}</span>
          </button>

          {showActions && (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  placeholder="SOL amount"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="flex-1 px-2 py-1.5 bg-bg-inner border border-cursed/15 text-text-primary text-[11px] font-mono focus:border-cursed/40 outline-none"
                />
                <button
                  onClick={handleDeposit}
                  disabled={loading || !depositAmount}
                  className="px-3 py-1.5 text-[9px] font-mono tracking-wider uppercase bg-positive/10 border border-positive/30 text-positive hover:bg-positive/20 transition-colors disabled:opacity-50"
                >
                  DEPOSIT
                </button>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="SOL amount"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    className="w-full px-2 py-1.5 pr-12 bg-bg-inner border border-cursed/15 text-text-primary text-[11px] font-mono focus:border-cursed/40 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setWithdrawAmount(currentBalance > 0 ? currentBalance.toFixed(4) : '0')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[8px] font-mono tracking-wider text-cursed hover:bg-cursed/10 transition-colors uppercase"
                  >
                    MAX
                  </button>
                </div>
                <button
                  onClick={handleWithdraw}
                  disabled={loading || !withdrawAmount}
                  className="px-3 py-1.5 text-[9px] font-mono tracking-wider uppercase bg-negative/10 border border-negative/30 text-negative hover:bg-negative/20 transition-colors disabled:opacity-50"
                >
                  WITHDRAW
                </button>
              </div>
              {currentBalance > 0 && (
                <div className="text-[9px] text-text-muted font-mono mt-1">
                  Max withdrawable: {currentBalance.toFixed(4)} SOL
                </div>
              )}
            </div>
          )}
        </>
      )}

      {error && (
        <div className="mt-2 text-[9px] text-negative font-mono truncate">{error}</div>
      )}
      {lastTxSig && (
        <div className="mt-2">
          <a
            href={`https://explorer.solana.com/tx/${lastTxSig}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] font-mono text-cursed/70 hover:text-cursed transition-colors truncate block"
          >
            Last tx: {lastTxSig.slice(0, 20)}...
          </a>
        </div>
      )}
    </div>
  );
};
