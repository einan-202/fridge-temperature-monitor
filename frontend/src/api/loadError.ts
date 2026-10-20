/** Classify fetch failures so only temporary startup outages are retried. */

const STARTUP_HINT =
  /econnrefused|econnreset|etimedout|eai_again|enotfound|enotconn|ehostunreach|socket hang up|network error|failed to fetch|load failed|connect |connection refused|backend.*(start|down|unavailable)|service unavailable|temporarily unavailable|database is not ready|database.*unreachable/i;

export class OverviewLoadError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = "OverviewLoadError";
    this.status = status;
    this.retryable = retryable;
  }
}

export function isRetryableStartupFailure(
  status: number | null,
  body: string,
): boolean {
  if (status === null) return true;
  if (status === 502 || status === 503 || status === 504) return true;
  if (status !== 500) return false;

  const text = body.trim();
  if (!text) return true;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (typeof record.detail === "string" && record.detail.trim()) {
        return STARTUP_HINT.test(record.detail);
      }
      return STARTUP_HINT.test(JSON.stringify(parsed));
    }
  } catch {
    /* plain-text Vite proxy errors */
  }
  return STARTUP_HINT.test(text) || /internal server error/i.test(text);
}

export function messageFromFailureBody(status: number, body: string): string {
  const text = body.trim();
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        if (typeof record.detail === "string" && record.detail.trim()) {
          return record.detail;
        }
        if (typeof record.message === "string" && record.message.trim()) {
          return record.message;
        }
      }
    } catch {
      if (text.length < 180 && !text.startsWith("<")) return text;
    }
  }
  return `Request failed with status ${status}`;
}

export const OVERVIEW_RETRY_DELAYS_MS = [300, 600, 1200] as const;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
