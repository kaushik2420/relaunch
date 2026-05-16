# Setup & deployment

Step-by-step. Estimated time end-to-end: ~90 minutes the first time.

---

## 1. Create accounts (15 min)

Open these in tabs and sign up:

| # | Service | What you'll grab | Notes |
|---|---------|------------------|-------|
| 1 | [GitHub](https://github.com) | (account) | Push the repo here |
| 2 | [Vercel](https://vercel.com) | (account) | Connect to GitHub |
| 3 | [Supabase](https://supabase.com) | Project URL, anon key, service-role key | Create a project named `relaunch` |
| 4 | [Google Cloud Console](https://console.cloud.google.com) | Client ID, Client Secret | Enable Sheets API + Gmail API |
| 5 | [Anthropic Console](https://console.anthropic.com) | API key | Add ₹2000 credit to start |
| 6 | [Adzuna Developer](https://developer.adzuna.com) | App ID, App Key | Free tier |
| 7 | [Jooble Developer](https://jooble.org/api/about) | API key | Free, by email |
| 8 | [Resend](https://resend.com) | API key | Verify your sending domain |
| 9 | [Razorpay](https://razorpay.com) | Key ID, Key Secret, Webhook secret | Create a "monthly plan" → grab Plan ID |
| 10 | [Sentry](https://sentry.io) (optional) | DSN | |
| 11 | [PostHog](https://posthog.com) (optional) | Project key | |
| 12 | A domain registrar (Cloudflare/Namecheap) | A domain | e.g. relaunch.app, getrelaunch.in |

---

## 2. Configure Google OAuth (10 min)

In the [Google Cloud Console](https://console.cloud.google.com):

1. Create a new project: **Relaunch**.
2. **APIs & Services → Library** → enable:
   - Google Sheets API
   - Google Drive API
   - Gmail API
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**
   - App name: **Relaunch**
   - Support email + developer email: yours
   - Authorized domains: your domain (e.g. `relaunch.app`)
   - Scopes: add `.../auth/drive.file`, `.../auth/gmail.send`, `.../auth/userinfo.email`
   - Publish (start in Testing while developing — add yourself as a test user)
4. **APIs & Services → Credentials → Create OAuth client ID**:
   - Type: **Web application**
   - Authorized redirect URIs:
     - `http://localhost:3000/api/google/callback`
     - `https://YOUR-DOMAIN/api/google/callback`
   - Copy the Client ID and Secret.

---

## 3. Initialize the database (5 min)

```bash
# install supabase CLI: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push    # runs supabase/migrations/0001_initial.sql
```

Verify in the Supabase Studio that the `users`, `job_runs`, `billing_events`, and `waitlist` tables exist and that the `assign_cohort_on_insert` trigger is attached to `users`.

Optionally set Postgres config so trigger uses live env values (run in Supabase Studio SQL editor):

```sql
alter database postgres set "app.founder_cap" = '30';
alter database postgres set "app.total_cap" = '500';
alter database postgres set "app.founder_days" = '90';
alter database postgres set "app.default_days" = '20';
```

---

## 4. Local dev (5 min)

```bash
pnpm install
cp .env.example .env.local
# fill in keys
pnpm dev
```

Open http://localhost:3000.

**Generate the encryption key:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# paste into ENCRYPTION_KEY_BASE64
```

**Generate the cron secret:**
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
# paste into CRON_SECRET
```

---

## 5. Deploy to Vercel (10 min)

1. Push the repo to GitHub.
2. In Vercel: **Add New → Project → Import** the GitHub repo.
3. Add all env vars from `.env.local` to **Environment Variables**.
4. Deploy.
5. After deploy: copy the production URL into Google OAuth redirect URIs and into Razorpay webhook URL.

Vercel will auto-pick up `vercel.json` and schedule the crons:
- `/api/cron/daily` runs every hour
- `/api/cron/billing-reminders` runs daily at 03:00 UTC

Vercel's cron caller sends an `Authorization: Bearer <CRON_SECRET>` header — that's how the route auths.

---

## 6. Razorpay webhook (5 min)

In Razorpay Dashboard → **Settings → Webhooks**:
- URL: `https://YOUR-DOMAIN/api/razorpay/webhook`
- Active events: `subscription.activated`, `subscription.charged`, `subscription.cancelled`, `subscription.completed`, `subscription.expired`, `invoice.paid`
- Secret: paste a random string and put it in `RAZORPAY_WEBHOOK_SECRET`.

Create a **Plan**:
- Period: monthly
- Amount: ₹399 (or whatever you set in `MONTHLY_PRICE_INR`)
- Copy the Plan ID → `RAZORPAY_PLAN_ID`.

---

## 7. Smoke test (10 min)

1. Sign up at `https://YOUR-DOMAIN/signup` — confirm signup_position = 1, cohort = 'founder', free_until = +90d.
2. Upload a resume — confirm profile JSON populates in Supabase, original file is NOT stored anywhere.
3. Complete preferences → connect Google → confirm a sheet named "Relaunch — {Name}'s Job Tracker" appears in your Drive.
4. Trigger the cron manually:
   ```bash
   curl -X GET "https://YOUR-DOMAIN/api/cron/daily" \
     -H "x-cron-secret: $CRON_SECRET"
   ```
   Confirm: rows appear in your Sheet's "Daily Matches" tab, a digest email lands in your inbox.
5. Trial-end test: in Supabase Studio, manually set `free_until = now() - interval '1 day'` for your test user and confirm the (app) layout shows the upgrade banner.

---

## 8. Costs at 500 users (so you can plan)

| Service | Estimated monthly cost |
|--------|----------------------:|
| Vercel Hobby | ₹0 |
| Supabase free | ₹0 |
| Anthropic (Haiku + Sonnet, ~5 tailorings/user/day) | ₹3,000–4,000 |
| OpenAI embeddings | ₹100 |
| Adzuna / Jooble | ₹0 |
| Resend | ₹0 (under 3k/mo) |
| Domain | ₹100 |
| Razorpay fees | ~2% of revenue |
| **Total infra** | **~₹3,500** |

Revenue at 500 paying users × ₹399 = ₹199,500/mo.
Gross margin: ~98%.

Plenty of headroom to keep the hardship program meaningful.

---

## 9. Where to go next

- Wire up the dashboard to show the user's last 7 days of matches by reading their Google Sheet (no extra DB table needed).
- Build the referrer-finder service (`src/lib/services/referrer-finder.ts`) once you've added Proxycurl.
- Build the upskill engine: weekly job that scans near-miss JDs for skill keywords your users don't have.
- Add PostHog client SDK to track onboarding funnel completion.
- Set up Sentry per [Next.js guide](https://docs.sentry.io/platforms/javascript/guides/nextjs).
