import { describe, expect, it } from "vitest";
import { defaultDayIso, minutesFromMidnight, weekDays } from "./days";

describe("weekDays", () => {
  it("returns Monday through Sunday for an ISO week", () => {
    const days = weekDays("2026-09-14");
    expect(days.map((d) => d.iso)).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
    expect(days.map((d) => d.weekday)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
  });
});

describe("defaultDayIso", () => {
  it("defaults to the first day that has readings, otherwise Monday", () => {
    const days = weekDays("2026-09-14");
    expect(
      defaultDayIso(days, [
        {
          measured_at: "2026-09-17 06:00:00",
          temperature_c: "3.7",
          raw_value: "3.7",
          raw_timestamp: "2026-09-17 06:00:00",
          source_file: "t",
          source_row: 1,
        },
      ]),
    ).toBe("2026-09-17");
    expect(defaultDayIso(days, [])).toBe("2026-09-14");
  });
});

describe("minutesFromMidnight", () => {
  it("uses clock time, not reading index", () => {
    expect(minutesFromMidnight("2026-09-14 06:00:00")).toBe(360);
    expect(minutesFromMidnight("2026-09-14 06:15:00")).toBe(375);
    expect(minutesFromMidnight("2026-09-14 08:30:00")).toBe(510);
  });
});
