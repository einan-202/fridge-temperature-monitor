/** Recognised weekly logger-code shape: whole-token `TL-` plus digits. */

const LOGGER_CODE_RE = /(?<![A-Za-z0-9])(TL-\d+)(?![A-Za-z0-9])/gi;

export function extractLoggerCode(filename: string): string | null {
  const stem = filename.replace(/\.[^.]+$/, "");
  const seen = new Map<string, string>();
  for (const match of stem.matchAll(LOGGER_CODE_RE)) {
    const raw = match[1];
    const digits = raw.split("-")[1];
    const normalised = `TL-${digits}`;
    const key = normalised.toLowerCase();
    if (!seen.has(key)) seen.set(key, normalised);
  }
  if (seen.size === 1) return [...seen.values()][0];
  return null;
}
