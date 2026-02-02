use anchor_lang::prelude::*;
use crate::state::Vault;
use crate::errors::VaultError;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// The vault owner requesting the withdrawal
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The vault PDA to withdraw from
    /// Constraint: vault.owner must match the signer
    /// Seeds verify this is the correct vault for this owner
    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ VaultError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,

    /// System program (needed for lamport transfers via PDA)
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    // Validate amount
    require!(amount > 0, VaultError::ZeroWithdraw);

    let vault = &mut ctx.accounts.vault;

    // Check that vault has sufficient balance
    let current_balance = vault.current_balance();
    require!(
        amount <= current_balance,
        VaultError::InsufficientBalance
    );

    // Check that withdrawal doesn't leave less than the minimum SOL reserve
    // (to keep the account alive and pay for future transactions)
    let remaining_after = current_balance
        .checked_sub(amount)
        .ok_or(VaultError::ArithmeticOverflow)?;

    let min_rent = Rent::get()?.minimum_balance(Vault::SIZE);
    let min_reserve = vault.risk_limits.min_sol_reserve;
    let total_min = min_rent
        .checked_add(min_reserve)
        .ok_or(VaultError::ArithmeticOverflow)?;

    // Only enforce reserve if user is not withdrawing everything
    // (full withdrawal = closing the vault effectively)
    if remaining_after > 0 {
        require!(
            remaining_after >= total_min,
            VaultError::InsufficientReserve
        );
    }

    // Transfer SOL from vault PDA to owner
    // For PDA-owned lamports, we directly manipulate lamport balances
    // This is safe because the vault account is a PDA we control
    let vault_info = vault.to_account_info();
    let owner_info = ctx.accounts.owner.to_account_info();

    **vault_info.try_borrow_mut_lamports()? -= amount;
    **owner_info.try_borrow_mut_lamports()? += amount;

    // Update vault state with checked arithmetic
    vault.total_withdrawn = vault
        .total_withdrawn
        .checked_add(amount)
        .ok_or(VaultError::ArithmeticOverflow)?;

    let clock = Clock::get()?;
    vault.last_action_at = clock.unix_timestamp;

    msg!(
        "Withdrew {} lamports from vault. Total withdrawn: {}",
        amount,
        vault.total_withdrawn
    );

    Ok(())
}
