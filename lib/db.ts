import { Pool, type QueryResultRow } from 'pg';
import { getDbRequestContext, type DbRequestContext } from '@/lib/db-request-context';

const globalForDb = globalThis as typeof globalThis & { __ipaytechPool?: Pool };

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  if (!globalForDb.__ipaytechPool) {
    globalForDb.__ipaytechPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX || 10),
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
  }
  return globalForDb.__ipaytechPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  const context = getDbRequestContext();
  if (!context) return getPool().query<T>(text, values);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await setTransactionContext(client, context);
    const result = await client.query<T>(text, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(work: (client: import('pg').PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const context = getDbRequestContext();
    if (context) await setTransactionContext(client, context);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function setTransactionContext(client: import('pg').PoolClient, context: DbRequestContext) {
  await client.query(
    `SELECT set_config('app.organization_id', $1, true),
            set_config('app.actor_user_id', $2, true),
            set_config('app.request_id', $3, true)`,
    [context.organizationId || '', context.actorUserId || '', context.requestId || ''],
  );
}
