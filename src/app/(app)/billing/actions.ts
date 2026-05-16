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

  const { checkoutUrl } = await payments().createSubscription({
    user: { id: user.id, email: row.email, firstName: row.first_name ?? null },
    successUrl: `${publicConfig.NEXT_PUBLIC_APP_URL}/billing?status=success`,
    cancelUrl: `${publicConfig.NEXT_PUBLIC_APP_URL}/billing?status=cancel`,
  });
  redirect(checkoutUrl);
}
