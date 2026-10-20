import type { FridgeOverview } from "../types/overview";
import { loggerNumericKey } from "./format";

/** Lowest numeric logger code on the fridge (for multi-logger cards). */
export function primaryLoggerCode(fridge: FridgeOverview): string {
  if (fridge.series.length === 0) {
    return fridge.max_temperature_logger ?? "";
  }
  const sorted = [...fridge.series].sort(
    (a, b) =>
      loggerNumericKey(a.code) - loggerNumericKey(b.code) ||
      a.code.localeCompare(b.code),
  );
  return sorted[0]?.code ?? "";
}

export function loggerCodesLabel(fridge: FridgeOverview): string {
  if (fridge.series.length === 0) {
    return fridge.max_temperature_logger ?? "—";
  }
  const codes = [...fridge.series]
    .map((s) => s.code)
    .sort(
      (a, b) => loggerNumericKey(a) - loggerNumericKey(b) || a.localeCompare(b),
    );
  return codes.join(", ");
}

/**
 * City A–Z, then numeric logger ascending, then fridge name A–Z.
 * Severity is never used.
 */
export function sortFridges(fridges: FridgeOverview[]): FridgeOverview[] {
  return [...fridges].sort((a, b) => {
    const city = a.branch.localeCompare(b.branch);
    if (city !== 0) return city;
    const logger =
      loggerNumericKey(primaryLoggerCode(a)) -
      loggerNumericKey(primaryLoggerCode(b));
    if (logger !== 0) return logger;
    return a.name.localeCompare(b.name);
  });
}

export interface CityGroup {
  city: string;
  fridges: FridgeOverview[];
}

export function groupByCity(fridges: FridgeOverview[]): CityGroup[] {
  const sorted = sortFridges(fridges);
  const groups: CityGroup[] = [];
  for (const fridge of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.city === fridge.branch) {
      last.fridges.push(fridge);
    } else {
      groups.push({ city: fridge.branch, fridges: [fridge] });
    }
  }
  return groups;
}
