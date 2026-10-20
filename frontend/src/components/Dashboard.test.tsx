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
    expect(await screen.findByText("Fridges with data")).toBeInTheDocument();
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
      await screen.findByText("Fridges with data", {}, { timeout: 4000 }),
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
});
