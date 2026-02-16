#!/usr/bin/env node

/**
 * FlowSense Azure readiness check
 *
 * Usage:
 *   node scripts/test-step-by-step.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();
const FRONTEND_ENV = path.join(ROOT, 'frontend', '.env.local');
const BACKEND_ENV = path.join(ROOT, 'backend', '.env');

const FRONTEND_REQUIRED = [
  'APP_BASE_URL',
  'AUTH_SESSION_SECRET',
  'ENTRA_TENANT_ID',
  'ENTRA_CLIENT_ID',
  'ENTRA_CLIENT_SECRET',
  'AZURE_SQL_SERVER',
  'AZURE_SQL_DATABASE',
  'AZURE_STORAGE_ACCOUNT_NAME',
  'AZURE_STORAGE_CONTAINER',
  'PROCESSOR_BASE_URL',
  'PROCESSOR_WEBHOOK_SECRET',
];

const BACKEND_REQUIRED = [
  'PORT',
  'PROCESSOR_WORKER_ID',
  'WEBHOOK_SECRET',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_DEPLOYMENT',
  'AZURE_OPENAI_API_VERSION',
  'AZURE_SQL_SERVER',
  'AZURE_SQL_DATABASE',
  'AZURE_STORAGE_ACCOUNT_NAME',
  'AZURE_STORAGE_CONTAINER',
];

const FORBIDDEN = ['AZURE_STORAGE_ACCOUNT_KEY', 'AZURE_STORAGE_CONNECTION_STRING'];

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    result[key] = value;
  }

  return result;
}

function checkCommand(name) {
  try {
    execSync(`command -v ${name}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function validateEnv(label, envMap, requiredKeys) {
  const missing = [];
  const forbiddenFound = [];

  for (const key of requiredKeys) {
    if (!envMap[key] || envMap[key].length === 0) {
      missing.push(key);
    }
  }

  for (const key of FORBIDDEN) {
    if (envMap[key] && envMap[key].length > 0) {
      forbiddenFound.push(key);
    }
  }

  console.log(`\n[${label}]`);
  if (missing.length === 0) {
    console.log('  OK required env vars are set');
  } else {
    console.log('  FAIL missing required vars:');
    for (const key of missing) console.log(`    - ${key}`);
  }

  if (forbiddenFound.length === 0) {
    console.log('  OK no deprecated shared-key storage vars detected');
  } else {
    console.log('  FAIL forbidden vars set:');
    for (const key of forbiddenFound) console.log(`    - ${key}`);
  }

  return missing.length === 0 && forbiddenFound.length === 0;
}

function main() {
  console.log('='.repeat(68));
  console.log('FlowSense Azure Readiness Check');
  console.log('='.repeat(68));

  let ok = true;

  const frontendEnv = parseEnvFile(FRONTEND_ENV);
  if (!frontendEnv) {
    console.log(`\n[frontend] FAIL missing file: ${FRONTEND_ENV}`);
    ok = false;
  } else if (!validateEnv('frontend', frontendEnv, FRONTEND_REQUIRED)) {
    ok = false;
  }

  const backendEnv = parseEnvFile(BACKEND_ENV);
  if (!backendEnv) {
    console.log(`\n[backend] FAIL missing file: ${BACKEND_ENV}`);
    ok = false;
  } else if (!validateEnv('backend', backendEnv, BACKEND_REQUIRED)) {
    ok = false;
  }

  console.log('\n[tooling]');
  const hasFfmpeg = checkCommand('ffmpeg');
  const hasFfprobe = checkCommand('ffprobe');
  console.log(`  ${hasFfmpeg ? 'OK' : 'FAIL'} ffmpeg ${hasFfmpeg ? 'found' : 'not found'}`);
  console.log(`  ${hasFfprobe ? 'OK' : 'FAIL'} ffprobe ${hasFfprobe ? 'found' : 'not found'}`);
  if (!hasFfmpeg || !hasFfprobe) {
    ok = false;
  }

  console.log('\n[result]');
  if (ok) {
    console.log('  PASS environment and tooling checks are ready for Azure local run');
    process.exit(0);
  }

  console.log('  FAIL fix the issues above before running FlowSense locally');
  process.exit(1);
}

main();
