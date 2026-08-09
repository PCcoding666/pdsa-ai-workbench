#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  appendJsonlWithRotation,
  buildTranscriptPayload,
  cleanText,
  createDedupeState,
  ensurePrivateDirectory,
  ensurePrivateFile,
  ensurePrivateRuntimeDirectory,
  hashFile,
  hashText,
  isFreshMalformedJsonLock,
  isDuplicateAudio,
  isDuplicateText,
  isStableSnapshot,
  loadSourceConfig,
  readJsonFile,
  recordDedupe,
  REPO_ROOT,
  resolveApiCredentials,
  pruneFilesOlderThan,
  snapshotFile,
  tryCreateExclusiveJsonLock,
  tryReclaimStaleJsonLock,
  writeJsonAtomic,
} from './asr-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const sourceIdArg = getOption('--source');
const ONCE = args.includes('--once') || process.env.ASR_ONCE === '1';
const DRY_RUN = args.includes('--dry-run') || process.env.ASR_DRY_RUN === '1';
const SUPPORTED_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.aiff', '.aif', '.flac', '.ogg']);
const PROXY_ENV = inferProxyEnv();

let source;
try {
  source = loadSourceConfig({ sourceId: sourceIdArg || process.env.ASR_SOURCE_ID });
} catch (error) {
  console.error(`[asr-worker] configuration error: ${error.message}`);
  process.exit(2);
}

const WORKER_ID = process.env.ASR_WORKER_ID || `${source.id}-${crypto.randomUUID().slice(0, 8)}`;
const FUNASR_REALTIME_SCRIPT = process.env.FUNASR_REALTIME_SCRIPT || path.join(__dirname, 'funasr-realtime.js');
const FFPROBE_COMMAND = process.env.FFPROBE_COMMAND || 'ffprobe';
const TIMEOUT_MS = positiveNumber(process.env.ASR_TIMEOUT_MS, 10 * 60 * 1000);
const HTTP_TIMEOUT_MS = positiveNumber(process.env.ASR_HTTP_TIMEOUT_MS, 20 * 1000);
const RETRY_BASE_MS = positiveNumber(process.env.ASR_RETRY_BASE_MS, 750);
const DEDUPE_MAX_ENTRIES = positiveInteger(process.env.ASR_DEDUPE_MAX_ENTRIES, 50_000);
const DEDUPE_RETENTION_MS = positiveNumber(process.env.ASR_DEDUPE_RETENTION_MS, 30 * 24 * 60 * 60 * 1000);
const DEDUPE_COMPACT_INTERVAL_MS = positiveNumber(process.env.ASR_DEDUPE_COMPACT_INTERVAL_MS, 15 * 60 * 1000);
const SHUTDOWN_GRACE_MS = positiveNumber(process.env.ASR_SHUTDOWN_GRACE_MS, 10 * 1000);
const COMMAND_KILL_GRACE_MS = positiveNumber(process.env.ASR_COMMAND_KILL_GRACE_MS, 5 * 1000);
const AUDIO_RETENTION_MS = resolveRetentionMs({ millisecondsEnv: 'ASR_AUDIO_RETENTION_MS', daysEnv: 'ASR_AUDIO_RETENTION_DAYS', fallbackDays: 7 });
const FAILED_RETENTION_MS = resolveRetentionMs({ millisecondsEnv: 'ASR_FAILED_RETENTION_MS', daysEnv: 'ASR_FAILED_RETENTION_DAYS', fallbackDays: 30 });
const RETENTION_CHECK_INTERVAL_MS = positiveNumber(process.env.ASR_RETENTION_CHECK_INTERVAL_MS, 60 * 60 * 1000);
const LOG_MAX_BYTES = positiveNumber(process.env.ASR_LOG_MAX_BYTES, 10 * 1024 * 1024);
const LOG_MAX_ROTATED_FILES = nonNegativeInteger(process.env.ASR_LOG_MAX_ROTATED_FILES, 5);
const DEDUPE_FILE = path.join(source.logDir, 'dedupe.json');
const DEDUPE_JOURNAL_FILE = path.join(source.logDir, 'dedupe.jsonl');
const HEALTH_FILE = path.join(source.logDir, 'health.json');
let apiAuth;
try {
  apiAuth = resolveApiCredentials();
} catch (error) {
  console.error(`[asr-worker] configuration error: ${error.message}`);
  process.exit(2);
}

const inFlight = new Set();
const activeChildren = new Set();
const activeAbortControllers = new Set();
const pendingDelays = new Set();
let dedupeState = loadDedupeState();
let lastDedupeCompactionAt = 0;
let lastRetentionCheckAt = 0;
let scanTimer = null;
let scanInProgress = false;
let shutdownRequested = false;
let shutdownPromise = null;
let workerLock = null;
const health = {
  sourceId: source.id,
  sourceName: source.sourceName,
  workerId: WORKER_ID,
  status: 'starting',
  startedAt: new Date().toISOString(),
  backend: source.asrBackend,
  model: source.asrModel,
  metrics: { processed: 0, failed: 0, duplicate: 0, noSpeech: 0, retries: 0 },
  lastError: '',
  lastEventId: '',
  retention: { lastCheckedAt: '', processedRemoved: 0, skippedRemoved: 0, failedRemoved: 0 },
};

process.on('SIGTERM', () => { void requestShutdown('SIGTERM'); });
process.on('SIGINT', () => { void requestShutdown('SIGINT'); });

main().catch((error) => {
  if (isWorkerLockError(error)) {
    console.error(`[asr-worker] blocked: ${cleanText(error.message)}`);
    process.exitCode = 3;
    return;
  }
  health.status = 'failed';
  health.lastError = cleanText(error.stack || error.message);
  writeHealth();
  logEvent('worker_fatal', { error: health.lastError });
  console.error(`[asr-worker] fatal: ${health.lastError}`);
  releaseWorkerLock();
  process.exitCode = 1;
});

async function main() {
  process.umask(0o077);
  ensureDirs();
  workerLock = acquireWorkerLock();
  persistDedupeState({ force: true });
  logEvent('worker_start', {
    sourceId: source.id,
    sourceName: source.sourceName,
    watchDir: source.watchDir,
    apiBase: source.apiBase,
    backend: source.asrBackend,
    model: source.asrModel,
    language: source.language,
    dryRun: DRY_RUN,
    once: ONCE,
    proxyEnv: Object.keys(PROXY_ENV),
    apiAuthEnabled: Boolean(apiAuth),
  });
  runRetention({ force: true });
  writeHealth();

  await runScan('initial');
  if (shutdownRequested) {
    await shutdownPromise;
    return;
  }
  if (ONCE) {
    releaseWorkerLock();
    return;
  }

  scanTimer = setInterval(() => { void runScan('scheduled'); }, source.pollMs);
}

async function runScan(trigger) {
  if (shutdownRequested) return;
  if (scanInProgress) {
    logEvent('scan_skipped_overlap', { trigger });
    return;
  }

  scanInProgress = true;
  try {
    await scanOnce();
    runRetention();
    if (!shutdownRequested && health.status !== 'failed') {
      health.status = health.lastError ? 'degraded' : 'healthy';
      writeHealth();
    }
  } catch (error) {
    if (shutdownRequested) return;
    health.status = 'degraded';
    health.lastError = cleanText(error.message);
    writeHealth();
    logEvent('scan_failed', { error: health.lastError });
    console.error(`[asr-worker] scan failed: ${health.lastError}`);
  } finally {
    scanInProgress = false;
  }
}

async function scanOnce() {
  const files = fs.readdirSync(source.watchDir)
    .map((name) => path.join(source.watchDir, name))
    .filter((filePath) => {
      const snapshot = snapshotFile(filePath);
      return snapshot.exists && SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
    })
    .sort((a, b) => snapshotFile(a).mtimeMs - snapshotFile(b).mtimeMs);

  for (const filePath of files) {
    if (shutdownRequested) return;
    if (inFlight.has(filePath)) continue;
    inFlight.add(filePath);
    try {
      if (!(await isStableFile(filePath))) continue;
      if (shutdownRequested) return;
      await processFile(filePath);
    } finally {
      inFlight.delete(filePath);
    }
  }
}

async function isStableFile(filePath) {
  const first = snapshotFile(filePath);
  if (!first.exists || first.size <= 0 || Date.now() - first.mtimeMs < source.minAgeMs) return false;
  await delay(source.stableCheckMs);
  if (shutdownRequested) return false;
  const second = snapshotFile(filePath);
  return isStableSnapshot(first, second, { minAgeMs: source.minAgeMs });
}

async function processFile(filePath) {
  if (shutdownRequested) return;
  const processingStartedMs = Date.now();
  const startedAt = inferTimestampFromFile(filePath);
  const basename = path.basename(filePath);
  logEvent('file_start', { filePath, startedAt });

  try {
    const audioHash = hashFile(filePath);
    if (isDuplicateAudio(dedupeState, audioHash)) {
      const destination = moveAssets(filePath, createDestination(source.processedDir, basename));
      health.metrics.duplicate += 1;
      writeHealth();
      logEvent('file_duplicate_audio', { filePath, destination, audioHash });
      return;
    }

    const result = await withRetries('transcribe', () => transcribe(filePath));
    if (result.noSpeech || !cleanText(result.text)) {
      recordDurableDedupe({ sourceId: source.id, audioHash, timestampMs: new Date(startedAt).getTime() });
      const destination = moveAssets(filePath, createDestination(source.skippedDir, basename));
      health.metrics.noSpeech += 1;
      health.lastError = '';
      writeHealth();
      logEvent('file_no_speech', {
        filePath,
        destination,
        backend: result.backend,
        processingLatencyMs: Date.now() - processingStartedMs,
      });
      console.log(`[asr-worker] skipped no-speech segment ${basename}`);
      return;
    }
    const textHash = hashText(result.text);
    if (isDuplicateText(dedupeState, {
      sourceId: source.id,
      textHash,
      timestampMs: new Date(startedAt).getTime(),
      windowMs: source.textDedupeWindowMs,
    })) {
      recordDurableDedupe({ sourceId: source.id, audioHash, textHash, timestampMs: new Date(startedAt).getTime() });
      const destination = moveAssets(filePath, createDestination(source.processedDir, basename));
      health.metrics.duplicate += 1;
      writeHealth();
      logEvent('file_duplicate_text', { filePath, destination, audioHash, textHash });
      return;
    }

    const plannedDestination = createDestination(source.processedDir, basename);
    const durationSeconds = await resolveAudioDurationSeconds(filePath);
    const payload = buildTranscriptPayload({
      source,
      audioHash,
      transcript: result.text,
      audioFile: buildAudioArtifactReference(source.id, plannedDestination),
      startedAt,
      durationSeconds,
      asrBackend: result.backend,
      workerId: WORKER_ID,
    });
    const apiResult = DRY_RUN ? { event: { id: payload.id } } : await withRetries('post', () => postTranscript(payload));

    recordDurableDedupe({
      sourceId: source.id,
      audioHash,
      textHash,
      timestampMs: new Date(startedAt).getTime(),
      eventId: apiResult?.event?.id || payload.id,
    });
    const destination = moveAssets(filePath, plannedDestination);
    health.metrics.processed += 1;
    health.lastEventId = apiResult?.event?.id || payload.id;
    health.lastError = '';
    writeHealth();
    const processedAtMs = Date.now();
    logEvent('file_processed', {
      filePath,
      destination,
      transcriptLength: result.text.length,
      eventId: health.lastEventId,
      processingLatencyMs: processedAtMs - processingStartedMs,
      segmentToEventLatencyMs: processedAtMs - new Date(startedAt).getTime(),
      dryRun: DRY_RUN,
    });
    console.log(`[asr-worker] processed ${basename} -> ${health.lastEventId}`);
  } catch (error) {
    if (shutdownRequested || isShutdownError(error)) {
      logEvent('file_interrupted', { filePath, reason: cleanText(error.message) || 'shutdown requested' });
      return;
    }

    if (!snapshotFile(filePath).exists) {
      health.status = 'degraded';
      health.lastError = `Input disappeared before failure isolation: ${cleanText(error.message)}`;
      writeHealth();
      logEvent('file_missing_after_error', { filePath, error: cleanText(error.message) });
      return;
    }

    const destination = moveAssets(filePath, createDestination(source.failedDir, basename));
    const errorPath = `${destination}.error.json`;
    writeJsonAtomic(errorPath, {
      time: new Date().toISOString(),
      sourceId: source.id,
      workerId: WORKER_ID,
      file: path.basename(filePath),
      error: cleanText(error.message),
    });
    health.metrics.failed += 1;
    health.status = 'degraded';
    health.lastError = cleanText(error.message);
    writeHealth();
    logEvent('file_failed', { filePath, destination, error: health.lastError });
    console.error(`[asr-worker] failed ${basename}: ${health.lastError}`);
  }
}

async function withRetries(type, operation) {
  const maximumAttempts = Math.max(1, source.maxRetries + 1);
  let lastError;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    if (shutdownRequested) throw shutdownError();
    try {
      return await operation();
    } catch (error) {
      if (shutdownRequested || isShutdownError(error)) throw shutdownError();
      lastError = error;
      if (attempt >= maximumAttempts) break;
      const delayMs = RETRY_BASE_MS * (2 ** (attempt - 1));
      health.metrics.retries += 1;
      logEvent(`${type}_retry`, { attempt, nextAttempt: attempt + 1, delayMs, error: cleanText(error.message) });
      await delay(delayMs);
      if (shutdownRequested) throw shutdownError();
    }
  }
  throw lastError;
}

async function transcribe(filePath) {
  if (source.asrBackend === 'sidecar') return transcribeFromSidecar(filePath);
  if (source.asrBackend === 'funasr-realtime') return transcribeWithFunASRRealtime(filePath);
  throw new Error(`Unsupported ASR_BACKEND: ${source.asrBackend}. Only sidecar and funasr-realtime are allowed.`);
}

async function transcribeFromSidecar(filePath) {
  const sidecarPath = `${filePath}.txt`;
  if (!fs.existsSync(sidecarPath)) throw new Error(`Missing sidecar transcript: ${sidecarPath}`);
  const text = cleanText(fs.readFileSync(sidecarPath, 'utf8'));
  return { backend: 'sidecar', text, noSpeech: !text, segments: [] };
}

async function transcribeWithFunASRRealtime(filePath) {
  if (!cleanText(process.env.DASHSCOPE_API_KEY)) {
    throw new Error('DASHSCOPE_API_KEY is required for ASR_BACKEND=funasr-realtime.');
  }
  if (!fs.existsSync(FUNASR_REALTIME_SCRIPT)) {
    throw new Error(`First-party FunASR realtime adapter is missing: ${FUNASR_REALTIME_SCRIPT}`);
  }
  const result = await runCommand(process.execPath, [
    FUNASR_REALTIME_SCRIPT,
    filePath,
    '--language', source.language,
    '--model', source.asrModel,
    '--json',
  ], { timeoutMs: TIMEOUT_MS });
  const output = String(result.stdout || '').trim();
  let adapterResult;
  try {
    adapterResult = JSON.parse(output);
  } catch {
    const text = cleanText(output);
    return { backend: 'funasr-realtime', text, noSpeech: !text, segments: [] };
  }
  const text = cleanText(adapterResult?.text);
  return {
    backend: cleanText(adapterResult?.backend) || 'funasr-realtime',
    text,
    noSpeech: Boolean(adapterResult?.noSpeech) || !text,
    segments: [],
  };
}

async function resolveAudioDurationSeconds(filePath) {
  const wavDuration = readWavDurationSeconds(filePath);
  if (wavDuration !== null) return wavDuration;

  try {
    const result = await runCommand(FFPROBE_COMMAND, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { timeoutMs: Math.min(TIMEOUT_MS, 15 * 1000) });
    const duration = Number(String(result.stdout).trim());
    if (Number.isFinite(duration) && duration > 0) return roundDuration(duration);
    throw new Error('ffprobe returned an invalid duration');
  } catch (error) {
    if (shutdownRequested || isShutdownError(error)) throw shutdownError();
    logEvent('audio_duration_probe_failed', {
      filePath,
      fallbackSeconds: source.segmentSeconds,
      error: cleanText(error.message),
    });
    return source.segmentSeconds;
  }
}

function readWavDurationSeconds(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.wav') return null;
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    return null;
  }
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;

  let offset = 12;
  let byteRate = null;
  let dataLength = null;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const declaredLength = buffer.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;
    const availableLength = Math.max(0, Math.min(declaredLength, buffer.length - payloadStart));
    if (chunkId === 'fmt ' && availableLength >= 12) byteRate = buffer.readUInt32LE(payloadStart + 8);
    if (chunkId === 'data') {
      dataLength = availableLength;
      break;
    }
    offset = payloadStart + declaredLength + (declaredLength % 2);
  }
  if (!Number.isFinite(byteRate) || byteRate <= 0 || !Number.isFinite(dataLength) || dataLength < 0) return null;
  return roundDuration(dataLength / byteRate);
}

function roundDuration(duration) {
  return Math.round(duration * 1_000_000) / 1_000_000;
}

async function postTranscript(payload) {
  const controller = new AbortController();
  const headers = { 'Content-Type': 'application/json' };
  if (apiAuth) headers.Authorization = `Basic ${Buffer.from(`${apiAuth.username}:${apiAuth.password}`).toString('base64')}`;
  activeAbortControllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(`${source.apiBase}/api/events/transcripts`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = { raw: bodyText };
    }
    if (!response.ok) throw new Error(body.message || body.error || `Transcript API returned HTTP ${response.status}`);
    return body;
  } catch (error) {
    if (controller.signal.aborted) {
      if (shutdownRequested) throw shutdownError();
      throw new Error(`Transcript API request timed out after ${HTTP_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    activeAbortControllers.delete(controller);
  }
}

function runCommand(command, commandArgs, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...PROXY_ENV } });
    let stderr = '';
    let stdout = '';
    let settled = false;
    let timeout = null;
    let forceKillTimer = null;
    let timeoutError = null;
    activeChildren.add(child);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      callback(value);
    };
    timeout = setTimeout(() => {
      timeoutError = new Error(`${command} timed out after ${timeoutMs}ms`);
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), COMMAND_KILL_GRACE_MS);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      activeChildren.delete(child);
      finish(reject, error);
    });
    child.on('close', (code) => {
      activeChildren.delete(child);
      if (shutdownRequested) {
        finish(reject, shutdownError());
        return;
      }
      if (timeoutError) {
        finish(reject, timeoutError);
        return;
      }
      if (code === 0) finish(resolve, { stdout, stderr });
      else finish(reject, new Error(`${command} exited with ${code}: ${truncate(stderr || stdout, 600)}`));
    });
    if (shutdownRequested) child.kill('SIGTERM');
  });
}

function ensureDirs() {
  ensurePrivateRuntimeDirectory(path.dirname(source.runtimeStateFile));
  [source.watchDir, source.processedDir, source.skippedDir, source.failedDir, source.logDir]
    .forEach(ensurePrivateRuntimeDirectory);
}

function createDestination(directory, basename) {
  ensurePrivateRuntimeDirectory(directory);
  const candidate = path.join(directory, `${Date.now()}-${basename}`);
  return fs.existsSync(candidate) ? path.join(directory, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${basename}`) : candidate;
}

function buildAudioArtifactReference(sourceId, destination) {
  const safeSourceId = safeArtifactPathComponent(sourceId, 'source');
  const safeFileName = safeArtifactPathComponent(path.basename(destination), 'segment.wav');
  return `audio/${safeSourceId}/processed/${safeFileName}`;
}

function safeArtifactPathComponent(value, fallback) {
  const normalized = cleanText(value)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  return normalized || fallback;
}

function moveAssets(filePath, destination) {
  ensurePrivateRuntimeDirectory(path.dirname(destination));
  fs.renameSync(filePath, destination);
  ensurePrivateFile(destination);
  const sidecarPath = `${filePath}.txt`;
  if (fs.existsSync(sidecarPath)) {
    const destinationSidecar = `${destination}.txt`;
    fs.renameSync(sidecarPath, destinationSidecar);
    ensurePrivateFile(destinationSidecar);
  }
  return destination;
}

function inferTimestampFromFile(filePath) {
  const match = path.basename(filePath).match(/(\d{4})(\d{2})(\d{2})[T_-]?(\d{2})(\d{2})(\d{2})?/);
  if (match) {
    const [, year, month, day, hour, minute, second = '00'] = match;
    const offset = cleanText(process.env.ASR_INPUT_TIMEZONE || source.inputTimezone || '+08:00') || '+08:00';
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`).toISOString();
  }
  const snapshot = snapshotFile(filePath);
  return new Date(snapshot.mtimeMs || Date.now()).toISOString();
}

function writeHealth() {
  writeJsonAtomic(HEALTH_FILE, { ...health, updatedAt: new Date().toISOString() });
}

function logEvent(type, data = {}) {
  appendJsonlWithRotation(path.join(source.logDir, 'asr-worker.jsonl'), {
    time: new Date().toISOString(),
    workerId: WORKER_ID,
    type,
    ...data,
  }, { maxBytes: LOG_MAX_BYTES, maxRotatedFiles: LOG_MAX_ROTATED_FILES });
}

function runRetention({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastRetentionCheckAt < RETENTION_CHECK_INTERVAL_MS) return;
  lastRetentionCheckAt = now;
  try {
    const processed = pruneFilesOlderThan({ directory: source.processedDir, olderThanMs: AUDIO_RETENTION_MS, now });
    const skipped = pruneFilesOlderThan({ directory: source.skippedDir, olderThanMs: AUDIO_RETENTION_MS, now });
    const failed = pruneFilesOlderThan({ directory: source.failedDir, olderThanMs: FAILED_RETENTION_MS, now });
    health.retention = {
      lastCheckedAt: new Date(now).toISOString(),
      processedRemoved: processed.length,
      skippedRemoved: skipped.length,
      failedRemoved: failed.length,
    };
    if (processed.length || skipped.length || failed.length) {
      logEvent('retention_pruned', {
        processedRemoved: processed.length,
        skippedRemoved: skipped.length,
        failedRemoved: failed.length,
        audioRetentionMs: AUDIO_RETENTION_MS,
        failedRetentionMs: FAILED_RETENTION_MS,
      });
    }
  } catch (error) {
    logEvent('retention_failed', { error: cleanText(error.message) });
  }
}

function persistDedupeState({ force = false } = {}) {
  const now = Date.now();
  const audioCount = Object.keys(dedupeState.audioHashes || {}).length;
  const textCount = Object.keys(dedupeState.textHashes || {}).length;
  const due = force || now - lastDedupeCompactionAt >= DEDUPE_COMPACT_INTERVAL_MS || audioCount > DEDUPE_MAX_ENTRIES || textCount > DEDUPE_MAX_ENTRIES;
  if (!due) return;
  const before = audioCount + textCount;
  dedupeState = compactDedupeState(dedupeState, now);
  lastDedupeCompactionAt = now;
  const after = Object.keys(dedupeState.audioHashes).length + Object.keys(dedupeState.textHashes).length;
  if (before !== after) logEvent('dedupe_compacted', { before, after, maxEntries: DEDUPE_MAX_ENTRIES, retentionMs: DEDUPE_RETENTION_MS });
  writeJsonAtomic(DEDUPE_FILE, dedupeState);
  truncateDedupeJournal();
}

function recordDurableDedupe(entry) {
  dedupeState = recordDedupe(dedupeState, entry);
  fs.appendFileSync(DEDUPE_JOURNAL_FILE, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
  ensurePrivateFile(DEDUPE_JOURNAL_FILE);
  persistDedupeState();
}

function loadDedupeState() {
  let state = createDedupeState(readJsonFile(DEDUPE_FILE, {}));
  try {
    if (!fs.existsSync(DEDUPE_JOURNAL_FILE)) return state;
    for (const line of fs.readFileSync(DEDUPE_JOURNAL_FILE, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        state = recordDedupe(state, entry);
      } catch {
        // A partially written terminal line is ignored; prior complete entries remain durable.
      }
    }
  } catch {
    // The atomic snapshot is still sufficient when an unreadable journal is unavailable.
  }
  return state;
}

function truncateDedupeJournal() {
  const temporaryPath = `${DEDUPE_JOURNAL_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, '', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, DEDUPE_JOURNAL_FILE);
  ensurePrivateFile(DEDUPE_JOURNAL_FILE);
}

function compactDedupeState(state, now) {
  const compact = (entries) => Object.fromEntries(
    Object.entries(entries || {})
      .filter(([key, value]) => cleanText(key) && Number.isFinite(Number(value?.timestampMs)) && Number(value.timestampMs) >= now - DEDUPE_RETENTION_MS)
      .sort(([, left], [, right]) => Number(right.timestampMs) - Number(left.timestampMs))
      .slice(0, DEDUPE_MAX_ENTRIES),
  );
  return createDedupeState({
    version: 1,
    audioHashes: compact(state?.audioHashes),
    textHashes: compact(state?.textHashes),
  });
}

function acquireWorkerLock() {
  const lockDir = workerLockDirectory();
  const inputScope = canonicalWorkerInputScope();
  const inputScopeHash = crypto.createHash('sha256').update(inputScope).digest('hex').slice(0, 16);
  const lockPath = path.join(lockDir, `asr-worker-${safeArtifactPathComponent(source.id, 'source')}-${inputScopeHash}.lock`);
  const owner = {
    sourceId: source.id,
    inputScope,
    workerId: WORKER_ID,
    pid: process.pid,
    token: crypto.randomUUID(),
    acquiredAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (tryCreateExclusiveJsonLock(lockPath, owner)) {
      return { lockPath, owner };
    }
    const existing = readJsonFile(lockPath, {});
    if (isProcessAlive(Number(existing?.pid))) {
      const lockError = new Error(`ASR worker for ${source.id} is already running (pid ${existing.pid}, worker ${cleanText(existing.workerId) || 'unknown'}).`);
      lockError.code = 'ASR_WORKER_LOCKED';
      throw lockError;
    }
    if (isFreshMalformedJsonLock(lockPath, existing)) {
      const lockError = new Error(`ASR worker lock for ${source.id} is still initializing; retry shortly instead of starting a second worker.`);
      lockError.code = 'ASR_WORKER_LOCKED';
      throw lockError;
    }
    const recovery = tryReclaimStaleJsonLock(lockPath, { isProcessAlive });
    if (recovery.status === 'reclaimed' || recovery.status === 'absent') continue;
    if (recovery.status === 'live') {
      const lockError = new Error(`ASR worker for ${source.id} is already running (pid ${recovery.owner?.pid || 'unknown'}, worker ${cleanText(recovery.owner?.workerId) || 'unknown'}).`);
      lockError.code = 'ASR_WORKER_LOCKED';
      throw lockError;
    }
    if (recovery.status === 'initializing') {
      const lockError = new Error(`ASR worker lock for ${source.id} is still initializing; retry shortly instead of starting a second worker.`);
      lockError.code = 'ASR_WORKER_LOCKED';
      throw lockError;
    }
    const lockError = new Error(`ASR worker stale-lock recovery for ${source.id} is already in progress or requires manual review; do not start a second worker.`);
    lockError.code = 'ASR_WORKER_LOCKED';
    throw lockError;
  }
  const lockError = new Error(`Could not acquire ASR worker lock for ${source.id}; another process changed the lock repeatedly.`);
  lockError.code = 'ASR_WORKER_LOCKED';
  throw lockError;
}

function releaseWorkerLock() {
  if (!workerLock?.lockPath || !workerLock?.owner?.token) return false;
  const lock = workerLock;
  workerLock = null;
  const current = readJsonFile(lock.lockPath, {});
  if (current.token !== lock.owner.token) return false;
  try {
    fs.unlinkSync(lock.lockPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function isWorkerLockError(error) {
  return error?.code === 'ASR_WORKER_LOCKED';
}

function workerLockDirectory() {
  const audioRoot = path.join(REPO_ROOT, 'audio');
  ensurePrivateDirectory(audioRoot, { enforceExisting: true });
  const lockDir = path.join(audioRoot, 'worker-locks');
  ensurePrivateDirectory(lockDir, { enforceExisting: true });
  return lockDir;
}

function canonicalWorkerInputScope() {
  try {
    return fs.realpathSync.native?.(source.watchDir) || fs.realpathSync(source.watchDir);
  } catch {
    return path.resolve(source.watchDir);
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function shutdownError() {
  const error = new Error('ASR worker shutdown requested');
  error.code = 'ASR_SHUTDOWN';
  return error;
}

function isShutdownError(error) {
  return error?.code === 'ASR_SHUTDOWN';
}

async function requestShutdown(signal) {
  if (shutdownPromise) return shutdownPromise;
  shutdownRequested = true;
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  cancelPendingDelays();
  health.status = 'stopping';
  writeHealth();
  logEvent('worker_stopping', { signal, activeChildren: activeChildren.size, activeRequests: activeAbortControllers.size });
  for (const controller of activeAbortControllers) controller.abort();
  terminateActiveChildren('SIGTERM');

  shutdownPromise = (async () => {
    const deadline = Date.now() + SHUTDOWN_GRACE_MS;
    while ((scanInProgress || activeChildren.size || activeAbortControllers.size) && Date.now() < deadline) {
      await shutdownPause(20);
    }
    if (activeChildren.size) {
      terminateActiveChildren('SIGKILL');
      process.exitCode = 1;
      logEvent('worker_shutdown_forced', { activeChildren: activeChildren.size });
    }
    health.status = process.exitCode === 1 ? 'failed' : 'stopped';
    writeHealth();
    logEvent('worker_stopped', { signal, forced: process.exitCode === 1 });
    releaseWorkerLock();
  })();
  return shutdownPromise;
}

function terminateActiveChildren(signal) {
  for (const child of activeChildren) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    try {
      child.kill(signal);
    } catch (error) {
      if (error.code !== 'ESRCH') logEvent('child_termination_failed', { signal, error: cleanText(error.message) });
    }
  }
}

function cancelPendingDelays() {
  for (const entry of pendingDelays) {
    clearTimeout(entry.timer);
    entry.resolve();
  }
  pendingDelays.clear();
}

function inferProxyEnv() {
  if (process.env.http_proxy || process.env.https_proxy || process.env.HTTP_PROXY || process.env.HTTPS_PROXY) return {};
  const result = spawnSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return {};
  const httpEnabled = /HTTPEnable\s*:\s*1/.test(result.stdout);
  const httpsEnabled = /HTTPSEnable\s*:\s*1/.test(result.stdout);
  const httpHost = result.stdout.match(/HTTPProxy\s*:\s*([^\n]+)/)?.[1]?.trim();
  const httpPort = result.stdout.match(/HTTPPort\s*:\s*(\d+)/)?.[1]?.trim();
  const httpsHost = result.stdout.match(/HTTPSProxy\s*:\s*([^\n]+)/)?.[1]?.trim() || httpHost;
  const httpsPort = result.stdout.match(/HTTPSPort\s*:\s*(\d+)/)?.[1]?.trim() || httpPort;
  const env = {};
  if (httpEnabled && httpHost && httpPort) env.http_proxy = env.HTTP_PROXY = `http://${httpHost}:${httpPort}`;
  if (httpsEnabled && httpsHost && httpsPort) env.https_proxy = env.HTTPS_PROXY = `http://${httpsHost}:${httpsPort}`;
  return env;
}

function getOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    const entry = {
      timer: setTimeout(() => {
        pendingDelays.delete(entry);
        resolve();
      }, milliseconds),
      resolve,
    };
    pendingDelays.add(entry);
    if (shutdownRequested) {
      clearTimeout(entry.timer);
      pendingDelays.delete(entry);
      resolve();
    }
  });
}

function shutdownPause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveRetentionMs({ millisecondsEnv, daysEnv, fallbackDays }) {
  if (Object.hasOwn(process.env, millisecondsEnv)) return nonNegativeNumber(process.env[millisecondsEnv], fallbackDays * 24 * 60 * 60 * 1000);
  if (Object.hasOwn(process.env, daysEnv)) return nonNegativeNumber(process.env[daysEnv], fallbackDays) * 24 * 60 * 60 * 1000;
  return fallbackDays * 24 * 60 * 60 * 1000;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function truncate(value, maxLength) {
  const text = cleanText(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}
