import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = params.get('from') || ''; const to = params.get('to') || ''; const region = params.get('region') || ''; const product = params.get('product') || ''; const generatedAt = params.get('generatedAt') || ''; const signature = params.get('signature') || ''; const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32 || !from || !to || !generatedAt || !signature) return NextResponse.json({ valid: false, error: 'Invalid report verification code.' }, { status: 400 });
  const expected = createHmac('sha256', secret).update(`report|${from}|${to}|${region}|${product}|${generatedAt}`).digest('hex');
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return NextResponse.json({ valid: false, error: 'Invalid report verification code.' }, { status: 400 });
  return NextResponse.json({ valid: true, report: 'operations', from, to, region: region || null, product: product || null, generatedAt });
}
