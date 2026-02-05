import { describe, it, expect, vi } from 'vitest';
import { ExecutionEngine } from '../engine';
import { DEFAULT_EXECUTION_CONFIG } from '../types';
import type { ExecutionState } from '../types';

// Minimal mock for Connection
function mockConnection(overrides: Record<string, any> = {}) {
  return {
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: 'mock-blockhash',
      lastValidBlockHeight: 1000,
    }),
    sendTransaction: vi.fn().mockResolvedValue('mock-signature'),
    simulateTransaction: vi.fn().mockResolvedValue({
      value: { err: null, unitsConsumed: 200_000 },
    }),
    confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
    getBalance: vi.fn().mockResolvedValue(5_000_000_000),
    ...overrides,
  } as any;
}

describe('ExecutionEngine', () => {
  describe('constructor and config', () => {
    it('uses default config when none provided', () => {
      const engine = new ExecutionEngine(mockConnection());
      const config = engine.getConfig();
      expect(config.maxRetries).toBe(DEFAULT_EXECUTION_CONFIG.maxRetries);
      expect(config.maxComputeUnits).toBe(DEFAULT_EXECUTION_CONFIG.maxComputeUnits);
    });

    it('merges custom config with defaults', () => {
      const engine = new ExecutionEngine(mockConnection(), { maxRetries: 5 });
      const config = engine.getConfig();
      expect(config.maxRetries).toBe(5);
      expect(config.maxComputeUnits).toBe(DEFAULT_EXECUTION_CONFIG.maxComputeUnits);
    });

    it('updateConfig merges changes', () => {
      const engine = new ExecutionEngine(mockConnection());
      engine.updateConfig({ skipPreflight: true });
      expect(engine.getConfig().skipPreflight).toBe(true);
      expect(engine.getConfig().maxRetries).toBe(DEFAULT_EXECUTION_CONFIG.maxRetries);
    });
  });

  describe('state callback', () => {
    it('receives state updates via onStateChange', () => {
      const engine = new ExecutionEngine(mockConnection());
      const states: ExecutionState[] = [];
      engine.onStateChange((state) => states.push(state));

      // Access private emitState via type assertion for testing
      (engine as any).emitState({ phase: 'building', description: 'test' });
      expect(states).toHaveLength(1);
      expect(states[0]).toEqual({ phase: 'building', description: 'test' });
    });
  });

  describe('risk validator', () => {
    it('can set risk validator', () => {
      const engine = new ExecutionEngine(mockConnection());
      const validator = {
        validate: vi.fn().mockResolvedValue({ approved: true, riskScore: 0, summary: 'ok' }),
      };
      engine.setRiskValidator(validator);
      // Verify it was set by checking the private field
      expect((engine as any).riskValidator).toBe(validator);
    });
  });

  describe('isRetryableError', () => {
    it('identifies retryable errors', () => {
      const engine = new ExecutionEngine(mockConnection());
      const check = (err: string) => (engine as any).isRetryableError(err);

      expect(check('block height exceeded')).toBe(true);
      expect(check('Blockhash not found')).toBe(true);
      expect(check('Too many requests')).toBe(true);
      expect(check('429 rate limited')).toBe(true);
      expect(check('ECONNRESET')).toBe(true);
      expect(check('ETIMEDOUT')).toBe(true);
      expect(check('socket hang up')).toBe(true);
    });

    it('identifies non-retryable errors', () => {
      const engine = new ExecutionEngine(mockConnection());
      const check = (err: string) => (engine as any).isRetryableError(err);

      expect(check('Insufficient funds')).toBe(false);
      expect(check('Account not found')).toBe(false);
      expect(check('Invalid instruction')).toBe(false);
    });
  });

  describe('sleep', () => {
    it('resolves after delay', async () => {
      const engine = new ExecutionEngine(mockConnection());
      const start = Date.now();
      await (engine as any).sleep(10);
      expect(Date.now() - start).toBeGreaterThanOrEqual(5);
    });
  });
});
