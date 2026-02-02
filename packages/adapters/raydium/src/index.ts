/**
 * @makora/adapters-raydium - Raydium AMM liquidity provision adapter
 *
 * Supports:
 * - Provide liquidity to AMM pools (earn trading fees)
 * - Remove liquidity from pools
 * - Read LP positions
 *
 * NOTE: Swaps through Raydium are handled by the Jupiter adapter.
 * This adapter is for LP management only.
 *
 * NOTE: On-chain instruction building (buildDepositIx, buildWithdrawIx) is
 * deferred until @raydium-io/raydium-sdk-v2 stabilizes. Pool data, quotes,
 * and position reads work via the Raydium REST API.
 */

export { RaydiumAdapter } from './adapter.js';
export {
  RAYDIUM_AMM_PROGRAM_ID,
  RAYDIUM_CLMM_PROGRAM_ID,
  RAYDIUM_CPMM_PROGRAM_ID,
  RAYDIUM_API_BASE_URL,
  KNOWN_POOLS,
  DEFAULT_LP_SLIPPAGE_BPS,
} from './constants.js';
