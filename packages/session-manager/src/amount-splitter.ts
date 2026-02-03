import { randomBytes } from 'crypto';

/**
 * Split a total SOL amount into random non-uniform chunks.
 * Uses a Dirichlet-like distribution for natural-looking splits
 * that break amount-correlation heuristics.
 *
 * E.g., 1.0 SOL with 3 wallets → [0.42, 0.35, 0.23]
 */
export function splitAmount(
  totalSol: number,
  numWallets: 2 | 3,
  minPerWallet: number = 0.1,
): number[] {
  const minTotal = minPerWallet * numWallets;
  if (totalSol < minTotal) {
    throw new Error(
      `Total ${totalSol} SOL is below minimum ${minTotal} SOL for ${numWallets} wallets`,
    );
  }

  // Generate random weights using crypto.randomBytes for unpredictability
  const weights: number[] = [];
  for (let i = 0; i < numWallets; i++) {
    // Use 4 bytes of entropy → convert to float [0.1, 1.0]
    const bytes = randomBytes(4);
    const raw = bytes.readUInt32BE(0) / 0xffffffff; // [0, 1)
    // Gamma-like shaping: raise to power to create more variance
    const shaped = Math.pow(raw + 0.1, 1.5);
    weights.push(shaped);
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);

  // Allocate minimum to each wallet first, then distribute remainder
  const remainder = totalSol - minTotal;
  const splits: number[] = weights.map(
    (w) => minPerWallet + (remainder * w) / totalWeight,
  );

  // Round to 6 decimal places (lamport-level precision at ~100 SOL)
  const rounded = splits.map((s) => Math.floor(s * 1_000_000) / 1_000_000);

  // Fix rounding drift: add/remove from largest chunk
  const roundedTotal = rounded.reduce((a, b) => a + b, 0);
  const drift = totalSol - roundedTotal;
  const maxIdx = rounded.indexOf(Math.max(...rounded));
  rounded[maxIdx] = Math.floor((rounded[maxIdx] + drift) * 1_000_000) / 1_000_000;

  return rounded;
}

/**
 * Decide how many wallets to use based on the total amount.
 * Smaller amounts use 2 wallets, larger use 3.
 */
export function chooseWalletCount(totalSol: number, minPerWallet: number = 0.1): 2 | 3 {
  if (totalSol >= minPerWallet * 3) {
    // Randomly choose 2 or 3 for unpredictability (slight bias toward 3)
    const roll = randomBytes(1)[0] / 255;
    return roll > 0.35 ? 3 : 2;
  }
  return 2;
}
