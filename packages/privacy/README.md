# @makora/privacy

Privacy layer for Makora - stealth addresses and shielded transfers.

## Features

- **Stealth Addresses**: Generate one-time addresses for private payments
- **Shielded Transfers**: Zero-knowledge proofs for confidential transactions
- **Merkle Tree**: Efficient note commitment storage
- **ZK Prover**: Groth16 proof generation (optional, requires snarkjs)

## Installation

```bash
pnpm add @makora/privacy
```

## Usage

### Stealth Addresses

```typescript
import { PrivacyManager, generateStealthMetaAddress } from '@makora/privacy';
import { Keypair } from '@solana/web3.js';

// Create privacy manager
const privacyManager = new PrivacyManager({ enabled: true });

// Generate stealth meta-address
const spendingKeypair = Keypair.generate();
const viewingKeypair = Keypair.generate();
const metaAddress = privacyManager.generateMetaAddress(spendingKeypair, viewingKeypair);

console.log('Stealth meta-address:', metaAddress.encoded);

// Derive one-time stealth address for payment
const { address, ephemeralPubKey, viewTag } = privacyManager.deriveStealthAddress(metaAddress);
```

### Shielded Transfers

```typescript
import { createNote, MerkleTree } from '@makora/privacy';

// Create a shielded note
const amount = 1000000n; // lamports
const ownerPubkey = 12345n; // as field element
const tokenMint = 67890n; // as field element

const note = createNote(amount, ownerPubkey, tokenMint);

// Insert into Merkle tree
const tree = new MerkleTree();
const leafIndex = tree.insert(note.commitment);

// Generate Merkle proof
const proof = tree.generateProof(leafIndex);
```

### ZK Proofs

```typescript
import { ZkProver } from '@makora/privacy';

const prover = new ZkProver();
await prover.initialize();

const { proof, publicSignals } = await prover.generateTransferProof(
  publicInputs,
  privateInputs
);
```

## Building

```bash
# Install dependencies
pnpm install

# Build the package
pnpm build

# Type check
pnpm typecheck
```

## Architecture

- `src/stealth/` - Stealth address implementation
  - `generate.ts` - Meta-address and one-time address generation
  - `derive.ts` - Key derivation and verification
  - `scan.ts` - Payment scanning

- `src/shielded/` - Shielded transfer implementation
  - `note.ts` - Note creation and encryption
  - `merkle.ts` - Sparse Merkle tree
  - `prover.ts` - ZK proof generation

- `src/privacy-manager.ts` - Main API that ties everything together
- `src/types.ts` - TypeScript type definitions

## Security Notes

- This is a hackathon implementation and should NOT be used in production
- The elliptic curve operations use simplified implementations
- Production use requires proper EC point addition using a cryptographic library
- ZK circuits are ported from P01 but require full audit before production use
