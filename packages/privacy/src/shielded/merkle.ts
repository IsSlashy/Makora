/**
 * Merkle tree utilities for note commitment storage
 * Implements a sparse Merkle tree with hash-based commitment
 */

import { sha256 } from '@noble/hashes/sha256';
import type { MerkleProof } from '../types';

const MERKLE_TREE_DEPTH = 20;
const ZERO_VALUE = 0n;
const MAX_TREE_LEAVES = 2 ** MERKLE_TREE_DEPTH;

/**
 * Sparse Merkle tree implementation
 */
export class MerkleTree {
  private depth: number;
  private leaves: Map<number, bigint>;
  private nodes: Map<string, bigint>;
  private zeroValues: bigint[];
  private _root: bigint;

  constructor(depth: number = MERKLE_TREE_DEPTH) {
    this.depth = depth;
    this.leaves = new Map();
    this.nodes = new Map();
    this.zeroValues = [];
    this._root = ZERO_VALUE;
    this.initializeZeroValues();
  }

  /**
   * Initialize zero values for each level
   */
  private initializeZeroValues(): void {
    let current = ZERO_VALUE;
    this.zeroValues = [current];

    for (let i = 0; i < this.depth; i++) {
      current = this.hash(current, current);
      this.zeroValues.push(current);
    }

    this._root = this.zeroValues[this.depth]!;
  }

  /**
   * Get current root
   */
  getRoot(): bigint {
    return this._root;
  }

  /**
   * Get number of leaves
   */
  get leafCount(): number {
    return this.leaves.size;
  }

  /**
   * Insert a leaf at the next available index
   * @param leaf - The leaf value to insert
   * @returns The leaf index
   */
  insert(leaf: bigint): number {
    const index = this.leaves.size;
    if (index >= MAX_TREE_LEAVES) {
      throw new Error('Tree is full');
    }

    this.leaves.set(index, leaf);
    this.updatePath(index, leaf);

    return index;
  }

  /**
   * Insert a leaf at a specific index (for reconstruction)
   */
  insertAt(index: number, leaf: bigint): void {
    if (index >= MAX_TREE_LEAVES) {
      throw new Error('Index out of bounds');
    }

    this.leaves.set(index, leaf);
    this.updatePath(index, leaf);
  }

  /**
   * Get leaf at index
   */
  getLeaf(index: number): bigint | undefined {
    return this.leaves.get(index);
  }

  /**
   * Generate Merkle proof for a leaf
   * @param leafIndex - Index of the leaf
   * @returns Merkle proof data
   */
  generateProof(leafIndex: number): MerkleProof {
    const leaf = this.leaves.get(leafIndex);
    if (leaf === undefined) {
      throw new Error('Leaf not found');
    }

    const pathIndices: number[] = [];
    const path: bigint[] = [];

    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const isLeft = currentIndex % 2 === 0;
      const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;

      pathIndices.push(isLeft ? 0 : 1);

      // Get sibling
      let sibling: bigint;
      if (level === 0) {
        sibling = this.leaves.get(siblingIndex) ?? ZERO_VALUE;
      } else {
        const siblingKey = `${level - 1}:${siblingIndex}`;
        sibling = this.nodes.get(siblingKey) ?? this.zeroValues[level]!;
      }

      path.push(sibling);
      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      path,
      pathIndices,
      root: this._root,
      leaf,
      leafIndex,
    };
  }

  /**
   * Verify a Merkle proof
   */
  verifyProof(proof: MerkleProof): boolean {
    let currentHash = proof.leaf;

    for (let i = 0; i < proof.path.length; i++) {
      const isLeft = proof.pathIndices[i] === 0;
      const [left, right] = isLeft
        ? [currentHash, proof.path[i]!]
        : [proof.path[i]!, currentHash];

      currentHash = this.hash(left, right);
    }

    return currentHash === proof.root;
  }

  /**
   * Update the path from leaf to root
   */
  private updatePath(leafIndex: number, leafValue: bigint): void {
    let currentHash = leafValue;
    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const isLeft = currentIndex % 2 === 0;
      const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;

      // Get sibling hash
      let sibling: bigint;
      if (level === 0) {
        sibling = this.leaves.get(siblingIndex) ?? ZERO_VALUE;
      } else {
        const siblingKey = `${level - 1}:${siblingIndex}`;
        sibling = this.nodes.get(siblingKey) ?? this.zeroValues[level]!;
      }

      // Compute parent hash
      const [left, right] = isLeft ? [currentHash, sibling] : [sibling, currentHash];
      currentHash = this.hash(left, right);

      // Store in nodes map
      const parentIndex = Math.floor(currentIndex / 2);
      this.nodes.set(`${level}:${parentIndex}`, currentHash);

      currentIndex = parentIndex;
    }

    this._root = currentHash;
  }

  /**
   * Hash two field elements
   * Simplified version using SHA256 - production would use Poseidon
   */
  private hash(left: bigint, right: bigint): bigint {
    const input = new Uint8Array(64);
    input.set(fieldToBytes(left), 0);
    input.set(fieldToBytes(right), 32);
    const hash = sha256(input);
    return bytesToField(hash);
  }

  /**
   * Export tree state for serialization
   */
  export(): { leaves: [number, string][]; depth: number } {
    const leaves: [number, string][] = [];
    this.leaves.forEach((value, index) => {
      leaves.push([index, value.toString()]);
    });

    return { leaves, depth: this.depth };
  }

  /**
   * Import tree state
   */
  import(state: { leaves: [number, string][]; depth: number }): void {
    this.depth = state.depth;
    this.leaves.clear();
    this.nodes.clear();

    this.initializeZeroValues();

    // Sort leaves by index and insert
    const sortedLeaves = [...state.leaves].sort((a, b) => a[0] - b[0]);
    for (const [index, value] of sortedLeaves) {
      this.insertAt(index, BigInt(value));
    }
  }
}

/**
 * Generate Merkle proof for a leaf index
 */
export function generateMerkleProof(
  tree: MerkleTree,
  leafIndex: number
): MerkleProof {
  return tree.generateProof(leafIndex);
}

/**
 * Verify a Merkle proof
 */
export function verifyMerkleProof(proof: MerkleProof): boolean {
  const tree = new MerkleTree(proof.path.length);
  return tree.verifyProof(proof);
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Convert field element to bytes
 */
function fieldToBytes(field: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let value = field;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn);
    value = value >> 8n;
  }
  return bytes;
}

/**
 * Convert bytes to field element
 */
function bytesToField(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < Math.min(bytes.length, 32); i++) {
    result = (result << 8n) | BigInt(bytes[i]!);
  }
  return result;
}
