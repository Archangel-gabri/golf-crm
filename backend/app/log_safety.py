"""Персональные данные не должны попадать в журналы доступа.

Поиск клиентов ходит как `GET /customers?q=<имя или телефон>`, и uvicorn пишет
этот адрес в access log целиком. Фильтр оставляет метод, путь и статус, а у query
string сохраняет безопасные имена параметров и заменяет значения на маску: видно, что был
поиск, но не по кому.
"""
from __future__ import annotations

import logging
import re
from urllib.parse import parse_qsl

MASK = "[скрыто]"
_ACCESS_LOGGERS = ("uvicorn.access", "gunicorn.access")
# Имя параметра тоже приходит от клиента: в журнал идёт только безопасное, иначе маркер.
_SAFE_NAME = re.compile(r"[A-Za-z0-9_.-]{1,40}")
BAD_NAME = "[имя скрыто]"
# Запасной путь, если формат записи изменится: любой «путь?query» в готовой строке.
_QUERY_IN_TEXT = re.compile(r'(?P<path>/[^\s"?]*)\?(?P<query>[^\s"]*)')


def redact_target(target: str) -> str:
    """`/customers?q=Иван&limit=5` -> `/customers?q=[скрыто]&limit=[скрыто]`."""
    path, sep, query = target.partition("?")
    if not sep:
        return target
    names = [name for name, _ in parse_qsl(query, keep_blank_values=True)]
    if not names:
        return path + "?" + MASK
    shown = [name if _SAFE_NAME.fullmatch(name) else BAD_NAME for name in names]
    return path + "?" + "&".join(f"{name}={MASK}" for name in shown)


class RedactQueryFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        # uvicorn.access: '%s - "%s %s HTTP/%s" %d' -> (client, method, full_path, version, status)
        if isinstance(args, tuple) and len(args) == 5 and isinstance(args[2], str):
            record.args = (args[0], args[1], redact_target(args[2]), args[3], args[4])
            return True
        message = record.getMessage()
        record.msg = _QUERY_IN_TEXT.sub(
            lambda m: redact_target(m.group("path") + "?" + m.group("query")), message
        )
        record.args = None
        return True


def install_access_log_redaction() -> None:
    for name in _ACCESS_LOGGERS:
        logger = logging.getLogger(name)
        if not any(isinstance(f, RedactQueryFilter) for f in logger.filters):
            logger.addFilter(RedactQueryFilter())
