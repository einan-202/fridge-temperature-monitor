"""Unit tests for logger identification, fridge resolution and historical units.

No database required except where noted. Integration coverage of the HTTP
endpoints lives in test_api_upload.py.
"""

from datetime import datetime

import openpyxl
import pytest

from app.seed import SAMPLE_LOGGER_UNITS
from app.upload import (
    HISTORICAL_LOGGER_UNITS,
    AssignmentInfo,
    StagedMove,
    StagedNewFridge,
    StagedNewLogger,
    detect_logger_code,
    extract_logger_code_from_filename,
    mapping_mismatch_summary,
    MappingMismatch,
    summarize_logger_column,
    parse_effective_at,
    parse_fridge_ref,
    parse_logger_units,
    parse_moves,
    parse_new_fridges,
    parse_new_loggers,
    parse_selections,
    read_weekly_sheet,
    resolve_fridge_at,
    resolve_historical_logger_units,
    validate_optional_columns,
    WeeklySheetRow,
)
from app.ingest import ParsedRow


def make_xlsx(tmp_path, header, rows, name="file.xlsx"):
    wb = openpyxl.Workbook()
    ws = wb.active
    if header is not None:
        ws.append(header)
    for row in rows:
        ws.append(row)
    path = tmp_path / name
    wb.save(path)
    return path


def assignment(fridge_id, branch, name, assigned_from=None, assigned_to=None, logger_id=1):
    return AssignmentInfo(
        logger_id=logger_id,
        fridge_id=fridge_id,
        assigned_from=assigned_from,
        assigned_to=assigned_to,
        branch_name=branch,
        fridge_name=name,
    )


# ===========================================================================
# Filename logger detection
# ===========================================================================


def test_filename_exact_token_match():
    codes = ["TL-0512", "TL-0417", "TL-0231"]
    assert detect_logger_code("TL-0512_2026-09-14.xlsx", codes) == "TL-0512"
    assert detect_logger_code("tl-0512-export.XLSX", codes) == "TL-0512"


def test_filename_case_insensitive():
    assert detect_logger_code("tl-0417_week.xlsx", ["TL-0417"]) == "TL-0417"


def test_filename_two_codes_is_ambiguous():
    codes = ["TL-0512", "TL-0417"]
    assert detect_logger_code("TL-0512_TL-0417.xlsx", codes) is None


def test_filename_substring_not_a_token():
    assert detect_logger_code("XTL-05123.xlsx", ["TL-0512"]) is None
    assert detect_logger_code("prefixTL-0512.xlsx", ["TL-0512"]) is None


def test_filename_overlapping_codes_prefers_full_token_only():
    """TL-051 inside TL-0512 is not a whole token; only TL-0512 matches."""
    codes = ["TL-051", "TL-0512"]
    assert detect_logger_code("TL-0512_2026-09-14.xlsx", codes) == "TL-0512"
    assert detect_logger_code("TL-051_export.xlsx", codes) == "TL-051"


def test_filename_unknown_code():
    assert detect_logger_code("random_export.xlsx", ["TL-0512"]) is None


def test_filename_never_guessed_from_empty_known_list():
    assert detect_logger_code("TL-0512.xlsx", []) is None


def test_extract_logger_code_from_typical_weekly_filename():
    name = "07_TL-0777_Haifa_NEW_Temp_Time.xlsx"
    assert extract_logger_code_from_filename(name) == "TL-0777"
    assert extract_logger_code_from_filename(name) != "07"
    assert extract_logger_code_from_filename(name) != "TL"


def test_extract_logger_code_normalizes_case():
    assert extract_logger_code_from_filename("tl-0777_week.xlsx") == "TL-0777"


def test_extract_logger_code_ambiguous_or_missing_is_none():
    assert extract_logger_code_from_filename("TL-0777_TL-0417.xlsx") is None
    assert extract_logger_code_from_filename("random_export.xlsx") is None
    assert extract_logger_code_from_filename("07_Haifa_NEW.xlsx") is None


def test_generic_filename_is_not_detected_as_known_logger():
    codes = ["TL-0512", "TL-0417", "TL-0388", "TL-0231"]
    name = "04_logger_in_column_generic_filename.xlsx"
    assert extract_logger_code_from_filename(name) is None
    assert detect_logger_code(name, codes) is None


def test_summarize_logger_column_consistent_code():
    rows = [
        WeeklySheetRow(2, "2026-09-14 06:00", 4.0, logger_col="TL-0388"),
        WeeklySheetRow(3, "2026-09-14 06:15", 4.1, logger_col="tl-0388"),
        WeeklySheetRow(4, "2026-09-14 06:30", 4.0, logger_col="TL-0388"),
    ]
    summary, suggested = summarize_logger_column(rows)
    assert suggested == "TL-0388"
    assert summary == [{"code": "TL-0388", "count": 3}]


def test_summarize_logger_column_mixed_codes_not_suggested():
    rows = [
        WeeklySheetRow(2, "2026-09-14 06:00", 4.0, logger_col="TL-0388"),
        WeeklySheetRow(3, "2026-09-14 06:15", 4.1, logger_col="TL-0512"),
    ]
    summary, suggested = summarize_logger_column(rows)
    assert suggested is None
    assert {item["code"] for item in summary} == {"TL-0388", "TL-0512"}


def test_mapping_mismatch_summary_collapses_repeated_logger_errors():
    mismatches = [
        MappingMismatch(i, "Logger", "TL-0388", "TL-0512", "row msg")
        for i in range(2, 22)
    ]
    assert mapping_mismatch_summary(mismatches) == (
        "20 rows contain TL-0388, but TL-0512 was selected."
    )


# ===========================================================================
# Fridge resolution
# ===========================================================================


def test_one_undated_assignment_resolves():
    assigns = [assignment(1, "Tel Aviv", "Walk-in")]
    got = resolve_fridge_at(assigns, datetime(2026, 9, 14, 6, 0))
    assert got is not None and got.fridge_name == "Walk-in"


def test_no_assignment_is_unresolved():
    assert resolve_fridge_at([], datetime(2026, 9, 14, 6, 0)) is None


def test_two_undated_assignments_are_ambiguous():
    assigns = [
        assignment(1, "Tel Aviv", "Walk-in"),
        assignment(2, "Tel Aviv", "Display 2"),
    ]
    assert resolve_fridge_at(assigns, datetime(2026, 9, 14, 6, 0)) is None


def test_dated_move_splits_readings():
    assigns = [
        assignment(1, "Tel Aviv", "Walk-in"),  # undated baseline
        assignment(2, "Tel Aviv", "Display 2", assigned_from=datetime(2026, 9, 17, 6, 0)),
    ]
    before = resolve_fridge_at(assigns, datetime(2026, 9, 14, 6, 0))
    after = resolve_fridge_at(assigns, datetime(2026, 9, 17, 6, 0))
    later = resolve_fridge_at(assigns, datetime(2026, 9, 17, 7, 0))
    assert before is not None and before.fridge_name == "Walk-in"
    assert after is not None and after.fridge_name == "Display 2"
    assert later is not None and later.fridge_name == "Display 2"


def test_tl_0417_readings_before_move_unresolved():
    """Two undated + a dated move: before the move is unresolved, after resolves."""
    assigns = [
        assignment(1, "Tel Aviv", "Walk-in"),
        assignment(2, "Tel Aviv", "Display 2"),
        assignment(2, "Tel Aviv", "Display 2", assigned_from=datetime(2026, 9, 17, 6, 0)),
    ]
    before = resolve_fridge_at(assigns, datetime(2026, 9, 14, 6, 0))
    at_move = resolve_fridge_at(assigns, datetime(2026, 9, 17, 6, 0))
    assert before is None
    assert at_move is not None and at_move.fridge_name == "Display 2"
    # Never apply the move fridge backwards.
    assert resolve_fridge_at(assigns, datetime(2026, 9, 17, 5, 59)) is None


def test_ended_assignment_not_used_after_assigned_to():
    assigns = [
        assignment(
            1,
            "Haifa",
            "Dairy",
            assigned_from=datetime(2026, 9, 1, 0, 0),
            assigned_to=datetime(2026, 9, 10, 0, 0),
        ),
        assignment(2, "Haifa", "Other", assigned_from=datetime(2026, 9, 10, 0, 0)),
    ]
    mid = resolve_fridge_at(assigns, datetime(2026, 9, 5, 12, 0))
    after = resolve_fridge_at(assigns, datetime(2026, 9, 10, 0, 0))
    assert mid is not None and mid.fridge_name == "Dairy"
    assert after is not None and after.fridge_name == "Other"


def test_same_start_different_fridges_is_ambiguous():
    start = datetime(2026, 9, 17, 6, 0)
    assigns = [
        assignment(1, "Tel Aviv", "Walk-in", assigned_from=start),
        assignment(2, "Tel Aviv", "Display 2", assigned_from=start),
    ]
    assert resolve_fridge_at(assigns, datetime(2026, 9, 17, 7, 0)) is None


def test_move_does_not_establish_previous_fridge():
    """Only a dated move, no undated baseline: earlier readings stay unresolved."""
    assigns = [
        assignment(2, "Tel Aviv", "Display 2", assigned_from=datetime(2026, 9, 17, 6, 0)),
    ]
    assert resolve_fridge_at(assigns, datetime(2026, 9, 14, 6, 0)) is None
    assert resolve_fridge_at(assigns, datetime(2026, 9, 17, 6, 0)).fridge_name == "Display 2"


# ===========================================================================
# Historical units (no DB for pure mapping of empty session-like behaviour)
# ===========================================================================


class _EmptyScalars:
    def first(self):
        return None


class _EmptySession:
    def scalars(self, _stmt):
        return _EmptyScalars()


def test_historical_units_agree_with_seed_on_tl_0231():
    assert HISTORICAL_LOGGER_UNITS["TL-0231"] == SAMPLE_LOGGER_UNITS["TL-0231"] == "F"


def test_historical_tl_0231_and_non_haifa_default():
    rows = [
        ParsedRow(2, "TL-0231", "Haifa", "Dairy", "2026-09-14 06:00", 38.3),
        ParsedRow(3, "TL-0999", "Tel Aviv", "Walk-in", "2026-09-14 06:00", 4.0),
    ]
    infos = resolve_historical_logger_units(_EmptySession(), rows)
    by_code = {i.code: i for i in infos}
    assert by_code["TL-0231"].unit == "F" and by_code["TL-0231"].source == "known"
    assert by_code["TL-0999"].unit == "C" and by_code["TL-0999"].source == "default"


def test_historical_new_haifa_logger_is_unresolved():
    rows = [ParsedRow(2, "TL-0777", "Haifa", "Dairy", "2026-09-14 06:00", 4.0)]
    infos = resolve_historical_logger_units(_EmptySession(), rows)
    assert len(infos) == 1
    assert infos[0].source == "unresolved" and infos[0].unit is None


def test_historical_override_and_required_choice():
    rows = [
        ParsedRow(2, "TL-0777", "Haifa", "Dairy", "2026-09-14 06:00", 4.0),
        ParsedRow(3, "TL-0888", "Jerusalem", "Dairy", "2026-09-14 06:00", 4.0),
    ]
    infos = resolve_historical_logger_units(
        _EmptySession(), rows, overrides={"TL-0777": "F", "TL-0888": "F"}
    )
    by_code = {i.code: i for i in infos}
    assert by_code["TL-0777"].source == "override" and by_code["TL-0777"].unit == "F"
    assert by_code["TL-0888"].source == "override" and by_code["TL-0888"].unit == "F"


# ===========================================================================
# Optional column validation / weekly sheet reader
# ===========================================================================


def test_weekly_sheet_time_temp_only(tmp_path):
    path = make_xlsx(tmp_path, ["Time", "Temp"], [["2026-09-14 06:00", 4.1]])
    rows = read_weekly_sheet(path)
    assert len(rows) == 1
    assert rows[0].raw_temp == 4.1 and rows[0].logger_col is None


def test_optional_columns_agree_are_accepted():
    sheet = [
        WeeklySheetRow(
            2,
            "2026-09-14 06:00",
            4.0,
            logger_col="TL-0417",
            branch_col="Tel Aviv",
            fridge_col="Walk-in",
        )
    ]
    resolved = {
        2: assignment(1, "Tel Aviv", "Walk-in"),
    }
    assert validate_optional_columns(sheet, "TL-0417", resolved) == []


def test_optional_fridge_mismatch_reported():
    sheet = [
        WeeklySheetRow(
            14,
            "2026-09-14 06:00",
            4.0,
            fridge_col="Walk-in",
        )
    ]
    resolved = {14: assignment(2, "Tel Aviv", "Display 2")}
    mismatches = validate_optional_columns(sheet, "TL-0417", resolved)
    assert len(mismatches) == 1
    assert mismatches[0].field == "Fridge"
    assert "Walk-in" in mismatches[0].message
    assert "Display 2" in mismatches[0].message


def test_optional_columns_never_resolve_ambiguous_file():
    """Mismatches are reports only; resolution still comes from assignments."""
    # No resolved map → no fridge/branch mismatch checks; logger mismatch still fires.
    sheet = [WeeklySheetRow(2, "2026-09-14 06:00", 4.0, logger_col="TL-OTHER")]
    mismatches = validate_optional_columns(sheet, "TL-0417", {})
    assert mismatches[0].field == "Logger"


# ===========================================================================
# Request parsers
# ===========================================================================


def test_parse_selections_and_moves_and_new_loggers():
    assert parse_selections('{"0": 3, "1": "new:TL-9"}') == {"0": 3, "1": "new:TL-9"}
    moves = parse_moves(
        '[{"logger_id": 1, "fridge_id": 2, "effective_at": "2026-09-17 06:00"}]'
    )
    assert moves == [StagedMove(1, 2, datetime(2026, 9, 17, 6, 0))]
    new = parse_new_loggers('[{"code": "TL-9", "unit": "C", "fridge_id": 2}]')
    assert new == [StagedNewLogger("TL-9", "C", 2)]
    assert parse_logger_units('{"TL-0777": "F"}') == {"TL-0777": "F"}
    assert parse_effective_at("2026-09-17T06:00:00") == datetime(2026, 9, 17, 6, 0)
    assert parse_new_fridges('[{"branch": "Haifa", "name": "Walk-in 3"}]') == [
        StagedNewFridge("Haifa", "Walk-in 3")
    ]
    assert parse_fridge_ref("new:0") == "new:0"
    staged_move = parse_moves(
        '[{"logger_id": 1, "fridge_id": "new:0", "effective_at": "2026-09-17 06:00"}]'
    )
    assert staged_move[0].fridge_id == "new:0"
    staged_logger = parse_new_loggers(
        '[{"code": "TL-9", "unit": "C", "fridge_id": "new:0"}]'
    )
    assert staged_logger[0].fridge_id == "new:0"


def test_parse_logger_units_rejects_bad_unit():
    with pytest.raises(Exception, match="C' or 'F"):
        parse_logger_units('{"TL-1": "K"}')
