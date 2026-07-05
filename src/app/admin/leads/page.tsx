import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { serverConfig } from '@/lib/config';
import { Logo } from '@/components/Logo';
import { SubmitButton } from '@/components/SubmitButton';
import { updateLeadStatusAction, crawlNowAction } from './actions';

export const dynamic = 'force-dynamic';

type Lead = {
  id: string;
  source: string;
  community: string;
  author: string | null;
  title: string;
  body: string | null;
  url: string;
  posted_at: string | null;
  score: number;
  num_comments: number;
  matched_keywords: string[];
  lead_score: number;
  status: 'new' | 'replied' | 'dismissed' | 'irrelevant';
  seen_at: string;
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: {
    status?: string;
    crawled?: string;
    scanned?: string;
    matched?: string;
    inserted?: string;
    err?: string;
  };
}) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect('/login');
  if ((user.email ?? '').toLowerCase() !== serverConfig().ADMIN_EMAIL.toLowerCase()) {
    redirect('/dashboard');
  }

  const filter = (searchParams.status as Lead['status']) || 'new';
  const { data } = await supabaseAdmin()
    .from('distribution_leads')
    .select('*')
    .eq('status', filter)
    .order('lead_score', { ascending: false })
    .limit(200);
  const leads = (data ?? []) as Lead[];

  const { data: counts } = await supabaseAdmin()
    .from('distribution_leads')
    .select('status', { count: 'exact', head: false });
  const byStatus: Record<string, number> = {};
  for (const r of (counts ?? []) as { status: string }[]) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }

  return (
    <main className="min-h-screen bg-surface-page">
      <nav className="flex items-center justify-between border-b border-line bg-surface px-6 py-3.5">
        <Logo />
        <div className="flex items-center gap-4 text-sm">
          <Link href="/admin" className="text-ink-soft hover:text-ink">
            ← Admin home
          </Link>
        </div>
      </nav>

      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Distribution leads</h1>
            <p className="mt-1 text-sm text-ink-soft">
              Laid-off / job-hunting posts pulled from Reddit. Review each
              one, reply in the source community, then mark it done.
            </p>
          </div>
          <form action={crawlNowAction}>
            <SubmitButton
              className="btn-soft text-xs"
              pendingLabel="Crawling…"
            >
              ↻ Crawl now
            </SubmitButton>
          </form>
        </div>

        {searchParams.crawled === '1' && (
          <div
            className={
              searchParams.err
                ? 'mt-5 rounded-xl border border-warn/40 bg-warn-soft p-4 text-sm'
                : 'mt-5 rounded-xl border border-brand-500/30 bg-brand-50 p-4 text-sm'
            }
          >
            <div className="font-semibold text-ink">
              Crawl finished · scanned <strong>{searchParams.scanned}</strong>,
              matched <strong>{searchParams.matched}</strong>, inserted{' '}
              <strong>{searchParams.inserted}</strong> new{' '}
              {Number(searchParams.inserted ?? '0') === 1 ? 'lead' : 'leads'}
            </div>
            {searchParams.inserted === '0' && !searchParams.err && (
              <p className="mt-1 text-xs text-ink-soft">
                Reddit returned posts but none matched the keyword pack today.
                Try again later — new posts land at all hours.
              </p>
            )}
            {searchParams.err && (
              <>
                <p className="mt-1 text-xs font-semibold text-warn">
                  Errors while fetching:
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words rounded bg-white/60 p-2 font-mono text-[11px] text-ink">
                  {searchParams.err}
                </p>
                <p className="mt-2 text-xs text-ink-soft">
                  If you see 403s, Reddit is blocking our anonymous
                  requests. See <code>docs/REDDIT_OAUTH.md</code> (or
                  message Claude) to switch to a script-app OAuth token.
                </p>
              </>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2 text-xs">
          {(['new', 'replied', 'dismissed', 'irrelevant'] as Lead['status'][]).map(
            (s) => (
              <Link
                key={s}
                href={`/admin/leads?status=${s}`}
                className={
                  filter === s
                    ? 'rounded-full bg-brand-500 px-3 py-1 font-semibold text-white'
                    : 'rounded-full border border-line bg-surface px-3 py-1 text-ink-soft hover:border-brand-500/40'
                }
              >
                {s} <span className="opacity-70">· {byStatus[s] ?? 0}</span>
              </Link>
            ),
          )}
        </div>

        {leads.length === 0 ? (
          <div className="mt-8 rounded-xl border border-line bg-surface p-8 text-center">
            <p className="text-sm text-ink-soft">
              No {filter} leads. The crawler runs daily at 4:15 AM UTC — or
              hit “Crawl now” to pull fresh ones.
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {leads.map((l) => (
              <LeadCard key={l.id} lead={l} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  const snippet = (lead.body || '').slice(0, 320);
  const truncated = (lead.body || '').length > 320;

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-mute">
            <span className="rounded-full bg-cream-100 px-2 py-0.5 font-semibold text-ink-soft">
              {lead.community}
            </span>
            {lead.author && (
              <span>
                u/<span className="font-medium text-ink">{lead.author}</span>
              </span>
            )}
            <span>·</span>
            <span title={lead.posted_at ?? ''}>{fmtRelative(lead.posted_at)}</span>
            <span>·</span>
            <span>↑ {lead.score}</span>
            <span>·</span>
            <span>{lead.num_comments} comments</span>
            <span>·</span>
            <span className="text-brand-700">score {lead.lead_score.toFixed(1)}</span>
          </div>
          <a
            href={lead.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block text-base font-semibold text-ink hover:underline"
          >
            {lead.title}
          </a>
          {snippet && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">
              {snippet}
              {truncated ? '…' : ''}
            </p>
          )}
          {lead.matched_keywords.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {lead.matched_keywords.map((kw) => (
                <span
                  key={kw}
                  className="rounded-full bg-accent-500/30 px-2 py-0.5 text-[10px] font-medium text-brand-700"
                >
                  {kw}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <a
          href={lead.url}
          target="_blank"
          rel="noreferrer"
          className="btn-primary text-xs px-3 py-1.5"
        >
          Reply on Reddit ↗
        </a>
        <StatusForm id={lead.id} status="replied" label="Mark replied" />
        <StatusForm id={lead.id} status="dismissed" label="Dismiss" />
        <StatusForm
          id={lead.id}
          status="irrelevant"
          label="Not a real fit"
          variant="ghost"
        />
        {lead.status !== 'new' && (
          <StatusForm id={lead.id} status="new" label="↩ Reset to new" variant="ghost" />
        )}
      </div>
    </div>
  );
}

function StatusForm({
  id,
  status,
  label,
  variant = 'soft',
}: {
  id: string;
  status: 'new' | 'replied' | 'dismissed' | 'irrelevant';
  label: string;
  variant?: 'soft' | 'ghost';
}) {
  return (
    <form action={updateLeadStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton
        className={
          variant === 'ghost'
            ? 'btn-ghost text-xs px-3 py-1.5'
            : 'btn-soft text-xs px-3 py-1.5'
        }
        pendingLabel="Saving…"
      >
        {label}
      </SubmitButton>
    </form>
  );
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return iso;
  const diff = Math.max(0, Date.now() - d);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
