import { parseApiDateTime } from "../dashboard/format";
import type { SeriesReading } from "../types/series";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface WeekDay {
  iso: string;
  weekday: string;
  dayOfMonth: number;
}

/** Seven ISO week days starting at the Monday `YYYY-MM-DD`. */
export function weekDays(mondayIso: string): WeekDay[] {
  const start = parseApiDateTime(mondayIso);
  if (!start) return [];
  return WEEKDAYS.map((weekday, index) => {
    const date = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + index,
    );
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { iso, weekday, dayOfMonth: date.getDate() };
  });
}

export function readingDayIso(measuredAt: string): string {
  return measuredAt.slice(0, 10);
}

export function readingsOnDay(
  readings: SeriesReading[],
  dayIso: string,
): SeriesReading[] {
  return readings.filter((reading) => readingDayIso(reading.measured_at) === dayIso);
}

/** First Monday–Sunday day that has any reading, otherwise Monday. */
export function defaultDayIso(days: WeekDay[], readings: SeriesReading[]): string {
  const monday = days[0]?.iso ?? "";
  for (const day of days) {
    if (readings.some((reading) => readingDayIso(reading.measured_at) === day.iso)) {
      return day.iso;
    }
  }
  return monday;
}

export function minutesFromMidnight(measuredAt: string): number | null {
  const date = parseApiDateTime(measuredAt);
  if (!date) return null;
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}
