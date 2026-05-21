import { google, sheets_v4 } from 'googleapis';
import { serverConfig } from '@/lib/config';
import type { SheetsProvider, SheetMatchRow } from './types';
import type { TailoredJobMatch, UserProfile, TailoredResume, CoverLetter } from '@/lib/types';
import { renderResumePdf, renderCoverLetterPdf } from '@/lib/resume/render-pdf';
import { renderResumeDocx, renderCoverLetterDocx } from '@/lib/resume/render-docx';
import { Readable } from 'node:stream';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const HEADERS = [
  'Date',
  'Company',
  'Role',
  'Match %',
  'Location',
  'Mode',
  'Expected CTC',
  'Job Link',
  'Resume (PDF)',    // column I — polished PDF link
  'Referrer(s)',
  'InMail',
  'Applied?',
  'Outcome',
  'Notes',
  'Reaction',             // column O — '👍 liked' / '👎 hidden' / ''
  'Resume (Editable)',    // column P — editable .docx link
  'Cover Letter (PDF)',   // column Q
  'Cover Letter (Editable)', // column R — editable .docx link
];

export class GoogleSheetsProvider implements SheetsProvider {
  // ----------------------------------------------------------------
  private auth(refreshToken: string) {
    const cfg = serverConfig();
    const oauth2 = new google.auth.OAuth2(
      cfg.GOOGLE_CLIENT_ID,
      cfg.GOOGLE_CLIENT_SECRET,
      cfg.GOOGLE_OAUTH_REDIRECT
    );
    oauth2.setCredentials({ refresh_token: refreshToken });
    return oauth2;
  }

  private sheetsClient(refreshToken: string): sheets_v4.Sheets {
    return google.sheets({ version: 'v4', auth: this.auth(refreshToken) });
  }

  // ----------------------------------------------------------------
  async createUserSheet(userFirstName: string, refreshToken: string): Promise<string> {
    const drive = google.drive({ version: 'v3', auth: this.auth(refreshToken) });
    const sheets = this.sheetsClient(refreshToken);

    const create = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: `Relaunch — ${userFirstName}'s Job Tracker` },
        sheets: [
          { properties: { title: 'Daily Matches' } },
          { properties: { title: 'My Profile' } },
          { properties: { title: 'Settings' } },
          { properties: { title: 'Skill gaps & courses' } },
        ],
      },
    });

    const id = create.data.spreadsheetId!;

    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: 'Daily Matches!A1',
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });

    // Format header row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: create.data.sheets?.[0]?.properties?.sheetId ?? 0,
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.36, green: 0.42, blue: 1.0 },
                  textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)',
            },
          },
          {
            updateSheetProperties: {
              properties: {
                sheetId: create.data.sheets?.[0]?.properties?.sheetId ?? 0,
                gridProperties: { frozenRowCount: 1 },
              },
              fields: 'gridProperties.frozenRowCount',
            },
          },
        ],
      },
    });

    // Move into Relaunch folder if we want — for v1 we leave at Drive root.
    void drive;
    return id;
  }

  // ----------------------------------------------------------------
  async appendMatches(spreadsheetId: string, refreshToken: string, matches: TailoredJobMatch[]): Promise<void> {
    if (!matches.length) return;
    const sheets = this.sheetsClient(refreshToken);

    // Re-write the header row every run. Cheap, idempotent, and it
    // upgrades sheets created before a new column was added (e.g. the
    // "Resume (Editable)" column P) without a separate migration.
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Daily Matches!A1',
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });

    // Dedup: skip matches whose (company, role) already exists in the sheet.
    // Cheaper to do this in one read than relying on the user to clean up.
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Daily Matches!B2:C',
    });
    const seen = new Set<string>();
    for (const row of existing.data.values ?? []) {
      const [company, role] = row;
      if (typeof company === 'string' && typeof role === 'string') {
        seen.add(matchKey(company, role));
      }
    }
    const fresh = matches.filter((m) => !seen.has(matchKey(m.job.company, m.job.title)));
    if (!fresh.length) return;

    const rows = fresh.map((m) => [
      new Date().toISOString().slice(0, 10),
      m.job.company,
      m.job.title,
      `${m.matchPercent}%`,
      m.job.location,
      m.job.workMode,
      m.expectedCtc ?? '',
      m.job.url,
      m.tailoredResumeUrl ?? '', // column I — PDF
      // Referrer column: prefer real names if available; otherwise the
      // LinkedIn-search deep link the user can click to find their own.
      m.referrers.length
        ? m.referrers.map((r) => `${r.name} (${r.role})`).join(' | ')
        : (m.connectionsSearchUrl ?? ''),
      m.inmailDraft?.subject ?? '',
      'No',
      '',
      '',
      '', // Reaction (column O) — starts blank
      m.tailoredResumeDocUrl ?? '', // column P — editable resume .docx
      m.coverLetterUrl ?? '',       // column Q — cover letter PDF
      m.coverLetterDocUrl ?? '',    // column R — editable cover letter .docx
    ]);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Daily Matches!A1',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows },
    });
  }

  // ----------------------------------------------------------------
  async readProfileTab(spreadsheetId: string, refreshToken: string): Promise<Record<string, string>> {
    const sheets = this.sheetsClient(refreshToken);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'My Profile!A:B',
    });
    const out: Record<string, string> = {};
    for (const row of res.data.values ?? []) {
      const [k, v] = row;
      if (typeof k === 'string' && typeof v === 'string') out[k] = v;
    }
    return out;
  }

  // ----------------------------------------------------------------
  async readMatches(spreadsheetId: string, refreshToken: string, limit = 300): Promise<SheetMatchRow[]> {
    const sheets = this.sheetsClient(refreshToken);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      // Skip the header row (A1). Columns A:R — O is Reaction, P is the
      // editable resume .docx, Q/R are the cover-letter links. Sheets
      // created before a column was added just return short rows; we
      // default missing cells to '' below.
      range: 'Daily Matches!A2:R',
    });
    const rows = res.data.values ?? [];

    // Newest first — the cron appends so the newest is at the bottom.
    const ordered = [...rows].reverse().slice(0, limit);

    const parsed = ordered
      .map((r): SheetMatchRow | null => {
        if (!r || r.length === 0) return null;
        const pctStr = (r[3] ?? '').toString().replace('%', '').trim();
        const pct = Number(pctStr);
        return {
          date: (r[0] ?? '').toString(),
          company: (r[1] ?? '').toString(),
          role: (r[2] ?? '').toString(),
          matchPercent: Number.isFinite(pct) ? pct : 0,
          location: (r[4] ?? '').toString(),
          mode: (r[5] ?? '').toString(),
          expectedCtc: (r[6] ?? '').toString(),
          jobUrl: (r[7] ?? '').toString(),
          tailoredResumeUrl: (r[8] ?? '').toString(),
          referrers: (r[9] ?? '').toString(),
          inmailSubject: (r[10] ?? '').toString(),
          applied: /^y/i.test((r[11] ?? '').toString()),
          outcome: (r[12] ?? '').toString(),
          notes: (r[13] ?? '').toString(),
          reaction: parseReaction((r[14] ?? '').toString()),
          tailoredResumeDocUrl: (r[15] ?? '').toString(),
          coverLetterUrl: (r[16] ?? '').toString(),
          coverLetterDocUrl: (r[17] ?? '').toString(),
        };
      })
      .filter((r): r is SheetMatchRow => r !== null && (!!r.company || !!r.role));

    // Dedupe by (company, role) — older Sheets accumulated duplicates
    // before write-time dedup landed. We keep the FIRST occurrence here,
    // which (because we just reversed to newest-first) is the most recent
    // row. If ANY duplicate row has a reaction set, we propagate it onto
    // the kept row so the filter does the right thing even if the user
    // historically reacted to an older copy.
    const seen = new Map<string, SheetMatchRow>();
    for (const row of parsed) {
      const key = `${row.company.toLowerCase()}|${row.role.toLowerCase()}`;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, row);
        continue;
      }
      // Same job already kept (newer). Carry the strongest reaction forward.
      // Priority: hidden > liked > '' — hiding is intentional, should win.
      if (existing.reaction === '' && row.reaction !== '') {
        existing.reaction = row.reaction;
      } else if (existing.reaction === 'liked' && row.reaction === 'hidden') {
        existing.reaction = 'hidden';
      }
    }
    return [...seen.values()];
  }

  // ----------------------------------------------------------------
  async createTailoredResume(input: {
    refreshToken: string;
    company: string;
    role: string;
    profile: UserProfile;
    tailored: TailoredResume;
  }): Promise<{ docUrl: string; pdfUrl: string }> {
    const drive = google.drive({ version: 'v3', auth: this.auth(input.refreshToken) });
    const baseName = `Resume — ${input.company} · ${input.role}`;

    // Render both formats from the same data:
    //   - PDF  : polished, submission-ready (via @react-pdf/renderer)
    //   - DOCX : editable in Word / Google Docs / Pages
    const [pdfBuffer, docxBuffer] = await Promise.all([
      renderResumePdf(input.profile, input.tailored),
      renderResumeDocx(input.profile, input.tailored),
    ]);

    // Upload both to the user's Drive in parallel.
    const [pdf, docx] = await Promise.all([
      drive.files.create({
        requestBody: { name: `${baseName}.pdf`, mimeType: 'application/pdf' },
        media: { mimeType: 'application/pdf', body: Readable.from([pdfBuffer]) },
        fields: 'id, webViewLink',
      }),
      drive.files.create({
        requestBody: { name: `${baseName}.docx`, mimeType: DOCX_MIME },
        media: { mimeType: DOCX_MIME, body: Readable.from([docxBuffer]) },
        fields: 'id, webViewLink',
      }),
    ]);

    const pdfId = pdf.data.id;
    const docxId = docx.data.id;
    if (!pdfId || !docxId) throw new Error('Google Drive did not return a file id');

    const pdfUrl = pdf.data.webViewLink ?? `https://drive.google.com/file/d/${pdfId}/view`;
    const docUrl = docx.data.webViewLink ?? `https://drive.google.com/file/d/${docxId}/view`;

    return { docUrl, pdfUrl };
  }

  // ----------------------------------------------------------------
  async createCoverLetter(input: {
    refreshToken: string;
    company: string;
    role: string;
    profile: UserProfile;
    letter: CoverLetter;
  }): Promise<{ docUrl: string; pdfUrl: string }> {
    const drive = google.drive({ version: 'v3', auth: this.auth(input.refreshToken) });
    const baseName = `Cover Letter — ${input.company} · ${input.role}`;

    const [pdfBuffer, docxBuffer] = await Promise.all([
      renderCoverLetterPdf(input.profile, input.letter, input.company, input.role),
      renderCoverLetterDocx(input.profile, input.letter, input.company, input.role),
    ]);

    const [pdf, docx] = await Promise.all([
      drive.files.create({
        requestBody: { name: `${baseName}.pdf`, mimeType: 'application/pdf' },
        media: { mimeType: 'application/pdf', body: Readable.from([pdfBuffer]) },
        fields: 'id, webViewLink',
      }),
      drive.files.create({
        requestBody: { name: `${baseName}.docx`, mimeType: DOCX_MIME },
        media: { mimeType: DOCX_MIME, body: Readable.from([docxBuffer]) },
        fields: 'id, webViewLink',
      }),
    ]);

    const pdfId = pdf.data.id;
    const docxId = docx.data.id;
    if (!pdfId || !docxId) throw new Error('Google Drive did not return a file id');

    const pdfUrl = pdf.data.webViewLink ?? `https://drive.google.com/file/d/${pdfId}/view`;
    const docUrl = docx.data.webViewLink ?? `https://drive.google.com/file/d/${docxId}/view`;

    return { docUrl, pdfUrl };
  }

  // ----------------------------------------------------------------
  async setReaction(input: {
    spreadsheetId: string;
    refreshToken: string;
    company: string;
    role: string;
    reaction: '' | 'liked' | 'hidden';
  }): Promise<void> {
    const sheets = this.sheetsClient(input.refreshToken);

    // Find the row by (company, role) match — read B:C, scan in JS.
    // For a few hundred rows this is plenty fast, and means we don't have
    // to add a hidden ID column.
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: input.spreadsheetId,
      range: 'Daily Matches!B2:C',
    });
    // Collect ALL matching rows — duplicates from past runs each need
    // their own column-O write so they share the same reaction. Older
    // sheets may have several copies of the same (company, role).
    const target = matchKey(input.company, input.role);
    const matchedRows: number[] = [];
    (res.data.values ?? []).forEach((row, i) => {
      const [c, r] = row;
      if (typeof c === 'string' && typeof r === 'string' && matchKey(c, r) === target) {
        matchedRows.push(i + 2); // +1 for 1-indexed, +1 to skip header
      }
    });
    if (matchedRows.length === 0) {
      console.warn(`[setReaction] no row matched company="${input.company}" role="${input.role}"`);
      return;
    }

    const value =
      input.reaction === 'liked'
        ? '👍 liked'
        : input.reaction === 'hidden'
        ? '👎 hidden'
        : '';

    // batchUpdate handles writing multiple disjoint cells in one round-trip
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: matchedRows.map((rowIdx) => ({
          range: `Daily Matches!O${rowIdx}`,
          values: [[value]],
        })),
      },
    });
    console.log(`[setReaction] ${matchedRows.length} row(s) ${matchedRows.join(',')} → "${value}" (${input.company} / ${input.role})`);
  }
}

// ---------------------------------------------------------------
function matchKey(company: string, role: string): string {
  return `${company.trim().toLowerCase()}|${role.trim().toLowerCase()}`;
}

function parseReaction(raw: string): '' | 'liked' | 'hidden' {
  if (!raw) return '';
  const norm = raw.trim().toLowerCase();
  // Order matters: check 'hidden' first because "👎 hidden" also contains
  // some innocuous characters; we don't want partial matches flipping.
  if (norm.includes('👎') || norm.includes('hidden') || norm.includes('hide') || norm.includes('dislike')) {
    return 'hidden';
  }
  if (norm.includes('👍') || norm.includes('liked') || norm.includes('like')) {
    return 'liked';
  }
  return '';
}

