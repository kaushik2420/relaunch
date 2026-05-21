import Anthropic from '@anthropic-ai/sdk';
import { serverConfig } from '@/lib/config';
import type { LLMProvider } from './types';
import type { JobPosting, UserProfile, TailoredResume, PivotBrief } from '@/lib/types';
import { ROLE_FAMILIES, ROLE_FAMILY_IDS } from '@/lib/role-families';

/**
 * Anthropic implementation of LLMProvider.
 *
 * Cost model (at the time of writing):
 *   Haiku: ~$1/M input tokens, $5/M output → ~$0.001 per resume parse
 *   Sonnet: ~$3/M input, $15/M output → ~$0.01 per tailored resume
 *
 * We use Haiku for parse/draft and Sonnet for tailoring (where quality
 * matters more). Embeddings: we use OpenAI for embeddings because
 * Anthropic doesn't ship an embeddings API yet — the embed() function
 * below is implemented separately in ./openai-embed.ts and re-exported here.
 */
export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private modelFast: string;
  private modelQuality: string;

  constructor() {
    const cfg = serverConfig();
    if (!cfg.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    this.client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY });
    this.modelFast = cfg.ANTHROPIC_MODEL_FAST;
    this.modelQuality = cfg.ANTHROPIC_MODEL_QUALITY;
  }

  // ----------------------------------------------------------------
  // parseResume
  // ----------------------------------------------------------------
  async parseResume({ textOrBase64, mime }: { textOrBase64: string; mime: string }): Promise<UserProfile> {
    const prompt = `Extract a candidate profile from this resume. Return STRICT JSON matching this shape:
{
  "fullName": string,
  "headline": string,            // one-line role+years summary
  "seniority": "junior"|"mid"|"senior"|"staff"|"principal",
  "yearsExperience": number,
  "location": string,
  "skills": string[],            // 8-20 items, deduped
  "experience": [{ "company": string, "title": string, "from": string, "to": string, "bullets": string[] }],
  "education": [{ "school": string, "degree": string, "year": string }],
  "links": { "linkedin"?: string, "github"?: string, "portfolio"?: string, "email"?: string, "phone"?: string }
}

Critical rules:
- Use ONLY facts present in the resume. Do not invent.
- Normalize seniority based on years + titles.
- Skills must be canonical (e.g. "JavaScript", not "JS").
- If unsure, omit the field rather than guess.`;

    const message = await this.client.messages.create({
      model: this.modelFast,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            mime.startsWith('image/')
              ? { type: 'image', source: { type: 'base64', media_type: mime as any, data: textOrBase64 } }
              : { type: 'text', text: `\n\n--- RESUME ---\n${textOrBase64}` },
          ],
        },
      ],
    });

    return extractJSON<UserProfile>(message);
  }

  // ----------------------------------------------------------------
  // tailorResume
  // ----------------------------------------------------------------
  async tailorResume({
    profile,
    job,
    pivotBrief,
  }: {
    profile: UserProfile;
    job: JobPosting;
    pivotBrief?: PivotBrief;
  }): Promise<TailoredResume> {
    // When the candidate is changing tracks, the resume must bridge
    // their real history to the NEW target — emphasize transferable
    // skills and reframe (never fabricate) accomplishments.
    const pivotBlock = pivotBrief
      ? `

CAREER PIVOT — IMPORTANT:
This candidate is intentionally switching career tracks. Their plan:
"${pivotBrief.refinedSummary}"

When tailoring:
- Lead the summary with the pivot intent and the transferable strengths that support it.
- Reframe past bullets to surface skills relevant to the target track (e.g. stakeholder management, analysis, leadership) — but do NOT invent titles, tools, or results they never had.
- It is fine to de-emphasize track-specific jargon from the old role.`
      : '';

    const prompt = `You are tailoring an existing resume for a target job.

CANDIDATE PROFILE (canonical truth — never invent beyond this):
${JSON.stringify(profile, null, 2)}

TARGET JOB:
Company: ${job.company}
Role: ${job.title}
Description:
${job.description.slice(0, 4000)}

Required JD keywords (lift these phrases when factually supported):
${(job.keywords ?? []).join(', ')}${pivotBlock}

Output STRICT JSON:
{
  "summary": string,            // 2-3 sentence top-of-resume summary tuned to this job
  "highlightedSkills": string[],// max 8, ordered by relevance to the JD
  "experienceBullets": [        // re-ordered + re-emphasized bullets per role
    { "company": string, "title": string, "bullets": string[] }
  ],
  "rationale": string,          // 1-2 sentences: WHY we tailored this way
  "removedSections": string[]   // sections dropped (be honest)
}

Rules:
- NEVER add a skill, role, or accomplishment the candidate doesn't claim.
- You may re-order, re-word for clarity, and lift JD vocabulary IF it accurately describes work the candidate did.
- Keep all numbers exactly as given in the source.`;

    const message = await this.client.messages.create({
      model: this.modelQuality,
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    });

    return extractJSON<TailoredResume>(message);
  }

  // ----------------------------------------------------------------
  // pivotClarify — 2 sharp follow-up questions for a career pivot
  // ----------------------------------------------------------------
  async pivotClarify({ goal }: { goal: string }): Promise<{ questions: string[] }> {
    const prompt = `A job seeker wants to PIVOT their career. Here's how they describe the change they want:

"${goal}"

Ask EXACTLY 2 short, specific follow-up questions that would most help us find the right jobs for them. Good questions probe things like: the exact target role/level, which of their existing strengths they want to lean on, industry preference, or any hard constraints. Keep each question under 20 words, friendly and plain.

Output STRICT JSON: { "questions": [string, string] }`;

    const message = await this.client.messages.create({
      model: this.modelFast,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    const out = extractJSON<{ questions: string[] }>(message);
    return { questions: (out.questions ?? []).slice(0, 2) };
  }

  // ----------------------------------------------------------------
  // pivotSynthesize — turn goal + answers into a concrete search brief
  // ----------------------------------------------------------------
  async pivotSynthesize({
    goal,
    qa,
  }: {
    goal: string;
    qa: { question: string; answer: string }[];
  }): Promise<{ refinedSummary: string; searchQuery: string; suggestedRoleFamily: string | null }> {
    const familyList = ROLE_FAMILIES.map((r) => `${r.id} — ${r.label}`).join('\n');
    const qaText = qa.map((x) => `Q: ${x.question}\nA: ${x.answer}`).join('\n\n');

    const prompt = `A job seeker is pivoting careers. Synthesize a concrete job-search brief.

THEIR GOAL:
"${goal}"

THEIR ANSWERS TO OUR QUESTIONS:
${qaText}

VALID ROLE FAMILIES (pick the single best-fit id, or null if truly none fit):
${familyList}

Output STRICT JSON:
{
  "refinedSummary": string,       // 2-3 warm, encouraging sentences describing the pivot plan, addressed to the user ("You're moving toward...")
  "searchQuery": string,          // a SHORT keyword phrase (2-4 words, under 40 chars) to feed job-search APIs, e.g. "Product Manager"
  "suggestedRoleFamily": string   // one id from the list above, or null
}

Rules:
- searchQuery must be plain role keywords only — no seniority words, no company names.
- suggestedRoleFamily MUST be one of the exact ids listed, or the JSON literal null.`;

    const message = await this.client.messages.create({
      model: this.modelQuality,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });
    const out = extractJSON<{
      refinedSummary: string;
      searchQuery: string;
      suggestedRoleFamily: string | null;
    }>(message);

    // Validate the role family against our registry — never trust the model blindly.
    const rf =
      out.suggestedRoleFamily && ROLE_FAMILY_IDS.has(out.suggestedRoleFamily)
        ? out.suggestedRoleFamily
        : null;

    return {
      refinedSummary: (out.refinedSummary ?? '').trim(),
      searchQuery: (out.searchQuery ?? '').trim().slice(0, 40),
      suggestedRoleFamily: rf,
    };
  }

  // ----------------------------------------------------------------
  // draftInmail
  // ----------------------------------------------------------------
  async draftInmail({
    profile,
    job,
    referrer,
  }: {
    profile: UserProfile;
    job: JobPosting;
    referrer?: { name: string; role: string; sharedContext?: string };
  }): Promise<{ subject: string; body: string }> {
    const recipientLine = referrer
      ? `Write a short, warm LinkedIn InMail from ${profile.fullName} to ${referrer.name} (${referrer.role}).`
      : `Write a short, warm cold outreach message from ${profile.fullName} to a generic hiring contact at ${job.company} (we don't know a specific name).`;

    const contextLine = referrer?.sharedContext
      ? `Shared context with the recipient: ${referrer.sharedContext}`
      : !referrer
      ? `Since we don't have a specific name, address it to "Hi there" (no "Hi Hiring Team" — too corporate).`
      : '';

    const prompt = `${recipientLine}

Context: ${profile.fullName} is exploring after a layoff. The user is applying to ${job.title} at ${job.company}.
${contextLine}

Rules:
- Max 130 words.
- Warm, specific, never desperate.
- ${referrer ? 'Open with the shared context if present, otherwise with a clear, honest reason for reaching out.' : 'Open with a clear, honest reason for reaching out about this specific role.'}
- Ask for 15 minutes of their perspective — NOT a referral${referrer ? '' : ' or a job'}.
- Close with one line that respects their time.

Output STRICT JSON: { "subject": string, "body": string }`;

    const message = await this.client.messages.create({
      model: this.modelFast,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });

    return extractJSON<{ subject: string; body: string }>(message);
  }

  // ----------------------------------------------------------------
  // embed — delegated to OpenAI (Anthropic has no embeddings API yet)
  // ----------------------------------------------------------------
  async embed(texts: string[]): Promise<number[][]> {
    const { embedWithOpenAI } = await import('./openai-embed');
    return embedWithOpenAI(texts);
  }
}

/**
 * Pulls the JSON block from a Claude response, robust to ```json fences
 * and leading prose. Throws on totally bad output (caller may retry).
 */
function extractJSON<T>(message: Anthropic.Message): T {
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  // strip optional fences
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  // try whole-string parse first
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // fall back: first {...} block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('LLM returned no JSON: ' + cleaned.slice(0, 200));
    return JSON.parse(match[0]) as T;
  }
}
