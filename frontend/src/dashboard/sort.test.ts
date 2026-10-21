import { describe, expect, it } from "vitest";
import { fridge } from "../test/fixtures";
import { groupByCity, loggerCodesLabel, sortFridges, uniqueBranches } from "./sort";

describe("sortFridges", () => {
  it("sorts by city A–Z, then numeric logger, then fridge name", () => {
    const fridges = [
      fridge({
        fridge_id: 1,
        branch: "Tel Aviv",
        name: "Walk-in",
        series: [
          {
            logger_id: 2,
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
            single_valid_reading: false,
          },
        ],
      }),
      fridge({
        fridge_id: 2,
        branch: "Haifa",
        name: "Dairy",
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
            invalid_count: 0,
            single_valid_reading: false,
          },
        ],
      }),
      fridge({
        fridge_id: 3,
        branch: "Tel Aviv",
        name: "Display 2",
        series: [
          {
            logger_id: 2,
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
            single_valid_reading: false,
          },
        ],
      }),
      fridge({
        fridge_id: 4,
        branch: "Rishon LeZion",
        name: "Cream cakes",
        series: [
          {
            logger_id: 3,
            code: "TL-0388",
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
            single_valid_reading: false,
          },
        ],
      }),
    ];

    const sorted = sortFridges(fridges);
    expect(sorted.map((f) => `${f.branch}/${f.name}`)).toEqual([
      "Haifa/Dairy",
      "Rishon LeZion/Cream cakes",
      "Tel Aviv/Display 2",
      "Tel Aviv/Walk-in",
    ]);
  });

  it("uses the lowest numeric logger when a fridge has several series", () => {
    const multi = fridge({
      fridge_id: 10,
      branch: "Tel Aviv",
      name: "Shared",
      series: [
        {
          logger_id: 9,
          code: "TL-0900",
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
          single_valid_reading: false,
        },
        {
          logger_id: 2,
          code: "TL-0200",
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
          single_valid_reading: false,
        },
      ],
    });
    const other = fridge({
      fridge_id: 11,
      branch: "Tel Aviv",
      name: "Later",
      series: [
        {
          logger_id: 5,
          code: "TL-0500",
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
          single_valid_reading: false,
        },
      ],
    });
    expect(sortFridges([other, multi]).map((f) => f.name)).toEqual([
      "Shared",
      "Later",
    ]);
    expect(loggerCodesLabel(multi)).toBe("TL-0200, TL-0900");
  });
});

describe("uniqueBranches", () => {
  it("returns sorted unique branch names from fridge data", () => {
    expect(
      uniqueBranches([
        fridge({ fridge_id: 1, branch: "Tel Aviv", name: "Walk-in" }),
        fridge({ fridge_id: 2, branch: "Haifa", name: "Dairy" }),
        fridge({ fridge_id: 3, branch: "Tel Aviv", name: "Display 2" }),
      ]),
    ).toEqual(["Haifa", "Tel Aviv"]);
  });
});

describe("groupByCity", () => {
  it("groups sorted fridges under city headings", () => {
    const groups = groupByCity([
      fridge({ fridge_id: 1, branch: "Tel Aviv", name: "B" }),
      fridge({ fridge_id: 2, branch: "Haifa", name: "A" }),
      fridge({ fridge_id: 3, branch: "Tel Aviv", name: "A" }),
    ]);
    expect(groups.map((g) => [g.city, g.fridges.length])).toEqual([
      ["Haifa", 1],
      ["Tel Aviv", 2],
    ]);
  });
});
