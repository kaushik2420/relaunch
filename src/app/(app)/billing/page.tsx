import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { evaluateTrial, priceLabel } from '@/lib/services/billing';
import { EmpathyBanner } from '@/components/EmpathyBanner';
import { startSubscriptionAction } from './actions';

const ERROR_COPY: Record<string, { title: string; body: string }> = {
  plan_missing: {
    title: "Subscriptions aren't fully configured yet.",
    body: "Our team hasn't published the plan id to this environment. Drop us a note at hello@get-relaunch.com and we'll switch it on for you right away.",
  },
  plan_invalid: {
    title: "The subscription plan looks misconfigured.",
    body: "Razorpay didn't recognise our plan id. We've been alerted — please email hello@get-relaunch.com if you need to upgrade urgently.",
  },
  keys_missing: {
    title: "Payments are temporarily unavailable.",
    body: "Our Razorpay credentials aren't set in this environment. Hang tight — write to hello@get-relaunch.com and we'll get you a working link.",
  },
  keys_invalid: {
    title: "Payments are temporarily unavailable.",
    body: "Razorpay rejected our credentials. We've been notified — please reach out at hello@get-relaunch.com and we'll fix this within the hour.",
  },
  network: {
    title: "Couldn't reach Razorpay just now.",
    body: 'A transient network blip — please try again in a moment. If it keeps failing, write to hello@get-relaunch.com.',
  },
  unknown: {
    title: "Something went wrong opening checkout.",
    body: "Please try again, or write to us at hello@get-relaunch.com and we'll sort it out personally.",
  },
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams?: { status?: string; code?: string };
}) {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: row } = await sb
    .from('users')
    .select('first_name, free_until, is_paying, cohort, signup_position')
    .eq('id', user.id)
    .single();
  if (!row) redirect('/login');

  const trial = evaluateTrial({ is_paying: row.is_paying ?? false, free_until: row.free_until as string });
  const errorCopy =
    searchParams?.status === 'error'
      ? ERROR_COPY[searchParams.code ?? 'unknown'] ?? ERROR_COPY.unknown
      : null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="card">
        <h1 className="text-2xl font-bold">Your plan</h1>

        {errorCopy && (
          <div className="mt-4">
            <EmpathyBanner icon="🙏" title={errorCopy.title}>
              {errorCopy.body}
            </EmpathyBanner>
          </div>
        )}

        {trial.status === 'paying' && (
          <p className="mt-2 text-sm text-success">You're on Relaunch Pro · {priceLabel()}</p>
        )}

        {trial.status === 'trial-active' && (
          <p className="mt-2 text-sm">
            Free trial: <strong>{trial.daysLeft} days left</strong>. After that, {priceLabel()}.
          </p>
        )}

        {trial.status === 'trial-expiring' && (
          <div className="mt-3">
            <EmpathyBanner icon="🌅" title={`Your trial ends in ${trial.daysLeft} ${trial.daysLeft === 1 ? 'day' : 'days'}.`}>
              We'd love to keep helping. If money is tight right now, write to us at{' '}
              <a href="mailto:hello@get-relaunch.com" className="underline">hello@get-relaunch.com</a> — we have a
              hardship program for folks still in the job hunt.
            </EmpathyBanner>
          </div>
        )}

        {trial.status === 'trial-expired' && (
          <div className="mt-3">
            <EmpathyBanner icon="🙋" title="Your trial ended.">
              Pick up where you left off any time. Your Google Sheet stays in your Drive — we don't touch it.
            </EmpathyBanner>
          </div>
        )}

        <hr className="my-6 border-line" />

        <div className="space-y-2 text-sm">
          <Row label="Plan" value="Relaunch Pro" />
          <Row label="Price" value={priceLabel()} />
          <Row label="Renews" value="Monthly, cancel anytime" />
          <Row label="Cohort" value={row.cohort === 'founder' ? `Founding member #${row.signup_position}` : `Early member #${row.signup_position}`} />
        </div>

        {!trial.isPaying && (
          <form action={startSubscriptionAction} className="mt-6">
            <button className="btn-primary w-full">Subscribe — {priceLabel()}</button>
            <p className="mt-2 text-xs text-ink-mute text-center">Powered by Razorpay. UPI, cards, netbanking supported.</p>
          </form>
        )}
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
