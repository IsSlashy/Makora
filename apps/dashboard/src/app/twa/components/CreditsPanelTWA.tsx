'use client';

import { useCallback, useEffect, useState } from 'react';

interface CreditTransaction {
  id: string;
  type: 'deposit' | 'usage' | 'bonus';
  amount: number;
  description: string;
  timestamp: number;
  signature?: string;
}

interface CreditsData {
  balance: number;
  totalDeposited: number;
  totalUsed: number;
  history: CreditTransaction[];
  depositAddress: string;
  rate: number;
}

interface CreditsPanelTWAProps {
  userId: string | null;
}

export function CreditsPanelTWA({ userId }: CreditsPanelTWAProps) {
  const [data, setData] = useState<CreditsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [depositing, setDepositing] = useState(false);
  const [depositAmount, setDepositAmount] = useState('0.1');

  const fetchCredits = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/credits?userId=${encodeURIComponent(userId)}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchCredits();
    const interval = setInterval(fetchCredits, 30000);
    return () => clearInterval(interval);
  }, [fetchCredits]);

  const handleDeposit = async () => {
    if (!data?.depositAddress || depositing) return;
    setDepositing(true);

    try {
      const amount = parseFloat(depositAmount);
      if (isNaN(amount) || amount <= 0) {
        alert('Invalid amount');
        setDepositing(false);
        return;
      }

      // Use Privy embedded wallet to send SOL
      // This is handled client-side — the user's embedded Privy wallet signs the tx
      const { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
      const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'https://devnet.helius-rpc.com/?api-key=ad0d91ac-dda3-4906-81ef-37338de04caa';
      const connection = new Connection(rpcUrl, 'confirmed');

      // Get Privy wallet provider via window
      const privy = (window as any).__PRIVY_PROVIDER__;
      if (!privy) {
        alert('Wallet not ready. Please try again.');
        setDepositing(false);
        return;
      }

      alert(`Deposit ${amount} SOL → ${(amount * (data?.rate || 1000)).toFixed(0)} credits\n\nDeposit address: ${data.depositAddress}\n\nNote: In demo mode, deposits are simulated. On mainnet, this would be a real SOL transfer.`);

      // For demo: simulate the deposit by calling the API directly
      // In production, this would sign+send a real Solana tx
      const res = await fetch('/api/credits/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          signature: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          amountSol: amount,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        await fetchCredits();
      } else {
        const err = await res.json();
        alert(`Deposit failed: ${err.error}`);
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    setDepositing(false);
  };

  if (!userId) {
    return (
      <div className="cursed-card p-4">
        <div className="section-title mb-2">CREDITS</div>
        <div className="text-text-muted text-xs font-mono">Login to view credits</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="cursed-card p-4">
        <div className="section-title mb-2">CREDITS</div>
        <div className="text-text-muted text-xs font-mono animate-pulse">Loading credits...</div>
      </div>
    );
  }

  return (
    <div className="cursed-card p-4">
      <div className="section-title mb-3">CREDITS</div>

      {/* Balance */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider">Balance</div>
          <div className="text-2xl font-mono font-bold" style={{ color: '#8b5cf6' }}>
            {(data?.balance ?? 0).toFixed(1)}
          </div>
          <div className="text-[9px] font-mono text-text-muted">credits</div>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-mono text-text-muted">
            Deposited: {(data?.totalDeposited ?? 0).toFixed(4)} SOL
          </div>
          <div className="text-[9px] font-mono text-text-muted">
            Used: {(data?.totalUsed ?? 0).toFixed(1)} credits
          </div>
        </div>
      </div>

      {/* Deposit */}
      <div className="bg-bg-inner p-3 rounded-sm border border-cursed/10 mb-4">
        <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider mb-2">
          Top Up (1 SOL = {data?.rate ?? 1000} credits)
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 flex-1">
            {['0.05', '0.1', '0.5'].map((amt) => (
              <button
                key={amt}
                onClick={() => setDepositAmount(amt)}
                className="flex-1 text-[10px] font-mono py-1.5 rounded-sm border transition-colors"
                style={{
                  borderColor: depositAmount === amt ? '#8b5cf6' : '#1a1a1f',
                  color: depositAmount === amt ? '#8b5cf6' : '#504a60',
                  background: depositAmount === amt ? '#8b5cf610' : 'transparent',
                }}
              >
                {amt} SOL
              </button>
            ))}
          </div>
          <button
            onClick={handleDeposit}
            disabled={depositing}
            className="px-3 py-1.5 rounded-sm font-mono text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, #6d28d9, #8b5cf6)',
              color: '#050508',
            }}
          >
            {depositing ? '...' : 'Deposit'}
          </button>
        </div>
      </div>

      {/* History */}
      {data && data.history.length > 0 && (
        <div>
          <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider mb-2">
            Recent Activity
          </div>
          <div className="space-y-1">
            {data.history.slice(-5).reverse().map((tx) => (
              <div key={tx.id} className="flex items-center justify-between py-1 border-t border-cursed/5">
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-[8px] font-mono font-bold uppercase px-1 py-0.5 rounded-sm"
                    style={{
                      color: tx.type === 'deposit' ? '#22c55e' : tx.type === 'bonus' ? '#8b5cf6' : '#ef4444',
                      background: tx.type === 'deposit' ? '#22c55e12' : tx.type === 'bonus' ? '#8b5cf612' : '#ef444412',
                    }}
                  >
                    {tx.type}
                  </span>
                  <span className="text-[9px] font-mono text-text-muted truncate max-w-[120px]">
                    {tx.description}
                  </span>
                </div>
                <span
                  className="text-[10px] font-mono font-bold"
                  style={{ color: tx.amount >= 0 ? '#22c55e' : '#ef4444' }}
                >
                  {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
