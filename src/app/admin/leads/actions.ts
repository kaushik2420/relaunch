'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { serverConfig } from '@/lib/config';
import { crawlRedditLeads } from '@/lib/services/reddit-crawler';

type LeadStatus = 'new' | 'replied' | 'dismissed' | 'irrelevant';

async function requireAdmin(): Promise<void> {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect('/login');
  if ((user.email ?? '').toLowerCase() !== serverConfig().ADMIN_EMAIL.toLowerCase()) {
    redirect('/dashboard');
  }
}

/**
 * Move a lead through its lifecycle: new → replied | dismissed | irrelevant.
 * Called from the admin UI as a plain form action.
 */
export async function updateLeadStatusAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get('id')?.toString();
  const status = formData.get('status')?.toString() as LeadStatus | undefined;
  if (!id || !status) return;
  const admin = supabaseAdmin();
  await admin
    .from('distribution_leads')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  revalidatePath('/admin/leads');
}

/**
 * Manual "Run crawl now" trigger from the admin UI — useful for
 * pulling fresh leads without waiting for the 4:15 AM cron.
 */
export async function crawlNowAction(): Promise<void> {
  await requireAdmin();
  await crawlRedditLeads();
  revalidatePath('/admin/leads');
}
