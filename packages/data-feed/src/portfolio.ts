import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { TokenBalance, PortfolioState, TokenInfo, SolanaCluster } from '@makora/types';
import { JupiterPriceFeed } from './price-feed.js';
import { getKnownTokens, findTokenByMint, NATIVE_SOL_MINT } from './tokens.js';

/**
 * Reads the full portfolio state for a wallet.
 *
 * Fetches:
 * 1. Native SOL balance
 * 2. All SPL token accounts
 * 3. USD prices for each token
 */
export class PortfolioReader {
  private connection: Connection;
  private priceFeed: JupiterPriceFeed;
  private cluster: SolanaCluster;

  constructor(connection: Connection, cluster: SolanaCluster) {
    this.connection = connection;
    this.priceFeed = new JupiterPriceFeed();
    this.cluster = cluster;
  }

  /**
   * Get the full portfolio state for a wallet.
   */
  async getPortfolio(owner: PublicKey): Promise<PortfolioState> {
    const balances: TokenBalance[] = [];
    const knownTokens = getKnownTokens(this.cluster);

    // 1. Fetch native SOL balance
    const solLamports = await this.connection.getBalance(owner);
    const solToken = knownTokens.find((t) => t.symbol === 'SOL');

    if (solToken) {
      balances.push({
        token: solToken,
        rawBalance: BigInt(solLamports),
        uiBalance: solLamports / LAMPORTS_PER_SOL,
        usdValue: 0, // Will be set after price fetch
        priceUsd: 0,
      });
    }

    // 2. Fetch SPL token accounts
    try {
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(owner, {
        programId: TOKEN_PROGRAM_ID,
      });

      for (const account of tokenAccounts.value) {
        const parsed = account.account.data.parsed;
        if (parsed.type !== 'account') continue;

        const info = parsed.info;
        const mint = new PublicKey(info.mint);
        const amount = info.tokenAmount;

        // Skip zero balances
        if (amount.uiAmount === 0) continue;

        // Try to find token info in our registry
        let tokenInfo = findTokenByMint(mint, this.cluster);
        if (!tokenInfo) {
          // Unknown token -- create minimal info
          tokenInfo = {
            symbol: mint.toBase58().slice(0, 4) + '...',
            name: 'Unknown Token',
            mint,
            decimals: amount.decimals,
          };
        }

        balances.push({
          token: tokenInfo,
          rawBalance: BigInt(amount.amount),
          uiBalance: amount.uiAmount,
          usdValue: 0,
          priceUsd: 0,
        });
      }
    } catch (err) {
      console.warn('Failed to fetch SPL token accounts:', err);
    }

    // 3. Fetch USD prices for all tokens
    const mints = balances.map((b) => b.token.mint);
    const prices = await this.priceFeed.getPrices(mints);

    let totalValueUsd = 0;

    for (const balance of balances) {
      const mintStr = balance.token.mint.toBase58();
      const price = prices.get(mintStr);

      if (price) {
        balance.priceUsd = price.priceUsd;
        balance.usdValue = balance.uiBalance * price.priceUsd;
      }

      totalValueUsd += balance.usdValue;
    }

    // Sort by USD value (highest first)
    balances.sort((a, b) => b.usdValue - a.usdValue);

    return {
      owner,
      balances,
      totalValueUsd,
      solBalance: balances.find((b) => b.token.symbol === 'SOL')?.uiBalance ?? 0,
      lastUpdated: Date.now(),
    };
  }
}
