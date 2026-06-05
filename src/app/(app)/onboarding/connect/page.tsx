import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { EmpathyBanner } from '@/components/EmpathyBanner';
import { Stepper } from '@/components/Stepper';

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: { status?: string; error?: string };
}) {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    // OAuth round-trips occasionally drop the Supabase session cookie. If
    // the user just finished Google connect, their data is already saved —
    // they just need to sign in once. Tell them that explicitly so the
    // momentary "logged out" doesn't feel like a bug.
    if (searchParams.status === 'connected') {
      return (
        <div className="mx-auto max-w-md px-6 py-12 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-success-soft text-3xl">
            ✅
          </div>
          <h1 className="mt-4 text-2xl font-bold">Google connected — almost there</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Your Google Sheet is ready. The Google round-trip signed you out
            briefly — sign in once more and you&apos;ll land on your dashboard
            with everything saved.
          </p>
          <Link href="/login" className="btn-primary mt-6 inline-flex">
            Sign in to continue →
          </Link>
        </div>
      );
    }
    redirect('/login');
  }

  const { data: row } = await sb
    .from('users')
    .select('user_sheet_id, google_email')
    .eq('id', user.id)
    .single();

  const justConnected = searchParams.status === 'connected';
  const oauthError = searchParams.error;

  // Success state — show confirmation + manual "Continue" button.
  // We DO NOT auto-redirect here, because we just came back from
  // the Google round-trip and want the user to see proof their
  // data landed before moving on.
  if (justConnected && row?.user_sheet_id) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Stepper step={4} />
        <div className="card">
          <div className="text-center">
            <div className="mx-auto h-14 w-14 grid place-items-center rounded-full bg-success-soft text-3xl">✅</div>
            <h1 className="mt-4 text-2xl font-bold">You're all set, {user.email?.split('@')[0]}!</h1>
            <p className="mt-2 text-sm text-ink-soft">
              Your Google Sheet is ready in Drive. Every job we find for you tomorrow morning will appear there.
            </p>
          </div>

          <div className="mt-6 space-y-3 rounded-lg bg-surface-page p-4 text-sm">
            <Row label="Connected account" value={row.google_email ?? 'Google account'} />
            <Row label="Sheet" value="Relaunch — Job Tracker" />
            <Row label="First daily run" value="Tomorrow morning at your chosen time" />
          </div>

          <div className="mt-6 flex flex-col items-stretch gap-2">
            <Link href="/dashboard" className="btn-primary justify-center">
              Take me to my dashboard →
            </Link>
            <a
              href={`https://docs.google.com/spreadsheets/d/${row.user_sheet_id}`}
              target="_blank"
              rel="noreferrer"
              className="btn-soft justify-center"
            >
              📊 Open my Sheet
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Already connected from a previous session — fast-forward to dashboard
  if (row?.user_sheet_id && !justConnected) redirect('/dashboard');

  // Initial / not-yet-connected state. Show OAuth init button.
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
            We ask only for <code>drive.file</code> — access limited to the single
            Job Tracker sheet Relaunch creates for you. We can't see anything else in
            your Drive, and your daily digest is emailed to you separately.
          </EmpathyBanner>
        </div>

        {oauthError && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            {oauthErrorMessage(oauthError)}{' '}
            <a href="/api/google/oauth" className="underline font-medium">Try again</a>
          </div>
        )}

        <a href="/api/google/oauth" className="btn-primary mt-6 inline-flex">
          <span className="text-base">G</span> Connect Google
        </a>

        <p className="mt-4 text-xs text-ink-mute">
          Prefer to skip? <Link href="/dashboard" className="underline">Use Relaunch without Google</Link> —
          we'll show matches in-app, but you won't get the daily Sheet.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-soft">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function oauthErrorMessage(code: string): string {
  switch (code) {
    case 'state_invalid':
      return 'Your connection link expired or was tampered with. Please try again.';
    case 'no_refresh_token':
      return "Google didn't issue a refresh token — likely you've connected before. We'll fix that now.";
    case 'token_exchange':
      return "Couldn't exchange the Google code. Please try again.";
    case 'sheet_create':
      return "We connected your account but couldn't create the Sheet. Try once more — if it persists, drop us a line.";
    case 'oauth':
    default:
      return 'Something went wrong with the Google connection.';
  }
}
