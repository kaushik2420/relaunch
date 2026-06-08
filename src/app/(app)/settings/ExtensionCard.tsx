"use client";
import { useState, useTransition } from "react";
import {
  generateExtensionTokenAction,
  revokeExtensionTokenAction,
  syncMatchesFromSheetAction,
} from "./extension-actions";

/**
 * "Browser extension" section of /settings.
 *
 * Token UX:
 *  - If no token: prominent "Generate token" button + explainer.
 *  - If token exists: masked text + "Show", "Copy", and "Regenerate"
 *    (with a confirmation prompt because regenerating revokes the old).
 *
 * We render the full token only after the user clicks Show — discourages
 * shoulder-surfing in coffee shops and matches the pattern people expect
 * from API key UIs (GitHub, Stripe).
 */
export function ExtensionCard({ token }: { token: string | null }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncing, startSyncing] = useTransition();

  function handleSync() {
    setSyncResult(null);
    startSyncing(async () => {
      const r = await syncMatchesFromSheetAction();
      if (r.ok) {
        setSyncResult(
          r.inserted === 0
            ? "Nothing to sync — your Sheet looks empty."
            : `Synced ${r.inserted} past matches. The extension can now find them on the apply page.`,
        );
      } else {
        setSyncResult(r.reason ?? "Sync failed — please try again.");
      }
    });
  }

  async function handleCopy() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleRegenerate() {
    if (
      !confirm(
        "Generating a new token will immediately disconnect any extension that's using the current one. Continue?",
      )
    ) {
      return;
    }
    await generateExtensionTokenAction();
  }

  async function handleRevoke() {
    if (
      !confirm(
        "Revoking will disconnect your extension. You'll need to generate a fresh token to reconnect it. Continue?",
      )
    ) {
      return;
    }
    await revokeExtensionTokenAction();
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Browser extension</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Connect the Relaunch Chrome extension to fill job applications
            with the tailored résumé and cover letter we generate for each
            match.
          </p>
        </div>
        <span className="chip text-xs">Beta</span>
      </div>

      {!token ? (
        <>
          <p className="mt-3 text-sm text-ink-soft">
            Generate a one-time token below, paste it into the extension&apos;s
            Options page, and you&apos;re connected. Your token is stored only
            in your browser and on Relaunch — never shared.
          </p>
          <form action={generateExtensionTokenAction} className="mt-4">
            <button className="btn-primary">Generate token</button>
          </form>
        </>
      ) : (
        <>
          <p className="mt-3 text-xs uppercase tracking-wider font-semibold text-ink-soft">
            Your extension token
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="flex-1 rounded-lg border border-line bg-surface-page px-3 py-2 text-xs font-mono text-ink break-all">
              {visible ? token : token.slice(0, 6) + "•".repeat(28)}
            </code>
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              className="btn-soft text-xs whitespace-nowrap"
            >
              {visible ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="btn-soft text-xs whitespace-nowrap"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="mt-3 text-xs text-ink-mute">
            Open the Relaunch extension&apos;s Options page → paste this token
            into the &quot;Extension token&quot; field → click Save.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRegenerate}
              className="btn-soft text-xs"
            >
              Regenerate
            </button>
            <button
              type="button"
              onClick={handleRevoke}
              className="btn-ghost text-xs text-rose-700 hover:bg-rose-50"
            >
              Revoke
            </button>
          </div>

          {/* --- Sync past matches ---------------------------------- */}
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-xs uppercase tracking-wider font-semibold text-ink-soft">
              Sync past matches
            </p>
            <p className="mt-1.5 text-xs text-ink-soft leading-relaxed">
              The extension only knows about matches generated after you
              enabled it. Click below to pull your full match history from
              your Relaunch Google Sheet so the extension finds every
              past role too. PDFs come through; the cover-letter <em>text</em>
              wasn&apos;t persisted historically so paste-fill of that field
              won&apos;t work for old matches (PDF download still does).
            </p>
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="btn-soft text-xs mt-3"
            >
              {syncing ? "Syncing…" : "Sync past matches from Sheet"}
            </button>
            {syncResult && (
              <p className="mt-2 text-xs text-ink-soft">{syncResult}</p>
            )}
          </div>
        </>
      )}

      <details className="mt-4 text-xs text-ink-soft">
        <summary className="cursor-pointer font-semibold hover:text-ink">
          How does the extension stay safe?
        </summary>
        <ul className="mt-2 ml-4 list-disc space-y-1.5 leading-relaxed">
          <li>
            <strong>Never auto-submits.</strong> The submit button is always
            your click.
          </li>
          <li>
            <strong>5 fills per hour</strong> per ATS — applying too quickly is
            the pattern that gets accounts flagged.
          </li>
          <li>
            <strong>LinkedIn is read-only.</strong> The extension never writes
            to LinkedIn fields — their ToS doesn&apos;t allow it.
          </li>
          <li>
            <strong>Never fills</strong> salary, CTC, notice period, visa, or
            EEO questions — those are personal decisions.
          </li>
        </ul>
      </details>
    </div>
  );
}
