import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { savePreferencesAction } from '../actions';
import { Stepper } from '@/components/Stepper';
import { LocationPicker } from './LocationPicker';
import { PivotPanel } from './PivotPanel';
import { detectSelectedIds } from '@/lib/locations';
import { roleFamiliesByGroup } from '@/lib/role-families';
import type { PivotBrief } from '@/lib/types';

export default async function PreferencesPage() {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const { data: row } = await sb
    .from('users')
    .select('locations, work_modes, target_ctc, phone, notice_period, notes, email_frequency, email_time, timezone, role_family, pivot_enabled, pivot_brief')
    .eq('id', user.id)
    .single();

  // Reverse-map saved match terms → option ids so the picker shows current state
  const initialSelectedIds = detectSelectedIds(row?.locations ?? []);
  const modes = row?.work_modes ?? ['remote', 'hybrid'];
  const currentRoleFamily = (row?.role_family as string | null) ?? '';
  const pivotEnabled = (row?.pivot_enabled as boolean | null) ?? false;
  const pivotBrief = (row?.pivot_brief as PivotBrief | null) ?? null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Stepper step={3} />
      <div className="card">
        <h1 className="text-2xl font-bold">What are you looking for?</h1>
        <p className="mt-1 text-sm text-ink-soft">We'll use this to find roles that fit your life — not just your skills.</p>

        <form action={savePreferencesAction} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="roleFamily">What kind of role are you targeting?</label>
            <select
              id="roleFamily"
              name="roleFamily"
              defaultValue={currentRoleFamily}
              className="input"
            >
              <option value="">— pick one (helps us search better) —</option>
              {roleFamiliesByGroup().map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-mute">
              We use this to scope each job source to the right category — big recall boost.
              Changing careers? Use the pivot option below and we'll point the search there instead.
            </p>
          </div>

          <PivotPanel initialEnabled={pivotEnabled} initialBrief={pivotBrief} />

          <LocationPicker initialSelectedIds={initialSelectedIds} />

          <div>
            <label className="label">Work mode (pick any)</label>
            <div className="flex flex-wrap gap-2">
              {(['remote', 'hybrid', 'onsite', 'any'] as const).map((m) => (
                <label
                  key={m}
                  className="cursor-pointer rounded-full border border-line bg-surface px-4 py-2 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:font-semibold has-[:checked]:text-brand-700"
                >
                  <input type="checkbox" name="workModes" value={m} defaultChecked={modes.includes(m)} className="hidden" />
                  {m === 'remote' && '🌐 Remote'}
                  {m === 'hybrid' && '🏢 Hybrid'}
                  {m === 'onsite' && '🪑 On-site'}
                  {m === 'any' && '✨ No preference'}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Target salary (annual)</label>
              <input name="targetCtc" defaultValue={row?.target_ctc ?? ''} className="input" placeholder="e.g. ₹35–50 LPA" />
            </div>
            <div>
              <label className="label">Notice period</label>
              <select name="noticePeriod" defaultValue={row?.notice_period ?? 'immediate'} className="input">
                <option value="immediate">Immediate</option>
                <option value="2w">2 weeks</option>
                <option value="30d">30 days</option>
                <option value="60d">60 days</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Daily email time</label>
              <input name="emailTime" type="time" defaultValue={row?.email_time ?? '08:30'} className="input" />
            </div>
            <div>
              <label className="label">Timezone</label>
              <input name="timezone" defaultValue={row?.timezone ?? 'Asia/Kolkata'} className="input" />
            </div>
          </div>

          <div>
            <label className="label">Frequency</label>
            <div className="flex flex-wrap gap-2">
              {(['daily', '2days', 'weekly', 'realtime'] as const).map((f) => (
                <label key={f} className="cursor-pointer rounded-full border border-line px-4 py-2 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:font-semibold has-[:checked]:text-brand-700">
                  <input type="radio" name="emailFrequency" value={f} defaultChecked={(row?.email_frequency ?? 'daily') === f} className="hidden" />
                  {f === 'daily' && 'Daily'}
                  {f === '2days' && 'Every 2 days'}
                  {f === 'weekly' && 'Weekly'}
                  {f === 'realtime' && 'Real-time'}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-mute">💡 Suggested for your profile: <strong>Daily</strong>.</p>
          </div>

          <div>
            <label className="label">Anything else? (optional)</label>
            <textarea name="notes" rows={3} defaultValue={row?.notes ?? ''} className="input"
              placeholder="e.g., open to switching domains, can't relocate..." />
          </div>

          <div className="flex justify-between pt-2">
            <a href="/onboarding/profile" className="btn-soft">← Back</a>
            <button className="btn-primary">Continue →</button>
          </div>
        </form>
      </div>
    </div>
  );
}
