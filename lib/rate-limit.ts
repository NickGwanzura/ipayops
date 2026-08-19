type RateLimitBucket = { count: number; resetAt: number };

const globalForRateLimit = globalThis as typeof globalThis & { __ipaytechRateLimits?: Map<string, RateLimitBucket> };
const buckets = globalForRateLimit.__ipaytechRateLimits ?? new Map<string, RateLimitBucket>();
globalForRateLimit.__ipaytechRateLimits = buckets;

export function requestAddress(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'unknown';
}

export function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfter: Math.ceil(windowMs / 1000) };
  }
  current.count += 1;
  const allowed = current.count <= limit;
  return { allowed, remaining: Math.max(0, limit - current.count), retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

export function resetRateLimit(key: string) {
  buckets.delete(key);
}
