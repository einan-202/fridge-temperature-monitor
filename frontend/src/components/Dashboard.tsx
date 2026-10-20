import { useCallback, useEffect, useRef, useState } from "react";
import { OverviewLoadError, OVERVIEW_RETRY_DELAYS_MS, sleep } from "../api/loadError";
import { fetchOverview } from "../api/overview";
import { summarizeFridges } from "../dashboard/findings";
import { groupByCity } from "../dashboard/sort";
import type { OverviewResponse } from "../types/overview";
import { DashboardSkeleton } from "./DashboardSkeleton";
import { FridgeCard } from "./FridgeCard";
import { SummaryCounters } from "./SummaryCounters";
import { WeekSelector } from "./WeekSelector";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: OverviewResponse };

export function Dashboard() {
  const [week, setWeek] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const requestId = useRef(0);

  const load = useCallback(async (selected: string | null) => {
    const id = ++requestId.current;
    setState({ status: "loading" });
    let lastMessage = "Could not load the weekly report";

    for (let attempt = 0; attempt <= OVERVIEW_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const data = await fetchOverview(selected);
        if (id !== requestId.current) return;
        setState({ status: "ready", data });
        if (data.week?.monday) {
          setWeek(data.week.monday);
        } else {
          setWeek(null);
        }
        return;
      } catch (err) {
        lastMessage =
          err instanceof Error ? err.message : "Could not load the weekly report";
        const retryable =
          err instanceof OverviewLoadError ? err.retryable : true;
        const hasRetry = attempt < OVERVIEW_RETRY_DELAYS_MS.length;
        if (!retryable || !hasRetry) break;
        await sleep(OVERVIEW_RETRY_DELAYS_MS[attempt]);
        if (id !== requestId.current) return;
      }
    }

    if (id !== requestId.current) return;
    setState({ status: "error", message: lastMessage });
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  const onWeekChange = (monday: string) => {
    setWeek(monday);
    void load(monday);
  };

  return (
    <div className="dashboard" aria-busy={state.status === "loading"}>
      <header className="dashboard__header">
        <div className="dashboard__titles">
          {state.status === "loading" ? (
            <>
              <div className="skeleton skeleton--title" />
              <div className="skeleton skeleton--subtitle" />
            </>
          ) : (
            <>
              <h1 className="dashboard__title">Fridge Temperature Monitor</h1>
              <p className="dashboard__subtitle">Weekly temperature report</p>
            </>
          )}
        </div>
        {state.status === "ready" && state.data.week ? (
          <WeekSelector
            weeks={state.data.weeks}
            monday={week}
            weekStart={state.data.week.start}
            weekEnd={state.data.week.end}
            onChange={onWeekChange}
          />
        ) : state.status === "loading" ? (
          <div className="skeleton skeleton--week" />
        ) : null}
      </header>

      {state.status === "loading" ? (
        <>
          <p className="visually-hidden" role="status">
            Loading weekly report…
          </p>
          <DashboardSkeleton />
        </>
      ) : null}

      {state.status === "error" ? (
        <div className="dashboard__status dashboard__status--error" role="alert">
          <p>Could not load the weekly report.</p>
          <p className="dashboard__status-detail">{state.message}</p>
          <button type="button" className="dashboard__retry" onClick={() => void load(week)}>
            Try again
          </button>
        </div>
      ) : null}

      {state.status === "ready" && state.data.fridges.length === 0 ? (
        <div className="dashboard__status" role="status">
          <p>No fridge readings yet.</p>
          <p className="dashboard__status-detail">
            Load a historical file in Initial Setup, then open this report again.
          </p>
        </div>
      ) : null}

      {state.status === "ready" && state.data.fridges.length > 0 ? (
        <>
          <SummaryCounters counts={summarizeFridges(state.data.fridges)} />
          <div className="dashboard__groups">
            {groupByCity(state.data.fridges).map((group) => (
              <section
                key={group.city}
                className={
                  group.fridges.length > 1
                    ? "city-group city-group--wide"
                    : "city-group"
                }
              >
                <h2 className="city-group__heading">
                  {group.city}{" "}
                  <span className="city-group__count">
                    ({group.fridges.length}{" "}
                    {group.fridges.length === 1 ? "fridge" : "fridges"})
                  </span>
                </h2>
                <div className="city-group__grid">
                  {group.fridges.map((fridge) => (
                    <FridgeCard key={fridge.fridge_id} fridge={fridge} />
                  ))}
                </div>
              </section>
            ))}
          </div>
          <p className="dashboard__footnote">
            This is a weekly retrospective from recorded readings. It does not
            show live fridge status, and periods without nearby readings are
            unknown — not confirmed safe.
          </p>
        </>
      ) : null}
    </div>
  );
}
