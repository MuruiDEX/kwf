"""P0 regression tests: CategoryIn defaults valid, category creation without explicit weights."""
import tests.db as tdb
from tests.db import client
from app.models.user import User
from app.core.security import hash_password


def test_category_defaults_valid():
    from app.schemas.api import CategoryIn
    c = CategoryIn(name='Men -70kg')
    assert c.weight_max <= 500
    assert c.weight_min <= c.weight_max


def test_create_category_without_weights():
    db = tdb.TestSession()
    if not db.query(User).filter_by(email='p0org@kwf.org').first():
        db.add(User(email='p0org@kwf.org', password_hash=hash_password('pw123456'),
                    full_name='P0 Org', role='organizer'))
        db.commit()
    db.close()
    r = client.post('/api/auth/login', json={'email': 'p0org@kwf.org', 'password': 'pw123456'})
    assert r.status_code == 200, r.text
    t = client.post('/api/tournaments', json={'name': 'P0 Cup', 'start_date': '2026-12-01'})
    assert t.status_code == 200, t.text
    tid = t.json()['id']
    c = client.post(f'/api/tournaments/{tid}/categories', json={'name': 'Men -70kg'})
    assert c.status_code == 200, c.text
    assert c.json()['id']
