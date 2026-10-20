/** Types for GET /api/series/{logger_id}/{fridge_id} — matches the backend payload. */

export interface SeriesReading {
  measured_at: string;
  temperature_c: string | null;
  raw_value: string | null;
  raw_timestamp: string | null;
  source_file: string | null;
  source_row: number | null;
}

export interface SeriesExcursion {
  start: string;
  end: string;
  peak_c: string;
  reading_count: number;
  duration_minutes: number;
  duration_label: string;
  ended_by: string;
  kind: string;
}

export interface SeriesWarmingRun {
  start: string;
  end: string;
  rise_c: string;
  reading_count: number;
}

export interface SeriesGap {
  start: string;
  end: string;
  minutes: number;
}

export interface SeriesInvalidReading {
  measured_at: string;
  raw_value: string | null;
}

export interface SeriesDetail {
  logger_id: number;
  logger_code: string;
  fridge_id: number;
  branch: string;
  fridge_name: string;
  weeks: string[];
  week: {
    start: string;
    end: string;
    monday: string;
  } | null;
  readings: SeriesReading[];
  excursions: SeriesExcursion[];
  warming_runs: SeriesWarmingRun[];
  gaps: SeriesGap[];
  invalid_readings: SeriesInvalidReading[];
  max_temperature_c: string | null;
  max_temperature_at: string | null;
  observed_minutes: number;
  unobserved_periods: { start: string; end: string; minutes: number }[];
  single_valid_reading: boolean;
  notes?: {
    coverage_is_estimate?: boolean;
    unobserved_never_safe?: boolean;
  };
}
