import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { serverConfig } from '@/lib/config';
import { listActiveMentors } from '@/lib/services/mentors';
import { MentorsGrid } from './MentorsGrid';

export const dynamic = 'force-dynamic';

export default async function MentorsPage() {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect('/login');

  // Feature-flag gate: Mentors is admin-only until we open it up.
  // Non-admin users get bounced to the dashboard silently — the nav
  // entry is also hidden client-side, so this is a defense-in-depth
  // guard against people typing /mentors directly.
  if (
    (user.email ?? '').toLowerCase() !==
    serverConfig().ADMIN_EMAIL.toLowerCase()
  ) {
    redirect('/dashboard');
  }

  const mentors = await listActiveMentors();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Mentors</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Book a 1:1 session with someone who&apos;s been where you are.
          Every mentor on this page has offered their time to help
          people navigate a layoff and the comeback after.
        </p>
      </header>

      {mentors.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-center">
          <h2 className="text-lg font-semibold">Mentors on the way</h2>
          <p className="mt-2 text-sm text-ink-soft">
            We&apos;re curating a first cohort of mentors now. Check back
            in a few days.
          </p>
        </div>
      ) : (
        <MentorsGrid mentors={mentors} />
      )}

      <div className="mt-8 rounded-xl border border-brand-100 bg-brand-50/50 p-4 text-sm">
        <div className="font-semibold text-brand-700">
          Know someone who&apos;d be a great mentor?
        </div>
        <p className="mt-1 text-ink-soft">
          Share this link with them:{' '}
          <a
            href="/join-as-mentor"
            className="font-medium text-brand-700 hover:underline"
          >
            get-relaunch.com/join-as-mentor
          </a>
          . They can sign up themselves — every referral helps this community.
        </p>
      </div>
    </div>
  );
}
