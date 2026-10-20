import type { SeriesGap, SeriesReading } from "../types/series";

const THRESHOLD_C = 5;

export function temperatureNumber(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isHighTemperature(value: string | null | undefined): boolean {
  const n = temperatureNumber(value);
  return n != null && n > THRESHOLD_C;
}

/**
 * Split one logger's chronological readings into polylines.
 * A new segment starts at a null temperature (ERR) or at a backend-reported gap.
 * Never interpolates across missing data.
 */
export function splitValidSegments(
  readings: SeriesReading[],
  gaps: SeriesGap[],
): SeriesReading[][] {
  const gapAfter = new Set(gaps.map((gap) => `${gap.start}|${gap.end}`));
  const segments: SeriesReading[][] = [];
  let current: SeriesReading[] = [];

  const flush = () => {
    if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  };

  for (const reading of readings) {
    const temp = temperatureNumber(reading.temperature_c);
    if (temp == null) {
      flush();
      continue;
    }
    if (current.length > 0) {
      const previous = current[current.length - 1];
      if (gapAfter.has(`${previous.measured_at}|${reading.measured_at}`)) {
        flush();
      }
    }
    current.push(reading);
  }
  flush();
  return segments;
}

export { THRESHOLD_C };
