import { describe, expect, it } from "vitest";
import {
  deriveFinding,
  summarizeFridges,
} from "./findings";
import { fridge } from "../test/fixtures";
import { sampleOverview } from "../test/fixtures";

describe("deriveFinding", () => {
  it("shows red for sustained high temperature, with gradual warming as support", () => {
    const finding = deriveFinding(
      fridge({
        fridge_id: 1,
        branch: "Rishon LeZion",
        name: "Cream cakes",
        sustained_count: 1,
        warming_count: 1,
        result: "excursion_observed",
      }),
    );
    expect(finding.tone).toBe("red");
    expect(finding.headline).toBe("High-temperature event");
    expect(finding.detail).toBe("Gradual warming detected.");
  });

  it("shows green for a confirmed recovered isolated spike", () => {
    const finding = deriveFinding(
      fridge({
        fridge_id: 2,
        branch: "Tel Aviv",
        name: "Walk-in",
        isolated_spike_count: 1,
        result: "excursion_observed",
      }),
    );
    expect(finding.tone).toBe("green");
    expect(finding.headline).toBe("One high reading — recovered");
    expect(finding.detail).toBeNull();
  });

  it("prefers sustained (red) over recovered spike when both are present", () => {
    const finding = deriveFinding(
      fridge({
        fridge_id: 3,
        branch: "X",
        name: "Y",
        sustained_count: 1,
        isolated_spike_count: 1,
        result: "excursion_observed",
      }),
    );
    expect(finding.tone).toBe("red");
  });

  it("shows amber for a warming trend that needs attention", () => {
    const finding = deriveFinding(
      fridge({
        fridge_id: 8,
        branch: "Haifa",
        name: "Super",
        warming_count: 1,
        result: "warming_observed",
      }),
    );
    expect(finding.tone).toBe("amber");
    expect(finding.headline).toBe("Gradual warming detected");
  });

  it("shows a neutral data-issue finding with the backend invalid count", () => {
    const finding = deriveFinding(
      fridge({
        fridge_id: 4,
        branch: "Haifa",
        name: "Dairy",
        invalid_count: 1,
        result: "insufficient_data",
      }),
    );
    expect(finding.tone).toBe("neutral");
    expect(finding.headline).toBe("Data issue: 1 invalid reading");
    expect(finding.detail).toBeNull();
  });

  it("pluralizes invalid readings from the backend count", () => {
    const finding = deriveFinding(
      fridge({
        fridge_id: 9,
        branch: "Haifa",
        name: "Dairy",
        invalid_count: 2,
        result: "insufficient_data",
      }),
    );
    expect(finding.headline).toBe("Data issue: 2 invalid readings");
  });

  it("shows a neutral finding for missing readings without inventing an interval", () => {
    const finding = deriveFinding(
      fridge({
        fridge_id: 5,
        branch: "Jerusalem",
        name: "Dairy",
        gap_count: 1,
        result: "insufficient_data",
      }),
    );
    expect(finding.tone).toBe("neutral");
    expect(finding.headline).toBe("Some readings are missing");
    expect(finding.detail).toBeNull();
  });

  it("shows neutral for insufficient data and uses max_temperature_at when it is a lone reading", () => {
    const finding = deriveFinding(
      fridge({
        fridge_id: 6,
        branch: "Tel Aviv",
        name: "Display 2",
        result: "insufficient_data",
        max_temperature_at: "2026-09-17 06:00:00",
        series: [
          {
            logger_id: 1,
            code: "TL-0417",
            observed_minutes: 0,
            max_temperature_c: "3.70",
            max_temperature_at: "2026-09-17 06:00:00",
            excursion_count: 0,
            sustained_count: 0,
            isolated_spike_count: 0,
            unconfirmed_count: 0,
            warming_count: 0,
            gap_count: 0,
            invalid_count: 0,
            single_valid_reading: true,
          },
        ],
      }),
    );
    expect(finding.tone).toBe("neutral");
    expect(finding.headline).toBe("Not enough readings this week");
    expect(finding.detail).toBe("Only reading: 17 Sep, 06:00.");
  });

  it("omits the only-reading detail when max_temperature_at is unavailable", () => {
    const finding = deriveFinding(
      fridge({
        fridge_id: 7,
        branch: "Tel Aviv",
        name: "Display 2",
        result: "insufficient_data",
        max_temperature_at: null,
        series: [
          {
            logger_id: 1,
            code: "TL-0417",
            observed_minutes: 0,
            max_temperature_c: null,
            max_temperature_at: null,
            excursion_count: 0,
            sustained_count: 0,
            isolated_spike_count: 0,
            unconfirmed_count: 0,
            warming_count: 0,
            gap_count: 0,
            invalid_count: 0,
            single_valid_reading: true,
          },
        ],
      }),
    );
    expect(finding.detail).toBeNull();
  });
});

describe("summarizeFridges", () => {
  it("counts unique physical fridges from the selected overview", () => {
    const counts = summarizeFridges(sampleOverview().fridges);
    expect(counts.totalFridges).toBe(5);
    expect(counts.sustainedHighTemps).toBe(1);
    expect(counts.noReadings).toBe(0);
  });

  it("counts each fridge once and treats invalid readings as recorded", () => {
    const shared = fridge({
      fridge_id: 99,
      branch: "Tel Aviv",
      name: "Shared",
      series: [
        {
          logger_id: 2,
          code: "TL-0200",
          observed_minutes: 10,
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
        },
        {
          logger_id: 8,
          code: "TL-0800",
          observed_minutes: 10,
          max_temperature_c: "4.10",
          max_temperature_at: "2026-09-14 06:15:00",
          excursion_count: 0,
          sustained_count: 0,
          isolated_spike_count: 0,
          unconfirmed_count: 0,
          warming_count: 0,
          gap_count: 0,
          invalid_count: 0,
          single_valid_reading: false,
        },
      ],
    });
    const empty = fridge({
      fridge_id: 100,
      branch: "Tel Aviv",
      name: "Empty",
      series: [],
    });
    const invalidOnly = fridge({
      fridge_id: 101,
      branch: "Haifa",
      name: "Dairy",
      invalid_count: 1,
      series: [
        {
          logger_id: 1,
          code: "TL-0231",
          observed_minutes: 0,
          max_temperature_c: null,
          max_temperature_at: null,
          excursion_count: 0,
          sustained_count: 0,
          isolated_spike_count: 0,
          unconfirmed_count: 0,
          warming_count: 0,
          gap_count: 0,
          invalid_count: 1,
          single_valid_reading: false,
        },
      ],
    });
    const sustained = fridge({
      fridge_id: 102,
      branch: "Rishon LeZion",
      name: "Cream cakes",
      sustained_count: 1,
      series: [
        {
          logger_id: 4,
          code: "TL-0388",
          observed_minutes: 30,
          max_temperature_c: "7.10",
          max_temperature_at: "2026-09-14 06:45:00",
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
    });
    const counts = summarizeFridges([shared, shared, empty, invalidOnly, sustained]);
    expect(counts.totalFridges).toBe(4);
    expect(counts.sustainedHighTemps).toBe(1);
    expect(counts.noReadings).toBe(1);
  });
});
