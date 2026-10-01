import pytest
from app.core.ratelimit import reset

@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    reset()
    yield
    reset()
