#!/bin/sh
# Certbot deploy-hook для Golf CRM.
# nginx в контейнере читает сертификаты из /opt/golf/app/deploy/certs (bind-mount),
# а не из /etc/letsencrypt напрямую — поэтому после продления файлы надо скопировать
# и перезагрузить nginx, иначе он продолжит отдавать старый сертификат.
set -e

LINEAGE=/etc/letsencrypt/live/krylatskoyegolfclub.online
DEST=/opt/golf/app/deploy/certs
LOG=/var/log/golf-cert-deploy.log

# Срабатывать только для этого домена. При `certbot renew --dry-run` RENEWED_LINEAGE
# указывает во временный каталог, а не сюда — тестовый сертификат в прод не попадёт.
[ "$RENEWED_LINEAGE" = "$LINEAGE" ] || exit 0

cp -L "$LINEAGE/fullchain.pem" "$DEST/fullchain.pem"
cp -L "$LINEAGE/privkey.pem"   "$DEST/privkey.pem"
chmod 644 "$DEST/fullchain.pem"
chmod 600 "$DEST/privkey.pem"

docker exec golf-nginx nginx -s reload

echo "$(date -Is) deployed cert to $DEST and reloaded golf-nginx" >> "$LOG"
