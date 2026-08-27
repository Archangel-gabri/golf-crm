"""Что должно быть верно всегда, иначе CRM пускает чужого.

Эти проверки писались против живого приложения, а не против предполагаемого
поведения: каждая из них ловила бы настоящий регресс в аутентификации.
"""
from __future__ import annotations


# Единственные маршруты, которым можно отвечать анониму. Всё остальное —
# бизнес-данные клуба. Список намеренно закрытый: новый публичный маршрут
# придётся вписать сюда руками, то есть осознанно.
PUBLIC = {"/", "/health", "/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"}


def _get_routes(app):
    return sorted(
        {
            r.path
            for r in app.routes
            if hasattr(r, "path")
            and "GET" in getattr(r, "methods", set())
            and "{" not in r.path
        }
    )


def test_every_non_public_get_rejects_anonymous(client):
    """Ни один бизнес-маршрут не отдаёт данные без сессии.

    Проверяются ВСЕ GET-маршруты приложения, а не выбранный список: маршрут,
    добавленный завтра без защиты, уронит этот тест сам.
    """
    from app.main import app

    leaked = []
    for path in _get_routes(app):
        if path in PUBLIC:
            continue
        code = client.get(path).status_code
        if code not in (401, 403, 404, 405):
            leaked.append((path, code))
    assert not leaked, f"маршруты отдали данные анониму: {leaked}"


def test_public_routes_stay_reachable(client):
    """Здоровье и корень не должны случайно уехать под авторизацию."""
    for path in ("/", "/health"):
        assert client.get(path).status_code == 200, f"{path} недоступен"


def test_login_rejects_wrong_password(client):
    r = client.post("/auth/login", json={"username": "admin", "password": "totally-wrong"})
    assert r.status_code in (400, 401, 403)


def test_login_is_rate_limited(client):
    """Подбор пароля упирается в ограничение частоты, а не в бесконечность.

    Лимит — 5 попыток в минуту на ключ (app/rate_limit.py). Восьми хватает,
    чтобы увидеть 429, не завися от точного порога.
    """
    codes = [
        client.post("/auth/login", json={"username": "admin", "password": f"nope-{i}"}).status_code
        for i in range(8)
    ]
    assert 429 in codes, f"ограничение не сработало: {codes}"


def test_mutation_without_csrf_header_is_rejected(client):
    """Двойная кука без заголовка X-CSRF-Token не проходит."""
    r = client.post(
        "/customers",
        json={"name": "csrf-probe"},
        cookies={"golf_session": "fake", "golf_csrf": "abc"},
    )
    assert r.status_code in (401, 403)
