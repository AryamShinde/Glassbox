// SSE over fetch — we use fetch + ReadableStream instead of EventSource
// because EventSource cannot set custom headers (we need X-Groq-Key for the
// BYO-key path) and only supports GET (we want POST with a JSON body).
//
// The wire format is a sequence of blocks separated by "\n\n":
//     event: thought
//     data: {"type":"thought","text":"..."}
//
//     event: tool_call
//     data: {...}
//
// We split on the blank-line boundary, then parse each block's `event:` and
// `data:` lines. The backend always sends a single `data:` line per event;
// we still join multi-line `data:` defensively in case sse-starlette ever
// chunks a payload across lines.

import type { AgentEvent, RateLimitedPayload } from "./types";

export class RateLimitError extends Error {
  payload: RateLimitedPayload;
  constructor(payload: RateLimitedPayload) {
    super(payload.message);
    this.name = "RateLimitError";
    this.payload = payload;
  }
}

export async function* runAgent(
  goal: string,
  byoKey?: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
  };
  if (byoKey) headers["x-groq-key"] = byoKey;

  const resp = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({ goal }),
    signal,
  });

  if (resp.status === 429) {
    const payload = (await resp.json()) as RateLimitedPayload;
    throw new RateLimitError(payload);
  }
  if (!resp.ok || !resp.body) {
    throw new Error(`request failed: ${resp.status} ${resp.statusText}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE event boundary is a blank line. The SSE spec allows lines to end
    // in \n, \r, or \r\n — sse-starlette uses CRLF, so the separator on the
    // wire is "\r\n\r\n". Find whichever boundary appears first.
    while (true) {
      const sep = nextBoundary(buffer);
      if (sep === null) break;
      const raw = buffer.slice(0, sep.index);
      buffer = buffer.slice(sep.index + sep.length);
      const event = parseSseBlock(raw);
      if (event) yield event;
    }
  }
}

function nextBoundary(buf: string): { index: number; length: number } | null {
  // Prefer the first separator that actually occurs in the buffer.
  const candidates = ["\r\n\r\n", "\n\n", "\r\r"];
  let best: { index: number; length: number } | null = null;
  for (const sep of candidates) {
    const i = buf.indexOf(sep);
    if (i !== -1 && (best === null || i < best.index)) {
      best = { index: i, length: sep.length };
    }
  }
  return best;
}

function parseSseBlock(raw: string): AgentEvent | null {
  // Comments (lines starting with ':') and pings should be ignored.
  // Split on either CRLF or LF so we tolerate whichever the server picked.
  const lines = raw
    .split(/\r\n|\r|\n/)
    .filter((l) => l && !l.startsWith(":"));
  if (lines.length === 0) return null;

  const dataChunks: string[] = [];
  for (const line of lines) {
    // We only care about `data:`; the named `event:` channel is informational
    // because the JSON payload's `type` field already tells us the variant.
    if (line.startsWith("data:")) {
      dataChunks.push(line.slice(5).trimStart());
    }
  }
  if (dataChunks.length === 0) return null;

  try {
    return JSON.parse(dataChunks.join("\n")) as AgentEvent;
  } catch {
    return null;
  }
}
