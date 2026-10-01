"""P1: Alembic baseline is non-destructive and matches create_all schema."""
import sqlalchemy as sa
from sqlalchemy import create_engine, inspect, text


def _upgrade(url: str) -> None:
    from alembic import command
    from alembic.config import Config
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")


def _schema_snapshot(url: str) -> dict:
    eng = create_engine(url)
    out = {}
    for t in sorted(inspect(eng).get_table_names()):
        if t == "alembic_version":
            continue
        out[t] = sorted(c["name"] for c in inspect(eng).get_columns(t))
    eng.dispose()
    return out


def test_baseline_matches_create_all_schema(tmp_path):
    """Fresh upgrade head produces exactly the create_all schema."""
    import app.models.user, app.models.club_athlete, app.models.tournament  # noqa
    import app.models.competition, app.models.misc  # noqa
    from app.core.db import Base

    ref_url = f"sqlite:///{tmp_path}/ref.db"
    Base.metadata.create_all(bind=create_engine(ref_url))
    mig_url = f"sqlite:///{tmp_path}/mig.db"
    _upgrade(mig_url)
    assert _schema_snapshot(mig_url) == _schema_snapshot(ref_url)


def test_upgrade_legacy_db_keeps_data(tmp_path):
    """Legacy DB (pre-P1 columns, with rows) upgrades without data loss."""
    url = f"sqlite:///{tmp_path}/legacy.db"
    eng = create_engine(url)
    with eng.begin() as c:
        c.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(255), "
                       "password_hash VARCHAR(255), full_name VARCHAR(255), role VARCHAR(32), "
                       "is_active BOOLEAN, created_at DATETIME)"))
        c.execute(text("INSERT INTO users (id, email, password_hash, full_name, role, is_active) "
                       "VALUES (7, 'legacy@kwf.org', 'x', 'Legacy', 'organizer', 1)"))
        c.execute(text("CREATE TABLE clubs (id INTEGER PRIMARY KEY, name VARCHAR(255), country VARCHAR(64), "
                       "city VARCHAR(128), coach_name VARCHAR(255), created_at DATETIME)"))
        c.execute(text("INSERT INTO clubs (id, name) VALUES (3, 'Legacy Club')"))
    eng.dispose()
    _upgrade(url)
    eng = create_engine(url)
    with eng.connect() as c:
        assert c.execute(text("SELECT email FROM users WHERE id=7")).scalar() == "legacy@kwf.org"
        assert c.execute(text("SELECT name FROM clubs WHERE id=3")).scalar() == "Legacy Club"
        cols = {r["name"] for r in inspect(eng).get_columns("clubs")}
        assert "owner_id" in cols
        assert {r["name"] for r in inspect(eng).get_columns("athletes")} >= {"created_by"}
        assert "strict_eligibility" in {r["name"] for r in inspect(eng).get_columns("tournaments")}
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar() == "0006_p2_hot_indexes"
        assert "user_permissions" in inspect(eng).get_table_names()
        idx = {i["name"] for i in inspect(eng).get_indexes("bracket_matches")}
        assert {"ix_bracket_round_pos", "ix_bracket_status"} <= idx
    eng.dispose()
    # idempotent: second upgrade is a no-op
    _upgrade(url)
    eng = create_engine(url)
    with eng.connect() as c:
        assert c.execute(text("SELECT email FROM users WHERE id=7")).scalar() == "legacy@kwf.org"
    eng.dispose()
