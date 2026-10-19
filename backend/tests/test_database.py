"""Integration tests for real database connectivity.

These require a live, reachable `db` service and are marked
`@pytest.mark.integration` so they can be run/excluded selectively:

    docker compose exec backend pytest                     # everything
    docker compose exec backend pytest -m integration       # just these
    docker compose exec backend pytest -m "not integration" # unit only
"""

import pytest

from app.database import check_connection


@pytest.mark.integration
def test_check_connection_succeeds_against_real_database():
    assert check_connection() is True


@pytest.mark.integration
def test_health_endpoint_reports_connected_against_real_database(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "connected"}
