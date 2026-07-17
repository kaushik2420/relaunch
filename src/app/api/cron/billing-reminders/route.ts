import { NextResponse, type NextRequest } from 'next/server';
import { serverConfig } from '@/lib/config';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { email } from '@/lib/providers/email';

export const runtime = 'nodejs';

/**
 * Daily cron — emails users whose trial expires in {3, 1, 0} days.
 * Copy is empathetic, never panicked. We mention the hardship channel.
 */
export async function GET(req: NextRequest) {
  const cfg = serverConfig();
  if (req.headers.get('authorization') !== `Bearer ${cfg.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const admin = supabaseAdmin();
  const now = new Date();

  const ranges = [
    { days: 3, subject: '3 days left on your Relaunch trial' },
    { days: 1, subject: 'Trial ends tomorrow — but we wanted to check in first' },
    { days: 0, subject: 'Your Relaunch trial ended — your Sheet stays yours' },
  ];

  let sent = 0;
  for (const r of ranges) {
    const target = new Date(now.getTime() + r.days * 86_400_000);
    const dayStart = startOfDay(target).toISOString();
    const dayEnd = endOfDay(target).toISOString();
    const { data: users } = await admin
      .from('users')
      .select('email, first_name, free_until')
      .eq('is_paying', false)
      .eq('is_active', true)
      .gte('free_until', dayStart)
      .lte('free_until', dayEnd);

    for (const u of users ?? []) {
      await email().send({
        to: u.email,
        subject: r.subject,
        html: bodyFor(u.first_name ?? 'friend', r.days),
      });
      sent++;
    }
  }
  return NextResponse.json({ sent });
}

function bodyFor(name: string, days: number): string {
  const heading =
    days === 0 ? "Your trial ended — your Sheet stays in your Drive."
    : days === 1 ? `One more day, ${name}.`
    : `${days} days left, ${name}.`;
  return `<!doctype html><html><body style="font-family:-apple-system,sans-serif;background:#FAF5E9;padding:24px;color:#1C2220;">
  <table style="max-width:520px;margin:0 auto;background:#fff;padding:24px;border-radius:14px;">
    <tr><td>
      <h1 style="margin:0 0 10px;font-size:22px;">${heading}</h1>
      <p style="margin:0 0 14px;color:#58665C;font-size:14px;">
        ${days === 0
          ? 'Your daily emails will pause until you re-subscribe. Your Google Sheet (and everything in it) stays right where it is — you own it.'
          : `Your free trial ends in ${days} day${days === 1 ? '' : 's'}. After that, Relaunch is ₹399/month — about twice our cost to run it for you.`}
      </p>
      <p style="margin:0 0 14px;font-size:14px;">
        If money is tight right now and you're still in the search,{' '}
        reach out at <a href="mailto:hello@get-relaunch.com" style="color:#2C5239;">hello@get-relaunch.com</a>.
        We have a hardship program. No questions asked.
      </p>
      <a href="https://www.get-relaunch.com/billing" style="display:inline-block;background:#2C5239;color:white;padding:10px 16px;border-radius:8px;font-weight:600;text-decoration:none;">Continue on Relaunch Pro</a>
    </td></tr>
  </table></body></html>`;
}

function startOfDay(d: Date) { const x = new Date(d); x.setUTCHours(0,0,0,0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setUTCHours(23,59,59,999); return x; }
