# @makora/privacy Implementation Summary

## Overview

This package implements privacy features for Makora, a DeFi agent for Solana. It provides two main privacy primitives:

1. **Stealth Addresses** - One-time addresses for private payments
2. **Shielded Transfers** - Zero-knowledge proofs for confidential transactions

## Implementation Details

### Stealth Addresses

Based on the implementation from P01 (Protocol 01), the stealth address system uses:

- **Meta-Address**: A pair of public keys (spending + viewing) that recipients share
- **One-Time Addresses**: Ephemeral addresses derived from the meta-address
- **View Tags**: Single-byte tags for efficient payment scanning
- **ECDH**: Elliptic Curve Diffie-Hellman for shared secret derivation

#### How it works:

1. **Recipient** generates a meta-address with two keypairs:
   - Spending keypair (K, k) - for spending received funds
   - Viewing keypair (V, v) - for scanning and detecting payments

2. **Sender** derives a one-time stealth address:
   - Generates ephemeral keypair (R, r)
   - Computes shared secret: s = ECDH(r, V)
   - Derives stealth public key: P = K + hash(s)*G
   - Publishes (P, R, viewTag) on-chain

3. **Recipient** scans for payments:
   - For each announcement (P, R, viewTag):
     - Quick check: viewTag == hash(ECDH(v, R))[0]
     - Full check: P == K + hash(ECDH(v, R))*G
     - If match, derive spending key: p = k + hash(ECDH(v, R))

#### Files:
- `stealth/generate.ts` - Meta-address and one-time address generation
- `stealth/derive.ts` - Key derivation and verification
- `stealth/scan.ts` - Payment scanner with view tag optimization

### Shielded Transfers

Based on the ZK implementation from P01, using Groth16 SNARKs:

- **Notes**: Shielded UTXOs with commitments
- **Merkle Tree**: Sparse tree for note commitments (depth 20)
- **Circuits**: Zero-knowledge circuits for transfer proofs
- **Nullifiers**: Prevent double-spending

#### How it works:

1. **Note Structure**:
   ```
   commitment = Poseidon(amount, ownerPubkey, randomness, tokenMint)
   ```

2. **Transfer Circuit** proves:
   - Input notes are in the Merkle tree
   - Sender knows the spending key
   - Input amounts = output amounts (conservation)
   - Nullifiers are correctly computed
   - All without revealing amounts or identities

3. **Merkle Tree** provides:
   - Efficient proof of note membership
   - Sparse structure (only ~2^20 leaves needed)
   - SHA256-based hashing (Poseidon in production)

#### Files:
- `shielded/note.ts` - Note creation, encryption, serialization
- `shielded/merkle.ts` - Sparse Merkle tree implementation
- `shielded/prover.ts` - Groth16 proof generation wrapper

### Privacy Manager

The `PrivacyManager` class provides a unified API:

```typescript
const manager = new PrivacyManager({ enabled: true });

// Stealth operations
const metaAddress = manager.generateMetaAddress(spendingKp, viewingKp);
const { address } = manager.deriveStealthAddress(metaAddress);

// Shielded operations
const note = manager.createShieldedNote(amount, recipient, tokenMint);
const leafIndex = manager.insertNoteCommitment(note.commitment);
const proof = manager.generateMerkleProof(leafIndex);
const zkProof = await manager.generateShieldProof(publicInputs, privateInputs);
```

## Cryptographic Primitives

### Used Libraries:
- `tweetnacl` - NaCl cryptography (X25519, Ed25519, XSalsa20-Poly1305)
- `@noble/hashes` - SHA256 hashing
- `bs58` - Base58 encoding (for Solana compatibility)
- `snarkjs` - Groth16 SNARK prover (optional dependency)

### Key Operations:
- **ECDH**: `nacl.scalarMult(privateKey, publicKey)`
- **Hashing**: `sha256(data)` (simplified; Poseidon in production)
- **Encryption**: XOR-based stream cipher (XChaCha20-Poly1305 in production)
- **Signatures**: Ed25519 via `nacl.sign`

## Security Considerations

### Current Implementation (Hackathon):
- Simplified EC point addition (XOR-based)
- SHA256 instead of Poseidon for commitments
- Basic stream cipher for note encryption
- No formal security audit

### Production Requirements:
- Proper elliptic curve arithmetic using a certified library
- Poseidon hash for ZK-friendly commitments
- XChaCha20-Poly1305 AEAD for encryption
- Formal security audit
- Side-channel attack protection
- Constant-time operations for sensitive data

## Testing

To verify the implementation:

```bash
# Run verification script
node verify.mjs

# Type check
pnpm typecheck

# Build package
pnpm build
```

## References

- P01 (Protocol 01): Reference implementation at `P:\p01`
- Stealth Addresses: ERC-5564 standard
- Zcash Protocol: Shielded transaction design
- Circom: Zero-knowledge circuit language
- snarkjs: JavaScript implementation of Groth16

## Future Enhancements

1. **Stealth Pools**: Aggregate multiple stealth payments
2. **Recursive Proofs**: Compress proof size using Halo2/PLONK
3. **Multi-Asset**: Support multiple SPL tokens in one note
4. **Decoy Outputs**: Add dummy outputs for better privacy
5. **Hardware Wallet**: Support for Ledger/Trezor signing
6. **Mobile SDK**: React Native bindings for mobile apps
