-- 0020_broadcast_emails.sql
-- Admin-triggered broadcast emails. Two tables:
--
--   broadcast_emails      — one row per broadcast (subject + body +
--                           audience + summary counts)
--   broadcast_recipients  — one row per recipient-email pair for
--                           per-user status + dedup across broadcasts
--
-- Not RLS-open — writes happen via service-role admin client only.

CREATE TABLE IF NOT EXISTS public.broadcast_emails (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_at           timestamptz NOT NULL DEFAULT now(),
  sent_by           text NOT NULL,          -- admin email
  subject           text NOT NULL,
  body_html         text NOT NULL,
  audience          text NOT NULL,          -- 'active' | 'active_invitees' | 'everyone'
  recipient_count   int NOT NULL DEFAULT 0,
  succeeded         int NOT NULL DEFAULT 0,
  failed            int NOT NULL DEFAULT 0,
  duration_ms       int
);

CREATE INDEX IF NOT EXISTS idx_broadcast_emails_sent_at
  ON public.broadcast_emails(sent_at DESC);

CREATE TABLE IF NOT EXISTS public.broadcast_recipients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id  uuid NOT NULL REFERENCES public.broadcast_emails(id) ON DELETE CASCADE,
  email         text NOT NULL,
  first_name    text,
  audience_bucket text NOT NULL,             -- 'active_user' | 'invited' | 'pending'
  status        text NOT NULL CHECK (status IN ('sent', 'failed')),
  error         text,
  sent_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast
  ON public.broadcast_recipients(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_email
  ON public.broadcast_recipients(email, sent_at DESC);

ALTER TABLE public.broadcast_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;
