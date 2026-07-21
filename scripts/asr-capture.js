#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  appendJsonlWithRotation,
  isStableSnapshot,
  loadSourceConfig,
  parseAvfoundationAudioDevices,
  readJsonFile,
  resolveDevice,
  snapshotFile,
  writeJsonAtomic,
} from './asr-core.js';

const __filename = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const LOG_MAX_BYTES = positiveNumber(process.env.ASR_LOG_MAX_BYTES, 10 * 1024 * 1024);
const LOG_MAX_ROTATED_FILES = nonNegativeInteger(process.env.ASR_LOG_MAX_ROTATED_FILES, 5);

if (isMainModule()) {
  main().catch((error) => {
    console.error(`[asr-capture] fatal: ${error.message}`);
    process.exitCode = 1;
  });
}

export async function publishStableSegments({ stagingDir, incomingDir, minAgeMs = 1500, stableCheckMs = 750 } = {}) {
  if (!fs.existsSync(stagingDir)) return [];
  fs.mkdirSync(incomingDir, { recursive: true });
  const files = fs.readdirSync(stagingDir)
    .filter((name) => name.endsWith('.wav.part'))
    .map((name) => path.join(stagingDir, name))
    .sort((left, right) => snapshotFile(left).mtimeMs - snapshotFile(right).mtimeMs);
  const published = [];

  for (const stagedPath of files) {
    const first = snapshotFile(stagedPath);
    if (!first.exists || first.size <= 0 || (minAgeMs > 0 && Date.now() - first.mtimeMs < minAgeMs)) continue;
    await delay(stableCheckMs);
    const second = snapshotFile(stagedPath);
    if (!isStableSnapshot(first, second, { minAgeMs })) continue;

    const baseName = path.basename(stagedPath, '.part');
    const destination = uniqueDestination(incomingDir, baseName);
    fs.renameSync(stagedPath, destination);
    published.push(destination);
  }
  return published;
}

export function acquireCaptureDeviceLock({ lockDir, deviceIndex, sourceId, pid = process.pid, isProcessAlive = defaultIsProcessAlive } = {}) {
  const numericDeviceIndex = Number(deviceIndex);
  if (!Number.isInteger(numericDeviceIndex) || numericDeviceIndex < 0) throw new Error('A resolved non-negative audio device index is required to acquire a capture lock.');
  fs.mkdirSync(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, `capture-device-${numericDeviceIndex}.lock`);
  const owner = {
    deviceIndex: numericDeviceIndex,
    sourceId: String(sourceId || '').trim() || 'unknown-source',
    pid: Number(pid),
    token: crypto.randomUUID(),
    acquiredAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockPath, 'wx', 0o600);
      try {
        fs.writeFileSync(descriptor, `${JSON.stringify(owner)}\n`, 'utf8');
      } finally {
        fs.closeSync(descriptor);
      }
      return { lockPath, owner };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = readJsonFile(lockPath, {});
      if (Number.isInteger(Number(existing.pid)) && isProcessAlive(Number(existing.pid))) {
        throw new Error(`Audio device ${numericDeviceIndex} is already captured by ${existing.sourceId || 'another source'} (pid ${existing.pid}).`);
      }
      const stalePath = `${lockPath}.stale-${process.pid}-${crypto.randomUUID()}`;
      try {
        fs.renameSync(lockPath, stalePath);
        fs.unlinkSync(stalePath);
      } catch (recoveryError) {
        if (recoveryError.code !== 'ENOENT') throw recoveryError;
      }
    }
  }
  throw new Error(`Could not acquire capture lock for audio device ${numericDeviceIndex}; another process changed the lock repeatedly.`);
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

async function main() {
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

  [source.stagingDir, source.watchDir, source.logDir].forEach((directory) => fs.mkdirSync(directory, { recursive: true }));
  const status = {
    sourceId: source.id,
    sourceName: source.sourceName,
    deviceIndex,
    deviceName: device.name,
    status: 'starting',
    startedAt: new Date().toISOString(),
    segmentsPublished: 0,
    lastError: '',
  };
  const writeStatus = () => writeJsonAtomic(path.join(source.logDir, 'capture-health.json'), { ...status, updatedAt: new Date().toISOString() });
  const log = (type, data = {}) => appendJsonlWithRotation(path.join(source.logDir, 'capture.jsonl'), {
    time: new Date().toISOString(),
    type,
    sourceId: source.id,
    ...data,
  }, { maxBytes: LOG_MAX_BYTES, maxRotatedFiles: LOG_MAX_ROTATED_FILES });
  const publish = async () => {
    const published = await publishStableSegments({
      stagingDir: source.stagingDir,
      incomingDir: source.watchDir,
      minAgeMs: source.minAgeMs,
      stableCheckMs: source.stableCheckMs,
    });
    if (published.length) {
      status.segmentsPublished += published.length;
      log('segments_published', { files: published.map((filePath) => path.basename(filePath)) });
      writeStatus();
    }
  };

  await publish();
  if (once) {
    status.status = 'healthy';
    writeStatus();
    return;
  }

  let deviceLock;
  try {
    deviceLock = acquireCaptureDeviceLock({
      lockDir: path.join(path.dirname(source.runtimeStateFile), 'locks'),
      deviceIndex,
      sourceId: source.id,
    });
  } catch (error) {
    status.status = 'blocked';
    status.lastError = error.message;
    writeStatus();
    log('capture_blocked', { deviceIndex, error: error.message });
    throw error;
  }

  const ffmpeg = process.env.FFMPEG_COMMAND || 'ffmpeg';
  const outputPattern = buildCaptureOutputPattern({
    stagingDir: source.stagingDir,
    sessionId: `${process.pid}-${crypto.randomUUID().slice(0, 8)}`,
  });
  const child = spawn(ffmpeg, [
    '-hide_banner', '-nostdin',
    '-f', 'avfoundation', '-i', `:${deviceIndex}`,
    '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
    '-f', 'segment', '-segment_format', 'wav',
    '-segment_time', String(source.segmentSeconds), '-reset_timestamps', '1', '-strftime', '1',
    outputPattern,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  status.status = 'capturing';
  writeStatus();
  log('capture_start', { deviceIndex, deviceName: device.name, lockPath: deviceLock.lockPath, outputPattern, segmentSeconds: source.segmentSeconds });

  let stopping = false;
  let publishing = false;
  const timer = setInterval(async () => {
    if (publishing) return;
    publishing = true;
    try {
      await publish();
    } catch (error) {
      status.status = 'degraded';
      status.lastError = error.message;
      log('publish_failed', { error: error.message });
      writeStatus();
    } finally {
      publishing = false;
    }
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
    child.on('close', async (code) => {
      if (spawnError) return;
      clearInterval(timer);
      releaseCaptureDeviceLock(deviceLock);
      await publish();
      status.status = stopping || code === 0 ? 'stopped' : 'failed';
      status.lastError = code === 0 || stopping ? '' : `ffmpeg exited with ${code}`;
      writeStatus();
      log('capture_exit', { code, stopping });
      if (code === 0 || stopping) resolve();
      else reject(new Error(status.lastError));
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
