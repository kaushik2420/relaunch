import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { EmpathyBanner } from '@/components/EmpathyBanner';
import { Stepper } from '../upload/page';

export default async function ConnectPage() {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: row } = await sb
    .from('users')
    .select('user_sheet_id')
    .eq('id', user.id)
    .single();

  if (row?.user_sheet_id) redirect('/dashboard');

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Stepper step={4} />
      <div className="card">
        <h1 className="text-2xl font-bold">Connect your Google account</h1>
        <p className="mt-1 text-sm text-ink-soft">
          We'll create a private Google Sheet in your Drive. Every job, tailored resume, contact,
          and outcome lives there. <strong>You own it. We don't store any of it.</strong>
        </p>

        <div className="mt-5">
          <EmpathyBanner icon="🔒" title="The least permission possible.">
            We ask for <code>drive.file</code> (only files we create) and optionally{' '}
            <code>gmail.send</code> for sending your daily digest from your own address.
          </EmpathyBanner>
        </div>

        <a href="/api/google/oauth" className="btn-primary mt-6 inline-flex">
          <span className="text-base">G</span> Connect Google
        </a>

        <p className="mt-4 text-xs text-ink-mute">
          Prefer to skip? <a href="/dashboard" className="underline">Use Relaunch without Google</a> —
          we'll show matches in-app, but you won't get the daily Sheet.
        </p>
      </div>
    </div>
  );
}
