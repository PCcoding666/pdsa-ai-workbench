#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const SOURCE_ID = process.env.ASR_SOURCE_ID || 'bloomberg-tv';
const SOURCE_NAME = process.env.ASR_SOURCE_NAME || 'Bloomberg TV';
const API_BASE = (process.env.ASR_API_BASE || process.env.API_BASE || 'http://localhost:3002').replace(/\/+$/, '');
const WATCH_DIR = process.env.ASR_WATCH_DIR || path.join(rootDir, 'audio', SOURCE_ID, 'incoming');
const PROCESSED_DIR = process.env.ASR_PROCESSED_DIR || path.join(rootDir, 'audio', SOURCE_ID, 'processed');
const FAILED_DIR = process.env.ASR_FAILED_DIR || path.join(rootDir, 'audio', SOURCE_ID, 'failed');
const LOG_DIR = process.env.ASR_LOG_DIR || path.join(rootDir, 'audio', SOURCE_ID, 'logs');
const POLL_MS = Number(process.env.ASR_POLL_MS || 5000);
const MIN_AGE_MS = Number(process.env.ASR_MIN_AGE_MS || 2500);
const MODEL = process.env.ASR_MODEL || 'base';
const LANGUAGE = process.env.ASR_LANGUAGE || 'en';
const INITIAL_PROMPT =
  process.env.ASR_INITIAL_PROMPT ||
  'Financial market TV transcript. Company and ticker vocabulary: Bloomberg, CNBC, Fox Business, NVIDIA, NVDA, AMD, Microsoft, MSFT, Google, Alphabet, GOOG, Amazon, AMZN, Meta, META, Tesla, TSLA, Broadcom, AVGO, Oracle, ORCL, Palantir, PLTR, AI data center demand, hyperscaler capex.';
const BACKEND = process.env.ASR_BACKEND || 'whisper';
const WHISPER_COMMAND = process.env.WHISPER_COMMAND || 'whisper';
const WORKER_ID = process.env.ASR_WORKER_ID || `${SOURCE_ID}-${crypto.randomUUID().slice(0, 8)}`;
const ONCE = process.argv.includes('--once') || process.env.ASR_ONCE === '1';
const DRY_RUN = process.argv.includes('--dry-run') || process.env.ASR_DRY_RUN === '1';
const SUPPORTED_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.aiff', '.aif', '.flac', '.ogg']);
const PROXY_ENV = inferProxyEnv();

const inFlight = new Set();

main().catch((error) => {
  console.error(`[asr-worker] fatal: ${error.stack || error.message}`);
  process.exitCode = 1;
});

async function main() {
  ensureDirs();
  logEvent('worker_start', {
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    watchDir: WATCH_DIR,
    apiBase: API_BASE,
    backend: BACKEND,
    model: MODEL,
    language: LANGUAGE,
    dryRun: DRY_RUN,
    once: ONCE,
    proxyEnv: Object.keys(PROXY_ENV),
  });

  await scanOnce();
  if (ONCE) return;

  setInterval(() => {
    scanOnce().catch((error) => {
      logEvent('scan_failed', { error: error.message });
      console.error(`[asr-worker] scan failed: ${error.message}`);
    });
  }, POLL_MS);
}

async function scanOnce() {
  const files = fs
    .readdirSync(WATCH_DIR)
    .map((name) => path.join(WATCH_DIR, name))
    .filter((filePath) => {
      const stat = safeStat(filePath);
      return stat?.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
    })
    .sort((a, b) => safeStat(a).mtimeMs - safeStat(b).mtimeMs);

  for (const filePath of files) {
    if (inFlight.has(filePath) || !isStableFile(filePath)) continue;
    inFlight.add(filePath);
    try {
      await processFile(filePath);
    } finally {
      inFlight.delete(filePath);
    }
  }
}

async function processFile(filePath) {
  const startedAt = new Date().toISOString();
  logEvent('file_start', { filePath, startedAt });

  try {
    const result = await transcribe(filePath);
    if (!result.text) throw new Error('ASR returned empty transcript');

    const payload = {
      sourceId: SOURCE_ID,
      sourceName: SOURCE_NAME,
      timestamp: inferTimestampFromFile(filePath),
      title: `Bloomberg ASR：${truncate(result.text, 100)}`,
      transcript: result.text,
      summary: truncate(result.text, 260),
      timeWindow: path.basename(filePath),
      audioFile: filePath,
      asrBackend: result.backend,
      workerId: WORKER_ID,
    };

    let apiResult = null;
    if (!DRY_RUN) {
      apiResult = await postTranscript(payload);
    }

    const destination = moveFile(filePath, PROCESSED_DIR);
    logEvent('file_processed', {
      filePath,
      destination,
      transcriptLength: result.text.length,
      eventId: apiResult?.event?.id || '',
      dryRun: DRY_RUN,
    });
    console.log(`[asr-worker] processed ${path.basename(filePath)} -> ${apiResult?.event?.id || 'dry-run'}`);
  } catch (error) {
    const destination = moveFile(filePath, FAILED_DIR);
    logEvent('file_failed', { filePath, destination, error: error.message });
    console.error(`[asr-worker] failed ${path.basename(filePath)}: ${error.message}`);
  }
}

async function transcribe(filePath) {
  if (BACKEND === 'sidecar') return transcribeFromSidecar(filePath);
  if (BACKEND === 'whisper') return transcribeWithWhisper(filePath);
  throw new Error(`Unsupported ASR_BACKEND: ${BACKEND}`);
}

async function transcribeFromSidecar(filePath) {
  const sidecarPath = `${filePath}.txt`;
  if (!fs.existsSync(sidecarPath)) throw new Error(`Missing sidecar transcript: ${sidecarPath}`);
  return {
    backend: 'sidecar',
    text: fs.readFileSync(sidecarPath, 'utf8').trim(),
    segments: [],
  };
}

async function transcribeWithWhisper(filePath) {
  const outputDir = fs.mkdtempSync(path.join(LOG_DIR, 'whisper-'));
  const args = [
    filePath,
    '--model',
    MODEL,
    '--language',
    LANGUAGE,
    '--output_dir',
    outputDir,
    '--output_format',
    'json',
    '--verbose',
    'False',
    '--fp16',
    'False',
  ];
  if (INITIAL_PROMPT) {
    args.push('--initial_prompt', INITIAL_PROMPT);
  }
  await runCommand(WHISPER_COMMAND, args, { timeoutMs: Number(process.env.ASR_TIMEOUT_MS || 10 * 60 * 1000) });
  const jsonPath = path.join(outputDir, `${path.parse(filePath).name}.json`);
  if (!fs.existsSync(jsonPath)) throw new Error(`Whisper output not found: ${jsonPath}`);
  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  return {
    backend: `whisper:${MODEL}`,
    text: cleanText(parsed.text || ''),
    segments: Array.isArray(parsed.segments) ? parsed.segments : [],
  };
}

async function postTranscript(payload) {
  const response = await fetch(`${API_BASE}/api/events/transcripts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = { raw: bodyText };
  }
  if (!response.ok) {
    throw new Error(body.message || body.error || `Transcript API returned HTTP ${response.status}`);
  }
  return body;
}

function runCommand(command, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...PROXY_ENV },
    });
    let stderr = '';
    let stdout = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} exited with ${code}: ${truncate(stderr || stdout, 600)}`));
      }
    });
  });
}

function ensureDirs() {
  [WATCH_DIR, PROCESSED_DIR, FAILED_DIR, LOG_DIR].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
}

function isStableFile(filePath) {
  const stat = safeStat(filePath);
  if (!stat) return false;
  return Date.now() - stat.mtimeMs >= MIN_AGE_MS && stat.size > 0;
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function moveFile(filePath, directory) {
  fs.mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, `${Date.now()}-${path.basename(filePath)}`);
  fs.renameSync(filePath, destination);
  const sidecarPath = `${filePath}.txt`;
  if (fs.existsSync(sidecarPath)) {
    fs.renameSync(sidecarPath, `${destination}.txt`);
  }
  return destination;
}

function inferTimestampFromFile(filePath) {
  const name = path.basename(filePath);
  const match = name.match(/(\d{4})(\d{2})(\d{2})[T_-]?(\d{2})(\d{2})(\d{2})?/);
  if (match) {
    const [, year, month, day, hour, minute, second = '00'] = match;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`).toISOString();
  }
  const stat = safeStat(filePath);
  return stat ? stat.mtime.toISOString() : new Date().toISOString();
}

function inferProxyEnv() {
  if (process.env.http_proxy || process.env.https_proxy || process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
    return {};
  }

  const result = spawnSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return {};

  const httpEnabled = /HTTPEnable\s*:\s*1/.test(result.stdout);
  const httpsEnabled = /HTTPSEnable\s*:\s*1/.test(result.stdout);
  const httpHost = result.stdout.match(/HTTPProxy\s*:\s*([^\n]+)/)?.[1]?.trim();
  const httpPort = result.stdout.match(/HTTPPort\s*:\s*(\d+)/)?.[1]?.trim();
  const httpsHost = result.stdout.match(/HTTPSProxy\s*:\s*([^\n]+)/)?.[1]?.trim() || httpHost;
  const httpsPort = result.stdout.match(/HTTPSPort\s*:\s*(\d+)/)?.[1]?.trim() || httpPort;
  const env = {};

  if (httpEnabled && httpHost && httpPort) {
    env.http_proxy = `http://${httpHost}:${httpPort}`;
    env.HTTP_PROXY = env.http_proxy;
  }
  if (httpsEnabled && httpsHost && httpsPort) {
    env.https_proxy = `http://${httpsHost}:${httpsPort}`;
    env.HTTPS_PROXY = env.https_proxy;
  }

  return env;
}

function logEvent(type, data = {}) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const payload = {
    time: new Date().toISOString(),
    workerId: WORKER_ID,
    type,
    ...data,
  };
  fs.appendFileSync(path.join(LOG_DIR, 'asr-worker.jsonl'), `${JSON.stringify(payload)}\n`, 'utf8');
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncate(value, maxLength) {
  const text = cleanText(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}
