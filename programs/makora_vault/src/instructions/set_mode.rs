use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::vault::{AgentMode, Vault};

/// Set the vault's agent operating mode.
/// Only the vault owner can change modes.
pub fn handler(ctx: Context<SetMode>, mode: u8) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let new_mode = AgentMode::from_u8(mode)?;
    vault.mode = new_mode;
    vault.last_action_at = Clock::get()?.unix_timestamp;
    Ok(())
}

#[derive(Accounts)]
pub struct SetMode<'info> {
    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ VaultError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub owner: Signer<'info>,
}
