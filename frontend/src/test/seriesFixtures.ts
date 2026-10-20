import type { SeriesDetail } from "../types/series";

function base(overrides: Partial<SeriesDetail> & Pick<SeriesDetail, "logger_code">): SeriesDetail {
  return {
    logger_id: 1,
    fridge_id: 1,
    branch: "Rishon LeZion",
    fridge_name: "Cream cakes",
    weeks: ["2026-09-14"],
    week: {
      start: "2026-09-14 00:00:00",
      end: "2026-09-21 00:00:00",
      monday: "2026-09-14",
    },
    readings: [],
    excursions: [],
    warming_runs: [],
    gaps: [],
    invalid_readings: [],
    max_temperature_c: null,
    max_temperature_at: null,
    observed_minutes: 0,
    unobserved_periods: [],
    single_valid_reading: false,
    notes: { coverage_is_estimate: true, unobserved_never_safe: true },
    ...overrides,
  };
}

export function creamCakesSeries(): SeriesDetail {
  return base({
    logger_id: 10,
    fridge_id: 4,
    logger_code: "TL-0388",
    readings: [
      row("2026-09-14 06:00:00", "4.6"),
      row("2026-09-14 06:15:00", "5.4"),
      row("2026-09-14 06:30:00", "6.3"),
      row("2026-09-14 06:45:00", "7.1"),
    ],
    excursions: [
      {
        start: "2026-09-14 06:15:00",
        end: "2026-09-14 06:45:00",
        peak_c: "7.10",
        reading_count: 3,
        duration_minutes: 30,
        duration_label: "at least 30 min",
        ended_by: "end_of_data",
        kind: "sustained",
      },
    ],
    max_temperature_c: "7.10",
    max_temperature_at: "2026-09-14 06:45:00",
    observed_minutes: 45,
  });
}

export function walkInSeries(): SeriesDetail {
  return base({
    logger_id: 11,
    fridge_id: 2,
    logger_code: "TL-0417",
    branch: "Tel Aviv",
    fridge_name: "Walk-in",
    readings: [
      row("2026-09-14 05:45:00", "4.0"),
      row("2026-09-14 06:00:00", "4.1"),
      row("2026-09-14 06:15:00", "9.4"),
      row("2026-09-14 06:30:00", "4.3"),
    ],
    excursions: [
      {
        start: "2026-09-14 06:15:00",
        end: "2026-09-14 06:15:00",
        peak_c: "9.40",
        reading_count: 1,
        duration_minutes: 0,
        duration_label: "single reading",
        ended_by: "recovered",
        kind: "isolated_spike",
      },
    ],
    max_temperature_c: "9.40",
    max_temperature_at: "2026-09-14 06:15:00",
  });
}

export function jerusalemDairySeries(): SeriesDetail {
  return base({
    logger_id: 12,
    fridge_id: 1,
    logger_code: "TL-0512",
    branch: "Jerusalem",
    fridge_name: "Dairy",
    readings: [
      row("2026-09-14 06:00:00", "3.8"),
      row("2026-09-14 06:15:00", "3.9"),
      row("2026-09-14 08:30:00", "4.0"),
    ],
    gaps: [{ start: "2026-09-14 06:15:00", end: "2026-09-14 08:30:00", minutes: 135 }],
    max_temperature_c: "4.00",
    max_temperature_at: "2026-09-14 08:30:00",
  });
}

export function haifaDairySeries(): SeriesDetail {
  return base({
    logger_id: 13,
    fridge_id: 3,
    logger_code: "TL-0231",
    branch: "Haifa",
    fridge_name: "Dairy",
    readings: [
      row("2026-09-14 06:00:00", "3.50", "38.3"),
      row("2026-09-14 06:15:00", "3.89", "39"),
      row("2026-09-14 06:30:00", null, "ERR"),
    ],
    invalid_readings: [{ measured_at: "2026-09-14 06:30:00", raw_value: "ERR" }],
    max_temperature_c: "3.89",
    max_temperature_at: "2026-09-14 06:15:00",
  });
}

export function emptySeries(): SeriesDetail {
  return base({ logger_code: "TL-0001", fridge_id: 9, logger_id: 99 });
}

function row(at: string, temperature_c: string | null, raw_value?: string) {
  return {
    measured_at: at,
    temperature_c,
    raw_value: raw_value ?? temperature_c,
    raw_timestamp: at,
    source_file: "sample",
    source_row: 1,
  };
}
