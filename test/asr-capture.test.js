import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { acquireCaptureDeviceLock, buildCaptureOutputPattern, publishStableSegments, releaseCaptureDeviceLock } from '../scripts/asr-capture.js';

test('capture output pattern isolates a restarted capture session from stale staging files', () => {
  const pattern = buildCaptureOutputPattern({ stagingDir: '/tmp/ig-asr/staging', sessionId: '1234-restart' });
  assert.equal(pattern, '/tmp/ig-asr/staging/%Y%m%dT%H%M%S-1234-restart.wav.part');
});

test('atomically publishes a stable staging WAV into incoming and never exposes a part suffix', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-capture-'));
  const stagingDir = path.join(root, 'staging');
  const incomingDir = path.join(root, 'incoming');
  fs.mkdirSync(stagingDir);
  fs.mkdirSync(incomingDir);
  const stagedPath = path.join(stagingDir, '20260711T120000.wav.part');
  fs.writeFileSync(stagedPath, Buffer.from('RIFF----WAVEfmt synthetic-audio'));

  const published = await publishStableSegments({ stagingDir, incomingDir, minAgeMs: 0, stableCheckMs: 1 });

  assert.equal(published.length, 1);
  assert.match(path.basename(published[0]), /\.wav$/);
  assert.equal(fs.existsSync(stagedPath), false);
  assert.equal(fs.existsSync(published[0]), true);
  assert.equal(fs.readdirSync(incomingDir).some((name) => name.endsWith('.part')), false);
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
