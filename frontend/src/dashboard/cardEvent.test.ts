import { describe, expect, it } from "vitest";
import { fridge } from "../test/fixtures";
import type { OverviewExcursion } from "../types/overview";
import {
  cardEventSummary,
  recoveryStatusLabel,
  selectFeaturedExcursion,
} from "./cardEvent";

function event(overrides: Partial<OverviewExcursion> = {}): OverviewExcursion {
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

describe("recoveryStatusLabel", () => {
  it("maps ended_by without inventing recovery", () => {
    expect(recoveryStatusLabel("recovered")).toBe("Recovery confirmed.");
    expect(recoveryStatusLabel("end_of_data")).toBe("Recovery not confirmed.");
    expect(recoveryStatusLabel("end_of_period")).toBe("Recovery not confirmed.");
    expect(recoveryStatusLabel("gap")).toBe(
      "Recovery not confirmed; readings interrupted.",
    );
    expect(recoveryStatusLabel("invalid_reading")).toBe(
      "Recovery not confirmed; invalid reading interrupted the evidence.",
    );
    expect(recoveryStatusLabel("unknown")).toBeNull();
  });
});

describe("selectFeaturedExcursion", () => {
  it("returns null when there are no events", () => {
    expect(selectFeaturedExcursion([])).toBeNull();
  });

  it("prefers sustained over an earlier isolated spike", () => {
    const isolated = event({
      kind: "isolated_spike",
      start: "2026-09-14 06:00:00",
      end: "2026-09-14 06:00:00",
      duration_minutes: 0,
      duration_label: "single reading",
      ended_by: "recovered",
    });
    const sustained = event({
      start: "2026-09-14 08:00:00",
      end: "2026-09-14 08:30:00",
    });
    expect(selectFeaturedExcursion([isolated, sustained])).toEqual(sustained);
  });

  it("uses start then logger_id when kinds match", () => {
    const later = event({ logger_id: 1, start: "2026-09-14 08:00:00" });
    const earlierOtherLogger = event({
      logger_id: 9,
      logger_code: "TL-0009",
      start: "2026-09-14 07:00:00",
    });
    expect(selectFeaturedExcursion([later, earlierOtherLogger])).toEqual(
      earlierOtherLogger,
    );
  });
});

describe("cardEventSummary", () => {
  it("is omitted when the fridge has no excursions", () => {
    expect(
      cardEventSummary(
        fridge({ fridge_id: 1, branch: "Haifa", name: "Dairy", excursions: [] }),
      ),
    ).toBeNull();
  });

  it("shows recovered sustained duration and recovery", () => {
    const summary = cardEventSummary(
      fridge({
        fridge_id: 1,
        branch: "A",
        name: "B",
        excursions: [
          event({
            duration_label: "30 min",
            ended_by: "recovered",
          }),
        ],
      }),
    );
    expect(summary).toMatchObject({
      startLabel: "14 Sep, 06:15",
      durationLabel: "30 min",
      isolated: false,
      recoveryLabel: "Recovery confirmed.",
      moreCount: 0,
      showLogger: false,
    });
  });

  it("does not treat single reading as a duration", () => {
    const summary = cardEventSummary(
      fridge({
        fridge_id: 1,
        branch: "A",
        name: "B",
        excursions: [
          event({
            kind: "unconfirmed",
            duration_minutes: 0,
            duration_label: "single reading",
            ended_by: "end_of_period",
          }),
        ],
      }),
    );
    expect(summary?.durationLabel).toBeNull();
    expect(summary?.isolated).toBe(false);
    expect(summary?.recoveryLabel).toBe("Recovery not confirmed.");
  });

  it("labels isolated spikes without a duration and only confirmed recovery", () => {
    const recovered = cardEventSummary(
      fridge({
        fridge_id: 1,
        branch: "A",
        name: "B",
        excursions: [
          event({
            kind: "isolated_spike",
            duration_minutes: 0,
            duration_label: "single reading",
            ended_by: "recovered",
          }),
        ],
      }),
    );
    expect(recovered).toMatchObject({
      isolated: true,
      durationLabel: null,
      recoveryLabel: "Recovery confirmed.",
    });

    const unconfirmed = cardEventSummary(
      fridge({
        fridge_id: 1,
        branch: "A",
        name: "B",
        excursions: [
          event({
            kind: "isolated_spike",
            duration_minutes: 0,
            duration_label: "single reading",
            ended_by: "end_of_data",
          }),
        ],
      }),
    );
    expect(unconfirmed?.isolated).toBe(true);
    expect(unconfirmed?.durationLabel).toBeNull();
    expect(unconfirmed?.recoveryLabel).toBeNull();
  });

  it("counts additional events and keeps logger series separate", () => {
    const summary = cardEventSummary(
      fridge({
        fridge_id: 1,
        branch: "A",
        name: "B",
        series: [
          {
            logger_id: 2,
            code: "TL-0002",
            observed_minutes: 10,
            max_temperature_c: "6.00",
            max_temperature_at: "2026-09-14 06:00:00",
            excursion_count: 1,
            sustained_count: 0,
            isolated_spike_count: 1,
            unconfirmed_count: 0,
            warming_count: 0,
            gap_count: 0,
            invalid_count: 0,
            single_valid_reading: false,
          },
          {
            logger_id: 8,
            code: "TL-0008",
            observed_minutes: 10,
            max_temperature_c: "7.00",
            max_temperature_at: "2026-09-14 08:00:00",
            excursion_count: 1,
            sustained_count: 1,
            isolated_spike_count: 0,
            unconfirmed_count: 0,
            warming_count: 0,
            gap_count: 0,
            invalid_count: 0,
            single_valid_reading: false,
          },
        ],
        excursions: [
          event({
            logger_id: 2,
            logger_code: "TL-0002",
            kind: "isolated_spike",
            start: "2026-09-14 06:00:00",
            end: "2026-09-14 06:00:00",
            duration_minutes: 0,
            duration_label: "single reading",
            ended_by: "recovered",
          }),
          event({
            logger_id: 8,
            logger_code: "TL-0008",
            start: "2026-09-14 08:00:00",
            end: "2026-09-14 08:30:00",
            duration_label: "at least 30 min",
            ended_by: "gap",
          }),
        ],
      }),
    );
    expect(summary).toMatchObject({
      loggerCode: "TL-0008",
      showLogger: true,
      isolated: false,
      durationLabel: "at least 30 min",
      recoveryLabel: "Recovery not confirmed; readings interrupted.",
      moreCount: 1,
      startLabel: "14 Sep, 08:00",
    });
  });
});
