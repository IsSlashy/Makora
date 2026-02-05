use anchor_lang::prelude::*;

#[error_code]
pub enum PrivacyError {
    #[msg("Pool is not active.")]
    PoolNotActive,
    #[msg("Stealth payment already claimed.")]
    AlreadyClaimed,
    #[msg("Insufficient pool balance.")]
    InsufficientPoolBalance,
    #[msg("Invalid amount.")]
    InvalidAmount,
    #[msg("Unauthorized claim attempt.")]
    UnauthorizedClaim,
    #[msg("Nullifier already used (double-spend attempt).")]
    NullifierAlreadyUsed,
    #[msg("Invalid proof buffer: not owned by STARK verifier or too small.")]
    InvalidProofBuffer,
    #[msg("Proof not verified: buffer is not finalized.")]
    ProofNotVerified,
    #[msg("Proof nullifier does not match withdrawal nullifier.")]
    ProofNullifierMismatch,
    #[msg("Proof merkle root does not match withdrawal merkle root.")]
    ProofMerkleRootMismatch,
}
