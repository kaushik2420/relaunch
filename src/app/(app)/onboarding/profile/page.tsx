import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { saveProfileAction } from '../actions';
import { Stepper } from '@/components/Stepper';
import type { UserProfile } from '@/lib/types';

export default async function ProfilePage() {
  const sb = createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const { data: row } = await sb
    .from('users')
    .select('first_name, profile')
    .eq('id', user.id)
    .single();
  const profile = (row?.profile ?? {}) as Partial<UserProfile>;

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Stepper step={2} />
      <div className="card">
        <h1 className="text-2xl font-bold">Here's what we found ✨</h1>
        <p className="mt-1 text-sm text-ink-soft">Look it over and edit anything that's off.</p>

        <form action={saveProfileAction} className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field name="fullName" label="Full name" defaultValue={profile.fullName} required />
            <SelectField name="seniority" label="Seniority" defaultValue={profile.seniority ?? 'senior'}
              options={['junior', 'mid', 'senior', 'staff', 'principal']} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field name="location" label="Current location" defaultValue={profile.location} />
            <Field name="yearsExperience" label="Years of experience" type="number"
              defaultValue={profile.yearsExperience?.toString()} />
          </div>
          <Field name="headline" label="One-line summary" defaultValue={profile.headline} />
          <Field name="skillsCsv" label="Skills (comma-separated)" defaultValue={(profile.skills ?? []).join(', ')} />
          <div className="grid grid-cols-2 gap-3">
            <Field name="linkedin" label="LinkedIn" defaultValue={profile.links?.linkedin} />
            <Field name="github" label="GitHub / Portfolio" defaultValue={profile.links?.github ?? profile.links?.portfolio} />
          </div>

          <div className="flex justify-between pt-2">
            <a href="/onboarding/upload" className="btn-soft">← Re-upload</a>
            <button className="btn-primary">Looks good — next</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  name, label, defaultValue, type = 'text', required = false,
}: { name: string; label: string; defaultValue?: string; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} required={required} defaultValue={defaultValue ?? ''} className="input" />
    </div>
  );
}

function SelectField({
  name, label, defaultValue, options,
}: { name: string; label: string; defaultValue: string; options: string[] }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={defaultValue} className="input">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
