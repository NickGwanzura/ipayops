export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NEXT_PHASE === 'phase-production-build') return;
    void import('./instrumentation.node').then(({ registerBackgroundWorker, registerNodeInstrumentation }) => {
      registerNodeInstrumentation();
      if (!process.env.DATABASE_URL) return;
      const timer = setTimeout(() => registerBackgroundWorker(), 1000);
      timer.unref?.();
    }).catch(() => {
      console.error('Node instrumentation startup failed');
    });
  }
}
