import { describe, expect, it } from "vitest";
import {
  compareFilenames,
  remapRecordByFileIdentity,
  sortFilesNaturally,
} from "./filenameSort";

function file(name: string): File {
  return new File(["x"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("sortFilesNaturally", () => {
  it("orders numbered prefixes as 01, 02, 10", () => {
    const files = [
      file("10_TL-0100.xlsx"),
      file("02_TL-0200.xlsx"),
      file("01_TL-0100.xlsx"),
    ];
    expect(sortFilesNaturally(files).map((item) => item.name)).toEqual([
      "01_TL-0100.xlsx",
      "02_TL-0200.xlsx",
      "10_TL-0100.xlsx",
    ]);
  });

  it("compares numeric tokens instead of lexicographic strings", () => {
    expect(compareFilenames("2.xlsx", "10.xlsx")).toBeLessThan(0);
  });

  it("remaps per-file state onto the sorted order", () => {
    const a = file("02.xlsx");
    const b = file("01.xlsx");
    const prev = [a, b];
    const next = sortFilesNaturally(prev);
    expect(remapRecordByFileIdentity(prev, next, { 0: "A", 1: "B" })).toEqual({
      0: "B",
      1: "A",
    });
  });
});
