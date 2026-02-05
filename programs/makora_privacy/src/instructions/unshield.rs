use anchor_lang::prelude::*;
use crate::state::{ShieldedPool, NullifierRecord};
use crate::errors::PrivacyError;
use crate::verifying_key::{VERIFYING_KEY, NR_PUBLIC_INPUTS};
use groth16_solana::groth16::Groth16Verifier;

#[derive(Accounts)]
#[instruction(
    amount: u64,
    nullifier_hash: [u8; 32],
    new_root: [u8; 32],
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    public_inputs: [[u8; 32]; 7],
)]
pub struct Unshield<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.authority.as_ref()],
        bump = pool.bump,
        constraint = pool.is_active @ PrivacyError::PoolNotActive
    )]
    pub pool: Account<'info, ShieldedPool>,

    #[account(
        init,
        payer = recipient,
        space = NullifierRecord::SIZE,
        seeds = [b"nullifier", pool.key().as_ref(), nullifier_hash.as_ref()],
        bump
    )]
    pub nullifier_record: Account<'info, NullifierRecord>,

    #[account(mut)]
    pub recipient: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Unshield>,
    amount: u64,
    nullifier_hash: [u8; 32],
    new_root: [u8; 32],
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    public_inputs: [[u8; 32]; 7],
) -> Result<()> {
    require!(amount > 0, PrivacyError::InvalidAmount);

    let pool = &mut ctx.accounts.pool;
    let nullifier_record = &mut ctx.accounts.nullifier_record;
    let clock = Clock::get()?;

    // Verify pool has sufficient balance
    require!(
        pool.total_shielded >= amount,
        PrivacyError::InsufficientPoolBalance
    );

    // ── Groth16 proof verification ──────────────────────────────────────────
    // Flatten public_inputs into a contiguous byte slice for the verifier.
    let mut public_inputs_bytes = [[0u8; 32]; NR_PUBLIC_INPUTS];
    for i in 0..NR_PUBLIC_INPUTS {
        public_inputs_bytes[i] = public_inputs[i];
    }

    let mut verifier = Groth16Verifier::new(
        &proof_a,
        &proof_b,
        &proof_c,
        &public_inputs_bytes,
        &VERIFYING_KEY,
    )
    .map_err(|_| error!(PrivacyError::InvalidProof))?;

    require!(
        verifier.verify().map_err(|_| error!(PrivacyError::InvalidProof))?,
        PrivacyError::InvalidProof
    );
    // ── End proof verification ──────────────────────────────────────────────

    // Initialize nullifier record (prevents double-spend)
    nullifier_record.pool = pool.key();
    nullifier_record.nullifier = nullifier_hash;
    nullifier_record.used_at = clock.unix_timestamp;
    nullifier_record.bump = ctx.bumps.nullifier_record;

    // Update merkle root
    pool.merkle_root = new_root;

    // Update pool state
    pool.total_shielded = pool.total_shielded
        .checked_sub(amount)
        .ok_or(PrivacyError::InsufficientPoolBalance)?;

    pool.last_tx_at = clock.unix_timestamp;

    // Transfer SOL from pool to recipient
    let pool_info = pool.to_account_info();
    let recipient_info = ctx.accounts.recipient.to_account_info();

    **pool_info.try_borrow_mut_lamports()? = pool_info
        .lamports()
        .checked_sub(amount)
        .ok_or(PrivacyError::InsufficientPoolBalance)?;

    **recipient_info.try_borrow_mut_lamports()? = recipient_info
        .lamports()
        .checked_add(amount)
        .ok_or(PrivacyError::InvalidAmount)?;

    msg!(
        "Unshield withdrawal: {} lamports | proof verified | new_root: {:?}",
        amount,
        new_root
    );

    Ok(())
}
