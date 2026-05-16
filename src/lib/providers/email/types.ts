export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** From override (default: FROM_EMAIL env) */
  from?: string;
  /** ReplyTo override */
  replyTo?: string;
}

export interface EmailProvider {
  readonly name: 'resend' | 'gmail';
  send(msg: EmailMessage): Promise<{ id: string }>;
}
