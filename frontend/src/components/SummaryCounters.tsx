import type { SummaryCounts } from "../dashboard/findings";
import { FridgeIcon, StatusIcon } from "./icons";

interface SummaryCountersProps {
  counts: SummaryCounts;
}

export function SummaryCounters({ counts }: SummaryCountersProps) {
  return (
    <div className="summary-counters" aria-label="Week summary">
      <div className="summary-counters__item summary-counters__item--data">
        <span className="summary-counters__icon" aria-hidden="true">
          <FridgeIcon />
        </span>
        <div className="summary-counters__text">
          <div className="summary-counters__value">{counts.totalFridges}</div>
          <div className="summary-counters__label summary-counters__label--full">
            Total fridges
          </div>
          <div className="summary-counters__label summary-counters__label--short">
            Total
          </div>
        </div>
      </div>
      <div className="summary-counters__item summary-counters__item--red">
        <span className="summary-counters__icon" aria-hidden="true">
          <StatusIcon tone="red" />
        </span>
        <div className="summary-counters__text">
          <div className="summary-counters__value">
            {counts.sustainedHighTemps}
          </div>
          <div className="summary-counters__label summary-counters__label--full">
            Sustained high temps
          </div>
          <div className="summary-counters__label summary-counters__label--short">
            Sustained
          </div>
        </div>
      </div>
      <div className="summary-counters__item summary-counters__item--neutral">
        <span className="summary-counters__icon" aria-hidden="true">
          <StatusIcon tone="neutral" />
        </span>
        <div className="summary-counters__text">
          <div className="summary-counters__value">
            {counts.noReadings}
          </div>
          <div className="summary-counters__label summary-counters__label--full">
            No readings
          </div>
          <div className="summary-counters__label summary-counters__label--short">
            No readings
          </div>
        </div>
      </div>
    </div>
  );
}
