#!/usr/bin/env bash
# 在本地（Git Bash / WSL）运行：把证书、站点配置、首页一并推到服务器并重载 nginx
# 用法： bash deploy.sh
set -euo pipefail

SERVER=root@150.158.47.232
KEYS="E:/skillshare_keys/skillshare.center_nginx"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> 1. 上传证书到 /etc/nginx/ssl/"
ssh "$SERVER" 'mkdir -p /etc/nginx/ssl'
scp "$KEYS/skillshare.center_bundle.crt" "$SERVER:/etc/nginx/ssl/"
scp "$KEYS/skillshare.center.key"        "$SERVER:/etc/nginx/ssl/"
ssh "$SERVER" 'chmod 600 /etc/nginx/ssl/skillshare.center.key'

echo "==> 2. 上传站点配置到 /etc/nginx/conf.d/"
scp "$HERE/skillshare.center.conf" "$SERVER:/etc/nginx/conf.d/skillshare.center.conf"
# 关掉可能冲突的默认站点（default.conf 里若有 default_server 会和本配置打架）
ssh "$SERVER" 'if [ -f /etc/nginx/conf.d/default.conf ]; then mv /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.bak; fi'

echo "==> 3. 上传首页到 /var/www/html/"
ssh "$SERVER" 'mkdir -p /var/www/html'
scp "$HERE/index.html" "$SERVER:/var/www/html/index.html"

echo "==> 4. 校验并重载 nginx"
ssh "$SERVER" 'nginx -t && systemctl reload nginx && echo "nginx reloaded OK"'

echo "==> 5. 验证"
ssh "$SERVER" "ss -ltnp | grep -E ':80|:443' || true"
echo "本地探测："
curl -sS -o /dev/null -w "http://skillshare.center  -> %{http_code}\n" -L http://skillshare.center/ || true
curl -sSk -o /dev/null -w "https://skillshare.center -> %{http_code}\n"   https://skillshare.center/ || true
echo "完成。浏览器访问： https://skillshare.center"
