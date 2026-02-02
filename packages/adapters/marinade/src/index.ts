/**
 * @makora/adapters-marinade - Marinade Finance liquid staking adapter
 *
 * Supports:
 * - Staking SOL -> mSOL (liquid staking)
 * - Unstaking mSOL -> SOL (liquid unstake via pool)
 * - Reading mSOL positions and APY
 */

export { MarinadeAdapter } from './adapter.js';
export {
  MARINADE_PROGRAM_ID,
  MSOL_MINT,
  MARINADE_STATE,
  MIN_STAKE_AMOUNT_LAMPORTS,
} from './constants.js';
