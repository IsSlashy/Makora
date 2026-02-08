'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AgentPhase } from '@/lib/agent-status';

export interface AgentStatusData {
  phase: AgentPhase;
  phaseDescription: string;
  lastUpdate: number;
  cycleCount: number;
  confidence: number;
  sentiment?: string;
  actions: Array<{
    timestamp: number;
    phase: AgentPhase;
    description: string;
    tool?: string;
    result?: string;
  }>;
}

const POLL_INTERVAL_MS = 2000;

export function useAgentStatus() {
  const [status, setStatus] = useState<AgentStatusData>({
    phase: 'IDLE',
    phaseDescription: 'Agent idle',
    lastUpdate: 0,
    cycleCount: 0,
    confidence: 0,
    actions: [],
  });

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/status');
      if (!res.ok) return;
      const data: AgentStatusData = await res.json();
      setStatus(data);
    } catch {
      // Ignore fetch errors — dashboard might be loading
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return status;
}
