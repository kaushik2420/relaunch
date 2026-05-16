import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { evaluateTrial, priceLabel } from '@/lib/services/billing';
import { EmpathyBanner } from '@/components/EmpathyBanner';
import { startSubscriptionAction } from './actions';

export default async function BillingPage() {
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

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="card">
        <h1 className="text-2xl font-bold">Your plan</h1>

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
              <a href="mailto:hello@relaunch.app" className="underline">hello@relaunch.app</a> — we have a
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
