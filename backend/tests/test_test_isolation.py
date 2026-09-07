"""Adversarial subprocess checks; they never open the inherited database URL."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


BACKEND = Path(__file__).resolve().parents[1]


def test_isolation_rejects_preimported_app_modules():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import runpy, sys, types; "
            "sys.modules['app.db'] = types.ModuleType('app.db'); "
            "runpy.run_path('tests/conftest.py')",
        ],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode != 0, "preloaded app could already own a non-test engine"
    assert "before test isolation" in result.stderr


def test_standalone_pytest_configuration_owns_its_database(tmp_path):
    env = dict(os.environ)
    env.update(
        ENV="production",
        DATABASE_URL="postgresql://never-connect.invalid/ambient-sentinel",
        SECRET_KEY="s" * 64,
        TMPDIR=str(tmp_path),
    )
    env.pop("GOLF_TEST_ISOLATED", None)
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import json, os, pathlib, runpy
runpy.run_path('tests/conftest.py')
url = os.environ.get('DATABASE_URL', '')
database = pathlib.Path(url[len('sqlite:///'):]) if url.startswith('sqlite:///') else None
print(json.dumps({
    'local': os.environ.get('ENV') == 'local',
    'owned': bool(database and database.parent.is_dir()
                  and database.parent.name.startswith('golf-pytest-')),
    'isolated': os.environ.get('GOLF_TEST_ISOLATED') == '1',
}))
""",
        ],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
        check=True,
    )
    assert json.loads(result.stdout) == {"local": True, "owned": True, "isolated": True}
    assert not list(tmp_path.glob("golf-pytest-*")), "owned DB directory must be cleaned at exit"


def test_isolated_settings_do_not_read_parent_dotenv(tmp_path):
    # BASE_DIR.parent is deliberately a hostile test-owned directory. Never write
    # /tmp/.env or import app.main: this fixture only constructs Settings.
    app = tmp_path / "workspace" / "backend" / "app"
    app.mkdir(parents=True)
    shutil.copy2(BACKEND / "app" / "config.py", app / "config.py")
    (tmp_path / ".env").write_text("CLUB_NAME=HOSTILE_PARENT_SENTINEL\n", encoding="utf8")
    env = dict(os.environ)
    env.update(
        ENV="local",
        DATABASE_URL="sqlite:///:memory:",
        SECRET_KEY="s" * 64,
        GOLF_TEST_ISOLATED="1",
    )
    env.pop("CLUB_NAME", None)
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from app.config import settings; "
            "print(settings.CLUB_NAME == 'HOSTILE_PARENT_SENTINEL')",
        ],
        cwd=app.parent,
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
        check=True,
    )
    assert result.stdout.strip() == "False", "isolated settings must not read ancestor dotenv"
