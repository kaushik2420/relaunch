<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Relaunch app. Here is a summary of all changes made:

**New files created:**
- `src/lib/posthog-server.ts` — Singleton factory for the posthog-node client, used in all server actions and API routes
- `src/app/posthog-init.tsx` — Client component that initializes posthog-js on page load (Next.js 14 pattern)
- `src/components/PostHogIdentifier.tsx` — Client component that calls `posthog.identify()` whenever an authenticated user loads an app route

**Modified files:**
- `src/app/layout.tsx` — Added `<PostHogInit />` so posthog-js is initialized on every page
- `src/app/(app)/layout.tsx` — Added `<PostHogIdentifier>` to identify the authenticated user on every protected page load
- `next.config.mjs` — Added reverse-proxy rewrites (`/ingest/*` → PostHog) and `skipTrailingSlashRedirect: true`
- `src/app/(auth)/signup/WaitlistForm.tsx` — Captures `waitlist_joined` after the waitlist form is submitted
- `src/app/(auth)/actions.ts` — Captures `signed_in`, `signed_up` (with server-side `identify`), and `signed_out` via posthog-node
- `src/app/(app)/onboarding/upload/ResumeUploader.tsx` — Captures `resume_uploaded` (success) and `resume_upload_failed` + `captureException` (error)
- `src/app/(app)/onboarding/actions.ts` — Captures `profile_saved` and `preferences_saved` via posthog-node
- `src/app/(app)/billing/checkout/CheckoutLauncher.tsx` — Captures `checkout_opened` when the user clicks the Razorpay checkout button
- `src/app/api/razorpay/webhook/route.ts` — Captures `subscription_activated`, `subscription_charged`, and `subscription_cancelled` via posthog-node
- `src/app/api/google/callback/route.ts` — Captures `google_connected` via posthog-node

| Event | Description | File |
|---|---|---|
| `waitlist_joined` | User submitted the waitlist form | `src/app/(auth)/signup/WaitlistForm.tsx` |
| `signed_up` | New user successfully created an account | `src/app/(auth)/actions.ts` |
| `signed_in` | Existing user successfully signed in | `src/app/(auth)/actions.ts` |
| `signed_out` | User signed out of the application | `src/app/(auth)/actions.ts` |
| `resume_uploaded` | User successfully uploaded and parsed their resume | `src/app/(app)/onboarding/upload/ResumeUploader.tsx` |
| `resume_upload_failed` | Resume upload or parsing failed with an error | `src/app/(app)/onboarding/upload/ResumeUploader.tsx` |
| `profile_saved` | User saved their profile during onboarding | `src/app/(app)/onboarding/actions.ts` |
| `preferences_saved` | User saved their job preferences during onboarding | `src/app/(app)/onboarding/actions.ts` |
| `checkout_opened` | User clicked the Razorpay checkout button | `src/app/(app)/billing/checkout/CheckoutLauncher.tsx` |
| `subscription_activated` | Subscription activation confirmed via webhook | `src/app/api/razorpay/webhook/route.ts` |
| `subscription_charged` | Successful recurring charge confirmed via webhook | `src/app/api/razorpay/webhook/route.ts` |
| `subscription_cancelled` | Subscription cancelled or expired via webhook | `src/app/api/razorpay/webhook/route.ts` |
| `google_connected` | User connected Google account and sheet was created | `src/app/api/google/callback/route.ts` |

## Next steps

We recommend building an "Analytics basics" dashboard in PostHog with the following insights based on the events instrumented above:

- **Signup funnel** — Funnel: `waitlist_joined` → `signed_up` → `resume_uploaded` → `profile_saved` → `preferences_saved` → `google_connected`
- **Onboarding completion rate** — Trend: unique users who fired `google_connected` divided by `signed_up` over time
- **Checkout conversion** — Funnel: `checkout_opened` → `subscription_activated`
- **Churn events** — Trend: `subscription_cancelled` over time, broken down by `reason` property
- **Revenue events** — Trend: `subscription_charged` over time

Visit your PostHog project to build these:

- Insights: https://us.posthog.com/project/426635/insights
- Dashboards: https://us.posthog.com/project/426635/dashboard
- Session replays: https://us.posthog.com/project/426635/replay
- Error tracking: https://us.posthog.com/project/426635/error_tracking

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-nextjs-app-router/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
