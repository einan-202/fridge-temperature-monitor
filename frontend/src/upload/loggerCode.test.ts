import { describe, expect, it } from "vitest";
import { extractLoggerCode } from "./loggerCode";

describe("extractLoggerCode", () => {
  it("extracts TL-0777 from a typical weekly filename", () => {
    const name = "07_TL-0777_Haifa_NEW_Temp_Time.xlsx";
    expect(extractLoggerCode(name)).toBe("TL-0777");
    expect(extractLoggerCode(name)).not.toBe("07");
    expect(extractLoggerCode(name)).not.toBe("TL");
    expect(extractLoggerCode(name)).not.toBe(name.replace(/\.xlsx$/i, ""));
  });

  it("normalizes casing", () => {
    expect(extractLoggerCode("tl-0777_week.xlsx")).toBe("TL-0777");
  });

  it("returns null when the filename has no identifiable logger", () => {
    expect(extractLoggerCode("random_export.xlsx")).toBeNull();
    expect(extractLoggerCode("07_Haifa_NEW.xlsx")).toBeNull();
  });

  it("returns null when two logger codes are present", () => {
    expect(extractLoggerCode("TL-0777_TL-0417.xlsx")).toBeNull();
  });
});
