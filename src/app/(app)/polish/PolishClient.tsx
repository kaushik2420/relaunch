"use client";
import { useState, useTransition } from "react";
import { analyseResumeAction, acceptRewriteAction } from "./actions";

interface OriginalBullet {
  experienceIndex: number;
  bulletIndex: number;
  role: string;
  company: string;
  text: string;
}

interface Feedback {
  experienceIndex: number;
  bulletIndex: number;
  original: string;
  feedback: string;
  suggested: string;
  isWeak: boolean;
  // Local UI state — has the user accepted the rewrite?
  accepted?: boolean;
}

export function PolishClient({
  initialBullets,
}: {
  initialBullets: OriginalBullet[];
}) {
  const [analysing, setAnalysing] = useState(false);
  const [analysed, setAnalysed] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [editedText, setEditedText] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  async function runAnalysis() {
    setAnalysing(true);
    setErrMsg(null);
    try {
      const res = await analyseResumeAction();
      setFeedback(res.bullets ?? []);
      // Seed editedText so users can tweak the suggestion before accepting.
      const seed: Record<string, string> = {};
      for (const b of res.bullets ?? []) {
        seed[keyOf(b)] = b.suggested;
      }
      setEditedText(seed);
      setAnalysed(true);
    } catch (err) {
      setErrMsg((err as Error).message);
    } finally {
      setAnalysing(false);
    }
  }

  function keyOf(b: { experienceIndex: number; bulletIndex: number }) {
    return `${b.experienceIndex}:${b.bulletIndex}`;
  }

  function handleAccept(b: Feedback) {
    const k = keyOf(b);
    const text = editedText[k]?.trim() || b.suggested;
    startTransition(async () => {
      try {
        await acceptRewriteAction(b.experienceIndex, b.bulletIndex, text);
        setFeedback((prev) =>
          prev.map((f) => (keyOf(f) === k ? { ...f, accepted: true, original: text } : f)),
        );
      } catch (err) {
        setErrMsg((err as Error).message);
      }
    });
  }

  if (!analysed) {
    return (
      <div className="card">
        <div className="text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-2xl">
            ✏️
          </div>
          <h2 className="text-xl font-bold">Ready when you are</h2>
          <p className="mt-2 text-sm text-ink-soft">
            We'll analyse each bullet and suggest rewrites in about 20
            seconds. Nothing on your résumé changes without your explicit
            click.
          </p>
          {errMsg && (
            <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
              {errMsg}
            </p>
          )}
          <button
            className="btn-primary mt-6"
            onClick={runAnalysis}
            disabled={analysing}
          >
            {analysing ? "Reading your résumé…" : "Analyse my résumé"}
          </button>
        </div>
      </div>
    );
  }

  const weakCount = feedback.filter((b) => b.isWeak && !b.accepted).length;
  const acceptedCount = feedback.filter((b) => b.accepted).length;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-50 px-4 py-3">
        <div className="text-sm">
          <strong>{weakCount}</strong>{" "}
          {weakCount === 1 ? "bullet" : "bullets"} could be stronger
          {acceptedCount > 0 && (
            <span className="text-ink-soft">
              {" · "}
              <strong>{acceptedCount}</strong> already improved
            </span>
          )}
        </div>
        <button
          className="btn-soft text-xs"
          onClick={runAnalysis}
          disabled={analysing}
        >
          Re-analyse
        </button>
      </div>

      {errMsg && (
        <p className="mb-4 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          {errMsg}
        </p>
      )}

      <div className="space-y-4">
        {feedback.map((b) => {
          const k = keyOf(b);
          const orig = initialBullets.find(
            (o) =>
              o.experienceIndex === b.experienceIndex &&
              o.bulletIndex === b.bulletIndex,
          );
          if (b.accepted) {
            return (
              <div key={k} className="rounded-xl border border-line bg-white p-4 opacity-70">
                <div className="text-xs uppercase tracking-wider text-success">
                  ✓ Rewrite accepted
                </div>
                <div className="mt-1 text-xs text-ink-mute">
                  {orig?.role} · {orig?.company}
                </div>
                <p className="mt-2 text-sm text-ink">{b.original}</p>
              </div>
            );
          }
          if (!b.isWeak) {
            return (
              <details key={k} className="rounded-xl border border-line bg-white px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-ink-soft">
                  Solid bullet — {orig?.role} · {orig?.company}
                </summary>
                <p className="mt-2 text-sm text-ink">{b.original}</p>
                <p className="mt-1 text-xs text-success">{b.feedback}</p>
              </details>
            );
          }
          return (
            <div key={k} className="rounded-xl border border-line bg-white p-4 shadow-card">
              <div className="text-xs text-ink-mute">
                {orig?.role} · {orig?.company}
              </div>
              <div className="mt-3">
                <div className="text-xs uppercase tracking-wider text-ink-mute">Current</div>
                <p className="mt-1 text-sm text-ink-soft">{b.original}</p>
              </div>
              <div className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
                {b.feedback}
              </div>
              <div className="mt-4">
                <div className="text-xs uppercase tracking-wider text-brand-700">
                  Suggested rewrite
                </div>
                <textarea
                  className="field mt-1 text-sm"
                  rows={3}
                  value={editedText[k] ?? ""}
                  onChange={(e) =>
                    setEditedText((prev) => ({ ...prev, [k]: e.target.value }))
                  }
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  className="btn-primary text-xs"
                  onClick={() => handleAccept(b)}
                  disabled={pending}
                >
                  {pending ? "Saving…" : "Accept rewrite"}
                </button>
                <button
                  className="btn-ghost text-xs text-ink-soft"
                  onClick={() =>
                    setFeedback((prev) =>
                      prev.map((f) => (keyOf(f) === k ? { ...f, isWeak: false } : f)),
                    )
                  }
                >
                  Skip
                </button>
                <button
                  className="btn-ghost text-xs text-ink-soft"
                  onClick={() =>
                    setEditedText((prev) => ({ ...prev, [k]: b.suggested }))
                  }
                >
                  Reset suggestion
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
