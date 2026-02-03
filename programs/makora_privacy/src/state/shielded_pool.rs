use anchor_lang::prelude::*;

#[account]
pub struct ShieldedPool {
    pub authority: Pubkey,           // 32
    pub merkle_root: [u8; 32],       // 32 - current tree root
    pub next_leaf_index: u64,        // 8
    pub total_shielded: u64,         // 8 - total lamports in pool
    pub is_active: bool,             // 1
    pub created_at: i64,             // 8
    pub last_tx_at: i64,             // 8
    pub bump: u8,                    // 1
    pub _padding: [u8; 32],          // 32 - future use
}

impl ShieldedPool {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 1 + 8 + 8 + 1 + 32;
}
