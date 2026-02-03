use anchor_lang::prelude::*;

#[account]
pub struct NullifierRecord {
    pub pool: Pubkey,               // 32
    pub nullifier: [u8; 32],        // 32
    pub used_at: i64,               // 8
    pub bump: u8,                   // 1
}

impl NullifierRecord {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 1;
}
