/**
 * Payment provider interface.
 * We deliberately keep this tiny — we don't need invoicing, taxes, etc.
 * The provider handles subscription lifecycle; we just track events.
 */

export interface CreateSubscriptionInput {
  user: { id: string; email: string; firstName: string | null };
  /** Plan/price id in the provider's own system */
  planId?: string;
  /** Where to send the user after successful checkout */
  successUrl: string;
  cancelUrl: string;
}

export interface CreateSubscriptionResult {
  /** Provider's subscription id (store for webhook lookups) */
  subscriptionId: string;
  /** Hosted checkout URL to redirect the user to */
  checkoutUrl: string;
}

export interface WebhookEvent {
  type: string;            // 'subscription.activated' | 'invoice.paid' | 'subscription.cancelled' ...
  providerId: string;      // subscription id / invoice id
  userId?: string;         // if we can extract it
  amountMinor?: number;    // paise / cents
  currency?: string;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: 'razorpay' | 'stripe';

  /** Start a subscription checkout flow */
  createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult>;

  /** Cancel an existing subscription at period end */
  cancelSubscription(subscriptionId: string): Promise<void>;

  /**
   * Validate + parse a webhook. Implementations verify signatures.
   * Returns null if the signature is invalid (caller should 400).
   */
  parseWebhook(rawBody: string, headers: Record<string, string>): Promise<WebhookEvent | null>;
}
