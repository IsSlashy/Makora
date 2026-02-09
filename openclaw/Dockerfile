FROM node:24-slim

# Install system dependencies needed by openclaw native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install OpenClaw globally
RUN npm install -g openclaw@2026.2.3-1 --unsafe-perm

# Create workspace
RUN mkdir -p /root/.openclaw/workspace/skills/makora/scripts \
    /root/.openclaw/credentials \
    /root/.openclaw/agents/main/sessions

# Copy config and skill files
COPY openclaw.json /root/.openclaw/openclaw.json
COPY workspace/ /root/.openclaw/workspace/

# Make skill bins executable
RUN chmod +x /root/.openclaw/workspace/skills/makora/bins/* 2>/dev/null || true
RUN chmod +x /root/.openclaw/workspace/skills/makora/scripts/*.mjs 2>/dev/null || true

# Write .env from Railway env vars at runtime
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 18789

ENTRYPOINT ["/entrypoint.sh"]
