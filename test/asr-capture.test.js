import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  acquireCaptureDeviceLock,
  acquireCaptureLockBeforePublishing,
  buildCaptureFfmpegArgs,
  buildCaptureOutputPattern,
  finalizeCapture,
  publishStableSegments,
  releaseCaptureDeviceLock,
} from '../scripts/asr-capture.js';

test('capture output pattern isolates a restarted capture session from stale staging files', () => {
  const pattern = buildCaptureOutputPattern({ stagingDir: '/tmp/ig-asr/staging', sessionId: '1234-restart' });
  assert.equal(pattern, '/tmp/ig-asr/staging/%Y%m%dT%H%M%S-1234-restart.wav.part');
});

test('capture explicitly maps the AVFoundation audio stream before segmenting it', () => {
  const args = buildCaptureFfmpegArgs({
    deviceIndex: 3,
    segmentSeconds: 5,
    outputPattern: '/tmp/segment-%Y%m%d.wav.part',
  });

  assert.deepEqual(args.slice(0, 8), [
    '-hide_banner', '-nostdin',
    '-f', 'avfoundation', '-i', ':3',
    '-map', '0:a:0',
  ]);
  assert.equal(args.at(-1), '/tmp/segment-%Y%m%d.wav.part');
});

test('atomically publishes a stable staging WAV into incoming and never exposes a part suffix', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-capture-'));
  const stagingDir = path.join(root, 'staging');
  const incomingDir = path.join(root, 'incoming');
  [stagingDir, incomingDir].forEach(createPrivateDirectory);
  const stagedPath = path.join(stagingDir, '20260711T120000.wav.part');
  fs.writeFileSync(stagedPath, Buffer.from('RIFF----WAVEfmt synthetic-audio'));

  const result = await publishStableSegments({ stagingDir, incomingDir, minAgeMs: 0, stableCheckMs: 1 });
  const { published } = result;

  assert.equal(published.length, 1);
  assert.match(path.basename(published[0]), /\.wav$/);
  assert.equal(fs.existsSync(stagedPath), false);
  assert.equal(fs.existsSync(published[0]), true);
  assert.equal(fs.readdirSync(incomingDir).some((name) => name.endsWith('.part')), false);
  assert.equal(fs.statSync(published[0]).mode & 0o777, 0o600);
});

test('capture skips a stable silent segment before it reaches the ASR worker or cloud backend', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-capture-silence-'));
  const stagingDir = path.join(root, 'staging');
  const incomingDir = path.join(root, 'incoming');
  const skippedDir = path.join(root, 'skipped');
  [stagingDir, incomingDir, skippedDir].forEach(createPrivateDirectory);
  const stagedPath = path.join(stagingDir, '20260711T120010.wav.part');
  fs.writeFileSync(stagedPath, Buffer.from('RIFF----WAVEfmt synthetic-audio'));
  const stableAt = new Date(Date.now() - 1_000);
  fs.utimesSync(stagedPath, stableAt, stableAt);

  const result = await publishStableSegments({
    stagingDir,
    incomingDir,
    skippedDir,
    minAgeMs: 0,
    stableCheckMs: 1,
    inspectSegment: async () => ({ checked: true, nonSilent: false, meanDb: -91, maxDb: -91 }),
  });

  assert.deepEqual(result.published, []);
  assert.equal(result.skipped.length, 1);
  assert.equal(fs.readdirSync(incomingDir).length, 0);
  assert.equal(fs.readdirSync(skippedDir).filter((name) => name.endsWith('.wav')).length, 1);
  assert.equal(fs.statSync(result.skipped[0].destination).mode & 0o777, 0o600);
});

test('capture finalization reports a failed final publish deterministically and always releases its device lock', async () => {
  const status = { status: 'capturing', lastError: '' };
  const calls = [];

  await assert.rejects(() => finalizeCapture({
    code: 0,
    stopping: false,
    status,
    publish: async () => { throw new Error('disk full'); },
    releaseLock: () => { calls.push('release'); },
    writeStatus: () => { calls.push(`status:${status.status}`); },
    log: (type, data) => { calls.push(`${type}:${data?.error || ''}`); },
  }), /disk full/);

  assert.equal(status.status, 'failed');
  assert.match(status.lastError, /disk full/);
  assert.ok(calls.includes('release'));
  assert.ok(calls.some((call) => call.startsWith('capture_final_publish_failed:disk full')));
});

test('capture device lock prevents a second source and recovers a stale PID lock atomically', () => {
  const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-capture-lock-'));
  const first = acquireCaptureDeviceLock({
    lockDir,
    deviceIndex: 3,
    sourceId: 'bloomberg-tv',
    pid: 101,
    isProcessAlive: (pid) => pid === 101,
  });

  assert.throws(() => acquireCaptureDeviceLock({
    lockDir,
    deviceIndex: 3,
    sourceId: 'cnbc-live-tv',
    pid: 202,
    isProcessAlive: (pid) => pid === 101,
  }), /already captured by bloomberg-tv/i);
  releaseCaptureDeviceLock(first);

  const stalePath = path.join(lockDir, 'capture-device-3.lock');
  fs.writeFileSync(stalePath, JSON.stringify({ deviceIndex: 3, sourceId: 'stale-source', pid: 999, token: 'stale' }));
  const recovered = acquireCaptureDeviceLock({
    lockDir,
    deviceIndex: 3,
    sourceId: 'cnbc-live-tv',
    pid: 202,
    isProcessAlive: () => false,
  });

  assert.equal(recovered.owner.sourceId, 'cnbc-live-tv');
  assert.equal(JSON.parse(fs.readFileSync(stalePath, 'utf8')).sourceId, 'cnbc-live-tv');
  releaseCaptureDeviceLock(recovered);
  assert.equal(fs.existsSync(stalePath), false);
});

test('capture fails closed when a fresh lock is still being initialized', () => {
  const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-capture-initializing-lock-'));
  const lockPath = path.join(lockDir, 'capture-device-3.lock');
  fs.writeFileSync(lockPath, '', { mode: 0o600 });

  assert.throws(() => acquireCaptureDeviceLock({
    lockDir,
    deviceIndex: 3,
    sourceId: 'cnbc-live-tv',
    pid: 202,
    isProcessAlive: () => false,
  }), /initializing/i);
  assert.equal(fs.existsSync(lockPath), true);
});

test('capture serializes stale-lock recovery so a reclaimer cannot delete a new live owner', () => {
  const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-capture-stale-lock-race-'));
  const lockPath = path.join(lockDir, 'capture-device-3.lock');
  fs.writeFileSync(lockPath, JSON.stringify({
    deviceIndex: 3,
    sourceId: 'stale-source',
    pid: 999,
    token: 'stale-owner',
    acquiredAt: '2026-08-10T00:00:00.000Z',
  }), { mode: 0o600 });
  const originalRenameSync = fs.renameSync;
  const originalUnlinkSync = fs.unlinkSync;
  let interleaved = false;
  let nestedLock;
  let nestedError;
  const runNestedAcquire = () => {
    if (interleaved) return;
    interleaved = true;
    try {
      nestedLock = acquireCaptureDeviceLock({
        lockDir,
        deviceIndex: 3,
        sourceId: 'nested-source',
        pid: 202,
        isProcessAlive: () => false,
      });
    } catch (error) {
      nestedError = error;
    }
  };
  fs.renameSync = (source, destination) => {
    if (path.resolve(source) === lockPath) runNestedAcquire();
    return originalRenameSync(source, destination);
  };
  fs.unlinkSync = (filePath) => {
    if (path.resolve(filePath) === lockPath) runNestedAcquire();
    return originalUnlinkSync(filePath);
  };

  let outerLock;
  try {
    outerLock = acquireCaptureDeviceLock({
      lockDir,
      deviceIndex: 3,
      sourceId: 'outer-source',
      pid: 101,
      isProcessAlive: () => false,
    });
  } finally {
    fs.renameSync = originalRenameSync;
    fs.unlinkSync = originalUnlinkSync;
  }

  assert.equal(interleaved, true);
  assert.equal(nestedLock, undefined);
  assert.match(nestedError?.message || '', /recovery/i);
  assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).token, outerLock.owner.token);
  releaseCaptureDeviceLock(outerLock);
});

test('capture fails closed rather than reclaiming through a stranded stale-lock recovery guard', () => {
  const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-capture-stranded-recovery-'));
  const lockPath = path.join(lockDir, 'capture-device-3.lock');
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 999, token: 'stale-owner' }), { mode: 0o600 });
  fs.writeFileSync(`${lockPath}.recovery.lock`, JSON.stringify({ pid: 998, token: 'stranded-recovery' }), { mode: 0o600 });

  assert.throws(() => acquireCaptureDeviceLock({
    lockDir,
    deviceIndex: 3,
    sourceId: 'bloomberg-tv',
    pid: 101,
    isProcessAlive: () => false,
  }), /recovery/i);
  assert.equal(fs.existsSync(lockPath), true);
  assert.equal(fs.existsSync(`${lockPath}.recovery.lock`), true);
});

test('capture acquires its device lock before publishing staging files and releases it when setup fails', async () => {
  const calls = [];
  const lock = { lockPath: '/tmp/capture.lock', owner: { token: 'test-lock' } };
  const result = await acquireCaptureLockBeforePublishing({
    acquireLock: () => {
      calls.push('lock');
      return lock;
    },
    publish: async () => { calls.push('publish'); },
    releaseLock: () => { calls.push('release'); },
  });

  assert.equal(result, lock);
  assert.deepEqual(calls, ['lock', 'publish']);

  calls.length = 0;
  await assert.rejects(() => acquireCaptureLockBeforePublishing({
    acquireLock: () => {
      calls.push('lock');
      return lock;
    },
    publish: async () => {
      calls.push('publish');
      throw new Error('initial publish failed');
    },
    releaseLock: () => { calls.push('release'); },
  }), /initial publish failed/);
  assert.deepEqual(calls, ['lock', 'publish', 'release']);
});

function createPrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}
