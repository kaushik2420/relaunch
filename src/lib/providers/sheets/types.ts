import type { TailoredJobMatch } from '@/lib/types';

/**
 * One row out of the user's "Daily Matches" tab. Same shape as the
 * column order in HEADERS; nulls preserved for unfilled cells so the
 * dashboard can distinguish "user hasn't acted" from "no data".
 */
export interface SheetMatchRow {
  date: string;          // ISO yyyy-mm-dd
  company: string;
  role: string;
  matchPercent: number;  // 0-100
  location: string;
  mode: string;
  expectedCtc: string;
  jobUrl: string;
  tailoredResumeUrl: string;
  referrers: string;
  inmailSubject: string;
  applied: boolean;
  outcome: string;
  notes: string;
}

export interface SheetsProvider {
  /** Create the per-user "Job Tracker" sheet. Returns the spreadsheet id. */
  createUserSheet(userFirstName: string, refreshToken: string): Promise<string>;

  /** Append today's matches to the Daily Matches tab. */
  appendMatches(spreadsheetId: string, refreshToken: string, matches: TailoredJobMatch[]): Promise<void>;

  /** Read the My Profile tab so user edits can flow back into the system. */
  readProfileTab(spreadsheetId: string, refreshToken: string): Promise<Record<string, string>>;

  /** Read recent rows from "Daily Matches" — newest first. */
  readMatches(spreadsheetId: string, refreshToken: string, limit?: number): Promise<SheetMatchRow[]>;
}
