import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fridge } from "../test/fixtures";
import {
  creamCakesSeries,
  emptySeries,
  haifaDairySeries,
  jerusalemDairySeries,
  walkInSeries,
} from "../test/seriesFixtures";
import type { SeriesDetail } from "../types/series";
import { FridgeDetails } from "./FridgeDetails";

function mockSeries(body: SeriesDetail | SeriesDetail[] | (() => Response)) {
  const list = typeof body === "function" ? null : Array.isArray(body) ? body : [body];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (typeof body === "function") return body();
    const url = String(input);
    const match = list!.find((item) =>
      url.startsWith(`/api/series/${item.logger_id}/${item.fridge_id}`),
    );
    if (!match) {
      return { ok: false, status: 404, text: async () => "missing" } as Response;
    }
    return { ok: true, json: async () => match } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function creamFridge() {
  return fridge({
    fridge_id: 4,
    branch: "Rishon LeZion",
    name: "Cream cakes",
    coverage: {
      observed_minutes: 45,
      week_minutes: 10080,
      share: "0.00",
      is_estimate: true,
      unobserved_periods: [],
    },
    series: [
      {
        logger_id: 10,
        code: "TL-0388",
        observed_minutes: 45,
        max_temperature_c: "7.10",
        max_temperature_at: "2026-09-14 06:45:00",
        excursion_count: 1,
        sustained_count: 1,
        isolated_spike_count: 0,
        unconfirmed_count: 0,
        warming_count: 1,
        gap_count: 0,
        invalid_count: 0,
        single_valid_reading: false,
      },
    ],
  });
}

const weekProps = {
  week: "2026-09-14",
  weekStart: "2026-09-14 00:00:00",
  weekEnd: "2026-09-21 00:00:00",
};

describe("FridgeDetails", () => {
  it("opens the selected fridge and week and fetches series once", async () => {
    const fetchMock = mockSeries(creamCakesSeries());
    const onBack = vi.fn();
    render(
      <FridgeDetails fridge={creamFridge()} {...weekProps} onBack={onBack} />,
    );

    expect(await screen.findByRole("heading", { name: "Cream cakes" })).toBeInTheDocument();
    expect(screen.getByText("Rishon LeZion")).toBeInTheDocument();
    expect(screen.getByText(/TL-0388/)).toBeInTheDocument();
    expect(screen.getByText(/Mon–Sun/)).toBeInTheDocument();
    expect(screen.getByText(/14 Sep – 20 Sep 2026/)).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/series/10/4?week=2026-09-14");

    const days = screen.getAllByRole("tab");
    expect(days).toHaveLength(7);
    expect(days[0]).toHaveTextContent("Mon");
    expect(days[0]).toHaveTextContent("14");
    expect(days[6]).toHaveTextContent("Sun");
    expect(days[6]).toHaveTextContent("20");
    expect(days[0]).toHaveAttribute("aria-selected", "true");
    expect(days[0]).not.toHaveClass("day-picker__btn--empty");
    expect(days[1]).toHaveClass("day-picker__btn--empty");

    expect(screen.getByText("This week's findings")).toBeInTheDocument();
    expect(screen.getByText("High temperatures")).toBeInTheDocument();
    expect(screen.getByText(/First detected:/)).toHaveTextContent("14 Sep, 06:15");
    expect(screen.getByText(/Time above 5°C:/)).toHaveTextContent("at least 30 min");
    expect(
      screen.getByText("Recovery not confirmed. Last recorded high reading: 14 Sep, 06:45."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Incomplete week: 45 of 10080 min \(estimate\)/),
    ).toBeInTheDocument();
  });

  it("switches days without refetching", async () => {
    const user = userEvent.setup();
    const fetchMock = mockSeries(creamCakesSeries());
    render(<FridgeDetails fridge={creamFridge()} {...weekProps} onBack={() => undefined} />);
    expect(await screen.findByRole("img", { name: /Temperature chart/ })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("tab", { name: /Tue/ }));
    expect(screen.getByText("No readings available")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Unknown, not confirmed safe.")).toBeInTheDocument();
    expect(screen.getByText("This week's findings")).toBeInTheDocument();
  });

  it("plots chronological time and highlights high readings", async () => {
    mockSeries(creamCakesSeries());
    render(<FridgeDetails fridge={creamFridge()} {...weekProps} onBack={() => undefined} />);
    const chart = await screen.findByRole("img", { name: /Temperature chart/ });
    const points = chart.querySelectorAll("circle.day-chart__point");
    expect(points).toHaveLength(4);
    const xs = [...points].map((el) => Number(el.getAttribute("cx")));
    expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1], 5);
    expect(xs[2] - xs[1]).toBeCloseTo(xs[3] - xs[2], 5);
    expect(points[0]).toHaveAttribute("data-high", "false");
    expect(points[1]).toHaveAttribute("data-high", "true");
    expect(chart.querySelector(".day-chart__threshold")).not.toBeNull();
    expect(within(chart).getByText("5°C")).toBeInTheDocument();
  });

  it("keeps a tapped reading's time and temperature visible", async () => {
    const user = userEvent.setup();
    mockSeries(creamCakesSeries());
    render(<FridgeDetails fridge={creamFridge()} {...weekProps} onBack={() => undefined} />);
    const chart = await screen.findByRole("img", { name: /Temperature chart/ });
    const hits = chart.querySelectorAll("circle.day-chart__hit");
    expect(hits.length).toBeGreaterThan(0);
    await user.click(hits[1]);
    expect(screen.getByRole("status")).toHaveTextContent("TL-0388");
    expect(screen.getByRole("status")).toHaveTextContent("2026-09-14 06:15");
    expect(screen.getByRole("status")).toHaveTextContent("5.4°C");
  });

  it("keeps a recovered spike as its own high point", async () => {
    mockSeries(walkInSeries());
    const walkFridge = fridge({
      fridge_id: 2,
      branch: "Tel Aviv",
      name: "Walk-in",
      series: [
        {
          logger_id: 11,
          code: "TL-0417",
          observed_minutes: 45,
          max_temperature_c: "9.40",
          max_temperature_at: "2026-09-14 06:15:00",
          excursion_count: 1,
          sustained_count: 0,
          isolated_spike_count: 1,
          unconfirmed_count: 0,
          warming_count: 0,
          gap_count: 0,
          invalid_count: 0,
          single_valid_reading: false,
        },
      ],
    });
    render(<FridgeDetails fridge={walkFridge} {...weekProps} onBack={() => undefined} />);
    const chart = await screen.findByRole("img", { name: /Temperature chart/ });
    const high = chart.querySelectorAll('circle.day-chart__point[data-high="true"]');
    expect(high).toHaveLength(1);
    expect(high[0]).toHaveAttribute("data-temp", "9.4");
    expect(high[0]).toHaveAttribute("data-measured-at", "2026-09-14 06:15:00");
    expect(screen.getByText("Temperature returned below 5°C.")).toBeInTheDocument();
    expect(screen.getByText(/Time above 5°C/)).toHaveTextContent("single reading");
  });

  it("does not draw a continuous line across a data gap", async () => {
    mockSeries(jerusalemDairySeries());
    const dairy = fridge({
      fridge_id: 1,
      branch: "Jerusalem",
      name: "Dairy",
      series: [
        {
          logger_id: 12,
          code: "TL-0512",
          observed_minutes: 15,
          max_temperature_c: "4.00",
          max_temperature_at: "2026-09-14 08:30:00",
          excursion_count: 0,
          sustained_count: 0,
          isolated_spike_count: 0,
          unconfirmed_count: 0,
          warming_count: 0,
          gap_count: 1,
          invalid_count: 0,
          single_valid_reading: false,
        },
      ],
    });
    render(<FridgeDetails fridge={dairy} {...weekProps} onBack={() => undefined} />);
    const chart = await screen.findByRole("img", { name: /Temperature chart/ });
    const points = [...chart.querySelectorAll("circle.day-chart__point")];
    expect(points).toHaveLength(3);
    const x0600 = Number(points[0].getAttribute("cx"));
    const x0615 = Number(points[1].getAttribute("cx"));
    const x0830 = Number(points[2].getAttribute("cx"));
    expect(x0830 - x0600).toBeCloseTo((x0615 - x0600) * 10, 5);
    expect(chart.querySelectorAll("path.day-chart__line")).toHaveLength(1);
    expect(screen.getByText(/Missing readings/)).toBeInTheDocument();
    expect(screen.getByText(/135 min/)).toBeInTheDocument();
  });

  it("breaks the line at an ERR reading", async () => {
    mockSeries(haifaDairySeries());
    const haifa = fridge({
      fridge_id: 3,
      branch: "Haifa",
      name: "Dairy",
      series: [
        {
          logger_id: 13,
          code: "TL-0231",
          observed_minutes: 15,
          max_temperature_c: "3.89",
          max_temperature_at: "2026-09-14 06:15:00",
          excursion_count: 0,
          sustained_count: 0,
          isolated_spike_count: 0,
          unconfirmed_count: 0,
          warming_count: 0,
          gap_count: 0,
          invalid_count: 1,
          single_valid_reading: false,
        },
      ],
    });
    render(<FridgeDetails fridge={haifa} {...weekProps} onBack={() => undefined} />);
    const chart = await screen.findByRole("img", { name: /Temperature chart/ });
    expect(chart.querySelectorAll("circle.day-chart__point")).toHaveLength(2);
    expect(screen.getByText(/Invalid readings/)).toBeInTheDocument();
    expect(screen.getByText(/ERR/)).toBeInTheDocument();
  });

  it("plots multiple loggers as separate identified series", async () => {
    const a = creamCakesSeries();
    const b = {
      ...walkInSeries(),
      fridge_id: 4,
      fridge_name: "Cream cakes",
      branch: "Rishon LeZion",
    };
    mockSeries([a, b]);
    const multi = fridge({
      fridge_id: 4,
      branch: "Rishon LeZion",
      name: "Cream cakes",
      series: [
        {
          logger_id: 10,
          code: "TL-0388",
          observed_minutes: 45,
          max_temperature_c: "7.10",
          max_temperature_at: "2026-09-14 06:45:00",
          excursion_count: 1,
          sustained_count: 1,
          isolated_spike_count: 0,
          unconfirmed_count: 0,
          warming_count: 0,
          gap_count: 0,
          invalid_count: 0,
          single_valid_reading: false,
        },
        {
          logger_id: 11,
          code: "TL-0417",
          observed_minutes: 45,
          max_temperature_c: "9.40",
          max_temperature_at: "2026-09-14 06:15:00",
          excursion_count: 1,
          sustained_count: 0,
          isolated_spike_count: 1,
          unconfirmed_count: 0,
          warming_count: 0,
          gap_count: 0,
          invalid_count: 0,
          single_valid_reading: false,
        },
      ],
    });
    render(<FridgeDetails fridge={multi} {...weekProps} onBack={() => undefined} />);
    expect(await screen.findByRole("img", { name: /Temperature chart/ })).toBeInTheDocument();
    expect(screen.getAllByText("TL-0388").length).toBeGreaterThan(0);
    expect(screen.getAllByText("TL-0417").length).toBeGreaterThan(0);
    const chart = screen.getByRole("img", { name: /Temperature chart/ });
    const paths = [...chart.querySelectorAll("path.day-chart__line")];
    expect(paths.map((p) => p.getAttribute("data-logger")).sort()).toEqual([
      "TL-0388",
      "TL-0417",
    ]);
    expect(screen.getByText(/TL-0388, TL-0417/)).toBeInTheDocument();
  });

  it("lists every high-temperature event from the series API, grouped by logger", async () => {
    const first = creamCakesSeries();
    const withTwoEvents = {
      ...first,
      excursions: [
        ...first.excursions,
        {
          start: "2026-09-16 08:00:00",
          end: "2026-09-16 08:15:00",
          peak_c: "6.20",
          reading_count: 2,
          duration_minutes: 15,
          duration_label: "15 min",
          ended_by: "recovered",
          kind: "sustained",
        },
      ],
    };
    const otherLogger = {
      ...walkInSeries(),
      fridge_id: 4,
      fridge_name: "Cream cakes",
      branch: "Rishon LeZion",
    };
    mockSeries([withTwoEvents, otherLogger]);
    const multi = fridge({
      fridge_id: 4,
      branch: "Rishon LeZion",
      name: "Cream cakes",
      series: [
        {
          logger_id: 10,
          code: "TL-0388",
          observed_minutes: 45,
          max_temperature_c: "7.10",
          max_temperature_at: "2026-09-14 06:45:00",
          excursion_count: 2,
          sustained_count: 2,
          isolated_spike_count: 0,
          unconfirmed_count: 0,
          warming_count: 0,
          gap_count: 0,
          invalid_count: 0,
          single_valid_reading: false,
        },
        {
          logger_id: 11,
          code: "TL-0417",
          observed_minutes: 45,
          max_temperature_c: "9.40",
          max_temperature_at: "2026-09-14 06:15:00",
          excursion_count: 1,
          sustained_count: 0,
          isolated_spike_count: 1,
          unconfirmed_count: 0,
          warming_count: 0,
          gap_count: 0,
          invalid_count: 0,
          single_valid_reading: false,
        },
      ],
    });
    render(<FridgeDetails fridge={multi} {...weekProps} onBack={() => undefined} />);
    const findings = await screen.findByRole("region", { name: "This week's findings" });
    expect(within(findings).getByRole("heading", { name: "TL-0388" })).toBeInTheDocument();
    expect(within(findings).getByRole("heading", { name: "TL-0417" })).toBeInTheDocument();

    const events = findings.querySelectorAll(".weekly-findings__event");
    expect(events).toHaveLength(3);
    expect(events[0]).toHaveTextContent("First detected: 14 Sep, 06:15");
    expect(events[0]).toHaveTextContent("Time above 5°C: at least 30 min");
    expect(events[0]).toHaveTextContent(
      "Recovery not confirmed. Last recorded high reading: 14 Sep, 06:45.",
    );
    expect(events[1]).toHaveTextContent("First detected: 16 Sep, 08:00");
    expect(events[1]).toHaveTextContent("Time above 5°C: 15 min");
    expect(events[1]).toHaveTextContent("Temperature returned below 5°C.");
    expect(events[2]).toHaveTextContent("First detected: 14 Sep, 06:15");
    expect(events[2]).toHaveTextContent("Time above 5°C: single reading");
    expect(events[2]).toHaveTextContent("Temperature returned below 5°C.");
    expect(findings).not.toHaveTextContent("45 min");
    expect(findings).not.toHaveTextContent("at least 45");
  });

  it("does not say the fridge stayed high until Sunday when Monday recordings ended", async () => {
    const truncated = creamCakesSeries();
    mockSeries({
      ...truncated,
      excursions: truncated.excursions.map((item) => ({
        ...item,
        ended_by: "end_of_period",
      })),
    });
    render(<FridgeDetails fridge={creamFridge()} {...weekProps} onBack={() => undefined} />);
    expect(
      await screen.findByText(
        "Recovery not confirmed. Last recorded high reading: 14 Sep, 06:45.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Time above 5°C:/)).toHaveTextContent("at least 30 min");
    expect(
      screen.queryByText(
        "Last high reading was near the end of the week. Recovery not confirmed.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Still above 5°C at the last recorded reading."),
    ).not.toBeInTheDocument();
  });

  it("states confirmed recovery without implying the week ended high", async () => {
    const recovered = creamCakesSeries();
    mockSeries({
      ...recovered,
      excursions: [
        {
          start: "2026-09-14 06:15:00",
          end: "2026-09-14 06:15:00",
          peak_c: "5.40",
          reading_count: 1,
          duration_minutes: 0,
          duration_label: "single reading",
          ended_by: "recovered",
          kind: "isolated_spike",
        },
      ],
    });
    render(<FridgeDetails fridge={creamFridge()} {...weekProps} onBack={() => undefined} />);
    expect(await screen.findByText("Temperature returned below 5°C.")).toBeInTheDocument();
    expect(screen.getByText(/Time above 5°C:/)).toHaveTextContent("single reading");
    expect(screen.queryByText(/Recovery not confirmed/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Last high reading was near the end of the week. Recovery not confirmed.",
      ),
    ).not.toBeInTheDocument();
  });

  it("says recovery is unconfirmed near the reporting-week boundary", async () => {
    mockSeries({
      ...creamCakesSeries(),
      excursions: [
        {
          start: "2026-09-20 23:30:00",
          end: "2026-09-20 23:45:00",
          peak_c: "6.20",
          reading_count: 2,
          duration_minutes: 15,
          duration_label: "at least 15 min",
          ended_by: "end_of_period",
          kind: "sustained",
        },
      ],
    });
    render(<FridgeDetails fridge={creamFridge()} {...weekProps} onBack={() => undefined} />);
    expect(
      await screen.findByText(
        "Last high reading was near the end of the week. Recovery not confirmed.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/First detected:/)).toHaveTextContent("20 Sep, 23:30");
    expect(screen.getByText(/Time above 5°C:/)).toHaveTextContent("at least 15 min");
  });

  it("shows empty and error states", async () => {
    mockSeries(emptySeries());
    const emptyFridge = fridge({
      fridge_id: 9,
      branch: "Haifa",
      name: "Spare",
      series: [
        {
          logger_id: 99,
          code: "TL-0001",
          observed_minutes: 0,
          max_temperature_c: null,
          max_temperature_at: null,
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
    });
    const { unmount } = render(
      <FridgeDetails fridge={emptyFridge} {...weekProps} onBack={() => undefined} />,
    );
    expect(await screen.findByText("No readings available")).toBeInTheDocument();
    expect(
      screen.getByText("No high temperatures this week."),
    ).toBeInTheDocument();
    unmount();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "boom",
      })),
    );
    render(<FridgeDetails fridge={creamFridge()} {...weekProps} onBack={() => undefined} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load the temperature chart",
    );
  });

  it("returns to the dashboard from the back action", async () => {
    const user = userEvent.setup();
    mockSeries(creamCakesSeries());
    const onBack = vi.fn();
    render(<FridgeDetails fridge={creamFridge()} {...weekProps} onBack={onBack} />);
    await screen.findByRole("heading", { name: "Cream cakes" });
    expect(screen.getByRole("button", { name: "← Back" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
