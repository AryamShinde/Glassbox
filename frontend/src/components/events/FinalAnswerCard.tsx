import type { FinalAnswer } from "../../types";

export default function FinalAnswerCard({ answer }: { answer: FinalAnswer }) {
  return (
    <div className="rounded-md border border-indigo-500 bg-indigo-950/40 p-4">
      <div className="text-xs uppercase tracking-wide text-indigo-300 mb-2">
        Final answer
      </div>
      <div className="text-slate-100 whitespace-pre-wrap leading-relaxed">
        {answer.text}
      </div>
    </div>
  );
}
