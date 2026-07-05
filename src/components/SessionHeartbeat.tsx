'use client';
import { useEffect, useRef } from 'react';

const HEARTBEAT_MS = 60_000; // 60s between pings — cheap, accurate enough

/**
 * Mounted once in the (app) layout. Sends a heartbeat to
 * /api/session/heartbeat every 60s while the tab is visible, so the
 * admin panel can report each user's last login + total active time.
 *
 * Design notes:
 *  - The very first ping (sessionId = null) creates a new row on the
 *    server; the response tells us the sessionId to use for the rest
 *    of the tab's lifetime.
 *  - When document.hidden is true (user switched tab / minimised), we
 *    stop the interval. When they come back, we resume the SAME
 *    session (last_seen_at will jump — the gap represents idle time
 *    that we DON'T want to count).
 *  - No React state — just refs. This component renders nothing.
 *  - On beforeunload we fire one final beacon so short sessions
 *    (open tab, close tab) still get a plausible duration.
 */
export function SessionHeartbeat() {
  const sessionIdRef = useRef<string | null>(null);
  const intervalRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    async function ping() {
      if (inFlightRef.current) return; // don't stack pings
      inFlightRef.current = true;
      try {
        const res = await fetch('/api/session/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionIdRef.current }),
          keepalive: true, // survives page unload
        });
        if (res.ok) {
          const j = (await res.json()) as { sessionId?: string };
          if (j.sessionId) sessionIdRef.current = j.sessionId;
        }
      } catch {
        // Silent — the next heartbeat will retry. We never want to
        // interrupt the user with an error toast about telemetry.
      } finally {
        inFlightRef.current = false;
      }
    }

    function start() {
      if (intervalRef.current !== null) return;
      // Fire once immediately (creates the session row), then on interval.
      void ping();
      intervalRef.current = window.setInterval(ping, HEARTBEAT_MS);
    }

    function stop() {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    function onVisibility() {
      if (document.hidden) stop();
      else start();
    }

    function onBeforeUnload() {
      // Best-effort final ping so tabs that close quickly still record
      // a plausible last_seen_at. keepalive: true is essential here.
      if (!sessionIdRef.current) return;
      try {
        fetch('/api/session/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionIdRef.current }),
          keepalive: true,
        });
      } catch {
        // Silent.
      }
    }

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  return null;
}
