use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("BTAd1ghiv4jKd4kREh14jCtHrVG6zDFNgLRNoF9pUgqw");

#[program]
pub mod makora_vault {
    use super::*;

    /// Initialize a new vault for a user.
    /// Creates a PDA with seeds = ["vault", owner].
    /// The vault tracks deposits, withdrawals, agent mode, and risk limits.
    pub fn initialize(
        ctx: Context<Initialize>,
        agent_authority: Pubkey,
        mode: u8,
        max_position_size_pct: u8,
        max_slippage_bps: u16,
        max_daily_loss_pct: u8,
        min_sol_reserve: u64,
        max_protocol_exposure_pct: u8,
    ) -> Result<()> {
        instructions::initialize::handler(
            ctx,
            agent_authority,
            mode,
            max_position_size_pct,
            max_slippage_bps,
            max_daily_loss_pct,
            min_sol_reserve,
            max_protocol_exposure_pct,
        )
    }

    /// Deposit SOL into the vault.
    /// Only the vault owner can deposit.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    /// Withdraw SOL from the vault.
    /// Only the vault owner can withdraw.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, amount)
    }
}
