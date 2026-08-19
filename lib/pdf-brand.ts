import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

export async function embedIpaytechLogo(pdf: PDFDocument) {
  const logo = await readFile(join(process.cwd(), 'public', 'iPaytechLogo.jpg'));
  return pdf.embedJpg(logo);
}
