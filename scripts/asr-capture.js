#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  appendJsonlWithRotation,
  ensurePrivateDirectory,
  ensurePrivateFile,
  ensurePrivateRuntimeDirectory,
  isFreshMalformedJsonLock,
  isNonSilentSignal,
  isStableSnapshot,
  loadSourceConfig,
  parseAvfoundationAudioDevices,
  parseVolumedetectOutput,
  readJsonFile,
  resolveDevice,
  REPO_ROOT,
  snapshotFile,
  tryCreateExclusiveJsonLock,
  tryReclaimStaleJsonLock,
  writeJsonAtomic,
} from './asr-core.js';

const __filename = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const LOG_MAX_BYTES = positiveNumber(process.env.ASR_LOG_MAX_BYTES, 10 * 1024 * 1024);
const LOG_MAX_ROTATED_FILES = nonNegativeInteger(process.env.ASR_LOG_MAX_ROTATED_FILES, 5);
const CAPTURE_LOCK_ERROR_CODE = 'ASR_CAPTURE_LOCKED';

if (isMainModule()) {
  main().catch((error) => {
    console.error(`[asr-capture] fatal: ${error.message}`);
    process.exitCode = isCaptureLockError(error) ? 3 : 1;
  });
}

export async function publishStableSegments({
  stagingDir,
  incomingDir,
  skippedDir,
  minAgeMs = 1500,
  stableCheckMs = 750,
  inspectSegment = null,
} = {}) {
  if (!fs.existsSync(stagingDir)) return { published: [], skipped: [] };
  ensurePrivateRuntimeDirectory(incomingDir);
  const files = fs.readdirSync(stagingDir)
    .filter((name) => name.endsWith('.wav.part'))
    .map((name) => path.join(stagingDir, name))
    .sort((left, right) => snapshotFile(left).mtimeMs - snapshotFile(right).mtimeMs);
  const published = [];
  const skipped = [];

  for (const stagedPath of files) {
    const first = snapshotFile(stagedPath);
    if (!first.exists || first.size <= 0 || (minAgeMs > 0 && Date.now() - first.mtimeMs < minAgeMs)) continue;
    await delay(stableCheckMs);
    const second = snapshotFile(stagedPath);
    if (!isStableSnapshot(first, second, { minAgeMs })) continue;

    const baseName = path.basename(stagedPath, '.part');
    let signal = { checked: false, nonSilent: true };
    if (typeof inspectSegment === 'function') {
      try {
        signal = await inspectSegment(stagedPath) || signal;
      } catch (error) {
        signal = { checked: false, nonSilent: true, error: error.message };
      }
    }
    const destinationDir = signal?.checked && signal.nonSilent === false
      ? (skippedDir || path.join(path.dirname(incomingDir), 'skipped'))
      : incomingDir;
    ensurePrivateRuntimeDirectory(destinationDir);
    const destination = uniqueDestination(destinationDir, baseName);
    fs.renameSync(stagedPath, destination);
    ensurePrivateFile(destination);
    if (signal?.checked && signal.nonSilent === false) skipped.push({ source: stagedPath, destination, signal });
    else published.push(destination);
  }
  return { published, skipped };
}

export function acquireCaptureDeviceLock({ lockDir, deviceIndex, sourceId, pid = process.pid, isProcessAlive = defaultIsProcessAlive } = {}) {
  const numericDeviceIndex = Number(deviceIndex);
  if (!Number.isInteger(numericDeviceIndex) || numericDeviceIndex < 0) throw new Error('A resolved non-negative audio device index is required to acquire a capture lock.');
  ensurePrivateRuntimeDirectory(lockDir);
  const lockPath = path.join(lockDir, `capture-device-${numericDeviceIndex}.lock`);
  const owner = {
    deviceIndex: numericDeviceIndex,
    sourceId: String(sourceId || '').trim() || 'unknown-source',
    pid: Number(pid),
    token: crypto.randomUUID(),
    acquiredAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (tryCreateExclusiveJsonLock(lockPath, owner)) {
      return { lockPath, owner };
    }
    const existing = readJsonFile(lockPath, {});
    if (Number.isInteger(Number(existing.pid)) && isProcessAlive(Number(existing.pid))) {
      const lockError = new Error(`Audio device ${numericDeviceIndex} is already captured by ${existing.sourceId || 'another source'} (pid ${existing.pid}).`);
      lockError.code = CAPTURE_LOCK_ERROR_CODE;
      throw lockError;
    }
    if (isFreshMalformedJsonLock(lockPath, existing)) {
      const lockError = new Error(`Audio device ${numericDeviceIndex} capture lock is still initializing; retry shortly instead of starting a second capture.`);
      lockError.code = CAPTURE_LOCK_ERROR_CODE;
      throw lockError;
    }
    const recovery = tryReclaimStaleJsonLock(lockPath, { isProcessAlive });
    if (recovery.status === 'reclaimed' || recovery.status === 'absent') continue;
    if (recovery.status === 'live') {
      const lockError = new Error(`Audio device ${numericDeviceIndex} is already captured by ${recovery.owner?.sourceId || 'another source'} (pid ${recovery.owner?.pid || 'unknown'}).`);
      lockError.code = CAPTURE_LOCK_ERROR_CODE;
      throw lockError;
    }
    if (recovery.status === 'initializing') {
      const lockError = new Error(`Audio device ${numericDeviceIndex} capture lock is still initializing; retry shortly instead of starting a second capture.`);
      lockError.code = CAPTURE_LOCK_ERROR_CODE;
      throw lockError;
    }
    const lockError = new Error(`Audio device ${numericDeviceIndex} stale-lock recovery is already in progress or requires manual review; do not start a second capture.`);
    lockError.code = CAPTURE_LOCK_ERROR_CODE;
    throw lockError;
  }
  const lockError = new Error(`Could not acquire capture lock for audio device ${numericDeviceIndex}; another process changed the lock repeatedly.`);
  lockError.code = CAPTURE_LOCK_ERROR_CODE;
  throw lockError;
}

export async function finalizeCapture({
  code,
  stopping,
  status,
  publish,
  releaseLock = () => {},
  writeStatus = () => {},
  log = () => {},
} = {}) {
  try {
    try {
      await publish();
    } catch (error) {
      status.status = 'failed';
      status.lastError = error.message;
      writeStatus();
      log('capture_final_publish_failed', { error: error.message });
      throw error;
    }

    const cleanExit = Boolean(stopping) || code === 0;
    status.status = cleanExit ? 'stopped' : 'failed';
    status.lastError = cleanExit ? '' : `ffmpeg exited with ${code}`;
    writeStatus();
    log('capture_exit', { code, stopping: Boolean(stopping) });
    if (!cleanExit) throw new Error(status.lastError);
  } finally {
    releaseLock();
  }
}

export function releaseCaptureDeviceLock(lock) {
  if (!lock?.lockPath || !lock?.owner?.token) return false;
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

export async function acquireCaptureLockBeforePublishing({
  acquireLock,
  publish,
  releaseLock = () => {},
} = {}) {
  if (typeof acquireLock !== 'function') throw new Error('A capture lock acquisition function is required.');
  if (typeof publish !== 'function') throw new Error('A capture publish function is required.');
  const lock = await acquireLock();
  try {
    await publish();
    return lock;
  } catch (error) {
    releaseLock(lock);
    throw error;
  }
}

async function main() {
  process.umask(0o077);
  if (args.includes('--list-devices')) {
    listDevices();
    return;
  }

  const source = loadSourceConfig({ sourceId: getOption('--source') || process.env.SOURCE_ID || process.env.ASR_SOURCE_ID });
  source.watchDir = path.resolve(process.env.AUDIO_OUT_DIR || source.watchDir);
  source.stagingDir = path.resolve(process.env.AUDIO_STAGING_DIR || source.stagingDir);
  const once = args.includes('--once') || process.env.ASR_CAPTURE_ONCE === '1';
  const device = resolveConfiguredDevice(source);
  const deviceIndex = device?.index ?? null;
  if (deviceIndex === null) {
    throw new Error(`No current loopback device matching ${source.deviceName || 'the configured deviceName'} is available for ${source.id}. Run npm run asr:preflight after configuring a virtual loopback device.`);
  }

  ensurePrivateRuntimeDirectory(path.dirname(source.runtimeStateFile));
  [source.stagingDir, source.watchDir, source.skippedDir, source.logDir].forEach(ensurePrivateRuntimeDirectory);
  const status = {
    sourceId: source.id,
    sourceName: source.sourceName,
    deviceIndex,
    deviceName: device.name,
    status: 'starting',
    startedAt: new Date().toISOString(),
    segmentsPublished: 0,
    segmentsSkippedSilent: 0,
    lastError: '',
  };
  const writeStatus = () => writeJsonAtomic(path.join(source.logDir, 'capture-health.json'), { ...status, updatedAt: new Date().toISOString() });
  const log = (type, data = {}) => appendJsonlWithRotation(path.join(source.logDir, 'capture.jsonl'), {
    time: new Date().toISOString(),
    type,
    sourceId: source.id,
    ...data,
  }, { maxBytes: LOG_MAX_BYTES, maxRotatedFiles: LOG_MAX_ROTATED_FILES });
  const ffmpeg = process.env.FFMPEG_COMMAND || 'ffmpeg';
  const publish = async () => {
    const result = await publishStableSegments({
      stagingDir: source.stagingDir,
      incomingDir: source.watchDir,
      skippedDir: source.skippedDir,
      minAgeMs: source.minAgeMs,
      stableCheckMs: source.stableCheckMs,
      inspectSegment: (filePath) => inspectCapturedSegmentSignal({
        filePath,
        ffmpegCommand: ffmpeg,
        thresholdDb: source.signalThresholdDb,
      }),
    });
    const { published, skipped } = result;
    if (published.length) {
      status.segmentsPublished += published.length;
      log('segments_published', { files: published.map((filePath) => path.basename(filePath)) });
      writeStatus();
    }
    if (skipped.length) {
      status.segmentsSkippedSilent += skipped.length;
      log('segments_skipped_silent', {
        files: skipped.map((item) => path.basename(item.destination)),
        signal: skipped.map((item) => item.signal),
      });
      writeStatus();
    }
  };

  let deviceLock;
  try {
    deviceLock = await acquireCaptureLockBeforePublishing({
      acquireLock: () => acquireCaptureDeviceLock({
        lockDir: captureLockDirectory(),
        deviceIndex,
        sourceId: source.id,
      }),
      publish,
      releaseLock: releaseCaptureDeviceLock,
    });
  } catch (error) {
    status.status = isCaptureLockError(error) ? 'blocked' : 'failed';
    status.lastError = error.message;
    writeStatus();
    log(isCaptureLockError(error) ? 'capture_blocked' : 'capture_prepare_failed', { deviceIndex, error: error.message });
    throw error;
  }

  if (once) {
    try {
      status.status = 'healthy';
      writeStatus();
    } finally {
      releaseCaptureDeviceLock(deviceLock);
    }
    return;
  }

  const outputPattern = buildCaptureOutputPattern({
    stagingDir: source.stagingDir,
    sessionId: `${process.pid}-${crypto.randomUUID().slice(0, 8)}`,
  });
  const child = spawn(ffmpeg, buildCaptureFfmpegArgs({
    deviceIndex,
    segmentSeconds: source.segmentSeconds,
    outputPattern,
  }), { stdio: ['ignore', 'ignore', 'pipe'] });
  status.status = 'capturing';
  writeStatus();
  log('capture_start', { deviceIndex, deviceName: device.name, lockPath: deviceLock.lockPath, outputPattern, segmentSeconds: source.segmentSeconds });

  let stopping = false;
  let activePublish = null;
  const runPublish = () => {
    if (activePublish) return activePublish;
    activePublish = Promise.resolve()
      .then(publish)
      .finally(() => { activePublish = null; });
    return activePublish;
  };
  const timer = setInterval(() => {
    void runPublish().catch((error) => {
      status.status = 'degraded';
      status.lastError = error.message;
      log('publish_failed', { error: error.message });
      writeStatus();
    });
  }, Math.max(250, source.stableCheckMs));

  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    child.kill('SIGTERM');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  child.stderr.on('data', (chunk) => {
    const message = String(chunk).trim();
    if (message) log('ffmpeg_stderr', { message: message.slice(-1200) });
  });
  await new Promise((resolve, reject) => {
    let spawnError = null;
    child.on('error', (error) => {
      spawnError = error;
      clearInterval(timer);
      releaseCaptureDeviceLock(deviceLock);
      status.status = 'failed';
      status.lastError = error.message;
      writeStatus();
      log('capture_spawn_failed', { error: error.message });
      reject(error);
    });
    child.on('close', (code) => {
      if (spawnError) return;
      clearInterval(timer);
      void finalizeCapture({
        code,
        stopping,
        status,
        publish: async () => {
          const pending = activePublish;
          if (pending) await pending;
          await runPublish();
        },
        releaseLock: () => releaseCaptureDeviceLock(deviceLock),
        writeStatus,
        log,
      }).then(resolve, reject);
    });
  });
}

function resolveConfiguredDevice(source) {
  const runtime = readJsonFile(source.runtimeStateFile, {});
  const ffmpeg = process.env.FFMPEG_COMMAND || 'ffmpeg';
  const devices = parseAvfoundationAudioDevices(enumerateAudioDevices(ffmpeg));
  return resolveDevice(source, devices, runtime);
}

function listDevices() {
  const ffmpeg = process.env.FFMPEG_COMMAND || 'ffmpeg';
  const result = spawnSync(ffmpeg, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { encoding: 'utf8' });
  process.stdout.write(result.stderr || result.stdout || 'No AVFoundation device output returned.\n');
  if (result.error) process.exitCode = 1;
}

function enumerateAudioDevices(ffmpeg) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { encoding: 'utf8', timeout: 8000 });
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

export function inspectCapturedSegmentSignal({
  filePath,
  ffmpegCommand = 'ffmpeg',
  thresholdDb = -55,
  timeoutMs = 10_000,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(ffmpegCommand, [
        '-hide_banner', '-nostdin',
        '-i', filePath,
        '-af', 'volumedetect',
        '-f', 'null', '-',
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      resolve({ checked: false, nonSilent: true, error: error.message });
      return;
    }
    let stderr = '';
    let timeout = null;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(value);
    };
    timeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      finish({ checked: false, nonSilent: true, error: `ffmpeg signal probe timed out after ${timeoutMs}ms` });
    }, Math.max(1, Number(timeoutMs) || 10_000));
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.once?.('error', (error) => finish({ checked: false, nonSilent: true, error: error.message }));
    child.once?.('close', (code) => {
      if (code !== 0) {
        finish({ checked: false, nonSilent: true, error: `ffmpeg signal probe exited with ${code}` });
        return;
      }
      const volume = parseVolumedetectOutput(stderr);
      if (volume.meanDb === null && volume.maxDb === null) {
        finish({ checked: false, nonSilent: true, error: 'ffmpeg signal probe returned no volumedetect result' });
        return;
      }
      finish({ checked: true, ...volume, nonSilent: isNonSilentSignal(volume, thresholdDb) });
    });
  });
}

function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function uniqueDestination(directory, baseName) {
  const direct = path.join(directory, baseName);
  if (!fs.existsSync(direct)) return direct;
  return path.join(directory, `${Date.now()}-${baseName}`);
}

export function buildCaptureOutputPattern({ stagingDir, sessionId } = {}) {
  const directory = String(stagingDir || '').trim();
  const normalizedSessionId = String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!directory) throw new Error('A staging directory is required for capture output.');
  if (!normalizedSessionId) throw new Error('A safe capture session identifier is required for capture output.');
  return path.join(directory, `%Y%m%dT%H%M%S-${normalizedSessionId}.wav.part`);
}

export function buildCaptureFfmpegArgs({ deviceIndex, segmentSeconds, outputPattern } = {}) {
  const numericDeviceIndex = Number(deviceIndex);
  if (!Number.isInteger(numericDeviceIndex) || numericDeviceIndex < 0) throw new Error('A resolved non-negative audio device index is required for capture.');
  const seconds = positiveNumber(segmentSeconds, null);
  if (seconds === null) throw new Error('A positive segment duration is required for capture.');
  if (!String(outputPattern || '').trim()) throw new Error('A capture output pattern is required.');
  return [
    '-hide_banner', '-nostdin',
    '-f', 'avfoundation', '-i', `:${numericDeviceIndex}`,
    '-map', '0:a:0',
    '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
    '-f', 'segment', '-segment_format', 'wav',
    '-segment_time', String(seconds), '-reset_timestamps', '1', '-strftime', '1',
    outputPattern,
  ];
}

function captureLockDirectory() {
  const audioRoot = path.join(REPO_ROOT, 'audio');
  ensurePrivateDirectory(audioRoot, { enforceExisting: true });
  const lockDir = path.join(audioRoot, 'locks');
  ensurePrivateDirectory(lockDir, { enforceExisting: true });
  return lockDir;
}

function isCaptureLockError(error) {
  return error?.code === CAPTURE_LOCK_ERROR_CODE;
}

function getOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)));
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === __filename;
}
