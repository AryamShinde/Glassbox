# Glassbox — Learning Notes

A running notebook of the concepts behind the code in `backend/`. Read this alongside the source. Sections are added as we build.

---

## 1. Pydantic models (`app/agent/events.py`)

### What Pydantic is
A runtime data-validation library. You declare a class with typed fields, and Pydantic enforces types when you instantiate, parse, or serialize. Mental model: **TypeScript interfaces that actually run at runtime.**

FastAPI uses Pydantic under the hood for every request body and response. Anything you type with a Pydantic model is validated for free.

### `BaseModel`
Subclassing `BaseModel` gives a class:
- Type-checked construction: `Thought(text=123)` raises `ValidationError`.
- `.model_dump()` → dict.
- `.model_dump_json()` → JSON string.
- `.model_validate(some_dict)` → builds a model from raw data, validating as it goes.

### `Literal[...]` types
```python
type: Literal["thought"] = "thought"
```
- The field is typed as **the exact string `"thought"`** — not any `str`.
- Default value is `"thought"`, so you don't have to pass it when constructing.
- You can't accidentally set it to anything else; both the type checker and Pydantic will reject it.

This field is the **discriminator** — see next.

### Discriminated unions (a.k.a. tagged unions)
```python
AgentEvent = Union[Thought, ToolCall, ToolResult, FinalAnswer, ErrorEvent]
```
An `AgentEvent` is **one of** those five types. The `type` field tells you which. Code can do:

```python
if event.type == "tool_call":
    # type checker now knows this is a ToolCall — .name and .args are available
```

Why this matters here: every step the agent takes — a thought, a tool call, a tool result, the final answer — is exactly one of these events. The loop yields them, the SSE endpoint serializes them, the frontend deserializes and renders them. **One vocabulary, defined once, used everywhere.**

---

## 2. Server-Sent Events (SSE)

### What SSE is
A simple HTTP protocol for the server to push events to the client over a long-lived connection. The response has `Content-Type: text/event-stream` and stays open; the server writes events as they happen; the browser's `EventSource` API parses them.

**SSE vs WebSocket**: SSE is one-way (server → client) and runs over plain HTTP. WebSocket is bidirectional but heavier. For "watch the agent think" we only need server → client, so SSE is the right tool.

### Wire format
Each event is two lines plus a blank line:
```
event: thought
data: {"type":"thought","text":"Thinking about: test"}

event: tool_call
data: {"type":"tool_call","name":"search","args":{"query":"test"}}

```
- `event:` — the named channel (optional but useful for `addEventListener("thought", ...)` on the client).
- `data:` — the payload (we send JSON, but it's just a string as far as SSE is concerned).
- Blank line ends the event.

### `sse-starlette`
A small library that wraps an async generator into a streaming HTTP response. We yield dicts; it formats them as SSE on the wire.

```python
return EventSourceResponse(_stub_stream(req.goal))
```

`EventSourceResponse` calls our generator, takes each yielded `{"event": ..., "data": ...}` dict, and writes it to the socket in SSE format. When the generator finishes, the connection closes.

---

## 3. Async generators (`app/routes/agent.py`)

### Regular generators (sync)
A function with `yield` instead of `return` produces a sequence lazily:
```python
def counts():
    yield 1
    yield 2
    yield 3
```

### Async generators
Same idea but inside `async def`, and you can `await` between yields:
```python
async def _stub_stream(goal: str) -> AsyncIterator[dict]:
    for event in events:
        yield {"event": event.type, "data": event.model_dump_json()}
        await asyncio.sleep(0.4)
```
- `await asyncio.sleep(0.4)` pauses **without blocking the server** — other requests keep being handled by the event loop.
- The function is iterated with `async for` (which is what `EventSourceResponse` does internally).

**Why this is the right shape for the agent loop**: each iteration of the agent (think → call tool → observe → repeat) emits one or more events. As soon as an event is ready, `yield` it; the SSE response writes it to the client immediately. No buffering, no waiting for the whole loop to finish.

---

## 4. FastAPI routing (`app/main.py`, `app/routes/agent.py`)

### `APIRouter`
A way to group routes in their own file and mount them on the main app:
```python
# routes/agent.py
router = APIRouter()

@router.post("/run")
async def run(req: RunRequest): ...
```
```python
# main.py
app.include_router(agent.router)
```
This keeps `main.py` tiny and lets each feature own its routes.

### Request body validation
```python
class RunRequest(BaseModel):
    goal: str

@router.post("/run")
async def run(req: RunRequest):
    ...
```
FastAPI sees the typed `RunRequest` parameter, reads the JSON body, validates it against the Pydantic model, and hands you a fully-typed `req`. If `goal` is missing, the client gets a 422 with a helpful error — you write zero validation code.

### CORS middleware
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    ...
)
```
Browsers block cross-origin requests by default. Since our frontend (e.g. `localhost:5173`) is a different origin from our backend (`localhost:8000`), the browser needs the backend to explicitly say "this origin is allowed." This middleware adds the right headers automatically.

---

## 5. Environment & configuration (`app/config.py`)

```python
from dotenv import load_dotenv
load_dotenv()  # reads .env into os.environ

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
```
- `.env` file holds secrets and per-environment config. **Never committed** (see `.gitignore`).
- `.env.example` is committed — it documents which keys exist, with placeholder values.
- `os.getenv("KEY", "default")` reads from the environment, returning the default if unset.

Putting all config in one module means the rest of the codebase imports constants from `app.config` — no scattered `os.getenv` calls, easy to audit what configuration the app needs.

---

## 6. Project structure — why it's laid out this way

```
backend/
  app/
    main.py          # entry point — creates FastAPI app, wires middleware + routes
    config.py        # all env-driven config in one place
    routes/          # HTTP-facing layer; thin, just adapts HTTP <-> domain
      agent.py
    agent/           # the core: loop logic + event vocabulary
      events.py
      loop.py
    tools/           # one file per tool; shared `Tool` protocol in __init__.py
```

Each layer has one job:
- **`routes/`** speaks HTTP. It validates input, returns responses, knows nothing about Groq.
- **`agent/`** owns the loop. It doesn't know about HTTP; it just yields events.
- **`tools/`** owns side effects (web search, math, etc.). The agent calls them by name.

This separation pays off when testing: you can run the agent loop in a script with no FastAPI, no SSE, just `async for event in run_agent(goal): print(event)`.

---

## Glossary

- **SSE** — Server-Sent Events. HTTP-based one-way streaming protocol.
- **Discriminated union** — A union of types where one field (the discriminator) tells you which variant you have.
- **Async generator** — A function with both `async def` and `yield`. Iterated with `async for`. Can `await` between yields without blocking other work.
- **Pydantic `BaseModel`** — Base class for runtime-validated data classes.
- **`APIRouter`** — FastAPI's way to group routes across files and mount them on the main app.
- **CORS** — Cross-Origin Resource Sharing. Browser security feature; needs explicit server permission to allow cross-origin requests.

---

## 7. Design decisions for v1 — what we chose and why

Three open questions from the brief got resolved here. The short version: **Wikipedia + Calculator + URL fetcher**, **vertical timeline with rich event cards**, **in-memory per-IP rate limit with a BYO-key escape hatch.** Below is the reasoning so future-you (and anyone reading the code) understands what was rejected and why.

### 7.1 Tool selection: Wikipedia + Calculator + URL fetcher

We needed 2–3 tools that are **diverse in shape** (so the visualization shows variety), **reliable** (no demos breaking on stage), and **cheap to build** (weekend sprint).

**What we picked and why:**
- **Wikipedia REST API** — official, stable, free, no API key. Gives the agent a credible factual lookup tool. Endpoint: `https://en.wikipedia.org/api/rest_v1/page/summary/{title}`.
- **Calculator (safe expression eval)** — trivial to build, perfectly reliable, and **chains beautifully** with other tools ("population of Japan / population of Tokyo"). On its own it's boring; in a chain it makes the agent look like it's actually reasoning.
- **URL fetcher + text extract** — pulls a URL, returns clean text. The killer combo: Wikipedia returns a result mentioning a source → agent fetches the URL → agent reads further. **This is the multi-step "agent kept going" story that makes the visualization shine.**

**What we rejected:**
- **DuckDuckGo HTML scrape** — most "agentic" feel, but scraping breaks every time DDG changes their layout. We'd be patching it forever, and a demo that breaks mid-show is worse than no live web search.
- **Python code execution** — high wow factor, but sandboxing untrusted Python is a security rabbit hole. `exec()` is dangerous; subprocess sandboxing is heavy; `RestrictedPython` is fragile. Not weekend-friendly.
- **Date/time helper** — perfectly reliable but low demo value; a fourth tool would be filler, not meaningful diversity.

**The tradeoff we accepted:** no live web search means questions about recent news (today's headlines, current scores, latest releases) will fall flat. We're betting that the "research a topic deeply" demo story beats the "ask about current events" story. If that ever proves wrong, swap Wikipedia → DDG and accept the maintenance burden.

### 7.2 Visualization: vertical timeline with rich event cards

Priority #1 in the brief is "visually impressive in 5 seconds." The temptation is React Flow node graphs because they scream "agent loop" — but graphs are bad at showing **sequence**, which is the entire story we're telling.

**What we picked:**
A vertical timeline (top → bottom) where each event type renders as its own component:
- `thought` — italic, gray, types out token-by-token
- `tool_call` — card with the tool name + args as collapsible JSON
- `tool_result` — same card, expanded with the result, color-coded by tool
- `final_answer` — highlighted block at the bottom

This gets ~80% of the wow factor of a graph with ~30% of the complexity, and it **always reads clearly** even when the agent does the full 8 iterations.

**What we rejected:**
- **React Flow node graph** — maximum first-impression wow, but text inside nodes gets cramped, edges tangle once you have 5+ steps, mobile is hostile, and a cluttered graph actively *hurts* the impression you're trying to make. High-variance bet.
- **Split view (thoughts left, tools right)** — clean conceptual metaphor, but it's hard to read the *order* of events when they're spread across two columns, and the screen feels disconnected.

**The tradeoff we accepted:** we sacrificed the "look at this AI brain" wow of an animated graph for clarity and reliability. If we have time at the end, a "graph view" toggle is a stretch goal — but timeline ships first.

### 7.3 Rate limiting: in-memory per-IP + BYO-key escape hatch

The threat is **fairness + availability**, not billing. Groq's free tier has no monthly cap, but it does have per-minute limits — a single abusive script could break the demo for everyone else.

**What we picked:**
- A FastAPI middleware tracks `{ip: [timestamps]}` in memory, allowing **5 runs per hour** per IP.
- When limited, return `429` with a hint that the user can supply their own Groq key.
- Frontend has a small "use your own key" form; if set, the key goes in a header and bypasses the rate limit.

**What we rejected:**
- **Upstash Redis** — proper persistent rate limiting, but another free service to wire up + manage, and overkill for v1 traffic.
- **SQLite file** — would survive restarts, but Render's free-tier disk is ephemeral; Fly volumes work but it's more setup than the problem warrants.
- **Session-based / cookie counter** — trivially bypassed by a refresh; not real protection.
- **Rely on Groq's own rate limits** — zero work, but errors leak to users with no graceful UX.
- **No rate limiting at all** — fine until it isn't, and "isn't" is the worst time to scramble.

**The tradeoff we accepted:** in-memory state resets every time the server wakes from sleep on Render's free tier. That sounds like a bug but is actually fine — an abuser who got rate-limited then comes back after a server restart still has to *find* the new instance, and casual abuse just doesn't sustain itself across restarts. If this ever lands on HN's front page, the upgrade path to Upstash is ~30 minutes.

---

## 8. Tools layer (`app/tools/`)

The agent loop is only as interesting as the tools it can call. We have three: `wikipedia`, `calculator`, `url_fetcher`. Each lives in its own file, all conform to one shared shape.

### 8.1 The `Tool` shape — dataclass over `Protocol`

The original scaffold used `typing.Protocol`:
```python
class Tool(Protocol):
    name: str
    description: str
    schema: dict[str, Any]
    async def execute(self, args: dict[str, Any]) -> Any: ...
```
We replaced it with a `dataclass` (`app/tools/base.py`):
```python
@dataclass
class Tool:
    name: str
    description: str
    schema: dict[str, Any]
    execute: Callable[[dict[str, Any]], Awaitable[Any]]
```

**Why the change:**
- `Protocol` is for **structural typing** — "anything with these attributes counts." It's brilliant when you have many concrete classes implementing the same interface and you want type-checker support without inheritance. We don't have that — we have a single concrete shape.
- `dataclass` is **a concrete record type**. Each tool file just builds an instance: `tool = Tool(name="...", ..., execute=_execute)`. That's easier to register, easier to iterate, easier to teach.
- `execute` becomes a callable **field** (not a method), so we don't need to subclass — we just pass an async function in. Very lightweight.

### 8.2 Tool registry pattern (`app/tools/__init__.py`)

```python
from app.tools.calculator import tool as _calculator
from app.tools.url_fetcher import tool as _url_fetcher
from app.tools.wikipedia import tool as _wikipedia

ALL_TOOLS: list[Tool] = [_wikipedia, _calculator, _url_fetcher]
TOOLS_BY_NAME: dict[str, Tool] = {t.name: t for t in ALL_TOOLS}
```

This gives the agent loop two access patterns:
- `ALL_TOOLS` — iterate to build the list of tool definitions sent to the LLM.
- `TOOLS_BY_NAME` — O(1) lookup when the LLM picks a tool by name.

The leading underscores (`_wikipedia`) signal "internal — use the registries, not the raw imports."

**Why a separate `base.py` for the `Tool` dataclass?** To avoid circular imports. If `Tool` lived in `tools/__init__.py` and the submodules imported it from `app.tools`, Python would have to half-import `__init__.py` to satisfy the submodule, which is a classic source of `ImportError: cannot import name 'Tool' from partially initialized module`. Putting `Tool` in its own leaf module sidesteps the cycle entirely.

### 8.3 Safe expression eval via AST walking (`calculator.py`)

**Never use `eval()` on user input.** `eval("__import__('os').system('rm -rf /')")` does what you'd guess. The standard safe pattern is:

1. Parse the input into a Python AST with `ast.parse(expr, mode="eval")`.
2. Walk the AST, allowing **only** a whitelist of node types.
3. Reject any node not on the whitelist with a clear error.

Our whitelist:
- `ast.Expression` — the root.
- `ast.Constant` (numeric only) — literal numbers like `42`, `3.14`.
- `ast.BinOp` with `Add | Sub | Mult | Div | FloorDiv | Mod | Pow` — binary arithmetic.
- `ast.UnaryOp` with `UAdd | USub` — unary plus/minus, so `-5` parses correctly.

Anything else — `ast.Call` (function calls), `ast.Name` (variable lookups), `ast.Attribute` (`os.system`), `ast.Subscript`, etc. — raises `ValueError("disallowed expression node: ...")`. There is **no path to arbitrary code execution** because there's no path to a function call.

We tested this with `__import__('os').system('echo pwned')` and got back `disallowed expression node: Call` — confirmed. This is a pattern worth internalizing: **a positive whitelist of allowed nodes is robust; a negative blacklist of forbidden nodes is one CVE away from broken.**

### 8.4 Async HTTP with `httpx`

`httpx` is the modern Python HTTP client — same API as `requests`, plus a fully async version. Pattern:

```python
async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
    resp = await client.get(url, headers=_HEADERS)
```

- **`AsyncClient` is created in an `async with` block** — this ensures the underlying connection pool is closed when the request finishes. Failing to do this leaks sockets.
- **`await client.get(...)` returns a `Response`** — not a future. The `await` *is* the wait; by the time the next line runs, the response is in memory.
- **`httpx.Timeout(10.0)`** — applies to connect, read, write, and pool wait. Without a timeout, a slow server can hang the agent forever.

**`resp.raise_for_status()`** raises `HTTPStatusError` for 4xx/5xx. We use this for unexpected errors, but we **catch 404 explicitly** in the wikipedia tool to return a structured `{"error": ...}` dict — that lets the LLM decide to retry with a different title rather than the loop crashing out.

### 8.5 BeautifulSoup for HTML → text

```python
soup = BeautifulSoup(html, "html.parser")
for tag in soup(["script", "style", "noscript", "header", "footer", "nav"]):
    tag.decompose()
text = soup.get_text(separator=" ")
return re.sub(r"\s+", " ", text).strip()
```

- **`html.parser`** is the stdlib parser — comes free, slower than `lxml` but no extra dep.
- **`tag.decompose()`** removes the tag and its contents from the tree. Important for `<script>`/`<style>` — they're children of `<body>` so `get_text()` would include their JS source as "text" otherwise.
- **`separator=" "`** in `get_text()` puts a space between adjacent text nodes — without it, `<p>Hello</p><p>World</p>` becomes `HelloWorld`.
- **`re.sub(r"\s+", " ", text)`** collapses runs of whitespace. Real HTML is full of indentation and newlines; this normalizes it to single spaces, which is what an LLM actually wants to read.

We truncate to 3000 chars and return `truncated: bool` so the agent knows whether the page was cut short. Context-window economy matters when the agent might call this multiple times in one loop.

### 8.6 The Wikipedia 403 — a real lesson in API hygiene

First smoke test: Wikipedia returned `403 Forbidden`. Cause: **the Wikimedia REST API requires a descriptive `User-Agent` header by policy** ([docs](https://api.wikimedia.org/wiki/Documentation/User-Agent_policy)). They want to be able to identify and contact the source of high-volume traffic.

Fix:
```python
_HEADERS = {
    "accept": "application/json",
    "user-agent": "GlassboxAgent/0.1 (https://github.com/; portfolio demo)",
}
```

The general rule: **always set a descriptive User-Agent on outbound HTTP from a server**. Many APIs reject the default `python-requests/X.Y.Z` or empty UA outright. Even when they don't, they may rate-limit anonymous traffic harder. Identifying yourself is polite *and* operationally safer.

### 8.7 Why tools return structured errors instead of raising

For **expected** failure modes (404 Wikipedia article, malformed expression, fetch failure), the tool returns a dict like `{"error": "no Wikipedia article found for 'X'"}`. For **unexpected** failures (network down, JSON malformed), the exception propagates and the agent loop will catch it and emit an `ErrorEvent`.

The split matters because the LLM needs to be able to **react** to the first kind: "huh, no article for 'Tokio' — let me try 'Tokyo' instead." If we raised on every error, the loop would die when a recoverable miss happened. By returning the error in-band, it becomes part of the conversation the LLM is having with itself, and recovery is just another iteration.

---

## 9. The agent loop (`app/agent/loop.py`)

This is the educational core of the whole project. Everything else exists to support what happens here. The loop's job: take a user goal, talk to the LLM, execute the tools the LLM chooses, feed results back, repeat until the LLM has a final answer — and **emit a typed event for every interesting moment** so the frontend can show it happen live.

### 9.1 The shape of one iteration

```
┌───────────────────────────────────────────────────────────────────┐
│  for iteration in range(MAX_ITERATIONS):                          │
│      ┌─────────────────────────────────────────────────────────┐  │
│      │ 1. Send messages + tool defs to Groq, stream=True       │  │
│      │ 2. Consume the stream:                                  │  │
│      │    - content tokens  →  yield Thought(text=delta)       │  │
│      │    - tool_call deltas →  accumulate per index           │  │
│      │ 3. If no tool_calls were emitted:                       │  │
│      │       yield FinalAnswer(text=content_buf)               │  │
│      │       return                                            │  │
│      │ 4. Append assistant message (content + tool_calls)      │  │
│      │ 5. For each tool call:                                  │  │
│      │       yield ToolCall(name, args)                        │  │
│      │       result = await tool.execute(args)                 │  │
│      │       yield ToolResult(name, result)                    │  │
│      │       append {role: tool, tool_call_id, content}        │  │
│      └─────────────────────────────────────────────────────────┘  │
│  yield ErrorEvent("max iterations reached")                       │
└───────────────────────────────────────────────────────────────────┘
```

Three exits: `FinalAnswer` (success), `ErrorEvent` (failure / cap hit), or an `ErrorEvent` from inside the loop (Groq request failed, malformed JSON, etc.). The function is an `async def` with `yield`, so callers iterate it with `async for` and each yielded event is delivered to the SSE response immediately.

### 9.2 Why streaming is non-trivial with tool-calling

When you call `client.chat.completions.create(..., stream=True)`, the SDK gives you an `AsyncStream[ChatCompletionChunk]`. Each chunk has a `delta` containing **partial pieces** of the response. Two things stream in parallel:

- **`delta.content`** — a few text characters at a time. Easy to handle: append to a buffer and emit a `Thought` event per delta.
- **`delta.tool_calls`** — a list of `ChoiceDeltaToolCall` objects, also partial. The LLM might decide to call two tools in parallel, and each one's `id`, `name`, and `arguments` arrive piecemeal across many chunks.

The accumulation pattern:
```python
tool_calls_buf: dict[int, dict[str, str]] = {}

async for chunk in stream:
    delta = chunk.choices[0].delta
    if delta.tool_calls:
        for tc in delta.tool_calls:
            slot = tool_calls_buf.setdefault(
                tc.index, {"id": "", "name": "", "arguments": ""}
            )
            if tc.id:                             slot["id"] = tc.id
            if tc.function and tc.function.name:  slot["name"] += tc.function.name
            if tc.function and tc.function.arguments:
                slot["arguments"] += tc.function.arguments
```

The `index` field disambiguates parallel tool calls (call #0, call #1, ...). For each index, we **append** to `name` and `arguments` because they arrive as fragments — `arguments` is a JSON string that comes in a few chars at a time. We assemble the complete tool call only when the stream ends.

**Why we don't try to emit `ToolCall` mid-stream:** until the JSON arguments string is complete, `json.loads` will fail. Visually nothing is gained from "streaming" an arguments string anyway — the user wants to see "tool X called with these args" as a discrete event.

### 9.3 The message-history pattern

The LLM is stateless between calls. The way it "remembers" is the `messages` array we send each iteration. After every assistant turn that called tools, we have to:

1. Append the **assistant message** containing both `content` and `tool_calls` (so the model sees what it said + what it asked for).
2. Append one **`role: "tool"` message per tool call**, with `tool_call_id` matching the call and `content` being the JSON-serialized result.

The format is OpenAI-compatible:
```python
{"role": "assistant", "content": "Let me check Wikipedia.",
 "tool_calls": [{"id": "call_abc", "type": "function",
                 "function": {"name": "wikipedia",
                              "arguments": '{"title": "Tokyo"}'}}]}

{"role": "tool", "tool_call_id": "call_abc",
 "content": '{"title": "Tokyo", "extract": "..."}'}
```

The `tool_call_id` matching is **mandatory** — without it, the LLM doesn't know which result belongs to which call (matters when there are parallel calls).

### 9.4 The system prompt design (`app/agent/system_prompt.py`)

We keep the system prompt in its own file because **it's the single most important piece of the loop and we'll iterate on it constantly**. Putting it in `loop.py` would create diff noise every time we tune the wording.

Two design choices baked into the prompt:

1. **"Briefly state your next move in plain text, then either call a tool or give the final answer."** This encourages the LLM to emit content tokens (which become `Thought` events) before tool-calling. Without this nudge, models with tool-calling support tend to go straight to a tool call with no explanatory text — which leaves the visualization with nothing to render between events.
2. **Explicit per-tool guidance in the prompt** ("use the calculator for ANY numeric calculation — do not compute in your head"). Without this, models will happily fabricate arithmetic and skip the calculator. Telling them once in the system prompt is cheaper than fixing it after the fact.

`MAX_ITERATIONS` is interpolated into the prompt at module load via an f-string, so the LLM is informed of its budget. This is mostly for steering — the actual hard cap is enforced in code regardless.

### 9.5 Error handling — three layers

There are three categories of failure, each handled differently:

| Where | What | How handled |
|---|---|---|
| **Groq API call** | Network down, auth failed, rate limit, model unavailable | Catch `GroqError`, emit `ErrorEvent`, return |
| **Tool execution (expected)** | Wikipedia 404, bad arithmetic, fetch timeout | Tool returns `{"error": "..."}` — we feed it back to the LLM as a tool result so it can recover |
| **Tool execution (unexpected)** | Tool raised an exception we didn't anticipate | Catch broad `Exception`, wrap as `{"error": "TypeName: ..."}`, feed back to the LLM |

The deliberate choice: **don't crash the loop on tool failures.** The whole point of an agent is that it can react to setbacks. Killing the loop on the first 404 makes for a bad demo and a worse agent.

The one exception: malformed JSON in the LLM's tool arguments. That's an LLM bug, not a recoverable tool failure — we emit `ErrorEvent` and bail, because there's nothing useful to feed back.

### 9.6 The MAX_ITERATIONS cap

`for _ in range(MAX_ITERATIONS)` — a Python `for` loop over a fixed range is the simplest possible cap. If the LLM never reaches a final answer, the loop exits and emits a final `ErrorEvent`. This guards against:

- **Loop bugs** in the LLM — sometimes models get stuck calling the same tool over and over.
- **Pathological inputs** that genuinely can't be answered with the available tools.
- **Cost / latency** for the user watching — better to fail fast at 8 iterations than make them watch 50.

8 is arbitrary. Most reasonable goals resolve in 2–4 iterations. Bumping the cap is a one-line change in `app/config.py`.

### 9.7 Why the route handler stays thin

```python
@router.post("/run")
async def run(req: RunRequest):
    return EventSourceResponse(_to_sse(run_agent(req.goal)))


async def _to_sse(events: AsyncIterator[AgentEvent]) -> AsyncIterator[dict]:
    async for event in events:
        yield {"event": event.type, "data": event.model_dump_json()}
```

The route knows nothing about the agent — it just adapts a stream of typed events into the SSE wire format. This means:

- We can run the agent loop in a script (`smoke_loop.py`) with no FastAPI involved.
- We can swap `EventSourceResponse` for WebSockets later without touching the agent code.
- The agent is testable purely via `async for event in run_agent(goal)`.

Good separation pays off in testing and in keeping each layer's concerns small.

---

## 10. Rate limiting + BYO-key escape hatch (`app/rate_limit.py`)

Why rate-limit at all: the threat for v1 isn't billing (Groq's free tier has no monthly cap) — it's **fairness and per-minute capacity**. One abusive script can saturate Groq's per-minute limits and break the demo for everyone else hitting our shared key. The fix: cap each IP at `RATE_LIMIT_MAX` runs per `RATE_LIMIT_WINDOW_SEC` (default 5 / hour).

### 10.1 Sliding window, deque-of-timestamps

The classic textbook rate-limit options are:

- **Fixed window** — count requests inside each clock-aligned hour. Simple, but you can fire 2× the limit at the boundary (5 at 4:59:59, 5 at 5:00:00).
- **Token bucket** — refill tokens at a steady rate. Fine, but over-engineered when we just need "no more than N in any rolling hour."
- **Sliding window (chosen)** — keep a deque of timestamps per IP. On each request, evict timestamps older than the window, then check `len(hits) < MAX`. Exactly N in any rolling hour, no boundary glitch.

```python
hits = self._hits[ip]
while hits and hits[0] < cutoff:
    hits.popleft()
if len(hits) >= RATE_LIMIT_MAX:
    return _limited_response(...)
hits.append(now)
```

`deque.popleft()` is O(1), so eviction is cheap even with many IPs. We use `time.monotonic()` (not `time.time()`) because monotonic clocks never go backwards if the system clock gets adjusted — important for any timing logic that compares "now" to a stored timestamp.

### 10.2 Why `BaseHTTPMiddleware` (and the lock)

FastAPI inherits Starlette's middleware system. There are two flavors:

- **Pure ASGI middleware** — implement `__call__(scope, receive, send)`. Maximum control, ugly to write, easy to break streaming responses.
- **`BaseHTTPMiddleware`** — subclass it, override `dispatch(request, call_next)`. Looks like a function: get the request, decide, call `await call_next(request)` to continue, return a response.

We use `BaseHTTPMiddleware` because the rate-limit decision is request-shaped, not protocol-shaped. The one watch-out: `BaseHTTPMiddleware` *does* support streaming responses (it's been fixed since the early Starlette days), so SSE keeps working through it.

The `threading.Lock`: Python's GIL means individual operations on a `dict[str, deque]` are safe, but our window logic is "read deque, evict old entries, check length, append" — four operations that must be atomic. Two requests for the same IP arriving back-to-back could both see `len(hits) == 4` and both append, ending up at 6. A `Lock` makes the read-modify-write atomic. We use `threading.Lock` (not `asyncio.Lock`) because the work inside the critical section is tiny and synchronous; the overhead of suspending the coroutine is more than the lock contention itself.

### 10.3 The BYO-key contract

The locked decision (memory: `project_v1_decisions`): when a caller sends `X-Groq-Key`, they're paying for their own quota and we skip the rate limit.

Wiring:

1. `RateLimitMiddleware.dispatch` checks `request.headers.get("x-groq-key")` first. If present → `await call_next(request)` immediately.
2. The route reads the same header (`Header(default=None)` on the path-handler — FastAPI maps `x_groq_key` to header `X-Groq-Key` via standard underscore-to-dash conversion).
3. `run_agent(goal, api_key=...)` uses the override key when constructing `AsyncGroq(api_key=...)`, falling back to the server's `GROQ_API_KEY` when `None`.

This split is important: the **middleware decides whether to gate**, the **loop decides which key to use**. They both look at the same header but for different reasons. Don't try to share state — clarity beats cleverness.

### 10.4 The 429 payload — design for the frontend

When over the limit we return:

```json
{
  "error": "rate_limited",
  "message": "Free tier is capped at 5 runs per 60 minutes. ...",
  "retry_after_seconds": 1234,
  "byo_key_header": "x-groq-key"
}
```

Plus a `Retry-After` header (HTTP-standard, in seconds). Three things in there matter:

- `retry_after_seconds` lets the frontend show a countdown ("try again in 12 minutes") instead of leaving the user guessing.
- `byo_key_header` is a self-describing API: the frontend reads it and knows exactly which header to set without hardcoding the name.
- A clear `message` field — the user will see this verbatim on a basic implementation. Write it for humans.

### 10.5 Trusting `X-Forwarded-For`

When deployed behind Render/Fly/Cloudflare, `request.client.host` is the *proxy's* IP, not the user's — every request looks like it comes from the same address and one limit applies to everyone. The proxy adds `X-Forwarded-For: <real-client>, <hop1>, <hop2>` to record the chain.

```python
fwd = request.headers.get("x-forwarded-for")
if fwd:
    return fwd.split(",")[0].strip()
```

We take the first entry because the leftmost is the originating client. **This trusts the header**, which is fine because traffic only reaches us through a known proxy in production. In an open-internet setup (no proxy), `X-Forwarded-For` is forgeable and you'd want to fall back to `request.client.host`. For Render/Fly's free tier this is the correct call.

### 10.6 Middleware ordering — CORS goes outside

```python
app.add_middleware(RateLimitMiddleware)
app.add_middleware(CORSMiddleware, ...)
```

Starlette runs middleware **inside-out on the way in, outside-in on the way out**. Adding CORS *last* means it wraps the rate limiter. So when the rate limiter returns a `JSONResponse(429, ...)`, CORS still gets to attach the `Access-Control-Allow-Origin` header on the way out — without that, the browser would silently drop the response and the frontend would see an opaque network error instead of the structured 429.

Rule of thumb: **CORS is always the outermost middleware.** Anything that can short-circuit the request (rate limit, auth, IP block) needs CORS to wrap it so its responses are still browser-readable.

### 10.7 What we deliberately didn't do

- **Per-route limits.** Only `/run` is gated. `/health` is free for monitors; OPTIONS preflight isn't a POST and falls through.
- **Per-key limits when BYO-key is supplied.** We don't track BYO-key callers at all — they're paying their own quota, and tracking them would just be surveillance with no payoff.
- **A separate "abuse" tier.** No exponential backoff, no shadow ban. Hit 5/hr → 429. Wait an hour → fresh budget. Simple beats clever.
- **Persisting the deque to disk.** Render's free-tier disk is ephemeral, and as noted in §7.3, restart-clears-state is *fine* — casual abuse doesn't survive a restart anyway.

---

## 11. Frontend — Vite + React + TypeScript (`frontend/`)

The backend yields typed events. The frontend's job is to consume that stream and render each event in real time as a vertical timeline. Three design decisions matter here.

### 11.1 Why Vite + React + TS (and not Next.js, Svelte, vanilla JS)

- **Vite** — instant dev-server start, native ES modules, blazing HMR. For a single-page app with no server-side concerns, Next.js would be over-tooling.
- **React** — most readers' default mental model; the per-event-type components map naturally onto component composition.
- **TypeScript** — we already have a discriminated union of events on the backend (Pydantic). Mirroring it in TS gives us **the same exhaustiveness check across the wire**: if you add `ToolStarted` to the backend without updating `types.ts`, the `switch (ev.type)` in `Timeline.tsx` will fail to typecheck.

### 11.2 Why `fetch` + `ReadableStream`, not `EventSource`

The browser ships an `EventSource` API specifically designed for SSE. We didn't use it. Why?

- **`EventSource` only does GET.** Our `/run` is POST with a JSON body. Switching to GET means goals go in the URL — fine for short ones, terrible for "summarize this 600-character question."
- **`EventSource` cannot set custom request headers.** We need to send `X-Groq-Key` for the BYO-key path. There is no escape hatch — this alone disqualifies it.
- **`EventSource` reconnects automatically.** Sounds nice, but for an agent run that's worse — a half-finished run trying to re-stream from byte zero will confuse both backend and UI. We want one shot per goal.

The replacement is ~30 lines: `fetch("/run", { method: "POST", headers, body, signal })` returns a `Response` whose `body` is a `ReadableStream<Uint8Array>`. We `getReader()`, read chunks, `TextDecoder.decode(..., {stream: true})` them into a string buffer, and split on the SSE blank-line boundary (`\n\n`). For each block we extract `data:` lines, JSON-parse, and `yield` a typed `AgentEvent`.

```ts
const reader = resp.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let boundary;
  while ((boundary = buffer.indexOf("\n\n")) !== -1) {
    const raw = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    const event = parseSseBlock(raw);
    if (event) yield event;
  }
}
```

Two subtle bits:
- `decoder.decode(value, { stream: true })` matters because UTF-8 multi-byte characters can be split across chunks. Without `stream: true`, you'd get garbled text on tokens that happen to land on a code-point boundary.
- The `while ((boundary = ...) !== -1)` loop matters because a single network read can deliver **multiple events at once**. If you parse only the first and continue reading, the second sits in the buffer until the next chunk arrives — which adds avoidable latency to the visualization.

The function returns an **async generator** (`async function* runAgent`). The caller does `for await (const ev of runAgent(...))` which feels just like `async for` on the Python side. Same vocabulary, both ends.

**Real-world gotcha hit during testing:** the SSE spec allows three line endings — `\n`, `\r\n`, and `\r`. The first version of the parser searched for `"\n\n"` as the event boundary. `sse-starlette` actually emits `\r\n\r\n` between events. Substring search for `"\n\n"` will *not* match inside `"\r\n\r\n"` because the bytes between the two newlines are `\r\n`, not nothing. Result: buffer grew forever, no events ever yielded, frontend showed "Running…" with no timeline output — same symptom as a stalled connection, but the bytes were arriving fine. The fix is `nextBoundary()` which checks all three legal separators and picks the first occurrence; line-splitting uses `/\r\n|\r|\n/` for the same reason. **Lesson: when you write a parser for a spec, encode the full spec, not the example you happened to read.**

### 11.3 Discriminated unions in TSX

The TypeScript twin of the Python `Union[Thought, ToolCall, ...]` is:

```ts
export type AgentEvent =
  | { type: "thought"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "final_answer"; text: string }
  | { type: "error"; message: string };
```

In the renderer:

```tsx
switch (ev.type) {
  case "thought":      return <ThoughtCard thought={ev} />;
  case "tool_call":    return <ToolCallCard call={ev} />;
  case "tool_result":  return <ToolResultCard result={ev} />;
  case "final_answer": return <FinalAnswerCard answer={ev} />;
  case "error":        return <ErrorCard error={ev} />;
}
```

Inside each case, TS narrows `ev` to the exact variant — `ev.text` only typechecks in the `"thought"` and `"final_answer"` cases, `ev.args` only in `"tool_call"`. Add a sixth event variant to the union later and TS will complain that the switch isn't exhaustive — **the type system catches the bug for you.**

### 11.4 Token-stream merging

Each chunk from the LLM produces one `Thought` event. If we render one card per chunk, the timeline becomes 200 tiny cards instead of one flowing paragraph. The fix is a one-line merge in `App.tsx`:

```ts
function mergeEvent(prev: AgentEvent[], next: AgentEvent): AgentEvent[] {
  if (next.type === "thought" && prev.length > 0) {
    const last = prev[prev.length - 1];
    if (last.type === "thought") {
      return [...prev.slice(0, -1), { type: "thought", text: last.text + next.text }];
    }
  }
  return [...prev, next];
}
```

A new `Thought` is concatenated onto the previous one **only if** the previous event was also a thought. Once a `ToolCall` lands, the next thought starts a fresh block. This gives you the "thinking → calling tool → thinking again" rhythm that reads like the agent's own narration.

### 11.5 BYO-key UX — keys live in localStorage, not React state alone

When a user pastes their Groq key, we store it in `localStorage["glassbox.groqKey"]` and in component state. Reasons for both:

- **localStorage** so it survives a page refresh — typing an API key once per session is enough.
- **State** so the UI re-renders when the key changes (localStorage doesn't trigger renders on its own).

We **never** send the key anywhere except in the `X-Groq-Key` header to our own backend. The "forget" button removes it. This is the lightest-possible design that keeps the key out of our database (we don't have one), out of URLs, and out of our logs (the backend only reads the header and passes it to Groq's SDK in memory).

### 11.6 Tailwind — utility-first for a small team

Tailwind compiles utility classes into the final stylesheet. Pros for this project:

- No `.css` files to maintain, no naming bikeshed (`tool-call-card-header__title--collapsed`).
- The component file is the styling — read one file, see everything.
- The build only ships classes you actually used, so the CSS is tiny (~10kB gzipped here).

The watch-out: dynamic class names like `border-${color}-700` won't work because Tailwind's JIT statically scans your source for class strings. Solution in `toolColor.ts` — full class strings are written out per palette and the function just returns one of them. Static strings only.

### 11.7 Vite proxy — sidestepping CORS in dev

`vite.config.ts` proxies `/run` and `/health` to `http://localhost:8000`. This means the frontend always talks to its own origin — no CORS headers needed in dev. CORS still matters in production (where the frontend may be served from a different origin), but we don't pay the cost during development.

### 11.8 What we deliberately didn't add

- **No state management library.** `useState` + `useReducer` covers the full app. Adding Redux/Zustand for a list-of-events would be cargo-culting.
- **No router.** One screen. React Router's bundle isn't worth zero benefit.
- **No design system.** Tailwind utilities are enough to look intentional without committing to a component library that we'd then have to override.
- **No re-stream-on-rate-limit.** When 429 hits, we surface the BYO-key prompt and let the user resubmit. Auto-resubmitting under a freshly-pasted key is convenient but invisible — the user should *see* their key was accepted before any new request fires.

---

## 12. The wire vocabulary in detail (`app/agent/events.py`)

`§1` introduced Pydantic and discriminated unions; this section walks the actual file line-by-line and explains why each field type is what it is.

```python
class Thought(BaseModel):
    type: Literal["thought"] = "thought"
    text: str

class ToolCall(BaseModel):
    type: Literal["tool_call"] = "tool_call"
    name: str
    args: dict[str, Any]

class ToolResult(BaseModel):
    type: Literal["tool_result"] = "tool_result"
    name: str
    result: Any

class FinalAnswer(BaseModel):
    type: Literal["final_answer"] = "final_answer"
    text: str

class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    message: str

AgentEvent = Union[Thought, ToolCall, ToolResult, FinalAnswer, ErrorEvent]
```

### 12.1 Why these particular field types

- **`text: str`** on `Thought` and `FinalAnswer` — both are flat strings. `Thought` is a token-stream delta (one of many concatenated upstream); `FinalAnswer` is the assembled final output. Same shape, different meaning. We keep them as separate types because the *renderer cares* — italic streaming for thoughts, highlighted block for the answer.
- **`args: dict[str, Any]`** on `ToolCall` — the LLM produces JSON conforming to a tool's JSON Schema, but at the Python level we don't enforce that schema again. The schema enforcement happened on the LLM side (Groq validates the tool arguments before emitting). `dict[str, Any]` lets any tool with any argument shape flow through this one type without per-tool subclasses.
- **`result: Any`** on `ToolResult` — tools return whatever JSON-serializable shape makes sense for them. Wikipedia returns `{title, extract, url}`, calculator returns `{expression, result}`, the error path returns `{error: str}`. A strict union over every tool's result shape would be maintenance overhead with no payoff — the consumer (the LLM, then the frontend) treats it as opaque JSON either way.
- **`message: str`** on `ErrorEvent` — flat string. Errors are surfaces shown verbatim, not structured payloads to parse.

### 12.2 The serialization round-trip

Each `AgentEvent` is sent over SSE as JSON. Pydantic's `.model_dump_json()` does the work:

```python
yield {"event": event.type, "data": event.model_dump_json()}
```

Because the discriminator field is named `type` *and* the SSE envelope's `event:` channel is also derived from `event.type`, you get a perfect round-trip:

1. Backend constructs `Thought(text="Hi")`.
2. `.model_dump_json()` → `'{"type":"thought","text":"Hi"}'`.
3. SSE frame on the wire: `event: thought\ndata: {"type":"thought","text":"Hi"}\n\n`.
4. Frontend `JSON.parse(...)` → `{type: "thought", text: "Hi"}`.
5. TypeScript narrows on `ev.type === "thought"` and `ev.text` is accessible.

The Python `Literal["thought"]` and the TS `type: "thought"` are isomorphic — change one and the other breaks at compile/type-check time.

### 12.3 Why a `Union` of distinct models, not one model with optional fields

A common alternative is:
```python
class AgentEvent(BaseModel):
    type: str
    text: str | None = None
    name: str | None = None
    args: dict | None = None
    result: Any | None = None
    message: str | None = None
```

We didn't do this for two reasons:

1. **Optionality leaks downstream.** Every consumer would have to handle `None` for fields that *can never be None* in their variant ("a Thought has no `name`, why am I checking `name is None`?"). With the union, type narrowing eliminates impossible variants.
2. **Schema clarity.** `Union[Thought, ToolCall, ...]` reads as a list of valid shapes — which is exactly what we mean. The optional-fields blob says "a thing with all of these maybe-fields," which doesn't reflect the domain.

---

## 13. Groq + `gpt-oss-20b`: model choice and SDK quirks

The brief gave us "Groq for free, fast inference." But Groq hosts many models and has API extensions that need explanation.

### 13.1 Why `openai/gpt-oss-20b`

We tried a few models on Groq's free tier; gpt-oss-20b won because:

1. **Reliable tool-calling.** Some smaller open models on Groq have shaky tool support — they hallucinate JSON, pick the wrong tool, or skip the tool entirely. gpt-oss reliably emits valid `tool_calls` deltas with the right schema.
2. **Exposes a separate reasoning stream.** The gpt-oss family was trained to emit its planning trace as a distinct output. Groq's API surfaces it as `delta.reasoning` — **this is the lifeblood of our visualization.** It gives us continuous "Thought" events between tool calls without the model needing to be cajoled into "thinking out loud" via prompt engineering.
3. **Sweet spot at 20B.** Faster than the 70B siblings; smarter than the small ones; the tool-calling quality is solid at this size.

### 13.2 `extra_body` and Groq-specific params

OpenAI's SDK has a fixed parameter surface (`model`, `messages`, `tools`, etc.). Groq's API extends OpenAI compatibility with extra knobs. To pass them without forking the SDK, the OpenAI/Groq Python client accepts an `extra_body` dict that is merged into the JSON request body:

```python
stream = await client.chat.completions.create(
    model=GROQ_MODEL,
    messages=messages,
    tools=tool_defs,
    parallel_tool_calls=False,
    stream=True,
    extra_body={
        "reasoning_effort": "medium",
        "reasoning_format": "parsed",
    },
)
```

- **`reasoning_effort`** ∈ `{"low", "medium", "high"}`. Higher = more reasoning tokens before the model emits content or tool calls. Medium is the right default for this demo: enough thought to make the timeline feel substantive, not so much that simple goals take 30 seconds.
- **`reasoning_format: "parsed"`** — asks Groq to deliver the chain-of-thought as a separate `reasoning` field on each delta, not interleaved with `content`. The alternative `"raw"` would mix them into a single token stream, which would force us to either parse the raw mixture (fragile) or surface chain-of-thought directly to the user as the "answer" (wrong — chain-of-thought is internal and shouldn't be the final answer).

### 13.3 `parallel_tool_calls=False` — why we forbid parallel

When set to `False`, the model emits **at most one tool call per assistant turn**. Reasons:

- **Narrative.** The visualization tells a sequential story. Parallel tool calls would have to render simultaneously, breaking the "thought → call → observe → next thought" cadence the audience tracks.
- **Iteration semantics.** With `False`, `MAX_ITERATIONS = 8` is meaningful — it caps the number of LLM↔tool exchanges. With parallel calls, one iteration could run six tools and the budget becomes ambiguous.
- **Determinism.** Sequential calls let the model react to each result before deciding the next call. Parallel calls force the model to pre-commit to a fan-out without the first result's information.

Some workloads benefit from parallel (e.g. fan-out search on independent queries). This app is about a single chain of reasoning, so we explicitly opt out.

### 13.4 The `delta.model_extra` forward-compat trick

The Groq SDK's `ChoiceDelta` Pydantic model has typed fields for `content`, `tool_calls`, etc. `reasoning` may not be one of them yet (the SDK's type definitions lag the API). When Pydantic parses an unknown field, it stashes it in `model_extra` (a dict for "things the schema didn't know about").

```python
reasoning = getattr(delta, "reasoning", None) or (
    delta.model_extra or {}
).get("reasoning")
```

This double-lookup is forward-compatible: when the SDK adds a typed `reasoning` field, `getattr` picks it up directly; until then, we fall through to `model_extra`. Both forms work the same in practice. **The general lesson: when the upstream API is ahead of the SDK, reach into `model_extra` instead of fighting Pydantic's strictness — it's the documented escape hatch.**

### 13.5 Streaming + `parallel_tool_calls=False` still need the buffer

Even with parallel calls disabled, Groq still streams the single tool call's `id`, `name`, and `arguments` across multiple chunks. The accumulator pattern in §9.2 (`tool_calls_buf` keyed by `index`) is still required — `parallel_tool_calls=False` only reduces the *count* of indices, not the streamed assembly itself. Removing the buffer because "we know there's only one call" would break the moment Groq's chunking changes.

---

## 14. The OpenAI/Groq tool-calling envelope

Tool calling involves two related JSON shapes that are easy to confuse: the **definition** the server sends to the LLM, and the **call** the LLM emits back.

### 14.1 Shape A — tool *definitions* sent to the LLM

```python
[{
  "type": "function",
  "function": {
    "name": "wikipedia",
    "description": "Look up a Wikipedia article ...",
    "parameters": {           # ← this is a JSON Schema object
      "type": "object",
      "properties": {
        "title": {"type": "string", "description": "..."}
      },
      "required": ["title"]
    }
  }
}, ...]
```

The outer `{type: "function", function: {...}}` envelope is fixed boilerplate. The interesting bit is `parameters`, which is a **JSON Schema** describing the arguments. The LLM uses this schema to produce a syntactically-valid call.

In our code, each `Tool` dataclass stores only the **inner `parameters`** in its `schema` field (see `app/tools/calculator.py` for an example). The agent loop's `_to_groq_tool` helper wraps it in the full envelope:

```python
def _to_groq_tool(tool: Tool) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.schema,
        },
    }
```

The split keeps individual tool files small — they describe themselves, not the wire shape.

### 14.2 Shape B — tool *call* the LLM emits

```python
{
  "role": "assistant",
  "content": "Let me check Wikipedia.",
  "tool_calls": [{
    "id": "call_abc123",
    "type": "function",
    "function": {
      "name": "wikipedia",
      "arguments": '{"title": "Tokyo"}'   # ← stringified JSON, not a parsed dict
    }
  }]
}
```

Two things people get wrong here:

1. **`arguments` is a JSON-encoded string, not a parsed dict.** The LLM produces the string; you `json.loads(arguments)` to get a dict before calling your tool. Streaming makes this even more interesting: the string fragments arrive across chunks, so you concatenate the deltas first and parse once at the end.
2. **The `id` is mandatory and used to pair the result back.** When you append the tool result, it goes as `{role: "tool", tool_call_id: "call_abc123", content: ...}`. Without the id, the model can't match results to calls — and that *does* matter even with `parallel_tool_calls=False`, because the model's next turn still references its prior tool call by id.

### 14.3 The `name` field is the system's spinal cord

The same string `"wikipedia"`:
- Names the `Tool` instance in the registry (`TOOLS_BY_NAME["wikipedia"]`).
- Sits in the `function.name` field of the definition we send to the LLM.
- Comes back from the LLM in the tool-call delta as `function.name`.
- Goes onto the `ToolCall` and `ToolResult` events emitted to the frontend.
- Maps to a per-tool color palette in the frontend (`toolColor("wikipedia")`).

One name, six places. Use a short, snake-case identifier and never rename it casually — the convention pays for itself in grep-ability.

---

## 15. Smoke testing strategy — three layers, three techniques

This project has three smoke scripts, one per architectural layer. They look superficially similar but use intentionally different techniques.

### 15.1 `smoke_tools.py` — pure functional, no mocks

Tools are pure async functions. Test them by calling them. No FastAPI, no Groq, no SSE.

```python
cases = [
    ("calculator", {"expression": "(125000000 / 13960000) * 100"}),
    ("calculator", {"expression": "__import__('os').system('echo pwned')"}),
    ("wikipedia", {"title": "Tokyo"}),
    ("wikipedia", {"title": "this_article_definitely_does_not_exist_123"}),
    ("url_fetcher", {"url": "https://example.com"}),
]
for name, args in cases:
    result = await TOOLS_BY_NAME[name].execute(args)
    ...
```

The malicious calculator case (`__import__('os').system(...)`) is a **security regression test** — if our AST whitelist breaks, this script will let it through, and we'll see arbitrary code execution succeed. As long as it returns `{error: "disallowed expression node: Call"}`, we're safe.

### 15.2 `smoke_loop.py` — full loop, real Groq

End-to-end test of the agent loop including a real Groq round-trip. Slow, costs tokens, but **catches everything from the system prompt up to event emission**. The other smoke tests can't catch a system-prompt regression — only this one can.

```python
async for event in run_agent("What is the population of Tokyo, ..."):
    if event.type == "thought":
        print(event.text, end="", flush=True)
    else:
        print(f"\n[{event.type}] {...}\n")
```

The custom print logic mirrors how the frontend renders: thoughts inline (no newline), other events as blocks. Reading the script's output gives you a feel for whether the agent's behavior would look right in the browser.

### 15.3 `smoke_ratelimit.py` — middleware in isolation

The middleware is interesting on its own. We mount it on a tiny FastAPI app with a non-SSE `/run` handler so the test exercises only the rate-limit logic. This sidestepped two real problems:

1. **Token cost.** We don't want to burn Groq calls testing 429 behavior.
2. **TestClient + sse-starlette.** TestClient creates a fresh asyncio event loop per request. `sse-starlette` keeps a module-level `AppStatus.should_exit_event` bound to the first loop it sees. Hit it twice and the second call dies with `Event is bound to a different event loop`. The fix isn't a code change; it's choosing a non-SSE handler in the test so the rate-limit decision happens in middleware *before* the SSE path ever runs.

That second one is the kind of bug you only learn by hitting it. The general lesson: **isolate middleware tests from the response stack the middleware happens to wrap in production.** Whatever response handler you use in the test should be the simplest one that can possibly pass.

### 15.4 `debug_groq.py` — diagnostic, throwaway

Not a regression test. A scratch pad that probes Groq directly: try (model × stream) combinations, run a "reasoning probe" to confirm the `reasoning` field shape. Used during development when the loop misbehaved and we needed to know "what does the API actually return for input X." Keeping it in the repo is useful for the next time something looks off — debugging from scratch is slower than reusing a probe.

### 15.5 Why this layering matters

A failure should be identifiable at the **lowest layer it manifests**. If `smoke_tools.py` is green but `smoke_loop.py` is red, the bug is in the loop or the system prompt — not in the tools. If both are green but a browser run misbehaves, the bug is in the SSE wire or frontend, not the agent. Each smoke owns a slice of the failure surface.

A useful dev habit: when something breaks, run the lowest-level smoke that exercises the suspect code first. It triages 90% of bugs in under a minute.

---

## 16. Frontend dev tooling — every config file explained

Vite + React + TypeScript + Tailwind is a four-tool stack. Each tool needs a config; here's what each does and why the settings are what they are.

### 16.1 `package.json` — dependency annotations

**Runtime (`dependencies`):**
- **`react`** + **`react-dom`** — the runtime itself. React produces a virtual DOM; ReactDOM is what reconciles that into the actual browser DOM. They're separate packages because React Native uses `react` with a different reconciler.

**Build-time (`devDependencies`):**
- **`@types/react`** / **`@types/react-dom`** — TypeScript declaration files. React itself ships JS, not TS; these `@types/*` packages give the compiler type info. Without them, every `useState`, `JSX.Element`, etc. would be `any`.
- **`@vitejs/plugin-react`** — Vite plugin that handles JSX/TSX transformation and Fast Refresh (HMR for React components specifically). Without it, Vite would treat `.tsx` as plain TS and choke on JSX.
- **`tailwindcss`** — the CSS framework. Build-time tool that scans your source for class names and emits a CSS file containing only the classes you used.
- **`postcss`** + **`autoprefixer`** — PostCSS is a CSS-transform pipeline; autoprefixer adds vendor prefixes (e.g. `-webkit-` for Safari). Tailwind runs as a PostCSS plugin, so these are required for the Tailwind build.
- **`typescript`** — the `tsc` compiler. Vite's runtime build uses esbuild, which **strips types but doesn't typecheck**. We run `tsc -b --noEmit` separately to actually verify types.
- **`vite`** — dev server (with HMR) and production builder.

**Scripts:**
- `dev` → `vite` — starts the dev server.
- `build` → `tsc -b && vite build` — typechecks first, builds second. The `tsc -b` step is what catches type errors; without it, Vite would happily produce a bundle from broken TS.
- `typecheck` → `tsc -b --noEmit` — typecheck only. CI-friendly.

### 16.2 `tsconfig.json` — what each strict flag actually does

```json
{
  "target": "ES2022",
  "useDefineForClassFields": true,
  "lib": ["ES2022", "DOM", "DOM.Iterable"],
  "module": "ESNext",
  "moduleResolution": "bundler",
  "allowImportingTsExtensions": true,
  "resolveJsonModule": true,
  "isolatedModules": true,
  "moduleDetection": "force",
  "noEmit": true,
  "jsx": "react-jsx",
  "strict": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noFallthroughCasesInSwitch": true
}
```

- **`"strict": true`** — enables the whole strict family: `strictNullChecks`, `strictFunctionTypes`, `noImplicitAny`, etc. The foundation of meaningful type safety. Without it, TypeScript's checks are mostly cosmetic.
- **`"noUnusedLocals" / "noUnusedParameters"`** — flag dead variables and unused params. Catches typos and forgotten imports.
- **`"noFallthroughCasesInSwitch"`** — error if a `case` falls through without `break` / `return`. Protects against the C-style fallthrough bug in our event renderer's switch.
- **`"moduleResolution": "bundler"`** — tells TS to resolve imports the way modern bundlers (Vite, esbuild, Webpack 5) do, not the way Node's classic CommonJS did. Notably, this allows `.ts` extensions in imports (the **`allowImportingTsExtensions`** flag).
- **`"jsx": "react-jsx"`** — emits JSX using React 17's automatic runtime. **No `import React from "react"` boilerplate** at the top of every component file; the compiler injects the necessary runtime import.
- **`"isolatedModules": true`** — every file must be independently compilable (no const enums, no merged declarations across files). Required for esbuild-based tooling like Vite, which compiles files in parallel without seeing each other.
- **`"useDefineForClassFields": true`** — class field semantics that match the ES2022 standard (`Object.defineProperty` semantics, not assign-in-constructor). Modern default; rarely matters for React function components but is the right setting the day you write a class.
- **`"noEmit": true`** — TypeScript only typechecks; it never writes `.js` files. Vite/esbuild does the actual emit.
- **`"lib": ["ES2022", "DOM", "DOM.Iterable"]`** — which built-in types are available. DOM types let us use `document`, `fetch`, `localStorage`, `EventSource`, etc. without separate `@types` packages.

### 16.3 `vite.config.ts` — the dev server proxy

```ts
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/run": { target: "http://localhost:8000", changeOrigin: true },
      "/health": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
});
```

- **`plugins: [react()]`** — the JSX/HMR plugin from above.
- **`server.port: 5173`** — Vite's default dev port. Pinned so the backend's `ALLOWED_ORIGINS` can hardcode it.
- **`server.proxy`** — the dev-only HTTP proxy. Browser issues `fetch("/run", ...)`; Vite's dev server intercepts that path and forwards to `localhost:8000`. The browser sees only one origin (the Vite server), so **no CORS preflights happen at all** — same-origin requests are CORS-exempt.
- **`changeOrigin: true`** — rewrites the `Host` header to match the target. Some upstreams reject requests where `Host` doesn't match what they expect (virtual-host configs, cloud platforms); this avoids that whole class of bug.

In production, the proxy is gone — the frontend either lives on the same origin as the backend (single deployment) or it doesn't (separate deployments) and the backend's CORS middleware grants the production frontend's origin via `ALLOWED_ORIGINS`. The dev proxy is purely a development convenience.

### 16.4 `tailwind.config.js` — content scanning

```js
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: { fontFamily: { mono: [...] } } },
};
```

- **`content`** — the glob list Tailwind scans for class names. The build pipeline reads these files, finds every `class="..."` / `className="..."` token, and emits CSS for only those classes. **This is why dynamic class strings (`border-${color}-700`) silently fail** — the dynamic concatenation never appears as a complete token in the source, so Tailwind never emits the rule. The `toolColor.ts` workaround returns full static strings precisely for this reason.
- **`theme.extend`** — extend Tailwind's defaults instead of overwriting them. Replacing them outright would erase the spacing scale, color palette, etc.

### 16.5 `postcss.config.js` — the CSS pipeline

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

PostCSS is the engine; Tailwind and autoprefixer are plugins that run inside it. The order is **Tailwind first** (expands utility classes into real CSS), **autoprefixer second** (adds vendor prefixes to the resulting CSS). Vite reads this file automatically when it sees CSS imports.

### 16.6 `index.html` — single-page entrypoint

```html
<body class="bg-slate-950 text-slate-100">
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
```

- **`<div id="root">`** — React's mount point. SPA convention.
- **`<script type="module" src="/src/main.tsx">`** — Vite serves modules natively over HTTP in dev (no bundle step). The `/src/...` path is real — Vite serves the project root.
- **Body classes** — Tailwind classes set the dark theme at the document level so the viewport background paints correctly even before React mounts. Otherwise you get a white flash on first load.

---

## 17. Frontend components — what each file does

### 17.1 `src/main.tsx` — the entrypoint

```tsx
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- **`createRoot(...)`** — React 18's concurrent renderer entry point. Replaces the older `ReactDOM.render`.
- **`!` (non-null assertion)** — `document.getElementById` is typed as `HTMLElement | null`. We assert non-null because we control `index.html` and know `#root` exists.
- **`<React.StrictMode>`** — development-only wrapper that double-invokes effects and lifecycle methods to surface impure code. **This is why you'll sometimes see two SSE requests fire in dev** — StrictMode mounts → runs effects → unmounts → remounts → runs effects again. We don't fire `runAgent` from an effect (it's user-triggered), so it doesn't bite us. In production builds, StrictMode is a no-op.

### 17.2 `src/App.tsx` — the orchestrator

State:
- `events: AgentEvent[]` — the timeline.
- `busy: boolean` — disables the form while a run is in flight.
- `rateLimited: RateLimitedPayload | null` — when set, render the BYO-key banner.
- `byoKey: string | null` — the user's Groq key, lazily read from localStorage on first render (see §18.2).
- `abortRef: useRef<AbortController | null>` — the in-flight request's abort handle (see §18.1).

`startRun` is the workhorse:
1. Cancel any in-flight request (`abortRef.current?.abort()`).
2. Fresh `AbortController` for this run; store the ref.
3. Reset state (`events`, `rateLimited`, `busy`).
4. `for await` the SSE stream, append each event via `mergeEvent` (see §18.3).
5. Catch `RateLimitError` → show banner. Catch `AbortError` → silent (intentional cancel). Catch anything else → push as a synthetic `ErrorEvent` so the user sees what failed.

`useKey` writes the BYO-key to localStorage and clears the rate-limit banner. We deliberately *don't* auto-resubmit the goal — the user should *see* their key was accepted before any new request fires (see §11.8).

### 17.3 `src/components/GoalForm.tsx` — controlled input

Plain controlled `<textarea>` + submit button. Disabled when `busy` or empty.

Two non-obvious bits:

- **`e.preventDefault()`** in the submit handler — without it, the browser performs a real form submission, which reloads the page. Easy to forget; instantly visible bug.
- **`disabled={busy || !goal.trim()}`** on the button — visually communicates that submitting an empty goal is invalid, *and* prevents the keyboard-driven submit (Enter key) from firing. Belt and suspenders.

### 17.4 `src/components/Timeline.tsx` — dispatch on the discriminator

```tsx
function renderEvent(ev: AgentEvent) {
  switch (ev.type) {
    case "thought":      return <ThoughtCard thought={ev} />;
    case "tool_call":    return <ToolCallCard call={ev} />;
    case "tool_result":  return <ToolResultCard result={ev} />;
    case "final_answer": return <FinalAnswerCard answer={ev} />;
    case "error":        return <ErrorCard error={ev} />;
  }
}
```

Pure dispatch on the discriminator. Each case **narrows** `ev` to the specific variant — `ev.text` only typechecks where it exists. Add a sixth event variant to `AgentEvent` and TS refuses to compile this switch (because it's no longer exhaustive).

The `key={i}` on the mapped div is **OK here** because the timeline is **append-only with no reordering** (see §18.4). If we ever start removing or sorting events, we'd need a real id.

### 17.5 `src/components/events/ThoughtCard.tsx`

One italic block per merged thought run. The merging happens upstream in `App.mergeEvent`; this component just renders the resulting `text`.

Key style bit: **`whitespace-pre-wrap`** preserves newlines and runs of spaces from the model's output so paragraph breaks render correctly. Default `white-space: normal` would collapse them, turning multi-paragraph thoughts into a wall of text.

### 17.6 `src/components/events/ToolCallCard.tsx`

Card with `→ tool_name(...)` and a "show args" toggle. Args render as pretty-printed JSON inside a `<pre>`. Local `useState(false)` for the toggle state — no need to lift it because each card's collapse state is independent of every other card.

The `→` arrow signals "outbound call." The result card mirrors with `←`.

### 17.7 `src/components/events/ToolResultCard.tsx`

Same shape as `ToolCallCard` plus two additions:

- **Error detection.** If `result.result` is an object containing an `error` key, switch to a red palette. This catches the structured-error path tools use for recoverable failures (see §8.7).
- **Truncation toggle.** Long results (>240 chars when stringified) collapse to a preview with an "expand" button. Wikipedia and `url_fetcher` results can be hundreds of lines; without this, the timeline becomes unreadable.

### 17.8 `src/components/events/FinalAnswerCard.tsx`

Highlighted indigo block at the bottom. `whitespace-pre-wrap` again; `leading-relaxed` for vertical spacing on multi-paragraph answers.

### 17.9 `src/components/events/ErrorCard.tsx`

Red block with monospace `message`. Used both for backend-emitted `ErrorEvent`s (e.g. "max iterations reached") and for transport errors caught in `App.tsx` (e.g. network failure). Same component, different sources — keeps the rendering consistent.

### 17.10 `src/components/events/toolColor.ts`

Static palette map: tool name → `{border, bg, text}` Tailwind class strings. Static strings are critical here; see §16.4 on Tailwind content scanning.

### 17.11 `src/components/RateLimitBanner.tsx`

Amber banner. Local state for the in-progress key input (`useState("")`). On submit, calls back to `App.useKey`, which writes localStorage and clears the banner.

The input is `type="password"` so the API key isn't shoulder-surfable. The banner explains the contract: the key stays in the browser, it's sent as the named header, and it bypasses the limit.

---

## 18. React patterns used in this app

### 18.1 `AbortController` + `useRef` for in-flight cancellation

```tsx
const abortRef = useRef<AbortController | null>(null);

async function startRun(...) {
  abortRef.current?.abort();
  const ctrl = new AbortController();
  abortRef.current = ctrl;
  ...
  for await (const ev of runAgent(goal, key, ctrl.signal)) {...}
}
```

**Why `useRef` instead of `useState`?**
- The controller is **mutable, non-rendering state**. Updating it should not trigger a re-render — nothing in the JSX depends on which controller is current.
- `useState` would force a re-render on every assignment. Worse, the setter is async (the new value isn't visible until the next render), which would race with the immediate "abort previous and replace" we want.
- `useRef` gives a stable mutable container preserved across renders, **without participating in render**. Exactly what we need.

When the AbortSignal aborts mid-stream, `fetch` rejects with a `DOMException` whose `name` is `"AbortError"`. We swallow it in the catch block (`if ((err as Error).name !== "AbortError")`) — abort is intentional, not a real error.

### 18.2 Lazy initial state for localStorage

```tsx
const [byoKey, setByoKey] = useState<string | null>(
  () => localStorage.getItem(BYO_KEY_STORAGE),
);
```

The arrow form of `useState` runs the initializer **once**, on first render. The non-arrow form `useState(localStorage.getItem(...))` would call `localStorage.getItem` on **every render** — harmless but pointless, since `useState` ignores the argument after the first render.

The lazy form is the canonical idiom for "expensive or side-effecting initial state."

**SSR caveat (doesn't apply here, but worth knowing):** in a server-rendered app, `localStorage` doesn't exist on the server, and a direct read would crash. Vite SPAs only render in the browser, so we can read it directly. If this codebase ever moves to Next.js or Remix, this line needs a guard.

### 18.3 Immutable updates with `mergeEvent`

```tsx
function mergeEvent(prev, next) {
  if (next.type === "thought" && prev.length > 0) {
    const last = prev[prev.length - 1];
    if (last.type === "thought") {
      return [...prev.slice(0, -1), { type: "thought", text: last.text + next.text }];
    }
  }
  return [...prev, next];
}
```

Always returns a **new array**, even when "merging" — we replace the last item with a *new* object whose `text` is the concatenation. This is required because React detects state changes by **reference identity** (`Object.is`); mutating `prev[prev.length - 1].text += ...` would not trigger a re-render, and you'd see the timeline freeze at the first thought delta.

The same rule (immutability) is why we spread (`[...prev, next]`) instead of `prev.push(next)`.

### 18.4 Why `key={i}` is OK here, and when it isn't

React uses keys to match elements between renders. The two failure modes:

1. **Unstable keys** (e.g. `key={Math.random()}`) — every render produces new keys, every element unmounts/remounts, internal state (e.g. the "show args" toggle) resets every render.
2. **Index keys on a reordering list** — if items A, B, C reorder to C, A, B, React thinks position 0 changed from A to C and replaces the DOM node, including its internal state. Toggle states swap incorrectly.

In `Timeline`, the list is **append-only with no reordering**. Index 0 is always the first event, which never changes once written. So `key={i}` is stable.

**If we ever start filtering, sorting, or removing events, index keys become a bug** and we'd need a real id (a sequence counter assigned at append time is the usual fix).

### 18.5 Why no `useEffect` to fire `runAgent`

Effects run **after** render. If we put `runAgent` inside a `useEffect`, the request would fire after a render where some "trigger" state changed — meaning we'd need an explicit trigger flag, an effect that watches it, and a reset. That's three state pieces for one user action.

Instead, `runAgent` runs inside an event handler (`onSubmit`). The user clicks → we call the function directly → state updates as events arrive. Simpler.

The general rule: **effects are for reacting to state, not for performing user actions.** Click handlers are for user actions; effects are for "when X became true, do Y."

### 18.6 Why no global state library

The app's state is **owned by one component**: `App` holds `events`, `busy`, `rateLimited`, `byoKey`, plus the abort ref. Children get exactly what they need via props. No prop-drilling pain because the tree is two levels deep.

Adding Redux/Zustand/Jotai would require a store, actions, selectors — all to manage one list-of-events. Net negative until the tree gets deep enough that prop-drilling is awkward (probably never, for this app).

---

## §19 — Deployment: Render (backend) + Vercel (frontend)

### 19.1 Why split hosts?

Render and Vercel each shine at one half:

- **Render** runs long-lived Python processes well — it speaks the "container with a port" model that FastAPI/uvicorn expects. Vercel's Python runtime is serverless (functions, not processes), and SSE streaming over a function-with-timeout is fragile. SSE is our wire format, so we need a real process.
- **Vercel** is the no-fuss path for a Vite SPA: `git push` → CDN-cached static build with previews per branch. Render can host static sites too, but Vercel's DX wins for frontends.

The one cost of splitting hosts is **CORS**: the frontend's origin (`*.vercel.app`) is different from the backend's (`*.onrender.com`), so the browser enforces CORS on every request. We already had `CORSMiddleware` from local dev; we just feed it the Vercel URL via `ALLOWED_ORIGINS`.

### 19.2 The dev-vs-prod URL problem

In dev we use **same-origin** URLs: the frontend calls `/run` and Vite's dev-server proxy forwards to `http://localhost:8000`. No CORS, no env var.

In prod the backend lives at a different origin, so `/run` would resolve to the Vercel domain (404). The fix is a base-URL env var:

```ts
const resp = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}/run`, ...);
```

- **Dev**: `VITE_API_BASE` is unset → `?? ""` → URL is `/run` → Vite proxy handles it. Unchanged behavior.
- **Prod**: `VITE_API_BASE=https://glassbox-api.onrender.com` (set in Vercel project settings) → URL is the absolute backend URL. Browser sends a CORS preflight, backend responds with `Access-Control-Allow-Origin: <vercel url>`, request proceeds.

**Why the `VITE_` prefix is mandatory**: Vite only inlines env vars that start with `VITE_` into the client bundle. Anything else stays server-side (and there *is* no server side in a static SPA, so it just disappears). This is a security guardrail — it stops you from accidentally shipping `DATABASE_URL` to every browser.

**Why `import.meta.env` instead of `process.env`**: Vite is ESM-native and runs in the browser. `process` is a Node global; it doesn't exist in the browser bundle. `import.meta.env` is the standardized ESM way to expose build-time constants. Vite replaces `import.meta.env.VITE_API_BASE` with a string literal at build time — there's no runtime lookup.

### 19.3 The `render.yaml` blueprint

Render supports two configuration styles: dashboard clicks, or a `render.yaml` "Infrastructure as Code" blueprint checked into the repo. We chose the blueprint — the next deploy is a `git push`, not a memory test.

Key fields:

- `runtime: python` — Render auto-detects Python from `requirements.txt` but specifying it is explicit and survives if we ever add other files.
- `rootDir: backend` — our repo is a monorepo (backend + frontend at root); `rootDir` tells Render to `cd backend` before running build/start. Without it, `pip install -r requirements.txt` would fail to find the file.
- `startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT` — three things matter here:
  - `0.0.0.0` (not `127.0.0.1`): bind on all interfaces. The default (`localhost`) only accepts connections from the same machine, and Render's load balancer is *not* on the same machine.
  - `$PORT`: Render assigns the port at runtime via env var. Hardcoding `8000` would work on first boot and silently fail when Render reassigns the port.
  - `app.main:app`: module path → FastAPI instance. This is why `app/__init__.py` exists.
- `envVars` with `sync: false` — declares that `GROQ_API_KEY` and `ALLOWED_ORIGINS` are required, but their values are **not** stored in the YAML (which lives in git). They're set in the dashboard. Secrets in the repo is the most common how-did-our-key-leak story; `sync: false` is the guardrail.
- `PYTHON_VERSION: 3.11.9` — pinned. Without a pin, Render uses whatever its default is, which drifts. We also write the same version into `runtime.txt` because some Render code paths still read it (belt + suspenders).

### 19.4 The cold-start tradeoff on Render's free tier

Render's free web service spins down after 15 minutes of inactivity. The next request takes ~30–60s to wake the container — uvicorn boot, Python import, model client init. For a personal demo this is fine; for anything user-facing, it's a UX problem.

The mitigations, in order of escalation:

1. **Accept it** + show a "starting up..." state in the UI on the first call. We're at this tier.
2. **Cron a wake-up ping** every 10 min from a free service (UptimeRobot, GitHub Actions). Effectively keeps the dyno warm; mildly violates the spirit of the free tier.
3. **Upgrade to Render's paid plan** ($7/mo) — no spindown.
4. **Move to Fly.io** — their free tier keeps machines suspended (not stopped) and resumes in ~250ms.

If the demo gets real traffic, (4) is the cleaner answer than (2).

### 19.5 The `vercel.json` SPA-rewrite trick

Vercel serves static files matching the URL path. A user navigating directly to `https://glassbox.vercel.app/` works (serves `index.html`), but as soon as we add client-side routes (`/runs/123`, `/about`), a refresh on those URLs would 404 — there's no `runs/123.html` on disk.

The standard SPA fix:

```json
"rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
```

This says: for any path, serve `/index.html`. The browser receives the SPA bundle, React Router (or whatever) reads `window.location` and renders the right view. It's a **rewrite**, not a redirect — the URL in the address bar is preserved.

We don't have client-side routes yet, but adding the rewrite up-front costs nothing and saves a debugging session later. (And `framework: "vite"` triggers Vercel's Vite-specific build optimizations.)

### 19.6 Deploy ordering (chicken-and-egg)

The two services depend on each other's URLs:

- Backend `ALLOWED_ORIGINS` needs the Vercel URL (for CORS).
- Frontend `VITE_API_BASE` needs the Render URL (for fetch).

The unblocking move:

1. Deploy backend first with `ALLOWED_ORIGINS=*` (temporary). Get the Render URL.
2. Set `VITE_API_BASE=<render-url>` in Vercel, deploy frontend. Get the Vercel URL.
3. Set `ALLOWED_ORIGINS=<vercel-url>` in Render, redeploy. CORS is now tight.

Step 3 is non-optional — leaving `*` open means any site on the internet can call our Groq-burning endpoint. The rate limiter helps, but origin-restricting is the cheap first defense.

---

## §20 — Why Render, and what we'd pick if we were redoing it

A natural interview question after seeing the Render URL spin up cold: *"Why use a host that goes down after inactivity?"* The answer matters less for the technical content and more for showing that the choice was **deliberate** rather than accidental.

### 20.1 The honest defense

> Render's free tier was the fastest path to a deployable Python container with a public URL — its blueprint model gave me infra-as-code (`render.yaml`) in the repo on day one. The 15-minute spindown is a free-tier UX cost, not a Render limitation; the same code runs without changes on a paid Render plan, on Fly.io's free tier, or anywhere else that takes a `uvicorn` start command. I made the cost/UX tradeoff explicit and chose to absorb the cold start for v1 rather than introduce a workaround like a wake-up cron.

Two things this answer does well:

1. **Frames the constraint as time-to-ship, not technical limitation.** The cold start is acknowledged, not hand-waved. The architecture isn't locked in.
2. **Names the alternatives that were considered.** "I picked X" without "I considered Y, Z" reads as default thinking; naming the alternatives reads as actual thinking.

### 20.2 Alternatives, ranked by what they optimize for

| Host | Free tier behavior | Tradeoff vs Render |
|---|---|---|
| **Fly.io** | Machines suspend (not stop). ~250ms resume. | Better UX. More setup: Dockerfile, `fly.toml`, `flyctl` CLI. No git-push-to-deploy out of the box. |
| **Railway** | $5/mo trial credit, then sleeps. | Smoothest DX after Render. Still spins down on free, just later. |
| **Cloudflare Workers** | Always warm, generous free tier. | Doesn't fit — Workers don't run long-lived Python processes, and our SSE streaming agent loop assumes one. |
| **Hugging Face Spaces** | Free, doesn't sleep on the right tier. | Built for ML demos; FastAPI works. Less professional-looking URL for a portfolio piece. |
| **Self-host on a $4/mo VPS** | No spindown. | More ops work (TLS, systemd, updates). Real engineering, but slower to ship. |

### 20.3 The "would I redo it" answer

**Fly.io free tier** is the technically better pick: same Python container, ~250ms cold starts instead of 30–60s, no monthly cost. The only reason it wasn't first choice for v1 is setup time — Render's "click Blueprint" was 5 min vs Fly's 30 min (Dockerfile + `flyctl auth login` + `fly launch`). For a v1 demo, time-to-live mattered more than cold-start latency.

If the cold start ever becomes a real complaint (interviewer hits the URL and waits 45s; a user actually shows up), the migration is small:

1. Write a ~6-line Dockerfile (Python base image, copy code, `pip install`, `CMD uvicorn ...`).
2. `flyctl launch` — generates `fly.toml`, deploys, returns a `*.fly.dev` URL.
3. Update Vercel's `VITE_API_BASE` env var to the new URL → redeploy frontend.
4. Update Fly's CORS env to include the Vercel URL.

Probably one focused hour. The architecture (FastAPI + SSE + env-var-driven frontend) doesn't care which Linux box the container runs on.

### 20.4 The lesson behind the lesson

The transferable point: when you pick a tool with a known weakness, write down both **the weakness** and **what would change your mind**. "Render was right for v1, would migrate to Fly when cold-start becomes a complaint" is a stronger signal than "I'm using Render" — it says you've thought about the failure mode and have a planned response. That's the muscle interviewers look for, more than the specific host you picked.

---

*This file grows as the project does. Next sections (TBD): observability (structured logs on the backend, error tracking), and a "graph view" toggle for the timeline if there's time after deploy.*
