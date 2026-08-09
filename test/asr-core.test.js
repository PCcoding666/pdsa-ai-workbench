import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appendJsonlWithRotation,
  buildTranscriptPayload,
  createDedupeState,
  tryCreateExclusiveJsonLock,
  ensurePrivateDirectory,
  ensurePrivateRuntimeDirectory,
  findLoopbackDevices,
  isLoopbackHostname,
  isDuplicateAudio,
  isDuplicateText,
  isNonSilentSignal,
  isStableSnapshot,
  loadSourceConfig,
  parseAvfoundationAudioDevices,
  parseVolumedetectOutput,
  pruneFilesOlderThan,
  recordDedupe,
  resolveApiCredentials,
  resolveDeviceIndex,
  validateAsrApiBase,
  writeJsonAtomic,
} from '../scripts/asr-core.js';

test('parses AVFoundation audio device indexes without hard-coding them', () => {
  const devices = parseAvfoundationAudioDevices(`
[AVFoundation indev @ 0x123] AVFoundation audio devices:
[AVFoundation indev @ 0x123] [0] MacBook Pro Microphone
[AVFoundation indev @ 0x123] [3] BlackHole 2ch
[AVFoundation indev @ 0x123] [7] IG CNBC Loopback
  `);

  assert.deepEqual(devices, [
    { index: 0, name: 'MacBook Pro Microphone' },
    { index: 3, name: 'BlackHole 2ch' },
    { index: 7, name: 'IG CNBC Loopback' },
  ]);
  assert.deepEqual(findLoopbackDevices(devices).map((device) => device.index), [3, 7]);
});

test('resolves only the configured current loopback device and rejects stale runtime indexes', () => {
  const source = { id: 'bloomberg-tv', deviceName: 'BlackHole 2ch' };
  const devices = [
    { index: 0, name: 'MacBook Pro Microphone' },
    { index: 3, name: 'BlackHole 2ch' },
    { index: 7, name: 'IG CNBC Loopback' },
  ];

  assert.equal(resolveDeviceIndex(source, devices, {
    sources: { 'bloomberg-tv': { deviceIndex: 0, deviceName: 'BlackHole 2ch' } },
  }), 3);
  assert.equal(resolveDeviceIndex(source, [
    { index: 3, name: 'IG CNBC Loopback' },
  ], {
    sources: { 'bloomberg-tv': { deviceIndex: 3, deviceName: 'BlackHole 2ch' } },
  }), null);
});

test('classifies non-silent audio from FFmpeg volumedetect output', () => {
  const active = parseVolumedetectOutput('[Parsed_volumedetect_0] mean_volume: -21.4 dB\n[Parsed_volumedetect_0] max_volume: -2.0 dB');
  const silent = parseVolumedetectOutput('[Parsed_volumedetect_0] mean_volume: -91.0 dB\n[Parsed_volumedetect_0] max_volume: -91.0 dB');

  assert.equal(isNonSilentSignal(active, -55), true);
  assert.equal(isNonSilentSignal(silent, -55), false);
});

test('requires two unchanged observations and minimum age before a segment is stable', () => {
  const now = 1_000_000;
  const first = { exists: true, size: 2048, mtimeMs: now - 2_000, observedAt: now };
  const unchanged = { exists: true, size: 2048, mtimeMs: now - 2_000, observedAt: now + 800 };
  const growing = { exists: true, size: 4096, mtimeMs: now - 500, observedAt: now + 800 };

  assert.equal(isStableSnapshot(null, first, { minAgeMs: 1_000 }), false);
  assert.equal(isStableSnapshot(first, unchanged, { minAgeMs: 1_000 }), true);
  assert.equal(isStableSnapshot(first, growing, { minAgeMs: 1_000 }), false);
});

test('deduplicates identical audio permanently and same transcript only inside its source window', () => {
  const state = createDedupeState();
  recordDedupe(state, {
    sourceId: 'bloomberg-tv',
    audioHash: 'audio-a',
    textHash: 'text-a',
    timestampMs: 10_000,
    eventId: 'transcript:a',
  });

  assert.equal(isDuplicateAudio(state, 'audio-a'), true);
  assert.equal(isDuplicateText(state, { sourceId: 'bloomberg-tv', textHash: 'text-a', timestampMs: 11_000, windowMs: 10_000 }), true);
  assert.equal(isDuplicateText(state, { sourceId: 'cnbc-live-tv', textHash: 'text-a', timestampMs: 11_000, windowMs: 10_000 }), false);
  assert.equal(isDuplicateText(state, { sourceId: 'bloomberg-tv', textHash: 'text-a', timestampMs: 25_000, windowMs: 10_000 }), false);
});

test('prunes only expired direct runtime artifacts and leaves fresh audio intact', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-retention-'));
  const oldFile = path.join(directory, 'old.wav');
  const newFile = path.join(directory, 'new.wav');
  fs.writeFileSync(oldFile, 'old');
  fs.writeFileSync(newFile, 'new');
  const now = Date.now();
  fs.utimesSync(oldFile, new Date(now - 10_000), new Date(now - 10_000));

  const removed = pruneFilesOlderThan({ directory, olderThanMs: 5_000, now });
  assert.deepEqual(removed.map((item) => item.name), ['old.wav']);
  assert.equal(fs.existsSync(oldFile), false);
  assert.equal(fs.existsSync(newFile), true);
});

test('rotates bounded JSONL logs before appending new diagnostic entries', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-log-rotation-'));
  const filePath = path.join(directory, 'worker.jsonl');
  appendJsonlWithRotation(filePath, { type: 'first', detail: 'x'.repeat(60) }, { maxBytes: 80, maxRotatedFiles: 2 });
  appendJsonlWithRotation(filePath, { type: 'second', detail: 'y'.repeat(60) }, { maxBytes: 80, maxRotatedFiles: 2 });

  assert.equal(fs.existsSync(`${filePath}.1`), true);
  assert.match(fs.readFileSync(`${filePath}.1`, 'utf8'), /first/);
  assert.match(fs.readFileSync(filePath, 'utf8'), /second/);
});

test('atomically publishes a complete lock so an interleaving contender can never replace a live owner', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-atomic-lock-'));
  const lockPath = path.join(directory, 'worker.lock');
  const firstOwner = { pid: 101, token: 'first-owner', acquiredAt: '2026-08-10T00:00:00.000Z' };
  const secondOwner = { pid: 202, token: 'second-owner', acquiredAt: '2026-08-10T00:00:01.000Z' };
  const originalLinkSync = fs.linkSync;
  let interleaved = false;
  let secondCreated = false;

  fs.linkSync = (source, destination) => {
    if (!interleaved && path.resolve(destination) === lockPath) {
      interleaved = true;
      secondCreated = tryCreateExclusiveJsonLock(lockPath, secondOwner);
    }
    return originalLinkSync(source, destination);
  };
  let firstCreated;
  try {
    firstCreated = tryCreateExclusiveJsonLock(lockPath, firstOwner);
  } finally {
    fs.linkSync = originalLinkSync;
  }

  assert.equal(interleaved, true);
  assert.equal(secondCreated, true);
  assert.equal(firstCreated, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(lockPath, 'utf8')), secondOwner);
  assert.equal(fs.statSync(lockPath).mode & 0o777, 0o600);
});

test('loads source configuration using repo-relative paths and builds a complete event payload', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-core-'));
  const configPath = path.join(tempRoot, 'sources.json');
  fs.writeFileSync(configPath, JSON.stringify({
    defaults: { apiBase: 'http://127.0.0.1:3002', language: 'en', segmentSeconds: 20 },
    sources: [{ id: 'bloomberg-tv', name: 'Bloomberg TV', deviceName: 'BlackHole 2ch' }],
  }));

  const source = loadSourceConfig({ configPath, sourceId: 'bloomberg-tv', rootDir: tempRoot });
  assert.equal(source.watchDir, path.join(tempRoot, 'audio', 'bloomberg-tv', 'incoming'));
  assert.equal(source.language, 'en');

  const audioHash = crypto.createHash('sha256').update('fixture').digest('hex');
  const payload = buildTranscriptPayload({
    source,
    audioHash,
    transcript: 'NVIDIA NVDA investors discussed earnings and AI demand.',
    audioFile: path.join(source.watchDir, '20260711T120000.wav'),
    startedAt: '2026-07-11T04:00:00.000Z',
    durationSeconds: 20,
    asrBackend: 'funasr-realtime',
    workerId: 'bloomberg-worker-test',
  });

  assert.equal(payload.sourceId, 'bloomberg-tv');
  assert.equal(payload.sourceName, 'Bloomberg TV');
  assert.equal(payload.asrBackend, 'funasr-realtime');
  assert.equal(payload.workerId, 'bloomberg-worker-test');
  assert.deepEqual(payload.audioWindow, {
    start: '2026-07-11T04:00:00.000Z',
    end: '2026-07-11T04:00:20.000Z',
    durationSeconds: 20,
  });
  assert.match(payload.id, /^transcript:bloomberg-tv:/);
});

test('repository Bloomberg and CNBC sources default to DashScope FunASR realtime with short English segments', () => {
  const rootDir = path.resolve(import.meta.dirname, '..');
  const bloomberg = loadSourceConfig({ sourceId: 'bloomberg-tv', rootDir });
  const cnbc = loadSourceConfig({ sourceId: 'cnbc-live-tv', rootDir });

  for (const source of [bloomberg, cnbc]) {
    assert.equal(source.asrBackend, 'funasr-realtime');
    assert.equal(source.asrModel, 'fun-asr-realtime');
    assert.equal(source.language, 'en');
    assert.ok(source.segmentSeconds <= 5, 'live TV segments should not wait for a 20-second local batch');
  }
});

test('rejects a remote plaintext ASR API while permitting loopback HTTP and HTTPS', () => {
  assert.equal(isLoopbackHostname('127.0.0.1'), true);
  assert.equal(isLoopbackHostname('localhost'), true);
  assert.equal(isLoopbackHostname('203.0.113.10'), false);
  assert.equal(validateAsrApiBase('http://127.0.0.1:3002/'), 'http://127.0.0.1:3002');
  assert.equal(validateAsrApiBase('https://api.example.test/v1/'), 'https://api.example.test/v1');
  assert.throws(() => validateAsrApiBase('http://api.example.test:3002'), /loopback/i);
  assert.throws(() => validateAsrApiBase('ftp://127.0.0.1'), /http or https/i);
});

test('resolves only complete explicit ASR credentials and otherwise falls back to complete app credentials', () => {
  assert.deepEqual(resolveApiCredentials({
    ASR_API_USERNAME: '',
    ASR_API_PASSWORD: '',
    APP_USERNAME: 'app-user',
    APP_PASSWORD: 'app-password',
  }), {
    username: 'app-user',
    password: 'app-password',
    source: 'APP_*',
  });
  assert.deepEqual(resolveApiCredentials({
    ASR_API_USERNAME: 'asr-user',
    ASR_API_PASSWORD: 'asr-password',
    APP_USERNAME: 'app-user',
    APP_PASSWORD: 'app-password',
  }), {
    username: 'asr-user',
    password: 'asr-password',
    source: 'ASR_API_*',
  });
  assert.throws(() => resolveApiCredentials({ ASR_API_USERNAME: 'asr-user', ASR_API_PASSWORD: '' }), /set together/i);
  assert.throws(() => resolveApiCredentials({ APP_USERNAME: 'app-user', APP_PASSWORD: '' }), /set together/i);
});

test('creates ASR runtime directories and durable state files with owner-only permissions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-private-runtime-'));
  const runtimeDir = path.join(root, 'audio-runtime');
  const statePath = path.join(runtimeDir, 'state.json');

  ensurePrivateDirectory(runtimeDir);
  writeJsonAtomic(statePath, { ready: true });

  assert.equal(fs.statSync(runtimeDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
});

test('never chmods an existing parent while enforcing a dedicated private runtime directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-private-parent-'));
  const sharedParent = path.join(root, 'shared-parent');
  fs.mkdirSync(sharedParent, { mode: 0o755 });
  fs.chmodSync(sharedParent, 0o755);
  const dedicatedRuntime = path.join(sharedParent, 'asr-runtime');

  ensurePrivateDirectory(dedicatedRuntime, { enforceExisting: true });
  assert.equal(fs.statSync(sharedParent).mode & 0o777, 0o755);
  assert.equal(fs.statSync(dedicatedRuntime).mode & 0o777, 0o700);

  assert.throws(() => ensurePrivateRuntimeDirectory(sharedParent), /owner-private/i);
  assert.equal(fs.statSync(sharedParent).mode & 0o777, 0o755);
});
