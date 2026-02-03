import type { ParsedIntent } from './types.js';

/**
 * Natural Language Parser (AGENT-03)
 *
 * Parses natural language commands into structured intents.
 * Pattern-matching based -- no LLM dependency, deterministic, <1ms.
 *
 * Supported patterns:
 * - "swap 10 SOL to USDC" -> swap action
 * - "swap 50% of my SOL to USDC" -> swap with percentage
 * - "stake 5 SOL" -> stake action
 * - "stake 50% of my SOL" -> stake with percentage
 * - "unstake 3 mSOL" / "unstake all mSOL" -> unstake action
 * - "show my portfolio" / "status" / "balance" -> portfolio query
 * - "show strategy" / "opportunities" / "yield" -> strategy query
 * - "rebalance" / "rebalance my portfolio" -> rebalance intent
 * - "auto mode on" / "switch to advisory" -> mode switch
 * - "help" -> help intent
 *
 * Token symbols are case-insensitive: sol, SOL, Sol all work.
 * Amounts accept decimals: "1.5 SOL", "0.1 SOL".
 */
export class NLParser {
  /**
   * Parse a natural language command into a structured intent.
   */
  parse(input: string): ParsedIntent {
    const normalized = input.trim().toLowerCase();

    // Try each pattern in order of specificity
    return (
      this.trySwap(normalized) ??
      this.tryStake(normalized) ??
      this.tryUnstake(normalized) ??
      this.tryPortfolioQuery(normalized) ??
      this.tryStrategyQuery(normalized) ??
      this.tryModeSwitch(normalized) ??
      this.tryHelp(normalized) ??
      { type: 'unknown' as const, rawInput: input }
    );
  }

  /**
   * Check if the input is a recognized command.
   */
  isRecognized(input: string): boolean {
    return this.parse(input).type !== 'unknown';
  }

  /**
   * Get a list of example commands for help display.
   */
  getExamples(): string[] {
    return [
      'swap 10 SOL to USDC',
      'swap 50% of my SOL to USDC',
      'stake 5 SOL',
      'stake 50% of my SOL',
      'unstake 3 mSOL',
      'unstake all mSOL',
      'show my portfolio',
      'show strategy',
      'show yield opportunities',
      'rebalance my portfolio',
      'switch to auto mode',
      'switch to advisory mode',
      'help',
    ];
  }

  // ---- Pattern matchers ----

  private trySwap(input: string): ParsedIntent | null {
    // Pattern: swap {amount} {from} to/for {to}
    // Pattern: swap {percent}% [of my] {from} to/for {to}
    // Pattern: convert {amount} {from} to {to}
    // Pattern: exchange {amount} {from} for {to}
    // Pattern: buy {amount} {to} with {from}

    // Percentage swap: "swap 50% of my SOL to USDC"
    const pctMatch = input.match(
      /(?:swap|convert|exchange)\s+(\d+(?:\.\d+)?)\s*%\s*(?:of\s+(?:my\s+)?)?(\w+)\s+(?:to|for|into)\s+(\w+)/i
    );
    if (pctMatch) {
      return {
        type: 'swap',
        amount: parseFloat(pctMatch[1]),
        amountIsPercent: true,
        fromToken: pctMatch[2].toUpperCase(),
        toToken: pctMatch[3].toUpperCase(),
      };
    }

    // Absolute swap: "swap 10 SOL to USDC"
    const absMatch = input.match(
      /(?:swap|convert|exchange)\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(?:to|for|into)\s+(\w+)/i
    );
    if (absMatch) {
      return {
        type: 'swap',
        amount: parseFloat(absMatch[1]),
        amountIsPercent: false,
        fromToken: absMatch[2].toUpperCase(),
        toToken: absMatch[3].toUpperCase(),
      };
    }

    // Buy pattern: "buy 100 USDC with SOL"
    const buyMatch = input.match(
      /buy\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(?:with|using)\s+(\w+)/i
    );
    if (buyMatch) {
      return {
        type: 'swap',
        amount: parseFloat(buyMatch[1]),
        amountIsPercent: false,
        fromToken: buyMatch[3].toUpperCase(),
        toToken: buyMatch[2].toUpperCase(),
      };
    }

    return null;
  }

  private tryStake(input: string): ParsedIntent | null {
    // Pattern: stake {amount} SOL
    // Pattern: stake {percent}% [of my] SOL
    // Pattern: stake all [my] SOL

    // "stake all SOL"
    if (/(?:stake)\s+all\s+(?:my\s+)?sol/i.test(input)) {
      return {
        type: 'stake',
        amount: 100,
        amountIsPercent: true,
        token: 'SOL',
      };
    }

    // "stake 50% of my SOL"
    const pctMatch = input.match(
      /(?:stake)\s+(\d+(?:\.\d+)?)\s*%\s*(?:of\s+(?:my\s+)?)?(\w+)/i
    );
    if (pctMatch) {
      return {
        type: 'stake',
        amount: parseFloat(pctMatch[1]),
        amountIsPercent: true,
        token: pctMatch[2].toUpperCase(),
      };
    }

    // "stake 5 SOL"
    const absMatch = input.match(
      /(?:stake)\s+(\d+(?:\.\d+)?)\s+(\w+)/i
    );
    if (absMatch) {
      return {
        type: 'stake',
        amount: parseFloat(absMatch[1]),
        amountIsPercent: false,
        token: absMatch[2].toUpperCase(),
      };
    }

    return null;
  }

  private tryUnstake(input: string): ParsedIntent | null {
    // Pattern: unstake {amount} mSOL
    // Pattern: unstake all [my] mSOL

    // "unstake all mSOL"
    if (/(?:unstake|withdraw)\s+all\s+(?:my\s+)?msol/i.test(input)) {
      return {
        type: 'unstake',
        amount: 100,
        amountIsPercent: true,
        token: 'MSOL',
      };
    }

    // "unstake 50% of my mSOL"
    const pctMatch = input.match(
      /(?:unstake|withdraw)\s+(\d+(?:\.\d+)?)\s*%\s*(?:of\s+(?:my\s+)?)?(\w+)/i
    );
    if (pctMatch) {
      return {
        type: 'unstake',
        amount: parseFloat(pctMatch[1]),
        amountIsPercent: true,
        token: pctMatch[2].toUpperCase(),
      };
    }

    // "unstake 3 mSOL"
    const absMatch = input.match(
      /(?:unstake|withdraw)\s+(\d+(?:\.\d+)?)\s+(\w+)/i
    );
    if (absMatch) {
      return {
        type: 'unstake',
        amount: parseFloat(absMatch[1]),
        amountIsPercent: false,
        token: absMatch[2].toUpperCase(),
      };
    }

    return null;
  }

  private tryPortfolioQuery(input: string): ParsedIntent | null {
    // Portfolio status
    if (/(?:show|display|get|view|check)\s+(?:my\s+)?(?:portfolio|balance|status|holdings|wallet)/i.test(input)) {
      return { type: 'portfolio', query: 'status' };
    }
    if (/^(?:status|balance|portfolio|holdings)$/i.test(input)) {
      return { type: 'portfolio', query: 'status' };
    }

    // Allocation
    if (/(?:show|display|get|view)\s+(?:my\s+)?(?:allocation|distribution)/i.test(input)) {
      return { type: 'portfolio', query: 'allocation' };
    }

    // History
    if (/(?:show|display|get|view)\s+(?:my\s+)?(?:history|transactions|activity)/i.test(input)) {
      return { type: 'portfolio', query: 'history' };
    }

    return null;
  }

  private tryStrategyQuery(input: string): ParsedIntent | null {
    // Strategy info
    if (/(?:show|display|get|view|what)\s+(?:is\s+)?(?:my\s+)?(?:current\s+)?strategy/i.test(input)) {
      return { type: 'strategy', query: 'current' };
    }

    // Yield opportunities
    if (/(?:show|display|find|get|view)\s+(?:yield\s+)?(?:opportunities|yields|apy|rates)/i.test(input)) {
      return { type: 'strategy', query: 'opportunities' };
    }

    // Rebalance
    if (/(?:rebalance|rebal)\s*(?:my\s+)?(?:portfolio)?/i.test(input)) {
      return { type: 'strategy', query: 'rebalance' };
    }

    // Advisory / suggestion queries
    if (/(?:what\s+(?:should|do|can|would)\s+(?:i|you)|recommend|suggest|advice|next\s+move)/i.test(input)) {
      return { type: 'strategy', query: 'current' };
    }

    return null;
  }

  private tryModeSwitch(input: string): ParsedIntent | null {
    // Auto mode
    if (/(?:switch|change|set|enable|turn)\s+(?:to\s+)?auto\s*(?:mode)?/i.test(input)) {
      return { type: 'mode', mode: 'auto' };
    }
    if (/auto\s+(?:mode\s+)?on/i.test(input)) {
      return { type: 'mode', mode: 'auto' };
    }

    // Advisory mode
    if (/(?:switch|change|set|enable|turn)\s+(?:to\s+)?advisory\s*(?:mode)?/i.test(input)) {
      return { type: 'mode', mode: 'advisory' };
    }
    if (/(?:auto\s+(?:mode\s+)?off|disable\s+auto)/i.test(input)) {
      return { type: 'mode', mode: 'advisory' };
    }

    return null;
  }

  private tryHelp(input: string): ParsedIntent | null {
    if (/^(?:help|commands|\?|what can you do|how do i)$/i.test(input)) {
      return { type: 'help' };
    }
    return null;
  }
}
