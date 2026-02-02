# Makora ZK Circuits

Zero-knowledge circuits for Makora's privacy-preserving token transfers on Solana.

## Overview

These Circom circuits implement a Zcash-style shielded pool with:
- **2-in-2-out transfers**: Support for combining/splitting notes
- **Nullifier system**: Prevent double-spending
- **Merkle tree membership proofs**: Verify note existence without revealing which note
- **Value conservation**: Cryptographically enforce input = output
- **Range proofs**: Ensure amounts are valid (non-negative, < 2^64)

## Circuit Files

- `transfer.circom` - Main transfer circuit with full privacy logic
- `poseidon.circom` - Poseidon hash templates for commitments and nullifiers
- `merkle.circom` - Merkle tree verification templates
- `package.json` - Build scripts and dependencies

## Architecture

### Public Inputs
- `merkle_root`: Current state of the note tree
- `nullifier_1`, `nullifier_2`: Nullifiers to mark notes as spent
- `output_commitment_1`, `output_commitment_2`: New note commitments
- `public_amount`: Net public flow (positive = shield, negative = unshield, 0 = private)
- `token_mint`: Token being transferred

### Private Inputs
- Input notes (amounts, owners, randomness, Merkle paths)
- Output notes (amounts, recipients, randomness)
- Spending key (proves ownership of input notes)

## Building

**Note**: Building requires `circom` compiler and Powers of Tau ceremony files.

```bash
# Install dependencies
npm install

# Compile circuits
npm run compile

# Full build (requires ptau file)
npm run build
```

## ZK Proof Flow

1. **Commitment**: User creates note commitment = `Poseidon(amount, owner_pubkey, randomness, token_mint)`
2. **Shield**: Note commitment added to Merkle tree onchain
3. **Spend**: User generates ZK proof showing:
   - They know spending key for input notes
   - Input notes exist in Merkle tree
   - Nullifiers prevent double-spend
   - Value is conserved
   - All amounts are valid
4. **Verify**: Solana program verifies proof + checks nullifiers haven't been used

## Integration with Solana Program

The compiled circuits generate:
- `transfer.wasm` - WASM for proof generation (client-side)
- `verification_key.json` - Verification key (onchain)
- Solana program uses Groth16 verifier to validate proofs

## Security

- Uses Poseidon hash (ZK-friendly, ~10x faster than SHA256 in circuits)
- Merkle tree depth 20 supports ~1M notes
- Groth16 proving system (constant-size proofs, fast verification)
- Range checks prevent negative amounts or overflow attacks

## Credits

Ported from P01 (Protocol 01) privacy layer.
