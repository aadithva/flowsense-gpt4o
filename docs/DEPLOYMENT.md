# Deployment Guide

Complete guide for deploying FlowSense to production.

## Architecture Overview

```
┌─────────────┐
│   Vercel    │  <- Web App (Next.js)
│  (Web App)  │
└──────┬──────┘
       │
       ├─────────> Supabase (Auth + DB + Storage)
       │
       └─────────> Processor Worker (Railway/Fly.io)
                   └─────> OpenAI Vision API
```

## Step 1: Deploy Supabase

### 1.1 Create Production Project

1. Go to https://supabase.com
2. Create new project
3. Note your project URL and API keys

### 1.2 Run Migrations

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Push migrations
supabase db push
```

### 1.3 Create Storage Bucket

1. Go to Storage in Supabase Dashboard
2. Create bucket named `videos`
3. Set to **private**
4. RLS policies are already applied via migrations

### 1.4 Configure Auth

1. Go to Authentication > Settings
2. Set Site URL to your production domain (e.g., `https://your-app.vercel.app`)
3. Add to Redirect URLs:
   - `https://your-app.vercel.app/auth/callback`
4. Configure email templates (optional)

## Step 2: Deploy Processor Worker

### Option A: Railway

1. **Create Account**: https://railway.app
2. **New Project**: "Deploy from GitHub repo"
3. **Settings**:
   - Root directory: `backend`
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
4. **Environment Variables**:
   ```
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   OPENAI_API_KEY=your-openai-key
   OPENAI_MODEL=gpt-4-vision-preview
   WEBHOOK_SECRET=generate-random-secret
   PORT=3001
   ```
5. **Deploy**: Railway will build and deploy
6. **Note the URL**: `https://your-app.railway.app`

### Option B: Fly.io

1. **Install CLI**: https://fly.io/docs/hands-on/install-flyctl/
2. **Login**: `flyctl auth login`
3. **Create fly.toml**:

```toml
app = "interactive-flow-processor"

[build]
  dockerfile = "backend/Dockerfile"

[env]
  PORT = "3001"

[[services]]
  http_checks = []
  internal_port = 3001
  protocol = "tcp"

  [[services.ports]]
    port = 80
    handlers = ["http"]

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]
```

4. **Set secrets**:
```bash
flyctl secrets set SUPABASE_URL=https://xxx.supabase.co
flyctl secrets set SUPABASE_SERVICE_ROLE_KEY=your-key
flyctl secrets set OPENAI_API_KEY=your-key
flyctl secrets set OPENAI_MODEL=gpt-4-vision-preview
flyctl secrets set WEBHOOK_SECRET=your-secret
```

5. **Deploy**: `flyctl deploy`

### Option C: Google Cloud Run

1. **Build and push image**:
```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT/processor
```

2. **Deploy**:
```bash
gcloud run deploy processor \
  --image gcr.io/YOUR_PROJECT/processor \
  --platform managed \
  --region us-central1 \
  --set-env-vars SUPABASE_URL=https://xxx.supabase.co \
  --set-env-vars SUPABASE_SERVICE_ROLE_KEY=your-key \
  --set-env-vars OPENAI_API_KEY=your-key \
  --set-env-vars OPENAI_MODEL=gpt-4-vision-preview \
  --set-env-vars WEBHOOK_SECRET=your-secret \
  --memory 2Gi \
  --cpu 2
```

## Step 3: Deploy Web App (Vercel)

### 3.1 Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/flowsense.git
git push -u origin main
```

### 3.2 Import to Vercel

1. Go to https://vercel.com
2. "Import Project" from GitHub
3. Select your repo
4. **Framework Preset**: Next.js
5. **Root Directory**: `frontend`

### 3.3 Environment Variables

Add in Vercel project settings:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PROCESSOR_WEBHOOK_SECRET=same-as-processor
PROCESSOR_BASE_URL=https://your-processor.railway.app
```

### 3.4 Build Settings

- Build Command: `cd ../.. && npm install && npm run build --workspace=@interactive-flow/shared && cd frontend && npm run build`
- Output Directory: `frontend/.next`
- Install Command: `npm install`

### 3.5 Deploy

Click "Deploy" and wait for build to complete.

## Step 4: Configure Production URLs

### 4.1 Update Supabase Auth

In Supabase Dashboard:
- Site URL: `https://your-app.vercel.app`
- Redirect URLs: `https://your-app.vercel.app/auth/callback`

### 4.2 Test End-to-End

1. Visit your Vercel URL
2. Sign up with email
3. Upload test video
4. Verify processing completes
5. Check report displays correctly

## Security Checklist

- [ ] Supabase RLS policies enabled
- [ ] Storage bucket is private
- [ ] Service role key only on server
- [ ] Webhook secret matches between web and processor
- [ ] CORS configured if needed
- [ ] Rate limiting on API routes (optional)
- [ ] Input validation on all endpoints

## Monitoring

### Web App (Vercel)

- Logs: Vercel Dashboard > Deployments > Logs
- Analytics: Vercel Dashboard > Analytics
- Errors: Integrate Sentry (optional)

### Processor

- **Railway**: Railway Dashboard > Logs
- **Fly.io**: `flyctl logs`
- **Cloud Run**: Google Cloud Console > Logging

### Database

- Supabase Dashboard > Database > Logs
- Supabase Dashboard > Storage > Logs

## Scaling Considerations

### High Volume

1. **Multiple Processor Workers**: Deploy multiple instances behind a load balancer
2. **Queue System**: Add Redis queue for job management
3. **CDN**: Use Vercel Edge Network for static assets
4. **Database**: Upgrade Supabase plan for more connections

### Cost Optimization

1. **Processor**: Use spot instances or scale-to-zero
2. **Storage**: Implement lifecycle policies to archive old videos
3. **AI**: Batch multiple frames per API call (if using sequence analysis)
4. **Caching**: Cache frame URLs with longer expiry

## Backup Strategy

### Database

```bash
# Automated via Supabase (paid plans)
# Or manual:
supabase db dump -f backup.sql
```

### Storage

Use Supabase Storage backup features or sync to S3/GCS.

## Troubleshooting Production Issues

### Processor Not Receiving Jobs

1. Check webhook URL is correct
2. Verify webhook secret matches
3. Test processor health endpoint
4. Check processor logs for errors

### Video Upload Fails

1. Check Supabase Storage bucket exists
2. Verify file size limits
3. Check CORS settings
4. Review browser network tab

### Analysis Stuck in "Processing"

1. Check processor logs
2. Verify OpenAI API key is valid
3. Check OpenAI rate limits
4. Restart processor if needed

### High Costs

1. Monitor OpenAI API usage
2. Reduce FRAME_EXTRACTION_FPS
3. Implement per-user rate limits
4. Archive old analyses

## Updates and Maintenance

### Update Web App

```bash
git add .
git commit -m "Update message"
git push
```

Vercel auto-deploys on push to main.

### Update Processor

Railway/Fly.io auto-deploy on push, or:

```bash
# Railway: git push
# Fly.io: flyctl deploy
# Cloud Run: gcloud builds submit && gcloud run deploy
```

### Database Migrations

```bash
supabase db diff -f new_migration
supabase db push
```

## Support

For deployment issues:
- Vercel: https://vercel.com/support
- Railway: https://railway.app/help
- Supabase: https://supabase.com/support
