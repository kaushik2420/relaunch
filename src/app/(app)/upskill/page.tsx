import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { EmpathyBanner } from '@/components/EmpathyBanner';
import { findSkillGaps, type SkillGap } from '@/lib/services/upskill-engine';
import type { UserProfile, UserPreferences } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function UpskillPage() {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: row } = await sb
    .from('users')
    .select('profile, locations, work_modes, target_ctc, phone, notice_period, notes, email_frequency, email_time, timezone')
    .eq('id', user.id)
    .single();

  const profile = (row?.profile ?? null) as UserProfile | null;
  const hasProfile = profile && Object.keys(profile).length > 0;

  let gaps: SkillGap[] = [];
  let analysisError: string | null = null;
  if (hasProfile) {
    const prefs: UserPreferences = {
      locations: row?.locations ?? [],
      workModes: (row?.work_modes ?? []) as UserPreferences['workModes'],
      targetCtc: row?.target_ctc ?? undefined,
      phone: row?.phone ?? undefined,
      noticePeriod: row?.notice_period ?? undefined,
      notes: row?.notes ?? undefined,
      emailFrequency: (row?.email_frequency ?? 'daily') as UserPreferences['emailFrequency'],
      emailTime: row?.email_time ?? '08:30',
      timezone: row?.timezone ?? 'Asia/Kolkata',
    };
    try {
      gaps = await findSkillGaps({ profile: profile!, prefs });
    } catch (e) {
      analysisError = (e as Error).message;
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-3xl font-bold">Skills that could widen your search</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Picked for you based on your profile and the roles you're targeting. Each one estimates roughly how many more roles you'd qualify for after learning it.
      </p>

      <div className="mt-5">
        <EmpathyBanner icon="🌟" title="You're already enough.">
          These suggestions are about widening the net — not about being "not enough." Your current skills already put you in the running for plenty.
        </EmpathyBanner>
      </div>

      {!hasProfile && (
        <div className="mt-6 card">
          <h2 className="font-semibold">Upload your resume first</h2>
          <p className="mt-2 text-sm text-ink-soft">
            We need to see your current skills before we can spot the gaps.{' '}
            <a href="/onboarding/upload" className="text-brand-700 underline">Upload your resume →</a>
          </p>
        </div>
      )}

      {analysisError && (
        <div className="mt-6 card border-warn/30 bg-warn-soft">
          <p className="text-sm">
            <strong>We couldn't analyse your profile right now.</strong> Usually this clears on retry.
            <br />
            <span className="text-xs text-ink-soft">Details: {analysisError}</span>
          </p>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="mt-6 space-y-4">
          {gaps.map((g, i) => (
            <SkillCard key={i} gap={g} />
          ))}
        </div>
      )}

      {hasProfile && !analysisError && gaps.length === 0 && (
        <div className="mt-6 card">
          <p className="text-sm">
            We didn't find any meaningful gaps right now — your profile already covers the common requirements for your target roles. Worth focusing on applications and outreach instead.
          </p>
        </div>
      )}
    </div>
  );
}

function SkillCard({ gap }: { gap: SkillGap }) {
  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{titleize(gap.skill)}</h2>
          <p className="mt-1 text-sm text-ink-soft">{gap.why}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {gap.priority === 'must' ? (
            <span className="chip">Must-have</span>
          ) : (
            <span className="chip-accent">Nice-to-have</span>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-soft">
        <span>🔍 Unlocks ~{gap.unlocksRolesPct}% more roles</span>
        <span>⏱ {gap.timeToLearn}</span>
      </div>

      <div className="mt-4">
        <h3 className="text-xs uppercase tracking-wider text-ink-soft mb-2">Recommended</h3>
        {gap.courses.length > 0 ? (
          <ul className="space-y-2">
            {gap.courses.map((c, i) => (
              <li key={i} className="text-sm">
                <a href={c.url} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">
                  {c.title}
                </a>{' '}
                <span className="text-ink-soft">
                  · {c.provider} · {c.duration} · {c.cost}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <a
            href={gap.searchUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-brand-700 hover:underline"
          >
            Browse {gap.skill} courses on Coursera →
          </a>
        )}
      </div>
    </div>
  );
}

function titleize(s: string): string {
  return s
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
