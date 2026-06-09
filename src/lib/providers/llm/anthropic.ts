import Anthropic from '@anthropic-ai/sdk';
import { serverConfig } from '@/lib/config';
import type { LLMProvider } from './types';
import type {
  JobPosting,
  UserProfile,
  TailoredResume,
  PivotBrief,
  CoverLetter,
  BoostBrief,
} from '@/lib/types';
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
  // draftCoverLetter — a tailored cover letter for one job
  // ----------------------------------------------------------------
  async draftCoverLetter({
    profile,
    job,
    pivotBrief,
  }: {
    profile: UserProfile;
    job: JobPosting;
    pivotBrief?: PivotBrief;
  }): Promise<CoverLetter> {
    const pivotBlock = pivotBrief
      ? `\nCAREER PIVOT: This candidate is intentionally moving into a new kind of role. Their plan: "${pivotBrief.refinedSummary}". Frame the change as a deliberate, strength-based choice — connect their transferable experience to this role. Never apologize for the switch.`
      : '';

    const prompt = `Write a tailored cover letter for this job application.

CANDIDATE PROFILE (only use facts present here — never invent):
${JSON.stringify(profile, null, 2)}

TARGET JOB:
Company: ${job.company}
Role: ${job.title}
Description:
${job.description.slice(0, 3500)}${pivotBlock}

Output STRICT JSON:
{
  "greeting": string,      // e.g. "Dear ${job.company} Hiring Team,"
  "paragraphs": string[],  // exactly 3 body paragraphs
  "closing": string        // e.g. "Warm regards,"
}

Rules:
- 3 paragraphs, ~230-300 words total. Paragraph 1: why this role at this company, with a genuine hook. Paragraph 2: 2-3 concrete, relevant accomplishments from the profile that map to the job. Paragraph 3: a brief, forward-looking close.
- Warm, confident, specific. Never desperate, never generic filler.
- NEVER mention being laid off, "between roles", unemployment, or any gap. Write as a strong candidate.
- Use ONLY achievements the candidate actually claims. Keep all numbers exact.
- Plain prose — no bullet points, no markdown, no placeholders like [Company].`;

    const message = await this.client.messages.create({
      model: this.modelQuality,
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    });
    const out = extractJSON<CoverLetter>(message);
    return {
      greeting: (out.greeting ?? `Dear ${job.company} Hiring Team,`).trim(),
      paragraphs: (out.paragraphs ?? []).map((p) => p.trim()).filter(Boolean),
      closing: (out.closing ?? 'Warm regards,').trim(),
    };
  }

  // ----------------------------------------------------------------
  // embed — delegated to OpenAI (Anthropic has no embeddings API yet)
  // ----------------------------------------------------------------
  async embed(texts: string[]): Promise<number[][]> {
    const { embedWithOpenAI } = await import('./openai-embed');
    return embedWithOpenAI(texts);
  }

  // ----------------------------------------------------------------
  // verifyJobMatch — Haiku-powered last-mile fit check on the shortlist
  // ----------------------------------------------------------------
  async verifyJobMatch({
    profile,
    job,
    targetRoleFamily,
    pivotBrief,
  }: {
    profile: UserProfile;
    job: JobPosting;
    targetRoleFamily?: string;
    pivotBrief?: PivotBrief;
  }): Promise<{ score: number; reason: string }> {
    const familyLabel = targetRoleFamily
      ? ROLE_FAMILIES.find((r) => r.id === targetRoleFamily)?.label ?? null
      : null;
    const targetLine = pivotBrief?.searchQuery
      ? `Target (career pivot): "${pivotBrief.searchQuery}" — ${pivotBrief.refinedSummary}`
      : familyLabel
        ? `Target role family: ${familyLabel}`
        : `Current/last role from résumé: ${profile.experience?.[0]?.title ?? '(unknown)'}`;

    const prompt = `You are a strict filter for a job-search tool. Score how well a job posting actually matches what a candidate is looking for. Be HARSH on near-misses: e.g. a "Senior Backend Engineer" posting should score VERY LOW for a candidate targeting "Customer Success Manager", regardless of how prestigious the company is.

CANDIDATE:
${targetLine}
Recent role from résumé: ${profile.experience?.[0]?.title ?? '(unknown)'}
Top skills: ${(profile.skills ?? []).slice(0, 10).join(', ')}

JOB POSTING:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Description (first 1200 chars):
${(job.description ?? '').slice(0, 1200)}

Scoring rubric:
- 80–100: clearly the right kind of role and roughly the right level.
- 50–79: adjacent or partial match (right domain, wrong level, OR right level, wrong specialism).
- 20–49: wrong kind of role — applying would mostly waste the candidate's time.
- 0–19: completely off-topic.

Output STRICT JSON: { "score": <integer 0–100>, "reason": "<one short sentence>" }`;

    const message = await this.client.messages.create({
      model: this.modelFast,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    const out = extractJSON<{ score: number; reason: string }>(message);
    const score = Math.max(0, Math.min(100, Math.round(Number(out.score) || 0)));
    const reason = (out.reason ?? '').toString().slice(0, 240);
    return { score, reason };
  }

  // ----------------------------------------------------------------
  // generateBoostBrief — weekly LinkedIn coaching brief
  // ----------------------------------------------------------------
  async generateBoostBrief({
    profile,
    roleFamilyLabel,
    pivotBrief,
    searchQuery,
    weekStarting,
  }: {
    profile: UserProfile;
    roleFamilyLabel?: string;
    pivotBrief?: PivotBrief;
    searchQuery?: string;
    weekStarting: string;
  }): Promise<BoostBrief> {
    const targetLine = pivotBrief?.searchQuery
      ? `Target (career pivot): "${pivotBrief.searchQuery}" — ${pivotBrief.refinedSummary}`
      : searchQuery
        ? `Target keywords: ${searchQuery}`
        : roleFamilyLabel
          ? `Target role family: ${roleFamilyLabel}`
          : `Most recent role from résumé: ${profile.experience?.[0]?.title ?? '(unknown)'}`;

    const prompt = `You are the LinkedIn coaching layer of a job-search tool called Relaunch. Generate this week's brief for a candidate navigating a job search. Four things into their hands: one post they could write, one concrete profile move, two communities to consider, one timing tip.

CANDIDATE:
Name: ${profile.fullName}
${targetLine}
Most recent role: ${profile.experience?.[0]?.title ?? '(unknown)'}${profile.experience?.[0]?.company ? ` at ${profile.experience[0].company}` : ''}
Top skills: ${(profile.skills ?? []).slice(0, 8).join(', ')}
Location: ${profile.location ?? '(unknown)'}
Seniority: ${profile.seniority}

WEEK OF: ${weekStarting}

Output STRICT JSON matching this shape exactly:
{
  "postIdea": {
    "topic": "<one-line topic, 6-10 words>",
    "angle": "<the hook in one sentence — why this post is interesting>",
    "draftMarkdown": "<a 150-220 word LinkedIn post draft, first person, plain prose. Use ONLY facts from the candidate's profile. Be specific. End with one open question that invites comments. NO emojis, NO hashtags, NO 'I'm looking for opportunities / between roles / open to work' language. The goal is making the candidate look thoughtful and worth following — visibility comes from value, not from asking for a job.>"
  },
  "profileNudge": {
    "action": "<the one move this week, 6-12 words. Pick exactly one, and rotate variety across weeks: headline rewrite, About section rewrite, ask a specific past colleague for a recommendation, add missing core skills, add a Featured highlight, add a recent certification, customise URL, update banner, endorse 3 connections, etc.>",
    "how": "<2-3 sentences tailored to THIS candidate, on exactly how to do it. Be concrete — quote the headline they should consider, name who to ask for a recommendation, list which skills to add.>"
  },
  "groupSuggestions": [
    { "name": "<a real or realistic LinkedIn group name relevant to their role family and location>", "whyItFits": "<one short sentence>" },
    { "name": "<another, different angle (industry vs. role vs. local)>", "whyItFits": "<one short sentence>" }
  ],
  "timingTip": {
    "day": "<best day of the week to post for their industry — typically Tuesday/Wednesday/Thursday>",
    "timeWindow": "<best time window in their local timezone, e.g. '9:00-10:30 AM IST'>",
    "rationale": "<one short sentence>"
  }
}

Rules:
- Never invent facts about the candidate. Use only what's in the profile.
- The post must read like a real person thinking out loud, not marketing copy.
- The post must NOT mention layoffs, "between roles", or asking for a job.
- groupSuggestions: prefer names that genuinely exist on LinkedIn; pick groups that fit the role family AND geography.
- profileNudge.action: each week should feel different — rotate naturally based on the week date.`;

    const message = await this.client.messages.create({
      model: this.modelQuality,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    return extractJSON<BoostBrief>(message);
  }

  // ----------------------------------------------------------------
  // answerApplicationQuestion — freeform Q&A for application forms
  // ----------------------------------------------------------------
  async answerApplicationQuestion({
    profile,
    question,
    jobTitle,
    company,
    summary,
    coverLetterText,
  }: {
    profile: UserProfile;
    question: string;
    jobTitle: string;
    company: string;
    summary?: string | null;
    coverLetterText?: string | null;
  }): Promise<{ answer: string }> {
    const experienceLines = (profile.experience ?? [])
      .slice(0, 4)
      .map((e) => {
        const head = `- ${e.title} at ${e.company} (${e.from} – ${e.to})`;
        const bullets = (e.bullets ?? [])
          .slice(0, 3)
          .map((b) => `  • ${b}`)
          .join('\n');
        return bullets ? `${head}\n${bullets}` : head;
      })
      .join('\n');

    const tailoredContext = [
      summary ? `Tailored summary for this role:\n${summary}` : null,
      coverLetterText
        ? `The cover letter we drafted for this role (use as a voice/tone reference, NOT to copy):\n${coverLetterText}`
        : null,
    ]
      .filter(Boolean)
      .join('\n\n');

    const prompt = `You are helping a job applicant draft an honest, specific answer to an application question. Write in the candidate's voice — first person, plain prose, no marketing fluff. Cite a real experience from their profile. Connect the answer to THIS specific role and company.

CANDIDATE
Name: ${profile.fullName}
Seniority: ${profile.seniority}
Years of experience: ${profile.yearsExperience}
Location: ${profile.location ?? '(unknown)'}
Top skills: ${(profile.skills ?? []).slice(0, 12).join(', ')}

Recent experience:
${experienceLines || '(no detailed experience on file)'}

ROLE THEY'RE APPLYING TO
${jobTitle} at ${company}

${tailoredContext}

APPLICATION QUESTION
${question}

INSTRUCTIONS
- 150-250 words. 2-4 short paragraphs.
- First-person, conversational, no buzzwords or hype.
- Cite at least one specific experience or project from the profile. If the question asks for an example (e.g. "tell me about a time you…"), make it concrete.
- Connect explicitly to the job title or company where natural.
- If the candidate's profile doesn't directly cover what the question asks about (e.g. they haven't done X technology), be honest — frame transferable skills they DO have.
- Never invent experience or projects that aren't in the profile.
- Plain text only. No markdown, no headings, no bullet lists.
- Do not greet, do not sign off.

Now write the answer.`;

    const message = await this.client.messages.create({
      model: this.modelQuality,
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    const answer = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    return { answer };
  }

  // ----------------------------------------------------------------
  // smartFillForm — read form structure + return per-field values
  // ----------------------------------------------------------------
  async smartFillForm({
    profile,
    jobTitle,
    company,
    summary,
    coverLetterText,
    fields,
  }: {
    profile: UserProfile;
    jobTitle: string;
    company: string;
    summary?: string | null;
    coverLetterText?: string | null;
    fields: { id: string; type: string; label: string; placeholder?: string; required?: boolean; options?: string[]; hint?: string }[];
  }): Promise<{ values: Record<string, string | null> }> {
    if (fields.length === 0) return { values: {} };

    const experienceLines = (profile.experience ?? [])
      .slice(0, 4)
      .map((e) => {
        const head = `- ${e.title} at ${e.company} (${e.from} – ${e.to})`;
        const bullets = (e.bullets ?? []).slice(0, 3).map((b) => `  • ${b}`).join('\n');
        return bullets ? `${head}\n${bullets}` : head;
      })
      .join('\n');

    const fieldList = fields
      .map((f) => {
        const opts = f.options?.length ? `\n    options: [${f.options.slice(0, 30).map((o) => JSON.stringify(o)).join(', ')}]` : '';
        const hint = f.hint ? `\n    hint: ${f.hint}` : '';
        const req = f.required ? ' (required)' : '';
        const placeholder = f.placeholder ? `\n    placeholder: ${f.placeholder}` : '';
        return `  id: ${f.id}\n    type: ${f.type}${req}\n    label: ${f.label}${placeholder}${hint}${opts}`;
      })
      .join('\n');

    const tailoredContext = [
      summary ? `Tailored summary for this role:\n${summary}` : null,
      coverLetterText ? `Cover letter we drafted for this role (voice/tone reference):\n${coverLetterText}` : null,
    ]
      .filter(Boolean)
      .join('\n\n');

    const prompt = `You are filling out a job application form on behalf of a candidate. For each field, return the best value to put in it based on the candidate's profile and the job. If a field asks something you can't answer confidently from the profile, return null — never make up facts.

CANDIDATE
Name: ${profile.fullName}
Seniority: ${profile.seniority}
Years of experience: ${profile.yearsExperience}
Location: ${profile.location ?? '(unknown)'}
Email: ${profile.links?.email ?? '(unknown)'}
Phone: ${profile.links?.phone ?? '(unknown)'}
LinkedIn: ${profile.links?.linkedin ?? '(unknown)'}
GitHub: ${profile.links?.github ?? '(unknown)'}
Portfolio: ${profile.links?.portfolio ?? '(unknown)'}
Top skills: ${(profile.skills ?? []).slice(0, 15).join(', ')}

Recent experience:
${experienceLines || '(none)'}

ROLE
${jobTitle} at ${company}

${tailoredContext}

FORM FIELDS (fill these)
${fieldList}

RULES — read carefully:
- Output STRICT JSON with shape: { "values": { "<id>": "<value or null>", ... } }. One entry per field id above. No additional keys.
- For free-text / textarea fields like "Why are you interested?", "Cover letter", "Tell us about yourself": write 100-220 words in first person, citing a real experience from the profile. Plain text, no markdown.
- For select fields: return one of the listed options VERBATIM, or null if no option fits cleanly.
- For "current company" / "current employer": use the most recent company in the experience list.
- For "current job title" / "current title" / "current role": use the most recent title.
- For salary / current CTC / expected CTC / compensation / notice period / visa / sponsorship / availability date / EEO (race, gender, sex, disability, veteran, ethnicity): return null. These are personal decisions the candidate must answer themselves.
- For "are you authorized to work" / "do you require sponsorship": return null.
- For phone-format fields with country codes: include +91 if the profile phone is Indian; otherwise return as stored.
- Never invent skills, projects, employers, or dates not present in the candidate's profile.
- If unsure what a field is asking, return null.

Now output the JSON.`;

    const message = await this.client.messages.create({
      model: this.modelQuality,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const parsed = extractJSON<{ values: Record<string, string | null> }>(message);
    // Defensive: ensure we only return values for fields we asked about.
    const idSet = new Set(fields.map((f) => f.id));
    const filtered: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(parsed.values ?? {})) {
      if (idSet.has(k)) filtered[k] = v;
    }
    return { values: filtered };
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
