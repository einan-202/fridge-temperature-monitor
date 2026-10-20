import type { SeriesDetail } from "../types/series";

export async function fetchSeries(
  loggerId: number,
  fridgeId: number,
  week?: string | null,
): Promise<SeriesDetail> {
  const params = week ? `?week=${encodeURIComponent(week)}` : "";
  let response: Response;
  try {
    response = await fetch(`/api/series/${loggerId}/${fridgeId}${params}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    throw new Error(message);
  }
  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      body = "";
    }
    throw new Error(messageFromSeriesFailure(response.status, body));
  }
  return response.json() as Promise<SeriesDetail>;
}

function messageFromSeriesFailure(status: number, body: string): string {
  const trimmed = body.trim();
  if (status === 404) {
    return "Those readings could not be found.";
  }
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as { detail?: unknown };
      if (typeof parsed.detail === "string" && parsed.detail) {
        return parsed.detail;
      }
    } catch {
      /* use fallback */
    }
  }
  return "Could not load the temperature chart.";
}
