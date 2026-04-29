import { useRef, useState } from "react";
import { RateLimitError, runAgent } from "./api";
import GoalForm from "./components/GoalForm";
import Timeline from "./components/Timeline";
import RateLimitBanner from "./components/RateLimitBanner";
import type { AgentEvent, RateLimitedPayload } from "./types";

const BYO_KEY_STORAGE = "glassbox.groqKey";

export default function App() {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [rateLimited, setRateLimited] = useState<RateLimitedPayload | null>(
    null,
  );
  const [byoKey, setByoKey] = useState<string | null>(
    () => localStorage.getItem(BYO_KEY_STORAGE),
  );
  const abortRef = useRef<AbortController | null>(null);

  async function startRun(goal: string, keyOverride?: string) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setEvents([]);
    setRateLimited(null);
    setBusy(true);

    try {
      for await (const ev of runAgent(goal, keyOverride ?? byoKey ?? undefined, ctrl.signal)) {
        setEvents((prev) => mergeEvent(prev, ev));
      }
    } catch (err) {
      if (err instanceof RateLimitError) {
        setRateLimited(err.payload);
      } else if ((err as Error).name !== "AbortError") {
        setEvents((prev) => [
          ...prev,
          { type: "error", message: (err as Error).message },
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  function useKey(key: string) {
    localStorage.setItem(BYO_KEY_STORAGE, key);
    setByoKey(key);
    setRateLimited(null);
    // Re-run the most recent goal under the new key. We don't store the goal
    // separately — pull it from the rate-limited state's transient context
    // by asking the user to resubmit instead.
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight">
          Glassbox <span className="text-slate-500 font-normal">— watch the agent think</span>
        </h1>
      </header>

      <main className="max-w-3xl w-full mx-auto px-6 py-8 flex-1">
        <GoalForm onSubmit={(g) => startRun(g)} busy={busy} />

        {rateLimited && (
          <RateLimitBanner payload={rateLimited} onUseKey={useKey} />
        )}

        {byoKey && !rateLimited && (
          <div className="mt-3 text-xs text-slate-500 flex items-center gap-2">
            Using your own Groq key (stored locally).
            <button
              onClick={() => {
                localStorage.removeItem(BYO_KEY_STORAGE);
                setByoKey(null);
              }}
              className="underline hover:text-slate-300"
            >
              forget
            </button>
          </div>
        )}

        <Timeline events={events} />
      </main>

      <footer className="border-t border-slate-800 px-6 py-3 text-xs text-slate-500">
        Glassbox v0.1 · {events.length} events
      </footer>
    </div>
  );
}

// Token-stream Thoughts arrive one delta at a time. Merging adjacent thought
// events into a single block makes the timeline read as continuous prose
// instead of one card per token.
function mergeEvent(prev: AgentEvent[], next: AgentEvent): AgentEvent[] {
  if (next.type === "thought" && prev.length > 0) {
    const last = prev[prev.length - 1];
    if (last.type === "thought") {
      return [
        ...prev.slice(0, -1),
        { type: "thought", text: last.text + next.text },
      ];
    }
  }
  return [...prev, next];
}
