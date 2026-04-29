import type { AgentEvent } from "../types";
import ThoughtCard from "./events/ThoughtCard";
import ToolCallCard from "./events/ToolCallCard";
import ToolResultCard from "./events/ToolResultCard";
import FinalAnswerCard from "./events/FinalAnswerCard";
import ErrorCard from "./events/ErrorCard";

// Adjacent thought events are merged in the parent and arrive here as one
// Thought with the concatenated text. We just dispatch on `type` to the
// right per-event renderer.
export default function Timeline({ events }: { events: AgentEvent[] }) {
  if (events.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 mt-6">
      {events.map((ev, i) => (
        <div key={i}>{renderEvent(ev)}</div>
      ))}
    </div>
  );
}

function renderEvent(ev: AgentEvent) {
  switch (ev.type) {
    case "thought":
      return <ThoughtCard thought={ev} />;
    case "tool_call":
      return <ToolCallCard call={ev} />;
    case "tool_result":
      return <ToolResultCard result={ev} />;
    case "final_answer":
      return <FinalAnswerCard answer={ev} />;
    case "error":
      return <ErrorCard error={ev} />;
  }
}
