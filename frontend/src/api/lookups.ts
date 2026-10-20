import type { LookupsResponse } from "../types/upload";

export async function fetchLookups(): Promise<LookupsResponse> {
  const response = await fetch("/api/lookups");
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json() as Promise<LookupsResponse>;
}
