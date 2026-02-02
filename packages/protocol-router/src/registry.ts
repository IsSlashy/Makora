import type {
  ProtocolAdapter,
  ProtocolId,
  ActionType,
  ProtocolHealth,
  ProtocolCapability,
  AdapterConfig,
} from '@makora/types';

/**
 * Adapter Registry
 *
 * Manages all registered protocol adapters. Provides lookup by protocol ID
 * and by capability/action type. Handles initialization of all adapters.
 */
export class AdapterRegistry {
  private adapters: Map<ProtocolId, ProtocolAdapter> = new Map();
  private initialized = false;

  /**
   * Register a protocol adapter.
   * Must be called before initialize().
   */
  register(adapter: ProtocolAdapter): void {
    if (this.initialized) {
      throw new Error(
        'Cannot register adapters after initialization. ' +
        'Register all adapters first, then call initialize().'
      );
    }

    if (this.adapters.has(adapter.protocolId)) {
      throw new Error(`Adapter already registered for protocol: ${adapter.protocolId}`);
    }

    this.adapters.set(adapter.protocolId, adapter);
  }

  /**
   * Initialize all registered adapters with the given config.
   */
  async initialize(config: AdapterConfig): Promise<void> {
    const results: Array<{ protocolId: ProtocolId; success: boolean; error?: string }> = [];

    for (const [protocolId, adapter] of this.adapters) {
      try {
        await adapter.initialize(config);
        results.push({ protocolId, success: true });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({ protocolId, success: false, error: errorMsg });
        console.warn(`Failed to initialize adapter ${protocolId}: ${errorMsg}`);
      }
    }

    this.initialized = true;

    // Log initialization summary
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    console.log(
      `AdapterRegistry initialized: ${succeeded} adapters ready, ${failed} failed`
    );

    if (failed > 0) {
      for (const result of results.filter((r) => !r.success)) {
        console.warn(`  - ${result.protocolId}: ${result.error}`);
      }
    }
  }

  /**
   * Get an adapter by protocol ID.
   * Throws if the adapter is not registered.
   */
  get(protocolId: ProtocolId): ProtocolAdapter {
    const adapter = this.adapters.get(protocolId);
    if (!adapter) {
      throw new Error(
        `No adapter registered for protocol: ${protocolId}. ` +
        `Available: ${this.getRegisteredProtocols().join(', ')}`
      );
    }
    return adapter;
  }

  /**
   * Find the best adapter for a given action type.
   *
   * Returns the first adapter that supports the action.
   * For actions supported by multiple adapters (e.g., swap),
   * returns them in registration order (Jupiter should be registered first for swaps).
   */
  findByAction(actionType: ActionType): ProtocolAdapter | undefined {
    for (const [, adapter] of this.adapters) {
      if (adapter.supportsAction(actionType)) {
        return adapter;
      }
    }
    return undefined;
  }

  /**
   * Find ALL adapters that support a given action type.
   */
  findAllByAction(actionType: ActionType): ProtocolAdapter[] {
    const result: ProtocolAdapter[] = [];
    for (const [, adapter] of this.adapters) {
      if (adapter.supportsAction(actionType)) {
        result.push(adapter);
      }
    }
    return result;
  }

  /**
   * Find adapters by capability.
   */
  findByCapability(capability: ProtocolCapability): ProtocolAdapter[] {
    const result: ProtocolAdapter[] = [];
    for (const [, adapter] of this.adapters) {
      if (adapter.getCapabilities().includes(capability)) {
        result.push(adapter);
      }
    }
    return result;
  }

  /**
   * Health check all registered adapters.
   */
  async healthCheckAll(): Promise<ProtocolHealth[]> {
    const results: ProtocolHealth[] = [];

    for (const [, adapter] of this.adapters) {
      try {
        const health = await adapter.healthCheck();
        results.push(health);
      } catch (err) {
        results.push({
          protocolId: adapter.protocolId,
          isHealthy: false,
          latencyMs: 0,
          lastChecked: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  /**
   * Get list of all registered protocol IDs.
   */
  getRegisteredProtocols(): ProtocolId[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get a summary of all registered adapters and their capabilities.
   */
  getSummary(): Array<{
    protocolId: ProtocolId;
    name: string;
    capabilities: ProtocolCapability[];
  }> {
    return Array.from(this.adapters.entries()).map(([id, adapter]) => ({
      protocolId: id,
      name: adapter.name,
      capabilities: adapter.getCapabilities(),
    }));
  }

  /**
   * Check if any adapter is registered.
   */
  get isEmpty(): boolean {
    return this.adapters.size === 0;
  }

  /**
   * Get the number of registered adapters.
   */
  get size(): number {
    return this.adapters.size;
  }
}
