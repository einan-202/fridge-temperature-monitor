"""Pure normalization helpers (no database, no I/O).

- Names: trimmed, internal whitespace collapsed. Matching is case-insensitive;
  the caller keeps the first-seen (already stored) spelling.
- Timestamps: native datetimes, `YYYY-MM-DD HH:MM[:SS]` and day-first
  `DD/MM/YYYY HH:MM[:SS]`. Explicit formats only, never a guessing parser.
- Temperatures: parsed with `Decimal(str(value))` (no float arithmetic).
  Blank, non-numeric, NaN and infinite values mean "no valid temperature"
  (None). There is deliberately NO range/threshold check: 150 and -80 are
  valid values.
- Fahrenheit -> Celsius: `(F - 32) * 5 / 9`, rounded half-up to 2 decimals.
"""

import re
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, DecimalException, InvalidOperation
from typing import Any

TWO_PLACES = Decimal("0.01")

_ISO_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$")
_DAY_FIRST_RE = re.compile(r"^(\d{2})/(\d{2})/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$")


def normalize_name(value: Any) -> str:
    """Trim and collapse internal whitespace. None becomes an empty string."""
    if value is None:
        return ""
    return " ".join(str(value).split())


def name_key(value: Any) -> str:
    """Case-insensitive comparison key for a (normalized) name."""
    return normalize_name(value).casefold()


def parse_timestamp(value: Any) -> datetime:
    """Parse a timestamp cell. Raises ValueError with a row-level reason."""
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, date):
        raise ValueError(f"timestamp {value!r} has no time of day")
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ValueError("timestamp is missing")
    if not isinstance(value, str):
        raise ValueError(f"unrecognized timestamp {value!r}")

    text = " ".join(value.split())
    match = _ISO_RE.match(text)
    if match:
        year, month, day, hour, minute, second = match.groups()
    else:
        match = _DAY_FIRST_RE.match(text)
        if not match:
            raise ValueError(
                f"unrecognized timestamp {value!r} "
                "(expected YYYY-MM-DD HH:MM[:SS] or DD/MM/YYYY HH:MM[:SS])"
            )
        day, month, year, hour, minute, second = match.groups()
    try:
        return datetime(
            int(year), int(month), int(day), int(hour), int(minute), int(second or 0)
        )
    except ValueError as exc:
        raise ValueError(f"invalid timestamp {value!r}: {exc}") from None


def parse_temperature(value: Any) -> Decimal | None:
    """Parse a temperature cell to a finite Decimal, or None if not valid."""
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip()
    if not text or "_" in text:  # Decimal() would accept '1_0' as 10
        return None
    try:
        number = Decimal(text)
    except InvalidOperation:
        return None
    return number if number.is_finite() else None


def fahrenheit_to_celsius(fahrenheit: Decimal) -> Decimal:
    """`(F - 32) * 5 / 9`, rounded half-up to 2 decimals."""
    return ((fahrenheit - 32) * 5 / 9).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def to_celsius(value: Any, unit: str = "C") -> Decimal | None:
    """Parse `value` and return Celsius with 2 decimals, or None if invalid.

    `unit` is the logger's unit, 'C' or 'F'.
    """
    if unit not in ("C", "F"):
        raise ValueError(f"unit must be 'C' or 'F', got {unit!r}")
    number = parse_temperature(value)
    if number is None:
        return None
    try:
        if unit == "F":
            return fahrenheit_to_celsius(number)
        return number.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
    except DecimalException:  # absurdly large magnitude: cannot be quantized
        return None
