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
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label className="text-xs uppercase tracking-wide text-slate-400">
        Goal
      </label>
      <textarea
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        rows={3}
        placeholder="e.g. What is the population of Tokyo, and what percent of Japan's total is that?"
        className="bg-slate-900 border border-slate-700 rounded-md p-3 text-slate-100 placeholder-slate-500 font-mono text-sm focus:outline-none focus:border-indigo-500"
        disabled={busy}
      />
      <button
        type="submit"
        disabled={busy || !goal.trim()}
        className="self-start rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 px-4 py-2 text-sm font-medium transition-colors"
      >
        {busy ? "Running…" : "Run agent"}
      </button>
    </form>
  );
}
