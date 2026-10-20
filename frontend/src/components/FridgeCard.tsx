import type { FridgeOverview } from "../types/overview";
import { deriveFinding } from "../dashboard/findings";
import { formatTemperatureC } from "../dashboard/format";
import { loggerCodesLabel } from "../dashboard/sort";
import { FridgeIcon, StatusIcon } from "./icons";

interface FridgeCardProps {
  fridge: FridgeOverview;
}

/**
 * Presentational fridge card. Not clickable in Phase 3.3A; structure is kept
 * reusable for a future detail open action.
 */
export function FridgeCard({ fridge }: FridgeCardProps) {
  const finding = deriveFinding(fridge);
  const temperature = formatTemperatureC(fridge.max_temperature_c);
  const loggers = loggerCodesLabel(fridge);

  return (
    <article
      className={`fridge-card fridge-card--${finding.tone}`}
      data-fridge-id={fridge.fridge_id}
      data-tone={finding.tone}
    >
      <header className="fridge-card__header">
        <span className="fridge-card__icon" aria-hidden="true">
          <FridgeIcon />
        </span>
        <div className="fridge-card__identity">
          <div className="fridge-card__city">{fridge.branch}</div>
          <div className="fridge-card__logger">Logger: {loggers}</div>
          <div className="fridge-card__fridge">Fridge: {fridge.name}</div>
        </div>
      </header>

      <div className="fridge-card__temp-block">
        <div className="fridge-card__temp">
          {temperature ?? "—"}
        </div>
        <div className="fridge-card__temp-label">Highest recorded temperature</div>
      </div>

      <div className={`fridge-card__finding fridge-card__finding--${finding.tone}`}>
        <StatusIcon tone={finding.tone} className="fridge-card__status-icon" />
        <div className="fridge-card__finding-text">
          <p className="fridge-card__headline">{finding.headline}</p>
          {finding.detail ? (
            <p className="fridge-card__detail">{finding.detail}</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
