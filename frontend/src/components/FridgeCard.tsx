import { cardEventSummary } from "../dashboard/cardEvent";
import { deriveFinding } from "../dashboard/findings";
import { formatTemperatureC } from "../dashboard/format";
import { loggerCodesLabel } from "../dashboard/sort";
import type { FridgeOverview } from "../types/overview";
import { FridgeIcon, StatusIcon } from "./icons";

interface FridgeCardProps {
  fridge: FridgeOverview;
  onOpen?: (fridge: FridgeOverview) => void;
}

export function FridgeCard({ fridge, onOpen }: FridgeCardProps) {
  const finding = deriveFinding(fridge);
  const temperature = formatTemperatureC(fridge.max_temperature_c);
  const loggers = loggerCodesLabel(fridge);
  const event = cardEventSummary(fridge);

  return (
    <article
      className={`fridge-card fridge-card--${finding.tone}${onOpen ? " fridge-card--clickable" : ""}`}
      data-fridge-id={fridge.fridge_id}
      data-tone={finding.tone}
      onClick={onOpen ? () => onOpen(fridge) : undefined}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(fridge);
              }
            }
          : undefined
      }
      tabIndex={onOpen ? 0 : undefined}
      aria-label={
        onOpen
          ? `View details for ${fridge.name}, ${fridge.branch}`
          : undefined
      }
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
          {event ? (
            <div className="fridge-card__event">
              <p>
                First detected: {event.startLabel}
                {event.showLogger ? ` (${event.loggerCode})` : ""}
              </p>
              {event.isolated ? <p>Isolated high reading</p> : null}
              {event.durationLabel ? (
                <p>Time above 5°C: {event.durationLabel}</p>
              ) : null}
              {event.recoveryLabel ? <p>{event.recoveryLabel}</p> : null}
              {event.moreCount > 0 ? (
                <p>
                  {event.moreCount} more {event.moreCount === 1 ? "event" : "events"}
                </p>
              ) : null}
            </div>
          ) : finding.detail ? (
            <p className="fridge-card__detail">{finding.detail}</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
