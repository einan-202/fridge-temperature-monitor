import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";
import { overviewExcursion, sampleOverview } from "../test/fixtures";
import type { OverviewResponse } from "../types/overview";

function mockOverview(data: OverviewResponse | (() => OverviewResponse)) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url.startsWith("/api/overview")).toBe(true);
      const body = typeof data === "function" ? data() : data;
      return {
        ok: true,
        json: async () => body,
      } as Response;
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function kpiValue(summary: HTMLElement, label: string): string | null {
  const text = within(summary).getByText((_, element) => {
    return (
      element?.classList.contains("summary-counters__label--full") === true &&
      element.textContent === label
    );
  });
  return text.parentElement?.querySelector(".summary-counters__value")?.textContent ?? null;
}

describe("Dashboard", () => {
  it("renders sample overview cards in city / logger order with correct findings", async () => {
    mockOverview(sampleOverview());
    render(<Dashboard />);

    expect(await screen.findByText("Fridge Temperature Monitor")).toBeInTheDocument();
    expect(screen.getByText("Weekly temperature report")).toBeInTheDocument();

    const summary = screen.getByLabelText("Week summary");
    expect(kpiValue(summary, "Total fridges")).toBe("5");
    expect(kpiValue(summary, "Sustained high temps")).toBe("1");
    expect(kpiValue(summary, "No readings")).toBe("0");

    // City headings in A–Z order
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/^Haifa/);
    expect(headings[1]).toMatch(/^Jerusalem/);
    expect(headings[2]).toMatch(/^Rishon LeZion/);
    expect(headings[3]).toMatch(/^Tel Aviv/);

    // Cards: order within document follows sort
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(5);
    expect(cards[0]).toHaveTextContent("Haifa");
    expect(cards[0]).toHaveTextContent("Logger: TL-0231");
    expect(cards[0]).toHaveTextContent("3.89°C");
    expect(cards[0]).toHaveTextContent("Data issue: 1 invalid reading");
    expect(cards[0]).toHaveAttribute("data-tone", "neutral");

    expect(cards[1]).toHaveTextContent("Jerusalem");
    expect(cards[1]).toHaveTextContent("Some readings are missing");
    expect(cards[1]).toHaveAttribute("data-tone", "neutral");

    expect(cards[2]).toHaveTextContent("Rishon LeZion");
    expect(cards[2]).toHaveTextContent("7.1°C");
    expect(cards[2]).toHaveTextContent("High-temperature event");
    expect(cards[2]).not.toHaveTextContent("Temperature stayed above 5°C");
    expect(cards[2]).toHaveAttribute("data-tone", "red");
    expect(cards[2]).toHaveTextContent("First detected: 14 Sep, 06:15");
    expect(cards[2]).toHaveTextContent("Time above 5°C: at least 30 min");
    expect(cards[2]).toHaveTextContent("Recovery not confirmed.");

    expect(cards[3]).toHaveTextContent("Display 2");
    expect(cards[3]).toHaveTextContent("Not enough readings this week");
    expect(cards[3]).toHaveTextContent("Only reading: 17 Sep, 06:00");
    expect(cards[3]).toHaveAttribute("data-tone", "neutral");

    expect(cards[4]).toHaveTextContent("Walk-in");
    expect(cards[4]).toHaveTextContent("9.4°C");
    expect(cards[4]).toHaveTextContent("One high reading — recovered");
    expect(cards[4]).toHaveAttribute("data-tone", "green");
    expect(cards[4]).toHaveTextContent("First detected: 14 Sep, 06:15");
    expect(cards[4]).toHaveTextContent("Isolated high reading");
    expect(cards[4]).toHaveTextContent("Recovery confirmed.");
    expect(cards[4]).not.toHaveTextContent("single reading");

    // No detail CTA in this phase
    expect(screen.queryByText(/View graph/i)).not.toBeInTheDocument();
  });

  it("defaults to the latest week from the API and can select another week", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("week=2026-09-07")) {
        return {
          ok: true,
          json: async () => ({
            ...sampleOverview(),
            weeks: ["2026-09-14", "2026-09-07"],
            week: {
              start: "2026-09-07 00:00:00",
              end: "2026-09-14 00:00:00",
              monday: "2026-09-07",
            },
            fridges: [],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          ...sampleOverview(),
          weeks: ["2026-09-14", "2026-09-07"],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Dashboard />);
    expect(await screen.findByText(/14 Sep – 20 Sep 2026/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/overview");

    await user.click(screen.getByRole("button", { name: "Older week" }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("week=2026-09-07"))).toBe(
        true,
      );
    });
    expect(await screen.findByText(/7 Sep – 13 Sep 2026/)).toBeInTheDocument();
  });

  it("shows a skeleton while the weekly report loads", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    render(<Dashboard />);
    expect(screen.getByTestId("dashboard-skeleton")).toBeInTheDocument();
    expect(screen.getByText(/Loading weekly report/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/°C/)).not.toBeInTheDocument();
    expect(screen.queryByText("Fridge Temperature Monitor")).not.toBeInTheDocument();
    resolveFetch!({
      ok: true,
      json: async () => sampleOverview(),
    } as Response);
    expect(await screen.findByText("Total fridges")).toBeInTheDocument();
    expect(screen.getByText("Fridge Temperature Monitor")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-skeleton")).not.toBeInTheDocument();
  });

  it("does not retry an application HTTP 500", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => '{"detail":"division by zero"}',
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Dashboard />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not load/);
    expect(screen.getByText("division by zero")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("dashboard-skeleton")).not.toBeInTheDocument();
  });

  it("retries a temporary startup failure then shows the report", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts += 1;
        if (attempts < 3) {
          return {
            ok: false,
            status: 503,
            text: async () => '{"detail":"database unreachable"}',
          };
        }
        return { ok: true, json: async () => sampleOverview() };
      }),
    );
    render(<Dashboard />);
    expect(screen.getByTestId("dashboard-skeleton")).toBeInTheDocument();
    expect(
      await screen.findByText("Total fridges", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(attempts).toBe(3);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stops retrying startup failures and keeps Try again", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "Error: connect ECONNREFUSED 172.18.0.3:8000",
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Dashboard />);
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(
      /Could not load/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(screen.queryByTestId("dashboard-skeleton")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByTestId("dashboard-skeleton")).toBeInTheDocument();
  });

  it("shows an empty state when the API returns no fridges", async () => {
    mockOverview({
      weeks: [],
      week: null,
      fridges: [],
    });
    render(<Dashboard />);
    expect(await screen.findByText(/No fridge readings yet/i)).toBeInTheDocument();
  });

  it("keeps one card per fridge when multiple loggers are present", async () => {
    const data = sampleOverview();
    data.fridges = [
      {
        ...data.fridges[0],
        fridge_id: 99,
        branch: "Tel Aviv",
        name: "Shared fridge",
        excursions: [],
        series: [
          {
            logger_id: 8,
            code: "TL-0800",
            observed_minutes: 10,
            max_temperature_c: "4.00",
            max_temperature_at: "2026-09-14 06:00:00",
            excursion_count: 0,
            sustained_count: 0,
            isolated_spike_count: 0,
            unconfirmed_count: 0,
            warming_count: 0,
            gap_count: 0,
            invalid_count: 0,
            single_valid_reading: false,
          },
          {
            logger_id: 2,
            code: "TL-0200",
            observed_minutes: 10,
            max_temperature_c: "4.10",
            max_temperature_at: "2026-09-14 06:15:00",
            excursion_count: 0,
            sustained_count: 0,
            isolated_spike_count: 0,
            unconfirmed_count: 0,
            warming_count: 0,
            gap_count: 0,
            invalid_count: 0,
            single_valid_reading: false,
          },
        ],
      },
    ];
    mockOverview(data);
    render(<Dashboard />);
    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent("Logger: TL-0200, TL-0800");
  });

  it("asks to open fridge details for the clicked card and selected week", async () => {
    const user = userEvent.setup();
    const onOpenFridge = vi.fn();
    mockOverview(sampleOverview());
    render(<Dashboard onOpenFridge={onOpenFridge} />);
    await screen.findByRole("article", {
      name: "View details for Cream cakes, Rishon LeZion",
    });
    await user.click(
      screen.getByRole("article", {
        name: "View details for Cream cakes, Rishon LeZion",
      }),
    );
    expect(onOpenFridge).toHaveBeenCalledTimes(1);
    expect(onOpenFridge.mock.calls[0][0].fridge.fridge_id).toBe(4);
    expect(onOpenFridge.mock.calls[0][0].fridge.name).toBe("Cream cakes");
    expect(onOpenFridge.mock.calls[0][0].week).toBe("2026-09-14");
  });

  it("shows different fridge-card events after switching weeks", async () => {
    const user = userEvent.setup();
    const cream = sampleOverview().fridges.find((item) => item.name === "Cream cakes")!;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("week=2026-09-07")) {
        return {
          ok: true,
          json: async () => ({
            weeks: ["2026-09-14", "2026-09-07"],
            week: {
              start: "2026-09-07 00:00:00",
              end: "2026-09-14 00:00:00",
              monday: "2026-09-07",
            },
            fridges: [
              {
                ...cream,
                excursions: [
                  overviewExcursion({
                    logger_code: "TL-0388",
                    start: "2026-09-07 06:00:00",
                    end: "2026-09-07 06:00:00",
                    kind: "isolated_spike",
                    duration_minutes: 0,
                    duration_label: "single reading",
                    ended_by: "recovered",
                  }),
                ],
                sustained_count: 0,
                isolated_spike_count: 1,
                warming_count: 0,
              },
            ],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          ...sampleOverview(),
          weeks: ["2026-09-14", "2026-09-07"],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Dashboard />);
    expect(await screen.findByText("Fridge: Cream cakes")).toBeInTheDocument();
    const creamCard = screen.getByText("Fridge: Cream cakes").closest("article")!;
    expect(creamCard).toHaveTextContent("Time above 5°C: at least 30 min");
    expect(creamCard).toHaveTextContent("Recovery not confirmed.");

    await user.click(screen.getByRole("button", { name: "Older week" }));
    expect(await screen.findByText(/7 Sep – 13 Sep 2026/)).toBeInTheDocument();
    const olderCard = screen.getByText("Fridge: Cream cakes").closest("article")!;
    expect(olderCard).toHaveTextContent("First detected: 7 Sep, 06:00");
    expect(olderCard).toHaveTextContent("Isolated high reading");
    expect(olderCard).toHaveTextContent("Recovery confirmed.");
    expect(olderCard).not.toHaveTextContent("at least 30 min");
  });

  it("filters cards and KPI counts by branch without fetching again", async () => {
    const user = userEvent.setup();
    mockOverview(sampleOverview());
    render(<Dashboard />);
    expect(await screen.findAllByRole("article")).toHaveLength(5);

    const branchFilter = screen.getByRole("combobox", { name: "Branch" });
    expect(branchFilter).toHaveDisplayValue("All branches");
    expect(Array.from((branchFilter as HTMLSelectElement).options).map((o) => o.text)).toEqual([
      "All branches",
      "Haifa",
      "Jerusalem",
      "Rishon LeZion",
      "Tel Aviv",
    ]);

    const fetchMock = vi.mocked(fetch);
    const callsBeforeFilter = fetchMock.mock.calls.length;
    await user.selectOptions(branchFilter, "Tel Aviv");
    expect(fetchMock.mock.calls.length).toBe(callsBeforeFilter);

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Display 2");
    expect(cards[1]).toHaveTextContent("Walk-in");
    expect(screen.getByRole("heading", { name: /Tel Aviv/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Haifa/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Rishon LeZion/ })).not.toBeInTheDocument();

    const summary = screen.getByLabelText("Week summary");
    expect(kpiValue(summary, "Total fridges")).toBe("2");
    expect(kpiValue(summary, "Sustained high temps")).toBe("0");
    expect(kpiValue(summary, "No readings")).toBe("0");

    await user.selectOptions(branchFilter, "All branches");
    expect(screen.getAllByRole("article")).toHaveLength(5);
    const restored = screen.getByLabelText("Week summary");
    expect(kpiValue(restored, "Total fridges")).toBe("5");
    expect(kpiValue(restored, "Sustained high temps")).toBe("1");
    expect(kpiValue(restored, "No readings")).toBe("0");
  });

  it("keeps the branch filter when switching weeks and handles an empty branch week", async () => {
    const user = userEvent.setup();
    const haifa = sampleOverview().fridges.find((item) => item.branch === "Haifa")!;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("week=2026-09-07")) {
        return {
          ok: true,
          json: async () => ({
            weeks: ["2026-09-14", "2026-09-07"],
            week: {
              start: "2026-09-07 00:00:00",
              end: "2026-09-14 00:00:00",
              monday: "2026-09-07",
            },
            fridges: [haifa],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          ...sampleOverview(),
          weeks: ["2026-09-14", "2026-09-07"],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Dashboard />);
    await screen.findByRole("combobox", { name: "Branch" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Branch" }), "Tel Aviv");
    expect(screen.getAllByRole("article")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Older week" }));
    expect(await screen.findByText(/7 Sep – 13 Sep 2026/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Branch" })).toHaveDisplayValue("Tel Aviv");
    expect(screen.getByText("No fridge readings for this branch this week.")).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Haifa/ })).not.toBeInTheDocument();
    const summary = screen.getByLabelText("Week summary");
    expect(within(summary).getAllByText("0")).toHaveLength(3);
  });
});
