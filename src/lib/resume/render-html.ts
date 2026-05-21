import type { UserProfile, TailoredResume } from '@/lib/types';

/**
 * Renders a tailored resume as a designed two-column HTML document.
 *
 * Why HTML: Google Drive can import an HTML file straight into a
 * formatted Google Doc (headings, tables, colors, bullets all survive).
 * We then export that same Doc to PDF via the Drive API — so the Doc
 * and the PDF are visually identical, and we need exactly one renderer
 * and zero extra dependencies.
 *
 * Layout:
 *   ┌───────────────────────────────────────────┐
 *   │  NAME                                      │  full-width header
 *   │  headline · contact line                   │
 *   ├──────────────┬────────────────────────────┤
 *   │  SKILLS       │  SUMMARY                   │
 *   │  EDUCATION    │  EXPERIENCE                │  two columns
 *   │  LINKS        │   • bullets...             │
 *   └──────────────┴────────────────────────────┘
 *
 * Drive's HTML importer is most reliable with INLINE styles, so every
 * style here is inline on purpose — no <style> block.
 */

const ACCENT = '#5B6CFF';
const INK = '#1F2430';
const MUTE = '#5B6477';
const SIDEBAR_BG = '#EEF0FF';

export function renderResumeHtml(profile: UserProfile, tailored: TailoredResume): string {
  const name = (profile.fullName || 'Your Name').trim();
  const headline = (profile.headline || '').trim();

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${esc(name)} — Resume</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:${INK};font-size:10.5pt;line-height:1.4;margin:0;">

  <div style="border-bottom:2.5pt solid ${ACCENT};padding-bottom:8pt;margin-bottom:14pt;">
    <h1 style="font-size:24pt;margin:0;color:${INK};letter-spacing:0.3pt;">${esc(name)}</h1>
    ${headline ? `<p style="font-size:11pt;color:${ACCENT};font-weight:bold;margin:3pt 0 0;">${esc(headline)}</p>` : ''}
    <p style="font-size:9pt;color:${MUTE};margin:5pt 0 0;">${contactLine(profile)}</p>
  </div>

  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="width:33%;vertical-align:top;background-color:${SIDEBAR_BG};padding:12pt;">
        ${sidebar(profile, tailored)}
      </td>
      <td style="width:3%;"></td>
      <td style="width:64%;vertical-align:top;padding:4pt 0;">
        ${mainColumn(profile, tailored)}
      </td>
    </tr>
  </table>

</body>
</html>`;
}

// ---------------------------------------------------------------
// Sections
// ---------------------------------------------------------------

function sidebar(profile: UserProfile, tailored: TailoredResume): string {
  const parts: string[] = [];

  const skills = tailored.highlightedSkills?.length
    ? tailored.highlightedSkills
    : profile.skills ?? [];
  if (skills.length) {
    parts.push(sectionHeading('Core Skills'));
    parts.push(
      `<ul style="margin:0 0 14pt;padding-left:14pt;">${skills
        .map((s) => `<li style="margin-bottom:3pt;">${esc(s)}</li>`)
        .join('')}</ul>`,
    );
  }

  if (profile.education?.length) {
    parts.push(sectionHeading('Education'));
    parts.push(
      profile.education
        .map(
          (e) => `<p style="margin:0 0 10pt;">
            <strong>${esc(e.degree || 'Degree')}</strong><br>
            <span style="color:${MUTE};">${esc(e.school || '')}${e.year ? ` · ${esc(e.year)}` : ''}</span>
          </p>`,
        )
        .join(''),
    );
  }

  const links = linkItems(profile);
  if (links.length) {
    parts.push(sectionHeading('Links'));
    parts.push(
      `<p style="margin:0;font-size:9pt;word-break:break-all;">${links
        .map((l) => `<span style="color:${ACCENT};">${esc(l)}</span>`)
        .join('<br>')}</p>`,
    );
  }

  return parts.join('');
}

function mainColumn(profile: UserProfile, tailored: TailoredResume): string {
  const parts: string[] = [];

  if (tailored.summary?.trim()) {
    parts.push(sectionHeading('Summary'));
    parts.push(`<p style="margin:0 0 14pt;">${esc(tailored.summary.trim())}</p>`);
  }

  const exp = tailored.experienceBullets ?? [];
  if (exp.length) {
    parts.push(sectionHeading('Experience'));
    for (const e of exp) {
      const dates = datesFor(profile, e.company);
      parts.push(`<div style="margin-bottom:12pt;">
        <p style="margin:0;font-size:11pt;"><strong>${esc(e.title || 'Role')}</strong></p>
        <p style="margin:1pt 0 4pt;color:${ACCENT};font-size:9.5pt;font-weight:bold;">
          ${esc(e.company || '')}${dates ? ` <span style="color:${MUTE};font-weight:normal;">· ${esc(dates)}</span>` : ''}
        </p>
        <ul style="margin:0;padding-left:16pt;">
          ${(e.bullets ?? [])
            .map((b) => `<li style="margin-bottom:3pt;">${esc(b)}</li>`)
            .join('')}
        </ul>
      </div>`);
    }
  }

  return parts.join('');
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function sectionHeading(label: string): string {
  return `<p style="font-size:9pt;font-weight:bold;letter-spacing:1.5pt;text-transform:uppercase;color:${ACCENT};border-bottom:1pt solid ${ACCENT};padding-bottom:2pt;margin:0 0 7pt;">${esc(
    label,
  )}</p>`;
}

function contactLine(profile: UserProfile): string {
  const bits: string[] = [];
  const l = profile.links ?? {};
  if (l.email) bits.push(esc(l.email));
  if (l.phone) bits.push(esc(l.phone));
  if (profile.location) bits.push(esc(profile.location));
  return bits.join('  ·  ');
}

function linkItems(profile: UserProfile): string[] {
  const l = profile.links ?? {};
  const out: string[] = [];
  if (l.linkedin) out.push(stripScheme(l.linkedin));
  if (l.github) out.push(stripScheme(l.github));
  if (l.portfolio) out.push(stripScheme(l.portfolio));
  return out;
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

/** Best-effort: pull "from – to" dates from the original profile by company name. */
function datesFor(profile: UserProfile, company: string): string {
  const match = (profile.experience ?? []).find(
    (x) => x.company?.trim().toLowerCase() === company?.trim().toLowerCase(),
  );
  if (!match) return '';
  const from = match.from?.trim() ?? '';
  const to = match.to?.trim() ?? '';
  if (from && to) return `${from} – ${to}`;
  return from || to || '';
}

function esc(s: string): string {
  return String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}
