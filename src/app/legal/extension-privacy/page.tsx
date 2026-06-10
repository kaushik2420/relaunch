import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Relaunch Chrome Extension — Privacy Policy",
  description:
    "How the Relaunch Chrome extension uses, stores, and protects your data.",
};

const LAST_UPDATED = "9 June 2026";

export default function ExtensionPrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-14 text-ink">
      <header className="mb-10">
        <p className="text-xs uppercase tracking-wider text-ink-soft">
          Relaunch Chrome Extension
        </p>
        <h1 className="mt-2 text-3xl font-bold">Privacy Policy</h1>
        <p className="mt-2 text-sm text-ink-soft">Last updated: {LAST_UPDATED}</p>
      </header>

      <section className="space-y-5 text-[15px] leading-relaxed">
        <p>
          The Relaunch Chrome extension helps people who have been laid off
          apply to jobs faster by filling application forms with tailored
          content their Relaunch account already generated. This page
          explains exactly what data the extension reads, what it sends to
          Relaunch&apos;s servers, what it stores locally, and what it
          deliberately does not do.
        </p>

        <h2 className="mt-10 text-xl font-bold">What the extension does</h2>
        <p>
          When you visit a job application page on a supported applicant
          tracking system (Greenhouse, Lever, Ashby) or click the Relaunch
          icon on any other page, the extension:
        </p>
        <ul className="ml-5 list-disc space-y-2">
          <li>
            Asks Relaunch&apos;s servers whether you have a tailored match
            for that job URL.
          </li>
          <li>
            If yes, offers to fill the form using the résumé, cover letter,
            and answers Relaunch already drafted for that role.
          </li>
          <li>
            Lets you ask Relaunch to draft answers to specific application
            questions (&quot;Why should we hire you?&quot;,
            &quot;Tell me about your experience with X&quot;).
          </li>
          <li>
            Lets you trigger &quot;Smart Fill&quot;, which reads the form
            on the current page and asks Relaunch to suggest values for
            each labeled field.
          </li>
        </ul>

        <h2 className="mt-10 text-xl font-bold">What data the extension reads</h2>
        <p>The extension reads:</p>
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong>The URL of the page you are on</strong>, only on the
            domains listed in the extension manifest (Greenhouse, Lever,
            Ashby, LinkedIn job pages, and Relaunch&apos;s own site).
          </li>
          <li>
            <strong>The structure of the application form</strong> when you
            click Smart Fill — field labels, placeholders, types, and the
            list of options for dropdowns. We never read the values you
            have already typed into the form.
          </li>
          <li>
            <strong>The page title</strong>, only when the URL match misses,
            to suggest a search query for finding your match manually.
          </li>
        </ul>

        <h2 className="mt-10 text-xl font-bold">What the extension sends to Relaunch&apos;s servers</h2>
        <p>The extension makes only these network requests:</p>
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <code>GET /api/extension/me</code> — to verify your token and
            fetch your profile basics (name, email, phone, LinkedIn,
            etc.) needed to fill forms.
          </li>
          <li>
            <code>GET /api/extension/job</code> — sends the current page
            URL so we can look up the tailored match for it.
          </li>
          <li>
            <code>GET /api/extension/search</code> — sends a search query
            you typed when the URL match misses.
          </li>
          <li>
            <code>POST /api/extension/answer</code> — sends a match id and
            an application question you typed.
          </li>
          <li>
            <code>POST /api/extension/smartfill</code> — sends a match id
            and the structure of the form&apos;s fields (labels,
            placeholders, types, options). Fields whose labels look
            sensitive (compensation, notice period, visa, EEO, date of
            birth, criminal history) are stripped on the client side
            before sending and never appear in our logs.
          </li>
          <li>
            <code>POST /api/extension/enrich</code> — sends a match id to
            regenerate tailored content for an older match.
          </li>
          <li>
            <strong>PDF downloads</strong> — when you click &quot;Download
            tailored PDF&quot;, the extension downloads the file from your
            own Google Drive (the tailored PDF Relaunch created for you).
            The file goes directly to your Downloads folder; Relaunch does
            not see or store it.
          </li>
        </ul>
        <p>
          We do <strong>not</strong> send any analytics, behavioral data,
          page content, or telemetry beyond the requests above.
        </p>

        <h2 className="mt-10 text-xl font-bold">What the extension stores locally</h2>
        <p>
          The extension stores three things in your browser&apos;s
          <code> chrome.storage.local</code>:
        </p>
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong>Your extension token</strong> — the value you pasted
            from Relaunch → Settings → Browser extension. Used to
            authenticate API calls.
          </li>
          <li>
            <strong>Per-platform consent acknowledgements</strong> — whether
            you have confirmed the &quot;heads up before filling&quot;
            dialog on each supported ATS.
          </li>
          <li>
            <strong>Rate-limit timestamps</strong> — when your recent fills
            happened, so we can enforce the 5-fills-per-hour limit
            client-side.
          </li>
        </ul>
        <p>
          These never leave your browser. Removing the extension or
          clearing browser storage erases all of them.
        </p>

        <h2 className="mt-10 text-xl font-bold">What the extension never does</h2>
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong>Never auto-submits a form.</strong> Clicking
            Submit is always your action.
          </li>
          <li>
            <strong>Never fills sensitive fields:</strong> salary, current
            CTC, expected compensation, notice period, visa status, work
            authorization, equal-employment questions (race, ethnicity,
            gender, disability, veteran status), date of birth, or
            criminal-history questions. These are stripped on the client
            before being sent to our servers, so our LLM never sees them.
          </li>
          <li>
            <strong>Never writes to LinkedIn DOM.</strong> LinkedIn&apos;s
            Terms of Service do not permit automated form interaction.
            On LinkedIn, the extension only displays tailored copy for
            you to paste manually.
          </li>
          <li>
            <strong>Never auto-applies to multiple jobs.</strong> Each
            fill is one explicit click. The 5-fills-per-hour rate limit
            is enforced both in your browser and on Relaunch&apos;s
            servers.
          </li>
          <li>
            <strong>Never reads pages outside its host permissions.</strong>
            The manifest restricts the extension to job-board pages and
            Relaunch&apos;s own domain. It cannot see your banking site,
            email, or any other URL not listed.
          </li>
        </ul>

        <h2 className="mt-10 text-xl font-bold">What Relaunch&apos;s servers store</h2>
        <p>
          Your Relaunch account already stores your résumé, profile, and
          generated content under Relaunch&apos;s main{" "}
          <a
            href="/legal/privacy"
            className="text-brand-500 underline underline-offset-4"
          >
            privacy policy
          </a>
          . The extension does not add any new data to that store beyond
          your extension token. When you ask Relaunch to draft an answer
          via the extension, the answer is logged with your match so the
          next time you visit that job&apos;s apply page, you do not pay
          for re-generation.
        </p>

        <h2 className="mt-10 text-xl font-bold">Third-party services</h2>
        <p>
          To generate the tailored content shown in the extension,
          Relaunch&apos;s servers send your profile and the relevant job
          context to <strong>Anthropic&apos;s Claude API</strong>.
          Anthropic processes the prompt to generate a response and does
          not retain it for training. See{" "}
          <a
            href="https://www.anthropic.com/privacy"
            target="_blank"
            rel="noreferrer"
            className="text-brand-500 underline underline-offset-4"
          >
            Anthropic&apos;s privacy policy
          </a>{" "}
          for details.
        </p>

        <h2 className="mt-10 text-xl font-bold">Children&apos;s privacy</h2>
        <p>
          Relaunch is intended for adults seeking employment. We do not
          knowingly collect data from users under 16.
        </p>

        <h2 className="mt-10 text-xl font-bold">Your rights</h2>
        <p>
          You can revoke the extension&apos;s access at any time by
          regenerating or revoking your token in Relaunch → Settings →
          Browser extension. You can request export or deletion of your
          Relaunch data by emailing us at the address below.
        </p>

        <h2 className="mt-10 text-xl font-bold">Contact</h2>
        <p>
          For any privacy question or concern, email{" "}
          <a
            href="mailto:hello@get-relaunch.com"
            className="text-brand-500 underline underline-offset-4"
          >
            hello@get-relaunch.com
          </a>
          .
        </p>

        <h2 className="mt-10 text-xl font-bold">Changes to this policy</h2>
        <p>
          We will update the &quot;last updated&quot; date at the top of
          this page when we change anything material. The current version
          always lives at{" "}
          <a
            href="https://www.get-relaunch.com/legal/extension-privacy"
            className="text-brand-500 underline underline-offset-4"
          >
            get-relaunch.com/legal/extension-privacy
          </a>
          .
        </p>
      </section>
    </div>
  );
}
