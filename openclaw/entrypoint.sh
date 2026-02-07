#!/bin/bash
set -e

# Write OpenClaw .env from Railway env vars
# If AI Gateway is configured, route OpenAI calls through it
cat > /root/.openclaw/.env <<EOF
OPENAI_API_KEY=${AI_GATEWAY_API_KEY:-${OPENAI_API_KEY}}
OPENAI_BASE_URL=${OPENAI_BASE_URL:-https://api.openai.com/v1}
EOF

# Inject Telegram bot token directly into config JSON
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  sed -i "s/REPLACED_AT_RUNTIME/${TELEGRAM_BOT_TOKEN}/" /root/.openclaw/openclaw.json
  echo "[Makora] Telegram token injected"

  # Register ONLY DeFi commands with Telegram Bot API
  # This controls what appears in the / command menu for users
  echo "[Makora] Setting Telegram bot commands..."
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands" \
    -H "Content-Type: application/json" \
    -d '{
      "commands": [
        {"command": "start", "description": "Start Makora & show menu"},
        {"command": "scan", "description": "Full market scan with recommendations"},
        {"command": "status", "description": "Portfolio & positions overview"},
        {"command": "sentiment", "description": "7-signal market sentiment"},
        {"command": "news", "description": "Latest crypto headlines"},
        {"command": "positions", "description": "Open perp positions & P&L"},
        {"command": "strategy", "description": "AI strategy evaluation"},
        {"command": "auto", "description": "OODA autonomous trading loop"},
        {"command": "swap", "description": "Swap tokens via Jupiter"},
        {"command": "app", "description": "Open the full dashboard"}
      ]
    }' > /dev/null 2>&1 && echo "[Makora] Bot commands registered" || echo "[Makora] Warning: could not set bot commands"
fi

# Inject gateway auth token if provided
if [ -n "$GATEWAY_TOKEN" ]; then
  sed -i "s/makora-gateway-token-change-me/${GATEWAY_TOKEN}/" /root/.openclaw/openclaw.json
fi

# Write Makora env for the CLI
cat > /root/.openclaw/workspace/skills/makora/scripts/.env <<EOF
SOLANA_RPC_URL=${SOLANA_RPC_URL:-https://api.devnet.solana.com}
SOLANA_NETWORK=${SOLANA_NETWORK:-devnet}
JUPITER_API_KEY=${JUPITER_API_KEY:-}
CRYPTOPANIC_API_KEY=${CRYPTOPANIC_API_KEY:-}
EOF

echo "[Makora] Starting OpenClaw gateway on port ${PORT:-18789}..."
echo "[Makora] Model: openai/gpt-4o"
echo "[Makora] Telegram: enabled"

# Start the gateway (foreground)
exec openclaw gateway --port ${PORT:-18789}
