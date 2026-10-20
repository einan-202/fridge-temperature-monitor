import { describe, expect, it } from "vitest";
import { groupMappingMismatches, loggerMismatchHeadline } from "./mismatches";

describe("groupMappingMismatches", () => {
  it("collapses repeated logger mismatches into one group", () => {
    const mismatches = Array.from({ length: 20 }, (_, i) => ({
      row_number: i + 2,
      field: "Logger",
      found: "TL-0388",
      expected: "TL-0512",
      message: "row",
    }));
    const groups = groupMappingMismatches(mismatches);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(20);
    expect(loggerMismatchHeadline(groups[0])).toBe(
      "20 rows contain TL-0388, but TL-0512 was selected.",
    );
  });
});
