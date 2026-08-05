'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServer } from '@/lib/supabase/server';
import { serverConfig } from '@/lib/config';
import { upsertMentor, setMentorActive } from '@/lib/services/mentors';

async function requireAdmin() {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const adminEmail = serverConfig().ADMIN_EMAIL.toLowerCase();
  if (!user || (user.email ?? '').toLowerCase() !== adminEmail) {
    redirect('/login');
  }
}

/** Parse a comma or newline separated expertise string into a
 *  deduped array. Used by both add + edit forms. */
function parseExpertise(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

/** Add a new mentor OR update an existing one — same form action for
 *  both; the presence of a hidden `id` field switches behaviour. */
export async function upsertMentorAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id') ?? '').trim() || undefined;
  const name = String(formData.get('name') ?? '').trim();
  const headline = String(formData.get('headline') ?? '').trim();
  const calendarUrl = String(formData.get('calendarUrl') ?? '').trim();

  if (!name || !headline || !calendarUrl) {
    redirect(
      '/admin/mentors?error=' +
        encodeURIComponent('Name, headline, and calendar URL are required.'),
    );
  }

  try {
    const newId = await upsertMentor({
      id,
      name,
      headline,
      bio: String(formData.get('bio') ?? '').trim() || null,
      avatarUrl: String(formData.get('avatarUrl') ?? '').trim() || null,
      calendarUrl,
      linkedinUrl: String(formData.get('linkedinUrl') ?? '').trim() || null,
      expertise: parseExpertise(String(formData.get('expertise') ?? '')),
      isActive: formData.get('isActive') === 'true',
      displayOrder: Number(formData.get('displayOrder') ?? 100) || 100,
      sessionLengthMinutes:
        Number(formData.get('sessionLengthMinutes')) || null,
      sessionPriceNote:
        String(formData.get('sessionPriceNote') ?? '').trim() || null,
    });
    revalidatePath('/admin/mentors');
    revalidatePath('/mentors');
    redirect(
      `/admin/mentors?saved=${encodeURIComponent(id ? 'updated' : 'created')}&id=${newId}`,
    );
  } catch (err) {
    if ((err as Error).message?.startsWith('NEXT_REDIRECT')) throw err;
    redirect(
      '/admin/mentors?error=' +
        encodeURIComponent((err as Error).message),
    );
  }
}

/** Toggle a mentor's is_active state. Used by the row toggle in the
 *  admin list. */
export async function toggleMentorActiveAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const isActive = formData.get('isActive') === 'true';
  if (!id) redirect('/admin/mentors?error=missing-id');
  try {
    await setMentorActive(id, isActive);
    revalidatePath('/admin/mentors');
    revalidatePath('/mentors');
    redirect(`/admin/mentors?saved=${isActive ? 'activated' : 'deactivated'}`);
  } catch (err) {
    if ((err as Error).message?.startsWith('NEXT_REDIRECT')) throw err;
    redirect(
      '/admin/mentors?error=' + encodeURIComponent((err as Error).message),
    );
  }
}
