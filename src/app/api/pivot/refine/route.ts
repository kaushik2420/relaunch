import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { llm } from '@/lib/providers/llm';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Career-pivot refinement endpoint, used by the PivotPanel on the
 * preferences page. Two actions:
 *
 *   { action: 'clarify',    goal }            -> { questions: string[] }
 *   { action: 'synthesize', goal, qa: [...] } -> { refinedSummary, searchQuery, suggestedRoleFamily }
 *
 * Auth required — we don't want this Claude-backed endpoint open.
 */
export async function POST(req: NextRequest) {
  const sb = createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, goal, qa } = (body ?? {}) as {
    action?: string;
    goal?: string;
    qa?: { question: string; answer: string }[];
  };

  if (!goal || !goal.trim()) {
    return NextResponse.json(
      { error: 'Tell us a bit about the pivot you want first.' },
      { status: 400 },
    );
  }

  try {
    if (action === 'clarify') {
      const { questions } = await llm().pivotClarify({ goal: goal.trim() });
      return NextResponse.json({ questions });
    }

    if (action === 'synthesize') {
      const answered = (qa ?? []).filter((x) => x?.answer?.trim());
      if (answered.length === 0) {
        return NextResponse.json(
          { error: 'Answer the questions so we can build your plan.' },
          { status: 400 },
        );
      }
      const brief = await llm().pivotSynthesize({ goal: goal.trim(), qa: answered });
      return NextResponse.json(brief);
    }

    return NextResponse.json(
      { error: 'Unknown action — expected "clarify" or "synthesize".' },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
