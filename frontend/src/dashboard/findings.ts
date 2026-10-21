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
 * Fields the mockup wants that /api/overview still does not provide.
 */
export const OVERVIEW_MISSING_FOR_CARDS = [
  "gaps[].start / gaps[].end / gaps[].minutes",
  "invalid_readings[].measured_at / raw_value",
] as const;

function invalidReadingHeadline(count: number): string {
  const noun = count === 1 ? "reading" : "readings";
  return `Data issue: ${count} invalid ${noun}`;
}

export function deriveFinding(fridge: FridgeOverview): CardFinding {
  // Priority: sustained high temp > recovered spike > unconfirmed >
  // warming-only > invalid > gap > insufficient > no excursion.
  if (fridge.sustained_count > 0) {
    return {
      tone: "red",
      headline: "High-temperature event",
      detail: fridge.warming_count > 0 ? "Gradual warming detected." : null,
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
      headline: "Gradual warming detected",
      detail: null,
    };
  }

  if (fridge.invalid_count > 0) {
    return {
      tone: "neutral",
      headline: invalidReadingHeadline(fridge.invalid_count),
      detail: null,
    };
  }

  if (fridge.gap_count > 0) {
    return {
      tone: "neutral",
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
      headline: "Gradual warming detected",
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
  totalFridges: number;
  sustainedHighTemps: number;
  noReadings: number;
}

function uniqueFridges(fridges: FridgeOverview[]): FridgeOverview[] {
  const byId = new Map<number, FridgeOverview>();
  for (const fridge of fridges) {
    if (!byId.has(fridge.fridge_id)) byId.set(fridge.fridge_id, fridge);
  }
  return [...byId.values()];
}

function hasRecordedReadings(fridge: FridgeOverview): boolean {
  if (fridge.invalid_count > 0) return true;
  if (fridge.series.some((item) => item.invalid_count > 0)) return true;
  return fridge.series.length > 0;
}

/** Unique physical-fridge counters from the selected overview slice. */
export function summarizeFridges(fridges: FridgeOverview[]): SummaryCounts {
  const unique = uniqueFridges(fridges);
  return {
    totalFridges: unique.length,
    sustainedHighTemps: unique.filter((fridge) => fridge.sustained_count > 0).length,
    noReadings: unique.filter((fridge) => !hasRecordedReadings(fridge)).length,
  };
}
