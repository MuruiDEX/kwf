"""Admin panel endpoints: users directory access matrix + request flow."""
from tests.db import client


def _login(email, password):
    r = client.post('/api/auth/login', json={'email': email, 'password': password})
    assert r.status_code == 200, r.text


def _register(email, role):
    r = client.post('/api/auth/register', json={
        'email': email, 'password': 'test12345', 'full_name': 'T', 'role': role})
    assert r.status_code == 200, r.text


def test_admin_users_access_matrix():
    # guest
    client.cookies.clear()
    assert client.get('/api/admin/users').status_code == 401
    # athlete
    _register('adm_u1@kwf.org', 'athlete')
    _login('adm_u1@kwf.org', 'test12345')
    assert client.get('/api/admin/users').status_code == 403
    # coach (organizer-like but not admin)
    _register('adm_u2@kwf.org', 'coach')
    _login('adm_u2@kwf.org', 'test12345')
    assert client.get('/api/admin/users').status_code == 403


def test_admin_users_lists_and_filters():
    _register('adm_admin@kwf.org', 'athlete')
    # promote via request flow is organizer-only-approve; use direct admin seed instead:
    # create admin through register is rejected, so use existing helper: none — use login as admin
    # created in another test module? isolated DB: register users then check admin path via fresh admin:
    import tests.db as tdb
    from app.models.user import User
    from app.core.security import hash_password
    db = tdb.TestSession()
    db.add(User(email='root@kwf.org', password_hash=hash_password('root12345'), full_name='Root', role='admin'))
    db.commit()
    db.close()
    _login('root@kwf.org', 'root12345')
    r = client.get('/api/admin/users')
    assert r.status_code == 200
    rows = r.json()["items"]
    assert any(u['email'] == 'adm_u1@kwf.org' for u in rows)
    assert all('password' not in u and 'password_hash' not in u for u in rows)
    # filters
    assert client.get('/api/admin/users?role=athlete').json()["items"]
    assert all(u['role'] == 'athlete' for u in client.get('/api/admin/users?role=athlete').json()["items"])
    assert any(u['email'] == 'adm_u1@kwf.org' for u in client.get('/api/admin/users?q=adm_u1').json()["items"])
