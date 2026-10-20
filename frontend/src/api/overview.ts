import type { OverviewResponse } from "../types/overview";

export async function fetchOverview(week?: string | null): Promise<OverviewResponse> {
  const params = week ? `?week=${encodeURIComponent(week)}` : "";
  const response = await fetch(`/api/overview${params}`);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json() as Promise<OverviewResponse>;
}
