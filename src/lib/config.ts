import { z } from 'zod';

/**
 * Runtime env validation.
 * - Server-only secrets fail fast at startup if missing.
 * - Public vars are typed and accessible client-side via NEXT_PUBLIC_*.
 * - All "swappable" choices (LLM_PROVIDER, PAYMENT_PROVIDER, etc.) are
 *   constrained to a closed set so we can't typo a provider name.
 */

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // App-wide tunables (changeable without code deploy)
  FOUNDER_CAP: z.coerce.number().int().positive().default(30),
  TOTAL_CAP: z.coerce.number().int().positive().default(500),
  FREE_TRIAL_FOUNDER_DAYS: z.coerce.number().int().positive().default(90),
  FREE_TRIAL_DEFAULT_DAYS: z.coerce.number().int().positive().default(20),
  MONTHLY_PRICE_INR: z.coerce.number().int().positive().default(399),

  // Supabase server-side
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  // Encryption (32 bytes base64)
  ENCRYPTION_KEY_BASE64: z.string().min(40),

  // LLM
  LLM_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_FAST: z.string().default('claude-haiku-4-5-20251001'),
  ANTHROPIC_MODEL_QUALITY: z.string().default('claude-sonnet-4-6'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL_FAST: z.string().default('gpt-4o-mini'),
  OPENAI_MODEL_QUALITY: z.string().default('gpt-4o'),
  // OpenAI Web Search — Responses API with hosted web_search tool.
  // Fires on user-triggered "Find matches now" only, not the nightly
  // cron. See docs/SETUP_OPENAI_WEBSEARCH.md.
  //
  // Tolerant of empty strings from Vercel (an unset-but-listed env var
  // arrives as ""). Plain .default() only applies to strictly undefined.
  OPENAI_MODEL_JOB_SEARCH: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : 'gpt-5.6-terra')),
  // Tolerant of empty strings from Vercel (an unset-but-listed env var
  // arrives as ""). Plain zod defaults only apply when the value is
  // strictly undefined, which broke prod deploys after users added the
  // key with no value. Both accept unset / empty / any string.
  OPENAI_WEB_SEARCH_ENABLED: z
    .string()
    .optional()
    .transform((v) => {
      if (!v || !v.trim()) return true; // default: enabled
      return v.toLowerCase() !== 'false';
    }),
  OPENAI_WEB_SEARCH_DAILY_CAP: z
    .string()
    .optional()
    .transform((v) => {
      const n = v && v.trim() ? Number(v) : NaN;
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
    }),
  // Max wall-time for a single OpenAI web-search call. Enriched
  // criteria + max_results=20 push typical durations to 40-70s, so 30s
  // was too tight. 90s default gives generous headroom without leaving
  // hung requests forever. Configurable via env for further tuning.
  OPENAI_WEB_SEARCH_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((v) => {
      const n = v && v.trim() ? Number(v) : NaN;
      return Number.isFinite(n) && n >= 10_000 && n <= 240_000
        ? Math.floor(n)
        : 90_000;
    }),

  // Jobs
  JOB_PROVIDERS: z
    .string()
    .default(
      'adzuna,jooble,greenhouse,lever,workable,smartrecruiters,recruitee,themuse,remotive,jsearch,coresignal',
    ),
  ADZUNA_APP_ID: z.string().optional(),
  ADZUNA_APP_KEY: z.string().optional(),
  JOOBLE_API_KEY: z.string().optional(),
  GREENHOUSE_BOARDS: z.string().default(''),
  JSEARCH_API_KEY: z.string().optional(),
  // Coresignal Multi-source Jobs API. Trial + subscription both use
  // the same key format (phc_...). Off by default in JOB_PROVIDERS
  // until you decide to subscribe — see docs/SETUP_CORESIGNAL.md.
  CORESIGNAL_API_KEY: z.string().optional(),
  LEVER_BOARDS: z.string().default(''),
  WORKABLE_BOARDS: z.string().default(''),
  SMARTRECRUITERS_BOARDS: z.string().default(''),
  RECRUITEE_BOARDS: z.string().default(''),

  // Google
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT: z.string().url().default('http://localhost:3000/api/google/callback'),

  // Payments
  PAYMENT_PROVIDER: z.enum(['razorpay', 'stripe']).default('razorpay'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  RAZORPAY_PLAN_ID: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),

  // Email
  EMAIL_PROVIDER: z.enum(['resend', 'gmail']).default('resend'),
  RESEND_API_KEY: z.string().optional(),
  FROM_EMAIL: z.string().email().default('hello@get-relaunch.com'),

  // Optional
  PROXYCURL_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  CRON_SECRET: z.string().min(16),

  // Reddit — distribution-lead crawler. Optional because the crawler
  // still starts up without them; it just logs a helpful error and
  // no-ops. See docs/REDDIT_OAUTH.md for how to register the script app.
  REDDIT_CLIENT_ID: z.string().optional(),
  REDDIT_CLIENT_SECRET: z.string().optional(),
  REDDIT_USERNAME: z.string().optional(),
  REDDIT_PASSWORD: z.string().optional(),

  // Admin — who can access /admin to review the waitlist + mint invites
  ADMIN_EMAIL: z.string().email().default('kaushikn2416@gmail.com'),
});

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_APP_NAME: z.string().default('Relaunch'),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().default('https://us.i.posthog.com'),
});

function parseServer() {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid server env:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid server environment variables');
  }
  return parsed.data;
}

function parsePublic() {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  });
  if (!parsed.success) {
    console.error('Invalid public env:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid public environment variables');
  }
  return parsed.data;
}

// Lazy singletons (server config not evaluated in browser bundle)
let _serverConfig: ReturnType<typeof parseServer> | undefined;
export function serverConfig() {
  if (typeof window !== 'undefined') {
    throw new Error('serverConfig() is server-only');
  }
  _serverConfig ??= parseServer();
  return _serverConfig;
}

export const publicConfig = parsePublic();

// Convenience: list of enabled job providers, parsed
export function enabledJobProviders(): string[] {
  return serverConfig().JOB_PROVIDERS.split(',').map((s) => s.trim()).filter(Boolean);
}
