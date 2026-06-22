#!/usr/bin/env bash
# UltraGameStudio Remote Runner — 一键部署到腾讯云 CVM（固定IP + HTTP，测试用）。
# 在仓库根执行：  bash backend/deploy/deploy.sh
set -euo pipefail

SERVER_IP="${SERVER_IP:-150.158.47.232}"
SSH_USER="${SSH_USER:-root}"
SSH_PORT="${SSH_PORT:-22}"
REMOTE_DIR="${REMOTE_DIR:-/opt/ugs-runner}"
SSH="ssh -p ${SSH_PORT} ${SSH_USER}@${SERVER_IP}"

echo "==> [1/5] 打包部署文件"
TMP_TAR="$(mktemp -t ugs-runner-XXXX).tgz"
tar -czf "$TMP_TAR" \
  backend/Dockerfile \
  backend/package.json \
  backend/src \
  backend/deploy/codex \
  backend/.env.deploy \
  docker-compose.deploy.yml \
  packages/protocol
echo "    包大小: $(du -h "$TMP_TAR" | cut -f1)"

echo "==> [2/5] 上传到 ${SERVER_IP}:${REMOTE_DIR}"
$SSH "mkdir -p ${REMOTE_DIR}"
scp -P "${SSH_PORT}" "$TMP_TAR" "${SSH_USER}@${SERVER_IP}:${REMOTE_DIR}/payload.tgz"
rm -f "$TMP_TAR"

echo "==> [3/5] 确保 Docker 已安装"
$SSH 'command -v docker >/dev/null 2>&1 || (curl -fsSL https://get.docker.com | sh && systemctl enable --now docker)'

echo "==> [4/5] 解包并构建启动"
$SSH "cd ${REMOTE_DIR} && tar -xzf payload.tgz && rm -f payload.tgz && \
  docker compose -f docker-compose.deploy.yml up -d --build"

echo "==> [5/5] 健康检查"
sleep 3
$SSH "curl -fsS http://localhost:8787/health || (echo '健康检查失败，看日志:'; docker compose -f ${REMOTE_DIR}/docker-compose.deploy.yml logs --tail=40)"
echo ""
echo "完成。桌面端「添加云端项目」填："
echo "  服务器地址: http://${SERVER_IP}:8787"
echo "  Token: 见 backend/.env.deploy 的 UGS_RUNNER_TOKEN"
