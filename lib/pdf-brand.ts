import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import QRCode from 'qrcode';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';

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

export type VerifiableDocument = 'invoice' | 'delivery-note' | 'client-statement' | 'payment-receipt';

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
