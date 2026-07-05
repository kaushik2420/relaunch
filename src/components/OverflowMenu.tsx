"use client";
import { useEffect, useRef, useState } from "react";

/**
 * A tiny, unopinionated overflow menu ("⋯") — used on JobCard to
 * collapse secondary actions (résumé PDF, cover-letter PDF, editable
 * copies, like/hide) that used to be scattered across the card's
 * bottom row.
 *
 * Behaviour:
 *  - Click the trigger to open
 *  - Click outside → close
 *  - Escape key → close
 *  - Selecting an item does NOT auto-close (some items are anchor tags
 *    that open in a new tab and it's nicer to leave the menu open),
 *    but callers can pass closeOnSelect and use the exposed close prop.
 *
 * Deliberately no library — keeps the bundle small and lets us match
 * Backyard's cream/forest palette without fighting a headless-ui theme.
 */
export function OverflowMenu({
  children,
  label = "More actions",
  align = "right",
}: {
  children: (close: () => void) => React.ReactNode;
  label?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-line text-ink-soft transition hover:bg-cream-100 ${
          open ? "bg-cream-100 text-ink" : "bg-white"
        }`}
      >
        <span className="text-lg leading-none">⋯</span>
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-20 mt-1 min-w-[180px] rounded-lg border border-line bg-white py-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

/**
 * Convenience item — a link that renders inside <OverflowMenu>. Opens
 * in a new tab for external URLs, respects the "close on select" prop.
 */
export function OverflowMenuLink({
  href,
  children,
  onClick,
  external = true,
}: {
  href: string;
  children: React.ReactNode;
  onClick?: () => void;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      role="menuitem"
      onClick={onClick}
      className="block px-3 py-1.5 text-xs text-ink hover:bg-cream-50"
    >
      {children}
    </a>
  );
}

/**
 * Convenience item — a button that renders inside <OverflowMenu>.
 * Useful for actions that don't navigate (like reactions or state
 * toggles).
 */
export function OverflowMenuButton({
  children,
  onClick,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-cream-50 ${
        variant === "danger" ? "text-danger" : "text-ink"
      }`}
    >
      {children}
    </button>
  );
}
