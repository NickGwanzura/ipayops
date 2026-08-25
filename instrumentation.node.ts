import { getRequestId } from '@/lib/db-request-context';
import { errorClass, reportError } from '@/lib/observability';

const globalForInstrumentation = globalThis as typeof globalThis & { __ipaytechNodeInstrumentation?: boolean };

export function registerNodeInstrumentation() {
  if (globalForInstrumentation.__ipaytechNodeInstrumentation) return;
  globalForInstrumentation.__ipaytechNodeInstrumentation = true;

  let fatalHandling = false;
  process.on('uncaughtException', error => {
    if (fatalHandling) {
      process.exit(1);
      return;
    }
    fatalHandling = true;
    const requestId = getRequestId();
    console.error('Uncaught exception', { errorClass: errorClass(error), requestId: requestId || 'unavailable' });
    const exitAfterReport = () => {
      process.exitCode = 1;
      process.exit(1);
    };
    void reportError(error, { requestId, source: 'uncaughtException', runtime: 'nodejs' }).then(exitAfterReport, exitAfterReport);
  });

  process.on('unhandledRejection', reason => {
    const requestId = getRequestId();
    console.error('Unhandled promise rejection', { errorClass: errorClass(reason), requestId: requestId || 'unavailable' });
    void reportError(reason, { requestId, source: 'unhandledRejection', runtime: 'nodejs' }).catch(() => undefined);
  });
}

export function registerBackgroundWorker() {
  void import('@/lib/background-worker').then(({ startBackgroundWorker }) => startBackgroundWorker()).catch(() => {
    console.error('Background worker startup failed');
  });
}
