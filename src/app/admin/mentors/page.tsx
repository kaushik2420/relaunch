import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { serverConfig } from '@/lib/config';
import { Logo } from '@/components/Logo';
import { SubmitButton } from '@/components/SubmitButton';
import {
  listAllMentors,
  listPendingMentors,
  mentorClickCounts,
  ALL_EXPERTISE_TAGS,
  type Mentor,
} from '@/lib/services/mentors';
import {
  upsertMentorAction,
  toggleMentorActiveAction,
} from './actions';

export const dynamic = 'force-dynamic';

export default async function AdminMentorsPage({
  searchParams,
}: {
  searchParams: { error?: string; saved?: string; edit?: string };
}) {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const adminEmail = serverConfig().ADMIN_EMAIL.toLowerCase();
  if ((user.email ?? '').toLowerCase() !== adminEmail) redirect('/dashboard');

  const [mentors, pending, clicks] = await Promise.all([
    listAllMentors(),
    listPendingMentors(),
    mentorClickCounts(30),
  ]);
  const totalClicks30d = Object.values(clicks).reduce((s, n) => s + n, 0);
  const editing = searchParams.edit
    ? mentors.find((m) => m.id === searchParams.edit) ?? null
    : null;
  const shareUrl = 'https://www.get-relaunch.com/join-as-mentor';

  return (
    <main className="min-h-screen bg-surface-page">
      <nav className="flex items-center justify-between border-b border-line bg-surface px-6 py-3.5">
        <Logo />
        <div className="flex items-center gap-3 text-sm">
          <Link href="/admin" className="text-brand-700 hover:underline">
            ← Admin
          </Link>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Mentors</h1>
            <p className="mt-1 text-sm text-ink-soft">
              {mentors.length} mentor{mentors.length === 1 ? '' : 's'} on the
              directory · {totalClicks30d} Book-a-session clicks in the last
              30 days
            </p>
          </div>
          <Link href="/mentors" className="text-sm text-brand-700 hover:underline">
            View public page ↗
          </Link>
        </div>

        {searchParams.saved && (
          <p className="mt-4 rounded-lg border border-success/30 bg-success-soft p-3 text-sm">
            ✅ Mentor {decodeURIComponent(searchParams.saved)}.
          </p>
        )}
        {searchParams.error && (
          <p className="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            {decodeURIComponent(searchParams.error)}
          </p>
        )}

        {/* ---- Public signup link ---- */}
        <div className="mt-6 rounded-xl border border-brand-100 bg-brand-50/50 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-brand-700">
                🔗 Shareable mentor signup form
              </h2>
              <p className="mt-1 text-xs text-ink-soft">
                Send this link to prospective mentors — they fill it out
                themselves, you approve here before it goes live.
              </p>
            </div>
            <Link
              href="/join-as-mentor"
              target="_blank"
              className="text-xs font-semibold text-brand-700 hover:underline"
            >
              Preview form ↗
            </Link>
          </div>
          <code className="mt-3 block break-all rounded-md border border-brand-100 bg-white p-2 text-xs">
            {shareUrl}
          </code>
        </div>

        {/* ---- Pending review ---- */}
        {pending.length > 0 && (
          <div className="mt-6 rounded-xl border border-warn/30 bg-warn-soft p-4">
            <h2 className="text-sm font-bold">
              📬 {pending.length} pending review
            </h2>
            <p className="mt-1 text-xs text-ink-soft">
              Public submissions waiting for your approval. Review each below
              — click Edit to see the full detail, or activate them directly
              once you&apos;re happy.
            </p>
            <div className="mt-3 space-y-2">
              {pending.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{m.name}</div>
                    <div className="text-xs text-ink-soft">
                      {m.headline}
                      {m.submittedEmail ? ` · ${m.submittedEmail}` : ''}
                    </div>
                    {m.expertise.length > 0 && (
                      <div className="mt-1 text-[11px] text-ink-mute">
                        {m.expertise.slice(0, 5).join(', ')}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/admin/mentors?edit=${m.id}`}
                      className="text-xs text-brand-700 hover:underline"
                    >
                      Review →
                    </Link>
                    <form action={toggleMentorActiveAction}>
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="isActive" value="true" />
                      <SubmitButton
                        className="btn-primary text-xs"
                        pendingLabel="Activating…"
                      >
                        Approve
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---- Add / edit form ---- */}
        <MentorForm mentor={editing} />

        {/* ---- Existing mentors ---- */}
        <h2 className="mt-12 text-xl font-bold">All mentors</h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-page text-left text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-4 py-3 font-semibold">Mentor</th>
                <th className="px-4 py-3 font-semibold">Expertise</th>
                <th className="px-4 py-3 text-right font-semibold">Order</th>
                <th className="px-4 py-3 text-right font-semibold">Clicks 30d</th>
                <th className="px-4 py-3 text-right font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {mentors.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-soft">
                    No mentors yet — add your first with the form above.
                  </td>
                </tr>
              )}
              {mentors.map((m) => (
                <tr key={m.id} className="border-t border-line align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold">{m.name}</div>
                    <div className="text-xs text-ink-soft">{m.headline}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-soft">
                    {m.expertise.slice(0, 4).join(', ')}
                    {m.expertise.length > 4 ? ` +${m.expertise.length - 4}` : ''}
                  </td>
                  <td className="px-4 py-3 text-right text-ink-mute">
                    {m.displayOrder}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {clicks[m.id] ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {m.isActive ? (
                      <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-semibold text-success">
                        Active
                      </span>
                    ) : (
                      <span className="rounded-full bg-cream-100 px-2 py-0.5 text-[10px] font-semibold text-ink-soft">
                        Off
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/admin/mentors?edit=${m.id}`}
                        className="text-xs text-brand-700 hover:underline"
                      >
                        Edit
                      </Link>
                      <form action={toggleMentorActiveAction}>
                        <input type="hidden" name="id" value={m.id} />
                        <input
                          type="hidden"
                          name="isActive"
                          value={m.isActive ? 'false' : 'true'}
                        />
                        <SubmitButton
                          className="text-xs text-ink-soft hover:text-ink"
                          pendingLabel="…"
                        >
                          {m.isActive ? 'Deactivate' : 'Activate'}
                        </SubmitButton>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function MentorForm({ mentor }: { mentor: Mentor | null }) {
  const isEdit = !!mentor;
  return (
    <div className="mt-8 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold">
          {isEdit ? `Edit ${mentor.name}` : 'Add a mentor'}
        </h2>
        {isEdit && (
          <Link
            href="/admin/mentors"
            className="text-xs text-ink-soft hover:text-ink"
          >
            + Add new instead
          </Link>
        )}
      </div>

      <form action={upsertMentorAction} className="mt-4 space-y-4">
        {isEdit && <input type="hidden" name="id" value={mentor.id} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Name*</label>
            <input
              name="name"
              type="text"
              className="input"
              required
              defaultValue={mentor?.name ?? ''}
              placeholder="Anjali Sharma"
            />
          </div>
          <div>
            <label className="label">Headline*</label>
            <input
              name="headline"
              type="text"
              className="input"
              required
              defaultValue={mentor?.headline ?? ''}
              placeholder="Ex-VP Product at Flipkart"
            />
          </div>
        </div>

        <div>
          <label className="label">Bio</label>
          <textarea
            name="bio"
            className="input"
            rows={3}
            defaultValue={mentor?.bio ?? ''}
            placeholder="2-4 sentences. What have they done, what will they help with, why do they care about this cohort?"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Calendar URL*</label>
            <input
              name="calendarUrl"
              type="url"
              className="input"
              required
              defaultValue={mentor?.calendarUrl ?? ''}
              placeholder="https://calendly.com/anjali/30min"
            />
          </div>
          <div>
            <label className="label">LinkedIn URL</label>
            <input
              name="linkedinUrl"
              type="url"
              className="input"
              defaultValue={mentor?.linkedinUrl ?? ''}
              placeholder="https://linkedin.com/in/anjali"
            />
          </div>
        </div>

        <div>
          <label className="label">Avatar URL (optional)</label>
          <input
            name="avatarUrl"
            type="url"
            className="input"
            defaultValue={mentor?.avatarUrl ?? ''}
            placeholder="https://... (headshot; initials shown if empty)"
          />
        </div>

        <div>
          <label className="label">Expertise (comma or newline separated)</label>
          <textarea
            name="expertise"
            className="input"
            rows={2}
            defaultValue={(mentor?.expertise ?? []).join(', ')}
            placeholder="Product Management, Layoff Recovery, Interview Prep"
          />
          <p className="mt-1 text-xs text-ink-mute">
            Suggested:{' '}
            {ALL_EXPERTISE_TAGS.slice(0, 8).join(' · ')} …
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Session length (min)</label>
            <input
              name="sessionLengthMinutes"
              type="number"
              className="input"
              defaultValue={mentor?.sessionLengthMinutes ?? 30}
              min={0}
            />
          </div>
          <div>
            <label className="label">Session price note</label>
            <input
              name="sessionPriceNote"
              type="text"
              className="input"
              defaultValue={mentor?.sessionPriceNote ?? 'Free'}
              placeholder="Free / ₹500 / donation-based…"
            />
          </div>
          <div>
            <label className="label">Display order</label>
            <input
              name="displayOrder"
              type="number"
              className="input"
              defaultValue={mentor?.displayOrder ?? 100}
              min={0}
            />
            <p className="mt-1 text-xs text-ink-mute">
              Lower = higher on the page.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="isActive"
            name="isActive"
            type="checkbox"
            value="true"
            defaultChecked={mentor?.isActive ?? true}
            className="h-4 w-4"
          />
          <label htmlFor="isActive" className="text-sm">
            Active — visible on /mentors
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <SubmitButton
            className="btn-primary"
            pendingLabel={isEdit ? 'Saving…' : 'Adding…'}
          >
            {isEdit ? 'Save changes' : 'Add mentor'}
          </SubmitButton>
          {isEdit && (
            <Link
              href="/admin/mentors"
              className="text-sm text-ink-soft hover:text-ink"
            >
              Cancel
            </Link>
          )}
        </div>
      </form>
    </div>
  );
}
