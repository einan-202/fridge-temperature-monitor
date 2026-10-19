"""Unit tests for GET /health.

These tests monkeypatch `check_connection` so they never touch a real
database — they only verify the endpoint's status code / body shape for
each outcome. See test_database.py for the real-DB integration tests.
"""

from app.routers import health


def test_health_ok_when_database_connected(client, monkeypatch):
    monkeypatch.setattr(health, "check_connection", lambda: True)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "connected"}


def test_health_returns_503_when_database_unreachable(client, monkeypatch):
    monkeypatch.setattr(health, "check_connection", lambda: False)

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {"status": "error", "database": "unreachable"}
