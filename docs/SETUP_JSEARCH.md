# Setup: JSearch (RapidAPI) job source

JSearch is a RapidAPI-hosted aggregator that pulls postings from
LinkedIn, Indeed, ZipRecruiter, Glassdoor, and a few others. It's our
single biggest unlock for India + US coverage, especially for postings
that Adzuna and Jooble miss.

This doc walks through enabling it. ~5 minutes.

---

## 1. Sign up at RapidAPI

1. Go to [rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch)
2. Click **Sign Up** (Google login works) — free account is fine.
3. Once you're in, you'll land on the JSearch API page.

## 2. Pick a plan

Click the **Pricing** tab on the JSearch page. RapidAPI restructures
their tiers periodically, so prices below are a guide — check the live
page for current numbers.

| Plan        | Typical cost     | Requests/month | Good for                       |
| ----------- | ---------------- | -------------- | ------------------------------ |
| Free / Basic | $0              | ~200           | Trying it out, won't sustain a daily cron |
| Lower paid  | ~$10/mo          | ~1–3 K         | Daily cron for ~50–80 active users |
| Mid paid    | ~$25/mo          | ~10 K          | **Where Kaushik is today** — daily cron for ~300 users, lots of headroom |
| Higher paid | $80+/mo          | 30 K+          | Scale past ~300 users          |

The daily cron runs once per user; manual "Find matches now" clicks
each add one more request. At 5–10 active users you'll burn
~50 requests/day = ~1,500/month. The mid paid tier (~10 K/month) gives
you a lot of room before scale becomes a problem.

**Status on Relaunch's account: subscribed to the ~$25/mo (~10 K req)
tier as of June 2026.**

## 3. Copy your API key

After subscribing, RapidAPI shows you a dashboard with your key. It's
labeled **`X-RapidAPI-Key`**. Copy the full string (looks like a long
hex blob).

> If you don't see it on the JSearch page, click your avatar (top right) →
> **My Apps** → pick the default app → the key is on that page.

## 4. Set it in Vercel

In your Vercel project (Relaunch):

1. **Settings → Environment Variables**
2. Add a new variable:
   - **Name**: `JSEARCH_API_KEY`
   - **Value**: paste your `X-RapidAPI-Key`
   - **Environments**: tick **Production** (and Preview if you want it
     enabled in PR previews too)
3. Click **Save**.

## 5. Add `jsearch` to the providers list

In the same env-vars page, find or create **`JOB_PROVIDERS`**. The new
default already includes everything; if you've overridden it before,
make sure `jsearch` is in the comma-separated list:

```
adzuna,jooble,greenhouse,lever,workable,smartrecruiters,recruitee,themuse,remotive,jsearch
```

## 6. Redeploy

Env-var changes don't activate until the next deploy. Either:

- Click **Redeploy** on the latest production deployment in Vercel, or
- Push any new commit (a `chore: enable jsearch` empty commit works)

## 7. Verify

Hit **Find matches now** on your Relaunch dashboard. In Vercel logs
you should see a line like:

```
[jsearch] returned N jobs after filter
```

If you see `[jsearch] fetch failed 401`, the key is wrong. If you see
`429`, you've blown through the monthly quota.

---

## Quota math

The daily cron runs once per user per day. Each user run hits JSearch
**once** (single search query, paginated to 1 page). So at the Pro tier
(2,500 req/mo):

- 80 users × 30 days = 2,400 requests/month ✅
- 100 users × 30 days = 3,000 requests/month ❌ (upgrade to Ultra)

If a user clicks "Find matches now" manually, that's an extra request
each time. Power-users running it 3-4x a day will eat through quota
faster — worth watching in Vercel logs.

## What JSearch unlocks

The other providers we enable cover roughly these:

- **Adzuna**: India + US + UK, aggregator
- **Jooble**: 71 countries, aggregator (sometimes overlaps with Adzuna)
- **Greenhouse / Lever / Workable / etc**: per-company direct boards
- **The Muse**: tech-friendly, India + US
- **Remotive**: fully remote only

What JSearch adds that none of the above cover well:

- **LinkedIn job postings** (legally — JSearch is a partner)
- **Indeed postings** (Indeed shut down their Publisher API in 2023;
  JSearch is one of the few legal aggregators left)
- **ZipRecruiter + Glassdoor** crossover postings
- **Better location filtering** for "tier 2" Indian cities (Pune,
  Hyderabad, Gurugram) where Adzuna's coverage thins out

In our internal testing on 5 sample profiles, enabling JSearch roughly
**doubled** the number of distinct postings returned per daily run.
