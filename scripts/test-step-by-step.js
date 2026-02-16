#!/usr/bin/env node

/**
 * Step-by-step testing script for FlowSense
 * Tests each component independently
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_KEY = 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjA4NDQzMzMyMH0.DCUugYwr9IKz9H8M8oYH4QnB_mWgkmsHNZbo7fQe87RAIpm53U3NGlBh9dXhPsdiW79WDobh61mbyHxm0MbyiA';
const OLLAMA_URL = 'http://localhost:11434';

console.log('='.repeat(60));
console.log('INTERACTIVE FLOW ANALYZER - STEP BY STEP TEST');
console.log('='.repeat(60));
console.log('');

// STEP 1: Test video file selection
async function step1_selectVideo() {
  console.log('[STEP 1] Video File Selection');
  console.log('-'.repeat(60));

  // Check for test video
  const testVideoPath = process.argv[2];

  if (!testVideoPath) {
    console.log('❌ No video file provided');
    console.log('');
    console.log('Usage: node scripts/test-step-by-step.js /path/to/video.mp4');
    console.log('');
    console.log('Please provide a video file path as argument');
    process.exit(1);
  }

  if (!fs.existsSync(testVideoPath)) {
    console.log(`❌ Video file not found: ${testVideoPath}`);
    process.exit(1);
  }

  const stats = fs.statSync(testVideoPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

  console.log(`✅ Video file found: ${path.basename(testVideoPath)}`);
  console.log(`   Size: ${sizeMB} MB`);
  console.log('');

  return { path: testVideoPath, size: stats.size };
}

// STEP 2: Test Supabase storage upload
async function step2_uploadToStorage(videoInfo) {
  console.log('[STEP 2] Upload to Supabase Storage');
  console.log('-'.repeat(60));

  try {
    const videoBuffer = fs.readFileSync(videoInfo.path);
    const testPath = `test-uploads/test-${Date.now()}.mp4`;

    console.log(`Uploading to: ${testPath}`);

    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/videos/${testPath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'video/mp4',
      },
      body: videoBuffer,
    });

    if (!response.ok) {
      const error = await response.text();
      console.log(`❌ Upload failed: ${response.status} ${response.statusText}`);
      console.log(`   Error: ${error}`);
      return null;
    }

    console.log('✅ Video uploaded successfully');
    console.log(`   Storage path: ${testPath}`);
    console.log('');

    return { storagePath: testPath, buffer: videoBuffer };
  } catch (error) {
    console.log(`❌ Upload error: ${error.message}`);
    return null;
  }
}

// STEP 3: Test frame extraction
async function step3_extractFrames(videoInfo) {
  console.log('[STEP 3] Extract Frames with ffmpeg');
  console.log('-'.repeat(60));

  try {
    const tempDir = path.join(process.cwd(), 'temp', `test-${Date.now()}`);
    const videoPath = path.join(tempDir, 'video.mp4');
    const framesDir = path.join(tempDir, 'frames');

    // Create directories
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(framesDir, { recursive: true });

    // Save video
    fs.writeFileSync(videoPath, videoInfo.buffer);
    console.log(`Video saved to: ${videoPath}`);

    // Extract frames at 2 FPS
    const ffmpegPath = '/opt/homebrew/bin/ffmpeg';
    console.log('Running ffmpeg to extract frames at 2 FPS...');

    await execAsync(
      `${ffmpegPath} -i "${videoPath}" -vf "fps=2" "${framesDir}/frame_%04d.jpg" -y`
    );

    // Count extracted frames
    const frameFiles = fs.readdirSync(framesDir)
      .filter(f => f.endsWith('.jpg'))
      .sort();

    console.log(`✅ Extracted ${frameFiles.length} frames`);
    console.log(`   Frames directory: ${framesDir}`);
    console.log('');

    if (frameFiles.length > 0) {
      console.log('   Sample frames:');
      frameFiles.slice(0, 5).forEach((file, i) => {
        const framePath = path.join(framesDir, file);
        const frameSize = fs.statSync(framePath).size;
        console.log(`   ${i + 1}. ${file} (${(frameSize / 1024).toFixed(1)} KB)`);
      });
      console.log('');
    }

    return { tempDir, framesDir, frameFiles };
  } catch (error) {
    console.log(`❌ Frame extraction failed: ${error.message}`);
    return null;
  }
}

// STEP 4: Test Ollama vision model on single frame
async function step4_testOllamaVision(framesInfo) {
  console.log('[STEP 4] Test Ollama Vision Model');
  console.log('-'.repeat(60));

  try {
    // Check if Ollama is running
    console.log('Checking Ollama service...');
    const healthResponse = await fetch(`${OLLAMA_URL}/api/tags`);

    if (!healthResponse.ok) {
      console.log('❌ Ollama is not running');
      console.log('   Start it with: brew services start ollama');
      return null;
    }

    const models = await healthResponse.json();
    const hasVisionModel = models.models?.some(m => m.name.includes('llama3.2-vision'));

    if (!hasVisionModel) {
      console.log('❌ Llama 3.2 Vision model not found');
      console.log('   Install it with: ollama pull llama3.2-vision:11b');
      return null;
    }

    console.log('✅ Ollama running with Llama 3.2 Vision');
    console.log('');

    // Test on first frame
    const firstFrame = path.join(framesInfo.framesDir, framesInfo.frameFiles[0]);
    console.log(`Testing on frame: ${framesInfo.frameFiles[0]}`);

    const frameBuffer = fs.readFileSync(firstFrame);
    const base64Image = frameBuffer.toString('base64');

    console.log('Sending frame to Ollama...');
    console.log('(This may take 30-60 seconds for first request)');

    const startTime = Date.now();

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2-vision:11b',
        prompt: 'Describe what you see in this image in 2-3 sentences.',
        images: [base64Image],
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 200,
        },
      }),
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!response.ok) {
      console.log(`❌ Ollama request failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log('');
    console.log('✅ Ollama analysis successful');
    console.log(`   Duration: ${duration} seconds`);
    console.log('');
    console.log('   Response:');
    console.log(`   "${data.response}"`);
    console.log('');

    return { success: true, duration: parseFloat(duration) };
  } catch (error) {
    console.log(`❌ Ollama test failed: ${error.message}`);
    return null;
  }
}

// STEP 5: Test frame analysis with UX rubric
async function step5_testUXAnalysis(framesInfo) {
  console.log('[STEP 5] Test UX Analysis with Rubric');
  console.log('-'.repeat(60));

  try {
    const firstFrame = path.join(framesInfo.framesDir, framesInfo.frameFiles[0]);
    const frameBuffer = fs.readFileSync(firstFrame);
    const base64Image = frameBuffer.toString('base64');

    const rubricPrompt = `You are a UX interaction-flow evaluator. Analyze this screenshot and provide scores.

Rubric categories (score 0/1/2):
1) Action → Response Integrity
2) Feedback & System Status Visibility
3) Interaction Predictability & Affordance
4) Flow Continuity & Friction
5) Error Handling & Recovery
6) Micro-interaction Quality (Polish)
7) Efficiency & Interaction Cost

Return ONLY valid JSON in this format:
{
  "rubric_scores": { "cat1":1, "cat2":1, "cat3":1, "cat4":1, "cat5":1, "cat6":1, "cat7":1 },
  "justifications": { "cat1": "...", "cat2":"...", "cat3":"...", "cat4":"...", "cat5":"...", "cat6":"...", "cat7":"..." },
  "issue_tags": [],
  "suggestions": [{ "severity":"med", "title":"...", "description":"..." }]
}`;

    console.log('Analyzing frame with UX rubric...');
    console.log('(This may take 60-90 seconds)');

    const startTime = Date.now();

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2-vision:11b',
        prompt: rubricPrompt,
        images: [base64Image],
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 1500,
        },
      }),
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!response.ok) {
      console.log(`❌ Analysis failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log('');
    console.log('✅ UX analysis successful');
    console.log(`   Duration: ${duration} seconds`);
    console.log('');

    // Try to parse JSON from response
    const jsonMatch = data.response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log('   Parsed scores:');
        Object.entries(parsed.rubric_scores).forEach(([cat, score]) => {
          console.log(`     ${cat}: ${score}/2`);
        });
        console.log('');
        return { success: true, analysis: parsed };
      } catch (e) {
        console.log('   ⚠️  Could not parse JSON from response');
        console.log('   Raw response preview:');
        console.log(`   ${data.response.substring(0, 300)}...`);
      }
    } else {
      console.log('   ⚠️  No JSON found in response');
      console.log('   Raw response preview:');
      console.log(`   ${data.response.substring(0, 300)}...`);
    }

    return { success: true, raw: data.response };
  } catch (error) {
    console.log(`❌ UX analysis failed: ${error.message}`);
    return null;
  }
}

// STEP 6: Summary
async function step6_summary(results) {
  console.log('[STEP 6] Summary');
  console.log('-'.repeat(60));

  console.log('Component Status:');
  console.log(`  Video Upload:       ${results.upload ? '✅' : '❌'}`);
  console.log(`  Frame Extraction:   ${results.frames ? '✅' : '❌'}`);
  console.log(`  Ollama Vision:      ${results.ollama ? '✅' : '❌'}`);
  console.log(`  UX Analysis:        ${results.uxAnalysis ? '✅' : '❌'}`);
  console.log('');

  if (results.ollama && results.uxAnalysis) {
    console.log('🎉 All components working! Ready for full pipeline.');
  } else {
    console.log('⚠️  Some components need attention before running full pipeline.');
  }

  console.log('');
  console.log('='.repeat(60));
}

// Main execution
async function main() {
  const results = {};

  try {
    const videoInfo = await step1_selectVideo();

    const uploadResult = await step2_uploadToStorage(videoInfo);
    results.upload = uploadResult !== null;
    if (!uploadResult) return;

    const framesResult = await step3_extractFrames(uploadResult);
    results.frames = framesResult !== null;
    if (!framesResult) return;

    const ollamaResult = await step4_testOllamaVision(framesResult);
    results.ollama = ollamaResult !== null;

    if (ollamaResult) {
      const uxResult = await step5_testUXAnalysis(framesResult);
      results.uxAnalysis = uxResult !== null;
    }

    await step6_summary(results);

    // Cleanup
    if (framesResult) {
      console.log(`Cleaning up temp directory: ${framesResult.tempDir}`);
      fs.rmSync(framesResult.tempDir, { recursive: true, force: true });
    }

  } catch (error) {
    console.error('');
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
