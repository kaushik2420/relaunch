# Reddit OAuth setup for the distribution crawler

Reddit killed anonymous `.json` access in 2023. The crawler now needs a
bearer token from a script-type Reddit app. Five-minute setup.

## 1. Register the app

1. Sign in to Reddit as **`kaushikn2416`** (the account whose crawler
   this is — Reddit ties the app to a single user for script apps).
2. Go to <https://www.reddit.com/prefs/apps>.
3. Scroll to the bottom, click **"create another app…"**.
4. Fill in:
   - **name**: `Relaunch distribution`
   - **type**: `script` ← important
   - **description**: `Daily crawler that finds laid-off tech folks posting on Reddit`
   - **about url**: `https://get-relaunch.com`
   - **redirect uri**: `http://localhost:3000` ← unused for script apps but required
5. Click **create app**.

You'll now see a card at the top of your apps page with two values:

- **client_id** — the 14-character string directly under `personal use script`
- **client_secret** — the string next to `secret`

## 2. Add env vars to Vercel

Open <https://vercel.com/kaushik/relaunch/settings/environment-variables>
and add these four (Production + Preview + Development):

| Key                    | Value                                    |
| ---------------------- | ---------------------------------------- |
| `REDDIT_CLIENT_ID`     | the 14-char client_id from step 1        |
| `REDDIT_CLIENT_SECRET` | the secret from step 1                   |
| `REDDIT_USERNAME`      | `kaushikn2416`                           |
| `REDDIT_PASSWORD`      | your Reddit password                     |

> **Security note.** The password lives encrypted in Vercel; only the
> serverless function can read it. Rotating it means updating this env
> var. If Reddit's password grant ever gets deprecated (they've hinted
> at it), we'll switch to a refresh-token flow — same crawler, one
> extra one-time OAuth handshake to grab a permanent refresh token.

## 3. Redeploy + verify

1. Trigger a redeploy so the new env vars are picked up (Vercel does
   this automatically on the next push, or click Redeploy on the
   latest deployment).
2. Once live, sign into Relaunch as admin and hit
   <https://www.get-relaunch.com/api/admin/reddit-diagnostic>.
3. Look for:
   - `stage: "success"`
   - `status: 200`
   - `childrenCount: 3` (or similar)
   - `firstTitle`: an actual post title from r/layoffs

If any of those look off, the `hint` field in the response tells you
what to check next.

## 4. Try the crawler

Go to `/admin/leads` → click **↻ Crawl now**. You should see the
summary banner report `scanned: ~600, matched: N, inserted: N`.

## Constraints to be aware of

- **2FA on the reddit account breaks password grant.** If your
  `kaushikn2416` account has 2FA on, either turn it off, or switch to
  the refresh-token flow (ask Claude to migrate).
- **Rate limit is 600 requests / 10 minutes** on OAuth. Our crawler
  hits 6 subreddits daily — well under the limit.
- **Tokens last 24 hours.** The crawler caches per warm serverless
  instance and re-exchanges on cold start.
- **Do not commit these env vars.** They're already gitignored via
  `.env.local`; Vercel is the source of truth.
