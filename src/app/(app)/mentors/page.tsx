import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { listActiveMentors } from '@/lib/services/mentors';
import { MentorsGrid } from './MentorsGrid';

export const dynamic = 'force-dynamic';

export default async function MentorsPage() {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect('/login');

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
            in a few days — or if you&apos;re a leader who wants to help,
            reply to any Relaunch email and we&apos;ll get you on the list.
          </p>
        </div>
      ) : (
        <MentorsGrid mentors={mentors} />
      )}
    </div>
  );
}
