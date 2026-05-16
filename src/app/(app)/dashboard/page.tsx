import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { EmpathyBanner } from '@/components/EmpathyBanner';

export default async function DashboardPage() {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: row } = await sb
    .from('users')
    .select('first_name, signup_position, cohort, last_run_at, user_sheet_id')
    .eq('id', user.id)
    .single();

  const greeting = greetingFor(new Date());

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">{greeting}, {row?.first_name ?? 'friend'} 🌅</h1>
          <p className="text-ink-soft mt-0.5">
            {row?.last_run_at
              ? "Today's matches are below — pulled fresh this morning."
              : "We'll start finding roles for you tomorrow morning. Today is a good day to rest."}
          </p>
        </div>
        <div className="text-xs text-ink-soft">
          You're <strong>#{row?.signup_position}</strong> of 500 · {row?.cohort === 'founder' ? 'Founding member 🌱' : 'Early access'}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Stat highlight num="87%" label="Profile strength" sub="▲ 4% this week" />
        <Stat num="42" label="Roles matched (7d)" sub="▲ 8 vs last week" />
        <Stat num="9" label="Applications sent" sub="3 awaiting reply" />
        <Stat num="2" label="Interviews scheduled" sub="🎉 keep going" />
      </div>

      <div className="rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 p-5 text-white mb-6">
        <p className="text-sm leading-relaxed">
          "Every senior person I know has been laid off at least once. The ones who landed best
          treated each day like a clear, small mission. You're already doing that."
        </p>
        <p className="text-xs opacity-80 mt-2">— Today's note for you</p>
      </div>

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <aside className="space-y-4">
          <div className="card p-5">
            <h3 className="text-xs uppercase tracking-wider text-ink-soft mb-2">Today's mission</h3>
            <ul className="text-sm space-y-2">
              <li>✅ Review today's matches</li>
              <li>⬜ Apply to top 2 picks</li>
              <li>⬜ Send 1 InMail</li>
              <li className="text-ink-soft">⬜ 20 min on a skill (optional)</li>
            </ul>
          </div>

          <div className="card p-5">
            <h3 className="text-xs uppercase tracking-wider text-ink-soft mb-2">Your tracker</h3>
            <p className="text-xs text-ink-soft mb-3">Synced to your Google Sheet.</p>
            {row?.user_sheet_id ? (
              <a
                href={`https://docs.google.com/spreadsheets/d/${row.user_sheet_id}`}
                target="_blank"
                className="btn-soft w-full justify-center"
              >📊 Open my sheet</a>
            ) : (
              <Link href="/onboarding/connect" className="btn-primary w-full justify-center">
                Connect Google
              </Link>
            )}
          </div>
        </aside>

        <section>
          {row?.last_run_at ? (
            <p className="text-sm text-ink-soft">Your daily matches will render here once we wire the dashboard to your Sheet.</p>
          ) : (
            <EmpathyBanner icon="🌱" title="No matches yet — and that's OK.">
              Your first batch ships tomorrow morning at the time you chose. While you wait, take a walk.
              Truly. This part doesn't need you yet.
            </EmpathyBanner>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ num, label, sub, highlight }: { num: string; label: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`card p-4 ${highlight ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white border-transparent' : ''}`}>
      <div className="text-2xl font-bold">{num}</div>
      <div className={`text-xs mt-0.5 ${highlight ? 'opacity-90' : 'text-ink-soft'}`}>{label}</div>
      {sub && <div className={`text-xs mt-1 font-semibold ${highlight ? 'opacity-90' : 'text-success'}`}>{sub}</div>}
    </div>
  );
}

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
