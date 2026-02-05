import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Agent capability descriptor types
// ---------------------------------------------------------------------------

interface AgentInfo {
  name: string;
  version: string;
  description: string;
  runtime: string;
  network: string;
}

interface Capability {
  id: string;
  name: string;
  description: string;
  protocols: string[];
  endpoint: string;
  method: 'GET' | 'POST';
  params: Record<string, string>;
}

interface Composability {
  description: string;
  auth: string;
  rateLimit: string;
  formats: string[];
}

interface Programs {
  vault: string;
  strategy: string;
  privacy: string;
}

interface AgentCapabilities {
  agent: AgentInfo;
  capabilities: Capability[];
  composability: Composability;
  programs: Programs;
}

// ---------------------------------------------------------------------------
// Capability manifest
// ---------------------------------------------------------------------------

const CAPABILITIES: AgentCapabilities = {
  agent: {
    name: 'Makora',
    version: '0.1.0',
    description: 'LLM-powered privacy-preserving DeFi agent on Solana',
    runtime: 'Next.js + Solana',
    network: 'devnet',
  },

  capabilities: [
    {
      id: 'swap',
      name: 'Token Swap',
      description: 'Swap tokens via Jupiter aggregator',
      protocols: ['jupiter'],
      endpoint: '/api/agent/execute',
      method: 'POST',
      params: {
        action: 'swap',
        fromToken: 'string',
        toToken: 'string',
        amount: 'number',
      },
    },
    {
      id: 'perp_trade',
      name: 'Perpetual Trading',
      description: 'Open/close perpetual positions via Jupiter Perps',
      protocols: ['jupiter-perps'],
      endpoint: '/api/agent/execute',
      method: 'POST',
      params: {
        action: 'open_perp',
        market: 'string',
        side: 'long|short',
        size: 'number',
        leverage: 'number',
      },
    },
    {
      id: 'stake',
      name: 'SOL Staking',
      description: 'Liquid stake SOL via Marinade Finance',
      protocols: ['marinade'],
      endpoint: '/api/agent/execute',
      method: 'POST',
      params: {
        action: 'stake',
        amount: 'number',
      },
    },
    {
      id: 'portfolio',
      name: 'Portfolio Analysis',
      description: 'Read wallet portfolio with token positions and values',
      protocols: ['solana-rpc'],
      endpoint: '/api/agent/positions',
      method: 'GET',
      params: {
        wallet: 'string',
      },
    },
    {
      id: 'strategy',
      name: 'Strategy Evaluation',
      description:
        'LLM-powered strategy analysis with market data and Polymarket signals',
      protocols: ['anthropic', 'openai', 'qwen', 'polymarket'],
      endpoint: '/api/agent/cycle',
      method: 'POST',
      params: {},
    },
    {
      id: 'ooda_cycle',
      name: 'OODA Cycle',
      description: 'Run a single Observe-Orient-Decide-Act cycle',
      protocols: ['all'],
      endpoint: '/api/agent/cycle',
      method: 'POST',
      params: {
        mode: 'PERPS|INVEST',
      },
    },
    {
      id: 'privacy_shield',
      name: 'Privacy Shield',
      description:
        'Shield SOL into ZK privacy pool with stealth addresses',
      protocols: ['makora-privacy'],
      endpoint: '/api/agent/execute',
      method: 'POST',
      params: {
        action: 'shield',
        amount: 'number',
      },
    },
    {
      id: 'natural_language',
      name: 'Natural Language Command',
      description: 'Parse and execute natural language trading commands',
      protocols: ['all'],
      endpoint: '/api/agent/command',
      method: 'POST',
      params: {
        command: 'string',
      },
    },
    {
      id: 'chat',
      name: 'Chat Interface',
      description: 'Conversational interface with MoltBot trading persona',
      protocols: ['anthropic', 'openai', 'qwen'],
      endpoint: '/api/openclaw/chat',
      method: 'POST',
      params: {
        messages: 'array',
        llmKeys: 'object',
      },
    },
    {
      id: 'market_intelligence',
      name: 'Market Intelligence',
      description: 'Polymarket prediction market data for crypto markets',
      protocols: ['polymarket'],
      endpoint: '/api/polymarket',
      method: 'GET',
      params: {},
    },
  ],

  composability: {
    description: 'Other agents can compose on top of Makora via REST API',
    auth: 'none (devnet)',
    rateLimit: 'none',
    formats: ['application/json'],
  },

  programs: {
    vault: 'BTAd1ghiv4jKd4kREh14jCtHrVG6zDFNgLRNoF9pUgqw',
    strategy: 'EH5sixTHAoLsdFox1bR3YUqgwf5VuX2BdXFew5wTE6dj',
    privacy: 'C1qXFsB6oJgZLQnXwRi9mwrm3QshKMU8kGGUZTAa9xcM',
  },
};

// ---------------------------------------------------------------------------
// GET /api/agent/capabilities
// ---------------------------------------------------------------------------

export async function GET() {
  return NextResponse.json(CAPABILITIES, {
    headers: {
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  });
}
