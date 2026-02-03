use anchor_lang::prelude::*;
use crate::state::{Vault, AgentMode};
use crate::errors::VaultError;

#[derive(Accounts)]
pub struct AgentWithdraw<'info> {
    /// The agent authority that controls the vault in auto mode
    #[account(mut)]
    pub agent: Signer<'info>,

    /// The vault PDA to withdraw from.
    /// The vault owner's pubkey is used for PDA derivation.
    #[account(
        mut,
        seeds = [b"vault", vault.owner.as_ref()],
        bump = vault.bump,
        constraint = vault.agent_authority == agent.key() @ VaultError::UnauthorizedAgent,
    )]
    pub vault: Account<'info, Vault>,

    /// The destination session wallet that receives the SOL
    /// CHECK: This is an ephemeral session wallet; no constraints needed.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Agent withdraws SOL from the vault to a stealth session wallet.
/// Only callable by the vault's agent_authority, and only when mode == Auto.
pub fn handler(ctx: Context<AgentWithdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::ZeroWithdraw);

    let vault = &mut ctx.accounts.vault;

    // Only Auto mode allows agent operations
    require!(
        vault.mode == AgentMode::Auto,
        VaultError::NotAutoMode
    );

    let available = vault.current_balance();

    // Must respect min_sol_reserve
    let min_rent = Rent::get()?.minimum_balance(Vault::SIZE);
    let min_reserve = vault.risk_limits.min_sol_reserve;
    let total_min = min_rent
        .checked_add(min_reserve)
        .ok_or(VaultError::ArithmeticOverflow)?;

    let max_withdrawable = available.saturating_sub(total_min);
    require!(
        amount <= max_withdrawable,
        VaultError::InsufficientBalance
    );

    // Enforce max position size percentage
    let total_balance = vault.total_deposited.saturating_sub(vault.total_withdrawn);
    if total_balance > 0 {
        let max_position = total_balance
            .checked_mul(vault.risk_limits.max_position_size_pct as u64)
            .ok_or(VaultError::ArithmeticOverflow)?
            / 100;
        require!(
            amount <= max_position,
            VaultError::ExceedsMaxPosition
        );
    }

    // Transfer SOL from vault PDA to destination (session wallet)
    let vault_info = vault.to_account_info();
    let dest_info = ctx.accounts.destination.to_account_info();

    **vault_info.try_borrow_mut_lamports()? -= amount;
    **dest_info.try_borrow_mut_lamports()? += amount;

    // Track SOL that's out in sessions
    vault.in_session_amount = vault
        .in_session_amount
        .checked_add(amount)
        .ok_or(VaultError::ArithmeticOverflow)?;

    let clock = Clock::get()?;
    vault.last_action_at = clock.unix_timestamp;

    msg!(
        "Agent withdrew {} lamports to session wallet {}. In-session: {}",
        amount,
        ctx.accounts.destination.key(),
        vault.in_session_amount
    );

    Ok(())
}
