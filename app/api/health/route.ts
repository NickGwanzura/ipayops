import { getServerEnv } from '@/lib/server-env';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const env = getServerEnv({ strict: false });
  const databaseCheckEnabled = process.env.HEALTHCHECK_DATABASE === 'true';
  if (databaseCheckEnabled) {
    try {
      await query('SELECT 1');
    } catch (error) {
      console.error('Health database check failed', error);
      return Response.json({ ok: false, service: 'ipaytech-ops', database: 'unavailable', configuration: env.configured ? 'complete' : 'partial', timestamp: new Date().toISOString() }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  }
  return Response.json({ ok: true, service: 'ipaytech-ops', version: '0.1.0', storage: env.storageDriver, database: databaseCheckEnabled ? 'ok' : 'skipped', configuration: env.configured ? 'complete' : 'partial', timestamp: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
}
