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
          <div className="summary-counters__value">{counts.fridgesWithData}</div>
          <div className="summary-counters__label summary-counters__label--full">
            Fridges with data
          </div>
          <div className="summary-counters__label summary-counters__label--short">
            Fridges
          </div>
        </div>
      </div>
      <div className="summary-counters__item summary-counters__item--red">
        <span className="summary-counters__icon" aria-hidden="true">
          <StatusIcon tone="red" />
        </span>
        <div className="summary-counters__text">
          <div className="summary-counters__value">
            {counts.extendedHighTemperature}
          </div>
          <div className="summary-counters__label summary-counters__label--full">
            Fridges with extended high temperatures
          </div>
          <div className="summary-counters__label summary-counters__label--short">
            Extended highs
          </div>
        </div>
      </div>
      <div className="summary-counters__item summary-counters__item--amber">
        <span className="summary-counters__icon" aria-hidden="true">
          <StatusIcon tone="amber" />
        </span>
        <div className="summary-counters__text">
          <div className="summary-counters__value">
            {counts.incompleteRecords}
          </div>
          <div className="summary-counters__label summary-counters__label--full">
            Fridges with incomplete records
          </div>
          <div className="summary-counters__label summary-counters__label--short">
            Data issues
          </div>
        </div>
      </div>
    </div>
  );
}
