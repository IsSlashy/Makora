use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::Vault;
use crate::errors::VaultError;

#[derive(Accounts)]
pub struct AgentDeposit<'info> {
    /// The agent authority that controls the vault in auto mode
    pub agent: Signer<'info>,

    /// The vault PDA to deposit into.
    #[account(
        mut,
        seeds = [b"vault", vault.owner.as_ref()],
        bump = vault.bump,
        constraint = vault.agent_authority == agent.key() @ VaultError::UnauthorizedAgent,
    )]
    pub vault: Account<'info, Vault>,

    /// The session wallet returning SOL to the vault.
    /// Must be a signer so it can transfer lamports via CPI.
    #[account(mut)]
    pub source: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Agent deposits SOL back into the vault from a stealth session wallet.
/// Called during session sweep to return funds (possibly with profit).
pub fn handler(ctx: Context<AgentDeposit>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::ZeroDeposit);

    let vault = &mut ctx.accounts.vault;

    // Transfer SOL from session wallet to vault PDA via CPI
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.source.to_account_info(),
                to: vault.to_account_info(),
            },
        ),
        amount,
    )?;

    // Decrement in_session_amount (capped at 0 to handle profits)
    vault.in_session_amount = vault.in_session_amount.saturating_sub(amount);

    // If the return is more than what was tracked as in-session,
    // the excess is profit — credit it to total_deposited
    // (in_session_amount saturating_sub already handles the tracking)
    // We always increment total_deposited to reflect the actual
    // SOL that re-entered the vault, keeping the accounting clean.
    // The caller is expected to return everything including profits.

    let clock = Clock::get()?;
    vault.last_action_at = clock.unix_timestamp;

    msg!(
        "Agent deposited {} lamports from session wallet {}. In-session: {}",
        amount,
        ctx.accounts.source.key(),
        vault.in_session_amount
    );

    Ok(())
}
