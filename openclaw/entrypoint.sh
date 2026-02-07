#!/bin/bash
set -e

# Write OpenClaw .env from Railway env vars
cat > /root/.openclaw/.env <<EOF
OPENAI_API_KEY=${OPENAI_API_KEY}
EOF

# Inject Telegram bot token directly into config JSON
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  sed -i "s/REPLACED_AT_RUNTIME/${TELEGRAM_BOT_TOKEN}/" /root/.openclaw/openclaw.json
  echo "[Makora] Telegram token injected"
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
