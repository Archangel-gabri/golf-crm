# GolfAdmin · Production deployment

Рекомендуемый вариант для продакшена: Ubuntu Server 24.04 LTS + Docker Compose +
PostgreSQL + nginx или Caddy. Наружу открыты только 22, 80, 443. PostgreSQL наружу
не публикуется.

## Сервер

Минимум:

- 2 CPU
- 4 GB RAM
- 40-80 GB SSD
- Ubuntu Server 24.04 LTS

Лучше:

- 4 CPU
- 8 GB RAM
- 80+ GB SSD

Рабочая директория на сервере: `/opt/golf`. Не используйте production-путь с
пробелами, `#` или кириллицей.

## Первый деплой через Docker Compose

```sh
sudo apt update
sudo apt install -y git docker.io docker-compose-plugin
sudo systemctl enable --now docker

sudo mkdir -p /opt/golf
sudo chown "$USER":"$USER" /opt/golf
git clone <repo> /opt/golf
cd /opt/golf/Projects/Golf

cp .env.example .env
python3 -c "import secrets; print('SECRET_KEY=' + secrets.token_hex(64))"
python3 -c "import secrets; print('POSTGRES_PASSWORD=' + secrets.token_urlsafe(32))"
python3 -c "import secrets; print('INITIAL_ADMIN_PASSWORD=' + secrets.token_urlsafe(16))"
```

В `.env` обязательно выставить:

- `ENV=production`
- `SECRET_KEY=<64+ random chars>`
- `POSTGRES_PASSWORD=<random password>`
- `INITIAL_ADMIN_PASSWORD=<temporary admin password>`
- `CORS_ORIGINS=https://your-domain.com`
- `COOKIE_SECURE=true`
- `DOMAIN=your-domain.com`
- `ACME_EMAIL=admin@your-domain.com`

Первый вход: `admin` / `INITIAL_ADMIN_PASSWORD`. После входа приложение принудит
сменить пароль.

## HTTPS через nginx

`docker-compose.yml` по умолчанию поднимает nginx.

1. Замените `golf.example.com` на реальный домен в `deploy/nginx.prod.conf`.
2. Выпустите сертификат Let's Encrypt:

```sh
sudo apt install -y certbot
sudo certbot certonly --standalone -d your-domain.com
mkdir -p deploy/certs
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem deploy/certs/
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem deploy/certs/
sudo chown -R "$USER":"$USER" deploy/certs
```

Запуск:

```sh
docker compose up -d --build
docker compose exec backend alembic upgrade head
docker compose ps
docker compose logs -f backend nginx backup
```

Проверка:

```sh
curl -I https://your-domain.com/
curl https://your-domain.com/api/health
```

### Автопродление сертификата (обязательно проверить!)

Схема выше выпускает сертификат в `--standalone`-режиме, и это **работает только один
раз**. Дальше `certbot renew` падает с `Could not bind TCP port 80` — порт 80 держит
контейнер `golf-nginx`. Плюс nginx читает сертификаты не из `/etc/letsencrypt`, а из
bind-mount `deploy/certs`, поэтому даже успешное продление до него не доедет.
Ровно так прод и лёг 25.07.2026: сайт был недоступен 9 дней.

Рабочая схема (настроена на проде 03.08.2026):

1. В `docker-compose.yml` в сервис nginx смонтирован `/var/www/certbot` — туда ACME
   кладёт challenge, а `deploy/nginx.prod.conf` уже отдаёт его до 301-редиректа.
2. `/etc/letsencrypt/renewal/<домен>.conf` переведён на `authenticator = webroot`
   с `webroot_path = /var/www/certbot` — продление идёт без остановки nginx.
3. `deploy/renew-deploy-hook.sh` установлен на сервере как
   `/etc/letsencrypt/renewal-hooks/deploy/golf-nginx.sh` (`chmod +x`) — копирует новые
   сертификаты в `deploy/certs` и делает `nginx -s reload`. Пишет в
   `/var/log/golf-cert-deploy.log`.

Проверка (не трогает боевой сертификат, nginx останавливать не нужно):

```sh
certbot renew --dry-run     # ждёт случайную паузу до ~7 мин, это нормально
certbot certificates        # срок действия
tail /var/log/golf-cert-deploy.log
```

Продление сработает само за 30 дней до истечения (`certbot.timer`, 2 раза в сутки).

## HTTPS через Caddy

Caddy проще для сертификатов: он сам выпускает и обновляет Let's Encrypt. В
проекте есть `deploy/Caddyfile`, но основной compose сейчас настроен на nginx.
Если выбираете Caddy, замените nginx-сервис на caddy-сервис с этим файлом.

Минимальный сервис:

```yaml
caddy:
  image: caddy:2-alpine
  restart: unless-stopped
  ports:
    - "80:80"
    - "443:443"
  environment:
    DOMAIN: ${DOMAIN}
    ACME_EMAIL: ${ACME_EMAIL}
  volumes:
    - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
    - caddy_data:/data
    - caddy_config:/config
  depends_on:
    - frontend
    - backend
  networks: [golf_net]
```

nginx даёт больше контроля и уже имеет `limit_req` на `/api/auth/login`. Caddy
проще в эксплуатации; login также защищён backend rate-limit'ом.

## PostgreSQL и миграции

Схема базы управляется Alembic:

```sh
docker compose exec backend alembic upgrade head
docker compose exec backend alembic current
```

Новые миграции создавать локально:

```sh
cd backend
alembic revision --autogenerate -m "describe change"
alembic upgrade head
```

## Перенос данных из SQLite

Если нужно перенести существующую локальную `golf.db` в свежий Postgres:

```sh
docker compose up -d postgres backend
docker compose exec backend alembic upgrade head
docker cp ./golf.db golf-backend:/tmp/golf.db
docker compose exec backend sh -lc \
  'SOURCE_SQLITE=/tmp/golf.db DEST_POSTGRES="$DATABASE_URL" python scripts/migrate_sqlite_to_postgres.py'
```

Скрипт отказывается копировать данные, если таблицы Postgres уже не пустые.

## Бэкапы

В compose есть сервис `backup`. Он делает `pg_dump --format=custom` раз в сутки
и хранит файлы в Docker volume `golf_backups`.

Настройки в `.env`:

- `BACKUP_RETAIN_DAYS=30`
- `BACKUP_INTERVAL_SECONDS=86400`

Ручной backup:

```sh
docker compose run --rm -e RUN_ONCE=1 backup
```

Проверить список бэкапов:

```sh
docker compose run --rm backup sh -lc 'ls -lh /backups | tail'
```

Восстановление проверять хотя бы раз в неделю на отдельной staging-базе.

## Firewall и SSH

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Для SSH: только ключи, `PasswordAuthentication no`, регулярные обновления ОС.

## Обновление релиза

```sh
cd /opt/golf/Projects/Golf
git pull
docker compose build
docker compose up -d
docker compose exec backend alembic upgrade head
docker compose ps
```

## Rollback

```sh
git log --oneline -5
git checkout <previous-good-commit>
docker compose build
docker compose up -d
```

Если релиз включал миграцию БД, сначала проверьте downgrade-стратегию или
восстановите staging из backup.

## Checklist перед включением домена

- [ ] `.env` заполнен реальными production-значениями
- [ ] `ENV=production`
- [ ] `/docs`, `/redoc`, `/openapi.json` недоступны
- [ ] `COOKIE_SECURE=true`
- [ ] `CORS_ORIGINS` содержит только реальный домен
- [ ] HTTPS работает
- [ ] `curl -I` показывает HSTS/CSP/security headers
- [ ] `docker compose ps` показывает healthy backend/postgres
- [ ] Alembic: `upgrade head` выполнен
- [ ] Первый admin-пароль сменён
- [ ] Backup-сервис создаёт дампы
- [ ] Firewall открыт только на 22, 80, 443
