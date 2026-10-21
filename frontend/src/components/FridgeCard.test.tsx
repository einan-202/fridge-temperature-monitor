import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fridge, overviewExcursion } from "../test/fixtures";
import { FridgeCard } from "./FridgeCard";

describe("FridgeCard event summary", () => {
  it("keeps the existing display when there are no excursions", () => {
    render(
      <FridgeCard
        fridge={fridge({
          fridge_id: 1,
          branch: "Jerusalem",
          name: "Dairy",
          gap_count: 1,
          result: "insufficient_data",
        })}
      />,
    );
    expect(screen.getByText("Some readings are missing")).toBeInTheDocument();
    expect(screen.queryByText(/First detected/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Recovery/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Isolated high reading/)).not.toBeInTheDocument();
  });

  it("shows a recovered sustained event using backend labels", () => {
    render(
      <FridgeCard
        fridge={fridge({
          fridge_id: 1,
          branch: "A",
          name: "B",
          result: "excursion_observed",
          sustained_count: 1,
          excursion_count: 1,
          excursions: [
            overviewExcursion({
              duration_label: "30 min",
              ended_by: "recovered",
            }),
          ],
        })}
      />,
    );
    const finding = screen.getByText("High-temperature event").closest(".fridge-card__finding");
    expect(finding).toHaveTextContent("First detected: 14 Sep, 06:15");
    expect(finding).toHaveTextContent("Time above 5°C: 30 min");
    expect(finding).toHaveTextContent("Recovery confirmed.");
    expect(screen.queryByText("Temperature stayed above 5°C")).not.toBeInTheDocument();
  });

  it("shows unrecovered end_of_data without fabricating recovery", () => {
    render(
      <FridgeCard
        fridge={fridge({
          fridge_id: 1,
          branch: "A",
          name: "B",
          result: "excursion_observed",
          sustained_count: 1,
          excursion_count: 1,
          excursions: [overviewExcursion({ ended_by: "end_of_data" })],
        })}
      />,
    );
    const finding = screen.getByText("High-temperature event").closest(".fridge-card__finding");
    expect(finding).toHaveTextContent("Time above 5°C: at least 30 min");
    expect(finding).toHaveTextContent("Recovery not confirmed.");
  });

  it("maps end_of_period to unconfirmed recovery", () => {
    render(
      <FridgeCard
        fridge={fridge({
          fridge_id: 1,
          branch: "A",
          name: "B",
          result: "excursion_observed",
          sustained_count: 1,
          excursion_count: 1,
          excursions: [
            overviewExcursion({
              start: "2026-09-20 23:30:00",
              end: "2026-09-20 23:45:00",
              duration_label: "at least 15 min",
              ended_by: "end_of_period",
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText("First detected: 20 Sep, 23:30")).toBeInTheDocument();
    expect(screen.getByText("Time above 5°C: at least 15 min")).toBeInTheDocument();
    expect(screen.getByText("Recovery not confirmed.")).toBeInTheDocument();
  });

  it("maps a gap interruption without claiming recovery", () => {
    render(
      <FridgeCard
        fridge={fridge({
          fridge_id: 1,
          branch: "A",
          name: "B",
          result: "excursion_observed",
          sustained_count: 1,
          excursion_count: 1,
          excursions: [
            overviewExcursion({
              duration_label: "at least 15 min",
              ended_by: "gap",
            }),
          ],
        })}
      />,
    );
    expect(
      screen.getByText("Recovery not confirmed; readings interrupted."),
    ).toBeInTheDocument();
  });

  it("maps an invalid-reading interruption", () => {
    render(
      <FridgeCard
        fridge={fridge({
          fridge_id: 1,
          branch: "A",
          name: "B",
          result: "excursion_observed",
          unconfirmed_count: 1,
          excursion_count: 1,
          excursions: [
            overviewExcursion({
              kind: "unconfirmed",
              duration_label: "at least 15 min",
              ended_by: "invalid_reading",
            }),
          ],
        })}
      />,
    );
    expect(
      screen.getByText(
        "Recovery not confirmed; invalid reading interrupted the evidence.",
      ),
    ).toBeInTheDocument();
  });

  it("shows isolated high reading without treating single reading as duration", () => {
    render(
      <FridgeCard
        fridge={fridge({
          fridge_id: 1,
          branch: "Tel Aviv",
          name: "Walk-in",
          result: "excursion_observed",
          isolated_spike_count: 1,
          excursion_count: 1,
          excursions: [
            overviewExcursion({
              kind: "isolated_spike",
              duration_minutes: 0,
              duration_label: "single reading",
              ended_by: "recovered",
            }),
          ],
        })}
      />,
    );
    const finding = screen.getByText("One high reading — recovered").closest(".fridge-card__finding");
    expect(finding).toHaveTextContent("Isolated high reading");
    expect(finding).toHaveTextContent("Recovery confirmed.");
    expect(screen.queryByText(/single reading/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Time above 5°C/)).not.toBeInTheDocument();
  });

  it("prefers a sustained event and reports additional events", () => {
    render(
      <FridgeCard
        fridge={fridge({
          fridge_id: 1,
          branch: "A",
          name: "B",
          result: "excursion_observed",
          sustained_count: 1,
          isolated_spike_count: 1,
          excursion_count: 2,
          excursions: [
            overviewExcursion({
              kind: "isolated_spike",
              start: "2026-09-14 06:00:00",
              end: "2026-09-14 06:00:00",
              duration_minutes: 0,
              duration_label: "single reading",
              ended_by: "recovered",
            }),
            overviewExcursion({
              start: "2026-09-14 08:00:00",
              end: "2026-09-14 08:30:00",
              ended_by: "end_of_data",
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText("First detected: 14 Sep, 08:00")).toBeInTheDocument();
    expect(screen.getByText("Time above 5°C: at least 30 min")).toBeInTheDocument();
    expect(screen.getByText("1 more event")).toBeInTheDocument();
    expect(screen.queryByText("Isolated high reading")).not.toBeInTheDocument();
  });
});
