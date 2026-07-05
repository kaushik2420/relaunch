import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import type { UserProfile } from '@/lib/types';
import { ExtensionCard } from './ExtensionCard';
import { WatchedCompaniesCard } from './WatchedCompaniesCard';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { saved?: string };
}) {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const { data: row } = await sb.from('users')
    .select('email_frequency, email_time, google_email, user_sheet_id, profile, updated_at, extension_token')
    .eq('id', user.id).single();

  const profile = (row?.profile ?? null) as UserProfile | null;
  const hasProfile = profile && Object.keys(profile).length > 0;
  const skillCount = (profile?.skills ?? []).length;
  const updatedAt = row?.updated_at ? new Date(row.updated_at) : null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 space-y-4">
      {searchParams.saved && (
        <p className="rounded-lg border border-success/30 bg-success-soft p-3 text-sm">
          ✅ Your preferences were saved.
        </p>
      )}
      <div className="card">
        <h2 className="text-xl font-bold">Your resume &amp; profile</h2>
        {hasProfile ? (
          <>
            <p className="mt-1 text-sm text-ink-soft">
              <strong>{profile!.fullName}</strong> · {profile!.seniority} · {skillCount} skills extracted
              {updatedAt && (
                <span className="text-ink-mute"> · last updated {updatedAt.toLocaleDateString()}</span>
              )}
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <Link href="/onboarding/profile" className="btn-soft">Edit profile</Link>
              <Link href="/onboarding/upload" className="btn-soft">Replace resume</Link>
            </div>
            <p className="mt-3 text-xs text-ink-mute">
              Replacing your resume runs a fresh extraction. Your existing matches and Sheet stay intact.
            </p>
          </>
        ) : (
          <Link href="/onboarding/upload" className="btn-primary mt-2 inline-flex">Upload resume</Link>
        )}
      </div>

      <div className="card">
        <h2 className="text-xl font-bold">Notifications</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Frequency: <strong>{row?.email_frequency}</strong> at <strong>{row?.email_time}</strong>.
        </p>
        <Link href="/onboarding/preferences" className="btn-soft mt-3 inline-flex">Change preferences</Link>
      </div>

      <div className="card">
        <h2 className="text-xl font-bold">Connected accounts</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Google: {row?.google_email ?? <em>not connected</em>}
        </p>
        {!row?.user_sheet_id && (
          <Link href="/onboarding/connect" className="btn-primary mt-3 inline-flex">Connect Google</Link>
        )}
      </div>

      <div className="card">
        <h2 className="text-xl font-bold">Plan</h2>
        <Link href="/billing" className="btn-soft mt-2 inline-flex">Manage subscription</Link>
      </div>

      <ExtensionCard token={(row?.extension_token as string | null) ?? null} />

      {/* Watched companies — feed into the daily run. The wrapping
          div carries id="watched-companies" so the avatar-menu link
          (/settings#watched-companies) can scroll straight to it. */}
      <div id="watched-companies" className="scroll-mt-24">
        <WatchedCompaniesCardServer userId={user.id} />
      </div>

      <div className="card">
        <h2 className="text-xl font-bold">Privacy</h2>
        <p className="mt-1 text-sm text-ink-soft">
          We store the minimum needed to run your alerts. Your resume and matches live in your Google Sheet.
        </p>
        <Link href="/legal/privacy" className="text-brand-700 hover:underline text-sm mt-2 inline-block">Read full privacy policy →</Link>
      </div>
    </div>
  );
}

/** Server component that fetches the user's watched companies and
 *  passes them into the client-rendered card. Inlined here so we keep
 *  the data-fetch local to the section that uses it. */
async function WatchedCompaniesCardServer({ userId }: { userId: string }) {
  const { data: rows } = await supabaseAdmin()
    .from('watched_companies')
    .select('id, name, ats, ats_slug, detection_status, careers_url, last_checked_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  return <WatchedCompaniesCard rows={(rows ?? []) as Parameters<typeof WatchedCompaniesCard>[0]['rows']} />;
}
