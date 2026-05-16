import { NextResponse, type NextRequest } from "next/server";
import { payments } from "@/lib/providers/payments";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPostHogClient } from "@/lib/posthog-server";

export const runtime = "nodejs";

/**
 * Razorpay webhook handler.
 * Events we care about:
 *   subscription.activated  → flip is_paying = true
 *   subscription.cancelled  → flip is_paying = false (next renewal will fail)
 *   subscription.completed  → flip is_paying = false
 *   invoice.paid            → log the payment (audit only)
 * Anything else: log and 200.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const headers = Object.fromEntries(req.headers.entries());
  const evt = await payments().parseWebhook(raw, headers);
  if (!evt)
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });

  const admin = supabaseAdmin();

  // Persist the event regardless of type (audit trail)
  await admin.from("billing_events").insert({
    user_id: evt.userId ?? null,
    provider: "razorpay",
    event_type: evt.type,
    provider_id: evt.providerId,
    amount_minor: evt.amountMinor ?? null,
    currency: evt.currency ?? null,
    payload: evt.raw,
  });

  if (!evt.userId) return NextResponse.json({ ok: true });

  const posthog = getPostHogClient();
  const phProps = {
    provider_id: evt.providerId,
    amount_minor: evt.amountMinor ?? undefined,
    currency: evt.currency ?? undefined,
  };

  switch (evt.type) {
    case "subscription.activated":
      await admin
        .from("users")
        .update({ is_paying: true })
        .eq("id", evt.userId);
      posthog.capture({
        distinctId: evt.userId,
        event: "subscription_activated",
        properties: phProps,
      });
      break;
    case "subscription.charged":
      await admin
        .from("users")
        .update({ is_paying: true })
        .eq("id", evt.userId);
      posthog.capture({
        distinctId: evt.userId,
        event: "subscription_charged",
        properties: phProps,
      });
      break;
    case "subscription.cancelled":
    case "subscription.completed":
    case "subscription.expired":
      await admin
        .from("users")
        .update({ is_paying: false })
        .eq("id", evt.userId);
      posthog.capture({
        distinctId: evt.userId,
        event: "subscription_cancelled",
        properties: { ...phProps, reason: evt.type },
      });
      break;
  }

  await posthog.shutdown();
  return NextResponse.json({ ok: true });
}
