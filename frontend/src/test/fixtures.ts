import type {
  FridgeOverview,
  OverviewExcursion,
  OverviewResponse,
} from "../types/overview";

function series(
  code: string,
  overrides: Partial<FridgeOverview["series"][number]> = {},
): FridgeOverview["series"][number] {
  return {
    logger_id: 1,
    code,
    observed_minutes: 45,
    max_temperature_c: "4.00",
    max_temperature_at: "2026-09-14 06:00:00",
    excursion_count: 0,
    sustained_count: 0,
    isolated_spike_count: 0,
    unconfirmed_count: 0,
    warming_count: 0,
    gap_count: 0,
    invalid_count: 0,
    single_valid_reading: false,
    ...overrides,
  };
}

export function fridge(
  overrides: Partial<FridgeOverview> & Pick<FridgeOverview, "fridge_id" | "branch" | "name">,
): FridgeOverview {
  const { series: seriesOverride, ...rest } = overrides;
  return {
    result: "insufficient_data",
    max_temperature_c: "4.00",
    max_temperature_at: "2026-09-14 06:00:00",
    max_temperature_logger: "TL-0001",
    coverage: {
      observed_minutes: 0,
      week_minutes: 10080,
      share: "0",
      is_estimate: true,
      unobserved_periods: [],
    },
    excursion_count: 0,
    sustained_count: 0,
    isolated_spike_count: 0,
    unconfirmed_count: 0,
    warming_count: 0,
    gap_count: 0,
    invalid_count: 0,
    series: seriesOverride ?? [series("TL-0001")],
    excursions: [],
    ...rest,
  };
}

export function overviewExcursion(
  overrides: Partial<OverviewExcursion> = {},
): OverviewExcursion {
  return {
    logger_id: 1,
    logger_code: "TL-0001",
    start: "2026-09-14 06:15:00",
    end: "2026-09-14 06:45:00",
    kind: "sustained",
    duration_minutes: 30,
    duration_label: "at least 30 min",
    ended_by: "end_of_data",
    ...overrides,
  };
}

/** Shape aligned with the seeded sample overview (counts only; no invented event times). */
export function sampleOverview(): OverviewResponse {
  return {
    weeks: ["2026-09-14"],
    week: {
      start: "2026-09-14 00:00:00",
      end: "2026-09-21 00:00:00",
      monday: "2026-09-14",
    },
    fridges: [
      // Deliberately unsorted — UI must sort city A–Z, logger numeric, name.
      fridge({
        fridge_id: 4,
        branch: "Rishon LeZion",
        name: "Cream cakes",
        result: "excursion_observed",
        max_temperature_c: "7.10",
        max_temperature_at: "2026-09-14 06:45:00",
        max_temperature_logger: "TL-0388",
        sustained_count: 1,
        excursion_count: 1,
        warming_count: 1,
        series: [
          series("TL-0388", {
            max_temperature_c: "7.10",
            sustained_count: 1,
            excursion_count: 1,
            warming_count: 1,
          }),
        ],
        excursions: [
          overviewExcursion({
            logger_code: "TL-0388",
            start: "2026-09-14 06:15:00",
            end: "2026-09-14 06:45:00",
            kind: "sustained",
            duration_minutes: 30,
            duration_label: "at least 30 min",
            ended_by: "end_of_data",
          }),
        ],
      }),
      fridge({
        fridge_id: 2,
        branch: "Tel Aviv",
        name: "Walk-in",
        result: "excursion_observed",
        max_temperature_c: "9.40",
        max_temperature_at: "2026-09-14 06:15:00",
        max_temperature_logger: "TL-0417",
        isolated_spike_count: 1,
        excursion_count: 1,
        series: [
          series("TL-0417", {
            max_temperature_c: "9.40",
            isolated_spike_count: 1,
            excursion_count: 1,
          }),
        ],
        excursions: [
          overviewExcursion({
            logger_code: "TL-0417",
            start: "2026-09-14 06:15:00",
            end: "2026-09-14 06:15:00",
            kind: "isolated_spike",
            duration_minutes: 0,
            duration_label: "single reading",
            ended_by: "recovered",
          }),
        ],
      }),
      fridge({
        fridge_id: 3,
        branch: "Haifa",
        name: "Dairy",
        result: "insufficient_data",
        max_temperature_c: "3.89",
        max_temperature_at: "2026-09-14 06:15:00",
        max_temperature_logger: "TL-0231",
        invalid_count: 1,
        series: [
          series("TL-0231", {
            max_temperature_c: "3.89",
            invalid_count: 1,
            observed_minutes: 15,
          }),
        ],
      }),
      fridge({
        fridge_id: 1,
        branch: "Jerusalem",
        name: "Dairy",
        result: "insufficient_data",
        max_temperature_c: "4.00",
        max_temperature_at: "2026-09-14 08:30:00",
        max_temperature_logger: "TL-0512",
        gap_count: 1,
        series: [
          series("TL-0512", {
            max_temperature_c: "4.00",
            gap_count: 1,
            observed_minutes: 15,
          }),
        ],
      }),
      fridge({
        fridge_id: 5,
        branch: "Tel Aviv",
        name: "Display 2",
        result: "insufficient_data",
        max_temperature_c: "3.70",
        max_temperature_at: "2026-09-17 06:00:00",
        max_temperature_logger: "TL-0417",
        series: [
          series("TL-0417", {
            max_temperature_c: "3.70",
            max_temperature_at: "2026-09-17 06:00:00",
            observed_minutes: 0,
            single_valid_reading: true,
          }),
        ],
      }),
    ],
    notes: { coverage_is_estimate: true, unobserved_never_safe: true },
  };
}
