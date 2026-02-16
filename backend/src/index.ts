import 'dotenv/config';
import express from 'express';
import { processRun } from './processor';
import { pollForJobs } from './poller';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Webhook endpoint for triggering processing
app.post('/process', async (req, res) => {
  const secret = req.headers['x-webhook-secret'];

  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { run_id } = req.body;

  if (!run_id) {
    return res.status(400).json({ error: 'run_id is required' });
  }

  // Process in background
  processRun(run_id).catch((error) => {
    console.error(`Failed to process run ${run_id}:`, error);
  });

  res.json({ success: true, message: 'Processing started' });
});

app.listen(PORT, () => {
  console.log(`Processor running on port ${PORT}`);

  // Start polling for queued jobs
  pollForJobs();
});
