import { NextResponse } from 'next/server';
import { z } from 'zod';
import { writeAuditLog } from '@/lib/audit';
import { consumeRateLimit, requestAddress } from '@/lib/rate-limit';

const safeIdentifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const payloadSchema = z.object({
  event: z.literal('application_error'),
  errorClass: safeIdentifier,
  requestId: safeIdentifier,
  revision: safeIdentifier,
  timestamp: z.string().datetime({ offset: true }),
  source: safeIdentifier,
  runtime: safeIdentifier,
}).strict();

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const address = requestAddress(request);
  const rateLimit = await consumeRateLimit(`monitoring:error:${address}`, 120, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many monitoring events.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } },
    );
  }

  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 8_192) return NextResponse.json({ error: 'Payload too large.' }, { status: 413 });
    const payload = payloadSchema.parse(await request.json());
    await writeAuditLog({
      organizationId: process.env.BACKUP_ADMIN_ORGANIZATION_ID,
      action: 'application.error_reported',
      entityType: 'system',
      metadata: payload,
      request,
    });
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid monitoring event.' }, { status: 400 });
    console.error('Monitoring event intake failed');
    return NextResponse.json({ error: 'Unable to accept monitoring event.' }, { status: 500 });
  }
}
