use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;
pub mod verifying_key;

use instructions::*;

declare_id!("C1qXFsB6oJgZLQnXwRi9mwrm3QshKMU8kGGUZTAa9xcM");

#[program]
pub mod makora_privacy {
    use super::*;

    pub fn init_pool(ctx: Context<InitPool>) -> Result<()> {
        instructions::init_pool::handler(ctx)
    }

    pub fn send_stealth(
        ctx: Context<SendStealth>,
        stealth_address: [u8; 32],
        ephemeral_pubkey: [u8; 32],
        view_tag: u8,
        amount: u64,
    ) -> Result<()> {
        instructions::send_stealth::handler(ctx, stealth_address, ephemeral_pubkey, view_tag, amount)
    }

    pub fn claim_stealth(ctx: Context<ClaimStealth>) -> Result<()> {
        instructions::claim_stealth::handler(ctx)
    }

    pub fn shield(
        ctx: Context<Shield>,
        amount: u64,
        commitment: [u8; 32],
        new_root: [u8; 32],
    ) -> Result<()> {
        instructions::shield::handler(ctx, amount, commitment, new_root)
    }

    pub fn unshield(
        ctx: Context<Unshield>,
        amount: u64,
        nullifier_hash: [u8; 32],
        new_root: [u8; 32],
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: [[u8; 32]; 7],
    ) -> Result<()> {
        instructions::unshield::handler(
            ctx,
            amount,
            nullifier_hash,
            new_root,
            proof_a,
            proof_b,
            proof_c,
            public_inputs,
        )
    }
}
