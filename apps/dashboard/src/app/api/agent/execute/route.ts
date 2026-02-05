import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from '@solana/web3.js';
import {
  sendTransactionViaJito,
  isJitoSupported,
  DEFAULT_JITO_CONFIG,
  URGENT_JITO_CONFIG,
  type JitoConfig,
} from '../../../../lib/jito';
import {
  PERP_MARKETS,
  buildOpenPositionTx,
  buildClosePositionTx,
  type PerpMarket,
  type PerpOrderParams,
  type PerpCloseParams,
} from '../../../../lib/jupiter-perps';
import {
  openSimulatedPosition,
  closeSimulatedPosition,
  hasOpenPosition,
  getPositionForMarket,
} from '../../../../lib/simulated-perps';

// ─── Token Mints ─────────────────────────────────────────────────────────────
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MSOL_MINT = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So';

const JLP_MINT = '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4';
const JUPSOL_MINT = 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjkRE4' ;
const JITOSOL_MINT = 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn';
const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const RAY_MINT = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';
const WBTC_MINT = '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh';
const WETH_MINT = '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs';

const TOKEN_MINTS: Record<string, string> = {
  SOL: SOL_MINT,
  USDC: USDC_MINT,
  mSOL: MSOL_MINT,
  MSOL: MSOL_MINT,
  JLP: JLP_MINT,
  JUPSOL: JUPSOL_MINT,
  JITOSOL: JITOSOL_MINT,
  BONK: BONK_MINT,
  RAY: RAY_MINT,
  WBTC: WBTC_MINT,
  WETH: WETH_MINT,
};

/** Minimum trade size: 0.005 SOL = 5,000,000 lamports */
const MIN_TRADE_LAMPORTS = 5_000_000;

const JUPITER_API = process.env.JUPITER_API_URL || 'https://api.jup.ag/swap/v1';
const JUPITER_API_KEY = process.env.JUPITER_API_KEY || '';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AllocationSlot {
  protocol: string;
  symbol: string;
  pct: number;
  expectedApy: number;
  strategyTag: string;
  risk: string;
  leverage?: number; // For perps: 1-100x leverage
}

interface RiskLimits {
  maxPositionSizePct: number;
  maxSlippageBps: number;
  maxDailyLossPct: number;
  minSolReserve: number;
  maxProtocolExposurePct: number;
}

interface PositionInfo {
  symbol: string;
  mint: string;
  balance: number; // raw lamports/smallest unit
  uiAmount: number;
  decimals: number;
}

interface ExecuteRequest {
  allocation: AllocationSlot[];
  walletPublicKey: string;
  riskLimits: RiskLimits;
  confidence: number;
  dryRun?: boolean;
  portfolioValueSol?: number;
  signingMode?: 'agent' | 'wallet'; // 'wallet' = return unsigned tx for client signing
  positions?: PositionInfo[]; // current holdings for sell orders
  // Budget enforcement
  budgetLimitSol?: number; // User's hard budget limit for the session
  spentSol?: number; // Amount already spent in this session
  // Jito fast execution
  useJito?: boolean; // Enable Jito low-latency transaction sending
  jitoUrgent?: boolean; // Use higher tip for time-sensitive trades (perps, liquidations)
  // Trading mode
  tradingMode?: 'invest' | 'perps'; // Trading mode for strategy filtering
}

interface ExecutionResultEntry {
  action: string;
  protocol: string;
  signature?: string;
  success: boolean;
  error?: string;
  simulated?: boolean;
  unsignedTx?: string; // base64-encoded serialized VersionedTransaction (wallet mode)
  riskAssessment: {
    approved: boolean;
    riskScore: number;
    summary: string;
  };
  quote?: {
    inputAmount: string;
    expectedOutput: string;
    priceImpactPct: number;
  };
}

// ─── Risk Validation (inline, simplified from @makora/risk-manager) ──────────

function validateAction(
  slot: AllocationSlot,
  limits: RiskLimits,
  portfolioValueSol: number,
): { approved: boolean; riskScore: number; summary: string } {
  const checks: Array<{ name: string; passed: boolean; msg: string }> = [];

  // Position size check
  const positionPassed = slot.pct <= limits.maxPositionSizePct;
  checks.push({
    name: 'position_size',
    passed: positionPassed,
    msg: positionPassed
      ? `Position ${slot.pct}% within ${limits.maxPositionSizePct}% limit`
      : `Position ${slot.pct}% exceeds ${limits.maxPositionSizePct}% limit`,
  });

  // Protocol exposure check
  const exposurePassed = slot.pct <= limits.maxProtocolExposurePct;
  checks.push({
    name: 'protocol_exposure',
    passed: exposurePassed,
    msg: exposurePassed
      ? `Protocol exposure ${slot.pct}% within ${limits.maxProtocolExposurePct}% limit`
      : `Protocol exposure ${slot.pct}% exceeds ${limits.maxProtocolExposurePct}% limit`,
  });

  // SOL reserve check (ensure we keep minimum SOL for gas)
  const tradeValueSol = (slot.pct / 100) * portfolioValueSol;
  const reserveOk = portfolioValueSol - tradeValueSol >= limits.minSolReserve;
  checks.push({
    name: 'sol_reserve',
    passed: reserveOk,
    msg: reserveOk
      ? `SOL reserve maintained above ${limits.minSolReserve} SOL`
      : `Trade would leave insufficient SOL reserve (need ${limits.minSolReserve} SOL)`,
  });

  const allPassed = checks.every(c => c.passed);
  const failedCount = checks.filter(c => !c.passed).length;
  const riskScore = Math.min(100, failedCount * 30 + (slot.pct > 40 ? 15 : 0));

  return {
    approved: allPassed,
    riskScore,
    summary: allPassed
      ? `All ${checks.length} risk checks passed. Score: ${riskScore}/100`
      : `REJECTED: ${checks.filter(c => !c.passed).map(c => c.msg).join('; ')}`,
  };
}

// ─── Jupiter Integration ─────────────────────────────────────────────────────

function jupiterHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (JUPITER_API_KEY) h['x-api-key'] = JUPITER_API_KEY;
  return h;
}

async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amountLamports: number,
  slippageBps: number,
): Promise<{ quote: any; error?: string }> {
  try {
    const url = `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps}`;
    const res = await fetch(url, { headers: jupiterHeaders() });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { quote: null, error: `Jupiter quote error ${res.status}: ${text.slice(0, 200)}` };
    }
    const quote = await res.json();
    return { quote };
  } catch (err) {
    return { quote: null, error: err instanceof Error ? err.message : 'Jupiter quote failed' };
  }
}

async function getJupiterSwapTransaction(
  quote: any,
  userPublicKey: string,
): Promise<{ transaction: VersionedTransaction | null; error?: string }> {
  try {
    const res = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...jupiterHeaders() },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            priorityLevel: 'medium',
            maxLamports: 5_000_000,
          },
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { transaction: null, error: `Jupiter swap error ${res.status}: ${text.slice(0, 200)}` };
    }

    const data = await res.json();
    if (!data.swapTransaction) {
      return { transaction: null, error: 'Jupiter returned empty swap transaction' };
    }

    const txBuf = Buffer.from(data.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(new Uint8Array(txBuf));
    return { transaction };
  } catch (err) {
    return { transaction: null, error: err instanceof Error ? err.message : 'Jupiter swap failed' };
  }
}

// ─── Trade Mapping ───────────────────────────────────────────────────────────

/**
 * Parse symbols that may contain arrow notation (e.g. "SOL->USDC", "SOL->JUPSOL")
 * Returns the target token symbol.
 */
function parseTargetSymbol(symbol: string): string {
  // Handle arrow notation: "SOL->USDC", "SOL->mSOL", "SOL -> JLP"
  const arrowMatch = symbol.match(/->|→/);
  if (arrowMatch) {
    const parts = symbol.split(arrowMatch[0]);
    return parts[parts.length - 1].trim().toUpperCase();
  }
  return symbol.toUpperCase();
}

/**
 * Resolve the output mint for a given strategy + symbol combination.
 * This is the core mapping that converts LLM allocation intent into a concrete Jupiter swap.
 */
function resolveOutputMint(strategyTag: string, symbol: string): string | null {
  const target = parseTargetSymbol(symbol);

  // Direct token match
  const directMint = TOKEN_MINTS[target];
  if (directMint && directMint !== SOL_MINT) return directMint;

  // Strategy-specific mappings when the symbol is ambiguous
  switch (strategyTag) {
    case 'stake':
      // Default staking → mSOL (Marinade) unless specified otherwise
      if (target === 'SOL' || target === 'STAKE') return MSOL_MINT;
      if (target === 'MSOL') return MSOL_MINT;
      if (target === 'JUPSOL') return JUPSOL_MINT;
      if (target === 'JITOSOL') return JITOSOL_MINT;
      return MSOL_MINT; // fallback

    case 'lend':
      // Lending → acquire the target asset (usually a stablecoin or LST)
      if (target === 'USDC' || target.includes('USDC')) return USDC_MINT;
      if (target === 'MSOL' || target.includes('MSOL')) return MSOL_MINT;
      if (target === 'JUPSOL' || target.includes('JUPSOL')) return JUPSOL_MINT;
      if (target === 'JITOSOL' || target.includes('JITOSOL')) return JITOSOL_MINT;
      // If target is just a protocol name or generic, default to USDC for lending
      return USDC_MINT;

    case 'lp':
    case 'perps-lp':
      // LP → acquire the LP token
      if (target === 'JLP' || target.includes('JLP')) return JLP_MINT;
      if (target === 'RAY' || target.includes('RAY')) return RAY_MINT;
      // If target includes a known token, use it
      if (TOKEN_MINTS[target]) return TOKEN_MINTS[target];
      // Default LP → JLP (Jupiter perps LP)
      return JLP_MINT;

    case 'loop':
      // Leverage looping → acquire the looped asset
      if (target === 'MSOL' || target.includes('MSOL')) return MSOL_MINT;
      if (target === 'JUPSOL' || target.includes('JUPSOL')) return JUPSOL_MINT;
      if (target === 'JITOSOL' || target.includes('JITOSOL')) return JITOSOL_MINT;
      // Default loop → JUPSOL (liquid staking loop)
      return JUPSOL_MINT;

    case 'swap':
    default:
      break;
  }

  // Last resort: check TOKEN_MINTS with the raw target
  return TOKEN_MINTS[target] || null;
}

function mapSlotToTrade(
  slot: AllocationSlot,
  portfolioValueSol: number,
  positions?: PositionInfo[],
): { inputMint: string; outputMint: string; amountLamports: number; description: string } | null {
  const target = parseTargetSymbol(slot.symbol);

  // ── SELL: token → SOL ──────────────────────────────────────────────────────
  if (slot.strategyTag === 'sell') {
    // Find the position for the token we want to sell
    const tokenMint = TOKEN_MINTS[target];
    if (!tokenMint) return null;

    const position = positions?.find(p =>
      p.mint === tokenMint || p.symbol.toUpperCase() === target
    );
    if (!position || position.balance <= 0) return null;

    // pct = percentage of the POSITION to sell (100 = sell all)
    const sellPct = Math.min(slot.pct, 100);
    const amountToSell = Math.floor((sellPct / 100) * position.balance);
    if (amountToSell <= 0) return null;

    const tokenLabel = Object.entries(TOKEN_MINTS).find(([, v]) => v === tokenMint)?.[0] || target;

    return {
      inputMint: tokenMint,
      outputMint: SOL_MINT,
      amountLamports: amountToSell,
      description: `Sell ${sellPct}% ${tokenLabel} -> SOL via ${slot.protocol}`,
    };
  }

  // ── BUY: SOL → token (existing logic) ──────────────────────────────────────
  const tradeValueSol = (slot.pct / 100) * portfolioValueSol;
  const amountLamports = Math.floor(tradeValueSol * LAMPORTS_PER_SOL);

  if (amountLamports < MIN_TRADE_LAMPORTS) return null;

  // Skip if target is SOL (we already hold SOL, nothing to swap)
  if (target === 'SOL' && slot.strategyTag !== 'stake') return null;

  // Resolve the output mint based on strategy + symbol
  const outputMint = resolveOutputMint(slot.strategyTag, slot.symbol);
  if (!outputMint || outputMint === SOL_MINT) return null;

  // Build descriptive label
  const strategyLabel = slot.strategyTag === 'stake' ? 'Stake'
    : slot.strategyTag === 'lend' ? 'Lend'
    : slot.strategyTag === 'lp' || slot.strategyTag === 'perps-lp' ? 'LP'
    : slot.strategyTag === 'loop' ? 'Loop'
    : 'Swap';

  const targetLabel = Object.entries(TOKEN_MINTS).find(([, v]) => v === outputMint)?.[0] || target;

  return {
    inputMint: SOL_MINT,
    outputMint,
    amountLamports,
    description: `${strategyLabel} ${tradeValueSol.toFixed(4)} SOL -> ${targetLabel} via ${slot.protocol}`,
  };
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body: ExecuteRequest = await req.json();
    const {
      allocation,
      walletPublicKey,
      riskLimits,
      confidence,
      dryRun = false,
      portfolioValueSol = 0,
      signingMode = 'agent',
      positions,
      budgetLimitSol,
      spentSol = 0,
      useJito = false,
      jitoUrgent = false,
    } = body;

    if (!allocation || !walletPublicKey || !riskLimits) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ── BUDGET ENFORCEMENT (server-side double-check) ─────────────────────────
    const remainingBudget = budgetLimitSol !== undefined
      ? Math.max(0, budgetLimitSol - spentSol)
      : portfolioValueSol;

    // Calculate total BUY value in this request
    const totalBuyValue = allocation
      .filter(s => s.strategyTag !== 'sell')
      .reduce((sum, s) => sum + (s.pct / 100) * portfolioValueSol, 0);

    if (budgetLimitSol !== undefined && totalBuyValue > remainingBudget + 0.001) {
      return NextResponse.json({
        error: `Budget exceeded: trying to spend ${totalBuyValue.toFixed(4)} SOL but only ${remainingBudget.toFixed(4)} SOL remaining`,
        results: [],
        totalExecuted: 0,
        totalVetoed: allocation.length,
        budgetExceeded: true,
      }, { status: 400 });
    }

    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || clusterApiUrl('devnet');
    const connection = new Connection(rpcUrl, 'confirmed');

    // Get actual SOL balance for risk calculations
    let actualPortfolioSol = portfolioValueSol;
    if (actualPortfolioSol <= 0) {
      try {
        const balance = await connection.getBalance(new PublicKey(walletPublicKey));
        actualPortfolioSol = balance / LAMPORTS_PER_SOL;
      } catch {
        actualPortfolioSol = 0;
      }
    }

    // Fetch live SOL price for simulation fallback
    let dynamicSolPrice: number | undefined;
    try {
      const { fetchTokenPrices } = await import('../../../../lib/price-feed');
      const prices = await fetchTokenPrices(['SOL']);
      dynamicSolPrice = prices.SOL;
    } catch { /* fallback handled inline */ }

    const results: ExecutionResultEntry[] = [];
    let totalExecuted = 0;
    let totalVetoed = 0;

    for (const slot of allocation) {
      // ── PERPS EXECUTION: Handle perp-long, perp-short, perp-close ─────────────
      if (slot.strategyTag === 'perp-long' || slot.strategyTag === 'perp-short' || slot.strategyTag === 'perp-close') {
        const perpRisk = validateAction(slot, riskLimits, actualPortfolioSol);

        if (!perpRisk.approved) {
          totalVetoed++;
          results.push({
            action: `${slot.strategyTag} ${slot.symbol} ${slot.pct}%`,
            protocol: 'jupiter-perps',
            success: false,
            error: perpRisk.summary,
            riskAssessment: perpRisk,
          });
          continue;
        }

        // Parse market from symbol (e.g., "SOL-PERP", "SOL", "BTC")
        const symbolUpper = slot.symbol.toUpperCase().replace('-PERP', '');
        const market = `${symbolUpper}-PERP` as PerpMarket;
        if (!PERP_MARKETS[market]) {
          results.push({
            action: `${slot.strategyTag} ${slot.symbol}`,
            protocol: 'jupiter-perps',
            success: false,
            error: `Unknown perp market: ${market}. Supported: SOL-PERP, ETH-PERP, BTC-PERP`,
            riskAssessment: perpRisk,
          });
          continue;
        }

        try {
          if (slot.strategyTag === 'perp-close') {
            // Close position
            const closeParams: PerpCloseParams = {
              market,
              percentToClose: Math.min(slot.pct, 100),
              slippageBps: riskLimits.maxSlippageBps,
            };

            const closeResult = await buildClosePositionTx(connection, walletPublicKey, closeParams);

            if (!closeResult.success) {
              results.push({
                action: `Close ${slot.pct}% ${market} position`,
                protocol: 'jupiter-perps',
                success: false,
                error: closeResult.error || 'Failed to build close transaction',
                riskAssessment: perpRisk,
              });
              continue;
            }

            // DEMO MODE or agent mode: simulated close
            if (!closeResult.transaction) {
              // Close the simulated position
              const closedPosition = closeSimulatedPosition(market, slot.pct);
              const closedInfo = closedPosition
                ? `Closed ${closedPosition.side} position`
                : 'No position found to close';

              results.push({
                action: `Close ${slot.pct}% ${market} position`,
                protocol: 'jupiter-perps',
                success: true,
                simulated: true,
                riskAssessment: perpRisk,
                quote: {
                  inputAmount: '0',
                  expectedOutput: closedInfo,
                  priceImpactPct: 0,
                },
              });
              totalExecuted++;
              continue;
            }

            // Handle wallet vs agent signing mode
            if (signingMode === 'wallet') {
              const txBytes = Buffer.from(closeResult.transaction.serialize()).toString('base64');
              results.push({
                action: `Close ${slot.pct}% ${market} position`,
                protocol: 'jupiter-perps',
                success: true,
                unsignedTx: txBytes,
                riskAssessment: perpRisk,
              });
              totalExecuted++;
            } else {
              // Agent mode: simulated close
              results.push({
                action: `Close ${slot.pct}% ${market} position`,
                protocol: 'jupiter-perps',
                success: true,
                simulated: true,
                riskAssessment: perpRisk,
              });
              totalExecuted++;
            }
          } else {
            // Open long or short position
            const side = slot.strategyTag === 'perp-long' ? 'long' : 'short';
            const collateralUsd = (slot.pct / 100) * actualPortfolioSol * (dynamicSolPrice ?? 180);
            // Use explicit leverage field, default 5x, max 50x for safety
            const leverage = Math.min(Math.max(slot.leverage || 5, 1), 50);

            const orderParams: PerpOrderParams = {
              market,
              side,
              collateralUsd,
              leverage,
              slippageBps: riskLimits.maxSlippageBps,
            };

            // Check if we already have an open position in this market (demo mode)
            const existingPosition = getPositionForMarket(market);
            if (existingPosition) {
              // Already have a position - skip opening duplicate
              results.push({
                action: `SKIP ${side} ${market} - already have ${existingPosition.side} position`,
                protocol: 'jupiter-perps',
                success: true,
                simulated: true,
                riskAssessment: perpRisk,
                quote: {
                  inputAmount: '0',
                  expectedOutput: `Existing ${existingPosition.side} $${existingPosition.collateralUsd.toFixed(2)} @ ${existingPosition.leverage}x`,
                  priceImpactPct: 0,
                },
              });
              continue; // Don't count as executed, just skip
            }

            const orderResult = await buildOpenPositionTx(connection, walletPublicKey, orderParams);

            if (!orderResult.success) {
              results.push({
                action: `Open ${side} ${market} ${leverage}x ($${collateralUsd.toFixed(2)} collateral)`,
                protocol: 'jupiter-perps',
                success: false,
                error: orderResult.error || 'Failed to build order transaction',
                riskAssessment: perpRisk,
              });
              continue;
            }

            // DEMO MODE: No transaction means simulated execution
            if (!orderResult.transaction) {
              // Track the simulated position
              openSimulatedPosition({
                market,
                side,
                collateralUsd,
                leverage,
                entryPrice: orderResult.estimatedEntry || 180,
              });

              results.push({
                action: `Open ${side} ${market} ${leverage}x ($${collateralUsd.toFixed(2)} collateral)`,
                protocol: 'jupiter-perps',
                success: true,
                simulated: true,
                riskAssessment: perpRisk,
                quote: {
                  inputAmount: collateralUsd.toFixed(2),
                  expectedOutput: `Entry ~$${orderResult.estimatedEntry?.toFixed(2) || '?'}, Liq ~$${orderResult.estimatedLiquidation?.toFixed(2) || '?'}`,
                  priceImpactPct: 0,
                },
              });
              totalExecuted++;
              continue;
            }

            // Handle wallet vs agent signing mode
            if (signingMode === 'wallet') {
              const txBytes = Buffer.from(orderResult.transaction.serialize()).toString('base64');
              results.push({
                action: `Open ${side} ${market} ${leverage}x ($${collateralUsd.toFixed(2)} collateral)`,
                protocol: 'jupiter-perps',
                success: true,
                unsignedTx: txBytes,
                riskAssessment: perpRisk,
                quote: {
                  inputAmount: collateralUsd.toFixed(2),
                  expectedOutput: `${leverage}x leverage`,
                  priceImpactPct: 0,
                },
              });
              totalExecuted++;
            } else {
              // Agent mode: execute with Jito if enabled
              const { loadAgentKeypair } = await import('../../../../lib/agent-keypair');
              const agentKeypair = loadAgentKeypair();

              if (agentKeypair) {
                try {
                  orderResult.transaction.sign([agentKeypair]);

                  let signature: string;
                  let usedJito = false;

                  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
                  const shouldUseJito = useJito && isJitoSupported(network);

                  if (shouldUseJito) {
                    const jitoConfig: JitoConfig = jitoUrgent ? URGENT_JITO_CONFIG : DEFAULT_JITO_CONFIG;
                    const jitoResult = await sendTransactionViaJito(orderResult.transaction, jitoConfig);

                    if (jitoResult.success && jitoResult.signature) {
                      signature = jitoResult.signature;
                      usedJito = true;
                    } else {
                      signature = await connection.sendRawTransaction(orderResult.transaction.serialize(), {
                        skipPreflight: false,
                        maxRetries: 3,
                      });
                    }
                  } else {
                    signature = await connection.sendRawTransaction(orderResult.transaction.serialize(), {
                      skipPreflight: false,
                      maxRetries: 3,
                    });
                  }

                  await connection.confirmTransaction(signature, 'confirmed');

                  results.push({
                    action: `Open ${side} ${market} ${leverage}x`,
                    protocol: usedJito ? 'jupiter-perps+jito' : 'jupiter-perps',
                    signature,
                    success: true,
                    riskAssessment: perpRisk,
                  });
                  totalExecuted++;
                } catch (txErr) {
                  results.push({
                    action: `Open ${side} ${market} ${leverage}x`,
                    protocol: 'jupiter-perps',
                    success: false,
                    error: txErr instanceof Error ? txErr.message : 'Perps transaction failed',
                    riskAssessment: perpRisk,
                  });
                }
              } else {
                // No agent keypair: simulated
                results.push({
                  action: `Open ${side} ${market} ${leverage}x ($${collateralUsd.toFixed(2)} collateral)`,
                  protocol: 'jupiter-perps',
                  success: true,
                  simulated: true,
                  riskAssessment: perpRisk,
                });
                totalExecuted++;
              }
            }
          }
        } catch (perpErr) {
          results.push({
            action: `${slot.strategyTag} ${slot.symbol}`,
            protocol: 'jupiter-perps',
            success: false,
            error: perpErr instanceof Error ? perpErr.message : 'Perps execution error',
            riskAssessment: perpRisk,
          });
        }
        continue;
      }

      // 1. Risk validation (for spot trades)
      const riskResult = validateAction(slot, riskLimits, actualPortfolioSol);

      if (!riskResult.approved) {
        totalVetoed++;
        results.push({
          action: `${slot.strategyTag} ${slot.symbol} ${slot.pct}%`,
          protocol: slot.protocol,
          success: false,
          error: riskResult.summary,
          riskAssessment: riskResult,
        });
        continue;
      }

      // 2. Map to concrete trade
      const trade = mapSlotToTrade(slot, actualPortfolioSol, positions);
      if (!trade) {
        // Distinguish failure reasons
        const target = parseTargetSymbol(slot.symbol);
        const tokenMint = TOKEN_MINTS[target];
        let failReason = 'Could not map allocation to concrete trade';
        if (slot.strategyTag === 'sell' && !tokenMint) {
          failReason = `Unknown token "${target}" — no mint mapping`;
        } else if (slot.strategyTag === 'sell') {
          const pos = positions?.find(p => p.mint === tokenMint || p.symbol.toUpperCase() === target);
          if (!pos || pos.balance <= 0) {
            failReason = `No position to sell for ${target}`;
          }
        } else if (slot.pct <= 0) {
          failReason = `Trade too small (${slot.pct}% = 0 SOL)`;
        } else {
          const tradeVal = (slot.pct / 100) * actualPortfolioSol;
          const lamports = Math.floor(tradeVal * LAMPORTS_PER_SOL);
          if (lamports < MIN_TRADE_LAMPORTS) {
            failReason = `Trade too small: ${tradeVal.toFixed(6)} SOL (min ${MIN_TRADE_LAMPORTS / LAMPORTS_PER_SOL} SOL)`;
          }
        }
        results.push({
          action: `${slot.strategyTag} ${slot.symbol} ${slot.pct}%`,
          protocol: slot.protocol,
          success: false,
          error: failReason,
          riskAssessment: riskResult,
        });
        continue;
      }

      // 2b. Wallet balance check before swap
      try {
        const walletPubkey = new PublicKey(walletPublicKey);
        if (trade.inputMint === SOL_MINT) {
          // Buy: verify SOL balance covers trade + reserve
          const solBalance = await connection.getBalance(walletPubkey);
          const needed = trade.amountLamports + Math.floor(riskLimits.minSolReserve * LAMPORTS_PER_SOL);
          if (solBalance < needed) {
            results.push({
              action: trade.description,
              protocol: 'jupiter',
              success: false,
              error: `Insufficient SOL: need ${(needed / LAMPORTS_PER_SOL).toFixed(4)} but have ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)}`,
              riskAssessment: riskResult,
            });
            continue;
          }
        } else {
          // Sell: verify token account balance covers sell amount
          const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPubkey, {
            mint: new PublicKey(trade.inputMint),
          });
          const tokenBalance = tokenAccounts.value[0]?.account?.data?.parsed?.info?.tokenAmount?.amount;
          if (!tokenBalance || BigInt(tokenBalance) < BigInt(trade.amountLamports)) {
            results.push({
              action: trade.description,
              protocol: 'jupiter',
              success: false,
              error: `Insufficient token balance: need ${trade.amountLamports} but have ${tokenBalance ?? 0}`,
              riskAssessment: riskResult,
            });
            continue;
          }
        }
      } catch (balErr) {
        console.warn('Balance check warning (continuing):', balErr);
        // Non-blocking: if balance check fails, let Jupiter handle it
      }

      // 3. Get Jupiter quote
      const { quote, error: quoteError } = await getJupiterQuote(
        trade.inputMint,
        trade.outputMint,
        trade.amountLamports,
        riskLimits.maxSlippageBps,
      );

      if (!quote || quoteError) {
        // Simulation fallback: when Jupiter quotes fail (e.g., devnet), produce
        // simulated results so the OODA loop demonstrates full execution flow.
        const simInputAmount = trade.amountLamports.toString();
        const estimatedOutput = trade.outputMint === MSOL_MINT
          ? Math.floor(trade.amountLamports * 0.97).toString()  // ~3% staking discount
          : trade.outputMint === USDC_MINT
            ? (trade.amountLamports / LAMPORTS_PER_SOL * (dynamicSolPrice ?? 180)).toFixed(2)
            : trade.amountLamports.toString();

        results.push({
          action: trade.description,
          protocol: 'jupiter',
          success: true,
          simulated: true,
          riskAssessment: riskResult,
          quote: {
            inputAmount: simInputAmount,
            expectedOutput: estimatedOutput,
            priceImpactPct: 0.1,
          },
        });
        totalExecuted++;
        continue;
      }

      const quoteInfo = {
        inputAmount: quote.inAmount,
        expectedOutput: quote.outAmount,
        priceImpactPct: parseFloat(quote.priceImpactPct ?? '0'),
      };

      // 4. DryRun: just return quote and risk assessment
      if (dryRun) {
        results.push({
          action: trade.description,
          protocol: 'jupiter',
          success: true,
          riskAssessment: riskResult,
          quote: quoteInfo,
        });
        totalExecuted++;
        continue;
      }

      // 5. Build swap transaction
      const { transaction, error: swapError } = await getJupiterSwapTransaction(
        quote,
        walletPublicKey,
      );

      if (!transaction || swapError) {
        results.push({
          action: trade.description,
          protocol: 'jupiter',
          success: false,
          error: swapError || 'Failed to build swap transaction',
          riskAssessment: riskResult,
          quote: quoteInfo,
        });
        continue;
      }

      // 6. Simulate the transaction (skip in wallet mode — Phantom does its own preflight)
      if (signingMode !== 'wallet') {
        try {
          const simulation = await connection.simulateTransaction(transaction, {
            sigVerify: false,
            replaceRecentBlockhash: true,
          });

          if (simulation.value.err) {
            // Log simulation failure as warning but don't block — let on-chain send handle it
            // Simulations can return false negatives for valid trades (stale blockhash, etc.)
            console.warn('Simulation warning (non-blocking):', JSON.stringify(simulation.value.err));
          }
        } catch (simErr) {
          const simErrMsg = simErr instanceof Error ? simErr.message : 'Simulation error';
          console.warn('Simulation warning (continuing):', simErrMsg);
          // Don't block — let the actual send handle it
        }
      }

      // 7a. Wallet mode: return unsigned tx for client-side signing
      if (signingMode === 'wallet') {
        const txBytes = Buffer.from(transaction.serialize()).toString('base64');
        results.push({
          action: trade.description,
          protocol: 'jupiter',
          success: true,
          unsignedTx: txBytes,
          riskAssessment: riskResult,
          quote: quoteInfo,
        });
        totalExecuted++;
        continue;
      }

      // 7b. Agent mode: sign with server-side keypair
      const { loadAgentKeypair } = await import('../../../../lib/agent-keypair');
      const agentKeypair = loadAgentKeypair();
      if (agentKeypair) {
        try {
          transaction.sign([agentKeypair]);

          let signature: string;
          let usedJito = false;

          // ── JITO FAST EXECUTION ──────────────────────────────────────────────
          // Use Jito for ~100ms faster block inclusion (mainnet only)
          const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
          const shouldUseJito = useJito && isJitoSupported(network);

          if (shouldUseJito) {
            const jitoConfig: JitoConfig = jitoUrgent ? URGENT_JITO_CONFIG : DEFAULT_JITO_CONFIG;
            const jitoResult = await sendTransactionViaJito(transaction, jitoConfig);

            if (jitoResult.success && jitoResult.signature) {
              signature = jitoResult.signature;
              usedJito = true;
            } else {
              // Jito failed, fallback to standard RPC
              console.warn('Jito failed, falling back to standard RPC:', jitoResult.error);
              signature = await connection.sendRawTransaction(transaction.serialize(), {
                skipPreflight: false,
                maxRetries: 3,
              });
            }
          } else {
            // Standard RPC send
            signature = await connection.sendRawTransaction(transaction.serialize(), {
              skipPreflight: false,
              maxRetries: 3,
            });
          }

          await connection.confirmTransaction(signature, 'confirmed');

          results.push({
            action: trade.description,
            protocol: usedJito ? 'jupiter+jito' : 'jupiter',
            signature,
            success: true,
            riskAssessment: riskResult,
            quote: quoteInfo,
          });
          totalExecuted++;
        } catch (txErr) {
          results.push({
            action: trade.description,
            protocol: 'jupiter',
            success: false,
            error: txErr instanceof Error ? txErr.message : 'Transaction failed',
            riskAssessment: riskResult,
            quote: quoteInfo,
          });
        }
      } else {
        // No agent keypair: return the quote and simulation result as a successful "plan"
        results.push({
          action: trade.description,
          protocol: 'jupiter',
          success: true,
          riskAssessment: riskResult,
          quote: quoteInfo,
        });
        totalExecuted++;
      }
    }

    return NextResponse.json({
      results,
      totalExecuted,
      totalVetoed,
      dryRun,
      signingMode,
      portfolioValueSol: actualPortfolioSol,
      timestamp: Date.now(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
