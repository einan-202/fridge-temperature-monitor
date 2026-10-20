"""Unit tests for app.normalize (pure functions, no database)."""

from datetime import date, datetime
from decimal import Decimal

import pytest

from app.normalize import (
    fahrenheit_to_celsius,
    name_key,
    normalize_name,
    parse_temperature,
    parse_timestamp,
    to_celsius,
)

# --- names ------------------------------------------------------------------


def test_normalize_name_trims_and_collapses_whitespace():
    assert normalize_name("  Tel   Aviv \t") == "Tel Aviv"
    assert normalize_name("Cream\n cakes") == "Cream cakes"
    assert normalize_name(None) == ""


def test_name_key_is_case_insensitive():
    assert name_key("tel aviv") == name_key("  Tel   AVIV ")
    assert name_key("Dairy") != name_key("Walk-in")


# --- timestamps -------------------------------------------------------------


@pytest.mark.parametrize(
    "text, expected",
    [
        ("2026-09-14 06:00", datetime(2026, 9, 14, 6, 0)),
        ("2026-09-14 06:00:30", datetime(2026, 9, 14, 6, 0, 30)),
        ("14/09/2026 06:15", datetime(2026, 9, 14, 6, 15)),
        ("14/09/2026 06:15:45", datetime(2026, 9, 14, 6, 15, 45)),
        ("  2026-09-14   06:00 ", datetime(2026, 9, 14, 6, 0)),
        ("01/02/2026 10:00", datetime(2026, 2, 1, 10, 0)),  # day-first, not Jan 2
    ],
)
def test_parse_timestamp_text_formats(text, expected):
    assert parse_timestamp(text) == expected


def test_parse_timestamp_accepts_datetime_objects():
    value = datetime(2026, 9, 14, 6, 0)
    assert parse_timestamp(value) == value


@pytest.mark.parametrize("value", [None, "", "   "])
def test_empty_timestamp_has_row_level_reason(value):
    with pytest.raises(ValueError, match="missing"):
        parse_timestamp(value)


@pytest.mark.parametrize(
    "value",
    [
        "yesterday",
        "2026/09/14 06:00",
        "09-14-2026 06:00",
        "14/09/26 06:00",
        "2026-09-14",  # no time of day
        "2026-09-14T06:00",
        "2026-9-4 6:00",
    ],
)
def test_malformed_timestamp_reason_includes_value(value):
    with pytest.raises(ValueError) as exc:
        parse_timestamp(value)
    assert repr(value) in str(exc.value)


@pytest.mark.parametrize("value", ["31/02/2026 06:00", "2026-13-01 06:00", "14/09/2026 25:00"])
def test_impossible_dates_are_rejected_with_value(value):
    with pytest.raises(ValueError) as exc:
        parse_timestamp(value)
    assert repr(value) in str(exc.value)


def test_plain_date_and_non_text_are_rejected():
    with pytest.raises(ValueError):
        parse_timestamp(date(2026, 9, 14))
    with pytest.raises(ValueError):
        parse_timestamp(45913.25)


# --- temperatures -----------------------------------------------------------


@pytest.mark.parametrize("value", ["ERR", "err", "", "   ", None, "N/A", "1,5", "1_0", True])
def test_non_numeric_is_none(value):
    assert parse_temperature(value) is None
    assert to_celsius(value, "C") is None


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf"), "NaN", "Infinity", "-inf"])
def test_nan_and_infinite_are_none(value):
    assert parse_temperature(value) is None
    assert to_celsius(value, "F") is None


@pytest.mark.parametrize("value, expected", [(150, "150.00"), (-80, "-80.00"), ("9.4", "9.40"), (0, "0.00")])
def test_extreme_values_are_not_rejected(value, expected):
    assert to_celsius(value, "C") == Decimal(expected)


def test_extreme_fahrenheit_values_are_not_rejected():
    assert to_celsius(-112, "F") == Decimal("-80.00")
    assert to_celsius(302, "F") == Decimal("150.00")


def test_absurd_magnitude_is_none_not_an_exception():
    assert to_celsius("1e999999", "C") is None
    assert to_celsius("1e999999999", "F") is None


@pytest.mark.parametrize(
    "fahrenheit, celsius",
    [(32, "0.00"), (212, "100.00"), (38.3, "3.50"), (39, "3.89"), ("38.3", "3.50"), (-40, "-40.00")],
)
def test_fahrenheit_to_celsius(fahrenheit, celsius):
    assert to_celsius(fahrenheit, "F") == Decimal(celsius)


def test_rounding_is_half_up_to_two_decimals():
    # (F - 32) * 5 / 9 = 0.005 exactly -> rounds half up to 0.01
    assert fahrenheit_to_celsius(Decimal("32.009")) == Decimal("0.01")
    assert to_celsius("3.125", "C") == Decimal("3.13")  # half-up, not banker's rounding
    assert to_celsius("3.135", "C") == Decimal("3.14")


def test_decimal_is_used_no_float_artifacts():
    result = to_celsius(0.1 + 0.2, "C")  # float 0.30000000000000004
    assert isinstance(result, Decimal)
    assert result == Decimal("0.30")
    assert parse_temperature(38.3) == Decimal("38.3")  # Decimal(str(38.3)), not Decimal(38.3)
    assert to_celsius(2.675, "C") == Decimal("2.68")  # float(2.675) is 2.67499999...


def test_celsius_is_quantized_to_two_places():
    assert to_celsius("4", "C").as_tuple().exponent == -2
    assert str(to_celsius("3.8", "C")) == "3.80"


def test_unknown_unit_is_a_programming_error():
    with pytest.raises(ValueError):
        to_celsius(1, "K")
