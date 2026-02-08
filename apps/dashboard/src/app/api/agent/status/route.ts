import { NextRequest, NextResponse } from 'next/server';
import { getAgentStatus, setAgentPhase, type AgentPhase } from '@/lib/agent-status';

/**
 * GET /api/agent/status — Dashboard polls this to get current bot phase
 */
export async function GET() {
  const status = getAgentStatus();
  return NextResponse.json(status);
}

/**
 * POST /api/agent/status — Bot pushes phase updates here
 * Body: { phase: "OBSERVE"|"ORIENT"|"DECIDE"|"ACT"|"IDLE", description: string, tool?, result?, confidence?, sentiment? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phase, description, tool, result, confidence, sentiment } = body;

    if (!phase || !description) {
      return NextResponse.json({ error: 'Missing phase or description' }, { status: 400 });
    }

    const validPhases: AgentPhase[] = ['IDLE', 'OBSERVE', 'ORIENT', 'DECIDE', 'ACT'];
    if (!validPhases.includes(phase)) {
      return NextResponse.json({ error: `Invalid phase: ${phase}` }, { status: 400 });
    }

    setAgentPhase(phase, description, { tool, result, confidence, sentiment });

    return NextResponse.json({ ok: true, phase, timestamp: Date.now() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
