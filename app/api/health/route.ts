import { getServerEnv } from '@/lib/server-env';
import { query } from '@/lib/db';
import { setDbRequestId } from '@/lib/db-request-context';
import { getOrCreateRequestId } from '@/lib/observability';
import { checkStorageHealth } from '@/lib/storage';

export const dynamic = 'force-dynamic';

function deployProvenance() {
  return {
    version: process.env.APP_VERSION?.trim() || '0.1.0',
    revision: process.env.DEPLOY_SHA?.trim() || process.env.GIT_COMMIT_SHA?.trim() || process.env.SOURCE_COMMIT?.trim() || 'unknown',
  };
}

export async function GET(request: Request) {
  const requestId = getOrCreateRequestId(request);
  setDbRequestId(requestId);
  const production = process.env.NODE_ENV === 'production';
  let configurationError = false;
  let env: ReturnType<typeof getServerEnv>;
  try {
    env = getServerEnv({ strict: production });
  } catch (error) {
    configurationError = true;
    console.error('Health configuration check failed', error);
    env = getServerEnv({ strict: false });
  }
  const provenance = deployProvenance();
  const databaseCheckEnabled = process.env.HEALTHCHECK_DATABASE === 'true';
  const storageCheckEnabled = process.env.HEALTHCHECK_STORAGE === 'true';
  const storage = storageCheckEnabled ? await checkStorageHealth() : { driver: env.storageDriver, state: 'skipped' as const };
  const storageUnavailable = storageCheckEnabled && storage.driver === 's3' && storage.state !== 'ok';
  let database: 'ok' | 'unavailable' | 'skipped' = databaseCheckEnabled ? 'ok' : 'skipped';
  if (databaseCheckEnabled) {
    try {
      await query('SELECT 1');
    } catch (error) {
      console.error('Health database check failed', error);
      database = 'unavailable';
    }
  }
  const unhealthy = database === 'unavailable' || (production && (configurationError || !env.configured || env.storageDriver !== 's3' || storageUnavailable));
  if (storageUnavailable) console.error('Health storage check failed');
  return Response.json({ ok: !unhealthy, service: 'ipaytech-ops', ...provenance, storage: env.storageDriver, storageHealth: storage, database, configuration: configurationError ? 'invalid' : env.configured ? 'complete' : 'partial', timestamp: new Date().toISOString() }, { status: unhealthy ? 503 : 200, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } });
}
