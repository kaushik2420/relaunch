# Relaunch Browser Extension — v1 Spec

**Status:** v1 design · ready to build
**Owner:** Kaushik
**Target ship:** ~2 weeks after Boost public launch
**Last updated:** 2026-06-07

---

## 1. Goal

When a Relaunch user clicks **View role** on their daily match and lands on an
ATS application page, a Chrome extension recognizes the page, pulls the
**tailored** résumé/cover-letter/answers Relaunch already generated for that
specific job, and helps the user fill the form in seconds — without ever
auto-submitting, mass-applying, or doing anything that could get their
account flagged.

The extension is the delivery vehicle for content Relaunch already produces.
It is **not** a mass-apply tool.

---

## 2. Non-goals (explicitly out of scope for v1)

- **Auto-submitting forms.** The submit button is always the user's click.
- **Mass-apply / bulk-apply across many roles in one session.** This is the
  pattern LinkedIn and most ATSes detect and ban.
- **Auto-fill EEO / demographic questions** (race, gender, veteran status,
  disability). Those are personal and ethical disclosures the user owns.
- **Filling Workday** in v1. Its dynamic, multi-step forms and shifting field
  IDs deserve a dedicated v2 effort.
- **LinkedIn Easy Apply auto-fill** in v1. Read-only ("copy these to the
  field") only — see §5.
- **Storing any data on the extension server beyond the API call needed**
  to fetch the tailored payload.

---

## 3. Supported surfaces (v1)

| Surface              | URL pattern                                                                  | Mode      | Notes                                                                                  |
| -------------------- | ---------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------- |
| **Greenhouse**       | `boards.greenhouse.io/*`, `*.greenhouse.io/jobs/*`, embedded forms via iframe | Auto-fill | Predictable selectors. ~30% of tech ATS market in our funnel.                          |
| **Lever**            | `jobs.lever.co/*`                                                            | Auto-fill | Stable selectors, single-page form.                                                    |
| **Ashby**            | `jobs.ashbyhq.com/*`, `*.ashbyhq.com/*`                                       | Auto-fill | Single-page, fast-growing.                                                             |
| **LinkedIn**         | `linkedin.com/jobs/*`                                                        | Read-only | Popup shows tailored content with copy buttons; **no DOM injection**. v2 may add fill. |
| **Generic job page** | Any URL with a Relaunch match for it                                         | Read-only | Popup-only — copy buttons for résumé, cover letter, answers.                            |

Future adapters (post-v1, in order of likely impact): Workday, Workable, SmartRecruiters, Recruitee, BambooHR, iCIMS.

---

## 4. End-to-end flow

1. User signs into Relaunch and opens **Settings → Browser extension**, where
   they generate an **extension token** (one-click, regeneratable).
2. User installs the extension (Chrome Web Store post-review; load-unpacked
   for early access), opens its options page, pastes the token, hits Save.
3. Every morning Relaunch generates ~5 tailored matches. The "View role"
   button in the dashboard already links to the job application URL.
4. User clicks View role. They land on (say) a Greenhouse form.
5. Content script detects "this is Greenhouse → there's a Relaunch match
   for this URL" and renders a small floating widget: "Fill with Relaunch
   (tailored for this role)". **It does not auto-fill.**
6. User clicks Fill. The extension:
   1. Calls `GET /api/extension/job?url=<encoded-job-url>` with the token
      in the `Authorization: Bearer` header.
   2. Receives the tailored payload (see §6).
   3. Maps payload fields → form fields using the Greenhouse adapter (§7).
   4. Writes values via `dispatchEvent(new Event("input", { bubbles: true }))`
      so React/Vue forms register the change.
   5. Shows a non-dismissable banner above the form:
      *"Filled by Relaunch — review carefully before submitting. We did not
      auto-submit."*
7. **Résumé attachment** is the one thing we can't programmatically inject
   (Chrome security). Instead, the extension downloads the tailored PDF and
   shows: *"Tailored résumé saved to Downloads. Click the Attach button on
   the form and pick it from there."*

---

## 5. TOS / safety safeguards

These are bright lines we never cross, even with explicit user consent:

- **Never auto-submit a form.** Submit is always the user's click.
- **Rate limit per-platform:** maximum **5 fills per hour** per ATS. After
  that the floating widget shows a cooldown notice. Enforced client-side via
  `chrome.storage.local`, AND server-side via the API endpoint.
- **One-action-per-click.** The Fill button maps one payload → one form. No
  background filling, no chained automation across tabs.
- **Per-platform first-visit consent.** The first time the extension is
  active on a given ATS, a modal appears stating:
  > *"Auto-fill warning: applying to many jobs very quickly is the pattern
  > ATSes use to detect bots. Relaunch never auto-submits and limits you to
  > 5 fills per hour, but please pace your applications and review every
  > field before submitting. Continue?"*
  Consent stored per platform in `chrome.storage.local`.
- **LinkedIn special treatment.** Read-only in v1. The popup shows copy
  buttons; the extension never writes to LinkedIn DOM. The first-visit modal
  on LinkedIn says:
  > *"LinkedIn does not allow automated form-filling under its Terms of
  > Service. Relaunch shows you tailored copy to paste manually — we never
  > write to LinkedIn fields. Do not use automation tools to mass-apply."*
- **No telemetry beyond functional API calls.** The extension makes exactly
  these network calls:
  - `GET /api/extension/job?url=…` to fetch tailored payload
  - `GET /api/extension/me` to validate token + fetch profile basics
  - `GET <signed-url>` to download the tailored PDF
  No analytics pings, no DOM data sent home, no "user behavior" tracking.
- **Privacy policy** linked from options page covers what is read, what is
  sent, what is stored locally vs. on Relaunch. Plain English.
- **Open source the extension** so anyone can verify the above. (Backend
  stays closed.)

---

## 6. Backend API (Relaunch side)

Two new endpoints, both under `/api/extension/*`, token-authed only (no
cookies), CORS-locked to the extension's origin (`chrome-extension://<id>`).

### `GET /api/extension/me`

Validates the token and returns identity + minimal profile.

```jsonc
{
  "user": { "id": "uuid", "firstName": "Kaushik", "email": "..." },
  "profile": {
    "fullName": "Kaushik N",
    "email": "...",
    "phone": "+91…",
    "location": "Mumbai, India",
    "linkedinUrl": "https://www.linkedin.com/in/...",
    "githubUrl": null,
    "portfolioUrl": null,
    "yearsExperience": 7
  }
}
```

### `GET /api/extension/job?url=<encoded-job-url>`

Looks up the most recent Relaunch match whose `apply_url` matches the host
the user is currently on (host + path match; query strings ignored).

```jsonc
{
  "match": {
    "id": "uuid",
    "jobTitle": "Senior Product Manager",
    "company": "Acme Corp",
    "applyUrl": "https://boards.greenhouse.io/acme/jobs/12345",
    "matchPercent": 87,
    "verifyScore": 78
  },
  "tailored": {
    "resumeText": "…full plain-text tailored résumé…",
    "resumePdfUrl": "https://drive.google.com/uc?id=…",
    "coverLetterText": "…tailored cover letter…",
    "coverLetterPdfUrl": "https://drive.google.com/uc?id=…",
    "whyThisRole": "…2-3 sentences answering 'Why are you interested?'…",
    "summary": "…3-sentence elevator pitch tailored to this JD…"
  },
  "profile": { /* same as /me */ }
}
```

If no match exists for this URL, return `404` — the extension then shows
"This page isn't a Relaunch match yet. Open Relaunch to add it to today's
list."

### Storage

Tailored content per match needs to be queryable. Currently it's only
written to Google Docs + the sheet. Required change:

- **Migration `0009_job_matches.sql`**: new table `public.job_matches` with
  one row per (run, job). Columns: `id`, `user_id`, `job_run_id`, `apply_url`,
  `job_title`, `company`, `match_percent`, `verify_score`, `tailored_resume_text`,
  `tailored_resume_pdf_url`, `cover_letter_text`, `cover_letter_pdf_url`,
  `why_this_role`, `summary`, `created_at`. RLS: user can read own rows.
- **`daily-runner.ts`**: alongside the existing sheet write, insert a row
  into `job_matches` for each tailored match.
- **`users.extension_token`** column (nullable text). Single token per user,
  regeneratable from settings.

### Settings UI

New section in `/settings`:
- "Browser extension" header
- *"Connect your Relaunch account to the Chrome extension."*
- **Token textbox** (read-only when generated), Copy button, Regenerate
  button (revokes the old one).
- Instructions: link to Web Store install (post-launch) or load-unpacked
  guide.

---

## 7. ATS adapter contract

Each adapter is a single file under `src/adapters/<ats>.ts`:

```ts
export interface FormFillAdapter {
  ats: 'greenhouse' | 'lever' | 'ashby' | 'linkedin';
  matches(url: string): boolean;
  /** Fill the page. Returns count of fields filled. Never submits. */
  fill(payload: TailoredPayload): Promise<{ filled: string[]; skipped: string[] }>;
  /** Optional: signal where on the page the floating "Fill" button should anchor. */
  anchor?(): HTMLElement | null;
}
```

Common field map (each adapter declares the selectors that map to these
keys; if a selector is missing, that key is skipped):

| Key                  | Source                          | Notes                                       |
| -------------------- | ------------------------------- | ------------------------------------------- |
| `first_name`         | `profile.fullName` (split)      |                                             |
| `last_name`          | `profile.fullName` (split)      |                                             |
| `full_name`          | `profile.fullName`              |                                             |
| `email`              | `profile.email`                 |                                             |
| `phone`              | `profile.phone`                 |                                             |
| `location`           | `profile.location`              |                                             |
| `linkedin_url`       | `profile.linkedinUrl`           |                                             |
| `github_url`         | `profile.githubUrl`             |                                             |
| `portfolio_url`      | `profile.portfolioUrl`          |                                             |
| `years_experience`   | `profile.yearsExperience`       |                                             |
| `cover_letter`       | `tailored.coverLetterText`      | textarea                                    |
| `why_this_role`      | `tailored.whyThisRole`          | maps to "Why are you interested" textareas  |
| `summary`            | `tailored.summary`              | maps to "Tell us about yourself" prompts    |

**Never** fill: salary expectation, current/expected CTC, notice period,
visa, race/gender/EEO, "have you applied before" — these are case-by-case
decisions that belong to the user.

---

## 8. Permissions story (chrome.permissions)

```jsonc
"permissions": ["storage", "downloads"]
"host_permissions": [
  "https://boards.greenhouse.io/*",
  "https://*.greenhouse.io/*",
  "https://jobs.lever.co/*",
  "https://*.lever.co/*",
  "https://jobs.ashbyhq.com/*",
  "https://*.ashbyhq.com/*",
  "https://www.linkedin.com/jobs/*",
  "https://www.get-relaunch.com/*"
]
```

We **do not** request `<all_urls>` — Chrome Web Store review is much faster
with a narrow host list, and users see clearly what we read.

---

## 9. v1 ship checklist

- [ ] Migration 0009 (job_matches table + extension_token column)
- [ ] daily-runner persists matches to DB
- [ ] /api/extension/me + /api/extension/job endpoints (token auth, CORS)
- [ ] /settings → Browser extension section (generate / regenerate token)
- [ ] Extension manifest + popup + options + background SW
- [ ] Adapters: Greenhouse, Lever, Ashby
- [ ] LinkedIn read-only popup
- [ ] Per-platform first-visit consent modal
- [ ] Client + server-side rate limit (5 fills / hour / platform)
- [ ] Privacy policy + README
- [ ] Chrome Web Store submission (review takes 1–3 weeks; ship
      load-unpacked link first for early users)

## 10. v2 candidates (in priority order)

1. LinkedIn Easy Apply auto-fill, with extra-strict consent + 3/hour cap
2. Workday adapter (separate state machine for multi-step)
3. Smart answers to free-text questions ("Why are you interested in X?")
   using the user's tailored content + the live JD
4. Application tracker: extension nudges Relaunch when the user clicks
   Submit, so applied jobs auto-mark as "applied" in the dashboard
5. Firefox extension (same codebase, manifest tweaks)
