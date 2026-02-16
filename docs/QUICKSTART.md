# Quick Start Guide

Get the FlowSense running locally in 10 minutes.

## Prerequisites

- Node.js 18+ installed
- Docker installed (for Supabase)
- ffmpeg installed (`brew install ffmpeg` on macOS)
- OpenAI API key

## Step 1: Install Dependencies (2 min)

```bash
npm install
```

## Step 2: Start Supabase (3 min)

```bash
# Install Supabase CLI (if not installed)
npm install -g supabase

# Start Supabase (takes ~2 min first time)
cd supabase
supabase start
```

**Important**: Copy the output! You'll need:
- `API URL` (usually http://127.0.0.1:54321)
- `anon key`
- `service_role key`

## Step 3: Create Storage Bucket (1 min)

1. Open Supabase Studio: http://127.0.0.1:54323
2. Go to **Storage**
3. Click **New bucket**
4. Name: `videos`
5. Make it **Private**
6. Click **Create bucket**

## Step 4: Configure Environment (2 min)

**Web App**: Create `frontend/.env.local`
```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<paste-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<paste-service-role-key>
PROCESSOR_WEBHOOK_SECRET=local-dev-secret
PROCESSOR_BASE_URL=http://localhost:3001
```

**Processor**: Create `backend/.env`
```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<paste-service-role-key>
OPENAI_API_KEY=<your-openai-api-key>
OPENAI_MODEL=gpt-4-vision-preview
WEBHOOK_SECRET=local-dev-secret
PORT=3001
```

## Step 5: Build Shared Package (1 min)

```bash
npm run build --workspace=@interactive-flow/shared
```

## Step 6: Start Development Servers (1 min)

Open **two terminals**:

**Terminal 1 - Web App:**
```bash
cd frontend
npm run dev
```

**Terminal 2 - Processor:**
```bash
cd backend
npm run dev
```

## Step 7: Test It Out! 🎉

1. Open http://localhost:3000
2. Click "Send Magic Link" (check http://127.0.0.1:54324 for email)
3. Upload a short screen recording
4. Wait 2-5 minutes for processing
5. View your analysis report!

## Troubleshooting

### "Supabase command not found"

```bash
npm install -g supabase
```

### "ffmpeg not found"

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg

# Windows
# Download from https://ffmpeg.org/download.html
```

### "Cannot connect to Supabase"

Check Supabase is running:
```bash
cd supabase
supabase status
```

If not running:
```bash
supabase start
```

### "Storage bucket not found"

1. Go to http://127.0.0.1:54323
2. Storage > Create bucket named `videos` (private)

### "OpenAI API error"

- Verify your API key is correct
- Check you have GPT-4 Vision access
- Ensure you have API credits

### Video upload fails

1. Check `videos` bucket exists in Supabase Storage
2. Verify file is under 500MB
3. Check browser console for errors

### Processing never completes

1. Check processor terminal for errors
2. Verify OpenAI API key works
3. Check Supabase connection
4. Look at `analysis_runs` table status

## Next Steps

- Read [README.md](README.md) for full documentation
- Check [DEPLOYMENT.md](DEPLOYMENT.md) for production deployment
- Review [VISION_PROMPT.md](VISION_PROMPT.md) to customize analysis

## Sample Video

For testing, record a 10-30 second screen video of:
- Opening an app
- Clicking through a workflow
- Completing a simple task

Keep it short for faster processing!

## Development Tips

### View Database

Supabase Studio: http://127.0.0.1:54323

- **Table Editor**: View/edit data
- **SQL Editor**: Run queries
- **Logs**: Check errors

### Monitor Processing

Watch processor terminal for real-time logs:
```
Starting processing for run abc123
Extracting frames for run abc123
Extracted 24 frames, 8 keyframes
Analyzing keyframes for run abc123
Generating summary for run abc123
Successfully completed processing for run abc123
```

### API Testing

Test endpoints with curl:

```bash
# Health check
curl http://localhost:3001/health

# List runs (need auth token)
curl http://localhost:3000/api/runs \
  -H "Cookie: sb-xxx=<your-cookie>"
```

### Hot Reload

Both apps support hot reload:
- **Web**: Changes auto-refresh browser
- **Processor**: Uses `tsx watch` for instant reload

## Common Development Workflow

1. **Make code changes**
2. **Test in browser** (web hot reloads)
3. **Upload test video**
4. **Monitor processor logs**
5. **View results**
6. **Iterate**

## Need Help?

- Check [README.md](README.md) for detailed docs
- Review error messages in terminal
- Check Supabase logs at http://127.0.0.1:54323
- Open GitHub issue for bugs
