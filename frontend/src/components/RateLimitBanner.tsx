import { useState } from "react";
import type { RateLimitedPayload } from "../types";

export default function RateLimitBanner({
  payload,
  onUseKey,
}: {
  payload: RateLimitedPayload;
  onUseKey: (key: string) => void;
}) {
  const [key, setKey] = useState("");

  return (
    <div className="rounded-md border border-amber-700 bg-amber-950/40 p-4 mt-4">
      <div className="text-xs uppercase tracking-wide text-amber-300 mb-1">
        Rate limited
      </div>
      <div className="text-slate-200 text-sm mb-3">{payload.message}</div>
      <div className="text-xs text-slate-400 mb-3">
        Try again in ~{Math.ceil(payload.retry_after_seconds / 60)} min, or
        paste your own Groq API key below to continue right now. The key is
        kept in your browser only and sent as the{" "}
        <code className="font-mono text-slate-200">
          {payload.byo_key_header}
        </code>{" "}
        header.
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="gsk_…"
          className="flex-1 bg-slate-900 border border-slate-700 rounded-md p-2 text-slate-100 placeholder-slate-500 font-mono text-sm focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={() => key.trim() && onUseKey(key.trim())}
          disabled={!key.trim()}
          className="rounded-md bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-400 px-3 py-2 text-sm font-medium transition-colors"
        >
          Use key
        </button>
      </div>
    </div>
  );
}
