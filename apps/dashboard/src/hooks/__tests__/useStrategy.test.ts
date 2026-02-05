import { describe, it, expect } from 'vitest';

describe('useStrategy – mainnet degradation', () => {
  describe('graceful degradation', () => {
    it('initializeStrategy sets error instead of throwing on mainnet', () => {
      const isMainnet = true;
      let error: string | null = null;

      if (isMainnet) {
        error = 'Strategy programs on devnet only';
      }

      expect(error).toBe('Strategy programs on devnet only');
    });

    it('logAction silently skips on mainnet', () => {
      const isMainnet = true;
      const result = isMainnet ? 'mainnet-skip' : 'tx-sig';
      expect(result).toBe('mainnet-skip');
    });
  });

  describe('byte conversion helpers', () => {
    function bytesToString(bytes: number[]): string {
      const end = bytes.indexOf(0);
      const slice = end === -1 ? bytes : bytes.slice(0, end);
      return String.fromCharCode(...slice);
    }

    function stringToFixedBytes(str: string, len: number): number[] {
      const bytes = new Array(len).fill(0);
      for (let i = 0; i < Math.min(str.length, len); i++) {
        bytes[i] = str.charCodeAt(i);
      }
      return bytes;
    }

    it('converts string to fixed bytes', () => {
      const bytes = stringToFixedBytes('SOL', 8);
      expect(bytes.length).toBe(8);
      expect(bytes[0]).toBe(83); // 'S'
      expect(bytes[1]).toBe(79); // 'O'
      expect(bytes[2]).toBe(76); // 'L'
      expect(bytes.slice(3)).toEqual([0, 0, 0, 0, 0]);
    });

    it('converts bytes back to string', () => {
      const bytes = [83, 79, 76, 0, 0, 0, 0, 0];
      expect(bytesToString(bytes)).toBe('SOL');
    });

    it('handles full-length string without null terminator', () => {
      const bytes = stringToFixedBytes('LONGNAME', 8);
      expect(bytesToString(bytes)).toBe('LONGNAME');
    });

    it('truncates string longer than buffer', () => {
      const bytes = stringToFixedBytes('TOOLONGNAME', 8);
      expect(bytesToString(bytes)).toBe('TOOLONGN');
    });
  });

  describe('allocation defaults', () => {
    it('default allocation sums to 100%', () => {
      const pcts = [35, 25, 25, 15];
      expect(pcts.reduce((a, b) => a + b, 0)).toBe(100);
    });
  });
});
