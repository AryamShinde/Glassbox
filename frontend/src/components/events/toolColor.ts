// Per-tool color palette so the eye can see which tool was used at a glance
// while scrolling the timeline. Tailwind classes only — keep them static
// strings so the JIT compiler picks them up.

type Palette = { border: string; bg: string; text: string };

const PALETTES: Record<string, Palette> = {
  wikipedia: {
    border: "border-sky-700",
    bg: "bg-sky-950/40",
    text: "text-sky-300",
  },
  calculator: {
    border: "border-emerald-700",
    bg: "bg-emerald-950/40",
    text: "text-emerald-300",
  },
  url_fetcher: {
    border: "border-amber-700",
    bg: "bg-amber-950/40",
    text: "text-amber-300",
  },
};

const FALLBACK: Palette = {
  border: "border-slate-700",
  bg: "bg-slate-900",
  text: "text-slate-300",
};

export function toolColor(name: string): Palette {
  return PALETTES[name] ?? FALLBACK;
}
