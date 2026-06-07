"use client";
import { useState } from "react";

export function CopyButton({
  text,
  label = "Copy draft",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard blocked; ignore */
        }
      }}
      className="btn-primary text-xs"
    >
      {copied ? "✓ Copied" : label}
    </button>
  );
}
