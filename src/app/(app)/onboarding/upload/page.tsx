import { EmpathyBanner } from '@/components/EmpathyBanner';
import { ResumeUploader } from './ResumeUploader';

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Stepper step={1} />
      <div className="mb-6">
        <EmpathyBanner title="You're not starting from zero — you're starting from experience.">
          Your resume already tells your story. We'll just learn it so we can find the right roles for you.
        </EmpathyBanner>
      </div>

      <div className="card">
        <h1 className="text-2xl font-bold">Let's start with your resume</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Upload it once. We'll never store the file on our servers — only the text we extract,
          which you'll review on the next screen.
        </p>
        <ResumeUploader />
        <p className="mt-4 text-center text-xs text-ink-mute">
          🔒 Processed in-memory. The original file is discarded after parsing.
        </p>
      </div>
    </div>
  );
}

export function Stepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div className="mb-7 flex justify-center gap-2">
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className={`h-1 w-8 rounded-full ${
            n < step ? 'bg-success' : n === step ? 'bg-brand-500' : 'bg-line'
          }`}
        />
      ))}
    </div>
  );
}
