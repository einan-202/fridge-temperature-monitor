import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { sampleOverview } from "./test/fixtures";
import { creamCakesSeries } from "./test/seriesFixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockDashboardAndSeries() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/overview")) {
      const week = url.includes("week=2026-09-07")
        ? {
            ...sampleOverview(),
            weeks: ["2026-09-14", "2026-09-07"],
            week: {
              start: "2026-09-07 00:00:00",
              end: "2026-09-14 00:00:00",
              monday: "2026-09-07",
            },
            fridges: sampleOverview().fridges,
          }
        : { ...sampleOverview(), weeks: ["2026-09-14", "2026-09-07"] };
      return { ok: true, json: async () => week } as Response;
    }
    if (url.startsWith("/api/series/")) {
      return { ok: true, json: async () => creamCakesSeries() } as Response;
    }
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("App fridge details navigation", () => {
  it("opens the clicked fridge, keeps the week, and does not fetch series from the dashboard", async () => {
    const user = userEvent.setup();
    const fetchMock = mockDashboardAndSeries();
    render(<App />);

    expect(await screen.findByText("Fridge Temperature Monitor")).toBeInTheDocument();
    expect(fetchMock.mock.calls.every((c) => String(c[0]).startsWith("/api/overview"))).toBe(
      true,
    );

    await user.click(screen.getByRole("button", { name: "Older week" }));
    expect(await screen.findByText(/7 Sep – 13 Sep 2026/)).toBeInTheDocument();

    const overviewCalls = fetchMock.mock.calls.length;
    await user.click(
      screen.getByRole("article", {
        name: "View details for Cream cakes, Rishon LeZion",
      }),
    );

    const detailsHeading = await screen.findByRole("heading", { name: "Cream cakes" });
    const details = detailsHeading.closest(".fridge-details") as HTMLElement;
    expect(within(details).getByText(/7 Sep – 13 Sep 2026/)).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← Back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fridge Details" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/api/series/")),
      ).toBe(true);
    });
    const seriesCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).startsWith("/api/series/"),
    );
    expect(seriesCalls).toHaveLength(1);
    expect(String(seriesCalls[0][0])).toContain("week=2026-09-07");
    expect(fetchMock.mock.calls.length).toBe(overviewCalls + 1);

    await user.click(screen.getByRole("tab", { name: /Tue/ }));
    expect(screen.getByText("No readings available")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/series/")),
    ).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "← Back" }));
    const dashboardTitle = screen.getByRole("heading", {
      name: "Fridge Temperature Monitor",
    });
    const dashboard = dashboardTitle.closest(".dashboard") as HTMLElement;
    expect(within(dashboard).getByText(/7 Sep – 13 Sep 2026/)).toBeInTheDocument();
    expect(
      within(dashboard).getByRole("article", {
        name: "View details for Cream cakes, Rishon LeZion",
      }),
    ).toBeInTheDocument();
  });

  it("keeps the selected branch after returning from fridge details", async () => {
    const user = userEvent.setup();
    mockDashboardAndSeries();
    render(<App />);

    await screen.findByRole("combobox", { name: "Branch" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Branch" }), "Rishon LeZion");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: /Rishon LeZion/ })).toBeInTheDocument();

    await user.click(
      screen.getByRole("article", {
        name: "View details for Cream cakes, Rishon LeZion",
      }),
    );
    expect(await screen.findByRole("button", { name: "← Back" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "← Back" }));
    const dashboard = screen
      .getByRole("heading", { name: "Fridge Temperature Monitor" })
      .closest(".dashboard") as HTMLElement;
    expect(within(dashboard).getByRole("combobox", { name: "Branch" })).toHaveDisplayValue(
      "Rishon LeZion",
    );
    expect(within(dashboard).getAllByRole("article")).toHaveLength(1);
    expect(
      within(dashboard).getByRole("article", {
        name: "View details for Cream cakes, Rishon LeZion",
      }),
    ).toBeInTheDocument();
    expect(within(dashboard).queryByRole("heading", { name: /Tel Aviv/ })).not.toBeInTheDocument();
  });
});
