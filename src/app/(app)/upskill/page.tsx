import { EmpathyBanner } from '@/components/EmpathyBanner';

export default function UpskillPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-3xl font-bold">Skill gaps slowing you down</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Based on the last 7 days of near-miss roles, here's where a small investment could unlock the most jobs.
      </p>

      <div className="mt-5">
        <EmpathyBanner icon="🌟" title="You're already enough.">
          These suggestions are about widening the net — not about being "not enough." You're already
          a top-30% candidate for most of the roles we see.
        </EmpathyBanner>
      </div>

      <div className="mt-6 card">
        <p className="text-sm text-ink-soft">
          The personalized upskill engine will populate here once you've had 5+ daily runs.
          We need a sample of your near-miss jobs to figure out the highest-leverage skill to add.
        </p>
      </div>
    </div>
  );
}
