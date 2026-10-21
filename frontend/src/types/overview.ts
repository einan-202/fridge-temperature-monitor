/** Types for GET /api/overview — matches the backend payload. */

export type FridgeWeekResultKind =
  | "excursion_observed"
  | "warming_observed"
  | "insufficient_data"
  | "no_excursion_observed";

export interface UnobservedPeriod {
  start: string;
  end: string;
  minutes: number;
}

/** One high-temperature event from GET /api/overview (already analysed per logger). */
export interface OverviewExcursion {
  logger_id: number;
  logger_code: string;
  start: string;
  end: string;
  kind: string;
  duration_minutes: number;
  duration_label: string;
  ended_by: string;
}

export interface SeriesSummary {
  logger_id: number;
  code: string;
  observed_minutes: number;
  max_temperature_c: string | null;
  max_temperature_at: string | null;
  excursion_count: number;
  sustained_count: number;
  isolated_spike_count: number;
  unconfirmed_count: number;
  warming_count: number;
  gap_count: number;
  invalid_count: number;
  single_valid_reading: boolean;
}

export interface FridgeOverview {
  fridge_id: number;
  branch: string;
  name: string;
  result: FridgeWeekResultKind;
  max_temperature_c: string | null;
  max_temperature_at: string | null;
  max_temperature_logger: string | null;
  coverage: {
    observed_minutes: number;
    week_minutes: number;
    share: string;
    is_estimate: boolean;
    unobserved_periods: UnobservedPeriod[];
  };
  excursion_count: number;
  sustained_count: number;
  isolated_spike_count: number;
  unconfirmed_count: number;
  warming_count: number;
  gap_count: number;
  invalid_count: number;
  series: SeriesSummary[];
  excursions: OverviewExcursion[];
}

export interface OverviewResponse {
  weeks: string[];
  week: {
    start: string;
    end: string;
    monday: string;
  } | null;
  fridges: FridgeOverview[];
  constants?: Record<string, unknown>;
  notes?: {
    coverage_is_estimate?: boolean;
    unobserved_never_safe?: boolean;
  };
}
