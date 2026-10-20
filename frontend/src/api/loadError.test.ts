import { describe, expect, it } from "vitest";
import { isRetryableStartupFailure, messageFromFailureBody } from "./loadError";

describe("isRetryableStartupFailure", () => {
  it("retries network failures with no HTTP status", () => {
    expect(isRetryableStartupFailure(null, "")).toBe(true);
  });

  it("retries gateway and unavailability statuses", () => {
    expect(isRetryableStartupFailure(502, "")).toBe(true);
    expect(isRetryableStartupFailure(503, '{"detail":"database unreachable"}')).toBe(
      true,
    );
    expect(isRetryableStartupFailure(504, "")).toBe(true);
  });

  it("retries a Vite proxy 500 when the backend is not listening", () => {
    expect(
      isRetryableStartupFailure(500, "Error: connect ECONNREFUSED 172.18.0.3:8000"),
    ).toBe(true);
    expect(isRetryableStartupFailure(500, "")).toBe(true);
    expect(isRetryableStartupFailure(500, "Internal Server Error")).toBe(true);
  });

  it("does not retry an application 500 with a FastAPI detail", () => {
    expect(
      isRetryableStartupFailure(500, '{"detail":"division by zero"}'),
    ).toBe(false);
  });

  it("does not retry client errors", () => {
    expect(isRetryableStartupFailure(400, '{"detail":"invalid week"}')).toBe(false);
    expect(isRetryableStartupFailure(404, "")).toBe(false);
  });
});

describe("messageFromFailureBody", () => {
  it("prefers FastAPI detail text", () => {
    expect(messageFromFailureBody(500, '{"detail":"boom"}')).toBe("boom");
  });

  it("falls back to the status when the body is empty", () => {
    expect(messageFromFailureBody(500, "")).toBe("Request failed with status 500");
  });
});
