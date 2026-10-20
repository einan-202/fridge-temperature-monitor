import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";
import { sampleOverview } from "../test/fixtures";
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

describe("Dashboard", () => {
  it("renders sample overview cards in city / logger order with correct findings", async () => {
    mockOverview(sampleOverview());
    render(<Dashboard />);

    expect(await screen.findByText("Fridge Temperature Monitor")).toBeInTheDocument();
    expect(screen.getByText("Weekly temperature report")).toBeInTheDocument();

    const summary = screen.getByLabelText("Week summary");
    expect(within(summary).getByText("Fridges with data")).toBeInTheDocument();
    expect(within(summary).getByText("5")).toBeInTheDocument();
    expect(within(summary).getByText("1")).toBeInTheDocument();
    expect(within(summary).getByText("3")).toBeInTheDocument();

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
    expect(cards[0]).toHaveTextContent("One invalid reading");
    expect(cards[0]).toHaveAttribute("data-tone", "amber");

    expect(cards[1]).toHaveTextContent("Jerusalem");
    expect(cards[1]).toHaveTextContent("Some readings are missing");
    expect(cards[1]).toHaveAttribute("data-tone", "amber");

    expect(cards[2]).toHaveTextContent("Rishon LeZion");
    expect(cards[2]).toHaveTextContent("7.1°C");
    expect(cards[2]).toHaveTextContent("Temperature stayed above 5°C");
    expect(cards[2]).toHaveTextContent("Temperature rose gradually");
    expect(cards[2]).toHaveAttribute("data-tone", "red");
    // First detected / duration are not on /api/overview — must be omitted
    expect(cards[2]).not.toHaveTextContent("First detected");
    expect(cards[2]).not.toHaveTextContent("30 minutes");

    expect(cards[3]).toHaveTextContent("Display 2");
    expect(cards[3]).toHaveTextContent("Not enough readings this week");
    expect(cards[3]).toHaveTextContent("Only reading: 17 Sep, 06:00");
    expect(cards[3]).toHaveAttribute("data-tone", "neutral");

    expect(cards[4]).toHaveTextContent("Walk-in");
    expect(cards[4]).toHaveTextContent("9.4°C");
    expect(cards[4]).toHaveTextContent("One high reading — recovered");
    expect(cards[4]).toHaveAttribute("data-tone", "green");
    expect(cards[4]).not.toHaveTextContent("First detected");

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

  it("shows a loading state then an error state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { ok: false, status: 500 } as Response;
      }),
    );
    render(<Dashboard />);
    expect(screen.getByText(/Loading weekly report/i)).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not load/);
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
});
