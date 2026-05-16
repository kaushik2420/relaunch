# Relaunch — Production App

> Your next chapter, found daily.

A job-search co-pilot for tech folks affected by layoffs. Every morning we send each user a curated digest of jobs that match them, a resume tailored for each role, one or two LinkedIn connections who could refer them, an InMail template, and the expected CTC — all logged into the user's own Google Sheet.

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 14 (App Router) + TypeScript | Single repo for FE + API + cron |
| Hosting | Vercel | Free tier covers 0–500 users; cron built in |
| Auth + DB | Supabase | Auth + tiny Postgres for prefs only |
| LLM | Anthropic Claude (Haiku for cheap calls, Sonnet for tailoring) | Tight at structured rewriting; no hallucinated facts |
| Jobs data | Adzuna + Jooble + Greenhouse/Lever public boards | Free / generous tiers |
| Payments | Razorpay (default) — Stripe pluggable | India-first; behind a provider interface |
| Email | Gmail API (sent from user) + Resend fallback | Best deliverability + cheapest |
| Sheets | Google Sheets API (`drive.file` scope only) | Users own their data; we don't store it |
| Analytics | PostHog (free tier) | Product analytics |
| Errors | Sentry (free tier) | Error tracking |

## Architecture principles

1. **User owns the data.** Almost nothing stored on our servers. Their Google Sheet is the system of record.
2. **Every external service is behind an interface.** Swappable in one config change. See `src/lib/providers/`.
3. **Async by default.** Daily cron does heavy work overnight. Cheap.
4. **First 500 only.** First 30 get 3 months free. The next 470 get 20 days free. After that, ₹399/mo (approx. 2× our infra cost). Wait-list opens at 500.

## Quick start (local dev)

```bash
# 1. Install deps
pnpm install

# 2. Copy env file
cp .env.example .env.local
# (fill in keys — see ENV.md for what's required)

# 3. Set up Supabase
npx supabase start                  # or use cloud project
npx supabase db push                # runs migrations in supabase/migrations/

# 4. Dev server
pnpm dev
```

Open http://localhost:3000.

## Accounts you need to create (one-time)

Walkthrough in `docs/SETUP.md`. Short list:

- **GitHub** → for the repo
- **Vercel** → connect the GitHub repo; auto-deploys on push
- **Supabase** → create project; get URL + anon key + service-role key
- **Google Cloud** → enable Sheets API + Gmail API; create OAuth client
- **Anthropic** → get API key
- **Adzuna** → developer account, app ID + key
- **Jooble** → developer key
- **Resend** → API key (fallback email)
- **Razorpay** → Key ID + Key Secret; webhook secret
- **Sentry**, **PostHog**, **Cloudflare** → optional but recommended
- **Domain** → e.g. relaunch.app, getrelaunch.in

## Repo layout

```
relaunch-app/
├── supabase/
│   └── migrations/              # SQL: schema, RLS, triggers
├── src/
│   ├── app/                     # Next.js App Router
│   │   ├── (auth)/              # login, signup, forgot, reset
│   │   ├── (app)/               # onboarding, dashboard, settings
│   │   └── api/                 # auth, oauth, cron, webhooks
│   ├── components/              # UI primitives + feature components
│   ├── lib/
│   │   ├── supabase/            # server/browser/admin clients
│   │   ├── providers/           # ▼ SWAPPABLE EXTERNAL SERVICES ▼
│   │   │   ├── llm/             #   Anthropic / OpenAI
│   │   │   ├── jobs/            #   Adzuna / Jooble / Greenhouse
│   │   │   ├── payments/        #   Razorpay / Stripe
│   │   │   ├── email/           #   Gmail / Resend
│   │   │   └── sheets/          #   Google Sheets
│   │   ├── services/            # business logic (composes providers)
│   │   ├── config.ts            # zod-validated env
│   │   └── crypto.ts            # token encryption helpers
└── docs/
    ├── SETUP.md                 # account setup walkthrough
    ├── ARCHITECTURE.md          # data flow + diagrams
    └── COSTS.md                 # cost model + scaling levers
```

## Pricing model (encoded in code)

| Signup position | Free trial | Then |
|-----------------|-----------|------|
| 1–30 | 90 days | ₹399/mo |
| 31–500 | 20 days | ₹399/mo |
| 501+ | Waitlist (no signup) | — |

See `src/lib/services/billing.ts`. The free-period thresholds are env vars (`FREE_TRIAL_FOUNDER_DAYS`, `FREE_TRIAL_DEFAULT_DAYS`, `FOUNDER_CAP`, `TOTAL_CAP`) so they can be changed without a code deploy.

## Empathy is a feature

This product is for people having a hard time. The UX rules are codified in `src/components/EmpathyBanner.tsx` and `src/lib/copy.ts`. Don't ship copy that violates them without a discussion.

## Where to go next

- New here? Read `docs/SETUP.md` and follow it to a local dev environment.
- Want to add a job source? Implement `JobProvider` in `src/lib/providers/jobs/` — that's the whole change.
- Want to swap the LLM? Implement `LLMProvider` in `src/lib/providers/llm/`.
- Want to add a payment processor? Implement `PaymentProvider` in `src/lib/providers/payments/`.
