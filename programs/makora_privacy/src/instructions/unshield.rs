use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey;
use crate::state::{ShieldedPool, NullifierRecord};
use crate::errors::PrivacyError;

/// Murkl STARK Verifier program ID (devnet + mainnet)
/// See: https://github.com/exidz/murkl
pub const STARK_VERIFIER_ID: Pubkey = pubkey!("StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw");

/// Proof buffer layout offsets (from Murkl SDK)
const OFFSET_OWNER: usize = 0;
const OFFSET_SIZE: usize = 32;
const OFFSET_EXPECTED_SIZE: usize = 36;
const OFFSET_FINALIZED: usize = 40;
const OFFSET_COMMITMENT: usize = 41;
const OFFSET_NULLIFIER: usize = 73;
const OFFSET_MERKLE_ROOT: usize = 105;
const MIN_BUFFER_SIZE: usize = 137;

#[derive(Accounts)]
#[instruction(amount: u64, nullifier_hash: [u8; 32], new_root: [u8; 32])]
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

    /// CHECK: STARK verifier proof buffer — validated in handler.
    /// Must be owned by the STARK Verifier program and contain a finalized proof
    /// whose public inputs (commitment, nullifier, merkle_root) match the
    /// transaction parameters.
    #[account(
        constraint = verifier_buffer.owner == &STARK_VERIFIER_ID @ PrivacyError::InvalidProofBuffer
    )]
    pub verifier_buffer: UncheckedAccount<'info>,

    #[account(mut)]
    pub recipient: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Unshield>,
    amount: u64,
    nullifier_hash: [u8; 32],
    new_root: [u8; 32],
) -> Result<()> {
    require!(amount > 0, PrivacyError::InvalidAmount);

    let pool = &mut ctx.accounts.pool;
    let nullifier_record = &mut ctx.accounts.nullifier_record;
    let clock = Clock::get()?;

    // =====================================================================
    // STARK PROOF VERIFICATION (via Murkl Verifier CPI)
    //
    // The proof buffer was created by:
    //   1. init_proof_buffer() — allocate buffer account
    //   2. upload_chunk()      — upload STARK proof in chunks
    //   3. finalize_and_verify() — verify proof, set finalized=true
    //
    // We read the buffer to check:
    //   a) finalized == true (proof was cryptographically verified)
    //   b) nullifier matches nullifier_hash (prevents proof reuse)
    //   c) merkle_root matches new_root (proves membership in current tree)
    //
    // This replaces the previous unverified merkle root update.
    // See: https://github.com/exidz/murkl/blob/main/docs/INTEGRATION.md
    // =====================================================================
    let buffer_data = ctx.accounts.verifier_buffer.try_borrow_data()?;

    // Validate buffer size
    require!(
        buffer_data.len() >= MIN_BUFFER_SIZE,
        PrivacyError::InvalidProofBuffer
    );

    // Check proof is finalized (verified by STARK verifier)
    let finalized = buffer_data[OFFSET_FINALIZED] == 1;
    require!(finalized, PrivacyError::ProofNotVerified);

    // Verify nullifier matches — binds this proof to this specific withdrawal
    let proof_nullifier = &buffer_data[OFFSET_NULLIFIER..OFFSET_NULLIFIER + 32];
    require!(
        proof_nullifier == nullifier_hash,
        PrivacyError::ProofNullifierMismatch
    );

    // Verify merkle root matches — proves the note exists in the current tree
    let proof_merkle_root = &buffer_data[OFFSET_MERKLE_ROOT..OFFSET_MERKLE_ROOT + 32];
    require!(
        proof_merkle_root == new_root,
        PrivacyError::ProofMerkleRootMismatch
    );

    // Verify pool has sufficient balance
    require!(
        pool.total_shielded >= amount,
        PrivacyError::InsufficientPoolBalance
    );

    // Initialize nullifier record (prevents double-spend)
    nullifier_record.pool = pool.key();
    nullifier_record.nullifier = nullifier_hash;
    nullifier_record.used_at = clock.unix_timestamp;
    nullifier_record.bump = ctx.bumps.nullifier_record;

    // Update merkle root (now verified by STARK proof)
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
        "Unshield withdrawal: {} lamports | nullifier verified | merkle_root verified",
        amount
    );

    Ok(())
}
