const STATUS_KEYS = new Set([
  "ready",
  "working",
  "complete",
  "waiting",
  "human-required",
  "error",
]);

function normalizeStatusKey(status) {
  const key = String(status ?? "waiting")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")
    .replaceAll(" ", "-");

  return STATUS_KEYS.has(key) ? key : "waiting";
}

export default function StatusIndicator({
  status,
  label,
  size = "sm",
  className = "",
}) {
  const statusKey = normalizeStatusKey(status);
  const icon = statusKey === "complete"
    ? "✓"
    : statusKey === "waiting"
    ? "○"
    : statusKey === "human-required"
    ? "!"
    : "●";

  return (
    <span
      className={`status-indicator status-indicator--${statusKey} status-indicator--${size} ${className}`.trim()}
      role="status"
    >
      <span className="status-indicator__icon" aria-hidden="true">{icon}</span>
      <span className="status-indicator__label">{label ?? status}</span>
    </span>
  );
}
