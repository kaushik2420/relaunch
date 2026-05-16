import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { EmpathyBanner } from '@/components/EmpathyBanner';
import { Stepper } from '@/components/Stepper';
import { ResumeUploader } from './ResumeUploader';
import type { UserProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: row } = await sb
    .from('users')
    .select('profile')
    .eq('id', user.id)
    .single();

  const existing = (row?.profile ?? null) as UserProfile | null;
  const isReplacing = !!(existing && Object.keys(existing).length > 0);

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Stepper step={1} />

      {/* First-time upload vs replacing-an-existing one — two empathy tones */}
      <div className="mb-6">
        {isReplacing ? (
          <EmpathyBanner icon="✏️" title="Updating your resume.">
            We'll re-extract your skills and experience. Your past matches and Google Sheet stay safe —
            only future matches will use the new profile.
          </EmpathyBanner>
        ) : (
          <EmpathyBanner title="You're not starting from zero — you're starting from experience.">
            Your resume already tells your story. We'll just learn it so we can find the right roles for you.
          </EmpathyBanner>
        )}
      </div>

      <div className="card">
        <h1 className="text-2xl font-bold">
          {isReplacing ? 'Replace your resume' : "Let's start with your resume"}
        </h1>
        {isReplacing && existing && (
          <p className="mt-1 text-sm text-ink-soft">
            Current profile: <strong>{existing.fullName}</strong> · {existing.seniority} ·{' '}
            {(existing.skills ?? []).length} skills
          </p>
        )}
        {!isReplacing && (
          <p className="mt-1 text-sm text-ink-soft">
            Upload it once. We'll never store the file on our servers — only the text we extract,
            which you'll review on the next screen.
          </p>
        )}

        <ResumeUploader />

        <p className="mt-4 text-center text-xs text-ink-mute">
          🔒 Processed in-memory. The original file is discarded after parsing.
        </p>

        {isReplacing && (
          <p className="mt-3 text-center text-xs">
            <Link href="/settings" className="text-ink-soft underline hover:text-ink">
              ← Back to settings
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
