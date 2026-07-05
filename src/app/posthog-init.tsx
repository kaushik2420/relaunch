'use client';
import posthog from 'posthog-js';
import { useEffect } from 'react';

/**
 * Client-side PostHog initialisation.
 *
 * Guarded on NEXT_PUBLIC_POSTHOG_KEY — if the env var is unset, we
 * silently skip init so local development / CI without PostHog set up
 * doesn't error. The rest of the codebase's posthog.capture(...) calls
 * become no-ops in that state.
 *
 * The api_host points directly at posthog's ingest host. If you want
 * ad-blocker resilience later, add a rewrite in next.config.mjs to
 * proxy /ingest → NEXT_PUBLIC_POSTHOG_HOST and change api_host to
 * '/ingest' — see docs/SETUP_POSTHOG.md.
 */
export function PostHogInit() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!token) return;
    if ((posthog as unknown as { __loaded?: boolean }).__loaded) return;

    posthog.init(token, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
      capture_exceptions: true,
      person_profiles: 'identified_only',
      debug: process.env.NODE_ENV === 'development',
    });
  }, []);

  return null;
}
