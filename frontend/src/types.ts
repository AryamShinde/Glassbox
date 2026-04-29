// Mirror of backend Pydantic models in app/agent/events.py.
// Keep these in sync with the Python definitions — the SSE wire format
// depends on the `type` discriminator matching exactly.

export interface Thought {
  type: "thought";
  text: string;
}

export interface ToolCall {
  type: "tool_call";
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  type: "tool_result";
  name: string;
  result: unknown;
}

export interface FinalAnswer {
  type: "final_answer";
  text: string;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type AgentEvent =
  | Thought
  | ToolCall
  | ToolResult
  | FinalAnswer
  | ErrorEvent;

// 429 payload from the rate-limit middleware (see backend app/rate_limit.py).
export interface RateLimitedPayload {
  error: "rate_limited";
  message: string;
  retry_after_seconds: number;
  byo_key_header: string;
}
