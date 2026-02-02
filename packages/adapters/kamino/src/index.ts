/**
 * @makora/adapters-kamino - Kamino Finance vault/lending adapter
 *
 * Supports:
 * - Deposit tokens into Kamino lending reserves (earn yield)
 * - Withdraw tokens from reserves
 * - Read deposit positions and APYs
 *
 * Kamino's kLend is a lending protocol where depositors earn yield
 * from borrowers. Each reserve accepts a specific token.
 *
 * NOTE: On-chain instruction building (buildDepositIx, buildWithdrawIx) is
 * deferred until @kamino-finance/klend-sdk dependency conflict with
 * @solana/kit is resolved. Vault data, quotes, and position reads
 * work via the Hubble Protocol REST API.
 */

export { KaminoAdapter } from './adapter.js';
export {
  KAMINO_LEND_PROGRAM_ID,
  KAMINO_LIQUIDITY_PROGRAM_ID,
  KAMINO_MAIN_MARKET,
  KAMINO_API_BASE_URL,
  KNOWN_VAULTS,
} from './constants.js';
