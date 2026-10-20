/** Small inline SVGs — no icon library. */

type IconProps = { className?: string; title?: string };

export function FridgeIcon({ className, title = "Fridge" }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="28"
      height="28"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : "presentation"}
    >
      {title ? <title>{title}</title> : null}
      <rect
        x="6"
        y="2"
        width="12"
        height="20"
        rx="2"
        fill="currentColor"
        opacity="0.15"
      />
      <rect
        x="6"
        y="2"
        width="12"
        height="20"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <line
        x1="6"
        y1="11"
        x2="18"
        y2="11"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <line
        x1="9"
        y1="5.5"
        x2="9"
        y2="8.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <line
        x1="9"
        y1="13.5"
        x2="9"
        y2="16.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="5"
        width="18"
        height="16"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth="1.6" />
      <line x1="8" y1="3" x2="8" y2="7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="16" y1="3" x2="16" y2="7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function StatusIcon({
  tone,
  className,
}: {
  tone: "red" | "green" | "amber" | "neutral";
  className?: string;
}) {
  if (tone === "red") {
    return (
      <svg className={className} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          d="M12 3.5 L21 20 H3 Z"
          fill="currentColor"
          opacity="0.15"
        />
        <path
          d="M12 3.5 L21 20 H3 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <line x1="12" y1="10" x2="12" y2="14.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="17.2" r="1" fill="currentColor" />
      </svg>
    );
  }
  if (tone === "green") {
    return (
      <svg className={className} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.12" />
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M7.5 12.5 L10.5 15.5 L16.5 9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (tone === "amber") {
    return (
      <svg className={className} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.12" />
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <line x1="12" y1="7.5" x2="12" y2="13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="16.2" r="1.1" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.1" />
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" />
      <line x1="12" y1="11" x2="12" y2="16.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
