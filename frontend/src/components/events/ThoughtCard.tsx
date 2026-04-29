import type { Thought } from "../../types";

// Thoughts arrive as token-stream deltas. The agent loop yields one Thought
// per delta, so adjacent thoughts in our timeline are concatenated and
// rendered as a single italic "stream of consciousness" block. The merging
// happens in App.tsx; this component just renders one merged thought.
export default function ThoughtCard({ thought }: { thought: Thought }) {
  return (
    <div className="border-l-2 border-slate-700 pl-4 py-2 text-slate-400 italic whitespace-pre-wrap">
      {thought.text}
    </div>
  );
}
