import { describe, expect, it } from "vitest";
import { isHighTemperature, splitValidSegments } from "./segments";
import type { SeriesReading } from "../types/series";

function reading(at: string, temp: string | null): SeriesReading {
  return {
    measured_at: at,
    temperature_c: temp,
    raw_value: temp ?? "ERR",
    raw_timestamp: at,
    source_file: "t",
    source_row: 1,
  };
}

describe("splitValidSegments", () => {
  it("keeps consecutive valid readings in one segment", () => {
    const segments = splitValidSegments(
      [
        reading("2026-09-14 06:00:00", "4.6"),
        reading("2026-09-14 06:15:00", "5.4"),
        reading("2026-09-14 06:30:00", "6.3"),
      ],
      [],
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(3);
  });

  it("breaks at ERR / null temperatures", () => {
    const segments = splitValidSegments(
      [
        reading("2026-09-14 06:00:00", "3.50"),
        reading("2026-09-14 06:15:00", "3.89"),
        reading("2026-09-14 06:30:00", null),
        reading("2026-09-14 06:45:00", "4.00"),
      ],
      [],
    );
    expect(segments.map((s) => s.map((r) => r.measured_at))).toEqual([
      ["2026-09-14 06:00:00", "2026-09-14 06:15:00"],
      ["2026-09-14 06:45:00"],
    ]);
  });

  it("does not connect across a backend-reported gap", () => {
    const segments = splitValidSegments(
      [
        reading("2026-09-14 06:00:00", "3.8"),
        reading("2026-09-14 06:15:00", "3.9"),
        reading("2026-09-14 08:30:00", "4.0"),
      ],
      [{ start: "2026-09-14 06:15:00", end: "2026-09-14 08:30:00", minutes: 135 }],
    );
    expect(segments).toHaveLength(2);
    expect(segments[0].map((r) => r.measured_at)).toEqual([
      "2026-09-14 06:00:00",
      "2026-09-14 06:15:00",
    ]);
    expect(segments[1].map((r) => r.measured_at)).toEqual(["2026-09-14 08:30:00"]);
  });
});

describe("isHighTemperature", () => {
  it("highlights only readings strictly above 5°C", () => {
    expect(isHighTemperature("5.0")).toBe(false);
    expect(isHighTemperature("5.4")).toBe(true);
    expect(isHighTemperature("9.4")).toBe(true);
    expect(isHighTemperature(null)).toBe(false);
  });
});
