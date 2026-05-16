"use client";
import { useEffect } from "react";
import posthog from "posthog-js";

export function PostHogIdentifier({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  useEffect(() => {
    posthog.identify(userId, { email });
  }, [userId, email]);
  return null;
}
