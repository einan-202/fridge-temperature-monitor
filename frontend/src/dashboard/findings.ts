/**
 * Map overview fridge fields to a single card finding.
 *
 * Uses only backend classifications and counts. Does not analyse temperatures.
 * Timestamps that are not present on /api/overview are omitted (never invented).
 */

import type { FridgeOverview } from "../types/overview";
import { formatShortDateTime } from "./format";

export type FindingTone = "red" | "green" | "amber" | "neutral";

export interface CardFinding {
  tone: FindingTone;
  /** Primary line shown next to the status icon. */
  headline: string;
  /** Optional shorter supporting line (at most one). */
  detail: string | null;
}

/**
 * Fields the mockup wants that /api/overview does not currently provide.
 * Kept here so tests and the completion report stay aligned.
 */
export const OVERVIEW_MISSING_FOR_CARDS = [
  "excursions[].start (First detected)",
  "excursions[].end / recovery time",
  "excursions[].duration_minutes / duration_label",
  "excursions[].ended_by (beyond aggregated isolated_spike_count)",
  "gaps[].start / gaps[].end / gaps[].minutes",
  "invalid_readings[].measured_at / raw_value",
] as const;

export function deriveFinding(fridge: FridgeOverview): CardFinding {
  // Priority: sustained high temp > recovered spike > unconfirmed >
  // warming-only > invalid > gap > insufficient > no excursion.
  if (fridge.sustained_count > 0) {
    return {
      tone: "red",
      headline: "Temperature stayed above 5°C",
      detail: fridge.warming_count > 0 ? "Temperature rose gradually." : null,
    };
  }

  if (fridge.isolated_spike_count > 0) {
    return {
      tone: "green",
      headline: "One high reading — recovered",
      detail: null,
    };
  }

  if (fridge.unconfirmed_count > 0) {
    return {
      tone: "amber",
      headline: "High reading could not be confirmed",
      detail: null,
    };
  }

  if (fridge.warming_count > 0 && fridge.result === "warming_observed") {
    return {
      tone: "amber",
      headline: "Temperature rose gradually",
      detail: null,
    };
  }

  if (fridge.invalid_count > 0) {
    return {
      tone: "amber",
      headline: "One invalid reading",
      detail: null,
    };
  }

  if (fridge.gap_count > 0) {
    return {
      tone: "amber",
      headline: "Some readings are missing",
      detail: null,
    };
  }

  if (fridge.result === "insufficient_data") {
    const onlyReading = fridge.series.some((s) => s.single_valid_reading)
      ? formatShortDateTime(fridge.max_temperature_at)
      : null;
    return {
      tone: "neutral",
      headline: "Not enough readings this week",
      detail: onlyReading ? `Only reading: ${onlyReading}.` : null,
    };
  }

  if (fridge.result === "no_excursion_observed") {
    return {
      tone: "neutral",
      headline: "No excursion observed in the recorded readings",
      detail: null,
    };
  }

  if (fridge.result === "warming_observed") {
    return {
      tone: "amber",
      headline: "Temperature rose gradually",
      detail: null,
    };
  }

  // Fallback for excursion_observed without sustained/spike counts (should not happen).
  return {
    tone: "neutral",
    headline: "See weekly records for details",
    detail: null,
  };
}

export interface SummaryCounts {
  fridgesWithData: number;
  extendedHighTemperature: number;
  incompleteRecords: number;
}

/** Unique-fridge counters derived from overview results (not events). */
export function summarizeFridges(fridges: FridgeOverview[]): SummaryCounts {
  return {
    fridgesWithData: fridges.filter((f) => f.series.length > 0).length,
    extendedHighTemperature: fridges.filter((f) => f.sustained_count > 0).length,
    incompleteRecords: fridges.filter((f) => f.result === "insufficient_data")
      .length,
  };
}
