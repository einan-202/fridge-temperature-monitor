import { useMemo, useState } from "react";
import { minutesFromMidnight, readingsOnDay } from "../chart/days";
import {
  isHighTemperature,
  splitValidSegments,
  temperatureNumber,
  THRESHOLD_C,
} from "../chart/segments";
import { formatTemperatureC, parseApiDateTime } from "../dashboard/format";
import type { SeriesDetail } from "../types/series";

const LOGGER_STROKES = ["#3b82c4", "#6b5b95", "#2a9d8f", "#c47b3b"];

interface DayChartProps {
  dayIso: string;
  series: SeriesDetail[];
}

interface PlotPoint {
  loggerCode: string;
  measuredAt: string;
  temperatureC: number;
  high: boolean;
  x: number;
  y: number;
}

const VB_WIDTH = 640;
const VB_HEIGHT = 480;
const PAD = { top: 32, right: 14, bottom: 40, left: 44 };
const INNER_W = VB_WIDTH - PAD.left - PAD.right;
const INNER_H = VB_HEIGHT - PAD.top - PAD.bottom;

function xForMinutes(minutes: number): number {
  return PAD.left + (minutes / 1440) * INNER_W;
}

function yForTemp(temp: number, yMin: number, yMax: number): number {
  const span = yMax - yMin || 1;
  return PAD.top + ((yMax - temp) / span) * INNER_H;
}

function formatClock(measuredAt: string): string {
  const date = parseApiDateTime(measuredAt);
  if (!date) return measuredAt;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatReadingDetail(measuredAt: string, temperatureC: number): string {
  const date = parseApiDateTime(measuredAt);
  const temp = formatTemperatureC(String(temperatureC)) ?? `${temperatureC}°C`;
  if (!date) return `${measuredAt} · ${temp}`;
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day} ${formatClock(measuredAt)} · ${temp}`;
}

export function DayChart({ dayIso, series }: DayChartProps) {
  const [selected, setSelected] = useState<PlotPoint | null>(null);

  const { points, paths, yMin, yMax, yTicks } = useMemo(() => {
    const temps: number[] = [THRESHOLD_C];
    type RawPoint = {
      loggerCode: string;
      measuredAt: string;
      temperatureC: number;
      minutes: number;
    };
    const rawPoints: RawPoint[] = [];
    const rawSegments: { loggerCode: string; color: string; points: RawPoint[] }[] =
      [];

    series.forEach((item, loggerIndex) => {
      const color = LOGGER_STROKES[loggerIndex % LOGGER_STROKES.length];
      const dayReadings = readingsOnDay(item.readings, dayIso);
      for (const segment of splitValidSegments(dayReadings, item.gaps)) {
        const mapped: RawPoint[] = [];
        for (const reading of segment) {
          const temperatureC = temperatureNumber(reading.temperature_c);
          const minutes = minutesFromMidnight(reading.measured_at);
          if (temperatureC == null || minutes == null) continue;
          temps.push(temperatureC);
          const point = {
            loggerCode: item.logger_code,
            measuredAt: reading.measured_at,
            temperatureC,
            minutes,
          };
          mapped.push(point);
          rawPoints.push(point);
        }
        if (mapped.length > 0) {
          rawSegments.push({ loggerCode: item.logger_code, color, points: mapped });
        }
      }
    });

    const dataMin = Math.min(...temps);
    const dataMax = Math.max(...temps);
    const lo = Math.min(THRESHOLD_C, dataMin);
    const hi = Math.max(THRESHOLD_C, dataMax);
    const pad = Math.max(0.5, (hi - lo) * 0.16);
    const min = lo - pad;
    const max = hi + pad;

    const nextPaths = rawSegments
      .filter((segment) => segment.points.length >= 2)
      .map((segment) => ({
        loggerCode: segment.loggerCode,
        color: segment.color,
        d: segment.points
          .map((point, index) => {
            const x = xForMinutes(point.minutes).toFixed(2);
            const y = yForTemp(point.temperatureC, min, max).toFixed(2);
            return `${index === 0 ? "M" : "L"}${x},${y}`;
          })
          .join(" "),
      }));

    const nextPoints: PlotPoint[] = rawPoints.map((point) => ({
      loggerCode: point.loggerCode,
      measuredAt: point.measuredAt,
      temperatureC: point.temperatureC,
      high: isHighTemperature(String(point.temperatureC)),
      x: xForMinutes(point.minutes),
      y: yForTemp(point.temperatureC, min, max),
    }));

    const ticks: number[] = [];
    const step = max - min > 12 ? 5 : max - min > 6 ? 2 : 1;
    const startTick = Math.ceil(min / step) * step;
    for (let t = startTick; t <= max + 1e-9; t += step) {
      ticks.push(Number(t.toFixed(1)));
    }
    if (!ticks.some((tick) => tick === THRESHOLD_C)) {
      ticks.push(THRESHOLD_C);
      ticks.sort((a, b) => a - b);
    }

    return { points: nextPoints, paths: nextPaths, yMin: min, yMax: max, yTicks: ticks };
  }, [dayIso, series]);

  return (
    <div className="day-chart">
      {series.length > 1 ? (
        <ul className="day-chart__legend">
          {series.map((item, index) => (
            <li key={item.logger_id}>
              <span
                className="day-chart__swatch"
                style={{ background: LOGGER_STROKES[index % LOGGER_STROKES.length] }}
              />
              {item.logger_code}
            </li>
          ))}
        </ul>
      ) : null}

      <svg
        className="day-chart__svg"
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        role="img"
        aria-label={`Temperature chart for ${dayIso}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              className={tick === THRESHOLD_C ? "day-chart__threshold" : "day-chart__grid"}
              x1={PAD.left}
              x2={VB_WIDTH - PAD.right}
              y1={yForTemp(tick, yMin, yMax)}
              y2={yForTemp(tick, yMin, yMax)}
            />
            <text
              className={
                tick === THRESHOLD_C
                  ? "day-chart__tick day-chart__tick--threshold"
                  : "day-chart__tick"
              }
              x={PAD.left - 6}
              y={yForTemp(tick, yMin, yMax) + 4}
              textAnchor="end"
            >
              {tick === THRESHOLD_C ? "5°C" : `${tick}`}
            </text>
          </g>
        ))}

        {[0, 6, 12, 18, 24].map((hour) => (
          <text
            key={`h-${hour}`}
            className="day-chart__tick"
            x={xForMinutes(hour * 60)}
            y={VB_HEIGHT - 10}
            textAnchor={hour === 0 ? "start" : hour === 24 ? "end" : "middle"}
          >
            {String(hour).padStart(2, "0")}:00
          </text>
        ))}

        {paths.map((path, index) => (
          <path
            key={`${path.loggerCode}-${index}`}
            className="day-chart__line"
            d={path.d}
            stroke={path.color}
            data-logger={path.loggerCode}
          />
        ))}

        {points.map((point) => {
          const active =
            selected?.loggerCode === point.loggerCode &&
            selected.measuredAt === point.measuredAt;
          return (
            <g key={`${point.loggerCode}-${point.measuredAt}`}>
              <circle
                className="day-chart__hit"
                cx={point.x}
                cy={point.y}
                r={16}
                onPointerDown={(event) => {
                  event.preventDefault();
                  setSelected(point);
                }}
                onClick={() => setSelected(point)}
                onMouseEnter={() => setSelected(point)}
              />
              <circle
                className={
                  point.high
                    ? "day-chart__point day-chart__point--high"
                    : "day-chart__point"
                }
                cx={point.x}
                cy={point.y}
                r={active ? 4 : 2.75}
                data-measured-at={point.measuredAt}
                data-temp={point.temperatureC}
                data-logger={point.loggerCode}
                data-high={point.high ? "true" : "false"}
              />
            </g>
          );
        })}
      </svg>

      <p
        className={
          selected ? "day-chart__tooltip" : "day-chart__tooltip day-chart__tooltip--hint"
        }
        role="status"
      >
        {selected
          ? `${selected.loggerCode}: ${formatReadingDetail(selected.measuredAt, selected.temperatureC)}`
          : "Tap a reading for time and temperature."}
      </p>
    </div>
  );
}
