/**
 * The LLM interface. EVERYTHING that touches an LLM goes through this.
 * Swap providers by:
 *   1. Implement this interface in a new file (e.g. openai.ts)
 *   2. Wire it up in ./index.ts
 *   3. Set LLM_PROVIDER=<your-name> in env. Done.
 *
 * No business logic in implementations — they're thin wrappers.
 * Prompts live in /src/lib/services where context is clearer.
 */

import type {
  JobPosting,
  UserProfile,
  TailoredResume,
  PivotBrief,
  CoverLetter,
  BoostBrief,
} from '@/lib/types';

export interface LLMProvider {
  /** Returns structured JSON; must NOT invent skills/facts. */
  parseResume(input: { textOrBase64: string; mime: string }): Promise<UserProfile>;

  /**
   * Tailors an existing resume for a target job. Allowed to reorder +
   * emphasize, never invent. When pivotBrief is supplied the candidate
   * is switching career tracks — reframe transferable experience toward
   * the target role (still without fabricating).
   */
  tailorResume(input: {
    profile: UserProfile;
    job: JobPosting;
    pivotBrief?: PivotBrief;
  }): Promise<TailoredResume>;

  /**
   * Career-pivot step 1: given the user's free-text pivot goal, return
   * exactly 2 short clarifying questions that sharpen the job search.
   */
  pivotClarify(input: { goal: string }): Promise<{ questions: string[] }>;

  /**
   * Career-pivot step 2: given the goal + the user's answers, synthesize
   * a search brief — a human-readable summary, a short keyword query for
   * the job APIs, and a best-fit role-family id (or null).
   */
  pivotSynthesize(input: {
    goal: string;
    qa: { question: string; answer: string }[];
  }): Promise<{ refinedSummary: string; searchQuery: string; suggestedRoleFamily: string | null }>;

  /** Generates a personalized InMail. Tone must be warm, not salesy.
   *  If no referrer is provided, generates a cold outreach to a generic
   *  "Hiring Team" — useful when referrer lookup is unavailable. */
  draftInmail(input: {
    profile: UserProfile;
    job: JobPosting;
    referrer?: { name: string; role: string; sharedContext?: string };
  }): Promise<{ subject: string; body: string }>;

  /**
   * Drafts a tailored cover letter for a specific job. Warm, confident,
   * specific — never desperate, and never mentions a layoff. When
   * pivotBrief is supplied, frames the career change as intentional.
   */
  draftCoverLetter(input: {
    profile: UserProfile;
    job: JobPosting;
    pivotBrief?: PivotBrief;
  }): Promise<CoverLetter>;

  /** Embeds text for similarity matching. Cheap, batched. */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * Strict verifier — given a candidate's target direction and a single
   * job posting, score 0–100 how well the job actually matches what the
   * candidate wants. Used as a cheap last-mile filter on the shortlist,
   * so we never spend Sonnet tokens tailoring an obvious mismatch.
   */
  verifyJobMatch(input: {
    profile: UserProfile;
    job: JobPosting;
    targetRoleFamily?: string;
    pivotBrief?: PivotBrief;
  }): Promise<{ score: number; reason: string }>;

  /**
   * Generate this week's LinkedIn coaching brief — one tailored post
   * idea, one profile-improvement nudge, two community suggestions, and
   * a timing tip. Personalised from the candidate's résumé + target.
   */
  generateBoostBrief(input: {
    profile: UserProfile;
    roleFamilyLabel?: string;
    pivotBrief?: PivotBrief;
    searchQuery?: string;
    weekStarting: string;
  }): Promise<BoostBrief>;
}
