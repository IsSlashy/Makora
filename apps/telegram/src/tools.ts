/**
 * LLM Tool definitions and execution for the Telegram bot.
 * Ported from apps/dashboard/src/app/api/openclaw/chat/route.ts
 * with added swap_tokens tool for direct Jupiter swap execution.
 */

import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
  type Keypair,
} from '@solana/web3.js';
import {
  openSimulatedPosition,
  closeSimulatedPosition,
  getSimulatedPositions,
  clearAllSimulatedPositions,
  setRealPrices,
} from './simulated-perps.js';
import { fetchTokenPrices, MINT_MAP } from './price-feed.js';
import {
  shieldSol,
  unshieldSol,
  getVaultBalance,
  getVaultState,
  formatVaultForLLM,
  runCryptoSelfTest,
  transferToVault,
  transferFromVault,
  deriveVaultKeypair,
  getVaultOnChainBalance,
} from './shielded-vault.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ToolResult {
  tool: string;
  result: string;
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

// ─── Supported Markets ──────────────────────────────────────────────────────

const SUPPORTED_MARKETS = ['SOL-PERP', 'ETH-PERP', 'BTC-PERP'] as const;
type PerpMarket = (typeof SUPPORTED_MARKETS)[number];

const MARKET_TO_SYMBOL: Record<PerpMarket, string> = {
  'SOL-PERP': 'SOL',
  'ETH-PERP': 'WETH',
  'BTC-PERP': 'WBTC',
};

// ─── Tool Definitions (Anthropic format) ────────────────────────────────────

export const ANTHROPIC_TOOLS: AnthropicTool[] = [
  {
    name: 'open_position',
    description:
      'Opens a simulated perpetual futures position. Use this when the user wants to go long or short on SOL, ETH, or BTC.',
    input_schema: {
      type: 'object' as const,
      properties: {
        market: {
          type: 'string' as const,
          enum: ['SOL-PERP', 'ETH-PERP', 'BTC-PERP'],
          description: 'The perpetual futures market to trade.',
        },
        side: {
          type: 'string' as const,
          enum: ['long', 'short'],
          description: 'Whether to go long (buy) or short (sell).',
        },
        leverage: {
          type: 'number' as const,
          description: 'Leverage multiplier (1-50). Default 5.',
        },
        percent_of_vault: {
          type: 'number' as const,
          description:
            'Percentage of wallet balance to use as collateral (1-100). Default 25.',
        },
      },
      required: ['market', 'side'],
    },
  },
  {
    name: 'close_position',
    description:
      'Closes an open simulated perpetual futures position in a specific market.',
    input_schema: {
      type: 'object' as const,
      properties: {
        market: {
          type: 'string' as const,
          enum: ['SOL-PERP', 'ETH-PERP', 'BTC-PERP'],
          description: 'The perpetual futures market to close.',
        },
      },
      required: ['market'],
    },
  },
  {
    name: 'close_all_positions',
    description: 'Closes ALL open simulated perpetual futures positions at once.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'get_positions',
    description:
      'Returns all currently open simulated perp positions with their P&L.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'get_portfolio',
    description:
      'Returns the wallet SOL balance and a summary of open positions.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'swap_tokens',
    description:
      'Swaps tokens on Solana using Jupiter aggregator. Executes REAL on-chain swap. Use for "invest in SOL", "buy SOL", "swap USDC to SOL", "classic invest" etc. This is SPOT buying — NOT leveraged perps.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from_token: {
          type: 'string' as const,
          description: 'The token symbol to sell (e.g., SOL, USDC, mSOL).',
        },
        to_token: {
          type: 'string' as const,
          description: 'The token symbol to buy (e.g., USDC, SOL, mSOL).',
        },
        amount: {
          type: 'number' as const,
          description: 'The amount to swap in the from_token denomination.',
        },
      },
      required: ['from_token', 'to_token', 'amount'],
    },
  },
  {
    name: 'shield_sol',
    description:
      'Shields SOL from the wallet into the ZK-private vault. Must be done before trading. The vault is used for all trading operations — the main wallet is never touched directly.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount_sol: {
          type: 'number' as const,
          description: 'Amount of SOL to shield into the vault.',
        },
        percent_of_wallet: {
          type: 'number' as const,
          description: 'Percentage of wallet balance to shield (1-100). Use this OR amount_sol.',
        },
      },
      required: [],
    },
  },
  {
    name: 'unshield_sol',
    description:
      'Withdraws SOL from the ZK vault back to the main wallet.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount_sol: {
          type: 'number' as const,
          description: 'Amount of SOL to unshield from the vault.',
        },
        percent_of_vault: {
          type: 'number' as const,
          description: 'Percentage of vault balance to unshield (1-100). Use this OR amount_sol.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_vault',
    description:
      'Returns the current ZK shielded vault balance and history. The vault holds the funds used for trading.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
];

// OpenAI tool definitions (function calling format)
export const OPENAI_TOOLS = ANTHROPIC_TOOLS.map((tool) => ({
  type: 'function' as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  },
}));

// ─── Execution Context ──────────────────────────────────────────────────────

export interface ToolExecutionContext {
  connection: Connection;
  wallet: Keypair;
  walletSolBalance: number;
}

// ─── Token decimals ─────────────────────────────────────────────────────────

const TOKEN_DECIMALS: Record<string, number> = {
  SOL: 9,
  USDC: 6,
  mSOL: 9,
  JitoSOL: 9,
  JUPSOL: 9,
  BONK: 5,
  RAY: 6,
  WBTC: 8,
  WETH: 8,
  JLP: 6,
};

// ─── Tool Execution ───────────────────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<string> {
  try {
    switch (toolName) {
      case 'open_position': {
        const market = toolInput.market as PerpMarket;
        const side = toolInput.side as 'long' | 'short';
        const leverage = Math.min(Math.max(Number(toolInput.leverage) || 5, 1), 50);
        const percentOfVault = Math.min(
          Math.max(Number(toolInput.percent_of_vault) || 25, 1),
          100,
        );

        if (!SUPPORTED_MARKETS.includes(market)) {
          return `Error: Invalid market "${market}". Supported: ${SUPPORTED_MARKETS.join(', ')}`;
        }

        // Check vault balance first — trading uses vault, not wallet
        // Use on-chain balance as source of truth (survives bot restarts)
        const vaultOnChainBal = await getVaultOnChainBalance(ctx.connection, ctx.wallet);
        const vaultBal = Math.max(vaultOnChainBal, getVaultBalance());
        if (vaultBal <= 0) {
          return `Error: ZK vault is empty. Shield SOL first using shield_sol before trading. Wallet balance: ${ctx.walletSolBalance.toFixed(4)} SOL.`;
        }

        // Fetch current price for the underlying asset
        const priceSymbol = MARKET_TO_SYMBOL[market];
        const prices = await fetchTokenPrices([priceSymbol, 'SOL']);
        const entryPrice = prices[priceSymbol] || 0;
        const solPrice = prices.SOL || 77;

        // Feed real prices to simulated positions
        const priceUpdate: Record<string, number> = {};
        if (prices.SOL) priceUpdate.SOL = prices.SOL;
        if (prices.WETH) priceUpdate.ETH = prices.WETH;
        if (prices.WBTC) priceUpdate.BTC = prices.WBTC;
        setRealPrices(priceUpdate);

        if (entryPrice <= 0) {
          return `Error: Could not fetch price for ${priceSymbol}. Try again.`;
        }

        // Calculate collateral from VAULT balance (not wallet)
        const collateralUsd = (percentOfVault / 100) * vaultBal * solPrice;

        if (collateralUsd < 0.01) {
          return `Error: Vault balance too low. Vault: ${vaultBal.toFixed(4)} SOL ($${(vaultBal * solPrice).toFixed(2)}). Cannot open position with $${collateralUsd.toFixed(2)} collateral.`;
        }

        // Check for existing position in this market
        const existing = getSimulatedPositions().find((p) => p.market === market);
        if (existing) {
          return `Error: Already have an open ${existing.side.toUpperCase()} ${market} position ($${existing.collateralUsd.toFixed(2)} at ${existing.leverage}x). Close it first or pick a different market.`;
        }

        const position = openSimulatedPosition({
          market,
          side,
          collateralUsd,
          leverage,
          entryPrice,
        });

        const notionalUsd = collateralUsd * leverage;
        return `Opened ${side.toUpperCase()} ${market} position:\n- Collateral: $${collateralUsd.toFixed(2)} (${percentOfVault}% of vault)\n- Leverage: ${leverage}x\n- Notional: $${notionalUsd.toFixed(2)}\n- Entry price: $${entryPrice.toFixed(2)}\n- Position ID: ${position.id}\n- Source: ZK Shielded Vault`;
      }

      case 'close_position': {
        const market = toolInput.market as PerpMarket;

        if (!SUPPORTED_MARKETS.includes(market)) {
          return `Error: Invalid market "${market}". Supported: ${SUPPORTED_MARKETS.join(', ')}`;
        }

        const closed = closeSimulatedPosition(market, 100);
        if (!closed) {
          return `No open position found in ${market}. Nothing to close.`;
        }

        const pnlSign = (closed.unrealizedPnlPct ?? 0) >= 0 ? '+' : '';
        return `Closed ${closed.side.toUpperCase()} ${market} position:\n- Collateral was: $${closed.collateralUsd.toFixed(2)} at ${closed.leverage}x\n- Entry price: $${closed.entryPrice.toFixed(2)}\n- P&L: ${pnlSign}${(closed.unrealizedPnlPct ?? 0).toFixed(2)}% ($${pnlSign}${(closed.unrealizedPnl ?? 0).toFixed(2)})`;
      }

      case 'close_all_positions': {
        const positions = getSimulatedPositions();
        if (positions.length === 0) {
          return 'No open positions to close.';
        }

        const count = positions.length;
        const totalPnl = positions.reduce(
          (sum, p) => sum + (p.unrealizedPnl ?? 0),
          0,
        );
        clearAllSimulatedPositions();

        const pnlSign = totalPnl >= 0 ? '+' : '';
        return `Closed all ${count} position(s). Total realized P&L: ${pnlSign}$${totalPnl.toFixed(2)}`;
      }

      case 'get_positions': {
        const positions = getSimulatedPositions();
        if (positions.length === 0) {
          return 'No open perp positions.';
        }

        const lines = [`Open positions (${positions.length}):`];
        for (const p of positions) {
          const pnlSign = (p.unrealizedPnlPct ?? 0) >= 0 ? '+' : '';
          const hoursOpen = (
            (Date.now() - p.openedAt) /
            (1000 * 60 * 60)
          ).toFixed(1);
          lines.push(
            `- ${p.side.toUpperCase()} ${p.market} ${p.leverage}x: $${p.collateralUsd.toFixed(2)} collateral, Entry $${p.entryPrice.toFixed(2)}, Current $${(p.currentPrice ?? 0).toFixed(2)}, P&L ${pnlSign}${(p.unrealizedPnlPct ?? 0).toFixed(2)}% (${hoursOpen}h)`,
          );
        }
        return lines.join('\n');
      }

      case 'get_portfolio': {
        const prices = await fetchTokenPrices(['SOL']);
        const solPrice = prices.SOL || 77;

        // Real on-chain balances (wallet already reduced after shield transfers)
        const walletBalance = ctx.walletSolBalance;
        const vaultOnChain = await getVaultOnChainBalance(ctx.connection, ctx.wallet);
        const totalOnChain = walletBalance + vaultOnChain;

        const positions = getSimulatedPositions();
        const totalCollateral = positions.reduce(
          (sum, p) => sum + p.collateralUsd,
          0,
        );
        const totalPnl = positions.reduce(
          (sum, p) => sum + (p.unrealizedPnl ?? 0),
          0,
        );

        const vaultKp = deriveVaultKeypair(ctx.wallet);
        const lines = [
          `Portfolio Summary:`,
          `- Main Wallet: ${walletBalance.toFixed(4)} SOL ($${(walletBalance * solPrice).toFixed(2)})`,
          `- ZK Vault: ${vaultOnChain.toFixed(4)} SOL ($${(vaultOnChain * solPrice).toFixed(2)})`,
          `  Vault address: ${vaultKp.publicKey.toBase58().slice(0, 8)}...${vaultKp.publicKey.toBase58().slice(-6)}`,
          `- Total: ${totalOnChain.toFixed(4)} SOL ($${(totalOnChain * solPrice).toFixed(2)})`,
          `- SOL Price: $${solPrice.toFixed(2)}`,
          `- Open Perp Positions: ${positions.length}`,
        ];
        if (positions.length > 0) {
          lines.push(
            `- Total Collateral Deployed: $${totalCollateral.toFixed(2)}`,
          );
          const pnlSign = totalPnl >= 0 ? '+' : '';
          lines.push(
            `- Unrealized P&L: ${pnlSign}$${totalPnl.toFixed(2)}`,
          );
        }
        if (vaultOnChain === 0) {
          lines.push(`\nTip: Shield SOL into your vault to start trading.`);
        }
        return lines.join('\n');
      }

      case 'swap_tokens': {
        const fromSymbol = (toolInput.from_token as string || '').toUpperCase();
        const toSymbol = (toolInput.to_token as string || '').toUpperCase();
        const amount = Number(toolInput.amount);

        if (!amount || amount <= 0) {
          return 'Error: Invalid swap amount.';
        }

        const inputMint = MINT_MAP[fromSymbol];
        const outputMint = MINT_MAP[toSymbol];

        if (!inputMint) return `Error: Unknown token "${fromSymbol}". Supported: ${Object.keys(MINT_MAP).join(', ')}`;
        if (!outputMint) return `Error: Unknown token "${toSymbol}". Supported: ${Object.keys(MINT_MAP).join(', ')}`;

        const decimals = TOKEN_DECIMALS[fromSymbol] ?? 9;
        const rawAmount = Math.floor(amount * 10 ** decimals);

        // 1. Get Jupiter quote
        const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${rawAmount}&slippageBps=50`;
        const quoteRes = await fetch(quoteUrl, { signal: AbortSignal.timeout(10_000) });
        if (!quoteRes.ok) {
          const errText = await quoteRes.text().catch(() => '');
          return `Error: Jupiter quote failed (${quoteRes.status}): ${errText.slice(0, 100)}`;
        }
        const quoteData = await quoteRes.json();

        const outDecimals = TOKEN_DECIMALS[toSymbol] ?? 9;
        const expectedOutput = Number(quoteData.outAmount) / 10 ** outDecimals;

        // 2. Get swap transaction
        const swapRes = await fetch('https://api.jup.ag/swap/v1/swap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quoteResponse: quoteData,
            userPublicKey: ctx.wallet.publicKey.toBase58(),
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 'auto',
          }),
          signal: AbortSignal.timeout(15_000),
        });

        if (!swapRes.ok) {
          const errText = await swapRes.text().catch(() => '');
          return `Error: Jupiter swap API failed (${swapRes.status}): ${errText.slice(0, 100)}`;
        }

        const swapData = await swapRes.json();
        const swapTxBase64 = swapData.swapTransaction;

        if (!swapTxBase64) {
          return 'Error: No swap transaction returned from Jupiter.';
        }

        // 3. Deserialize, sign, and send
        const txBuffer = Buffer.from(swapTxBase64, 'base64');
        const transaction = VersionedTransaction.deserialize(txBuffer);
        transaction.sign([ctx.wallet]);

        const rawTx = transaction.serialize();
        const sig = await ctx.connection.sendRawTransaction(rawTx, {
          skipPreflight: false,
          maxRetries: 2,
        });

        // 4. Confirm
        const latestBlock = await ctx.connection.getLatestBlockhash();
        await ctx.connection.confirmTransaction({
          signature: sig,
          blockhash: latestBlock.blockhash,
          lastValidBlockHeight: latestBlock.lastValidBlockHeight,
        });

        return `Swap executed: ${amount} ${fromSymbol} -> ~${expectedOutput.toFixed(6)} ${toSymbol}\nSignature: ${sig}`;
      }

      case 'shield_sol': {
        const prices = await fetchTokenPrices(['SOL']);
        const solPrice = prices.SOL || 77;

        // Keep 0.01 SOL reserve for fees
        const reserve = 0.01;
        const availableToShield = Math.max(0, ctx.walletSolBalance - reserve);

        let amountSol: number;
        if (toolInput.percent_of_wallet) {
          const pct = Math.min(Math.max(Number(toolInput.percent_of_wallet), 1), 100);
          amountSol = (pct / 100) * availableToShield;
        } else if (toolInput.amount_sol) {
          amountSol = Number(toolInput.amount_sol);
        } else {
          amountSol = availableToShield;
        }

        if (amountSol > availableToShield) {
          return `Error: Cannot shield ${amountSol.toFixed(4)} SOL — only ${availableToShield.toFixed(4)} SOL available (keeping ${reserve} SOL for tx fees).`;
        }

        if (amountSol <= 0) {
          return `Error: Nothing to shield. Wallet balance: ${ctx.walletSolBalance.toFixed(4)} SOL.`;
        }

        // 1. Real on-chain transfer: wallet → vault address
        let txSignature: string;
        let vaultAddress: string;
        try {
          const txResult = await transferToVault(ctx.connection, ctx.wallet, amountSol);
          txSignature = txResult.signature;
          vaultAddress = txResult.vaultAddress;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Error: On-chain shield transfer failed: ${msg}`;
        }

        // 2. Record ZK commitment in local state
        const result = shieldSol(amountSol);
        if (!result.success) {
          return `Error: ZK commitment failed after on-chain transfer: ${result.error}`;
        }

        const usdValue = amountSol * solPrice;
        return [
          `ZK Shield complete:`,
          `- Shielded: ${amountSol.toFixed(4)} SOL ($${usdValue.toFixed(2)})`,
          `- Vault address: ${vaultAddress.slice(0, 8)}...${vaultAddress.slice(-6)}`,
          `- TX: ${txSignature.slice(0, 12)}...`,
          `- Commitment: ${result.commitment.slice(0, 16)}...`,
          `- Nullifier: ${result.nullifier.slice(0, 16)}...`,
          `- Merkle leaf: #${result.leafIndex}`,
          `- Merkle root: ${result.merkleRoot.slice(0, 16)}...`,
          `- Vault balance: ${result.newBalanceSol.toFixed(4)} SOL ($${(result.newBalanceSol * solPrice).toFixed(2)})`,
          ``,
          `On-chain transfer confirmed. Crypto: SHA-256 + Merkle tree.`,
        ].join('\n');
      }

      case 'unshield_sol': {
        const prices = await fetchTokenPrices(['SOL']);
        const solPrice = prices.SOL || 77;
        const vaultBal = getVaultBalance();

        let amountSol: number;
        if (toolInput.percent_of_vault) {
          const pct = Math.min(Math.max(Number(toolInput.percent_of_vault), 1), 100);
          amountSol = (pct / 100) * vaultBal;
        } else if (toolInput.amount_sol) {
          amountSol = Number(toolInput.amount_sol);
        } else {
          amountSol = vaultBal;
        }

        // 1. Verify ZK state (nullifiers, Merkle proofs)
        const result = unshieldSol(amountSol);
        if (!result.success) {
          return `Error: ${result.error}`;
        }

        // 2. Real on-chain transfer: vault address → wallet
        let txSignature: string;
        let vaultAddress: string;
        try {
          const txResult = await transferFromVault(ctx.connection, ctx.wallet, amountSol);
          txSignature = txResult.signature;
          vaultAddress = txResult.vaultAddress;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Error: ZK proofs verified but on-chain transfer failed: ${msg}`;
        }

        const usdValue = amountSol * solPrice;
        return [
          `ZK Unshield complete:`,
          `- Unshielded: ${amountSol.toFixed(4)} SOL ($${usdValue.toFixed(2)})`,
          `- TX: ${txSignature.slice(0, 12)}...`,
          `- Nullifier revealed: ${result.nullifier.slice(0, 16)}...`,
          `- Merkle proof: ${result.proofValid ? 'VALID' : 'INVALID'}`,
          `- Merkle root: ${result.merkleRoot.slice(0, 16)}...`,
          `- Remaining vault: ${result.newBalanceSol.toFixed(4)} SOL`,
          ``,
          `On-chain transfer confirmed. Double-spend check: passed.`,
        ].join('\n');
      }

      case 'get_vault': {
        const prices = await fetchTokenPrices(['SOL']);
        const solPrice = prices.SOL || 77;
        const vault = getVaultState();
        const usdValue = vault.balanceSol * solPrice;
        const vaultKp = deriveVaultKeypair(ctx.wallet);
        const onChainBal = await getVaultOnChainBalance(ctx.connection, ctx.wallet);

        if (vault.balanceSol === 0 && vault.totalShieldedSol === 0) {
          return `ZK Vault: Empty\nVault address: ${vaultKp.publicKey.toBase58()}\nOn-chain balance: ${onChainBal.toFixed(4)} SOL\n\nShield SOL first to start trading. Your main wallet has ${ctx.walletSolBalance.toFixed(4)} SOL.`;
        }

        const lines = [
          `ZK Shielded Vault:`,
          `- Vault address: ${vaultKp.publicKey.toBase58()}`,
          `- Balance: ${vault.balanceSol.toFixed(4)} SOL ($${usdValue.toFixed(2)})`,
          `- On-chain vault balance: ${onChainBal.toFixed(4)} SOL`,
          `- Total shielded: ${vault.totalShieldedSol.toFixed(4)} SOL`,
          `- Total unshielded: ${vault.totalUnshieldedSol.toFixed(4)} SOL`,
          ``,
          `Cryptographic State:`,
          `- Merkle root: ${vault.merkleRoot.slice(0, 20)}...`,
          `- Notes: ${vault.noteCount} (unspent + spent)`,
          `- Nullifiers spent: ${vault.nullifierCount}`,
          `- Hash: SHA-256 (@noble/hashes)`,
          `- Tree depth: 16 (capacity: 65536 notes)`,
        ];

        if (vault.history.length > 0) {
          const last = vault.history[vault.history.length - 1];
          const ago = ((Date.now() - last.timestamp) / 60_000).toFixed(0);
          lines.push(`- Last op: ${last.type} ${last.amountSol.toFixed(4)} SOL (${ago}m ago)`);
        }

        return lines.join('\n');
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Tool execution error';
    return `Error executing ${toolName}: ${msg}`;
  }
}
