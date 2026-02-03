use anchor_lang::prelude::*;

#[account]
pub struct StealthAccount {
    pub sender: Pubkey,              // 32
    pub stealth_address: [u8; 32],   // 32 - one-time stealth address
    pub ephemeral_pubkey: [u8; 32],  // 32 - for recipient to derive key
    pub view_tag: u8,                // 1 - fast scanning
    pub amount: u64,                 // 8 - lamports
    pub claimed: bool,               // 1
    pub created_at: i64,             // 8
    pub bump: u8,                    // 1
}

impl StealthAccount {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 1 + 8 + 1 + 8 + 1;
}
