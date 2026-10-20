import type { OverviewResponse } from "../types/overview";
import {
  OverviewLoadError,
  isRetryableStartupFailure,
  messageFromFailureBody,
} from "./loadError";

export async function fetchOverview(week?: string | null): Promise<OverviewResponse> {
  const params = week ? `?week=${encodeURIComponent(week)}` : "";
  let response: Response;
  try {
    response = await fetch(`/api/overview${params}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    throw new OverviewLoadError(message, null, true);
  }
  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      body = "";
    }
    throw new OverviewLoadError(
      messageFromFailureBody(response.status, body),
      response.status,
      isRetryableStartupFailure(response.status, body),
    );
  }
  return response.json() as Promise<OverviewResponse>;
}
