import { describe, it, expect, vi } from 'vitest';
import { AdapterRegistry } from '../registry';
import type { ProtocolAdapter, ProtocolId, ActionType, ProtocolCapability, ProtocolHealth } from '@makora/types';

// Minimal mock adapter
function mockAdapter(
  protocolId: ProtocolId,
  name: string,
  actions: ActionType[] = [],
  capabilities: ProtocolCapability[] = [],
): ProtocolAdapter {
  return {
    protocolId,
    name,
    initialize: vi.fn().mockResolvedValue(undefined),
    supportsAction: (action: ActionType) => actions.includes(action),
    getCapabilities: () => capabilities,
    healthCheck: vi.fn().mockResolvedValue({
      protocolId,
      isHealthy: true,
      latencyMs: 50,
      lastChecked: Date.now(),
    } as ProtocolHealth),
  } as any;
}

describe('AdapterRegistry', () => {
  describe('register', () => {
    it('registers an adapter', () => {
      const registry = new AdapterRegistry();
      const adapter = mockAdapter('jupiter' as ProtocolId, 'Jupiter');
      registry.register(adapter);
      expect(registry.size).toBe(1);
    });

    it('throws on duplicate registration', () => {
      const registry = new AdapterRegistry();
      const adapter = mockAdapter('jupiter' as ProtocolId, 'Jupiter');
      registry.register(adapter);
      expect(() => registry.register(adapter)).toThrow('already registered');
    });

    it('throws when registering after initialize', async () => {
      const registry = new AdapterRegistry();
      await registry.initialize({} as any);
      const adapter = mockAdapter('jupiter' as ProtocolId, 'Jupiter');
      expect(() => registry.register(adapter)).toThrow('after initialization');
    });
  });

  describe('get', () => {
    it('returns registered adapter', () => {
      const registry = new AdapterRegistry();
      const adapter = mockAdapter('jupiter' as ProtocolId, 'Jupiter');
      registry.register(adapter);
      expect(registry.get('jupiter' as ProtocolId)).toBe(adapter);
    });

    it('throws on missing adapter', () => {
      const registry = new AdapterRegistry();
      expect(() => registry.get('unknown' as ProtocolId)).toThrow('No adapter registered');
    });
  });

  describe('findByAction', () => {
    it('finds adapter that supports action', () => {
      const registry = new AdapterRegistry();
      const jupAdapter = mockAdapter('jupiter' as ProtocolId, 'Jupiter', ['swap' as ActionType]);
      registry.register(jupAdapter);

      expect(registry.findByAction('swap' as ActionType)).toBe(jupAdapter);
    });

    it('returns undefined when no adapter supports action', () => {
      const registry = new AdapterRegistry();
      expect(registry.findByAction('swap' as ActionType)).toBeUndefined();
    });
  });

  describe('findAllByAction', () => {
    it('finds all adapters supporting an action', () => {
      const registry = new AdapterRegistry();
      const jup = mockAdapter('jupiter' as ProtocolId, 'Jupiter', ['swap' as ActionType]);
      const ray = mockAdapter('raydium' as ProtocolId, 'Raydium', ['swap' as ActionType]);
      registry.register(jup);
      registry.register(ray);

      const found = registry.findAllByAction('swap' as ActionType);
      expect(found).toHaveLength(2);
    });
  });

  describe('findByCapability', () => {
    it('finds adapters by capability', () => {
      const registry = new AdapterRegistry();
      const adapter = mockAdapter(
        'marinade' as ProtocolId,
        'Marinade',
        [],
        ['stake' as ProtocolCapability],
      );
      registry.register(adapter);

      const found = registry.findByCapability('stake' as ProtocolCapability);
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe('Marinade');
    });
  });

  describe('initialize', () => {
    it('initializes all adapters', async () => {
      const registry = new AdapterRegistry();
      const a1 = mockAdapter('jupiter' as ProtocolId, 'Jupiter');
      const a2 = mockAdapter('marinade' as ProtocolId, 'Marinade');
      registry.register(a1);
      registry.register(a2);

      await registry.initialize({} as any);
      expect(a1.initialize).toHaveBeenCalled();
      expect(a2.initialize).toHaveBeenCalled();
    });

    it('handles initialization failure gracefully', async () => {
      const registry = new AdapterRegistry();
      const failing = mockAdapter('broken' as ProtocolId, 'Broken');
      (failing.initialize as any).mockRejectedValue(new Error('init failed'));
      registry.register(failing);

      // Should not throw
      await registry.initialize({} as any);
    });
  });

  describe('healthCheckAll', () => {
    it('returns health for all adapters', async () => {
      const registry = new AdapterRegistry();
      const adapter = mockAdapter('jupiter' as ProtocolId, 'Jupiter');
      registry.register(adapter);

      const results = await registry.healthCheckAll();
      expect(results).toHaveLength(1);
      expect(results[0].isHealthy).toBe(true);
    });

    it('handles health check failure', async () => {
      const registry = new AdapterRegistry();
      const adapter = mockAdapter('broken' as ProtocolId, 'Broken');
      (adapter.healthCheck as any).mockRejectedValue(new Error('timeout'));
      registry.register(adapter);

      const results = await registry.healthCheckAll();
      expect(results[0].isHealthy).toBe(false);
    });
  });

  describe('utility methods', () => {
    it('isEmpty is true when no adapters', () => {
      const registry = new AdapterRegistry();
      expect(registry.isEmpty).toBe(true);
    });

    it('isEmpty is false with adapters', () => {
      const registry = new AdapterRegistry();
      registry.register(mockAdapter('jupiter' as ProtocolId, 'Jupiter'));
      expect(registry.isEmpty).toBe(false);
    });

    it('getRegisteredProtocols lists all IDs', () => {
      const registry = new AdapterRegistry();
      registry.register(mockAdapter('jupiter' as ProtocolId, 'Jupiter'));
      registry.register(mockAdapter('marinade' as ProtocolId, 'Marinade'));
      expect(registry.getRegisteredProtocols()).toEqual(['jupiter', 'marinade']);
    });

    it('getSummary returns adapter info', () => {
      const registry = new AdapterRegistry();
      registry.register(
        mockAdapter('jupiter' as ProtocolId, 'Jupiter', [], ['swap' as ProtocolCapability]),
      );
      const summary = registry.getSummary();
      expect(summary).toHaveLength(1);
      expect(summary[0].name).toBe('Jupiter');
      expect(summary[0].capabilities).toContain('swap');
    });
  });
});
