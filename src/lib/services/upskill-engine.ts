import Anthropic from '@anthropic-ai/sdk';
import { serverConfig } from '@/lib/config';
import type { UserProfile, UserPreferences } from '@/lib/types';
import { lookupCourses, genericSearchUrl, type Course } from './upskill-courses';

/**
 * Identify the 3-5 highest-leverage skill gaps for a candidate.
 * We use Claude directly (not the LLMProvider abstraction) because the
 * prompt is heavily structured and we want full control over output shape.
 *
 * IMPORTANT: We DO NOT ask Claude for course URLs — it would hallucinate.
 * Instead, Claude returns canonical skill names, and we map those to
 * a curated course catalog in upskill-courses.ts.
 */

export interface SkillGap {
  skill: string;
  why: string;                // 1-sentence rationale
  unlocksRolesPct: number;    // estimated % more roles unlocked (0-100)
  timeToLearn: string;        // human-readable, e.g. "4-6 hrs", "2 weeks"
  priority: 'must' | 'nice';
  courses: Course[];
  searchUrl: string;          // fallback if no curated courses match
}

export async function findSkillGaps(input: {
  profile: UserProfile;
  prefs: UserPreferences;
}): Promise<SkillGap[]> {
  const cfg = serverConfig();
  if (!cfg.ANTHROPIC_API_KEY) return [];

  const client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY });

  const prompt = `You are advising a job seeker on which skills to learn next to widen their job search.

CANDIDATE PROFILE:
- Name: ${input.profile.fullName}
- Seniority: ${input.profile.seniority}
- Years of experience: ${input.profile.yearsExperience}
- Current skills: ${(input.profile.skills ?? []).join(', ')}
- Recent roles: ${(input.profile.experience ?? [])
    .slice(0, 3)
    .map((e) => `${e.title} at ${e.company}`)
    .join('; ') || 'Unknown'}
- Headline: ${input.profile.headline ?? '(none)'}

TARGET PREFERENCES:
- Locations: ${input.prefs.locations.join(', ') || 'flexible'}
- Work modes: ${input.prefs.workModes.join(', ') || 'any'}
- Target salary: ${input.prefs.targetCtc ?? 'unspecified'}

Identify the 3-5 highest-leverage skills they're MISSING that would:
1. Be commonly required in their target seniority and role family
2. Be realistic to learn in 1-3 months
3. SPECIFICALLY widen the set of roles they'd qualify for (don't suggest skills they already list)

For each, return:
- "skill": short canonical name (1-3 words, lowercase preferred — e.g. "Mixpanel", "Kubernetes", "Generative AI", "Credit risk")
- "why": one sentence explaining WHY this gap matters for their target roles
- "unlocksRolesPct": rough estimate, integer 5-40, of how much more of the market they'd qualify for
- "timeToLearn": human-readable, e.g. "4-6 hrs", "2 weeks", "1 month"
- "priority": "must" if it's a common requirement in their target roles, "nice" if it's a stretch/differentiator

Output STRICT JSON: { "gaps": [ { ... }, { ... } ] }
No prose, no markdown fences. Just the JSON.`;

  const message = await client.messages.create({
    model: cfg.ANTHROPIC_MODEL_FAST,
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  // Tolerate fenced output
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: { gaps?: { skill: string; why: string; unlocksRolesPct: number; timeToLearn: string; priority: 'must' | 'nice' }[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return [];
    parsed = JSON.parse(match[0]);
  }
  const gaps = parsed.gaps ?? [];

  // Hydrate each gap with curated courses
  return gaps.map(
    (g): SkillGap => ({
      ...g,
      courses: lookupCourses(g.skill, 3),
      searchUrl: genericSearchUrl(g.skill),
    }),
  );
}
