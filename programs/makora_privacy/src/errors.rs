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
}
