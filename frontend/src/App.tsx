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

  const hasStarted = busy || events.length > 0;

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
  }

  return (
    <div className="min-h-screen flex flex-col text-slate-100">
      <header className="border-b border-white/5 backdrop-blur-md bg-slate-950/30 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <h1 className="text-lg font-semibold tracking-tight">
              Glassbox
            </h1>
          </div>
          <a
            href="https://github.com/AryamShinde/Glassbox"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.69-3.88-1.54-3.88-1.54-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.95 10.95 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.41-5.27 5.69.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.67.8.55C20.22 21.39 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z" />
            </svg>
            <span className="hidden sm:inline">View on GitHub</span>
          </a>
        </div>
      </header>

      <main className="flex-1 w-full">
        {!hasStarted && <Hero />}

        <section className="max-w-3xl w-full mx-auto px-6 pb-10">
          <GoalForm onSubmit={(g) => startRun(g)} busy={busy} />

          {rateLimited && (
            <RateLimitBanner payload={rateLimited} onUseKey={useKey} />
          )}

          {byoKey && !rateLimited && (
            <div className="mt-3 text-xs text-slate-500 flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
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
        </section>

        {!hasStarted && <FeatureGrid />}
      </main>

      <footer className="border-t border-white/5 mt-auto">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between text-xs text-slate-500">
          <span className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className={`absolute inline-flex h-full w-full rounded-full ${busy ? "bg-indigo-400 pulse-dot" : "bg-emerald-400"}`} />
            </span>
            Glassbox v0.1
          </span>
          <span>{events.length} events</span>
        </div>
      </footer>
    </div>
  );
}

function BrandMark() {
  return (
    <div className="relative w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-indigo-900/40">
      <div className="w-3.5 h-3.5 rounded-sm bg-slate-950/60 backdrop-blur border border-white/30" />
    </div>
  );
}

function Hero() {
  return (
    <section className="max-w-3xl mx-auto px-6 pt-16 pb-10 sm:pt-24 sm:pb-14 text-center">
      <p className="text-[11px] uppercase tracking-[0.22em] text-indigo-300/80 font-medium mb-5">
        Open-source agent observability
      </p>
      <h2 className="text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05] text-slate-50">
        Ever wondered how AI agents{" "}
        <span className="text-gradient">actually think?</span>
      </h2>
      <p className="mt-6 text-base sm:text-lg text-slate-400 max-w-xl mx-auto leading-relaxed">
        Glassbox shows you every thought, tool call, and decision your agent
        makes — streamed onto a live timeline, in real time.
      </p>
    </section>
  );
}

function FeatureGrid() {
  const features = [
    {
      title: "Live reasoning trace",
      desc: "Watch the agent's chain of thought stream in token-by-token, exactly as the model produces it.",
      icon: (
        <path d="M3 12h3l3-9 4 18 3-9h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ),
    },
    {
      title: "Every tool call captured",
      desc: "See the JSON arguments going in and the structured results coming out, color-coded by tool.",
      icon: (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" fill="none" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" fill="none" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" fill="none" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" fill="none" />
        </>
      ),
    },
    {
      title: "Inspect & debug",
      desc: "Step through the full timeline of any run after the fact — expand args, copy results, audit decisions.",
      icon: (
        <>
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" fill="none" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      ),
    },
  ];

  return (
    <section className="max-w-5xl mx-auto px-6 pb-20 pt-4">
      <div className="text-center mb-8">
        <h3 className="text-sm uppercase tracking-[0.18em] text-slate-400 font-medium">
          What you'll see
        </h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {features.map((f) => (
          <div
            key={f.title}
            className="glass-panel-soft p-5 hover:border-indigo-500/30 transition-colors"
          >
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/20 border border-white/10 flex items-center justify-center mb-3 text-indigo-300">
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                {f.icon}
              </svg>
            </div>
            <h4 className="text-base font-semibold text-slate-100 mb-1.5">
              {f.title}
            </h4>
            <p className="text-sm text-slate-400 leading-relaxed">
              {f.desc}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

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
