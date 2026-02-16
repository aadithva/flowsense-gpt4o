import { supabase } from './supabase';
import { processRun } from './processor';

const POLL_INTERVAL = 5000; // 5 seconds
let isPolling = false;

export function pollForJobs() {
  setInterval(async () => {
    if (isPolling) return;

    isPolling = true;
    try {
      const { data: runs, error } = await supabase
        .from('analysis_runs')
        .select('id')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) {
        console.error('Error polling for jobs:', error);
        return;
      }

      if (runs && runs.length > 0) {
        const runId = runs[0].id;
        console.log(`Processing queued run: ${runId}`);
        await processRun(runId);
      }
    } catch (error) {
      console.error('Error in poller:', error);
    } finally {
      isPolling = false;
    }
  }, POLL_INTERVAL);
}
