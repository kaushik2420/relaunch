"use client";
import { useFormStatus } from "react-dom";
import { Spinner } from "./Spinner";

/**
 * Drop-in submit button for any form with a server (or client) action.
 * Reads form pending state from useFormStatus and swaps in a spinner +
 * pending label while the action runs, so the user always sees that
 * something is happening on click. MUST be rendered inside a <form>.
 *
 * Usage:
 *   <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
 *   <SubmitButton className="btn-ghost text-xs">Resend</SubmitButton>
 */
export function SubmitButton({
  children,
  pendingLabel,
  className = "btn-primary",
  ...rest
}: {
  children: React.ReactNode;
  pendingLabel?: React.ReactNode;
  className?: string;
} & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "disabled" | "children" | "className"
>) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${className} disabled:cursor-wait disabled:opacity-80`}
      {...rest}
    >
      {pending ? (
        <span className="inline-flex items-center justify-center gap-2">
          <Spinner size={14} />
          <span>{pendingLabel ?? children}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
