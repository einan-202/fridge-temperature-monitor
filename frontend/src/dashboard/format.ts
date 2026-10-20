/** Display helpers — no analysis, only formatting of API values. */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Parse backend naive timestamps: "YYYY-MM-DD HH:MM:SS" or ISO date. */
export function parseApiDateTime(value: string): Date | null {
  const normalized = value.trim().replace(" ", "T");
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(
    normalized,
  );
  if (!match) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = match;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  );
}

export function formatTemperatureC(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  // Keep two decimals when needed (3.89); otherwise one (7.10 → 7.1, 4.00 → 4.0).
  const fixed2 = n.toFixed(2);
  const text = fixed2.endsWith("0") ? n.toFixed(1) : fixed2;
  return `${text}°C`;
}

export function formatShortDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = parseApiDateTime(value);
  if (!date) return null;
  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day} ${month}, ${hours}:${minutes}`;
}

export function formatWeekRange(start: string, endExclusive: string): string {
  const startDate = parseApiDateTime(start);
  const endDate = parseApiDateTime(endExclusive);
  if (!startDate || !endDate) return start;
  // Week end from the API is exclusive (next Monday 00:00).
  const last = new Date(endDate.getTime() - 1);
  const sameYear = startDate.getFullYear() === last.getFullYear();
  const left = `${startDate.getDate()} ${MONTHS[startDate.getMonth()]}`;
  const right = `${last.getDate()} ${MONTHS[last.getMonth()]}${
    sameYear ? "" : ` ${last.getFullYear()}`
  }`;
  return `${left} – ${right} ${last.getFullYear()}`;
}

/** Numeric part of a logger code for sorting (TL-0388 → 388). */
export function loggerNumericKey(code: string): number {
  const match = /(\d+)/.exec(code);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}
