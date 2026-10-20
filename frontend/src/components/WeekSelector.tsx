import { formatWeekRange } from "../dashboard/format";
import { CalendarIcon } from "./icons";

interface WeekSelectorProps {
  weeks: string[];
  monday: string | null;
  weekStart: string | null;
  weekEnd: string | null;
  onChange: (monday: string) => void;
}

export function WeekSelector({
  weeks,
  monday,
  weekStart,
  weekEnd,
  onChange,
}: WeekSelectorProps) {
  if (!monday || weeks.length === 0 || !weekStart || !weekEnd) {
    return null;
  }

  const index = weeks.indexOf(monday);
  // weeks are newest-first from the API.
  const canNewer = index > 0;
  const canOlder = index >= 0 && index < weeks.length - 1;

  const label = formatWeekRange(weekStart, weekEnd);

  return (
    <div className="week-selector" role="group" aria-label="Reporting week">
      <button
        type="button"
        className="week-selector__nav"
        aria-label="Newer week"
        disabled={!canNewer}
        onClick={() => canNewer && onChange(weeks[index - 1])}
      >
        ‹
      </button>
      <div className="week-selector__label">
        <CalendarIcon className="week-selector__cal" />
        <span>{label}</span>
      </div>
      <button
        type="button"
        className="week-selector__nav"
        aria-label="Older week"
        disabled={!canOlder}
        onClick={() => canOlder && onChange(weeks[index + 1])}
      >
        ›
      </button>
    </div>
  );
}
