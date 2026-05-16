import { PostHog } from "posthog-node";

/**
 * Server-side PostHog client.
 *
 * Returns a real PostHog client if NEXT_PUBLIC_POSTHOG_KEY (or
 * NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) is set; otherwise returns a no-op
 * stub so feature code can call .capture()/.shutdown() unconditionally
 * without crashing if analytics isn't wired up yet.
 *
 * Cached at module level — never instantiate more than one PostHog
 * client per process. Re-creating per-request leaks event queues.
 */

interface PostHogLike {
  capture: (event: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
  }) => void;
  identify: (input: {
    distinctId: string;
    properties?: Record<string, unknown>;
  }) => void;
  shutdown: () => Promise<void>;
}

let _client: PostHogLike | undefined;

export function getPostHogClient(): PostHogLike {
  if (_client) return _client;

  const apiKey =
    process.env.NEXT_PUBLIC_POSTHOG_KEY ||
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

  if (!apiKey) {
    // No PostHog configured — return a silent no-op so callers don't
    // need to special-case the "analytics is off" path everywhere.
    _client = {
      capture: () => {},
      identify: () => {},
      shutdown: async () => {},
    };
    return _client;
  }

  _client = new PostHog(apiKey, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
  });
  return _client;
}
