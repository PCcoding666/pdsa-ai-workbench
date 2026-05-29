#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-}"
APP_PORT="${APP_PORT:-3002}"
EMAIL="${EMAIL:-}"
SITE_NAME="${SITE_NAME:-pdsa-ai-workbench}"

if [ -z "$DOMAIN" ]; then
  echo "DOMAIN is required, for example: DOMAIN=ai.example.com $0" >&2
  exit 2
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root." >&2
  exit 2
fi

apt-get update
apt-get install -y nginx certbot python3-certbot-nginx

site_file="/etc/nginx/sites-available/$SITE_NAME.conf"
enabled_file="/etc/nginx/sites-enabled/$SITE_NAME.conf"

cat > "$site_file" <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX

ln -sfn "$site_file" "$enabled_file"
nginx -t
systemctl reload nginx

certbot_args=(--nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos)
if [ -n "$EMAIL" ]; then
  certbot_args+=(-m "$EMAIL")
else
  certbot_args+=(--register-unsafely-without-email)
fi

certbot "${certbot_args[@]}"
systemctl reload nginx

echo "HTTPS is configured for https://$DOMAIN"
