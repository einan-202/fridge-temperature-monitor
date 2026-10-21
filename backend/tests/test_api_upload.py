"""Integration tests for POST /api/uploads/review and /api/uploads/import."""

from __future__ import annotations

import io
import json
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

import openpyxl
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

from app.deps import get_db
from app.main import app
from app.models import Fridge, Logger, LoggerAssignment, TemperatureReading
from app.seed import SAMPLE_LOGGER_UNITS, seed_sample, SAMPLE_DIR, find_sample_file
from app.upload import HISTORICAL_LOGGER_UNITS

pytestmark = pytest.mark.integration

COMBINED = ["Logger", "Branch", "Fridge", "Time", "Temp"]
TABLES = ("fridges", "loggers", "logger_assignments", "temperature_readings")


def make_xlsx_bytes(header, rows) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(header)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def make_xlsx_path(tmp_path, header, rows, name="file.xlsx") -> Path:
    path = tmp_path / name
    path.write_bytes(make_xlsx_bytes(header, rows))
    return path


def counts(session):
    return {
        model.__tablename__: session.scalar(select(func.count()).select_from(model))
        for model in (Fridge, Logger, LoggerAssignment, TemperatureReading)
    }


def application_tables(session) -> set[str]:
    rows = session.execute(
        text(
            "SELECT tablename FROM pg_tables "
            "WHERE schemaname = 'public' AND tablename NOT IN "
            "('alembic_version')"
        )
    ).all()
    return {r[0] for r in rows}


@pytest.fixture
def api_client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_db] = override
    with TestClient(app) as client:
        yield client, db_session
    app.dependency_overrides.clear()


@pytest.fixture(scope="module")
def sample_path():
    if not list(SAMPLE_DIR.glob("*.xlsx")):
        pytest.skip(f"no .xlsx sample file in {SAMPLE_DIR}")
    return find_sample_file()


def _post(client, path, *, mode="weekly", files=None, file=None, **fields):
    data = {"mode": mode}
    for key, value in fields.items():
        if value is None:
            continue
        data[key] = value if isinstance(value, str) else json.dumps(value)
    upload_files = []
    if file is not None:
        filename, content = file
        upload_files.append(("file", (filename, content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")))
    for item in files or []:
        filename, content = item
        upload_files.append(
            ("files", (filename, content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
        )
    return client.post(path, data=data, files=upload_files or None)


def _seed(session, sample_path):
    seed_sample(session, sample_path)
    session.flush()


# ===========================================================================
# Review is a genuine dry run
# ===========================================================================


def test_review_writes_nothing_historical(api_client, tmp_path):
    client, session = api_client
    content = make_xlsx_bytes(
        COMBINED,
        [["TL-1", "Tel Aviv", "Walk-in", "2026-09-14 06:00", 4.0]],
    )
    before = counts(session)
    response = _post(
        client,
        "/api/uploads/review",
        mode="historical",
        file=("hist.xlsx", content),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["dry_run"] is True
    assert body["files"][0]["status"] == "ready"
    assert body["files"][0]["inserted"] == 1
    assert counts(session) == before == {
        "fridges": 0,
        "loggers": 0,
        "logger_assignments": 0,
        "temperature_readings": 0,
    }


def test_historical_rejects_fahrenheit_header_for_celsius_logger(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    content = make_xlsx_bytes(
        ["Logger", "Branch", "Fridge", "Time", "Temp F"],
        [["TL-0512", "Jerusalem", "Dairy", "2026-09-14 16:00", 39]],
    )
    body = _post(
        client, "/api/uploads/review", mode="historical", file=("h.xlsx", content)
    ).json()
    assert body["files"][0]["status"] == "invalid"
    assert "indicates F" in body["files"][0]["message"]


def test_review_writes_nothing_weekly_with_staged_move_and_new_logger(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    before = counts(session)
    fridge = session.scalars(select(Fridge)).first()
    content = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 07:00", 4.2]])
    response = _post(
        client,
        "/api/uploads/review",
        mode="weekly",
        files=[("new_logger.xlsx", content)],
        selections={"0": "new:TL-9999"},
        new_loggers=[{"code": "TL-9999", "unit": "C", "fridge_id": fridge.id}],
        moves=[
            {
                "logger_id": session.scalars(select(Logger).where(Logger.code == "TL-0417")).one().id,
                "fridge_id": fridge.id,
                "effective_at": "2026-09-17 06:00",
            }
        ],
    )
    assert response.status_code == 200
    assert response.json()["dry_run"] is True
    assert counts(session) == before
    assert session.scalars(select(Logger).where(Logger.code == "TL-9999")).first() is None


# ===========================================================================
# Historical mode
# ===========================================================================


def _historical_3000_rows():
    """Synthetic ~3,000-row combined file covering units, ERR, and several fridges."""
    rows = []
    base = datetime(2026, 8, 1, 0, 0)
    # TL-0231 Haifa F, TL-0388 Rishon C, TL-0417 two fridges, TL-0512 Jerusalem,
    # plus a new non-Haifa and (optionally) a new Haifa for separate tests.
    specs = [
        ("TL-0231", "Haifa", "Dairy", 38.0),  # F
        ("TL-0388", "Rishon LeZion", "Cream cakes", 4.0),
        ("TL-0417", "Tel Aviv", "Walk-in", 4.1),
        ("TL-0417", "Tel Aviv", "Display 2", 3.7),
        ("TL-0512", "Jerusalem", "Dairy", 3.8),
        ("TL-0600", "Ashdod", "Dairy", 4.2),  # new non-Haifa → default C
    ]
    for i in range(500):
        for code, branch, fridge, temp in specs:
            t = base + timedelta(minutes=15 * i)
            rows.append(
                [
                    code,
                    branch,
                    fridge,
                    t.strftime("%Y-%m-%d %H:%M"),
                    "ERR" if i == 10 and code == "TL-0231" else temp,
                ]
            )
    assert len(rows) == 3000
    return rows


def test_historical_review_then_import_approx_3000(api_client):
    client, session = api_client
    content = make_xlsx_bytes(COMBINED, _historical_3000_rows())
    before = counts(session)

    review = _post(client, "/api/uploads/review", mode="historical", file=("hist.xlsx", content))
    assert review.status_code == 200
    rev = review.json()
    assert rev["dry_run"] is True
    assert counts(session) == before
    assert rev["files"][0]["inserted"] > 0

    units = {u["code"]: u for u in rev["logger_units"]}
    assert units["TL-0231"]["unit"] == "F" and units["TL-0231"]["source"] == "known"
    assert units["TL-0600"]["unit"] == "C" and units["TL-0600"]["source"] == "default"

    imported = _post(client, "/api/uploads/import", mode="historical", file=("hist.xlsx", content))
    assert imported.status_code == 200
    body = imported.json()
    assert body["dry_run"] is False
    assert body["files"][0]["status"] == "imported"
    assert body["files"][0]["inserted"] == rev["files"][0]["inserted"]
    assert body["historical"]["inserted"] == rev["historical"]["inserted"]

    tl = session.scalars(select(Logger).where(Logger.code == "TL-0231")).one()
    assert tl.unit == "F"
    f_reading = session.scalars(
        select(TemperatureReading)
        .where(TemperatureReading.logger_id == tl.id, TemperatureReading.temperature_c.is_not(None))
        .limit(1)
    ).first()
    assert f_reading is not None
    # 38 F → 3.33 C
    assert f_reading.temperature_c == Decimal("3.33")
    assert f_reading.raw_value == "38"

    assert session.scalars(select(Logger).where(Logger.code == "TL-0600")).one().unit == "C"
    assert session.scalar(select(func.count()).select_from(LoggerAssignment).where(
        LoggerAssignment.assigned_from.is_not(None)
    )) == 0


def test_historical_seed_units_agree():
    assert HISTORICAL_LOGGER_UNITS["TL-0231"] == SAMPLE_LOGGER_UNITS["TL-0231"]


def test_historical_haifa_unknown_requires_unit(api_client):
    client, session = api_client
    content = make_xlsx_bytes(
        COMBINED,
        [
            ["TL-0231", "Haifa", "Dairy", "2026-09-14 06:00", 38.3],
            ["TL-0777", "Haifa", "Dairy", "2026-09-14 06:15", 4.0],
        ],
    )
    review = _post(client, "/api/uploads/review", mode="historical", file=("h.xlsx", content)).json()
    unresolved = [u for u in review["logger_units"] if u["code"] == "TL-0777"]
    assert unresolved and unresolved[0]["source"] == "unresolved"
    assert review["blocked"] is True

    refused = _post(client, "/api/uploads/import", mode="historical", file=("h.xlsx", content))
    assert refused.status_code == 200
    assert refused.json()["blocked"] is True
    assert counts(session)["temperature_readings"] == 0

    ok = _post(
        client,
        "/api/uploads/import",
        mode="historical",
        file=("h.xlsx", content),
        logger_units={"TL-0777": "C"},
    )
    assert ok.status_code == 200
    assert ok.json()["blocked"] is False
    logger = session.scalars(select(Logger).where(Logger.code == "TL-0777")).one()
    assert logger.unit == "C"

    # Later import never asks again — existing unit is known/read-only.
    again = _post(
        client,
        "/api/uploads/review",
        mode="historical",
        file=("h.xlsx", content),
    ).json()
    info = next(u for u in again["logger_units"] if u["code"] == "TL-0777")
    assert info["source"] == "known" and info["unit"] == "C" and info["is_new"] is False


def test_historical_override_unit(api_client):
    client, session = api_client
    content = make_xlsx_bytes(
        COMBINED,
        [["TL-0888", "Jerusalem", "Dairy", "2026-09-14 06:00", 38.0]],
    )
    body = _post(
        client,
        "/api/uploads/import",
        mode="historical",
        file=("o.xlsx", content),
        logger_units={"TL-0888": "F"},
    ).json()
    assert body["files"][0]["inserted"] == 1
    logger = session.scalars(select(Logger).where(Logger.code == "TL-0888")).one()
    assert logger.unit == "F"
    reading = session.scalars(select(TemperatureReading)).one()
    assert reading.temperature_c == Decimal("3.33")


def test_historical_reimport_idempotent_and_value_conflict(api_client):
    client, session = api_client
    rows = [["TL-1", "Tel Aviv", "Walk-in", "2026-09-14 06:00", 4.0]]
    content = make_xlsx_bytes(COMBINED, rows)
    first = _post(client, "/api/uploads/import", mode="historical", file=("a.xlsx", content)).json()
    assert first["files"][0]["inserted"] == 1

    second = _post(client, "/api/uploads/import", mode="historical", file=("a.xlsx", content)).json()
    assert second["files"][0]["inserted"] == 0
    assert second["files"][0]["duplicates"] == 1

    conflict_content = make_xlsx_bytes(
        COMBINED,
        [["TL-1", "Tel Aviv", "Walk-in", "2026-09-14 06:00", 9.9]],
    )
    third = _post(
        client, "/api/uploads/import", mode="historical", file=("b.xlsx", conflict_content)
    ).json()
    assert third["files"][0]["inserted"] == 0
    assert len(third["files"][0]["conflicts"]) == 1
    kept = session.scalars(select(TemperatureReading)).one()
    assert kept.temperature_c == Decimal("4.00")


def test_historical_fridge_conflict_same_value(api_client):
    client, session = api_client
    content = make_xlsx_bytes(
        COMBINED,
        [
            ["TL-1", "Tel Aviv", "Walk-in", "2026-09-14 06:00", 4.0],
            ["TL-1", "Tel Aviv", "Display 2", "2026-09-14 06:00", 4.0],  # same value, different fridge
            ["TL-1", "Tel Aviv", "Walk-in", "2026-09-14 06:15", 4.1],
        ],
    )
    body = _post(client, "/api/uploads/import", mode="historical", file=("fc.xlsx", content)).json()
    fr = body["files"][0]
    assert fr["inserted"] == 2
    assert len(fr["fridge_conflicts"]) == 1
    assert fr["fridge_conflicts"][0]["ignored_fridge"] == "Display 2"
    row = session.execute(
        select(TemperatureReading, Fridge)
        .join(Fridge, Fridge.id == TemperatureReading.fridge_id)
        .where(TemperatureReading.measured_at == datetime(2026, 9, 14, 6, 0))
    ).one()
    assert row[1].name == "Walk-in"


def test_historical_rejected_rows_still_import_valid(api_client):
    client, session = api_client
    content = make_xlsx_bytes(
        COMBINED,
        [
            ["TL-1", "Tel Aviv", "Dairy", "2026-09-14 06:00", 4.0],
            ["TL-1", "Tel Aviv", "Dairy", "not-a-time", 4.1],
            ["TL-1", "Tel Aviv", "Dairy", "2026-09-14 06:30", 4.2],
        ],
    )
    body = _post(client, "/api/uploads/import", mode="historical", file=("r.xlsx", content)).json()
    assert body["files"][0]["inserted"] == 2
    assert body["files"][0]["rejected_total"] == 1
    assert counts(session)["temperature_readings"] == 2


def test_historical_forced_failure_rolls_back(api_client, monkeypatch):
    client, session = api_client
    content = make_xlsx_bytes(
        COMBINED,
        [["TL-1", "Tel Aviv", "Dairy", "2026-09-14 06:00", 4.0]],
    )
    before = counts(session)

    from app import upload as upload_mod

    real = upload_mod.ingest_rows

    def boom(*args, **kwargs):
        real(*args, **kwargs)
        raise RuntimeError("forced failure")

    monkeypatch.setattr(upload_mod, "ingest_rows", boom)
    with pytest.raises(RuntimeError, match="forced failure"):
        # Call through the service directly so the exception surfaces.
        from app.upload import FileUpload, import_upload
        import tempfile, os

        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, "x.xlsx")
        with open(path, "wb") as fh:
            fh.write(content)
        try:
            import_upload(
                session,
                mode="historical",
                files=[FileUpload(0, "x.xlsx", path, len(content))],
            )
        finally:
            os.remove(path)
            os.rmdir(tmp)

    session.rollback()
    assert counts(session) == before


# ===========================================================================
# Weekly mode
# ===========================================================================


def test_weekly_time_temp_resolves_from_single_undated(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    content = make_xlsx_bytes(
        ["Time", "Temp"],
        [["2026-09-14 07:00", 4.5], ["2026-09-14 07:15", 4.6]],
    )
    body = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("TL-0512_2026-09-14.xlsx", content)],
    ).json()
    fr = body["files"][0]
    assert fr["status"] == "imported"
    assert fr["logger"]["code"] == "TL-0512"
    assert fr["logger"]["source"] == "filename"
    assert fr["inserted"] == 2


def test_weekly_tl_0417_ambiguous_until_move(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    logger = session.scalars(select(Logger).where(Logger.code == "TL-0417")).one()
    display = session.scalars(
        select(Fridge).where(Fridge.branch_name == "Tel Aviv", Fridge.name == "Display 2")
    ).one()

    before_move = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 06:00", 4.0]])
    spanning = make_xlsx_bytes(
        ["Time", "Temp"],
        [["2026-09-14 06:00", 4.0], ["2026-09-17 06:00", 3.7]],
    )
    other = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 08:00", 3.9]])

    body = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[
            ("TL-0417_before.xlsx", before_move),
            ("TL-0417_span.xlsx", spanning),
            ("TL-0512_ok.xlsx", other),
        ],
        selections={"0": logger.id, "1": logger.id},  # 2 detected from name
    ).json()

    by_name = {f["filename"]: f for f in body["files"]}
    assert by_name["TL-0417_before.xlsx"]["status"] == "needs_attention"
    assert by_name["TL-0417_span.xlsx"]["status"] == "needs_attention"
    assert by_name["TL-0512_ok.xlsx"]["status"] == "imported"
    assert by_name["TL-0512_ok.xlsx"]["inserted"] == 1

    # Record move, then a file entirely after the move imports.
    after = make_xlsx_bytes(["Time", "Temp"], [["2026-09-17 06:15", 3.8]])
    body2 = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("TL-0417_after.xlsx", after)],
        selections={"0": logger.id},
        moves=[
            {
                "logger_id": logger.id,
                "fridge_id": display.id,
                "effective_at": "2026-09-17 06:00",
            }
        ],
    ).json()
    assert body2["files"][0]["status"] == "imported"
    assert body2["files"][0]["inserted"] == 1
    assert body2["moves_applied"]


def test_weekly_partial_success_and_forced_middle_failure(api_client, sample_path, monkeypatch):
    client, session = api_client
    _seed(session, sample_path)
    a = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 09:00", 4.0]])
    b = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 09:15", 4.1]])
    c = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 09:30", 4.2]])

    from app import upload as upload_mod

    real = upload_mod.process_weekly_file
    call = {"n": 0}

    def flaky(session, file, logger, logger_source, **kwargs):
        call["n"] += 1
        if call["n"] == 2:
            raise RuntimeError("forced middle failure")
        return real(session, file, logger, logger_source, **kwargs)

    monkeypatch.setattr(upload_mod, "process_weekly_file", flaky)
    body = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[
            ("TL-0512_a.xlsx", a),
            ("TL-0388_b.xlsx", b),
            ("TL-0231_c.xlsx", c),
        ],
    ).json()
    statuses = [f["status"] for f in body["files"]]
    assert statuses[0] == "imported"
    assert statuses[1] == "failed"
    assert statuses[2] == "imported"
    # First and last readings present; middle not.
    codes = {
        session.get(Logger, r.logger_id).code
        for r in session.scalars(select(TemperatureReading)).all()
        if r.measured_at >= datetime(2026, 9, 14, 9, 0)
    }
    assert "TL-0512" in codes and "TL-0231" in codes
    assert "TL-0388" not in {session.get(Logger, r.logger_id).code
                             for r in session.scalars(
                                 select(TemperatureReading).where(
                                     TemperatureReading.measured_at == datetime(2026, 9, 14, 9, 15)
                                 )
                             ).all()}


def test_weekly_moves_persist_without_importable_files(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    logger = session.scalars(select(Logger).where(Logger.code == "TL-0417")).one()
    display = session.scalars(
        select(Fridge).where(Fridge.name == "Display 2")
    ).one()
    # Ambiguous file — nothing imported, but move is saved.
    content = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 06:00", 4.0]])
    body = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("TL-0417_x.xlsx", content)],
        selections={"0": logger.id},
        moves=[
            {
                "logger_id": logger.id,
                "fridge_id": display.id,
                "effective_at": "2026-09-20 08:00",
            }
        ],
    ).json()
    assert body["files"][0]["status"] == "needs_attention"
    assert any(m["status"] == "created" for m in body["moves_applied"])
    assert session.scalar(
        select(func.count()).select_from(LoggerAssignment).where(
            LoggerAssignment.logger_id == logger.id,
            LoggerAssignment.assigned_from == datetime(2026, 9, 20, 8, 0),
        )
    ) == 1

    # Repeated move is harmless.
    body2 = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("TL-0417_x.xlsx", content)],
        selections={"0": logger.id},
        moves=[
            {
                "logger_id": logger.id,
                "fridge_id": display.id,
                "effective_at": "2026-09-20 08:00",
            }
        ],
    ).json()
    assert any(m["status"] == "already_present" for m in body2["moves_applied"])

    # Conflicting move (same time, different fridge) rejected.
    walk_in = session.scalars(select(Fridge).where(Fridge.name == "Walk-in")).one()
    body3 = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("TL-0417_x.xlsx", content)],
        selections={"0": logger.id},
        moves=[
            {
                "logger_id": logger.id,
                "fridge_id": walk_in.id,
                "effective_at": "2026-09-20 08:00",
            }
        ],
    ).json()
    assert body3["moves_rejected"]


def test_weekly_new_logger_registration(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    fridge = session.scalars(select(Fridge).where(Fridge.name == "Dairy")).first()
    content = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 10:00", 38.0]])

    # Needs attention until confirmed via new_loggers + selection.
    review = _post(
        client,
        "/api/uploads/review",
        mode="weekly",
        files=[("mystery.xlsx", content)],
        selections={"0": "new:TL-9001"},
        # missing new_loggers → not confirmed
    ).json()
    assert review["files"][0]["status"] == "needs_attention"
    assert counts(session)["loggers"] == 4

    body = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("mystery.xlsx", content)],
        selections={"0": "new:TL-9001"},
        new_loggers=[{"code": "TL-9001", "unit": "F", "fridge_id": fridge.id}],
    ).json()
    assert body["files"][0]["status"] == "imported"
    assert body["files"][0]["inserted"] == 1
    logger = session.scalars(select(Logger).where(Logger.code == "TL-9001")).one()
    assert logger.unit == "F"
    reading = session.scalars(
        select(TemperatureReading).where(TemperatureReading.logger_id == logger.id)
    ).one()
    assert reading.temperature_c == Decimal("3.33")
    assert reading.raw_value == "38"
    assigns = session.scalars(
        select(LoggerAssignment).where(LoggerAssignment.logger_id == logger.id)
    ).all()
    assert len(assigns) == 1 and assigns[0].assigned_from is None

    # Existing code refused.
    refused = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("mystery2.xlsx", content)],
        selections={"0": "new:tl-9001"},
        new_loggers=[{"code": "tl-9001", "unit": "C", "fridge_id": fridge.id}],
    ).json()
    assert refused["new_loggers_rejected"]
    assert "select it from the list" in refused["new_loggers_rejected"][0]["reason"]


def test_weekly_new_logger_persists_when_file_fails(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    fridge = session.scalars(select(Fridge)).first()
    # Invalid xlsx body
    body = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("broken.xlsx", b"not-a-zip")],
        selections={"0": "new:TL-9002"},
        new_loggers=[{"code": "TL-9002", "unit": "C", "fridge_id": fridge.id}],
    ).json()
    assert session.scalars(select(Logger).where(Logger.code == "TL-9002")).one()
    assert body["files"][0]["status"] in ("invalid", "failed", "needs_attention")


def test_weekly_column_validation(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    ok = make_xlsx_bytes(
        ["Logger", "Branch", "Fridge", "Time", "Temp"],
        [["TL-0512", "Jerusalem", "Dairy", "2026-09-14 11:00", 4.0]],
    )
    bad = make_xlsx_bytes(
        ["Logger", "Branch", "Fridge", "Time", "Temp"],
        [["TL-0512", "Jerusalem", "Walk-in", "2026-09-14 11:15", 4.0]],
    )
    bare = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 11:30", 4.0]])
    body = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[
            ("TL-0512_ok.xlsx", ok),
            ("TL-0512_bad.xlsx", bad),
            ("TL-0512_bare.xlsx", bare),
        ],
    ).json()
    by_name = {f["filename"]: f for f in body["files"]}
    assert by_name["TL-0512_ok.xlsx"]["status"] == "imported"
    assert by_name["TL-0512_bad.xlsx"]["status"] == "needs_attention"
    assert by_name["TL-0512_bad.xlsx"]["mapping_mismatches"]
    assert by_name["TL-0512_bare.xlsx"]["status"] == "imported"


def test_weekly_accepts_datetime_and_temperature_c_headers(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    content = make_xlsx_bytes(
        ["Date Time", "Temperature (°C)"],
        [["2026-09-14 15:00", 4.0]],
    )
    body = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("TL-0512_alias.xlsx", content)],
    ).json()
    assert body["files"][0]["status"] == "imported"
    assert body["files"][0]["inserted"] == 1


def test_weekly_rejects_temp_f_header_for_celsius_logger(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    content = make_xlsx_bytes(["Time", "Temp F"], [["2026-09-14 15:15", 39]])
    body = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("TL-0512_unit.xlsx", content)],
    ).json()
    assert body["files"][0]["status"] == "invalid"
    assert "indicates F" in body["files"][0]["message"]
    assert session.scalar(select(func.count()).select_from(TemperatureReading).where(
        TemperatureReading.measured_at == datetime(2026, 9, 14, 15, 15)
    )) == 0


def test_weekly_generic_filename_suggests_consistent_logger_column(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    logger_0388 = session.scalars(select(Logger).where(Logger.code == "TL-0388")).one()
    rows = [["TL-0388", "2026-09-14 12:00", 4.0] for _ in range(5)]
    content = make_xlsx_bytes(["Logger", "Time", "Temp"], rows)
    review = _post(
        client,
        "/api/uploads/review",
        mode="weekly",
        files=[("04_logger_in_column_generic_filename.xlsx", content)],
    ).json()
    file_result = review["files"][0]
    assert file_result["logger"] is None
    assert file_result["status"] == "needs_attention"
    assert file_result["suggested_logger_code"] == "TL-0388"
    assert file_result["logger_column"] == [{"code": "TL-0388", "count": 5}]
    assert "TL-0388" in (file_result["message"] or "")
    assert file_result["mapping_mismatches"] == []

    confirmed = _post(
        client,
        "/api/uploads/review",
        mode="weekly",
        files=[("04_logger_in_column_generic_filename.xlsx", content)],
        selections={"0": logger_0388.id},
    ).json()
    assert confirmed["files"][0]["status"] == "ready"
    assert confirmed["files"][0]["logger"]["code"] == "TL-0388"


def test_weekly_explicit_selection_conflicts_with_logger_column(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    wrong = session.scalars(select(Logger).where(Logger.code == "TL-0512")).one()
    rows = [["TL-0388", "2026-09-14 12:00", 4.0] for _ in range(20)]
    content = make_xlsx_bytes(["Logger", "Time", "Temp"], rows)
    body = _post(
        client,
        "/api/uploads/review",
        mode="weekly",
        files=[("04_logger_in_column_generic_filename.xlsx", content)],
        selections={"0": wrong.id},
    ).json()
    file_result = body["files"][0]
    assert file_result["status"] == "needs_attention"
    assert file_result["logger"]["code"] == "TL-0512"
    assert file_result["suggested_logger_code"] == "TL-0388"
    assert "20 rows contain TL-0388, but TL-0512 was selected." in file_result["message"]
    assert len(file_result["mapping_mismatches"]) == 20


def test_weekly_mixed_logger_column_is_not_suggested(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    content = make_xlsx_bytes(
        ["Logger", "Time", "Temp"],
        [
            ["TL-0388", "2026-09-14 12:00", 4.0],
            ["TL-0512", "2026-09-14 12:15", 4.1],
        ],
    )
    body = _post(
        client,
        "/api/uploads/review",
        mode="weekly",
        files=[("mixed_loggers.xlsx", content)],
    ).json()
    file_result = body["files"][0]
    assert file_result["suggested_logger_code"] is None
    assert {item["code"] for item in file_result["logger_column"]} == {"TL-0388", "TL-0512"}
    assert "mixed codes" in (file_result["message"] or "")


def test_weekly_fridge_conflict_against_database(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    # Existing TL-0512 reading at 06:00 on Dairy. Re-upload same time under a
    # forced wrong fridge via a move... easier: historical already has the
    # reading; weekly file for same logger/time with resolved Dairy is a
    # duplicate. To get a fridge conflict we need the resolved fridge to differ.
    # Create a second undated? That would make weekly unresolved.
    # Instead: import a reading, then add a dated move to another fridge at an
    # earlier time so resolution picks the other fridge for that timestamp.
    logger = session.scalars(select(Logger).where(Logger.code == "TL-0512")).one()
    walk_in = session.scalars(
        select(Fridge).where(Fridge.branch_name == "Tel Aviv", Fridge.name == "Walk-in")
    ).one()
    # Move effective before the existing reading time so resolution returns Walk-in.
    session.add(
        LoggerAssignment(
            logger_id=logger.id,
            fridge_id=walk_in.id,
            assigned_from=datetime(2026, 9, 14, 0, 0),
            assigned_to=None,
        )
    )
    session.flush()

    content = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 06:00", 3.8]])  # same value as seed
    body = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("TL-0512_conflict.xlsx", content)],
    ).json()
    fr = body["files"][0]
    assert fr["status"] == "imported"
    assert len(fr["fridge_conflicts"]) == 1
    assert fr["inserted"] == 0
    # Original fridge kept.
    reading = session.scalars(
        select(TemperatureReading).where(
            TemperatureReading.logger_id == logger.id,
            TemperatureReading.measured_at == datetime(2026, 9, 14, 6, 0),
        )
    ).one()
    dairy = session.scalars(
        select(Fridge).where(Fridge.branch_name == "Jerusalem", Fridge.name == "Dairy")
    ).one()
    assert reading.fridge_id == dairy.id


def test_weekly_reimport_no_duplicates(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    content = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 12:00", 4.0]])
    first = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("TL-0512.xlsx", content)],
    ).json()
    second = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("TL-0512.xlsx", content)],
    ).json()
    assert first["files"][0]["inserted"] == 1
    assert second["files"][0]["inserted"] == 0
    assert second["files"][0]["duplicates"] == 1


def test_weekly_fahrenheit_uses_stored_unit(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    content = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 13:00", 39]])
    body = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("TL-0231_week.xlsx", content)],
    ).json()
    assert body["files"][0]["inserted"] == 1
    assert body["files"][0]["unit_converted"] is True
    logger = session.scalars(select(Logger).where(Logger.code == "TL-0231")).one()
    reading = session.scalars(
        select(TemperatureReading).where(
            TemperatureReading.logger_id == logger.id,
            TemperatureReading.measured_at == datetime(2026, 9, 14, 13, 0),
        )
    ).one()
    assert reading.temperature_c == Decimal("3.89")
    assert reading.raw_value == "39"


def test_weekly_after_historical_undated_assignment(api_client):
    client, session = api_client
    hist = make_xlsx_bytes(
        COMBINED,
        [
            ["TL-7000", "Beer Sheva", "Dairy", "2026-09-14 06:00", 4.0],
            ["TL-7000", "Beer Sheva", "Dairy", "2026-09-14 06:15", 4.1],
        ],
    )
    _post(client, "/api/uploads/import", mode="historical", file=("h.xlsx", hist))
    weekly = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 07:00", 4.2]])
    body = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("TL-7000_week.xlsx", weekly)],
    ).json()
    assert body["files"][0]["status"] == "imported"
    assert body["files"][0]["inserted"] == 1


def test_only_four_application_tables(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    content = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 14:00", 4.0]])
    _post(client, "/api/uploads/import", mode="weekly", files=[("TL-0512.xlsx", content)])
    assert application_tables(session) == set(TABLES)


def _fridge_named(session, branch, name):
    return session.scalars(
        select(Fridge).where(Fridge.branch_name == branch, Fridge.name == name)
    ).first()


def test_review_new_fridge_writes_nothing(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    before = counts(session)
    content = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 07:00", 4.2]])
    response = _post(
        client,
        "/api/uploads/review",
        mode="weekly",
        files=[("07_TL-0777_Haifa_NEW_Temp_Time.xlsx", content)],
        selections={"0": "new:TL-0777"},
        new_fridges=[{"branch": "Haifa", "name": "Walk-in 3"}],
        new_loggers=[{"code": "TL-0777", "unit": "C", "fridge_id": "new:0"}],
    )
    assert response.status_code == 200
    body = response.json()
    assert body["dry_run"] is True
    assert any(f["status"] == "created" for f in body["new_fridges_created"])
    assert counts(session) == before
    assert _fridge_named(session, "Haifa", "Walk-in 3") is None
    assert session.scalars(select(Logger).where(Logger.code == "TL-0777")).first() is None


def test_import_new_logger_assigned_to_new_fridge(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    before_fridges = counts(session)["fridges"]
    content = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 07:00", 4.2]])
    body = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("07_TL-0777_Haifa_NEW_Temp_Time.xlsx", content)],
        selections={"0": "new:TL-0777"},
        new_fridges=[{"branch": "Haifa", "name": "Walk-in 3"}],
        new_loggers=[{"code": "TL-0777", "unit": "C", "fridge_id": "new:0"}],
    ).json()
    assert body["files"][0]["status"] == "imported"
    assert body["files"][0]["inserted"] == 1
    session.expire_all()
    fridge = _fridge_named(session, "Haifa", "Walk-in 3")
    logger = session.scalars(select(Logger).where(Logger.code == "TL-0777")).one()
    assert fridge is not None
    assert counts(session)["fridges"] == before_fridges + 1
    assignment = session.scalars(
        select(LoggerAssignment).where(LoggerAssignment.logger_id == logger.id)
    ).one()
    assert assignment.fridge_id == fridge.id
    assert assignment.assigned_from is None
    reading = session.scalars(
        select(TemperatureReading).where(TemperatureReading.logger_id == logger.id)
    ).one()
    assert reading.fridge_id == fridge.id


def test_import_existing_logger_moved_to_new_fridge_keeps_history(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    logger = session.scalars(select(Logger).where(Logger.code == "TL-0512")).one()
    old_assignments = session.scalars(
        select(LoggerAssignment).where(LoggerAssignment.logger_id == logger.id)
    ).all()
    assert old_assignments
    old_ids = {a.id for a in old_assignments}
    old_pairs = {(a.fridge_id, a.assigned_from) for a in old_assignments}
    before_fridges = counts(session)["fridges"]
    content = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 07:00", 4.2]])
    body = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("TL-0512_week.xlsx", content)],
        selections={"0": logger.id},
        new_fridges=[{"branch": "Jerusalem", "name": "Overflow"}],
        moves=[
            {
                "logger_id": logger.id,
                "fridge_id": "new:0",
                "effective_at": "2026-09-01 06:00",
            }
        ],
    ).json()
    assert body["files"][0]["status"] == "imported"
    session.expire_all()
    fridge = _fridge_named(session, "Jerusalem", "Overflow")
    assert fridge is not None
    assert counts(session)["fridges"] == before_fridges + 1
    current = session.scalars(
        select(LoggerAssignment).where(LoggerAssignment.logger_id == logger.id)
    ).all()
    assert old_ids <= {a.id for a in current}
    assert old_pairs <= {(a.fridge_id, a.assigned_from) for a in current}
    dated = [a for a in current if a.assigned_from == datetime(2026, 9, 1, 6, 0)]
    assert len(dated) == 1 and dated[0].fridge_id == fridge.id
    reading = session.scalars(
        select(TemperatureReading).where(
            TemperatureReading.logger_id == logger.id,
            TemperatureReading.measured_at == datetime(2026, 9, 14, 7, 0),
        )
    ).one()
    assert reading.fridge_id == fridge.id


def test_repeated_import_does_not_duplicate_fridge(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    content = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 07:00", 4.2]])
    payload = dict(
        mode="weekly",
        files=[("07_TL-0777_Haifa_NEW_Temp_Time.xlsx", content)],
        selections={"0": "new:TL-0777"},
        new_fridges=[{"branch": "Haifa", "name": "Walk-in 3"}],
        new_loggers=[{"code": "TL-0777", "unit": "C", "fridge_id": "new:0"}],
    )
    first = _post(client, "/api/uploads/import", **payload).json()
    assert first["files"][0]["status"] == "imported"
    session.expire_all()
    fridge_count = counts(session)["fridges"]
    logger = session.scalars(select(Logger).where(Logger.code == "TL-0777")).one()
    second = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("TL-0777_again.xlsx", content)],
        selections={"0": logger.id},
        new_fridges=[{"branch": "Haifa", "name": "Walk-in 3"}],
    ).json()
    assert any(f["status"] == "already_present" for f in second["new_fridges_created"])
    session.expire_all()
    assert counts(session)["fridges"] == fridge_count
    assert (
        session.scalar(
            select(func.count())
            .select_from(Fridge)
            .where(Fridge.branch_name == "Haifa", Fridge.name == "Walk-in 3")
        )
        == 1
    )


def test_new_fridge_duplicate_of_existing_is_reused(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    existing = session.scalars(
        select(Fridge).where(Fridge.branch_name == "Haifa")
    ).first()
    before = counts(session)["fridges"]
    content = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 07:00", 4.2]])
    body = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("new_logger.xlsx", content)],
        selections={"0": "new:TL-9009"},
        new_fridges=[{"branch": existing.branch_name, "name": existing.name.lower()}],
        new_loggers=[{"code": "TL-9009", "unit": "C", "fridge_id": "new:0"}],
    ).json()
    assert body["files"][0]["status"] == "imported"
    assert body["new_fridges_created"][0]["status"] == "already_present"
    session.expire_all()
    assert counts(session)["fridges"] == before


def test_filename_does_not_create_logger_from_guess(api_client, sample_path):
    client, session = api_client
    _seed(session, sample_path)
    before = counts(session)["loggers"]
    content = make_xlsx_bytes(["Time", "Temp"], [["2026-09-14 15:00", 4.0]])
    body = _post(
        client,
        "/api/uploads/import",
        mode="weekly",
        files=[("TL-UNKNOWN_2026.xlsx", content)],
    ).json()
    assert body["files"][0]["status"] == "needs_attention"
    assert counts(session)["loggers"] == before
