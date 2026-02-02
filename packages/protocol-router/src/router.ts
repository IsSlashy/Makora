import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import type {
  ProtocolAdapter,
  ProtocolId,
  ActionType,
  Quote,
  QuoteParams,
  SwapParams,
  StakeParams,
  DepositParams,
  WithdrawParams,
  Position,
  ProtocolHealth,
} from '@makora/types';
import { AdapterRegistry } from './registry.js';

/** Action routing request -- what the agent core sends to the router */
export interface RouteRequest {
  /** Action type to perform */
  actionType: ActionType;
  /** Target protocol (optional -- if not specified, router finds the best one) */
  protocol?: ProtocolId;
  /** Action parameters (type depends on actionType) */
  params: SwapParams | StakeParams | DepositParams | WithdrawParams;
}

/** Route result -- instructions ready for the execution engine */
export interface RouteResult {
  /** Protocol that handled the request */
  protocolId: ProtocolId;
  /** Protocol adapter name */
  protocolName: string;
  /** Built transaction instructions */
  instructions: TransactionInstruction[];
  /** Quote data (if applicable) */
  quote?: Quote;
  /** Action description for logging/display */
  description: string;
}

/**
 * Protocol Router
 *
 * Routes agent actions to the correct protocol adapter. This is the ONLY component
 * that knows about specific adapter implementations. The agent core interacts
 * exclusively through the router.
 *
 * Routing rules:
 * 1. If `protocol` is specified in the request, use that adapter directly
 * 2. If not specified, find the best adapter by action type
 * 3. For swaps: always use Jupiter (it aggregates all DEXes)
 * 4. For stakes: use Marinade
 * 5. For LP: use Raydium
 * 6. For vault deposits: use Kamino
 */
export class ProtocolRouter {
  private registry: AdapterRegistry;

  constructor(registry: AdapterRegistry) {
    this.registry = registry;
  }

  /**
   * Route an action to the appropriate adapter and build instructions.
   *
   * This is the main entry point for the agent core.
   */
  async route(request: RouteRequest): Promise<RouteResult> {
    const adapter = this.resolveAdapter(request.actionType, request.protocol);

    // Build instructions based on action type
    const instructions = await this.buildInstructions(adapter, request);

    // Get a quote if the adapter supports it for this action
    let quote: Quote | undefined;
    if (request.actionType === 'swap' || request.actionType === 'stake') {
      try {
        quote = await this.getQuoteForAction(adapter, request);
      } catch {
        // Quote is optional -- don't fail the route if quote fails
      }
    }

    return {
      protocolId: adapter.protocolId,
      protocolName: adapter.name,
      instructions,
      quote,
      description: this.describeAction(adapter, request),
    };
  }

  /**
   * Get a quote without building instructions.
   * Useful for advisory mode where the agent shows quotes before execution.
   */
  async getQuote(
    actionType: ActionType,
    protocol: ProtocolId | undefined,
    quoteParams: QuoteParams
  ): Promise<Quote> {
    const adapter = this.resolveAdapter(actionType, protocol);
    return adapter.getQuote(quoteParams);
  }

  /**
   * Get all positions across all registered protocols for a wallet.
   */
  async getAllPositions(owner: PublicKey): Promise<Position[]> {
    const allPositions: Position[] = [];

    for (const protocolId of this.registry.getRegisteredProtocols()) {
      try {
        const adapter = this.registry.get(protocolId);
        const positions = await adapter.getPositions(owner);
        allPositions.push(...positions);
      } catch (err) {
        console.warn(`Failed to get positions from ${protocolId}:`, err);
      }
    }

    return allPositions;
  }

  /**
   * Health check all protocols.
   */
  async healthCheckAll(): Promise<ProtocolHealth[]> {
    return this.registry.healthCheckAll();
  }

  /**
   * Get the adapter registry (for advanced use cases).
   */
  getRegistry(): AdapterRegistry {
    return this.registry;
  }

  // ---- Private helpers ----

  /**
   * Resolve the correct adapter for an action.
   * If a specific protocol is requested, use that. Otherwise, find by action type.
   */
  private resolveAdapter(actionType: ActionType, protocol?: ProtocolId): ProtocolAdapter {
    if (protocol) {
      const adapter = this.registry.get(protocol);
      if (!adapter.supportsAction(actionType)) {
        throw new Error(
          `Protocol ${protocol} (${adapter.name}) does not support action: ${actionType}. ` +
          `Supported actions: ${this.getAdapterActionTypes(adapter).join(', ')}`
        );
      }
      return adapter;
    }

    // Auto-resolve: find the best adapter for this action type
    const adapter = this.registry.findByAction(actionType);
    if (!adapter) {
      throw new Error(
        `No adapter found that supports action: ${actionType}. ` +
        `Registered protocols: ${this.registry.getRegisteredProtocols().join(', ')}`
      );
    }

    return adapter;
  }

  /**
   * Build instructions based on action type.
   */
  private async buildInstructions(
    adapter: ProtocolAdapter,
    request: RouteRequest
  ): Promise<TransactionInstruction[]> {
    switch (request.actionType) {
      case 'swap':
        return adapter.buildSwapIx(request.params as SwapParams);

      case 'stake':
        if (!adapter.buildStakeIx) {
          throw new Error(`${adapter.name} does not implement buildStakeIx`);
        }
        return adapter.buildStakeIx(request.params as StakeParams);

      case 'unstake':
        if (!adapter.buildUnstakeIx) {
          throw new Error(`${adapter.name} does not implement buildUnstakeIx`);
        }
        return adapter.buildUnstakeIx(request.params as StakeParams);

      case 'deposit':
      case 'provide_liquidity':
        if (!adapter.buildDepositIx) {
          throw new Error(`${adapter.name} does not implement buildDepositIx`);
        }
        return adapter.buildDepositIx(request.params as DepositParams);

      case 'withdraw':
      case 'remove_liquidity':
        if (!adapter.buildWithdrawIx) {
          throw new Error(`${adapter.name} does not implement buildWithdrawIx`);
        }
        return adapter.buildWithdrawIx(request.params as WithdrawParams);

      default:
        throw new Error(`Unsupported action type: ${request.actionType}`);
    }
  }

  /**
   * Get a quote for a given action request.
   */
  private async getQuoteForAction(
    adapter: ProtocolAdapter,
    request: RouteRequest
  ): Promise<Quote> {
    const params = request.params;

    // Build QuoteParams from the action params
    if ('inputToken' in params && 'outputToken' in params) {
      return adapter.getQuote({
        inputToken: params.inputToken as PublicKey,
        outputToken: params.outputToken as PublicKey,
        amount: params.amount,
        maxSlippageBps: 'maxSlippageBps' in params ? (params as SwapParams).maxSlippageBps : 50,
      });
    }

    throw new Error('Cannot create quote params from this action type');
  }

  /**
   * Generate a human-readable description of an action.
   */
  private describeAction(adapter: ProtocolAdapter, request: RouteRequest): string {
    switch (request.actionType) {
      case 'swap':
        return `Swap via ${adapter.name}`;
      case 'stake':
        return `Stake SOL via ${adapter.name}`;
      case 'unstake':
        return `Unstake via ${adapter.name}`;
      case 'deposit':
        return `Deposit into ${adapter.name}`;
      case 'withdraw':
        return `Withdraw from ${adapter.name}`;
      case 'provide_liquidity':
        return `Provide liquidity via ${adapter.name}`;
      case 'remove_liquidity':
        return `Remove liquidity via ${adapter.name}`;
      default:
        return `${request.actionType} via ${adapter.name}`;
    }
  }

  /**
   * Get all action types an adapter supports.
   */
  private getAdapterActionTypes(adapter: ProtocolAdapter): ActionType[] {
    const types: ActionType[] = [];
    const allTypes: ActionType[] = [
      'swap', 'stake', 'unstake', 'deposit', 'withdraw',
      'provide_liquidity', 'remove_liquidity', 'shield', 'unshield', 'transfer',
    ];

    for (const type of allTypes) {
      if (adapter.supportsAction(type)) {
        types.push(type);
      }
    }

    return types;
  }
}
