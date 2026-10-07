import { processBackupQueue } from '@/lib/backup';
import { processNotificationQueue } from '@/lib/notifications';
import { runMaintenance } from '@/lib/maintenance';

const DEFAULT_INTERVAL_MS = 15_000;
const MIN_INTERVAL_MS = 1_000;

type WorkerState = {
  started: boolean;
  running: boolean;
  stopping?: boolean;
  interval?: ReturnType<typeof setInterval>;
};

const globalWorker = globalThis as typeof globalThis & { __ipaytechBackgroundWorker?: WorkerState };

function state() {
  if (!globalWorker.__ipaytechBackgroundWorker) globalWorker.__ipaytechBackgroundWorker = { started: false, running: false };
  return globalWorker.__ipaytechBackgroundWorker;
}

function intervalMilliseconds() {
  const configured = Number(process.env.BACKGROUND_WORKER_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  return Math.max(MIN_INTERVAL_MS, Number.isFinite(configured) ? configured : DEFAULT_INTERVAL_MS);
}

async function cycle() {
  const worker = state();
  if (worker.running || worker.stopping) return;
  worker.running = true;
  try {
    try {
      await processNotificationQueue(20);
    } catch (error) {
      console.error('Background notification cycle failed', error);
    }
    try {
      await processBackupQueue(1);
    } catch (error) {
      console.error('Background backup cycle failed', error);
    }
    try {
      await runMaintenance();
    } catch (error) {
      console.error('Background maintenance cycle failed', error);
    }
  } catch (error) {
    console.error('Background worker cycle failed', error);
  } finally {
    worker.running = false;
  }
}

/** Stop starting new cycles (on SIGTERM) so a redeploy does not begin a backup it cannot finish. */
export function stopBackgroundWorker() {
  const worker = state();
  worker.stopping = true;
  if (worker.interval) clearInterval(worker.interval);
}

export function startBackgroundWorker() {
  const worker = state();
  if (worker.started) return;
  worker.started = true;
  void cycle();
  worker.interval = setInterval(() => { void cycle(); }, intervalMilliseconds());
  worker.interval.unref?.();
}
