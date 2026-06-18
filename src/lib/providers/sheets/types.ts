import type { TailoredJobMatch, TailoredResume, UserProfile, CoverLetter } from '@/lib/types';

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
  /** Link to the polished PDF resume in the user's Drive. */
  tailoredResumeUrl: string;
  /** Link to the editable .docx version of the resume. */
  tailoredResumeDocUrl: string;
  /** Link to the cover-letter PDF. */
  coverLetterUrl: string;
  /** Link to the editable .docx version of the cover letter. */
  coverLetterDocUrl: string;
  referrers: string;
  inmailSubject: string;
  applied: boolean;
  outcome: string;
  notes: string;
  /** User reaction stored in column O. Empty if no reaction. */
  reaction: '' | 'liked' | 'hidden';
  /** Set server-side in dashboard/page.tsx — true if the company is
   *  in the user's watched_companies list. Not present in the sheet
   *  itself; populated by the join when the page loads. */
  watched?: boolean;
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

  /**
   * Create the tailored resume in the user's Drive — BOTH formats:
   *   - an editable, formatted Google Doc
   *   - a polished PDF (exported from that same Doc, so they match)
   * Returns both links. Uses the same OAuth refresh token.
   */
  createTailoredResume(input: {
    refreshToken: string;
    company: string;
    role: string;
    profile: UserProfile;
    tailored: TailoredResume;
  }): Promise<{ docUrl: string; pdfUrl: string }>;

  /**
   * Create the tailored cover letter in the user's Drive — a polished
   * PDF plus an editable .docx. Returns both links.
   */
  createCoverLetter(input: {
    refreshToken: string;
    company: string;
    role: string;
    profile: UserProfile;
    letter: CoverLetter;
  }): Promise<{ docUrl: string; pdfUrl: string }>;

  /**
   * Set the user's reaction (👍 liked / 👎 hidden) on a specific match.
   * Identifies the row by company+role match (case-insensitive). No-op if
   * the row isn't found. Writes to column O.
   */
  setReaction(input: {
    spreadsheetId: string;
    refreshToken: string;
    company: string;
    role: string;
    reaction: '' | 'liked' | 'hidden';
  }): Promise<void>;

  /**
   * Mark a match as applied (or undo) in the Sheet — writes "Yes" or
   * "" to column L (Applied?). Finds the row by (company, role) match.
   * No-op if the row isn't found.
   */
  setApplied(input: {
    spreadsheetId: string;
    refreshToken: string;
    company: string;
    role: string;
    applied: boolean;
  }): Promise<void>;
}
