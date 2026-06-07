'use server';
import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { payments } from '@/lib/providers/payments';
import { publicConfig } from '@/lib/config';

export async function startSubscriptionAction() {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: row } = await sb
    .from('users')
    .select('email, first_name')
    .eq('id', user.id)
    .single();
  if (!row) redirect('/login');

  // We have to be very careful with try/catch here: Next's redirect()
  // works by throwing a NEXT_REDIRECT. So every redirect MUST happen
  // outside the try block — otherwise the catch swallows it and the user
  // sees the generic "Application error" page (digest only, no message).
  let checkoutUrl: string | null = null;
  let errCode: string | null = null;
  try {
    const result = await payments().createSubscription({
      user: { id: user.id, email: row.email, firstName: row.first_name ?? null },
      successUrl: `${publicConfig.NEXT_PUBLIC_APP_URL}/billing?status=success`,
      cancelUrl: `${publicConfig.NEXT_PUBLIC_APP_URL}/billing?status=cancel`,
    });
    checkoutUrl = result.checkoutUrl;
  } catch (err) {
    // Log to Vercel for diagnosis; bubble a friendly code to the page.
    console.error('[billing] createSubscription failed:', err);
    errCode = inferErrorCode(err);
  }

  if (errCode) redirect(`/billing?status=error&code=${encodeURIComponent(errCode)}`);
  if (!checkoutUrl) redirect('/billing?status=error&code=unknown');
  redirect(checkoutUrl);
}

function inferErrorCode(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err)) || '';
  // Razorpay SDK errors sometimes nest the message
  const blob = (err as { error?: { description?: string } })?.error?.description ?? '';
  const all = `${msg} ${blob}`.toLowerCase();
  if (all.includes('razorpay_plan_id')) return 'plan_missing';
  if (all.includes('razorpay_key_id')) return 'keys_missing';
  if (/plan.*(not.{0,12}(exist|found)|invalid)/i.test(all)) return 'plan_invalid';
  if (all.includes('authentication') || all.includes('unauthorized')) return 'keys_invalid';
  if (all.includes('econnrefused') || all.includes('etimedout')) return 'network';
  return 'unknown';
}
