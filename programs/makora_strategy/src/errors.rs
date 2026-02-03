use anchor_lang::prelude::*;

#[error_code]
pub enum StrategyError {
    #[msg("Invalid strategy type. Must be 0 (yield), 1 (trading), 2 (rebalance), or 3 (liquidity).")]
    InvalidStrategyType,

    #[msg("Invalid allocation: target percentages must sum to 100.")]
    InvalidAllocationSum,

    #[msg("Invalid allocation: individual percentage must be 0-100.")]
    InvalidAllocationEntry,

    #[msg("Unauthorized: only the owner can update permissions.")]
    UnauthorizedPermissionsUpdate,

    #[msg("Unauthorized: only the owner or agent authority can update strategy.")]
    UnauthorizedStrategyUpdate,

    #[msg("Unauthorized: only the owner or agent authority can log actions.")]
    UnauthorizedLogAction,

    #[msg("Invalid agent mode. Must be 0 (advisory) or 1 (auto).")]
    InvalidAgentMode,

    #[msg("Audit trail is full. This should never happen (ring buffer).")]
    AuditTrailFull,

    #[msg("Description too long. Maximum 64 bytes.")]
    DescriptionTooLong,

    #[msg("Action type too long. Maximum 16 bytes.")]
    ActionTypeTooLong,

    #[msg("Protocol name too long. Maximum 16 bytes.")]
    ProtocolTooLong,
}
