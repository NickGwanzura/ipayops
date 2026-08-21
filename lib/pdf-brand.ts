import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import QRCode from 'qrcode';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFPage, PDFFont, PDFImage, rgb } from 'pdf-lib';
import type { OrganizationSettings } from './organization-settings';

export const PDF_PAGE_SIZE: [number, number] = [595, 842];
export const PDF_INK = rgb(0.06, 0.12, 0.22);
export const PDF_MUTED = rgb(0.35, 0.42, 0.52);
const SOFT = rgb(0.45, 0.5, 0.58);
const TEAL = rgb(0.07, 0.62, 0.45);
const RULE = rgb(0.86, 0.9, 0.95);
const HEADER = rgb(0.97, 0.98, 0.99);
const TABLE_HEADER = rgb(0.93, 0.96, 0.98);

export const PDF_LAYOUT = {
  left: 42,
  right: 553,
  width: 511,
  top: 638,
  bottom: 72,
};

export async function embedIpaytechLogo(pdf: PDFDocument) {
  const logo = await readFile(join(process.cwd(), 'public', 'iPaytechLogo.jpg'));
  return pdf.embedJpg(logo);
}

export async function embedIpaytechFonts(pdf: PDFDocument) {
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(await readFile(join(process.cwd(), 'public', 'fonts', 'JUST Sans Regular.ttf')));
  const semibold = await pdf.embedFont(await readFile(join(process.cwd(), 'public', 'fonts', 'JUST Sans SemiBold.ttf')));
  return { regular, semibold };
}

export function drawPdfHeader(
  page: PDFPage,
  input: {
    logo: PDFImage;
    qr: PDFImage;
    font: PDFFont;
    bold: PDFFont;
    settings: OrganizationSettings;
    title: string;
    subtitle?: string;
  },
) {
  page.drawRectangle({ x: 0, y: 735, width: PDF_PAGE_SIZE[0], height: 107, color: HEADER });
  page.drawRectangle({ x: 0, y: 735, width: 6, height: 107, color: TEAL });
  page.drawImage(input.logo, { x: 42, y: 758, width: 165, height: 69 });
  page.drawText(input.settings.organizationName, { x: 230, y: 810, size: 11, font: input.bold, color: PDF_INK });
  page.drawText(input.settings.address, { x: 230, y: 792, size: 8, font: input.font, color: PDF_MUTED });
  page.drawText(input.settings.phone, { x: 230, y: 778, size: 8, font: input.font, color: PDF_MUTED });
  page.drawImage(input.qr, { x: 480, y: 748, width: 78, height: 78 });
  page.drawText(input.title, { x: 42, y: 704, size: 16, font: input.bold, color: PDF_INK });
  if (input.subtitle) page.drawText(input.subtitle, { x: 42, y: 685, size: 9, font: input.font, color: PDF_MUTED });
  page.drawLine({ start: { x: 42, y: 665 }, end: { x: 553, y: 665 }, thickness: 1, color: RULE });
  return 638;
}

export function drawPdfSectionHeading(page: PDFPage, input: { title: string; y: number; font: PDFFont; bold: PDFFont }) {
  page.drawText(input.title.toUpperCase(), { x: PDF_LAYOUT.left, y: input.y, size: 8.5, font: input.bold, color: PDF_MUTED });
  page.drawLine({ start: { x: PDF_LAYOUT.left, y: input.y - 7 }, end: { x: PDF_LAYOUT.right, y: input.y - 7 }, thickness: 0.8, color: RULE });
  return input.y - 25;
}

export function drawPdfTableHeader(page: PDFPage, input: { y: number; columns: Array<{ label: string; x: number }> ; font: PDFFont }) {
  page.drawRectangle({ x: PDF_LAYOUT.left, y: input.y - 8, width: PDF_LAYOUT.width, height: 24, color: TABLE_HEADER });
  for (const column of input.columns) {
    page.drawText(column.label.toUpperCase(), { x: column.x, y: input.y, size: 7.5, font: input.font, color: PDF_MUTED });
  }
  return input.y - 28;
}

export function drawPdfWrappedText(page: PDFPage, text: string, input: { x: number; y: number; maxWidth: number; font: PDFFont; size?: number; color?: ReturnType<typeof rgb>; lineHeight?: number; maxLines?: number }) {
  const size = input.size ?? 9;
  const lineHeight = input.lineHeight ?? size + 4;
  const words = String(text || '—').split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (input.font.widthOfTextAtSize(candidate, size) <= input.maxWidth || !line) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  const visibleLines = input.maxLines ? lines.slice(0, input.maxLines) : lines;
  if (input.maxLines && lines.length > input.maxLines && visibleLines.length) {
    let last = visibleLines[visibleLines.length - 1];
    while (last.length && input.font.widthOfTextAtSize(`${last}...`, size) > input.maxWidth) last = last.slice(0, -1);
    visibleLines[visibleLines.length - 1] = `${last}...`;
  }
  visibleLines.forEach((lineText, index) => page.drawText(lineText, { x: input.x, y: input.y - index * lineHeight, size, font: input.font, color: input.color ?? PDF_INK }));
  return input.y - visibleLines.length * lineHeight;
}

export function drawPdfFooter(page: PDFPage, input: { font: PDFFont; generatedAt: string; pageNumber: number; totalPages: number }) {
  page.drawLine({ start: { x: 42, y: 52 }, end: { x: 553, y: 52 }, thickness: 1, color: RULE });
  page.drawText(`Generated ${input.generatedAt}`, { x: 42, y: 34, size: 7, font: input.font, color: SOFT });
  page.drawText('Scan QR to verify authenticity', { x: 222, y: 34, size: 7, font: input.font, color: PDF_MUTED });
  page.drawText(`Page ${input.pageNumber} of ${input.totalPages}`, { x: 486, y: 34, size: 7, font: input.font, color: SOFT });
}

export type VerifiableDocument = 'invoice' | 'delivery-note' | 'client-statement' | 'payment-receipt' | 'job-card';

function verificationSignature(type: VerifiableDocument, id: string, documentTimestamp: string, generatedAt: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET must be at least 32 characters.');
  return createHmac('sha256', secret).update(`${type}|${id}|${documentTimestamp}|${generatedAt}`).digest('hex');
}

export async function embedDocumentVerificationQr(pdf: PDFDocument, request: Request, input: { type: VerifiableDocument; id: string; documentTimestamp: string }) {
  const generatedAt = new Date().toISOString();
  const baseUrl = process.env.APP_URL || new URL(request.url).origin;
  const url = new URL('/verify', baseUrl);
  url.searchParams.set('type', input.type);
  url.searchParams.set('id', input.id);
  url.searchParams.set('documentTimestamp', input.documentTimestamp);
  url.searchParams.set('generatedAt', generatedAt);
  url.searchParams.set('signature', verificationSignature(input.type, input.id, input.documentTimestamp, generatedAt));
  const dataUrl = await QRCode.toDataURL(url.toString(), { errorCorrectionLevel: 'M', margin: 1, width: 180, color: { dark: '#0b1f3a', light: '#ffffff' } });
  const image = await pdf.embedPng(Buffer.from(dataUrl.split(',')[1], 'base64'));
  return { image, generatedAt, url: url.toString() };
}

export async function embedReportVerificationQr(pdf: PDFDocument, request: Request, input: { from: string; to: string; region: string | null; product: string | null }) {
  const generatedAt = new Date().toISOString();
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET must be at least 32 characters.');
  const payload = `report|${input.from}|${input.to}|${input.region || ''}|${input.product || ''}|${generatedAt}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  const baseUrl = process.env.APP_URL || new URL(request.url).origin;
  const url = new URL('/api/reports/verify', baseUrl);
  url.searchParams.set('from', input.from); url.searchParams.set('to', input.to); url.searchParams.set('region', input.region || ''); url.searchParams.set('product', input.product || ''); url.searchParams.set('generatedAt', generatedAt); url.searchParams.set('signature', signature);
  const dataUrl = await QRCode.toDataURL(url.toString(), { errorCorrectionLevel: 'M', margin: 1, width: 180, color: { dark: '#0b1f3a', light: '#ffffff' } });
  const image = await pdf.embedPng(Buffer.from(dataUrl.split(',')[1], 'base64'));
  return { image, generatedAt, url: url.toString() };
}
