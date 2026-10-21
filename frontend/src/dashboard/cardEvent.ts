/**
 * Compact fridge-card display of overview excursions.
 * Selects and formats backend fields only — no event detection or durations.
 */

import type { FridgeOverview, OverviewExcursion } from "../types/overview";
import { formatShortDateTime } from "./format";

const KIND_RANK: Record<string, number> = {
  sustained: 0,
  unconfirmed: 1,
  isolated_spike: 2,
};

/** Backend duration_label for a single sample — not a measured duration. */
const SINGLE_READING_LABEL = "single reading";

export interface CardEventSummary {
  startLabel: string;
  loggerCode: string;
  showLogger: boolean;
  isolated: boolean;
  durationLabel: string | null;
  recoveryLabel: string | null;
  moreCount: number;
}

export function recoveryStatusLabel(endedBy: string): string | null {
  switch (endedBy) {
    case "recovered":
      return "Recovery confirmed.";
    case "end_of_data":
    case "end_of_period":
      return "Recovery not confirmed.";
    case "gap":
      return "Recovery not confirmed; readings interrupted.";
    case "invalid_reading":
      return "Recovery not confirmed; invalid reading interrupted the evidence.";
    default:
      return null;
  }
}

export function selectFeaturedExcursion(
  excursions: OverviewExcursion[],
): OverviewExcursion | null {
  if (excursions.length === 0) return null;
  return [...excursions].sort((a, b) => {
    const kindA = KIND_RANK[a.kind] ?? 99;
    const kindB = KIND_RANK[b.kind] ?? 99;
    if (kindA !== kindB) return kindA - kindB;
    const start = a.start.localeCompare(b.start);
    if (start !== 0) return start;
    if (a.logger_id !== b.logger_id) return a.logger_id - b.logger_id;
    return a.logger_code.localeCompare(b.logger_code);
  })[0];
}

export function cardEventSummary(fridge: FridgeOverview): CardEventSummary | null {
  const events = fridge.excursions;
  const featured = selectFeaturedExcursion(events);
  if (!featured) return null;

  const isolated = featured.kind === "isolated_spike";
  const measuredDuration =
    !isolated && featured.duration_label !== SINGLE_READING_LABEL
      ? featured.duration_label
      : null;
  const recovery =
    isolated && featured.ended_by !== "recovered"
      ? null
      : recoveryStatusLabel(featured.ended_by);

  const loggerIds = new Set(events.map((event) => event.logger_id));
  const showLogger = loggerIds.size > 1 || fridge.series.length > 1;

  return {
    startLabel: formatShortDateTime(featured.start) ?? featured.start,
    loggerCode: featured.logger_code,
    showLogger,
    isolated,
    durationLabel: measuredDuration,
    recoveryLabel: recovery,
    moreCount: events.length - 1,
  };
}
