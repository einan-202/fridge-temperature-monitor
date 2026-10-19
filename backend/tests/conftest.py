"""Shared pytest fixtures."""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    """A FastAPI TestClient wrapping the app, for request-level tests."""
    return TestClient(app)
