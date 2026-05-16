import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { serverConfig } from '@/lib/config';
import type {
  CreateSubscriptionInput,
  CreateSubscriptionResult,
  PaymentProvider,
  WebhookEvent,
} from './types';

export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay' as const;
  private client: Razorpay;

  constructor() {
    const cfg = serverConfig();
    if (!cfg.RAZORPAY_KEY_ID || !cfg.RAZORPAY_KEY_SECRET) {
      throw new Error('RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not set');
    }
    this.client = new Razorpay({
      key_id: cfg.RAZORPAY_KEY_ID,
      key_secret: cfg.RAZORPAY_KEY_SECRET,
    });
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult> {
    const cfg = serverConfig();
    const planId = input.planId ?? cfg.RAZORPAY_PLAN_ID;
    if (!planId) throw new Error('RAZORPAY_PLAN_ID not set');

    const sub = await this.client.subscriptions.create({
      plan_id: planId,
      customer_notify: 1,
      total_count: 12, // re-bills monthly, 12 cycles = ~1 year
      notes: { user_id: input.user.id, app: 'relaunch' },
    });

    // Razorpay subscriptions don't return a hosted checkout URL directly;
    // we render the standard Razorpay Checkout JS with this subscription id.
    // Convention: our app's /billing/checkout?sub_id=<id> renders the JS.
    return {
      subscriptionId: sub.id,
      checkoutUrl: `/billing/checkout?sub_id=${sub.id}`,
    };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.client.subscriptions.cancel(subscriptionId, false);
  }

  async parseWebhook(rawBody: string, headers: Record<string, string>): Promise<WebhookEvent | null> {
    const cfg = serverConfig();
    if (!cfg.RAZORPAY_WEBHOOK_SECRET) {
      throw new Error('RAZORPAY_WEBHOOK_SECRET not set');
    }
    const signature = headers['x-razorpay-signature'] ?? headers['X-Razorpay-Signature'];
    if (!signature) return null;

    const expected = crypto
      .createHmac('sha256', cfg.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (!timingSafeEq(signature, expected)) return null;

    const evt = JSON.parse(rawBody);
    const payload = evt.payload ?? {};
    const sub = payload.subscription?.entity;
    const inv = payload.payment?.entity;

    return {
      type: evt.event,
      providerId: sub?.id ?? inv?.subscription_id ?? inv?.id ?? '',
      userId: sub?.notes?.user_id,
      amountMinor: inv?.amount,
      currency: inv?.currency,
      raw: evt,
    };
  }
}

function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
