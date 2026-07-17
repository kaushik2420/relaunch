# PostHog setup for Relaunch — from scratch

The Relaunch codebase already has PostHog *wired up* — every
`posthog.capture(...)` call across the app, plus autocapture on
pageviews and clicks. But without an API key in your Vercel env
vars, every one of those calls is a silent no-op. This guide takes
you from zero to a working dashboard in ~15 minutes.

## 1. Create the PostHog account + project

1. Go to <https://us.posthog.com/signup> (or <https://eu.posthog.com/signup>
   if you prefer EU-hosted data — India users get slightly better
   latency from EU, and both regions are GDPR-friendly).
2. Sign up with `kaushikn2416@gmail.com`. PostHog's free tier includes
   1 million events + 5,000 session recordings per month, which is
   plenty for Relaunch's early-access scale.
3. When prompted to "create your first project," name it **`Relaunch`**.

## 2. Grab the two values you'll need

After project creation, PostHog lands you on the "Get Started" page.
Look for or navigate to **Settings → Project → General**.

You need two things:

- **Project API Key** — starts with `phc_...`. This is the
  `NEXT_PUBLIC_POSTHOG_KEY`. Safe to expose in client-side JS (it's
  write-only for events).
- **Instance URL** — depending on the region you chose:
  - US: `https://us.i.posthog.com`
  - EU: `https://eu.i.posthog.com`

## 3. Set the two env vars in Vercel

Go to <https://vercel.com/kaushik/relaunch/settings/environment-variables>
and add:

| Key                          | Value                                              | Environments             |
| ---------------------------- | -------------------------------------------------- | ------------------------ |
| `NEXT_PUBLIC_POSTHOG_KEY`    | your `phc_...` project API key                     | Production, Preview, Dev |
| `NEXT_PUBLIC_POSTHOG_HOST`   | `https://us.i.posthog.com` (or EU URL from step 2) | Production, Preview, Dev |

Save each one, then trigger a redeploy (Vercel does this automatically
on the next push, or click Redeploy on the latest deployment).

## 4. Verify events are flowing

After the deploy lands (~60 seconds):

1. Open `www.get-relaunch.com` in an incognito window
2. Click around a few pages — landing → login → back to landing
3. Go to PostHog → **Activity** in the left nav
4. You should see `$pageview` events appearing in real time, one per
   page you visited

If nothing shows up after ~2 minutes:

- Check the browser DevTools → Network → filter by `posthog` — you
  should see requests to your PostHog host. If they're 401 or 403,
  the token is wrong. If they don't appear at all, the init isn't
  running.
- Check DevTools → Console. In production the init is silent, but in
  local dev it logs `[posthog] init` on load.
- Verify the env var in Vercel by re-checking the value at
  `Settings → Environment Variables` — Vercel occasionally trims
  leading/trailing whitespace weirdly on paste.

## 5. Turn on session recordings

Recordings are the highest-leverage thing PostHog offers for a
launching product. Turn them on now:

1. In PostHog → **Session Replay** → **Settings** (top right)
2. Toggle **Record user sessions** on
3. Set sample rate to **100%** for launch week (drop to 10-25% after
   the first week when volume grows — recordings cost storage)
4. Leave **Mask all inputs** on by default (protects sensitive fields
   like résumé content, passwords)

## 6. Point ad campaigns at UTM-tagged URLs

Every link that lives outside www.get-relaunch.com should have UTMs. Without
them, all your Reddit / PH / LinkedIn traffic looks like generic
"reddit.com" or "producthunt.com" referrals — impossible to attribute
per ad or per post.

Convention:

```
https://get-relaunch.com/?utm_source=<X>&utm_medium=<Y>&utm_campaign=<Z>&utm_content=<W>
```

See `Relaunch-PostHog-playbook.md` in the working folder for the
exact UTM values to use for PH, Reddit ads (per creative), LinkedIn,
YouTube, and Comeback Circle.

## 7. Build the first dashboard

Once you see events flowing:

1. **Dashboards → New dashboard → "Launch traffic"**
2. Add insight: **Unique visitors — last 7 days** (`$pageview`, math:
   Unique users)
3. Add insight: **Referrers** (`$pageview`, break down by
   `$referring_domain`)
4. Add insight: **UTM sources** (`$pageview`, break down by
   `utm_source`)
5. Add insight: **Landing → Waitlist funnel** (`$pageview` on `/` →
   `waitlist_joined`)

The playbook has 3 more dashboards worth building — attribution,
activation funnel, feature adoption.

## Optional — proxy through /ingest for ad-blocker resilience

About 15% of Reddit users run ad blockers that block `posthog.com`
domains. To capture their events too, add a Next.js rewrite that
proxies your own domain to PostHog:

1. In `next.config.mjs`, add inside `nextConfig`:

   ```js
   async rewrites() {
     return [
       {
         source: '/ingest/:path*',
         destination: `${process.env.NEXT_PUBLIC_POSTHOG_HOST}/:path*`,
       },
     ];
   }
   ```

2. In `src/app/posthog-init.tsx`, change:

   ```ts
   api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
   ```

   to:

   ```ts
   api_host: '/ingest',
   ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
   ```

3. Redeploy.

Skip this until after your first analytics dashboard is working —
one moving part at a time.

## What was actually wrong before

The client init file `src/app/posthog-init.tsx` was reading a
non-existent env var (`NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`) while the
rest of the codebase used `NEXT_PUBLIC_POSTHOG_KEY`. Even if you'd
set the key correctly, client-side tracking was silently broken —
`posthog.init()` was being called with `undefined`. That's now fixed
to use `NEXT_PUBLIC_POSTHOG_KEY` throughout, and it also gracefully
skips init if the token is missing (no more "undefined is not a
function" errors in local dev).
