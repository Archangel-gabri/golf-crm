# GolfAdmin v2

Production-ready CRM гольф-клуба. **Это не HTML-сайт**: серверная логика на **Python (FastAPI)**, фронт на **TypeScript + React** (компилируется в JS), база через SQL (SQLAlchemy → SQLite/PostgreSQL). Файл `index.html` — единственный HTML-файл проекта (~20 строк — только точка монтирования React).

## Что редактируется из интерфейса (v2.1)

- **Услуги** (`/catalog`) — добавление/правка/выключение; теги, категория, цена, длительность, группа, флаги trial/kids/instructor
- **Тренеры** (`/instructors`) — добавление/правка; теги, специализация, телефон, email, цвет, ставка ₽/час, био
- **Клиенты** (`/customers`) — добавление/правка/удаление; все поля + согласие на маркетинг
- **Промокоды** (`/coupons`) — percent/fixed, срок действия, лимиты, счётчик использований
- **Тарифы членства** (`/memberships`) — скидка %, приоритет, описание
- **Специализации** — справочник тегов тренеров
- **Брони** — полное редактирование (клиент/услуга/тренер/ресурс/время/гости/промокод/цена) + статус-переходы (confirm → check-in → complete / cancel / no-show) + удаление
- **Сотрудники** (`/staff`, admin) — CRUD с ролями
- **Настройки клуба** (`/settings`) — сезон, произвольные key-value

## Новый диалог создания брони

На Tee-Sheet клик по пустой области столбца ресурса открывает диалог:
1. **Клиент** из списка ИЛИ быстрое создание через «+ Быстро создать»
2. **Услуга** + предложение длительности = длительность услуги
3. **Длительность** 15/30/45/60/90/120/180 мин
4. **Тренер** (показ тегов в выпадающем списке)
5. **Гости** (для групповых)
6. **Промокод** — live-валидация + показ скидки
7. **Комментарий**
8. **Live-расчёт стоимости**: база × гостей (с учётом пропорции длительности) + override тренера + скидка по промокоду = итого
9. Опционально — ручная цена для override автомата

## Tee-Sheet v2

- **Минутный таймлайн** — шаг сетки 5 / 15 / 30 / 60 мин (селектор сверху)
- **Brewen broney рисует «как в Google Calendar»**: пересекающиеся брони автоматически раскладываются в колонки внутри ресурса
- Клик по точной минуте в столбце ресурса → snap к шагу сетки → диалог создания
- 10, 50 или 100 броней в день рисуются без коллизий

## На чём написано

| Что | Язык | Файлы |
|-----|------|-------|
| Backend (API, бизнес-логика, БД) | **Python 3.12** | `backend/app/**/*.py` |
| SQL-модели / миграции | Python + SQL через SQLAlchemy ORM | `backend/app/models.py` |
| Frontend (весь UI) | **TypeScript + JSX** | `frontend/src/**/*.tsx`, `*.ts` |
| Стили | Tailwind CSS (утилитарные классы в TSX) | `frontend/src/index.css` |
| E2E тесты | TypeScript (Playwright) | `e2e/tests/*.spec.ts` |
| Деплой / inf | **Bash + Dockerfile + Docker Compose + nginx/Caddy** | `deploy/`, `scripts/`, `Dockerfile`, `docker-compose.yml` |
| HTML | только точка монтирования (1 файл) | `frontend/index.html` |

React/TSX — это **не HTML**. Компилятор (Vite + SWC) превращает компоненты в JavaScript, который браузер выполняет и сам строит DOM. Разработка идёт на TypeScript со строгой типизацией и интеграцией с типами API.

## Структура

```
Golf/
├── backend/                     # FastAPI (Python)
│   ├── app/
│   │   ├── main.py              # app factory + security middleware
│   │   ├── config.py
│   │   ├── db.py                # engine, SessionLocal, PRAGMA
│   │   ├── models.py            # SQLAlchemy: 25+ таблиц
│   │   ├── enums.py
│   │   ├── schemas.py           # Pydantic DTO
│   │   ├── security.py          # JWT + argon2 + SHA-256 migration
│   │   ├── deps.py              # get_current_user, require_admin/manager
│   │   ├── scheduler.py         # слоты, конфликты, видимость по сезону
│   │   ├── audit.py
│   │   ├── migrations.py        # патчи легаси-схемы SQLite + идемпотентные data-fixup
│   │   ├── csrf.py              # двойная кука + сверка заголовка
│   │   ├── rate_limit.py        # скользящее окно на /auth/login
│   │   ├── seed.py
│   │   └── routers/
│   │       ├── auth.py          # /auth/login, /logout, /me
│   │       ├── resources.py     # /resources, /zones, /slots
│   │       ├── bookings.py      # /bookings + transitions + patch
│   │       ├── customers.py     # /customers CRUD
│   │       ├── catalog.py       # /catalog/services, /instructors (read)
│   │       ├── catalog_admin.py # CRUD услуг/тренеров/ресурсов, cascade preview
│   │       ├── specializations.py
│   │       ├── memberships.py
│   │       ├── dashboard.py     # квик-стата
│   │       ├── analytics.py     # ← ПОЛНАЯ АНАЛИТИКА (heatmap, RevPATT, pace, категории)
│   │       ├── calendar.py      # event feed для timeline + drag/drop reschedule
│   │       ├── admin.py         # staff CRUD, audit log, settings
│   │       └── search.py        # /search?q=… (Cmd+K палитра)
│   ├── alembic/                 # миграции схемы (владелец схемы с фазы 03)
│   ├── tests/                   # pytest: аутентификация + боевой конфиг
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   └── run.py
│
├── frontend/                    # React + Vite + TS + Tailwind
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx              # роутинг
│   │   ├── index.css            # Tailwind
│   │   ├── lib/
│   │   │   ├── api.ts           # типизированный API-клиент (~450 строк)
│   │   │   └── utils.ts
│   │   ├── hooks/useAuth.ts
│   │   ├── components/
│   │   │   ├── Layout.tsx       # sidebar с RBAC
│   │   │   └── CommandPalette.tsx  # ⌘K поиск
│   │   └── pages/
│   │       ├── Login.tsx
│   │       ├── Dashboard.tsx       # компактная сводка
│   │       ├── Analytics.tsx       # ← heatmap / pace / RevPATT / категории / утилизация / топ-дни
│   │       ├── TeeSheet.tsx        # grid с созданием брони
│   │       ├── Calendar.tsx        # timeline view + drawer брони
│   │       ├── Bookings.tsx        # таблица + статус-переходы
│   │       ├── Customers.tsx       # CRUD + поиск
│   │       ├── Catalog.tsx         # услуги по категориям
│   │       ├── Instructors.tsx
│   │       ├── Memberships.tsx
│   │       ├── Staff.tsx           # (admin) CRUD сотрудников
│   │       ├── Audit.tsx           # (admin) журнал изменений
│   │       └── Settings.tsx        # (admin) сезон, настройки
│   ├── Dockerfile
│   ├── nginx.spa.conf
│   ├── vite.config.ts
│   └── package.json
│
├── e2e/                         # Playwright (TS)
│   ├── tests/
│   │   ├── smoke.spec.ts
│   │   ├── auth.spec.ts
│   │   ├── booking.spec.ts
│   │   ├── coupons.spec.ts
│   │   ├── customers.spec.ts
│   │   ├── navigation.spec.ts
│   │   └── api.spec.ts
│   ├── global-setup.ts
│   └── playwright.config.ts
│
├── deploy/                      # Production инфра
│   ├── README.md                # пошаговая инструкция деплоя
│   ├── nginx.prod.conf          # TLS + HSTS + CSP + rate-limit
│   ├── Caddyfile                # альтернативный reverse proxy с auto HTTPS
│   └── golf-backend.service     # systemd unit (hardened)
│
├── scripts/                     # Bash для разработки и ops
│   ├── dev.sh                   # поднять бэк+фронт локально
│   ├── test.sh                  # прогон всех тестов
│   ├── lint.sh                  # ruff + tsc
│   ├── security-scan.sh         # bandit, pip-audit, npm audit, detect-secrets, default-password check
│   ├── backup-postgres.sh       # pg_dump для Docker production
│   ├── backup-sqlite.sh         # legacy SQLite .backup
│   └── backup-db.sh             # совместимость для старых cron-задач
│
├── design/tokens.json           # визуальный контракт (см. DESIGN.md)
├── docker-compose.yml           # postgres, backend, frontend, nginx, backup
└── .gitignore                   # секреты, БД, dumps и test artifacts не версионируются
```

## Запуск — локальная разработка

### Windows

```bat
run-v2.bat
```

Это:
1. `subst Z:` — мапит проект на диск `Z:\` (Vite не работает при `#` в пути).
2. Стартует backend на `:8000`.
3. Стартует frontend на `:5173`.

### Linux / macOS

```sh
bash scripts/dev.sh
```

Открыть http://127.0.0.1:5173 → dev-аккаунт `admin / admin`, затем сменить пароль.

Swagger API: http://127.0.0.1:8000/docs (53 эндпоинта).

## Тесты

```sh
bash scripts/test.sh
```

- Backend: импорт-смок + pytest (`backend/tests/`, 9 проверок)
- Frontend: TypeScript + production Vite build
- E2E: Playwright (Chromium) — 19 сценариев; backend и frontend поднимаются сами

`scripts/test.sh` всегда копирует исходники в `/tmp/golf-test-*`, создаёт свежие
synthetic SQLite-базы и не копирует `.env`, `golf.db`, backups и `node_modules`.
Прямой `npx playwright test` в рабочем checkout намеренно заблокирован, чтобы E2E
не мог случайно изменить локальную или восстановленную базу.

Для полного прогона нужны Node.js 20+, `uv`, `rsync` и Chromium Headless Shell
точной версии из `e2e/package-lock.json` (`cd e2e && npm ci && npx playwright
install --only-shell chromium`).

Только бэкенд, без Docker и без Playwright:

```sh
cd backend
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q tests
```

Набор узкий и держит то, что ломается тихо:

- **ни один GET-маршрут не отдаёт данные анониму.** Перечисляются ВСЕ маршруты приложения,
  а не выбранный список: маршрут, добавленный завтра без защиты, уронит тест сам. Публичны
  только `/`, `/health` и документация — а она в проде выключается.
- **вход ограничен по частоте** (5 попыток в минуту), неверный пароль отклоняется;
- **мутация без заголовка `X-CSRF-Token` отклоняется** даже при наличии кук;
- **боевой конфиг падает громко, а не поднимается тихо:** пустой или короткий `SECRET_KEY`,
  `localhost` в `CORS_ORIGINS` — отказ на старте. Раньше `SECRET_KEY` генерировался заново
  на каждом рестарте: сессии слетали у всех, а старые токены оказывались подписаны чужим
  секретом. В проде `COOKIE_SECURE` включается, Swagger закрывается — тест это фиксирует.

> Бэкенд рассчитан на **Python 3.12**. Пины (`pydantic==2.9.2`, `fastapi==0.115.0`) не
> собираются на 3.14 — `pydantic-core` не строится под новый PyO3.

## Безопасность

```sh
bash scripts/security-scan.sh
```

Делает 5 проверок:
1. **bandit** — SAST Python-кода
2. **pip-audit** — CVE в Python-зависимостях
3. **npm audit** — CVE в Node-зависимостях (backend/frontend)
4. **detect-secrets** — пароли/токены в коде
5. **default-password check** — активны ли seed-пароли `admin/admin` в проде

Встроенные security-меры:
- argon2 для паролей + прозрачная миграция со старых SHA-256
- JWT в **httpOnly cookie** + SameSite=Lax + Secure в проде
- security headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS (при HTTPS)
- CSP в nginx.prod.conf (`default-src 'self'`, `frame-ancestors 'none'`)
- rate-limit на `/auth/login` в backend + nginx `limit_req`
- RBAC на уровне роутов: `require_admin`, `require_manager`
- audit log на все мутации
- non-root user в Dockerfile + `NoNewPrivileges`, `ProtectSystem=strict` в systemd
- `.env` + `deploy/certs/` в `.gitignore`

## Production деплой

См. `deploy/README.md` — два варианта:

### Вариант 1 — Docker Compose (рекомендую)

```sh
cp .env.example .env

# Сгенерировать секреты:
python3 -c "import secrets; print('SECRET_KEY=' + secrets.token_hex(64))"   >> .env
python3 -c "import secrets; print('POSTGRES_PASSWORD=' + secrets.token_urlsafe(32))" >> .env
python3 -c "import secrets; print('INITIAL_ADMIN_PASSWORD=' + secrets.token_urlsafe(16))" >> .env
# Отредактировать .env — выставить ENV=production, CORS_ORIGINS, CLUB_NAME

sudo certbot certonly --standalone -d your-domain.com
cp /etc/letsencrypt/live/your-domain.com/*.pem deploy/certs/

docker compose up -d --build
docker compose exec backend alembic upgrade head
```

Первый вход — логин `admin` / `INITIAL_ADMIN_PASSWORD` из `.env` → форма
обязательной смены пароля.

### Миграция данных SQLite → Postgres

Если у вас уже накоплены данные в SQLite:

```sh
# В контейнере или локально через venv:
SOURCE_SQLITE=/data/golf.db \
DEST_POSTGRES=postgresql+psycopg://golf:PASSWORD@localhost:5432/golf \
python scripts/migrate_sqlite_to_postgres.py
```

Скрипт отказывается работать, если в Postgres-таблицах уже есть данные —
сбрасывает только в свежесозданную базу.

### Вариант 2 — systemd + nginx (bare-metal)

См. `deploy/README.md` (полный гайд с командами).

## Что умеет CRM (вернул все фичи старой Flask-версии)

**Дашборд**: броней сегодня/неделя/месяц, выручка, RevPATT, no-show, отмены, 
тепловая карта (день недели × час), booking pace (30 дней), выручка по 
категориям, топ-5 дней, утилизация ресурсов.

**Tee-sheet grid** (30-минутные слоты × все ресурсы × день) + **Calendar 
timeline** (timeline по ресурсам с drag-drop переносом).

**Брони**: создание, статус-переходы (`confirmed → checked_in → completed`, 
`cancelled`, `no_show`), перенос (с проверкой конфликтов), оплата, drawer с 
историей аудита.

**Клиенты**: CRUD, поиск по ФИО/телефону/email, машина, заметки, согласие на 
маркетинг.

**Каталог**: услуги (по категориям), тренеры (со специализациями / ресурсами / 
override-ценами / working hours), ресурсы (по зонам, совместимые услуги), 
тарифы членства, специализации. Preview каскадного изменения цены услуги 
(«повлияет на N будущих броней, ±X ₽»).

**Администрирование** (роль `admin`):
- CRUD сотрудников с ролями `admin`/`manager`/`accounting`/`staff`
- Журнал изменений с фильтром по сущности и действию
- Настройки (сезон: auto / summer / winter)

**Глобальный поиск** (⌘K / Ctrl+K): брони по ID, клиенты, тренеры, услуги.

## Стек

| Слой | Технологии |
|------|------------|
| Backend | FastAPI 0.115, SQLAlchemy 2.0, Pydantic 2, python-jose, argon2-cffi, gunicorn + uvicorn workers |
| Frontend | React 18, Vite 5, TypeScript 5, Tailwind 3, TanStack Query 5, React Router 7, lucide-react |
| E2E | Playwright 1.59 (Chromium Headless Shell) |
| DB | SQLite (разработка) / PostgreSQL (production-ready через `DATABASE_URL`) |
| Ops | Docker + Compose, nginx или Caddy, Postgres backup service, systemd/certbot для bare-metal |
| Security tooling | bandit, pip-audit, npm audit, detect-secrets |
