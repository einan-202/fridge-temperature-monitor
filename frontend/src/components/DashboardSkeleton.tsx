function FridgeCardSkeleton() {
  return (
    <article className="fridge-card fridge-card--skeleton" aria-hidden="true">
      <header className="fridge-card__header">
        <span className="skeleton skeleton--icon" />
        <div className="fridge-card__identity">
          <div className="skeleton skeleton--line skeleton--line-md" />
          <div className="skeleton skeleton--line skeleton--line-lg" />
          <div className="skeleton skeleton--line skeleton--line-sm" />
        </div>
      </header>
      <div className="fridge-card__temp-block">
        <div className="skeleton skeleton--temp" />
        <div className="skeleton skeleton--line skeleton--line-md" />
      </div>
      <div className="fridge-card__finding fridge-card__finding--skeleton">
        <span className="skeleton skeleton--icon-sm" />
        <div className="fridge-card__finding-text">
          <div className="skeleton skeleton--line skeleton--line-lg" />
          <div className="skeleton skeleton--line skeleton--line-sm" />
        </div>
      </div>
    </article>
  );
}

export function DashboardSkeleton() {
  return (
    <div
      className="dashboard-skeleton"
      data-testid="dashboard-skeleton"
      aria-hidden="true"
    >
      <div className="summary-counters">
        <div className="summary-counters__item">
          <span className="skeleton skeleton--icon" />
          <div className="summary-counters__text">
            <div className="skeleton skeleton--value" />
            <div className="skeleton skeleton--line skeleton--line-md" />
          </div>
        </div>
        <div className="summary-counters__item">
          <span className="skeleton skeleton--icon" />
          <div className="summary-counters__text">
            <div className="skeleton skeleton--value" />
            <div className="skeleton skeleton--line skeleton--line-lg" />
          </div>
        </div>
        <div className="summary-counters__item">
          <span className="skeleton skeleton--icon" />
          <div className="summary-counters__text">
            <div className="skeleton skeleton--value" />
            <div className="skeleton skeleton--line skeleton--line-md" />
          </div>
        </div>
      </div>
      <div className="dashboard__groups">
        <section className="city-group">
          <div className="skeleton skeleton--heading" />
          <div className="city-group__grid">
            <FridgeCardSkeleton />
          </div>
        </section>
        <section className="city-group">
          <div className="skeleton skeleton--heading" />
          <div className="city-group__grid">
            <FridgeCardSkeleton />
          </div>
        </section>
        <section className="city-group city-group--wide">
          <div className="skeleton skeleton--heading" />
          <div className="city-group__grid">
            <FridgeCardSkeleton />
            <FridgeCardSkeleton />
          </div>
        </section>
      </div>
    </div>
  );
}
