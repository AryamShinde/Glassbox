import { useState } from "react";

export default function GoalForm({
  onSubmit,
  busy,
}: {
  onSubmit: (goal: string) => void;
  busy: boolean;
}) {
  const [goal, setGoal] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!goal.trim() || busy) return;
    onSubmit(goal.trim());
  }

  return (
    <form onSubmit={submit} className="relative">
      {/* outer glow halo */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-r from-indigo-500/40 via-fuchsia-500/30 to-cyan-500/40 opacity-60 blur-lg"
      />
      <div className="relative glass-panel p-5 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <label
            htmlFor="goal"
            className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-medium"
          >
            Goal
          </label>
          <span className="text-[11px] text-slate-500 hidden sm:inline">
            Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px]">⌘ + Enter</kbd> to run
          </span>
        </div>

        <textarea
          id="goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(e);
          }}
          rows={3}
          placeholder="e.g. What is the population of Tokyo, and what percent of Japan's total is that?"
          className="w-full bg-slate-950/60 border border-slate-700/70 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 font-mono text-sm leading-relaxed resize-none transition focus:outline-none focus:border-indigo-500/60 focus-glow"
          disabled={busy}
        />

        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-slate-500">
            5 free runs/hour · or bring your own Groq key
          </p>
          <button
            type="submit"
            disabled={busy || !goal.trim()}
            className="group relative inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 hover:from-indigo-400 hover:to-fuchsia-400 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-400 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition-all hover:shadow-indigo-700/50 hover:-translate-y-0.5 disabled:shadow-none disabled:translate-y-0"
          >
            {busy ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
                  <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Running…
              </>
            ) : (
              <>
                Run agent
                <svg
                  className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10.293 3.293a1 1 0 0 1 1.414 0l6 6a1 1 0 0 1 0 1.414l-6 6a1 1 0 0 1-1.414-1.414L14.586 11H3a1 1 0 1 1 0-2h11.586l-4.293-4.293a1 1 0 0 1 0-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
