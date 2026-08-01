# OpenAI Web Search — setup + operations

Live public-web job discovery via OpenAI's Responses API with the hosted
`web_search` tool. Fires only on user-triggered "Find matches now"
clicks (`/api/run-now`) — not the nightly cron.

## 1. Env vars (Vercel)

Add these at <https://vercel.com/kaushik/relaunch/settings/environment-variables>
(Production + Preview + Development):

| Key                             | Required | Default            | Purpose |
| ------------------------------- | -------- | ------------------ | ------- |
| `OPENAI_API_KEY`                | yes      | —                  | From <https://platform.openai.com/api-keys>. Server-only. |
| `OPENAI_MODEL_JOB_SEARCH`       | no       | `gpt-5.6-terra`    | Swap if you want a different intelligence/cost balance. |
| `OPENAI_WEB_SEARCH_ENABLED`     | no       | `true`             | Kill switch — set to `false` to disable instantly without a code push. |
| `OPENAI_WEB_SEARCH_DAILY_CAP`   | no       | `3`                | Max non-cached calls per user per day. |

## 2. Apply migration 0019

Open <https://supabase.com/dashboard/project/_/sql/new> and run the SQL
from `supabase/migrations/0019_openai_websearch_calls.sql` (or copy the
SQL directly — not the filename).

The migration creates:

- `openai_websearch_calls` — one row per call, powers the daily cap +
  6h cache + admin cost telemetry.
- Adds `openai_metadata` jsonb column to `job_matches` — holds the
  AI-discovery enrichment (match reasons, gaps, evidence URLs).

## 3. Cost model

Per call (rough): **$0.03-0.05**
- Web search tool: $10 per 1,000 calls = $0.010 flat
- Model tokens on `gpt-5.6-terra`: ~$0.02-0.04 depending on how much
  content OpenAI reads during search
- Cached hits (repeat within 6h on same criteria) = **$0**

Per-user max spend per day at default cap: ~$0.15

At 44 users all hitting the cap every day: worst-case ~$200/month.
Real-world expectation: **$10-30/month** based on typical clickthrough.

Watch actual spend in `/admin` → Cost panel → "OpenAI web search
(actual)" — pulls from `openai_websearch_calls.cost_estimate_usd`
summed over the last 30 days.

## 4. How it fires in the app

1. User clicks "Find matches now" on `/dashboard` → hits `/api/run-now`.
2. `/api/run-now` kicks off two parallel promises:
   - Existing aggregator pipeline (Adzuna, Coresignal, etc. + rank +
     Haiku verify + Sonnet tailor + email).
   - `runOpenAIWebSearch()` — checks cache, checks daily cap, calls
     OpenAI, persists results to `job_matches` with `ats='openai_web'`
     and the enrichment in `openai_metadata`.
3. Both complete. Response returns aggregator counts + an `openai`
   block with `jobsFound`, `cached`, `skipped`, `sourcesConsulted`.
4. Job rows land in `job_matches` alongside aggregator rows.
5. `/all-matches` page renders both, tagging OpenAI ones with an
   "✨ AI-discovered" chip and an expandable "Why this matches" panel
   with the reasoning + evidence links.

## 5. Skip pathways (all logged to the audit table)

| Response `openai.skipped` | Meaning |
| ------------------------- | ------- |
| `null` (no skip)          | Fresh call succeeded |
| `disabled`                | `OPENAI_WEB_SEARCH_ENABLED=false` — kill switch active |
| `no-key`                  | `OPENAI_API_KEY` missing |
| `over-cap`                | User hit the daily cap |
| `cached`                  | Response reused from the last 6h — $0 |

## 6. Sentinel integration

The hourly sentinel (`/api/cron/sentinel`) reads
`openai_websearch_calls` for the last 24h and computes:

- `totalCalls`, `cached`, `errored`, `totalCostUsd`, `topError`

Passed to Haiku triage. Alerts fire if:

- errored/totalCalls > 30% → likely API outage or key rotation
- totalCostUsd unusually high → potential abuse

You'll get an email at `kaushikn2416@gmail.com` on the first detection.
See `/admin` → Sentinel panel for the current active alerts.

## 7. What the UI looks like

On `/all-matches`, an OpenAI-discovered job renders as:

```
┌──────────────────────────────────────────────────────┐
│ Director, Solutions Engineering              93%     │
│ Example AI · Bangalore, India              match     │
│                                                       │
│ [✨ AI-discovered · Exceptional Match] [Mark applied]│
│ [Salary check]                     View role →       │
│                                                       │
│ ▼ Why this matches you                               │
│   • Strong enterprise SaaS SE leadership            │
│   • Customer-facing technical leadership            │
│   • API / integration background                    │
│                                                       │
│   Potential gaps                                     │
│   • Direct GenAI platform experience preferred      │
│                                                       │
│   Sources                                            │
│   • jobs.example.com ↗                              │
│   • linkedin.com ↗                                  │
└──────────────────────────────────────────────────────┘
```

Non-OpenAI (aggregator) jobs are unchanged.

## 8. Security notes

- API key lives in Vercel env only, never client-side.
- System prompt explicitly treats retrieved web pages as UNTRUSTED —
  Claude is told never to follow instructions embedded in job pages.
- Structured Outputs `strict: true` guarantees the response conforms to
  the schema; free-form prompt-injection outputs are rejected at the
  parser layer.
- Evidence URLs are rendered as clickable `<a target="_blank">` — user
  can see the source before deciding to click.

## 9. Rolling back

If OpenAI costs are running away or quality is poor:

- **Immediate** (no deploy): flip `OPENAI_WEB_SEARCH_ENABLED=false` in
  Vercel. Next request returns `skipped:"disabled"`. Zero spend.
- **Tighten**: lower `OPENAI_WEB_SEARCH_DAILY_CAP` to 1 to reduce
  per-user max spend to $0.05/day.
- **Uninstall**: remove `openai_web` from `src/lib/providers/jobs/index.ts`
  REGISTRY and delete the `runOpenAIWebSearch` block from
  `src/app/api/run-now/route.ts`. The `openai_websearch_calls` table
  can stay for cost audit; `openai_metadata` column on `job_matches`
  is null-safe.

## 10. Future extensions (V2 from the handoff doc)

- Include OpenAI in the nightly digest for paying users only
  (cost-recovered)
- Split discovery from scoring (two OpenAI calls) for better cost
  observability
- Use `user_location` in the tool config once we know the searcher's
  own IP/city (for local-results improvement)
