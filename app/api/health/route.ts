import { getServerEnv } from '@/lib/server-env';

export const dynamic = 'force-dynamic';

export function GET() {
  const env = getServerEnv();
  return Response.json({ ok: true, service: 'ipaytech-ops', version: '0.1.0', storage: env.storageDriver, timestamp: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
}
