import { Resend } from 'resend';
import { serverConfig } from '@/lib/config';
import type { EmailMessage, EmailProvider } from './types';

export class ResendProvider implements EmailProvider {
  readonly name = 'resend' as const;
  private client: Resend;

  constructor() {
    const cfg = serverConfig();
    if (!cfg.RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
    this.client = new Resend(cfg.RESEND_API_KEY);
  }

  async send(msg: EmailMessage): Promise<{ id: string }> {
    const cfg = serverConfig();
    const res = await this.client.emails.send({
      from: msg.from ?? cfg.FROM_EMAIL,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      replyTo: msg.replyTo,
    });
    if (res.error) throw new Error(`Resend send failed: ${res.error.message}`);
    return { id: res.data?.id ?? '' };
  }
}
