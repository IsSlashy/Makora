/**
 * Hashing utilities for SOLPRISM reasoning traces.
 * Uses the same SHA-256 canonical JSON algorithm as @solprism/sdk.
 */

import { createHash } from "crypto";
import type { ReasoningTrace } from "./types.js";

/**
 * Deterministically serialize and hash a reasoning trace.
 * Returns hex-encoded SHA-256 hash.
 *
 * Compatible with SOLPRISM SDK: hashTraceHex()
 */
export function hashTrace(trace: ReasoningTrace): string {
  const canonical = JSON.stringify(trace, Object.keys(trace).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Verify that a trace matches a previously computed hash.
 */
export function verifyTrace(trace: ReasoningTrace, expectedHash: string): boolean {
  return hashTrace(trace) === expectedHash;
}
