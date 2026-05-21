'use client';
import { useState } from 'react';
import type { PivotBrief } from '@/lib/types';

/**
 * Career-pivot panel for the preferences page.
 *
 * Off by default — when off, the app searches around the user's existing
 * experience exactly as before. When on, the user describes the pivot
 * they want, Claude asks 2 clarifying questions, and we synthesize a
 * search brief that drives both job search and resume tailoring.
 *
 * Lives INSIDE the preferences <form>, so the hidden inputs below get
 * submitted to savePreferencesAction alongside everything else.
 */
export function PivotPanel({
  initialEnabled,
  initialBrief,
}: {
  initialEnabled: boolean;
  initialBrief: PivotBrief | null;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [goal, setGoal] = useState(initialBrief?.goal ?? '');
  const [questions, setQuestions] = useState<string[]>(
    initialBrief?.qa.map((x) => x.question) ?? [],
  );
  const [answers, setAnswers] = useState<string[]>(
    initialBrief?.qa.map((x) => x.answer) ?? [],
  );
  const [brief, setBrief] = useState<{
    refinedSummary: string;
    searchQuery: string;
    suggestedRoleFamily: string | null;
  } | null>(
    initialBrief
      ? {
          refinedSummary: initialBrief.refinedSummary,
          searchQuery: initialBrief.searchQuery,
          suggestedRoleFamily: initialBrief.suggestedRoleFamily,
        }
      : null,
  );
  const [busy, setBusy] = useState<'clarify' | 'synthesize' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The JSON we hand to the server. Only meaningful once synthesized.
  const briefJson =
    brief && questions.length
      ? JSON.stringify({
          goal: goal.trim(),
          qa: questions.map((q, i) => ({ question: q, answer: answers[i] ?? '' })),
          refinedSummary: brief.refinedSummary,
          searchQuery: brief.searchQuery,
          suggestedRoleFamily: brief.suggestedRoleFamily,
        } satisfies PivotBrief)
      : '';

  async function refine() {
    if (!goal.trim()) {
      setError('Describe the pivot you want first.');
      return;
    }
    setError(null);
    setBusy('clarify');
    setBrief(null);
    try {
      const res = await fetch('/api/pivot/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clarify', goal: goal.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not refine right now.');
      const qs: string[] = data.questions ?? [];
      setQuestions(qs);
      setAnswers(qs.map(() => ''));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function synthesize() {
    if (answers.some((a) => !a.trim())) {
      setError('Answer both questions so we can build your plan.');
      return;
    }
    setError(null);
    setBusy('synthesize');
    try {
      const res = await fetch('/api/pivot/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'synthesize',
          goal: goal.trim(),
          qa: questions.map((q, i) => ({ question: q, answer: answers[i] ?? '' })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not build your plan right now.');
      setBrief({
        refinedSummary: data.refinedSummary,
        searchQuery: data.searchQuery,
        suggestedRoleFamily: data.suggestedRoleFamily ?? null,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface-muted/40 p-4">
      {/* Hidden fields submitted with the preferences form */}
      <input type="hidden" name="pivotEnabled" value={enabled ? 'true' : 'false'} />
      <input type="hidden" name="pivotBrief" value={briefJson} />

      <label className="flex cursor-pointer items-start gap-3">
        <span className="relative mt-0.5 inline-block h-6 w-11 shrink-0">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="peer sr-only"
          />
          <span className="absolute inset-0 rounded-full bg-line transition peer-checked:bg-brand-500" />
          <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
        </span>
        <span>
          <span className="font-semibold">I'm looking to pivot into a different kind of role</span>
          <span className="mt-0.5 block text-xs text-ink-soft">
            Switching tracks — not just more of what your resume already shows. We'll search and tailor toward the new direction.
          </span>
        </span>
      </label>

      {enabled && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="label" htmlFor="pivotGoal">
              Describe the pivot you're hoping for
            </label>
            <textarea
              id="pivotGoal"
              rows={3}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="input"
              placeholder="e.g. I've been a backend engineer for 6 years but I want to move into product management — I love working with users and shaping what we build."
            />
          </div>

          {questions.length === 0 && (
            <button
              type="button"
              onClick={refine}
              disabled={busy !== null}
              className="btn-soft text-sm"
            >
              {busy === 'clarify' ? 'Thinking…' : '✨ Refine with AI'}
            </button>
          )}

          {questions.length > 0 && (
            <div className="space-y-3 rounded-lg border border-line bg-surface p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
                A couple of quick questions
              </p>
              {questions.map((q, i) => (
                <div key={i}>
                  <label className="label">{q}</label>
                  <input
                    value={answers[i] ?? ''}
                    onChange={(e) => {
                      const next = [...answers];
                      next[i] = e.target.value;
                      setAnswers(next);
                    }}
                    className="input"
                    placeholder="Your answer…"
                  />
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={synthesize}
                  disabled={busy !== null}
                  className="btn-primary text-sm"
                >
                  {busy === 'synthesize' ? 'Building your plan…' : 'Build my pivot plan →'}
                </button>
                <button
                  type="button"
                  onClick={refine}
                  disabled={busy !== null}
                  className="btn-soft text-sm"
                >
                  ↻ New questions
                </button>
              </div>
            </div>
          )}

          {brief && (
            <div className="rounded-lg border border-brand-500/30 bg-brand-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">
                Your pivot plan
              </p>
              <p className="mt-1 text-sm">{brief.refinedSummary}</p>
              <p className="mt-2 text-xs text-ink-soft">
                We'll search for roles like <strong>{brief.searchQuery}</strong> and tailor every
                resume toward this direction. Edit your description above and re-refine anytime.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
