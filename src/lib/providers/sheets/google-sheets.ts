import { google, sheets_v4 } from 'googleapis';
import { serverConfig } from '@/lib/config';
import type { SheetsProvider } from './types';
import type { TailoredJobMatch } from '@/lib/types';

const HEADERS = [
  'Date',
  'Company',
  'Role',
  'Match %',
  'Location',
  'Mode',
  'Expected CTC',
  'Job Link',
  'Tailored Resume',
  'Referrer(s)',
  'InMail',
  'Applied?',
  'Outcome',
  'Notes',
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
    const rows = matches.map((m) => [
      new Date().toISOString().slice(0, 10),
      m.job.company,
      m.job.title,
      `${m.matchPercent}%`,
      m.job.location,
      m.job.workMode,
      m.expectedCtc ?? '',
      m.job.url,
      m.tailoredResumeUrl ?? '',
      m.referrers.map((r) => `${r.name} (${r.role})`).join(' | '),
      m.inmailDraft?.subject ?? '',
      'No',
      '',
      '',
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
}
