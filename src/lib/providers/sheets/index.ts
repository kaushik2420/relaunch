import type { SheetsProvider } from './types';
import { GoogleSheetsProvider } from './google-sheets';

let _sheets: SheetsProvider | undefined;
export function sheets(): SheetsProvider {
  _sheets ??= new GoogleSheetsProvider();
  return _sheets;
}

export type { SheetsProvider } from './types';
