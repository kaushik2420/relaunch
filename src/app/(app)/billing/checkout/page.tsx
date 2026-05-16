import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { CheckoutLauncher } from './CheckoutLauncher';
import { serverConfig } from '@/lib/config';

/**
 * Razorpay subscription checkout — we render the official JS modal.
 * Razorpay doesn't provide a hosted page for subscriptions, so we
 * do the standard Checkout.js handoff here.
 */
export default async function CheckoutPage({ searchParams }: { searchParams: { sub_id?: string } }) {
  const subId = searchParams.sub_id;
  if (!subId) redirect('/billing');
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const { data: row } = await sb.from('users').select('email, first_name, phone').eq('id', user.id).single();
  if (!row) redirect('/login');

  return (
    <div className="mx-auto max-w-md px-6 py-14 text-center">
      <h1 className="text-2xl font-bold">Opening secure checkout…</h1>
      <p className="mt-2 text-sm text-ink-soft">If the popup doesn't appear, click below.</p>
      <CheckoutLauncher
        subscriptionId={subId}
        razorpayKeyId={serverConfig().RAZORPAY_KEY_ID ?? ''}
        userEmail={row.email}
        userName={row.first_name ?? ''}
        userPhone={row.phone ?? ''}
      />
    </div>
  );
}
