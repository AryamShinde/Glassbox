import { useState } from "react";
import type { ToolCall } from "../../types";
import { toolColor } from "./toolColor";

export default function ToolCallCard({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const color = toolColor(call.name);
  return (
    <div
      className={`rounded-md border ${color.border} ${color.bg} p-3 text-sm`}
    >
      <div className="flex items-center justify-between">
        <div className="font-mono">
          <span className={color.text}>→ {call.name}</span>
          <span className="text-slate-500">(...)</span>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          {open ? "hide args" : "show args"}
        </button>
      </div>
      {open && (
        <pre className="mt-2 text-xs text-slate-300 font-mono overflow-x-auto">
          {JSON.stringify(call.args, null, 2)}
        </pre>
      )}
    </div>
  );
}
