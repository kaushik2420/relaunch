"use client";
import { useMemo, useState, useTransition } from "react";
import posthog from "posthog-js";
import {
  analyseResumeAction,
  acceptRewriteAction,
  loadPolishSessionAction,
  type PolishFeedback,
  type PolishSession,
  type PolishSessionSummary,
} from "./actions";

interface OriginalBullet {
  experienceIndex: number;
  bulletIndex: number;
  role: string;
  company: string;
  text: string;
}

/**
 * Client component for /polish.
 *
 * Behaviour:
 *  - If the server hydrated us with a session (initialSession), we
 *    render straight into the analysed view — no re-run.
 *  - The "Version history" panel lists the 5 most recent sessions.
 *    Only the CURRENT session (viewingSessionId === latestSessionId)
 *    is interactive; older versions load in read-only mode with a
 *    "Load current" banner.
 *  - Regenerate spawns a new session; if the user was viewing an old
 *    version, they're returned to the fresh current one automatically.
 */
export function PolishClient({
  initialBullets,
  initialSessions,
  initialSession,
}: {
  initialBullets: OriginalBullet[];
  initialSessions: PolishSessionSummary[];
  initialSession: PolishSession | null;
}) {
  const [sessions, setSessions] = useState<PolishSessionSummary[]>(initialSessions);
  const [activeSession, setActiveSession] = useState<PolishSession | null>(initialSession);
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(
    initialSession?.id ?? null,
  );

  const [analysing, setAnalysing] = useState(false);
  const [loadingVersion, setLoadingVersion] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [editedText, setEditedText] = useState<Record<string, string>>(() =>
    seedEditsFromSession(initialSession),
  );
  const [pending, startTransition] = useTransition();

  const [batchAccepting, setBatchAccepting] = useState<{
    running: boolean;
    done: number;
    total: number;
  }>({ running: false, done: 0, total: 0 });

  const latestSessionId = sessions[0]?.id ?? null;
  const isViewingLatest = viewingSessionId === latestSessionId;
  const isReadOnly = !isViewingLatest && activeSession !== null;

  const feedback = activeSession?.feedback ?? [];
  const weakCount = feedback.filter((b) => b.isWeak && !b.accepted).length;
  const acceptedCount = feedback.filter((b) => b.accepted).length;

  function keyOf(b: { experienceIndex: number; bulletIndex: number }) {
    return `${b.experienceIndex}:${b.bulletIndex}`;
  }

  async function runAnalysis() {
    setAnalysing(true);
    setErrMsg(null);
    // Feature-adoption signal. Fires on both first analysis and every
    // regenerate — the property distinguishes them.
    posthog.capture("polish_analyse_started", {
      is_regeneration: sessions.length > 0,
      total_prior_sessions: sessions.length,
    });
    try {
      const session = await analyseResumeAction();
      setActiveSession(session);
      setViewingSessionId(session.id);
      setEditedText(seedEditsFromSession(session));
      setSessions((prev) => {
        const summary: PolishSessionSummary = {
          id: session.id,
          createdAt: session.createdAt,
          totalBullets: session.totalBullets,
          weakBullets: session.weakBullets,
          acceptedCount: session.acceptedCount,
        };
        return [summary, ...prev].slice(0, 5);
      });
    } catch (err) {
      setErrMsg((err as Error).message);
    } finally {
      setAnalysing(false);
    }
  }

  async function loadVersion(sessionId: string) {
    if (sessionId === viewingSessionId) return;
    setLoadingVersion(sessionId);
    setErrMsg(null);
    try {
      const s = await loadPolishSessionAction(sessionId);
      if (!s) {
        setErrMsg("That version is no longer available.");
        return;
      }
      setActiveSession(s);
      setViewingSessionId(s.id);
      setEditedText(seedEditsFromSession(s));
    } catch (err) {
      setErrMsg((err as Error).message);
    } finally {
      setLoadingVersion(null);
    }
  }

  function handleAccept(b: PolishFeedback) {
    if (isReadOnly || !activeSession) return;
    const k = keyOf(b);
    const text = editedText[k]?.trim() || b.suggested;
    startTransition(async () => {
      try {
        await acceptRewriteAction(
          activeSession.id,
          b.experienceIndex,
          b.bulletIndex,
          text,
        );
        setActiveSession((prev) =>
          !prev
            ? prev
            : {
                ...prev,
                acceptedCount: prev.acceptedCount + 1,
                feedback: prev.feedback.map((f) =>
                  keyOf(f) === k ? { ...f, accepted: true, original: text } : f,
                ),
              },
        );
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id
              ? { ...s, acceptedCount: s.acceptedCount + 1 }
              : s,
          ),
        );
      } catch (err) {
        setErrMsg((err as Error).message);
      }
    });
  }

  async function handleAcceptAll() {
    if (isReadOnly || !activeSession) return;
    const targets = activeSession.feedback.filter((b) => b.isWeak && !b.accepted);
    if (targets.length === 0) return;
    if (
      !window.confirm(
        `Accept all ${targets.length} suggested rewrites? You can still edit each bullet in the résumé later.`,
      )
    ) {
      return;
    }
    setBatchAccepting({ running: true, done: 0, total: targets.length });
    setErrMsg(null);
    let done = 0;
    for (const b of targets) {
      const k = keyOf(b);
      const text = editedText[k]?.trim() || b.suggested;
      try {
        await acceptRewriteAction(
          activeSession.id,
          b.experienceIndex,
          b.bulletIndex,
          text,
        );
        setActiveSession((prev) =>
          !prev
            ? prev
            : {
                ...prev,
                acceptedCount: prev.acceptedCount + 1,
                feedback: prev.feedback.map((f) =>
                  keyOf(f) === k ? { ...f, accepted: true, original: text } : f,
                ),
              },
        );
        done += 1;
        setBatchAccepting({ running: true, done, total: targets.length });
      } catch (err) {
        setErrMsg(
          `Accepted ${done} of ${targets.length} before hitting an error: ${
            (err as Error).message
          }`,
        );
        break;
      }
    }
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id ? { ...s, acceptedCount: s.acceptedCount + done } : s,
      ),
    );
    setBatchAccepting({ running: false, done: 0, total: 0 });
  }

  // Empty state — no session on file yet.
  if (!activeSession) {
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

  return (
    <div>
      <VersionHistoryPanel
        sessions={sessions}
        viewingSessionId={viewingSessionId}
        latestSessionId={latestSessionId}
        analysing={analysing}
        loadingVersion={loadingVersion}
        onLoad={loadVersion}
        onRegenerate={runAnalysis}
      />

      {isReadOnly && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-cream-100 px-4 py-3">
          <div className="text-sm text-ink-soft">
            <strong>Viewing a past analysis</strong> — read-only. Accept
            actions are disabled because these bullets have moved on.
          </div>
          <button
            className="btn-soft text-xs"
            onClick={() => latestSessionId && loadVersion(latestSessionId)}
            disabled={!latestSessionId || loadingVersion !== null}
          >
            {loadingVersion === latestSessionId ? "Loading…" : "Load current"}
          </button>
        </div>
      )}

      <div className="mb-5 rounded-xl bg-brand-50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
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
          <div className="flex items-center gap-2">
            {weakCount > 0 && !isReadOnly && (
              <button
                className="btn-primary text-xs"
                onClick={handleAcceptAll}
                disabled={batchAccepting.running || analysing || pending}
                title="Accept every suggested rewrite in one click. You can still edit later."
              >
                {batchAccepting.running
                  ? `Accepting ${batchAccepting.done + 1} of ${batchAccepting.total}…`
                  : `Accept all ${weakCount} rewrites`}
              </button>
            )}
            <a
              href="/api/polish/download"
              className={
                acceptedCount > 0 ? "btn-primary text-xs" : "btn-soft text-xs"
              }
              title="Download your résumé as a PDF, including every rewrite you've accepted."
            >
              ⬇ Download résumé
            </a>
          </div>
        </div>
        {batchAccepting.running && (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white">
            <div
              className="h-full bg-brand-500 transition-all"
              style={{
                width: `${Math.round((batchAccepting.done / batchAccepting.total) * 100)}%`,
              }}
            />
          </div>
        )}
      </div>

      {errMsg && (
        <p className="mb-4 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          {errMsg}
        </p>
      )}

      {weakCount === 0 && acceptedCount > 0 && !isReadOnly && (
        <div className="mb-5 rounded-xl border border-success/30 bg-success-soft p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-success">
                ✓ You&apos;re all polished — {acceptedCount}{" "}
                {acceptedCount === 1 ? "bullet" : "bullets"} improved.
              </p>
              <p className="mt-0.5 text-xs text-ink-soft">
                Grab your refreshed résumé as a PDF and start sending it out.
              </p>
            </div>
            <a
              href="/api/polish/download"
              className="btn-primary text-sm"
              title="Downloads a PDF with every accepted rewrite baked in."
            >
              ⬇ Download résumé PDF
            </a>
          </div>
        </div>
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
                  {b.role || orig?.role} · {b.company || orig?.company}
                </div>
                <p className="mt-2 text-sm text-ink">{b.original}</p>
              </div>
            );
          }
          if (!b.isWeak) {
            return (
              <details key={k} className="rounded-xl border border-line bg-white px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-ink-soft">
                  Solid bullet — {b.role || orig?.role} · {b.company || orig?.company}
                </summary>
                <p className="mt-2 text-sm text-ink">{b.original}</p>
                <p className="mt-1 text-xs text-success">{b.feedback}</p>
              </details>
            );
          }
          return (
            <div key={k} className="rounded-xl border border-line bg-white p-4 shadow-card">
              <div className="text-xs text-ink-mute">
                {b.role || orig?.role} · {b.company || orig?.company}
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
                  className="input mt-1 block w-full text-sm leading-relaxed"
                  rows={3}
                  value={editedText[k] ?? ""}
                  onChange={(e) =>
                    setEditedText((prev) => ({ ...prev, [k]: e.target.value }))
                  }
                  disabled={isReadOnly}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  className="btn-primary text-xs"
                  onClick={() => handleAccept(b)}
                  disabled={pending || isReadOnly || batchAccepting.running}
                  title={
                    isReadOnly
                      ? "You're viewing a past version — load the current one to accept."
                      : undefined
                  }
                >
                  {pending ? "Saving…" : "Accept rewrite"}
                </button>
                <button
                  className="btn-ghost text-xs text-ink-soft"
                  onClick={() => {
                    if (!activeSession) return;
                    setActiveSession({
                      ...activeSession,
                      feedback: activeSession.feedback.map((f) =>
                        keyOf(f) === k ? { ...f, isWeak: false } : f,
                      ),
                    });
                  }}
                  disabled={isReadOnly}
                >
                  Skip
                </button>
                <button
                  className="btn-ghost text-xs text-ink-soft"
                  onClick={() =>
                    setEditedText((prev) => ({ ...prev, [k]: b.suggested }))
                  }
                  disabled={isReadOnly}
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

/**
 * Rolling version history — up to 5 rows. The current version gets a
 * Regenerate button; past versions get View only.
 */
function VersionHistoryPanel({
  sessions,
  viewingSessionId,
  latestSessionId,
  analysing,
  loadingVersion,
  onLoad,
  onRegenerate,
}: {
  sessions: PolishSessionSummary[];
  viewingSessionId: string | null;
  latestSessionId: string | null;
  analysing: boolean;
  loadingVersion: string | null;
  onLoad: (id: string) => void;
  onRegenerate: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (sessions.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <div>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink hover:text-brand-700"
          >
            <span
              className={`inline-block transition-transform ${collapsed ? "-rotate-90" : ""}`}
            >
              ▾
            </span>
            Version history
          </button>
          <p className="ml-4 text-xs text-ink-soft">
            Last {sessions.length} {sessions.length === 1 ? "analysis" : "analyses"}. Older versions drop off automatically.
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-ink-mute">
          {sessions.length} of 5
        </span>
      </div>

      {!collapsed && (
        <div className="mt-3 divide-y divide-line border-t border-line">
          {sessions.map((s, idx) => {
            const isLatest = s.id === latestSessionId;
            const isViewing = s.id === viewingSessionId;
            const versionLabel = `v${sessions.length - idx}`;
            return (
              <div
                key={s.id}
                className="grid grid-cols-[52px_1fr_auto] items-center gap-3 py-2.5"
              >
                <span
                  className={
                    isLatest
                      ? "inline-flex items-center rounded-full bg-brand-500 px-2 py-0.5 text-[11px] font-semibold text-white"
                      : "inline-flex items-center rounded-full bg-cream-100 px-2 py-0.5 text-[11px] font-semibold text-ink-soft"
                  }
                >
                  {versionLabel}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-ink">{fmtDateTime(s.createdAt)}</span>
                    {isLatest && (
                      <span className="rounded-full bg-accent-500 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                        Current
                      </span>
                    )}
                    {isViewing && !isLatest && (
                      <span className="rounded-full bg-cream-100 px-2 py-0.5 text-[10px] font-semibold text-ink-soft">
                        Viewing
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-soft">
                    {summariseSession(s)}
                    <span className="ml-2 text-ink-mute">· {fmtRelative(s.createdAt)}</span>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  {isLatest ? (
                    <button
                      className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-brand-700 hover:bg-cream-100 disabled:opacity-50"
                      onClick={onRegenerate}
                      disabled={analysing}
                      title="Re-run Claude against your current profile. Creates a new version."
                    >
                      {analysing ? "Regenerating…" : "↻ Regenerate"}
                    </button>
                  ) : (
                    <button
                      className="inline-flex items-center rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-brand-700 hover:bg-cream-100 disabled:opacity-50"
                      onClick={() => onLoad(s.id)}
                      disabled={loadingVersion !== null}
                    >
                      {loadingVersion === s.id ? "Loading…" : "View"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {sessions.length >= 5 && !collapsed && (
        <p className="mt-2 text-[11px] text-ink-mute">
          Only the 5 most recent analyses are kept. Regenerating creates a new version and drops the oldest.
        </p>
      )}
    </div>
  );
}

function summariseSession(s: PolishSessionSummary): string {
  const improved = s.acceptedCount;
  const total = s.totalBullets;
  const stillWeak = Math.max(0, s.weakBullets - s.acceptedCount);
  if (total === 0) return "No bullets analysed.";
  const first = `${improved} of ${total} improved`;
  const second = stillWeak > 0 ? ` · ${stillWeak} weak still open` : "";
  return first + second;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtRelative(iso: string): string {
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return iso;
  const diff = Math.max(0, Date.now() - d);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function seedEditsFromSession(s: PolishSession | null): Record<string, string> {
  if (!s) return {};
  const seed: Record<string, string> = {};
  for (const b of s.feedback) {
    seed[`${b.experienceIndex}:${b.bulletIndex}`] = b.suggested;
  }
  return seed;
}
