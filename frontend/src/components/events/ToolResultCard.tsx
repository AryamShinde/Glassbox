import { useState } from "react";
import type { ToolResult } from "../../types";
import { toolColor } from "./toolColor";

const PREVIEW_LIMIT = 240;

export default function ToolResultCard({ result }: { result: ToolResult }) {
  const [open, setOpen] = useState(false);
  const color = toolColor(result.name);
  const isError =
    typeof result.result === "object" &&
    result.result !== null &&
    "error" in (result.result as Record<string, unknown>);

  const pretty = JSON.stringify(result.result, null, 2);
  const preview = pretty.length > PREVIEW_LIMIT && !open
    ? pretty.slice(0, PREVIEW_LIMIT) + "…"
    : pretty;

  return (
    <div
      className={`rounded-md border ${
        isError ? "border-red-700 bg-red-950/30" : `${color.border} ${color.bg}`
      } p-3 text-sm`}
    >
      <div className="flex items-center justify-between">
        <div className="font-mono">
          <span className={isError ? "text-red-400" : color.text}>
            ← {result.name}
          </span>
          <span className="text-slate-500">
            {isError ? " (error)" : " (result)"}
          </span>
        </div>
        {pretty.length > PREVIEW_LIMIT && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            {open ? "collapse" : "expand"}
          </button>
        )}
      </div>
      <pre className="mt-2 text-xs text-slate-200 font-mono overflow-x-auto whitespace-pre-wrap">
        {preview}
      </pre>
    </div>
  );
}
