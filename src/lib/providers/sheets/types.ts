import type { TailoredJobMatch } from '@/lib/types';

export interface SheetsProvider {
  /** Create the per-user "Job Tracker" sheet. Returns the spreadsheet id. */
  createUserSheet(userFirstName: string, refreshToken: string): Promise<string>;

  /** Append today's matches to the Daily Matches tab. */
  appendMatches(spreadsheetId: string, refreshToken: string, matches: TailoredJobMatch[]): Promise<void>;

  /** Read the My Profile tab so user edits can flow back into the system. */
  readProfileTab(spreadsheetId: string, refreshToken: string): Promise<Record<string, string>>;
}
