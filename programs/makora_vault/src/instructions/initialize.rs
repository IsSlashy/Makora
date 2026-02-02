use anchor_lang::prelude::*;
use crate::state::{Vault, AgentMode, RiskLimits};
use crate::errors::VaultError;

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The user creating the vault (pays for account creation)
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The vault PDA to initialize
    /// Seeds: ["vault", owner_pubkey]
    /// Constraint: one vault per user, enforced by PDA derivation
    #[account(
        init,
        payer = owner,
        space = Vault::SIZE,
        seeds = [b"vault", owner.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    /// System program for account creation
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Initialize>,
    agent_authority: Pubkey,
    mode: u8,
    max_position_size_pct: u8,
    max_slippage_bps: u16,
    max_daily_loss_pct: u8,
    min_sol_reserve: u64,
    max_protocol_exposure_pct: u8,
) -> Result<()> {
    // Validate agent mode
    let agent_mode = AgentMode::from_u8(mode)?;

    // Validate risk limits are within sane ranges
    require!(
        max_position_size_pct <= 100,
        VaultError::InvalidRiskLimit
    );
    require!(
        max_slippage_bps <= 10_000, // max 100%
        VaultError::InvalidRiskLimit
    );
    require!(
        max_daily_loss_pct <= 100,
        VaultError::InvalidRiskLimit
    );
    require!(
        max_protocol_exposure_pct <= 100,
        VaultError::InvalidRiskLimit
    );

    let vault = &mut ctx.accounts.vault;
    let clock = Clock::get()?;

    vault.owner = ctx.accounts.owner.key();
    vault.agent_authority = agent_authority;
    vault.total_deposited = 0;
    vault.total_withdrawn = 0;
    vault.mode = agent_mode;
    vault.risk_limits = RiskLimits {
        max_position_size_pct,
        max_slippage_bps,
        max_daily_loss_pct,
        min_sol_reserve,
        max_protocol_exposure_pct,
    };
    vault.created_at = clock.unix_timestamp;
    vault.last_action_at = clock.unix_timestamp;
    vault.bump = ctx.bumps.vault;
    vault._padding = [0u8; 32];

    msg!(
        "Vault initialized for owner {} with mode {:?}",
        vault.owner,
        mode
    );

    Ok(())
}
