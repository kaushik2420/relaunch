# Architecture (in code)

## Provider pattern

Every external service we talk to is behind a TypeScript interface, with one
implementation per provider. To swap a provider:

1. Implement the interface in a new file.
2. Register it in `src/lib/providers/<thing>/index.ts`.
3. Flip the env var.

That's it. No grep-and-replace through the codebase.

| What | Interface | Default impl | Other impls |
|------|-----------|--------------|-------------|
| LLM (parse, tailor, draft) | `LLMProvider` | `AnthropicProvider` | OpenAI stub |
| Embeddings | (inside `LLMProvider.embed`) | OpenAI text-embedding-3-small | Voyage, Cohere |
| Jobs | `JobProvider` | Adzuna, Jooble, Greenhouse | Lever, JSearch, custom |
| Payments | `PaymentProvider` | `RazorpayProvider` | Stripe stub |
| Email | `EmailProvider` | `ResendProvider` | Gmail (per-user, separate flow) |
| Sheets | `SheetsProvider` | `GoogleSheetsProvider` | Airtable, Notion |

## Data ownership

The user's Google Sheet is the system of record for:
- Daily matches (one row per job)
- Tailored resumes (links to files in their Drive)
- Application status (manual, by them)
- Notes & outcomes

We store in Supabase only:
- Auth identity
- Their profile JSON (so we can re-rank without re-parsing)
- Preferences
- Encrypted Google refresh token + sheet ID
- Audit logs (`job_runs`, `billing_events`)

We **never** store:
- The resume file itself
- Generated resumes (only links)
- Job listings (they live in user's Sheet)
- Email content (only the fact that we sent one)

## Daily run flow

```
                    Vercel hourly cron
                          │
              ┌───────────▼────────────┐
              │  pickUsersForThisHour  │  (matches local email_time)
              └───────────┬────────────┘
                          │
              ┌───────────▼────────────┐
              │   runDailyForUser()    │  per-user, parallel
              └───────────┬────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   fetchJobsFromAll  rankJobs()      tailorResume×N
   (Adzuna+Jooble    (embeddings    (Anthropic Sonnet)
    +Greenhouse)      + filters)
        │                 │                 │
        └─────────────────┼─────────────────┘
                          ▼
                  appendMatches()
                  (Google Sheets API → user's Drive)
                          │
                          ▼
                   email().send()
                  (Resend digest)
                          │
                          ▼
                   log job_run
```

## Cohort gating

`src/lib/services/billing.ts::evaluateCohortCapacity()` is the SINGLE place
that decides whether a new signup is allowed.

- Signup attempt: check `cohort_counts` view.
  - If `total_count < FOUNDER_CAP` → founder (90-day trial).
  - Else if `< TOTAL_CAP` → early (20-day trial).
  - Else → reject, surface waitlist form.
- The trigger `assign_cohort_on_insert` writes the final `signup_position`,
  `cohort`, and `free_until` *atomically* — so even under concurrent signups
  we never give out a 31st founder slot.
- `FOUNDER_CAP`, `TOTAL_CAP`, `FREE_TRIAL_FOUNDER_DAYS`, `FREE_TRIAL_DEFAULT_DAYS`
  and `MONTHLY_PRICE_INR` are env vars — change without a code deploy.

## Trial lifecycle

```
signup ── 1..30 ──► founder trial (90 days)  ──► paywall  ──► billing
       └─ 31..500 ► early trial    (20 days)  ──► paywall  ──► billing
       └─ 501..  ► waitlist
```

- `(app)/layout.tsx` checks `evaluateTrial()` on every request and shows the
  appropriate banner. Trial-expired users still see the dashboard; the cron
  skips them.
- `/api/cron/billing-reminders` emails at T-3, T-1, T-0 with empathy copy.

## Empathy as code

- `src/components/EmpathyBanner.tsx` is the standardized empathy banner.
- `src/lib/copy.ts` (TODO) will own all stat-framing copy so we can grep one
  file to audit tone.
- Trial-end emails route through `bodyFor()` in
  `/api/cron/billing-reminders/route.ts` — note the explicit hardship-program
  line. This is non-negotiable; keep it.

## Where the seams are (for future you)

If you find yourself wanting to:

- **Add a job source** → drop a `*Provider` file in `src/lib/providers/jobs/`, register it.
- **Switch to GPT-4o for tailoring** → implement `OpenAIProvider` in `src/lib/providers/llm/openai.ts`, set `LLM_PROVIDER=openai`.
- **Open up internationally with Stripe** → implement `StripeProvider`, route by user country in `src/lib/providers/payments/index.ts` (small change).
- **Build a mobile app** → React Native client hitting the same `/api` routes; auth via Supabase JS SDK.
- **Scale past Vercel cron limits** → move `pickUsersForThisHour` + `runDailyForUser` into Inngest or Trigger.dev. Function bodies don't change.
