import { query, withTransaction } from '@/lib/db';

export function requestAddress(request: Request) {
  if (process.env.TRUST_PROXY !== 'true') return 'unknown';
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'unknown';
}

export async function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const state = await withTransaction(async client => {
    const current = await client.query<{ count: number; window_started_at: Date }>('SELECT count, window_started_at FROM rate_limit_buckets WHERE key = $1 FOR UPDATE', [key]);
    const now = Date.now();
    const windowMsFromDb = windowMs;
    if (!current.rows[0] || now - new Date(current.rows[0].window_started_at).getTime() >= windowMsFromDb) {
      await client.query(`INSERT INTO rate_limit_buckets (key, count, window_started_at, updated_at) VALUES ($1, 1, now(), now()) ON CONFLICT (key) DO UPDATE SET count = 1, window_started_at = now(), updated_at = now()`, [key]);
      return { count: 1, resetAt: now + windowMsFromDb };
    }
    const updated = await client.query<{ count: number; window_started_at: Date }>('UPDATE rate_limit_buckets SET count = count + 1, updated_at = now() WHERE key = $1 RETURNING count, window_started_at', [key]);
    return { count: Number(updated.rows[0].count), resetAt: new Date(updated.rows[0].window_started_at).getTime() + windowMsFromDb };
  });
  return { allowed: state.count <= limit, remaining: Math.max(0, limit - state.count), retryAfter: Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000)) };
}

export async function resetRateLimit(key: string) {
  await query('DELETE FROM rate_limit_buckets WHERE key = $1', [key]);
}
