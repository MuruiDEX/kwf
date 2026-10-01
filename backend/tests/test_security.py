"""Security tests (§30): rate limiting, upload validation, security headers."""
from tests.test_p2 import client, auth_headers, make_tournament
from app.core.ratelimit import reset

def test_auth_rate_limit():
    reset()
    # 10 bad logins allowed, 11th rejected with human-readable 429
    for _ in range(10):
        r = client.post("/api/auth/login", json={"email": "nobody@x.org", "password": "wrong"})
        assert r.status_code == 401
    r = client.post("/api/auth/login", json={"email": "nobody@x.org", "password": "wrong"})
    assert r.status_code == 429
    assert "Подождите" in r.json()["detail"]
    reset()

def test_security_headers():
    r = client.get("/api/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"

def test_import_validation():
    org = auth_headers()
    tid, cat = make_tournament(org, name="P4 Import Cup")
    # wrong extension rejected
    r = client.post(f"/api/tournaments/{tid}/registrations/import", headers=org,
                    files={"file": ("evil.exe", b"MZ...", "application/octet-stream")})
    assert r.status_code == 400
    # oversize rejected
    big = b"first_name,last_name\n" + b"A,B\n" * 100
    r = client.post(f"/api/tournaments/{tid}/registrations/import", headers=org,
                    files={"file": ("big.csv", big * 60000, "text/csv")})
    assert r.status_code == 413
    # too many rows rejected
    many = "first_name,last_name,category_id\n" + "A,B,1\n" * 2001
    r = client.post(f"/api/tournaments/{tid}/registrations/import", headers=org,
                    files={"file": ("many.csv", many.encode(), "text/csv")})
    assert r.status_code == 413
    # valid CSV still works
    ok_csv = f"first_name,last_name,gender,birth_year,weight_kg,category_id\nSec,Good,male,2001,68,{cat}\n"
    r = client.post(f"/api/tournaments/{tid}/registrations/import", headers=org,
                    files={"file": ("ok.csv", ok_csv.encode(), "text/csv")})
    assert r.json()["imported"] == 1, r.text
