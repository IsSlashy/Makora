FROM node:24-slim

# Install OpenClaw globally
RUN npm install -g openclaw@latest

# Create workspace
RUN mkdir -p /root/.openclaw/workspace/skills/makora/scripts \
    /root/.openclaw/credentials \
    /root/.openclaw/agents/main/sessions

# Copy config and skill files
COPY openclaw.json /root/.openclaw/openclaw.json
COPY workspace/ /root/.openclaw/workspace/

# Env vars will be set via Railway dashboard
# OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, SOLANA_RPC_URL, etc.

# Write .env from Railway env vars at runtime
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 18789

ENTRYPOINT ["/entrypoint.sh"]
