export const REQUEST_ID_HEADER = 'x-request-id';
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type ErrorMonitoringContext = {
  requestId?: string;
  source?: string;
  runtime?: string;
};

export function isValidRequestId(value: string | null | undefined): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

export function getOrCreateRequestId(request?: Pick<Request, 'headers'>) {
  const incomingRequestId = request?.headers.get(REQUEST_ID_HEADER);
  return isValidRequestId(incomingRequestId) ? incomingRequestId : crypto.randomUUID();
}

function safeField(value: string | undefined, fallback: string) {
  return value && REQUEST_ID_PATTERN.test(value) ? value : fallback;
}

export function errorClass(error: unknown) {
  try {
    const name = error && typeof error === 'object' && 'name' in error && typeof error.name === 'string' ? error.name : undefined;
    return safeField(name, 'UnknownError');
  } catch {
    return 'UnknownError';
  }
}

function webhookUrl() {
  const value = process.env.ERROR_MONITORING_WEBHOOK_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function revision() {
  return safeField(
    process.env.DEPLOY_SHA?.trim() || process.env.GIT_COMMIT_SHA?.trim() || process.env.SOURCE_COMMIT?.trim(),
    'unknown',
  );
}

/**
 * Send provider-neutral metadata only. Error messages and stacks are
 * intentionally excluded because they can contain secrets, SQL, or business data.
 */
export async function reportError(error: unknown, context: ErrorMonitoringContext = {}): Promise<void> {
  const url = webhookUrl();
  if (!url) return;

  const payload = {
    event: 'application_error',
    errorClass: errorClass(error),
    requestId: safeField(context.requestId, 'unavailable'),
    revision: revision(),
    timestamp: new Date().toISOString(),
    source: safeField(context.source, 'application'),
    runtime: safeField(context.runtime || process.env.NEXT_RUNTIME, 'nodejs'),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) console.error('Error monitoring webhook rejected event', { status: response.status });
  } catch {
    console.error('Error monitoring webhook unavailable');
  } finally {
    clearTimeout(timeout);
  }
}
