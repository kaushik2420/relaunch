import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
} from 'docx';
import type { UserProfile, TailoredResume, CoverLetter } from '@/lib/types';

/**
 * Editable two-column resume as a real .docx file.
 *
 * Mirrors the PDF design (header + tinted sidebar + main column) but as
 * a native Word document — opens cleanly and editably in Google Docs,
 * Word, or Pages. The two columns are a borderless table, the standard
 * way Word resume templates do columns.
 */

const ACCENT = '5B6CFF';
const INK = '1F2430';
const MUTE = '5B6477';
const SIDEBAR_BG = 'EEF0FF';
const BASE_FONT = 'Calibri';

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'auto' } as const;
const NO_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
  insideHorizontal: NO_BORDER,
  insideVertical: NO_BORDER,
};

export async function renderResumeDocx(
  profile: UserProfile,
  tailored: TailoredResume,
): Promise<Buffer> {
  const name = (profile.fullName || 'Your Name').trim();
  const headline = (profile.headline || '').trim();

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: BASE_FONT, size: 20, color: INK } },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 720, bottom: 720, left: 864, right: 864 } },
        },
        children: [
          // ---- Header ----
          new Paragraph({
            spacing: { after: 40 },
            children: [new TextRun({ text: name, bold: true, size: 46, color: INK })],
          }),
          ...(headline
            ? [
                new Paragraph({
                  spacing: { after: 40 },
                  children: [new TextRun({ text: headline, bold: true, size: 22, color: ACCENT })],
                }),
              ]
            : []),
          new Paragraph({
            spacing: { after: 160 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 12, space: 6, color: ACCENT } },
            children: [new TextRun({ text: contactLine(profile), size: 17, color: MUTE })],
          }),

          // ---- Two-column body ----
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: NO_BORDERS,
            columnWidths: [3250, 6350],
            rows: [
              new TableRow({
                cantSplit: false,
                children: [
                  new TableCell({
                    width: { size: 34, type: WidthType.PERCENTAGE },
                    shading: { type: ShadingType.CLEAR, color: 'auto', fill: SIDEBAR_BG },
                    margins: { top: 160, bottom: 160, left: 160, right: 160 },
                    children: sidebarContent(profile, tailored),
                  }),
                  new TableCell({
                    width: { size: 66, type: WidthType.PERCENTAGE },
                    margins: { top: 160, bottom: 160, left: 240, right: 80 },
                    children: mainContent(profile, tailored),
                  }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

/**
 * Editable cover letter as a .docx — single column, standard letter
 * format. Mirrors the PDF cover letter so the two stay consistent.
 */
export async function renderCoverLetterDocx(
  profile: UserProfile,
  letter: CoverLetter,
  company: string,
  role: string,
): Promise<Buffer> {
  const name = (profile.fullName || 'Your Name').trim();
  const today = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const doc = new Document({
    styles: {
      default: { document: { run: { font: BASE_FONT, size: 21, color: INK } } },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1080, bottom: 1080, left: 1180, right: 1180 } },
        },
        children: [
          new Paragraph({
            children: [new TextRun({ text: name, bold: true, size: 40, color: INK })],
          }),
          new Paragraph({
            spacing: { after: 200 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 8, space: 6, color: ACCENT } },
            children: [new TextRun({ text: contactLine(profile), size: 17, color: MUTE })],
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [new TextRun({ text: today, size: 19, color: MUTE })],
          }),
          new Paragraph({
            spacing: { after: 240 },
            children: [
              new TextRun({
                text: `Re: Application for ${role}${company ? ` at ${company}` : ''}`,
                bold: true,
                size: 21,
                color: ACCENT,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 160 },
            children: [new TextRun({ text: letter.greeting, size: 21 })],
          }),
          ...letter.paragraphs.map(
            (p) =>
              new Paragraph({
                spacing: { after: 160 },
                children: [new TextRun({ text: p, size: 21 })],
              }),
          ),
          new Paragraph({
            spacing: { before: 80 },
            children: [new TextRun({ text: letter.closing, size: 21 })],
          }),
          new Paragraph({
            children: [new TextRun({ text: name, bold: true, size: 21 })],
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------
// Column content
// ---------------------------------------------------------------

function sidebarContent(profile: UserProfile, tailored: TailoredResume): Paragraph[] {
  const out: Paragraph[] = [];

  const skills = tailored.highlightedSkills?.length
    ? tailored.highlightedSkills
    : profile.skills ?? [];
  if (skills.length) {
    out.push(heading('Core Skills', false));
    for (const sk of skills) {
      out.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 30 },
          children: [new TextRun({ text: sk, size: 19 })],
        }),
      );
    }
  }

  const education = profile.education ?? [];
  if (education.length) {
    out.push(heading('Education', out.length > 0));
    for (const e of education) {
      out.push(
        new Paragraph({
          children: [new TextRun({ text: e.degree || 'Degree', bold: true, size: 19 })],
        }),
      );
      out.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: [e.school, e.year].filter(Boolean).join(' · '),
              size: 18,
              color: MUTE,
            }),
          ],
        }),
      );
    }
  }

  const links = linkItems(profile);
  if (links.length) {
    out.push(heading('Links', out.length > 0));
    for (const l of links) {
      out.push(
        new Paragraph({
          spacing: { after: 30 },
          children: [new TextRun({ text: l, size: 17, color: ACCENT })],
        }),
      );
    }
  }

  return out.length ? out : [new Paragraph('')];
}

function mainContent(profile: UserProfile, tailored: TailoredResume): Paragraph[] {
  const out: Paragraph[] = [];

  if (tailored.summary?.trim()) {
    out.push(heading('Summary', false));
    out.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: tailored.summary.trim(), size: 20 })],
      }),
    );
  }

  const experience = tailored.experienceBullets ?? [];
  if (experience.length) {
    out.push(heading('Experience', out.length > 0));
    for (const e of experience) {
      const dates = datesFor(profile, e.company);
      out.push(
        new Paragraph({
          spacing: { before: 80 },
          children: [new TextRun({ text: e.title || 'Role', bold: true, size: 21 })],
        }),
      );
      out.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({ text: e.company || '', bold: true, size: 18, color: ACCENT }),
            ...(dates
              ? [new TextRun({ text: `   ·   ${dates}`, size: 18, color: MUTE })]
              : []),
          ],
        }),
      );
      for (const b of e.bullets ?? []) {
        out.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 30 },
            children: [new TextRun({ text: b, size: 20 })],
          }),
        );
      }
    }
  }

  return out.length ? out : [new Paragraph('')];
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

/** Accent-colored, underlined uppercase section heading. */
function heading(label: string, withTopGap: boolean): Paragraph {
  return new Paragraph({
    spacing: { before: withTopGap ? 240 : 0, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 2, color: ACCENT } },
    children: [
      new TextRun({ text: label.toUpperCase(), bold: true, size: 18, color: ACCENT }),
    ],
  });
}

function contactLine(profile: UserProfile): string {
  const l = profile.links ?? {};
  return [l.email, l.phone, profile.location].filter(Boolean).join('   ·   ');
}

function linkItems(profile: UserProfile): string[] {
  const l = profile.links ?? {};
  return [l.linkedin, l.github, l.portfolio]
    .filter((x): x is string => !!x)
    .map((u) => u.replace(/^https?:\/\//i, '').replace(/\/$/, ''));
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
