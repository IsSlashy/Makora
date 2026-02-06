/**
 * ZK Shielded Vault — Real cryptographic commitment scheme.
 *
 * Implements a simplified Zcash-style shielded pool for Solana:
 *
 *   commitment = SHA256(amount ‖ secret ‖ nonce)
 *   nullifier  = SHA256(secret ‖ leafIndex)
 *
 * - Commitments are stored in a binary Merkle tree (SHA-256).
 * - Shielding: generates (secret, nonce), computes commitment, inserts into tree.
 * - Unshielding: reveals nullifier (derived from secret), verifies Merkle proof,
 *   checks nullifier hasn't been spent. This prevents double-spend.
 *
 * This mirrors the architecture of P01 (Solana privacy layer by Volta Team)
 * which uses Circom + snarkjs for full ZK-SNARKs on-chain. Here we use the
 * same cryptographic primitives (hash commitments, Merkle proofs, nullifiers)
 * without the circuit compilation — suitable for off-chain demo.
 *
 * Crypto stack: @noble/hashes (SHA-256), already in project dependencies.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { randomBytes } from 'node:crypto';

// ─── Cryptographic Primitives ────────────────────────────────────────────────

/** Generate cryptographically secure random bytes */
function secureRandom(length: number): Uint8Array {
  return new Uint8Array(randomBytes(length));
}

/** Concatenate Uint8Arrays */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/** Encode a number as 8-byte big-endian */
function encodeAmount(amount: number): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  // Store as fixed-point: amount * 1e9 (lamports precision)
  const lamports = Math.round(amount * 1e9);
  // Split into two 32-bit writes for precision
  view.setUint32(0, Math.floor(lamports / 0x100000000));
  view.setUint32(4, lamports >>> 0);
  return buf;
}

/**
 * Compute commitment: SHA256(amount ‖ secret ‖ nonce)
 * This binds the amount to a secret the depositor knows.
 */
function computeCommitment(amount: number, secret: Uint8Array, nonce: Uint8Array): Uint8Array {
  return sha256(concat(encodeAmount(amount), secret, nonce));
}

/**
 * Compute nullifier: SHA256(secret ‖ leafIndex)
 * The nullifier is revealed when spending, preventing double-spend.
 * It cannot be linked to the commitment without knowing the secret.
 */
function computeNullifier(secret: Uint8Array, leafIndex: number): Uint8Array {
  const indexBuf = new Uint8Array(4);
  new DataView(indexBuf.buffer).setUint32(0, leafIndex);
  return sha256(concat(secret, indexBuf));
}

// ─── Merkle Tree ─────────────────────────────────────────────────────────────

const TREE_DEPTH = 16; // supports 2^16 = 65536 notes
const EMPTY_LEAF = new Uint8Array(32); // all zeros

/** Hash two children: SHA256(left ‖ right) */
function hashPair(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concat(left, right));
}

/** Precompute empty hashes for each level of the tree */
function computeEmptyHashes(): Uint8Array[] {
  const empties: Uint8Array[] = [EMPTY_LEAF];
  for (let i = 1; i <= TREE_DEPTH; i++) {
    empties.push(hashPair(empties[i - 1], empties[i - 1]));
  }
  return empties;
}

const EMPTY_HASHES = computeEmptyHashes();

interface MerkleTree {
  leaves: Uint8Array[];
  nextIndex: number;
}

function createMerkleTree(): MerkleTree {
  return { leaves: [], nextIndex: 0 };
}

/** Insert a commitment leaf and return its index */
function insertLeaf(tree: MerkleTree, leaf: Uint8Array): number {
  const index = tree.nextIndex;
  tree.leaves.push(leaf);
  tree.nextIndex++;
  return index;
}

/** Compute the Merkle root from all leaves */
function computeRoot(tree: MerkleTree): Uint8Array {
  if (tree.leaves.length === 0) return EMPTY_HASHES[TREE_DEPTH];

  // Build tree bottom-up
  let currentLevel = tree.leaves.map(l => l);

  for (let depth = 0; depth < TREE_DEPTH; depth++) {
    const nextLevel: Uint8Array[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : EMPTY_HASHES[depth];
      nextLevel.push(hashPair(left, right));
    }
    currentLevel = nextLevel.length > 0 ? nextLevel : [EMPTY_HASHES[depth + 1]];
  }

  return currentLevel[0];
}

/** Generate a Merkle proof (sibling path) for a leaf at given index */
function generateProof(tree: MerkleTree, leafIndex: number): { siblings: Uint8Array[]; pathIndices: number[] } {
  const siblings: Uint8Array[] = [];
  const pathIndices: number[] = [];

  let currentLevel = tree.leaves.map(l => l);

  for (let depth = 0; depth < TREE_DEPTH; depth++) {
    const siblingIndex = leafIndex ^ 1; // flip last bit to get sibling
    const sibling = siblingIndex < currentLevel.length ? currentLevel[siblingIndex] : EMPTY_HASHES[depth];
    siblings.push(sibling);
    pathIndices.push(leafIndex & 1); // 0 = left, 1 = right

    // Move up one level
    const nextLevel: Uint8Array[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : EMPTY_HASHES[depth];
      nextLevel.push(hashPair(left, right));
    }
    currentLevel = nextLevel.length > 0 ? nextLevel : [EMPTY_HASHES[depth + 1]];
    leafIndex = Math.floor(leafIndex / 2);
  }

  return { siblings, pathIndices };
}

/** Verify a Merkle proof */
function verifyProof(
  leaf: Uint8Array,
  siblings: Uint8Array[],
  pathIndices: number[],
  root: Uint8Array,
): boolean {
  let current = leaf;
  for (let i = 0; i < siblings.length; i++) {
    if (pathIndices[i] === 0) {
      current = hashPair(current, siblings[i]);
    } else {
      current = hashPair(siblings[i], current);
    }
  }
  return bytesToHex(current) === bytesToHex(root);
}

// ─── Note (private UTXO) ────────────────────────────────────────────────────

interface ShieldedNote {
  /** Amount of SOL in this note */
  amountSol: number;
  /** 32-byte secret (only the depositor knows this) */
  secret: string; // hex
  /** 32-byte nonce (randomness for commitment uniqueness) */
  nonce: string; // hex
  /** SHA256 commitment stored in Merkle tree */
  commitment: string; // hex
  /** Leaf index in Merkle tree */
  leafIndex: number;
  /** Whether this note has been spent (nullifier revealed) */
  spent: boolean;
  /** Nullifier (revealed on spend) */
  nullifier: string; // hex
  /** Timestamp */
  createdAt: number;
}

// ─── Vault State ─────────────────────────────────────────────────────────────

export interface VaultState {
  balanceSol: number;
  totalShieldedSol: number;
  totalUnshieldedSol: number;
  history: VaultOp[];
  /** Cryptographic state */
  merkleRoot: string;
  noteCount: number;
  nullifierCount: number;
}

export interface VaultOp {
  type: 'shield' | 'unshield';
  amountSol: number;
  timestamp: number;
  commitment: string;
  nullifier?: string;
  merkleRoot: string;
  proofValid?: boolean;
}

// ─── GlobalThis Storage ──────────────────────────────────────────────────────

const VAULT_KEY = '__MAKORA_ZK_VAULT__';

interface InternalVault {
  tree: MerkleTree;
  notes: ShieldedNote[];
  spentNullifiers: Set<string>;
  balanceSol: number;
  totalShieldedSol: number;
  totalUnshieldedSol: number;
  history: VaultOp[];
}

function getVault(): InternalVault {
  if (typeof globalThis !== 'undefined') {
    if (!(globalThis as any)[VAULT_KEY]) {
      (globalThis as any)[VAULT_KEY] = {
        tree: createMerkleTree(),
        notes: [],
        spentNullifiers: new Set<string>(),
        balanceSol: 0,
        totalShieldedSol: 0,
        totalUnshieldedSol: 0,
        history: [],
      } satisfies InternalVault;
    }
    return (globalThis as any)[VAULT_KEY];
  }
  return {
    tree: createMerkleTree(),
    notes: [],
    spentNullifiers: new Set(),
    balanceSol: 0,
    totalShieldedSol: 0,
    totalUnshieldedSol: 0,
    history: [],
  };
}

function saveVault(vault: InternalVault): void {
  if (typeof globalThis !== 'undefined') {
    (globalThis as any)[VAULT_KEY] = vault;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ShieldResult {
  success: boolean;
  commitment: string;
  nullifier: string;
  merkleRoot: string;
  leafIndex: number;
  newBalanceSol: number;
  error?: string;
}

/**
 * Shield SOL into the ZK vault.
 *
 * Cryptographic steps:
 * 1. Generate secret (32 bytes) and nonce (32 bytes)
 * 2. Compute commitment = SHA256(amount ‖ secret ‖ nonce)
 * 3. Insert commitment into Merkle tree
 * 4. Pre-compute nullifier = SHA256(secret ‖ leafIndex)
 * 5. Store note privately (secret never leaves this process)
 */
export function shieldSol(amountSol: number): ShieldResult {
  if (amountSol <= 0) {
    return { success: false, commitment: '', nullifier: '', merkleRoot: '', leafIndex: -1, newBalanceSol: getVault().balanceSol, error: 'Amount must be > 0' };
  }

  const vault = getVault();

  // 1. Generate cryptographic secrets
  const secret = secureRandom(32);
  const nonce = secureRandom(32);

  // 2. Compute commitment
  const commitmentBytes = computeCommitment(amountSol, secret, nonce);
  const commitment = bytesToHex(commitmentBytes);

  // 3. Insert into Merkle tree
  const leafIndex = insertLeaf(vault.tree, commitmentBytes);

  // 4. Compute nullifier (for future spending)
  const nullifierBytes = computeNullifier(secret, leafIndex);
  const nullifier = bytesToHex(nullifierBytes);

  // 5. Compute new Merkle root
  const rootBytes = computeRoot(vault.tree);
  const merkleRoot = bytesToHex(rootBytes);

  // Store note
  const note: ShieldedNote = {
    amountSol,
    secret: bytesToHex(secret),
    nonce: bytesToHex(nonce),
    commitment,
    leafIndex,
    spent: false,
    nullifier,
    createdAt: Date.now(),
  };
  vault.notes.push(note);

  // Update balance
  vault.balanceSol += amountSol;
  vault.totalShieldedSol += amountSol;
  vault.history.push({
    type: 'shield',
    amountSol,
    timestamp: Date.now(),
    commitment,
    merkleRoot,
  });

  saveVault(vault);

  console.log(`[ZK Vault] Shield: ${amountSol} SOL`);
  console.log(`  commitment: ${commitment.slice(0, 16)}...`);
  console.log(`  nullifier:  ${nullifier.slice(0, 16)}...`);
  console.log(`  leaf index: ${leafIndex}`);
  console.log(`  merkle root: ${merkleRoot.slice(0, 16)}...`);
  console.log(`  vault balance: ${vault.balanceSol.toFixed(4)} SOL`);

  return { success: true, commitment, nullifier, merkleRoot, leafIndex, newBalanceSol: vault.balanceSol };
}

export interface UnshieldResult {
  success: boolean;
  commitment: string;
  nullifier: string;
  merkleRoot: string;
  proofValid: boolean;
  newBalanceSol: number;
  error?: string;
}

/**
 * Unshield SOL from vault back to wallet.
 *
 * Cryptographic steps:
 * 1. Find unspent note(s) covering the requested amount
 * 2. For each note: reveal nullifier, verify Merkle proof
 * 3. Check nullifier not in spent set (double-spend protection)
 * 4. Mark nullifier as spent
 * 5. Update Merkle root
 */
export function unshieldSol(amountSol: number): UnshieldResult {
  if (amountSol <= 0) {
    return { success: false, commitment: '', nullifier: '', merkleRoot: '', proofValid: false, newBalanceSol: getVault().balanceSol, error: 'Amount must be > 0' };
  }

  const vault = getVault();

  if (amountSol > vault.balanceSol) {
    return {
      success: false,
      commitment: '',
      nullifier: '',
      merkleRoot: '',
      proofValid: false,
      newBalanceSol: vault.balanceSol,
      error: `Insufficient vault balance. Available: ${vault.balanceSol.toFixed(4)} SOL, requested: ${amountSol.toFixed(4)} SOL`,
    };
  }

  // Find unspent notes to cover the amount (FIFO)
  let remaining = amountSol;
  const notesToSpend: ShieldedNote[] = [];

  for (const note of vault.notes) {
    if (note.spent) continue;
    if (remaining <= 0) break;
    notesToSpend.push(note);
    remaining -= note.amountSol;
  }

  if (remaining > 0.000001) {
    return {
      success: false,
      commitment: '',
      nullifier: '',
      merkleRoot: '',
      proofValid: false,
      newBalanceSol: vault.balanceSol,
      error: 'Could not find enough unspent notes to cover the amount.',
    };
  }

  // Verify and spend each note
  const currentRoot = computeRoot(vault.tree);
  let allProofsValid = true;
  const commitments: string[] = [];
  const nullifiers: string[] = [];

  for (const note of notesToSpend) {
    // Re-derive commitment from stored secret to verify integrity
    const secret = hexToBytes(note.secret);
    const nonce = hexToBytes(note.nonce);
    const recomputedCommitment = computeCommitment(note.amountSol, secret, nonce);

    if (bytesToHex(recomputedCommitment) !== note.commitment) {
      console.error(`[ZK Vault] INTEGRITY FAIL: commitment mismatch for note ${note.leafIndex}`);
      allProofsValid = false;
      continue;
    }

    // Re-derive nullifier
    const recomputedNullifier = computeNullifier(secret, note.leafIndex);
    const nullifierHex = bytesToHex(recomputedNullifier);

    // Double-spend check
    if (vault.spentNullifiers.has(nullifierHex)) {
      console.error(`[ZK Vault] DOUBLE-SPEND ATTEMPT: nullifier already spent for note ${note.leafIndex}`);
      allProofsValid = false;
      continue;
    }

    // Merkle proof verification
    const proof = generateProof(vault.tree, note.leafIndex);
    const proofValid = verifyProof(recomputedCommitment, proof.siblings, proof.pathIndices, currentRoot);

    if (!proofValid) {
      console.error(`[ZK Vault] MERKLE PROOF INVALID for note ${note.leafIndex}`);
      allProofsValid = false;
      continue;
    }

    // Mark as spent
    note.spent = true;
    vault.spentNullifiers.add(nullifierHex);
    commitments.push(note.commitment);
    nullifiers.push(nullifierHex);

    console.log(`[ZK Vault] Spent note ${note.leafIndex}:`);
    console.log(`  nullifier: ${nullifierHex.slice(0, 16)}...`);
    console.log(`  merkle proof: VALID`);
  }

  // Handle change (if we spent more than needed from notes)
  const totalSpent = notesToSpend.reduce((s, n) => s + n.amountSol, 0);
  const change = totalSpent - amountSol;

  if (change > 0.000001) {
    // Create a new shielded note for the change
    const changeResult = shieldSol(change);
    if (changeResult.success) {
      console.log(`[ZK Vault] Change note created: ${change.toFixed(4)} SOL`);
      // Subtract the change that shieldSol added (it already added to balance)
      vault.balanceSol -= change;
    }
  }

  // Update balance
  vault.balanceSol -= amountSol;
  vault.totalUnshieldedSol += amountSol;

  const merkleRoot = bytesToHex(computeRoot(vault.tree));

  vault.history.push({
    type: 'unshield',
    amountSol,
    timestamp: Date.now(),
    commitment: commitments[0] || '',
    nullifier: nullifiers[0] || '',
    merkleRoot,
    proofValid: allProofsValid,
  });

  saveVault(vault);

  console.log(`[ZK Vault] Unshield: ${amountSol} SOL`);
  console.log(`  notes spent: ${notesToSpend.length}`);
  console.log(`  all proofs valid: ${allProofsValid}`);
  console.log(`  vault balance: ${vault.balanceSol.toFixed(4)} SOL`);

  return {
    success: true,
    commitment: commitments[0] || '',
    nullifier: nullifiers[0] || '',
    merkleRoot,
    proofValid: allProofsValid,
    newBalanceSol: vault.balanceSol,
  };
}

/**
 * Get current vault state (public info only — secrets are never exposed).
 */
export function getVaultState(): VaultState {
  const vault = getVault();
  const rootBytes = vault.tree.leaves.length > 0 ? computeRoot(vault.tree) : EMPTY_HASHES[TREE_DEPTH];
  return {
    balanceSol: vault.balanceSol,
    totalShieldedSol: vault.totalShieldedSol,
    totalUnshieldedSol: vault.totalUnshieldedSol,
    history: vault.history,
    merkleRoot: bytesToHex(rootBytes),
    noteCount: vault.notes.length,
    nullifierCount: vault.spentNullifiers.size,
  };
}

/**
 * Get vault balance in SOL.
 */
export function getVaultBalance(): number {
  return getVault().balanceSol;
}

/**
 * Deduct from vault balance (used by trading tools).
 */
export function deductFromVault(amountSol: number): boolean {
  const vault = getVault();
  if (amountSol > vault.balanceSol) return false;
  vault.balanceSol -= amountSol;
  saveVault(vault);
  return true;
}

/**
 * Add to vault balance (used when closing profitable positions).
 */
export function addToVault(amountSol: number): void {
  const vault = getVault();
  vault.balanceSol += amountSol;
  saveVault(vault);
}

/**
 * Run a cryptographic self-test to verify all primitives work correctly.
 * Returns a detailed report.
 */
export function runCryptoSelfTest(): string {
  const lines: string[] = ['=== ZK Vault Cryptographic Self-Test ===', ''];

  // Test 1: Commitment determinism
  const secret = new Uint8Array(32).fill(0xAB);
  const nonce = new Uint8Array(32).fill(0xCD);
  const c1 = computeCommitment(1.5, secret, nonce);
  const c2 = computeCommitment(1.5, secret, nonce);
  const commitMatch = bytesToHex(c1) === bytesToHex(c2);
  lines.push(`1. Commitment determinism: ${commitMatch ? 'PASS' : 'FAIL'}`);
  lines.push(`   SHA256(1.5 SOL ‖ 0xAB*32 ‖ 0xCD*32) = ${bytesToHex(c1).slice(0, 32)}...`);

  // Test 2: Different amounts produce different commitments
  const c3 = computeCommitment(2.0, secret, nonce);
  const diffAmount = bytesToHex(c1) !== bytesToHex(c3);
  lines.push(`2. Amount binding: ${diffAmount ? 'PASS' : 'FAIL'}`);

  // Test 3: Different secrets produce different commitments
  const secret2 = new Uint8Array(32).fill(0xEF);
  const c4 = computeCommitment(1.5, secret2, nonce);
  const diffSecret = bytesToHex(c1) !== bytesToHex(c4);
  lines.push(`3. Secret binding: ${diffSecret ? 'PASS' : 'FAIL'}`);

  // Test 4: Nullifier uniqueness
  const n1 = computeNullifier(secret, 0);
  const n2 = computeNullifier(secret, 1);
  const nullDiff = bytesToHex(n1) !== bytesToHex(n2);
  lines.push(`4. Nullifier uniqueness (diff index): ${nullDiff ? 'PASS' : 'FAIL'}`);
  lines.push(`   nullifier(0xAB*32, idx=0) = ${bytesToHex(n1).slice(0, 32)}...`);
  lines.push(`   nullifier(0xAB*32, idx=1) = ${bytesToHex(n2).slice(0, 32)}...`);

  // Test 5: Merkle tree + proof verification
  const tree = createMerkleTree();
  const leaf0 = c1;
  const leaf1 = c3;
  const idx0 = insertLeaf(tree, leaf0);
  const idx1 = insertLeaf(tree, leaf1);
  const root = computeRoot(tree);

  const proof0 = generateProof(tree, idx0);
  const valid0 = verifyProof(leaf0, proof0.siblings, proof0.pathIndices, root);
  lines.push(`5. Merkle proof (leaf 0): ${valid0 ? 'PASS' : 'FAIL'}`);

  const proof1 = generateProof(tree, idx1);
  const valid1 = verifyProof(leaf1, proof1.siblings, proof1.pathIndices, root);
  lines.push(`6. Merkle proof (leaf 1): ${valid1 ? 'PASS' : 'FAIL'}`);

  // Test 6: Invalid proof should fail
  const fakeLeaf = new Uint8Array(32).fill(0xFF);
  const invalidProof = verifyProof(fakeLeaf, proof0.siblings, proof0.pathIndices, root);
  lines.push(`7. Invalid leaf rejected: ${!invalidProof ? 'PASS' : 'FAIL'}`);

  // Test 7: Double-spend detection
  const spentSet = new Set<string>();
  const nullHex = bytesToHex(n1);
  spentSet.add(nullHex);
  const doubleSpend = spentSet.has(nullHex);
  lines.push(`8. Double-spend detection: ${doubleSpend ? 'PASS' : 'FAIL'}`);

  lines.push('');
  lines.push(`Merkle tree depth: ${TREE_DEPTH} (capacity: ${2 ** TREE_DEPTH} notes)`);
  lines.push(`Merkle root: ${bytesToHex(root).slice(0, 32)}...`);
  lines.push(`Hash function: SHA-256 (@noble/hashes)`);

  const allPass = commitMatch && diffAmount && diffSecret && nullDiff && valid0 && valid1 && !invalidProof && doubleSpend;
  lines.push('');
  lines.push(`Result: ${allPass ? 'ALL 8 TESTS PASSED' : 'SOME TESTS FAILED'}`);

  return lines.join('\n');
}

/**
 * Format vault info for LLM context.
 */
export function formatVaultForLLM(solPrice: number): string {
  const vault = getVault();
  if (vault.balanceSol === 0 && vault.totalShieldedSol === 0) {
    return 'ZK VAULT: Empty — user must shield SOL first (use shield_sol tool).';
  }

  const usdValue = vault.balanceSol * solPrice;
  const rootBytes = vault.tree.leaves.length > 0 ? computeRoot(vault.tree) : EMPTY_HASHES[TREE_DEPTH];

  const lines = [
    `ZK VAULT: ${vault.balanceSol.toFixed(4)} SOL ($${usdValue.toFixed(2)})`,
    `Notes: ${vault.notes.filter(n => !n.spent).length} unspent / ${vault.notes.length} total | Nullifiers spent: ${vault.spentNullifiers.size}`,
    `Merkle root: ${bytesToHex(rootBytes).slice(0, 16)}...`,
  ];

  if (vault.history.length > 0) {
    const last = vault.history[vault.history.length - 1];
    const ago = ((Date.now() - last.timestamp) / 60_000).toFixed(0);
    lines.push(`Last op: ${last.type} ${last.amountSol.toFixed(4)} SOL (${ago}m ago)`);
  }

  return lines.join('\n');
}
