# Golf CRM

CRM гольф-клуба: бронирования, клиенты, услуги, тренеры, абонементы и аналитика.
Общие правила и защита данных — [корневой CLAUDE.md](../../CLAUDE.md).

## Источники и устройство

- [README.md](README.md) — рабочие команды, функции и границы тестов.
- [.proeb/project.json](.proeb/project.json) — ручной паспорт; context-pack рядом — исторический generated-снимок, не текущий контракт.
- `backend/app/` — FastAPI, SQLAlchemy, Pydantic; `backend/tests/` — pytest. Проверенный Python: 3.12.
- `frontend/src/` — React, TypeScript, Vite; зависимости и версия Node задаются `frontend/package.json` и lockfile.
- `e2e/` — Playwright; `deploy/` — инструкции эксплуатации, не разрешение на деплой.

## Проверка изменений

Из корня Golf: `bash scripts/test.sh` — полный локальный gate в отдельной временной копии.
Frontend/E2E зависимости ставятся по lockfile, Python — из requirements-файлов. Runner использует свежие synthetic SQLite-базы и исключает `.env`, базы, dumps, backups и node_modules исходного checkout.
Фильтры Playwright и непустой `PYTEST_ADDOPTS` отклоняются; для полного прогона: `env -u PYTEST_ADDOPTS bash scripts/test.sh`.
На 2026-09-07 независимо пройдены: 6 wrapper, 12 backend, 4 lint-регрессии, ESLint, TypeScript/Vite и 19 Chromium E2E.
Это не доказательство всех экранов, production-сервера или произвольной изоляции host startup hooks; предупреждения backend и размера bundle остаются.
Прямой запуск Playwright в рабочем checkout запрещён обвязкой. Не обходить изоляционный guard ради теста.
Рабочий node_modules может расходиться с lockfile; результат старой установки не доказывает совместимость объявленных зависимостей.

## Данные и эксплуатация

- Не открывать и не перезаписывать реальные `golf.db`, dumps/backups или production-БД для обычных проверок кода.
- Деплой, миграции и восстановление данных — отдельная задача с подтверждённой целью и точными путями.
- Адреса доступа и секреты не копировать в исходники/отчёты. Приватные указатели — в базе владельца, значения — только в хранилище секретов.
- Перед изменением TLS читать [deploy/README.md](deploy/README.md); локальная сборка не проверяет продление сертификата на сервере.
- Править канонические исходники и README; не редактировать generated context-pack вручную и не обновлять его без проверки входных источников.
