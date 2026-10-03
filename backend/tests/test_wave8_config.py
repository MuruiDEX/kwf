"""Wave 8: production config fail-fast + health DB status."""
import subprocess
import sys

from tests.db import client


def _config_exit(env: dict) -> int:
    code = ("import os;"
            "os.environ.update(__import__('json').loads('%s'));"
            "import app.core.config" % __import__("json").dumps(env))
    return subprocess.run([sys.executable, "-c", code],
                          cwd=".", capture_output=True).returncode


def test_health_reports_db():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "db": True}


def test_prod_rejects_default_and_short_secrets():
    base = {"ENV": "prod", "DATABASE_URL": "sqlite://"}
    assert _config_exit({**base, "JWT_SECRET": "change-me-in-env"}) != 0
    assert _config_exit({**base, "JWT_SECRET": "dev-only-override-me-in-production-32plus"}) != 0
    assert _config_exit({**base, "JWT_SECRET": "short-16-bytes!!"}) != 0
    assert _config_exit({**base, "JWT_SECRET": "x" * 32}) == 0


def test_dev_allows_defaults():
    assert _config_exit({"JWT_SECRET": "change-me-in-env"}) == 0
