import { llm } from '@/lib/providers/llm';
import type { UserProfile } from '@/lib/types';

/**
 * Parse a resume FILE into a UserProfile.
 * Strict rule: this function NEVER persists the file. The buffer stays
 * in memory for the duration of the request and is discarded.
 *
 * Supports PDF and DOCX today (TXT trivially). Image-based PDFs fall
 * through to the LLM with the base64 image route.
 */
export async function parseResumeFile(file: { buffer: Buffer; mime: string }): Promise<UserProfile> {
  let textOrBase64: string;
  let mime = file.mime;

  if (file.mime === 'application/pdf') {
    const { default: pdfParse } = await import('pdf-parse');
    const parsed = await pdfParse(file.buffer);
    if (parsed.text.trim().length < 100) {
      // Likely a scanned PDF — pass through as image
      textOrBase64 = file.buffer.toString('base64');
      mime = 'image/png'; // Claude accepts pdf-as-image via image source
    } else {
      textOrBase64 = parsed.text;
      mime = 'text/plain';
    }
  } else if (
    file.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.mime === 'application/msword'
  ) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    textOrBase64 = result.value;
    mime = 'text/plain';
  } else if (file.mime.startsWith('text/')) {
    textOrBase64 = file.buffer.toString('utf-8');
    mime = 'text/plain';
  } else {
    throw new Error(`Unsupported resume mime: ${file.mime}`);
  }

  return llm().parseResume({ textOrBase64, mime });
}
