"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";

const STEPS = [
  "Reading the file…",
  "Extracting your skills & roles…",
  "Detecting seniority & location…",
  "Finding your LinkedIn & portfolio…",
  "All set ✨",
];

export function ResumeUploader() {
  const router = useRouter();
  const [progress, setProgress] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setErr(null);

    const stepInterval = setInterval(() => {
      setStepIdx((s) => Math.min(STEPS.length - 1, s + 1));
      setProgress((p) => Math.min(90, p + 18));
    }, 700);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/resume/parse", {
        method: "POST",
        body: fd,
      });
      if (!res.ok)
        throw new Error((await res.json()).error ?? "Failed to parse");
      clearInterval(stepInterval);
      setProgress(100);
      setStepIdx(STEPS.length - 1);
      posthog.capture("resume_uploaded", {
        file_type: file.type,
        file_size_bytes: file.size,
      });
      router.push("/onboarding/profile");
    } catch (e) {
      clearInterval(stepInterval);
      const message = (e as Error).message;
      posthog.capture("resume_upload_failed", {
        error: message,
        file_type: file.type,
        file_size_bytes: file.size,
      });
      posthog.captureException(e);
      setErr(message);
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <div className="mt-6 text-center">
        <div className="mx-auto h-12 w-12 grid place-items-center rounded-full bg-brand-50 text-2xl">
          📄
        </div>
        <h3 className="mt-3 font-semibold">{STEPS[stepIdx]}</h3>
        <div className="mx-auto mt-3 h-2 max-w-xs overflow-hidden rounded-full bg-line">
          <div
            className="h-full bg-gradient-to-r from-brand-500 to-accent-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <label className="mt-6 block cursor-pointer rounded-lg border-2 border-dashed border-line bg-surface-page/60 p-10 text-center transition hover:border-brand-500 hover:bg-brand-50">
        <div className="mx-auto h-14 w-14 grid place-items-center rounded-full bg-brand-50 text-3xl">
          📄
        </div>
        <h3 className="mt-3 font-semibold">Drop your resume here</h3>
        <p className="text-xs text-ink-soft">PDF, DOCX or TXT · up to 10 MB</p>
        <span className="btn-primary mt-3 inline-flex">Choose file</span>
        <input
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
      </label>
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
    </>
  );
}
