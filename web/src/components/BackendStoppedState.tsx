interface BackendStoppedStateProps {
  message?: string;
}

export default function BackendStoppedState({
  message = "Start the backend to load this data.",
}: BackendStoppedStateProps) {
  return (
    <div className="rounded border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-xs text-text-muted">
      {message}
    </div>
  );
}
