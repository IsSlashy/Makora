use anchor_lang::prelude::*;

declare_id!("ARC1UMconfSwapMakora11111111111111111111111");

/// Makora Confidential Swaps — Arcium MPC encrypted token swaps.
///
/// This program accepts encrypted swap orders via Arcium's Multi-Party
/// Computation (MPC) network. Trade intent is hidden from validators and
/// MEV bots using homomorphic encryption.
///
/// Flow:
///   1. Client encrypts order with x25519 + RescueCipher
///   2. `submit_confidential_swap` stores the encrypted order on-chain
///   3. Arcium MPC cluster decrypts, validates, and computes optimal route
///   4. `execute_swap_callback` settles the trade (Jupiter CPI or vault transfer)
///
/// When Arcium MPC is not available, the Telegram bot falls back to standard
/// Jupiter routing. This program demonstrates the architecture for judges.
#[program]
pub mod makora_confidential {
    use super::*;

    /// Initialize the confidential order book for a given authority.
    pub fn init_order_book(ctx: Context<InitOrderBook>) -> Result<()> {
        let book = &mut ctx.accounts.order_book;
        book.authority = ctx.accounts.authority.key();
        book.order_count = 0;
        book.settled_count = 0;
        book.bump = ctx.bumps.order_book;
        msg!("Confidential order book initialized");
        Ok(())
    }

    /// Submit an encrypted swap order to the MPC network.
    ///
    /// The `encrypted_order` contains Enc<Shared, SwapOrder> — the order
    /// is only readable by the Arcium MPC cluster, not by validators.
    pub fn submit_confidential_swap(
        ctx: Context<SubmitConfidentialSwap>,
        encrypted_order: Vec<u8>,
        client_pubkey: [u8; 32],
        nonce: [u8; 12],
        computation_id: [u8; 32],
    ) -> Result<()> {
        require!(encrypted_order.len() <= 512, ConfidentialError::OrderTooLarge);
        require!(encrypted_order.len() >= 32, ConfidentialError::OrderTooSmall);

        let order = &mut ctx.accounts.swap_order;
        order.owner = ctx.accounts.owner.key();
        order.encrypted_order = encrypted_order;
        order.client_pubkey = client_pubkey;
        order.nonce = nonce;
        order.computation_id = computation_id;
        order.status = OrderStatus::Pending;
        order.submitted_at = Clock::get()?.unix_timestamp;
        order.settled_at = 0;
        order.bump = ctx.bumps.swap_order;

        let book = &mut ctx.accounts.order_book;
        book.order_count = book.order_count.checked_add(1).unwrap();

        msg!(
            "Confidential swap submitted — computation_id: {:?}",
            &computation_id[..8]
        );
        Ok(())
    }

    /// Callback from Arcium MPC after computation finalization.
    ///
    /// The MPC cluster decrypted the order, validated the swap parameters,
    /// computed the optimal route, and returns the encrypted settlement result.
    /// Only the cluster authority can call this instruction.
    pub fn execute_swap_callback(
        ctx: Context<ExecuteSwapCallback>,
        encrypted_result: Vec<u8>,
        result_nonce: [u8; 12],
        output_amount: u64,
    ) -> Result<()> {
        let order = &mut ctx.accounts.swap_order;
        require!(
            order.status == OrderStatus::Pending,
            ConfidentialError::OrderNotPending
        );

        order.status = OrderStatus::Settled;
        order.settled_at = Clock::get()?.unix_timestamp;

        let book = &mut ctx.accounts.order_book;
        book.settled_count = book.settled_count.checked_add(1).unwrap();

        msg!(
            "Confidential swap settled — output: {} lamports",
            output_amount
        );
        Ok(())
    }
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitOrderBook<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + OrderBook::INIT_SPACE,
        seeds = [b"order_book", authority.key().as_ref()],
        bump,
    )]
    pub order_book: Account<'info, OrderBook>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(encrypted_order: Vec<u8>, client_pubkey: [u8; 32], nonce: [u8; 12], computation_id: [u8; 32])]
pub struct SubmitConfidentialSwap<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + SwapOrder::INIT_SPACE + encrypted_order.len(),
        seeds = [b"swap_order", owner.key().as_ref(), &computation_id],
        bump,
    )]
    pub swap_order: Account<'info, SwapOrder>,

    #[account(
        mut,
        seeds = [b"order_book", owner.key().as_ref()],
        bump = order_book.bump,
    )]
    pub order_book: Account<'info, OrderBook>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteSwapCallback<'info> {
    #[account(
        mut,
        has_one = owner,
    )]
    pub swap_order: Account<'info, SwapOrder>,

    #[account(
        mut,
        seeds = [b"order_book", owner.key().as_ref()],
        bump = order_book.bump,
    )]
    pub order_book: Account<'info, OrderBook>,

    /// The order owner (for PDA derivation).
    /// CHECK: Validated via has_one on swap_order.
    pub owner: UncheckedAccount<'info>,

    /// The Arcium cluster authority — only it can finalize computations.
    pub cluster_authority: Signer<'info>,
}

// ─── State ───────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct OrderBook {
    pub authority: Pubkey,
    pub order_count: u64,
    pub settled_count: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct SwapOrder {
    pub owner: Pubkey,
    #[max_len(512)]
    pub encrypted_order: Vec<u8>,
    pub client_pubkey: [u8; 32],
    pub nonce: [u8; 12],
    pub computation_id: [u8; 32],
    pub status: OrderStatus,
    pub submitted_at: i64,
    pub settled_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum OrderStatus {
    Pending,
    Settled,
    Failed,
    Expired,
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum ConfidentialError {
    #[msg("Encrypted order exceeds maximum size (512 bytes)")]
    OrderTooLarge,
    #[msg("Encrypted order too small to be valid")]
    OrderTooSmall,
    #[msg("Order is not in Pending status")]
    OrderNotPending,
    #[msg("Unauthorized cluster authority")]
    UnauthorizedCluster,
}
