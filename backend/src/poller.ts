import { claimNextQueuedRun } from './azure-db';
import { processRun } from './processor';
import { getEnv } from './env';

const POLL_INTERVAL = 5000; // 5 seconds
let isPolling = false;

export function pollForJobs() {
  const env = getEnv();
  setInterval(async () => {
    if (isPolling) return;

    isPolling = true;
    try {
      const runId = await claimNextQueuedRun(env.PROCESSOR_WORKER_ID);

      if (runId) {
        console.log(`[Poller] Claimed queued run: ${runId}`);
        await processRun(runId);
      }
    } catch (error) {
      console.error('Error in poller:', error);
    } finally {
      isPolling = false;
    }
  }, POLL_INTERVAL);
}
