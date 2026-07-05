'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { signOutAction } from '@/app/(auth)/actions';

type TrialStatus =
  | 'trial-active'
  | 'trial-expiring'
  | 'trial-expired'
  | 'paying'
  | 'inactive';

/**
 * Primary in-app navigation. Redesigned from a flat row of 8+ links
 * into a compact set of 4 primary tabs + two menus:
 *
 *   Dashboard   Matches   Boost   Tools ▾           [ ⚙ / avatar ▾ ]
 *
 * "Tools ▾"  → Polish résumé, Upskill
 * Avatar     → Watched companies, Settings, Feedback, Sign out
 *
 * All active-state highlighting driven by the current pathname.
 */
export function NavTabs({
  trialStatus,
  daysLeft,
  userInitial,
  userEmail,
}: {
  trialStatus: TrialStatus;
  daysLeft: number;
  userInitial: string;
  userEmail: string;
}) {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-3 text-sm text-ink-soft">
      {trialStatus === 'trial-active' && (
        <span className="hidden md:inline text-xs">
          Free for {daysLeft} more {daysLeft === 1 ? 'day' : 'days'}
        </span>
      )}
      {trialStatus === 'trial-expiring' && (
        <Link href="/billing" className="chip-accent">
          Trial ends in {daysLeft} d → upgrade
        </Link>
      )}
      {trialStatus === 'trial-expired' && (
        <Link href="/billing" className="chip-accent">
          Upgrade to continue
        </Link>
      )}

      {/* Primary tabs live inside a cream pill so they read as a group,
          distinct from the trial chip on the left and the user menu on
          the right. Dashboard, Matches, and Tools are the three every-
          day tabs; Tools ▾ collapses Polish + Upskill + Boost. */}
      <div className="flex items-center gap-1 rounded-full border border-line bg-cream-100 p-1">
        <PrimaryTab href="/dashboard" pathname={pathname}>
          Dashboard
        </PrimaryTab>
        <PrimaryTab href="/all-matches" pathname={pathname}>
          Matches
        </PrimaryTab>
        <ToolsMenu pathname={pathname} />
      </div>

      <UserMenu
        userInitial={userInitial}
        userEmail={userEmail}
        pathname={pathname}
      />
    </div>
  );
}

function PrimaryTab({
  href,
  pathname,
  children,
}: {
  href: string;
  pathname: string;
  children: React.ReactNode;
}) {
  const active = pathname === href || pathname.startsWith(href + '/');
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm'
          : 'rounded-full px-3 py-1 text-xs text-ink-soft hover:bg-white/60 hover:text-ink'
      }
    >
      {children}
    </Link>
  );
}

/**
 * Tools ▾ dropdown — Polish résumé + Upskill live here so the primary
 * nav stays uncluttered. Both are secondary "when needed" features
 * rather than daily-use pages.
 */
function ToolsMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active =
    pathname.startsWith('/polish') ||
    pathname.startsWith('/upskill') ||
    pathname.startsWith('/boost');

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const triggerClass =
    active || open
      ? 'inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm'
      : 'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs text-ink-soft hover:bg-white/60 hover:text-ink';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={triggerClass}
      >
        Tools
        <svg
          width="9"
          height="9"
          viewBox="0 0 12 12"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-[200px] rounded-lg border border-line bg-white py-1 shadow-lg"
        >
          <MenuLink
            href="/boost"
            active={pathname.startsWith('/boost')}
            onClick={() => setOpen(false)}
          >
            ⚡ Boost — LinkedIn presence
          </MenuLink>
          <MenuLink
            href="/polish"
            active={pathname.startsWith('/polish')}
            onClick={() => setOpen(false)}
          >
            ✏️ Polish résumé
          </MenuLink>
          <MenuLink
            href="/upskill"
            active={pathname.startsWith('/upskill')}
            onClick={() => setOpen(false)}
          >
            🎓 Upskill
          </MenuLink>
        </div>
      )}
    </div>
  );
}

/**
 * User avatar menu — account-level things live here (Watched
 * companies, Settings, Feedback, Sign out) so they don't compete for
 * space with feature tabs.
 */
function UserMenu({
  userInitial,
  userEmail,
  pathname,
}: {
  userInitial: string;
  userEmail: string;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white transition ${
          open ? 'bg-brand-600' : 'bg-brand-500 hover:bg-brand-600'
        }`}
      >
        {userInitial.toUpperCase()}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-[220px] rounded-lg border border-line bg-white py-1 shadow-lg"
        >
          <div className="border-b border-line pb-1.5 px-3 pt-2">
            <p className="text-[10px] uppercase tracking-wide text-ink-mute">
              Signed in as
            </p>
            <p className="text-xs font-medium text-ink truncate">{userEmail}</p>
          </div>
          <div className="py-1">
            <MenuLink
              href="/watched-companies"
              active={pathname.startsWith('/watched-companies')}
              onClick={() => setOpen(false)}
            >
              ⭐ Watched companies
            </MenuLink>
            <MenuLink
              href="/settings"
              active={pathname.startsWith('/settings')}
              onClick={() => setOpen(false)}
            >
              ⚙️ Settings
            </MenuLink>
            <MenuLink
              href="/feedback"
              active={pathname.startsWith('/feedback')}
              onClick={() => setOpen(false)}
            >
              💬 Feedback
            </MenuLink>
          </div>
          <div className="border-t border-line pt-1">
            <form action={signOutAction}>
              <button
                type="submit"
                role="menuitem"
                className="block w-full px-3 py-1.5 text-left text-xs text-danger hover:bg-cream-50"
              >
                ↩ Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  active,
  children,
  onClick,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className={`block px-3 py-1.5 text-xs hover:bg-cream-50 ${
        active ? 'font-semibold text-brand-700' : 'text-ink'
      }`}
    >
      {children}
    </Link>
  );
}
