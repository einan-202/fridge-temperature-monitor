import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSeries } from "../api/series";
import { defaultDayIso, readingDayIso, weekDays } from "../chart/days";
import {
  formatShortDateTime,
  formatWeekRange,
  loggerNumericKey,
  parseApiDateTime,
} from "../dashboard/format";
import { loggerCodesLabel } from "../dashboard/sort";
import type { FridgeOverview } from "../types/overview";
import type { SeriesDetail, SeriesExcursion } from "../types/series";
import { DayChart } from "./DayChart";

export interface FridgeDetailsProps {
  fridge: FridgeOverview;
  week: string;
  weekStart: string;
  weekEnd: string;
  onBack: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; series: SeriesDetail[] };

/** Matches backend GAP_MIN: last high sample is at week end if within this window. */
const WEEK_BOUNDARY_MINUTES = 30;

function reachedReportingPeriodBoundary(
  lastHighAt: string,
  weekEndExclusive: string,
): boolean {
  const last = parseApiDateTime(lastHighAt);
  const weekEnd = parseApiDateTime(weekEndExclusive);
  if (!last || !weekEnd) return false;
  const minutes = (weekEnd.getTime() - last.getTime()) / 60_000;
  return minutes >= 0 && minutes <= WEEK_BOUNDARY_MINUTES;
}

function recoverySentence(
  excursion: Pick<SeriesExcursion, "ended_by" | "end">,
  weekEndExclusive: string,
): string {
  const endedBy = excursion.ended_by;
  if (endedBy === "recovered") {
    return "Temperature returned below 5°C.";
  }
  if (endedBy === "gap") {
    return "Ended at a gap in the readings. Recovery is not confirmed.";
  }
  if (endedBy === "invalid_reading") {
    return "Ended at an invalid reading. Recovery is not confirmed.";
  }
  if (
    endedBy === "end_of_period" &&
    reachedReportingPeriodBoundary(excursion.end, weekEndExclusive)
  ) {
    return "Last high reading was near the end of the week. Recovery not confirmed.";
  }
  const last = formatShortDateTime(excursion.end);
  if (last) {
    return `Recovery not confirmed. Last recorded high reading: ${last}.`;
  }
  return "Recovery not confirmed.";
}

function coverageNote(coverage: FridgeOverview["coverage"] | undefined): string | null {
  if (!coverage || coverage.week_minutes <= 0) return null;
  if (coverage.observed_minutes >= coverage.week_minutes) return null;
  const observed = coverage.observed_minutes;
  const week = coverage.week_minutes;
  if (coverage.is_estimate) {
    return `Incomplete week: ${observed} of ${week} min (estimate).`;
  }
  return `Incomplete week: ${observed} of ${week} min.`;
}

export function FridgeDetails({
  fridge,
  week,
  weekStart,
  weekEnd,
  onBack,
}: FridgeDetailsProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [dayIso, setDayIso] = useState<string | null>(null);
  const requestId = useRef(0);
  const days = weekDays(week);
  const loggerLabel = loggerCodesLabel(fridge);

  const load = () => {
    const id = ++requestId.current;
    setState({ status: "loading" });
    const loggers = fridge.series;
    if (loggers.length === 0) {
      setState({ status: "ready", series: [] });
      setDayIso(days[0]?.iso ?? week);
      return;
    }
    void Promise.all(
      loggers.map((item) => fetchSeries(item.logger_id, fridge.fridge_id, week)),
    )
      .then((series) => {
        if (id !== requestId.current) return;
        const readings = series.flatMap((item) => item.readings);
        setDayIso(defaultDayIso(days, readings));
        setState({ status: "ready", series });
      })
      .catch((err) => {
        if (id !== requestId.current) return;
        setState({
          status: "error",
          message:
            err instanceof Error ? err.message : "Could not load the temperature chart.",
        });
      });
  };

  useEffect(() => {
    load();
    return () => {
      requestId.current += 1;
    };
    // Fetch once when this fridge/week screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fridge.fridge_id, week]);

  const selectedDay = dayIso ?? days[0]?.iso ?? week;
  const daysWithReadings = useMemo(() => {
    if (state.status !== "ready") return new Set<string>();
    const found = new Set<string>();
    for (const item of state.series) {
      for (const reading of item.readings) {
        found.add(readingDayIso(reading.measured_at));
      }
    }
    return found;
  }, [state]);
  const dayHasReadings = daysWithReadings.has(selectedDay);

  return (
    <div className="fridge-details">
      <header className="fridge-details__header">
        <button
          type="button"
          className="fridge-details__back"
          onClick={onBack}
        >
          ← Back
        </button>
        <p className="fridge-details__city">{fridge.branch}</p>
        <h1 className="fridge-details__title">{fridge.name}</h1>
        <p className="fridge-details__meta">
          <span>{loggerLabel}</span>
          <span className="fridge-details__dot" aria-hidden="true">
            ·
          </span>
          <span>
            {formatWeekRange(weekStart, weekEnd)}
            <span className="fridge-details__week-span"> · Mon–Sun</span>
          </span>
        </p>
      </header>

      {state.status === "loading" ? (
        <p className="dashboard__status" role="status">
          Loading this week's readings…
        </p>
      ) : null}

      {state.status === "error" ? (
        <div className="dashboard__status dashboard__status--error" role="alert">
          <p>Could not load the temperature chart.</p>
          <p className="dashboard__status-detail">{state.message}</p>
          <button type="button" className="dashboard__retry" onClick={load}>
            Try again
          </button>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <>
          <div className="day-picker" role="tablist" aria-label="Days of the week">
            {days.map((day) => {
              const hasReadings = daysWithReadings.has(day.iso);
              const selected = day.iso === selectedDay;
              const classes = [
                "day-picker__btn",
                selected ? "day-picker__btn--active" : "",
                hasReadings ? "" : "day-picker__btn--empty",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  key={day.iso}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-label={
                    hasReadings
                      ? `${day.weekday} ${day.dayOfMonth}`
                      : `${day.weekday} ${day.dayOfMonth}, no readings`
                  }
                  className={classes}
                  onClick={() => setDayIso(day.iso)}
                >
                  <span className="day-picker__weekday">{day.weekday}</span>
                  <span className="day-picker__date">{day.dayOfMonth}</span>
                </button>
              );
            })}
          </div>

          {dayHasReadings ? (
            <DayChart dayIso={selectedDay} series={state.series} />
          ) : (
            <div className="fridge-details__empty-day" role="status">
              <p>No readings available</p>
              <p>Unknown, not confirmed safe.</p>
            </div>
          )}

          <WeeklyFindings fridge={fridge} series={state.series} weekEnd={weekEnd} />
        </>
      ) : null}
    </div>
  );
}

function WeeklyFindings({
  fridge,
  series,
  weekEnd,
}: {
  fridge: FridgeOverview;
  series: SeriesDetail[];
  weekEnd: string;
}) {
  const groups = [...series]
    .sort(
      (a, b) =>
        loggerNumericKey(a.logger_code) - loggerNumericKey(b.logger_code) ||
        a.logger_code.localeCompare(b.logger_code),
    )
    .map((item) => ({
      logger: item.logger_code,
      excursions: [...item.excursions].sort((a, b) => a.start.localeCompare(b.start)),
    }))
    .filter((group) => group.excursions.length > 0);
  const showLogger = series.length > 1;
  const gaps = series.flatMap((item) =>
    item.gaps.map((gap) => ({ ...gap, logger: item.logger_code })),
  );
  const invalids = series.flatMap((item) =>
    item.invalid_readings.map((invalid) => ({
      ...invalid,
      logger: item.logger_code,
    })),
  );
  const coverage = coverageNote(fridge.coverage);

  return (
    <section className="weekly-findings" aria-labelledby="weekly-findings-heading">
      <h2 id="weekly-findings-heading" className="weekly-findings__title">
        This week's findings
      </h2>

      {coverage ? <p className="weekly-findings__coverage">{coverage}</p> : null}

      {groups.length > 0 ? (
        <div className="weekly-findings__block">
          <h3>High temperatures</h3>
          {groups.map((group) => (
            <div key={group.logger} className="weekly-findings__group">
              {showLogger ? (
                <h4 className="weekly-findings__logger">{group.logger}</h4>
              ) : null}
              <ul className="weekly-findings__events">
                {group.excursions.map((excursion) => (
                  <li
                    key={`${group.logger}-${excursion.start}-${excursion.end}-${excursion.duration_label}`}
                    className="weekly-findings__event"
                  >
                    <p>
                      First detected:{" "}
                      {formatShortDateTime(excursion.start) ?? excursion.start}
                    </p>
                    <p>Time above 5°C: {excursion.duration_label}</p>
                    {excursion.ended_by ? (
                      <p>{recoverySentence(excursion, weekEnd)}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="weekly-findings__empty">No high temperatures this week.</p>
      )}

      {gaps.length > 0 ? (
        <div className="weekly-findings__block">
          <h3>Missing readings</h3>
          <ul>
            {gaps.map((gap) => (
              <li key={`${gap.logger}-${gap.start}`}>
                {series.length > 1 ? `${gap.logger}: ` : ""}
                {formatShortDateTime(gap.start)} to {formatShortDateTime(gap.end)} (
                {gap.minutes} min)
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {invalids.length > 0 ? (
        <div className="weekly-findings__block">
          <h3>Invalid readings</h3>
          <ul>
            {invalids.map((invalid) => (
              <li key={`${invalid.logger}-${invalid.measured_at}`}>
                {series.length > 1 ? `${invalid.logger}: ` : ""}
                {formatShortDateTime(invalid.measured_at) ?? invalid.measured_at}
                {invalid.raw_value ? ` (${invalid.raw_value})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
