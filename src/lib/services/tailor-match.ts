import { llm } from '@/lib/providers/llm';
import { sheets } from '@/lib/providers/sheets';
import { findReferrers, buildConnectionsSearchUrl } from './referrer-finder';
import type {
  JobPosting,
  UserProfile,
  TailoredJobMatch,
  PivotBrief,
} from '@/lib/types';

/**
 * Tailor a single job for a candidate — the extracted version of the
 * per-match tailoring block that was inlined in daily-runner.
 *
 * Runs (in parallel where safe):
 *   - resume tailoring (Sonnet)
 *   - cover-letter drafting (Sonnet)
 *   - resume + cover-letter PDF/Doc creation on Drive (if we have a
 *     refresh token)
 *   - referrer lookup (Proxycurl or no-op)
 *   - InMail drafting
 *
 * Any single sub-step that fails is caught individually so the caller
 * still gets a partial match record. Only tailorResume itself is a
 * hard failure — if we can't tailor the résumé, there's no match to
 * hand back.
 *
 * Cost per call (Sonnet 4.6 rates): ~$0.08 for resume + cover + inmail.
 * Callers that want tighter budgets should cap how many jobs they
 * feed into this function.
 */
export async function tailorMatch(input: {
  profile: UserProfile;
  job: JobPosting;
  refreshToken: string | null;
  pivotBrief?: PivotBrief | null;
}): Promise<TailoredJobMatch> {
  const { profile, job, refreshToken, pivotBrief } = input;

  const [tailored, coverLetter] = await Promise.all([
    llm().tailorResume({ profile, job, pivotBrief: pivotBrief ?? undefined }),
    llm()
      .draftCoverLetter({ profile, job, pivotBrief: pivotBrief ?? undefined })
      .catch((err) => {
        console.error('[tailor-match] draftCoverLetter failed', err);
        return undefined;
      }),
  ]);

  let tailoredResumeUrl: string | undefined;
  let tailoredResumeDocUrl: string | undefined;
  let coverLetterUrl: string | undefined;
  let coverLetterDocUrl: string | undefined;

  if (refreshToken) {
    try {
      const r = await sheets().createTailoredResume({
        refreshToken,
        company: job.company,
        role: job.title,
        profile,
        tailored,
      });
      tailoredResumeUrl = r.pdfUrl;
      tailoredResumeDocUrl = r.docUrl;
    } catch (err) {
      console.error('[tailor-match] createTailoredResume failed', err);
    }
    if (coverLetter) {
      try {
        const c = await sheets().createCoverLetter({
          refreshToken,
          company: job.company,
          role: job.title,
          profile,
          letter: coverLetter,
        });
        coverLetterUrl = c.pdfUrl;
        coverLetterDocUrl = c.docUrl;
      } catch (err) {
        console.error('[tailor-match] createCoverLetter failed', err);
      }
    }
  }

  const connectionsSearchUrl = buildConnectionsSearchUrl({
    company: job.company,
    title: job.title,
  });

  let referrers: TailoredJobMatch['referrers'] = [];
  try {
    referrers = await findReferrers({ profile, job, limit: 2 });
  } catch (err) {
    console.error('[tailor-match] findReferrers failed', err);
  }

  let inmailDraft: TailoredJobMatch['inmailDraft'] | undefined;
  try {
    inmailDraft = await llm().draftInmail({
      profile,
      job,
      referrer: referrers[0],
    });
  } catch (err) {
    console.error('[tailor-match] draftInmail failed', err);
  }

  return {
    job,
    matchPercent: 0, // caller fills this in
    reasons: [],
    tailored,
    tailoredResumeUrl,
    tailoredResumeDocUrl,
    coverLetter,
    coverLetterUrl,
    coverLetterDocUrl,
    referrers,
    connectionsSearchUrl,
    inmailDraft,
  };
}
