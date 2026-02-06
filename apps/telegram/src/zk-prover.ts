/**
 * ZK Prover — Real Groth16 SNARK proof generation using P01 circuits.
 *
 * Uses the compiled transfer circuit from P01 (Volta Team's Solana privacy layer):
 * - transfer.wasm      (2.7 MB) — Circuit compiled to WebAssembly
 * - transfer_final.zkey (11 MB)  — Groth16 proving key (Powers of Tau + Phase 2)
 * - verification_key.json        — Public verification key
 *
 * Hash function: Poseidon (ZK-friendly, ~8x cheaper in-circuit than SHA-256)
 * Proof system: Groth16 over BN254 curve
 * Circuit: 2-in-2-out UTXO transfer (Zcash-style)
 *
 * Stack: snarkjs + circomlibjs (same as P01)
 */

import * as snarkjs from 'snarkjs';
import { buildPoseidon } from 'circomlibjs';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Constants ───────────────────────────────────────────────────────────────

const FIELD_MODULUS = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

const MERKLE_DEPTH = 20; // Matches P01 circuit constraint

// ─── Paths ───────────────────────────────────────────────────────────────────

// Resolve circuit file paths relative to this module
function getCircuitDir(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    return join(__dirname, '..', 'circuits');
  } catch {
    return join(process.cwd(), 'circuits');
  }
}

// ─── Poseidon ────────────────────────────────────────────────────────────────

let poseidon: any = null;

export async function initPoseidon(): Promise<void> {
  if (!poseidon) {
    poseidon = await buildPoseidon();
    console.log('[ZK] Poseidon hash initialized');
  }
}

export function poseidonHash(inputs: bigint[]): bigint {
  if (!poseidon) throw new Error('Poseidon not initialized. Call initPoseidon() first.');
  const hash = poseidon(inputs);
  return poseidon.F.toObject(hash);
}

// ─── Field Utilities ─────────────────────────────────────────────────────────

export function randomFieldElement(): bigint {
  const bytes = new Uint8Array(randomBytes(32));
  let result = BigInt(0);
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result % FIELD_MODULUS;
}

export function amountToField(amountSol: number): bigint {
  // Convert SOL to lamports (9 decimals) for field element
  return BigInt(Math.round(amountSol * 1e9));
}

// ─── Cryptographic Primitives (Poseidon-based, matching P01 circuit) ────────

/**
 * Compute note commitment: Poseidon(amount, ownerPubkey, randomness, tokenMint)
 * This matches P01's transfer.circom commitment computation.
 */
export function computeCommitment(
  amount: bigint,
  ownerPubkey: bigint,
  randomness: bigint,
  tokenMint: bigint = 0n, // 0 = native SOL
): bigint {
  return poseidonHash([amount, ownerPubkey, randomness, tokenMint]);
}

/**
 * Compute nullifier: Poseidon(commitment, spendingKeyHash)
 * Matches P01's nullifier derivation.
 */
export function computeNullifier(commitment: bigint, spendingKeyHash: bigint): bigint {
  return poseidonHash([commitment, spendingKeyHash]);
}

/**
 * Derive owner public key from spending key: Poseidon(spendingKey)
 */
export function deriveOwnerPubkey(spendingKey: bigint): bigint {
  return poseidonHash([spendingKey]);
}

// ─── Sparse Merkle Tree (Poseidon) ──────────────────────────────────────────

export class PoseidonMerkleTree {
  depth: number;
  leaves: bigint[] = [];
  zeroValues: bigint[] = [];

  constructor(depth: number = MERKLE_DEPTH) {
    this.depth = depth;
    this.zeroValues = this.computeZeroValues();
  }

  private computeZeroValues(): bigint[] {
    const zeros: bigint[] = [0n];
    for (let i = 1; i <= this.depth; i++) {
      zeros.push(poseidonHash([zeros[i - 1], zeros[i - 1]]));
    }
    return zeros;
  }

  insert(leaf: bigint): number {
    const index = this.leaves.length;
    this.leaves.push(leaf);
    return index;
  }

  get root(): bigint {
    if (this.leaves.length === 0) return this.zeroValues[this.depth];

    let currentLevel = [...this.leaves];
    for (let d = 0; d < this.depth; d++) {
      const nextLevel: bigint[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : this.zeroValues[d];
        nextLevel.push(poseidonHash([left, right]));
      }
      currentLevel = nextLevel.length > 0 ? nextLevel : [this.zeroValues[d + 1]];
    }
    return currentLevel[0];
  }

  generateProof(leafIndex: number): { pathElements: bigint[]; pathIndices: number[] } {
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];

    let currentLevel = [...this.leaves];
    let idx = leafIndex;

    for (let d = 0; d < this.depth; d++) {
      const siblingIdx = idx ^ 1;
      const sibling = siblingIdx < currentLevel.length ? currentLevel[siblingIdx] : this.zeroValues[d];
      pathElements.push(sibling);
      pathIndices.push(idx & 1);

      const nextLevel: bigint[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : this.zeroValues[d];
        nextLevel.push(poseidonHash([left, right]));
      }
      currentLevel = nextLevel.length > 0 ? nextLevel : [this.zeroValues[d + 1]];
      idx = Math.floor(idx / 2);
    }

    return { pathElements, pathIndices };
  }

  verifyProof(leaf: bigint, pathElements: bigint[], pathIndices: number[]): boolean {
    let current = leaf;
    for (let i = 0; i < pathElements.length; i++) {
      if (pathIndices[i] === 0) {
        current = poseidonHash([current, pathElements[i]]);
      } else {
        current = poseidonHash([pathElements[i], current]);
      }
    }
    return current === this.root;
  }
}

// ─── Groth16 Proof Generation ────────────────────────────────────────────────

export interface ShieldProofResult {
  proof: any; // Groth16 proof (pi_a, pi_b, pi_c)
  publicSignals: string[];
  commitment: bigint;
  nullifier: bigint;
  verified: boolean;
  proofTimeMs: number;
}

/**
 * Generate a real Groth16 SNARK proof for a shield operation.
 *
 * Uses the P01 transfer circuit in "shield mode":
 * - Input notes: dummy (amount=0)
 * - Output note 1: the shielded amount
 * - Output note 2: dummy (change = 0)
 * - public_amount > 0 (deposits into shielded pool)
 */
export async function generateShieldProof(
  amountSol: number,
  spendingKey: bigint,
  tree: PoseidonMerkleTree,
): Promise<ShieldProofResult> {
  const circuitDir = getCircuitDir();
  const wasmPath = join(circuitDir, 'transfer.wasm');
  const zkeyPath = join(circuitDir, 'transfer_final.zkey');
  const vkPath = join(circuitDir, 'verification_key.json');

  const amount = amountToField(amountSol);
  const ownerPubkey = deriveOwnerPubkey(spendingKey);
  const spendingKeyHash = poseidonHash([spendingKey]);
  const randomness = randomFieldElement();
  const tokenMint = 0n; // Native SOL

  // ── Dummy input notes ──
  // Even for shield (no real inputs), the circuit still computes and checks
  // nullifiers unconditionally (line 135). So we must provide correct values.
  //
  // Dummy commitment = Poseidon(0, 0, 0, tokenMint)
  // Dummy nullifier  = Poseidon(dummyCommitment, spendingKeyHash)
  const dummyCommitment = computeCommitment(0n, 0n, 0n, tokenMint);
  const dummyNullifier = computeNullifier(dummyCommitment, spendingKeyHash);

  // ── Output note ──
  const commitment = computeCommitment(amount, ownerPubkey, randomness, tokenMint);
  // The nullifier for the OUTPUT note (pre-computed for future spending)
  const nullifier = computeNullifier(commitment, spendingKeyHash);

  // ── Dummy output note 2 ──
  // Must satisfy: Poseidon(0, 0, 0, tokenMint) === output_commitment_2
  const dummyOutCommitment = computeCommitment(0n, 0n, 0n, tokenMint);

  // ── Merkle path for dummy inputs (empty tree) ──
  const emptyPathElements = new Array(MERKLE_DEPTH).fill('0');
  const emptyPathIndices = new Array(MERKLE_DEPTH).fill('0');

  // Build circuit inputs (shield mode: dummy inputs, one real output)
  const circuitInputs = {
    // Public inputs (7 signals)
    merkle_root: tree.root.toString(),
    nullifier_1: dummyNullifier.toString(), // Correct nullifier for dummy note
    nullifier_2: dummyNullifier.toString(), // Same for second dummy
    output_commitment_1: commitment.toString(),
    output_commitment_2: dummyOutCommitment.toString(), // Correct dummy output commitment
    public_amount: amount.toString(), // Positive = shield (deposit)
    token_mint: tokenMint.toString(),

    // Private inputs — dummy input note 1 (amount=0 bypasses merkle check)
    in_amount_1: '0',
    in_owner_pubkey_1: '0',
    in_randomness_1: '0',
    in_path_indices_1: emptyPathIndices,
    in_path_elements_1: emptyPathElements,

    // Private inputs — dummy input note 2
    in_amount_2: '0',
    in_owner_pubkey_2: '0',
    in_randomness_2: '0',
    in_path_indices_2: emptyPathIndices,
    in_path_elements_2: emptyPathElements,

    // Output note 1 (the shielded amount)
    out_amount_1: amount.toString(),
    out_recipient_1: ownerPubkey.toString(),
    out_randomness_1: randomness.toString(),

    // Output note 2 (dummy — must match dummyOutCommitment)
    out_amount_2: '0',
    out_recipient_2: '0',
    out_randomness_2: '0',

    // Spending key
    spending_key: spendingKey.toString(),
  };

  console.log('[ZK] Generating Groth16 proof (this takes 30-60s)...');
  const startTime = Date.now();

  // Generate the proof
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInputs,
    wasmPath,
    zkeyPath,
  );

  const proofTimeMs = Date.now() - startTime;
  console.log(`[ZK] Proof generated in ${(proofTimeMs / 1000).toFixed(1)}s`);

  // Verify the proof locally
  const vk = JSON.parse(readFileSync(vkPath, 'utf8'));
  const verified = await snarkjs.groth16.verify(vk, publicSignals, proof);
  console.log(`[ZK] Proof verification: ${verified ? 'VALID' : 'INVALID'}`);

  return {
    proof,
    publicSignals,
    commitment,
    nullifier,
    verified,
    proofTimeMs,
  };
}

/**
 * Verify a Groth16 proof without regenerating it.
 */
export async function verifyProof(proof: any, publicSignals: string[]): Promise<boolean> {
  try {
    const circuitDir = getCircuitDir();
    const vkPath = join(circuitDir, 'verification_key.json');
    const vk = JSON.parse(readFileSync(vkPath, 'utf8'));
    return snarkjs.groth16.verify(vk, publicSignals, proof);
  } catch (err) {
    console.error('[ZK] Verification error:', err);
    return false;
  }
}

/**
 * Format proof for display (truncated hex).
 */
export function formatProof(proof: any): string {
  const pi_a = `[${proof.pi_a[0].slice(0, 10)}..., ${proof.pi_a[1].slice(0, 10)}...]`;
  const pi_b = `[[${proof.pi_b[0][0].slice(0, 8)}...], [${proof.pi_b[1][0].slice(0, 8)}...]]`;
  const pi_c = `[${proof.pi_c[0].slice(0, 10)}..., ${proof.pi_c[1].slice(0, 10)}...]`;
  return `Groth16 proof:\n  π_a: ${pi_a}\n  π_b: ${pi_b}\n  π_c: ${pi_c}`;
}
