# Coresignal Multi-source Jobs API — trial setup

Coresignal is a professional data platform with strong India job
coverage (multi-source dedup across LinkedIn, Indeed, Glassdoor,
enriched with company + salary + tech metadata). This walks you
through activating a trial key, validating it works for your query
shape, and deciding whether to enable it in daily runs.

## 1. Grab your trial API key

Sign in to <https://dashboard.coresignal.com/sign-in> with the
business email you registered with. In `Settings → API Keys`,
copy the key that starts with (usually) a long alphanumeric
prefix.

## 2. Add it to Vercel

<https://vercel.com/kaushik/relaunch/settings/environment-variables>

| Key                    | Value                          |
| ---------------------- | ------------------------------ |
| `CORESIGNAL_API_KEY`   | your trial API key             |

Save for Production + Preview + Development. Trigger a redeploy
(next `git push` does it automatically).

## 3. Verify with the diagnostic endpoint

Once deployed, sign into Relaunch as admin and open:

```
https://relaunch.app/api/admin/coresignal-diagnostic?q=product+manager&loc=Bangalore
```

You should get back JSON like:

```json
{
  "ok": true,
  "stage": "success",
  "query": { "q": "product manager", "loc": "Bangalore", "postedWithinDays": 14, "limit": 20 },
  "ms": 850,
  "resultCount": 12,
  "approxCreditsUsed": "~13",
  "preview": [
    { "title": "Senior Product Manager", "company": "Razorpay", "location": "Bengaluru", ... },
    ...
  ]
}
```

The `preview` array contains 3 real jobs mapped through our provider
shape. If those look accurate and India-focused, the integration is
working. Try a few variations:

- `?q=data+engineer&loc=Bangalore`
- `?q=product+designer&loc=Mumbai`
- `?q=engineering+manager&loc=Bengaluru`

Each call costs ~1 search credit + up to 20 collect credits.

## 4. Enable it in daily runs (only after you're happy with the trial)

Coresignal is registered but **not enabled by default**. To activate
it, append `coresignal` to your `JOB_PROVIDERS` env var:

**Current:**
```
JOB_PROVIDERS=adzuna,jooble,greenhouse,lever,workable,smartrecruiters,recruitee,themuse,remotive,jsearch
```

**Add coresignal:**
```
JOB_PROVIDERS=adzuna,jooble,greenhouse,lever,workable,smartrecruiters,recruitee,themuse,remotive,jsearch,coresignal
```

Redeploy. The next daily run will fan out to Coresignal alongside
your existing providers.

## Credit budgeting

Per user per day: ~21 credits (1 search + 20 collects, capped by the
provider). At 100 active users, that's ~2,100 credits/day, ~63k/month.

Check the credit balance in your Coresignal dashboard after 24–48h
of live traffic to project monthly spend. If the trial burns down
faster than expected, options:

- **Lower `COLLECT_CAP`** in `src/lib/providers/jobs/coresignal.ts`
  (currently 20 — dropping to 10 halves collect cost)
- **Filter more aggressively in the ES DSL query** (raise
  `postedWithinDays` cutoff or narrow the country/city filter) so
  fewer results come back before we collect
- **Run Coresignal on alternate days only** — the daily-runner can
  be adapted to run expensive providers every 2 days on the same
  user

## What the diagnostic tells you

- `ok: false, stage: "not-configured"` → env var missing or empty
- `ok: true, stage: "empty"` → API returned 200 but no matches. Try
  a broader query (`?q=engineer`) to check whether it's your filter
  or actual coverage
- `ok: true, stage: "success"` → all systems go. Look at the
  `preview` array to gut-check data quality before enabling in daily
  runs

## Turning it off

Remove `coresignal` from `JOB_PROVIDERS` (or delete the
`CORESIGNAL_API_KEY` env var). The provider silently no-ops when
either is missing — no code change needed.
