use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    /// Deposit amount must be greater than zero
    #[msg("Deposit amount must be greater than zero")]
    ZeroDeposit,

    /// Withdraw amount must be greater than zero
    #[msg("Withdraw amount must be greater than zero")]
    ZeroWithdraw,

    /// Withdraw amount exceeds vault balance
    #[msg("Withdraw amount exceeds vault balance")]
    InsufficientBalance,

    /// Arithmetic overflow during balance calculation
    #[msg("Arithmetic overflow in balance calculation")]
    ArithmeticOverflow,

    /// Invalid agent mode value (must be 0 or 1)
    #[msg("Invalid agent mode (must be 0=advisory or 1=auto)")]
    InvalidAgentMode,

    /// Risk limit value is out of valid range
    #[msg("Risk limit value out of range")]
    InvalidRiskLimit,

    /// Unauthorized: signer is not the vault owner
    #[msg("Unauthorized: signer is not the vault owner")]
    Unauthorized,

    /// Vault is already initialized
    #[msg("Vault is already initialized for this owner")]
    AlreadyInitialized,

    /// Must keep minimum SOL reserve for rent and gas
    #[msg("Must keep minimum SOL reserve for rent and gas")]
    InsufficientReserve,
}
