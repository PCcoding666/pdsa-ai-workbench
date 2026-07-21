import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('transcript API retains complete ASR metadata and stored event readback is idempotent without RSS network access', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-api-'));
  const port = await reservePort();
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, RSS_CACHE_TTL_MS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  server.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(() => server.kill('SIGTERM'));
  await waitForHealth(`http://127.0.0.1:${port}`, stderr);

  const payload = {
    id: 'transcript:bloomberg-tv:fixture-audio',
    sourceId: 'bloomberg-tv',
    sourceName: 'Bloomberg TV',
    timestamp: '2026-07-11T04:00:00.000Z',
    transcript: 'NVIDIA NVDA investors discussed AI data center demand and earnings expectations.',
    audioWindow: {
      start: '2026-07-11T04:00:00.000Z',
      end: '2026-07-11T04:00:20.000Z',
      durationSeconds: 20,
    },
    audioFile: 'audio/bloomberg-tv/processed/fixture.wav',
    asrBackend: 'funasr-realtime',
    workerId: 'bloomberg-worker-test',
  };
  const first = await postJson(`http://127.0.0.1:${port}/api/events/transcripts`, payload);
  const second = await postJson(`http://127.0.0.1:${port}/api/events/transcripts`, payload);

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(first.body.event.id, payload.id);
  assert.equal(first.body.event.sourceId, 'bloomberg-tv');
  assert.equal(first.body.event.sourceName, 'Bloomberg TV');
  assert.equal(first.body.event.timestamp, payload.timestamp);
  assert.equal(first.body.event.transcript, payload.transcript);
  assert.deepEqual(first.body.event.audioWindow, payload.audioWindow);
  assert.equal(first.body.event.audioFile, payload.audioFile);
  assert.equal(first.body.event.asrBackend, payload.asrBackend);
  assert.equal(first.body.event.workerId, payload.workerId);
  assert.equal(first.body.event.verification.needsVerification, true);
  assert.deepEqual(first.body.event.tickers, ['NVDA']);

  const stored = await fetch(`http://127.0.0.1:${port}/api/events?stored=1`).then((response) => response.json());
  assert.equal(stored.events.length, 1);
  assert.equal(stored.events[0].id, payload.id);
  assert.equal(stored.events[0].audioWindow.durationSeconds, 20);
  assert.equal(stored.events[0].evidence[0].audioWindow.end, payload.audioWindow.end);
});

test('transcript API rejects incomplete ASR events instead of silently creating manual events', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-api-required-fields-'));
  const port = await reservePort();
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  server.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(() => server.kill('SIGTERM'));
  await waitForHealth(`http://127.0.0.1:${port}`, stderr);

  const result = await postJson(`http://127.0.0.1:${port}/api/events/transcripts`, {
    sourceId: 'bloomberg-tv',
    transcript: 'A payload without the required ASR provenance must be rejected.',
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'TRANSCRIPT_EVENT_CREATE_FAILED');
  assert.match(result.body.message, /sourceName.*timestamp.*audioWindow.*audioFile.*asrBackend.*workerId/i);
});

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(baseUrl, stderr) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The child process is still binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Server did not become healthy: ${stderr}`);
}
