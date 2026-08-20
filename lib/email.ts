import { formatOrganizationDate, type OrganizationSettings } from '@/lib/organization-settings';

export type EmailField = { label: string; value: string };
export type BrandedEmailInput = {
  to: string;
  recipientName?: string;
  subject: string;
  eyebrow: string;
  title: string;
  summary: string;
  fields?: EmailField[];
  action?: { label: string; url: string };
};

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.APP_URL);
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

export function renderBrandedEmail(input: BrandedEmailInput) {
  const appUrl = process.env.APP_URL || 'https://ipaytechops.com';
  const logoUrl = `${appUrl.replace(/\/$/, '')}/iPaytechLogo.jpg`;
  const fields = (input.fields || []).map(field => `<tr><td style="padding:10px 0;color:#7c8ba1;font-size:13px;border-bottom:1px solid #e6ebf2">${escapeHtml(field.label)}</td><td style="padding:10px 0;color:#12213b;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #e6ebf2">${escapeHtml(field.value)}</td></tr>`).join('');
  const action = input.action ? `<p style="margin:28px 0 0"><a href="${escapeHtml(input.action.url)}" style="display:inline-block;background:#2f7cf6;color:#fff;text-decoration:none;padding:12px 18px;border-radius:7px;font-size:13px;font-weight:700">${escapeHtml(input.action.label)}</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,'Helvetica Neue',sans-serif;color:#12213b"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border:1px solid #e3e9f2;border-radius:14px;overflow:hidden"><tr><td style="background:#0f1d34;padding:24px 30px"><img src="${escapeHtml(logoUrl)}" alt="iPayTech" width="150" style="display:block;max-width:150px;height:auto;background:#fff;border-radius:5px;padding:4px"><p style="color:#62e8b7;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin:20px 0 0">${escapeHtml(input.eyebrow)}</p></td></tr><tr><td style="padding:34px 30px"><p style="margin:0 0 8px;color:#71819a;font-size:13px">${input.recipientName ? `Hello ${escapeHtml(input.recipientName)},` : 'Hello,'}</p><h1 style="margin:0 0 14px;color:#12213b;font-size:26px;line-height:1.2">${escapeHtml(input.title)}</h1><p style="margin:0;color:#596a82;font-size:15px;line-height:1.6">${escapeHtml(input.summary)}</p>${fields ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:25px">${fields}</table>` : ''}${action}</td></tr><tr><td style="padding:20px 30px;background:#f8fafc;border-top:1px solid #e6ebf2;color:#7c8ba1;font-size:11px;line-height:1.6">iPayTech Operations<br>15th Floor, Trust Towers, 54-56, Samora Machel Ave, Harare<br>077 867 4550</td></tr></table></td></tr></table></body></html>`;
}

export async function sendBrandedEmail(input: BrandedEmailInput) {
  if (!emailConfigured()) return { sent: false as const, reason: 'not_configured' as const };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [input.to], reply_to: process.env.EMAIL_REPLY_TO || undefined, subject: input.subject, html: renderBrandedEmail(input) }),
  });
  const data = await response.json().catch(() => ({})) as { id?: string; message?: string };
  if (!response.ok) throw new Error(data.message || `Email provider returned ${response.status}.`);
  return { sent: true as const, providerId: data.id || null };
}

export function formatEmailDate(value: string, settings?: OrganizationSettings) {
  return settings ? formatOrganizationDate(value, settings) : new Date(value).toLocaleString('en-GB');
}
