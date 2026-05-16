import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';

export default async function SettingsPage() {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const { data: row } = await sb.from('users')
    .select('email_frequency, email_time, google_email, user_sheet_id')
    .eq('id', user.id).single();

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 space-y-4">
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
