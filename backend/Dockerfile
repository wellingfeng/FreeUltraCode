# UltraGameStudio Remote Runner — self-hosted cloud execution backend.
# Bundles git + the runner + the codex CLI (the only remote-project adapter).
# NOTE: build context must be the REPO ROOT (see docker-compose.yml), because
# the runner imports ../../packages/protocol relative to /app/src.
FROM node:20-slim

# 国内构建加速：Debian 换腾讯源（bookworm 用 deb822 格式的 sources），npm 换腾讯源。
RUN set -eux; \
  if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
    sed -i 's@deb.debian.org@mirrors.tencent.com@g; s@security.debian.org@mirrors.tencent.com@g' /etc/apt/sources.list.d/debian.sources; \
  fi; \
  if [ -f /etc/apt/sources.list ]; then \
    sed -i 's@deb.debian.org@mirrors.tencent.com@g; s@security.debian.org@mirrors.tencent.com@g' /etc/apt/sources.list; \
  fi; \
  npm config set registry https://mirrors.tencent.com/npm/

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install the codex CLI globally so the runner can spawn `codex`.
RUN npm install -g @openai/codex@0.141.0 \
  && codex --version

WORKDIR /app
COPY backend/package.json ./
# Install runtime deps (argon2 password hashing, nodemailer SMTP, Tencent SES SDK)
# required by the multi-user email auth backend.
RUN npm install --omit=dev --no-audit --no-fund
COPY backend/src ./src
# Codex gateway config + api key (packyapi). Lives at CODEX_HOME.
COPY backend/deploy/codex ./.codex
# Shared protocol contract — imported as ../../packages/protocol from /app/src.
COPY packages/protocol /packages/protocol

# Codex reads its gateway config + api key from CODEX_HOME.
ENV UGS_RUNNER_HOST=0.0.0.0 \
    UGS_RUNNER_PORT=8787 \
    UGS_RUNNER_WORKDIR=/data/workspaces \
    UGS_RUNNER_DATADIR=/data/state \
    CODEX_HOME=/app/.codex

VOLUME ["/data"]
EXPOSE 8787

CMD ["node", "src/server.mjs"]
