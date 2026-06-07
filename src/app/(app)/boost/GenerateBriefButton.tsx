"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Spinner";
import { generateMyBriefAction } from "./actions";

export function GenerateBriefButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await generateMyBriefAction();
          router.refresh();
        })
      }
      className="btn-primary mt-6 inline-flex disabled:cursor-wait disabled:opacity-80"
    >
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <Spinner size={14} />
          <span>Drafting your brief…</span>
        </span>
      ) : (
        "✨ Generate this week's brief"
      )}
    </button>
  );
}
