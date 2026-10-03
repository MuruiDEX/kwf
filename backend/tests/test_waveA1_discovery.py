"""Wave A1: public discovery filters + scoped search (additive, no migrations)."""
from tests.db import client
from tests.test_p2 import auth_headers


def _mk_tournaments(org):
    ids = {}
    ids["almaty_upcoming"] = client.post("/api/tournaments", json={
        "name": "A1 Almaty Cup", "city": "Almaty", "country": "KZ",
        "start_date": "2026-10-10"}, headers=org).json()["id"]
    ids["astana_reg"] = client.post("/api/tournaments", json={
        "name": "A1 Astana Open", "city": "Astana", "country": "KZ",
        "start_date": "2026-11-11", "status": "registration"}, headers=org).json()["id"]
    ids["almaty_fin"] = client.post("/api/tournaments", json={
        "name": "A1 Almaty Old", "city": "Almaty", "country": "KZ",
        "start_date": "2025-01-01"}, headers=org).json()["id"]
    # move third to finished via legal transitions: registration -> live needs bracket,
    # so instead test grouping/date only on first two; keep third upcoming but old date.
    return ids


def test_tournaments_city_filter():
    org = auth_headers()
    _mk_tournaments(org)
    r = client.get("/api/tournaments?city=Almaty").json()
    assert r["total"] >= 2
    assert all(t["city"] == "Almaty" for t in r["items"])
    # case-insensitive substring
    r2 = client.get("/api/tournaments?city=alma").json()
    assert r2["total"] >= 2


def test_tournaments_grouped_upcoming_status():
    org = auth_headers()
    _mk_tournaments(org)
    r = client.get("/api/tournaments?status=upcoming").json()
    statuses = {t["status"] for t in r["items"]}
    assert statuses <= {"upcoming", "registration"}
    assert "upcoming" in statuses and "registration" in statuses


def test_tournaments_date_range():
    org = auth_headers()
    _mk_tournaments(org)
    r = client.get("/api/tournaments?date_from=2026-10-01&date_to=2026-10-31").json()
    assert r["total"] >= 1
    assert all("2026-10-01" <= t["start_date"] <= "2026-10-31" for t in r["items"])
    bad = client.get("/api/tournaments?date_from=not-a-date")
    assert bad.status_code == 400


def test_search_backward_compatible_shape():
    # Old consumers call /api/search?q=xx and expect athletes+clubs keys.
    r = client.get("/api/search?q=Almaty")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "athletes" in body and "clubs" in body
    assert "tournaments" in body  # additive key, old clients ignore it


def test_search_scope_and_min_length():
    # q < 2 chars -> empty sections (no full-table scan)
    r = client.get("/api/search?q=a").json()
    assert r == {"athletes": [], "clubs": [], "tournaments": []}
    # scope limiting works
    r2 = client.get("/api/search?q=Almaty&scope=tournaments").json()
    assert r2["athletes"] == [] and r2["clubs"] == []
    assert isinstance(r2["tournaments"], list)


def test_search_tournaments_found_and_escaped():
    org = auth_headers()
    _mk_tournaments(org)
    r = client.get("/api/search?q=Almaty&scope=tournaments").json()
    assert any("Almaty" in t["name"] for t in r["tournaments"])
    # LIKE wildcards are literal (escape_like), must not blow up or match-all
    r2 = client.get("/api/search?q=%_%&scope=tournaments").json()
    assert isinstance(r2["tournaments"], list)
    # limit cap enforced by validation (50 max is ok, 51+ clamped not 422;
    # FastAPI Query has no cap here — backend clamps; just check it works)
    r3 = client.get("/api/search?q=Almaty&limit=50").json()
    assert len(r3["tournaments"]) <= 50


def test_public_cities_and_organizers():
    org = auth_headers()
    _mk_tournaments(org)
    c = client.get("/api/public/cities").json()
    assert "items" in c and any(i["city"] == "Almaty" for i in c["items"])
    assert all(set(i) == {"city", "count"} for i in c["items"])
    o = client.get("/api/public/organizers").json()
    assert "items" in o and isinstance(o["items"], list)
    # no PII: only name+tournaments keys
    assert all(set(i) == {"name", "tournaments"} for i in o["items"])
