use anchor_lang::prelude::*;

/// A single audit log entry for an agent action.
/// Fixed-size for ring buffer storage.
///
/// Size: 4 + 16 + 16 + 64 + 1 + 1 + 8 = 110 bytes per entry
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct AuditEntry {
    /// Entry index (monotonically increasing)
    pub index: u32,

    /// Action type (e.g., "swap", "stake"), padded to 16 bytes
    pub action_type: [u8; 16],

    /// Protocol used (e.g., "jupiter", "marinade"), padded to 16 bytes
    pub protocol: [u8; 16],

    /// Description, padded to 64 bytes
    pub description: [u8; 64],

    /// Whether the action was executed (vs. just proposed)
    pub executed: bool,

    /// Whether the action succeeded
    pub success: bool,

    /// Unix timestamp
    pub timestamp: i64,
}

impl Default for AuditEntry {
    fn default() -> Self {
        Self {
            index: 0,
            action_type: [0u8; 16],
            protocol: [0u8; 16],
            description: [0u8; 64],
            executed: false,
            success: false,
            timestamp: 0,
        }
    }
}

impl AuditEntry {
    pub const SIZE: usize = 4 + 16 + 16 + 64 + 1 + 1 + 8;

    pub fn new(
        index: u32,
        action_type: &str,
        protocol: &str,
        description: &str,
        executed: bool,
        success: bool,
        timestamp: i64,
    ) -> Self {
        let mut at = [0u8; 16];
        let at_bytes = action_type.as_bytes();
        let at_len = at_bytes.len().min(16);
        at[..at_len].copy_from_slice(&at_bytes[..at_len]);

        let mut pr = [0u8; 16];
        let pr_bytes = protocol.as_bytes();
        let pr_len = pr_bytes.len().min(16);
        pr[..pr_len].copy_from_slice(&pr_bytes[..pr_len]);

        let mut desc = [0u8; 64];
        let desc_bytes = description.as_bytes();
        let desc_len = desc_bytes.len().min(64);
        desc[..desc_len].copy_from_slice(&desc_bytes[..desc_len]);

        Self {
            index,
            action_type: at,
            protocol: pr,
            description: desc,
            executed,
            success,
            timestamp,
        }
    }

    pub fn action_type_str(&self) -> String {
        let end = self.action_type.iter().position(|&b| b == 0).unwrap_or(16);
        String::from_utf8_lossy(&self.action_type[..end]).to_string()
    }

    pub fn protocol_str(&self) -> String {
        let end = self.protocol.iter().position(|&b| b == 0).unwrap_or(16);
        String::from_utf8_lossy(&self.protocol[..end]).to_string()
    }

    pub fn description_str(&self) -> String {
        let end = self.description.iter().position(|&b| b == 0).unwrap_or(64);
        String::from_utf8_lossy(&self.description[..end]).to_string()
    }
}

/// Ring buffer capacity for audit entries (8 to stay within SBF stack limits)
pub const AUDIT_TRAIL_CAPACITY: usize = 8;

/// Audit Trail PDA
///
/// Seeds: ["audit", owner_pubkey]
/// Stores the last 8 agent actions as a ring buffer.
///
/// Size calculation:
///   discriminator: 8
///   owner: 32
///   head: 4
///   count: 4
///   entries: 8 * 110 = 880
///   bump: 1
///   TOTAL: 8 + 32 + 4 + 4 + 880 + 1 = 929
///   Round up to 960 for safety
#[account]
pub struct AuditTrail {
    /// The wallet owner
    pub owner: Pubkey,

    /// Index of the next write position (wraps around at AUDIT_TRAIL_CAPACITY)
    pub head: u32,

    /// Total number of entries written (can exceed AUDIT_TRAIL_CAPACITY)
    pub count: u32,

    /// Ring buffer of audit entries
    pub entries: [AuditEntry; AUDIT_TRAIL_CAPACITY],

    /// PDA bump seed
    pub bump: u8,
}

impl AuditTrail {
    pub const SIZE: usize = 8 +    // discriminator
        32 +                         // owner
        4 +                          // head
        4 +                          // count
        (AuditEntry::SIZE * AUDIT_TRAIL_CAPACITY) + // entries
        1;                           // bump

    /// Append an entry to the ring buffer.
    /// Overwrites the oldest entry when full.
    pub fn append(&mut self, entry: AuditEntry) {
        let idx = (self.head as usize) % AUDIT_TRAIL_CAPACITY;
        self.entries[idx] = entry;
        self.head = self.head.wrapping_add(1);
        self.count = self.count.saturating_add(1);
    }

    /// Get the most recent N entries (newest first).
    pub fn recent(&self, n: usize) -> Vec<&AuditEntry> {
        let effective_count = (self.count as usize).min(AUDIT_TRAIL_CAPACITY);
        let take = n.min(effective_count);
        let mut result = Vec::with_capacity(take);

        for i in 0..take {
            // Walk backwards from head
            let idx = if self.head as usize > i {
                (self.head as usize - 1 - i) % AUDIT_TRAIL_CAPACITY
            } else {
                (AUDIT_TRAIL_CAPACITY + self.head as usize - 1 - i) % AUDIT_TRAIL_CAPACITY
            };
            result.push(&self.entries[idx]);
        }

        result
    }
}
