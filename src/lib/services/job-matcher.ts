import type { JobPosting, UserProfile, UserPreferences } from '@/lib/types';
import { llm } from '@/lib/providers/llm';

/**
 * Rank jobs for a user using embedding similarity + hard filters.
 * Cheap: one embedding per user (cached upstream), one per JD.
 */
export async function rankJobs(
  jobs: JobPosting[],
  profile: UserProfile,
  prefs: UserPreferences
): Promise<{ job: JobPosting; matchPercent: number; reasons: string[] }[]> {
  if (!jobs.length) return [];

  // Hard filters first — cheap and removes most noise
  const filtered = jobs.filter((j) => passesFilters(j, prefs));
  if (!filtered.length) return [];

  const profileText = profileToEmbeddingText(profile);
  const jobTexts = filtered.map((j) => `${j.title}\n${j.description.slice(0, 1500)}`);

  const [profileVec, ...jobVecs] = await llm().embed([profileText, ...jobTexts]);

  return filtered
    .map((job, i) => {
      const score = cosine(profileVec!, jobVecs[i]!);
      const matchPercent = Math.round(score * 100);
      const reasons = explainMatch(job, profile, score);
      return { job, matchPercent, reasons };
    })
    .sort((a, b) => b.matchPercent - a.matchPercent);
}

function passesFilters(j: JobPosting, prefs: UserPreferences): boolean {
  if (prefs.workModes.length && !prefs.workModes.includes('any')) {
    if (j.workMode !== 'unknown' && !prefs.workModes.includes(j.workMode)) return false;
  }
  if (prefs.locations.length) {
    const haystack = j.location.toLowerCase();
    const hit = prefs.locations.some((loc) => {
      const l = loc.toLowerCase();
      return l === 'remote' ? /remote/.test(haystack) : haystack.includes(l);
    });
    if (!hit && j.workMode !== 'remote') return false;
  }
  return true;
}

function profileToEmbeddingText(p: UserProfile): string {
  const exp = p.experience.slice(0, 3).map((e) => `${e.title} at ${e.company}: ${e.bullets.slice(0, 3).join(' ')}`).join('\n');
  return [p.headline, `Skills: ${p.skills.join(', ')}`, exp].filter(Boolean).join('\n');
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function explainMatch(job: JobPosting, profile: UserProfile, score: number): string[] {
  const reasons: string[] = [];
  const jdLower = job.description.toLowerCase();
  const hits = profile.skills.filter((s) => jdLower.includes(s.toLowerCase()));
  if (hits.length) reasons.push(`Skill overlap: ${hits.slice(0, 4).join(', ')}`);
  if (score > 0.78) reasons.push('Strong semantic match with your recent roles');
  if (/remote/i.test(job.location)) reasons.push('Fully remote');
  return reasons;
}
