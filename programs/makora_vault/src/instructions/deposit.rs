use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::Vault;
use crate::errors::VaultError;

#[derive(Accounts)]
pub struct Deposit<'info> {
    /// The vault owner making the deposit
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The vault PDA to deposit into
    /// Constraint: vault.owner must match the signer
    /// Seeds verify this is the correct vault for this owner
    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ VaultError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,

    /// System program for the SOL transfer
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    // Validate amount
    require!(amount > 0, VaultError::ZeroDeposit);

    // Transfer SOL from owner to vault PDA
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        amount,
    )?;

    // Update vault state with checked arithmetic
    let vault = &mut ctx.accounts.vault;
    vault.total_deposited = vault
        .total_deposited
        .checked_add(amount)
        .ok_or(VaultError::ArithmeticOverflow)?;

    let clock = Clock::get()?;
    vault.last_action_at = clock.unix_timestamp;

    msg!(
        "Deposited {} lamports into vault. Total deposited: {}",
        amount,
        vault.total_deposited
    );

    Ok(())
}
