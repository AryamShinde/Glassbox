import type { ErrorEvent } from "../../types";

export default function ErrorCard({ error }: { error: ErrorEvent }) {
  return (
    <div className="rounded-md border border-red-700 bg-red-950/40 p-3 text-sm">
      <div className="text-xs uppercase tracking-wide text-red-400 mb-1">
        Error
      </div>
      <div className="text-red-200 font-mono">{error.message}</div>
    </div>
  );
}
