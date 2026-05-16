import { setNewPasswordAction } from '../actions';

export default function ResetPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <div>
      <h2 className="text-2xl font-bold">Set a new password</h2>
      <form action={setNewPasswordAction} className="mt-6 space-y-4">
        <div>
          <label className="label">New password</label>
          <input name="password" type="password" minLength={8} required className="input" />
        </div>
        <div>
          <label className="label">Confirm password</label>
          <input name="confirm" type="password" minLength={8} required className="input" />
        </div>
        {searchParams.error && <p className="text-sm text-danger">{decodeURIComponent(searchParams.error)}</p>}
        <button className="btn-primary w-full">Update password</button>
      </form>
    </div>
  );
}
