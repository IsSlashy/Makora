/// Groth16 verification key constants for the Transfer circuit (depth 20).
///
/// Generated from circuits/build/verification_key.json after trusted setup.
/// 7 public inputs: merkle_root, nullifier_1, nullifier_2,
///   output_commitment_1, output_commitment_2, public_amount, token_mint
///
/// To regenerate after circuit changes:
///   cd circuits
///   circom transfer.circom --r1cs --wasm --sym -o build/
///   snarkjs groth16 setup build/transfer.r1cs build/pot22_final.ptau build/transfer_0000.zkey
///   snarkjs zkey contribute build/transfer_0000.zkey build/transfer_final.zkey --name="makora" -v
///   snarkjs zkey export verificationkey build/transfer_final.zkey build/verification_key.json
///   Then parse verification_key.json and update the constants below.

/// Number of public inputs in the circuit
pub const NR_PUBLIC_INPUTS: usize = 7;

/// Verification key byte length:
///   alpha_g1:  64 bytes  (G1 point)
///   beta_g2:  128 bytes  (G2 point)
///   gamma_g2: 128 bytes  (G2 point)
///   delta_g2: 128 bytes  (G2 point)
///   IC:       (NR_PUBLIC_INPUTS + 1) * 64 = 512 bytes
///   Total:    64 + 128 + 128 + 128 + 512 = 960 bytes
pub const VERIFYING_KEY_LEN: usize = 960;

/// Packed verifying key bytes.
///
/// Layout:
///   [  0.. 64) alpha_g1       (G1 uncompressed, big-endian x || y)
///   [ 64..192) beta_g2        (G2 uncompressed, big-endian x_c1 || x_c0 || y_c1 || y_c0)
///   [192..320) gamma_g2       (G2 uncompressed)
///   [320..448) delta_g2       (G2 uncompressed)
///   [448..960) IC[0..8]       (8 × 64 bytes, G1 uncompressed)
///
/// IMPORTANT: These are placeholder values. Replace with real ceremony output
/// from verification_key.json before deploying to mainnet.
/// The placeholder structure is valid for groth16-solana parsing.
pub const VERIFYING_KEY: [u8; VERIFYING_KEY_LEN] = {
    // Placeholder: all zeros indicate "needs real ceremony data".
    // groth16-solana will reject proofs against zero keys, which is correct
    // safety behavior until real keys are embedded.
    [0u8; VERIFYING_KEY_LEN]
};
