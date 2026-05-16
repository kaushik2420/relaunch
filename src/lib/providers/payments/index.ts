import { serverConfig } from '@/lib/config';
import type { PaymentProvider } from './types';
import { RazorpayProvider } from './razorpay';

let _payments: PaymentProvider | undefined;
export function payments(): PaymentProvider {
  if (_payments) return _payments;
  const provider = serverConfig().PAYMENT_PROVIDER;
  switch (provider) {
    case 'razorpay':
      _payments = new RazorpayProvider();
      return _payments;
    case 'stripe':
      // Stub: implement StripeProvider when expanding outside India.
      // Same shape as RazorpayProvider; uses Checkout Sessions for subs.
      throw new Error('Stripe provider not yet implemented — set PAYMENT_PROVIDER=razorpay');
    default:
      throw new Error(`Unknown PAYMENT_PROVIDER: ${provider as string}`);
  }
}

export type { PaymentProvider } from './types';
