import { serverConfig } from '@/lib/config';
import type { EmailProvider } from './types';
import { ResendProvider } from './resend';

let _email: EmailProvider | undefined;
export function email(): EmailProvider {
  if (_email) return _email;
  const provider = serverConfig().EMAIL_PROVIDER;
  switch (provider) {
    case 'resend':
      _email = new ResendProvider();
      return _email;
    case 'gmail':
      // Gmail send (per-user OAuth) is implemented in services/daily-runner.ts
      // because it needs the user's refresh token. This provider slot is
      // for system-level emails (welcome, reminders) where Resend is right.
      throw new Error('System-level email must use Resend; per-user emails go through gmail-send service');
    default:
      throw new Error(`Unknown EMAIL_PROVIDER: ${provider as string}`);
  }
}

export type { EmailProvider, EmailMessage } from './types';
