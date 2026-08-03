export function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-pill--${status.replace(/\s/g, '-')}`}>{status}</span>;
}
