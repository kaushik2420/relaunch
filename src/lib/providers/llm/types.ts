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

import type { JobPosting, UserProfile, TailoredResume } from '@/lib/types';

export interface LLMProvider {
  /** Returns structured JSON; must NOT invent skills/facts. */
  parseResume(input: { textOrBase64: string; mime: string }): Promise<UserProfile>;

  /** Tailors an existing resume for a target job. Allowed to reorder + emphasize, never invent. */
  tailorResume(input: {
    profile: UserProfile;
    job: JobPosting;
  }): Promise<TailoredResume>;

  /** Generates a personalized InMail. Tone must be warm, not salesy. */
  draftInmail(input: {
    profile: UserProfile;
    job: JobPosting;
    referrer: { name: string; role: string; sharedContext?: string };
  }): Promise<{ subject: string; body: string }>;

  /** Embeds text for similarity matching. Cheap, batched. */
  embed(texts: string[]): Promise<number[][]>;
}
