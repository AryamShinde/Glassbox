# Glassbox

A transparent AI agent that shows its reasoning. Instead of a chat box that returns a single answer, Glassbox streams every step the agent takes — its thoughts, the tools it calls, the results it gets back, and the final answer — onto a live timeline you can watch in real time.

**Live demo:** https://glassbox-alpha.vercel.app

![architecture](https://img.shields.io/badge/stack-FastAPI%20%2B%20React%20%2B%20Groq-blue)

---

## What it does

Give it a goal in plain English. The agent:

1. Decides whether it needs information or a calculation.
2. Calls one of three tools (Wikipedia, calculator, URL fetcher).
3. Reads the result, decides what to do next.
4. Repeats until it can answer — or hits the 8-step ceiling.

Every step is streamed to the UI as it happens via Server-Sent Events. You see the model's chain-of-thought in italics, tool calls as expandable cards with the JSON arguments, tool results color-coded by tool, and the final answer highlighted at the end.

### Example goals to try

- *What is 23 × 23?* → calculator
- *What's the capital of Australia and its population?* → Wikipedia
- *Summarize the top story on https://news.ycombinator.com* → URL fetcher
- *What's the population of Tokyo divided by the population of Paris?* → Wikipedia × 2 + calculator

---

## Architecture

```
┌──────────────────┐         SSE          ┌─────────────────────┐
│  React + Vite    │  ◄───────────────────│  FastAPI + uvicorn  │
│  (Vercel)        │      /run            │  (Render)           │
└──────────────────┘                      └─────────────────────┘
                                                    │
                                                    ▼
                                          ┌─────────────────────┐
                                          │  Groq (gpt-oss-20b) │
                                          │  + 3 tools          │
                                          └─────────────────────┘
```

**Backend** — Python 3.11, FastAPI, `sse-starlette` for streaming, Groq's OpenAI-compatible function-calling API. The agent loop is in `backend/app/agent/loop.py`; it yields typed `AgentEvent` objects (Thought, ToolCall, ToolResult, FinalAnswer, Error) which the route serializes as SSE frames.

**Frontend** — React 18 + Vite + Tailwind. Uses `fetch` + `ReadableStream` (not `EventSource`) because we need POST and a custom header for the BYO-key path. The streaming parser is in `frontend/src/api.ts`.

**Tools**

| Tool | What it does |
|---|---|
| `wikipedia` | Fetches a summary from the Wikipedia REST API. |
| `calculator` | Evaluates math expressions through a safe AST walker (no `eval`). |
| `url_fetcher` | Fetches a URL and extracts visible text via BeautifulSoup. |

All conform to a single `Tool` protocol in `backend/app/tools/base.py`; adding a new tool is a one-file change.

**Rate limiting** — In-memory per-IP, 5 runs/hour, enforced by FastAPI middleware. When a user is rate-limited the API returns a 429 with a hint to bring their own Groq key; the frontend surfaces this and persists the user-supplied key in `localStorage` for subsequent requests.

---

## Local development

### Prerequisites

- Python 3.11
- Node 18+
- A free Groq API key from https://console.groq.com

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                 # then edit .env to add your GROQ_API_KEY
uvicorn app.main:app --reload --port 8000
```

Smoke test:

```bash
curl http://localhost:8000/health    # {"status":"ok"}
python smoke_loop.py                 # runs the agent end-to-end on a fixture goal
```

### Frontend

```bash
cd frontend
npm install
npm run dev                          # http://localhost:5173
```

The Vite dev server proxies `/run` and `/health` to `http://localhost:8000`, so no env vars are needed for local dev.

---

## Deployment

The repo is set up for a **Render + Vercel** split deploy:

- `render.yaml` (repo root) — declares the backend as a Render Blueprint. After connecting the repo on Render, set `GROQ_API_KEY` and `ALLOWED_ORIGINS` in the dashboard.
- `frontend/vercel.json` — Vercel config for the SPA. Set `VITE_API_BASE` to the Render URL in Vercel project settings.

### Why this split?

Render runs long-lived Python processes well — important because our SSE stream needs a real process, not a serverless function with a timeout. Vercel is the no-fuss path for the static React build with per-branch previews. The two halves are wired together by a CORS allow-list and a base-URL env var; either side can be moved to a different host without touching the other.

### Cold-start note

Render's free tier spins down after 15 min of inactivity, so the first request after a quiet period takes ~30–60s. For a portfolio demo this is fine; if it ever becomes a real problem the migration to Fly.io (which suspends rather than stops machines, ~250ms resume) is small — same Python container, no app code changes.

---

## Project layout

```
.
├── render.yaml                  # Render Blueprint
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app + middleware wiring
│   │   ├── config.py            # env-var loading
│   │   ├── rate_limit.py        # in-memory per-IP rate limiter
│   │   ├── routes/agent.py      # /run SSE endpoint
│   │   ├── agent/
│   │   │   ├── loop.py          # the agent loop
│   │   │   ├── events.py        # typed event schema
│   │   │   └── system_prompt.py
│   │   └── tools/
│   │       ├── base.py          # Tool protocol
│   │       ├── calculator.py
│   │       ├── wikipedia.py
│   │       └── url_fetcher.py
│   ├── requirements.txt
│   └── smoke_*.py               # standalone smoke tests
└── frontend/
    ├── src/
    │   ├── App.tsx
    │   ├── api.ts               # SSE-over-fetch client
    │   ├── types.ts             # event schema mirror
    │   └── components/
    │       ├── GoalForm.tsx
    │       ├── Timeline.tsx
    │       ├── RateLimitBanner.tsx
    │       └── events/          # one card per event type
    ├── package.json
    └── vercel.json
```

---

## License

MIT.
