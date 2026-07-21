import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const workerPath = path.join(repoRoot, 'scripts', 'asr-worker.js');

test('sidecar worker publishes complete metadata, durable health, and atomically processed assets', async (t) => {
  const fixture = createWorkerFixture();
  writeSegment(fixture.incoming, '20260711T120000.wav', 'NVIDIA NVDA investors discussed AI demand and earnings.');
  const received = [];
  const server = await createApiServer((request, response) => {
    received.push(request.body);
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ event: { id: 'evt-live-1' } }));
  });
  t.after(async () => server.close());

  const result = await runWorker(fixture, server.baseUrl);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(received.length, 1);
  assert.equal(received[0].sourceId, 'bloomberg-tv');
  assert.equal(received[0].sourceName, 'Bloomberg TV');
  assert.match(received[0].id, /^transcript:bloomberg-tv:/);
  assert.equal(received[0].asrBackend, 'sidecar');
  assert.equal(received[0].workerId, 'test-worker');
  assert.deepEqual(received[0].audioWindow, {
    start: '2026-07-11T04:00:00.000Z',
    end: '2026-07-11T04:00:20.000Z',
    durationSeconds: 20,
  });
  assert.equal(fs.readdirSync(fixture.incoming).length, 0);
  assert.equal(fs.readdirSync(fixture.failed).length, 0);
  assert.equal(fs.readdirSync(fixture.processed).filter((name) => name.endsWith('.wav')).length, 1);
  const health = JSON.parse(fs.readFileSync(path.join(fixture.logs, 'health.json'), 'utf8'));
  assert.equal(health.status, 'healthy');
  assert.equal(health.metrics.processed, 1);
  const logs = fs.readFileSync(path.join(fixture.logs, 'asr-worker.jsonl'), 'utf8');
  assert.match(logs, /"processingLatencyMs":/);
  assert.match(logs, /"segmentToEventLatencyMs":/);
  assert.doesNotMatch(logs, /"asrLatencyMs":/);
});

test('sidecar worker retries a transient event API failure before preserving one processed segment', async (t) => {
  const fixture = createWorkerFixture();
  writeSegment(fixture.incoming, '20260711T120020.wav', 'AMD AMD commentary follows the market open.');
  let attempts = 0;
  const server = await createApiServer((request, response) => {
    attempts += 1;
    if (attempts === 1) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'temporary outage' }));
      return;
    }
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ event: { id: 'evt-retried' } }));
  });
  t.after(async () => server.close());

  const result = await runWorker(fixture, server.baseUrl, { ASR_MAX_RETRIES: '2', ASR_RETRY_BASE_MS: '5' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(attempts, 2);
  assert.equal(fs.readdirSync(fixture.failed).length, 0);
  assert.equal(fs.readdirSync(fixture.processed).filter((name) => name.endsWith('.wav')).length, 1);
  const logs = fs.readFileSync(path.join(fixture.logs, 'asr-worker.jsonl'), 'utf8');
  assert.match(logs, /"type":"post_retry"/);
});

test('worker sends configured Basic Auth and reports the actual duration of a shortened WAV segment', async (t) => {
  const fixture = createWorkerFixture();
  writeWavSegment(fixture.incoming, '20260711T120040.wav', 'The shortened segment has an actual audio duration.', 1.25);
  const received = [];
  const server = await createApiServer((request, response) => {
    received.push(request);
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ event: { id: 'evt-auth-duration' } }));
  });
  t.after(async () => server.close());

  const result = await runWorker(fixture, server.baseUrl, {
    ASR_STABLE_CHECK_MS: '1',
    ASR_API_USERNAME: 'worker-user',
    ASR_API_PASSWORD: 'worker-pass',
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(received.length, 1);
  assert.equal(received[0].headers.authorization, `Basic ${Buffer.from('worker-user:worker-pass').toString('base64')}`);
  assert.deepEqual(received[0].body.audioWindow, {
    start: '2026-07-11T04:00:40.000Z',
    end: '2026-07-11T04:00:41.250Z',
    durationSeconds: 1.25,
  });
});

test('worker moves a terminal sidecar failure to failed with a diagnostic record', async (t) => {
  const fixture = createWorkerFixture();
  fs.writeFileSync(path.join(fixture.incoming, '20260711T120100.wav'), Buffer.from('RIFF----WAVEfmt synthetic-audio'));
  const server = await createApiServer((request, response) => {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'should not be called without a sidecar' }));
  });
  t.after(async () => server.close());

  const result = await runWorker(fixture, server.baseUrl, {
    ASR_STABLE_CHECK_MS: '1',
    ASR_MAX_RETRIES: '1',
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.readdirSync(fixture.incoming).length, 0);
  const failed = fs.readdirSync(fixture.failed);
  assert.equal(failed.filter((name) => name.endsWith('.wav')).length, 1);
  assert.equal(failed.filter((name) => name.endsWith('.error.json')).length, 1);
  const health = JSON.parse(fs.readFileSync(path.join(fixture.logs, 'health.json'), 'utf8'));
  assert.equal(health.metrics.failed, 1);
  assert.match(health.lastError, /Missing sidecar transcript/);
});

test('worker bounds and prunes durable dedupe state on startup', async () => {
  const fixture = createWorkerFixture();
  const now = Date.now();
  fs.writeFileSync(path.join(fixture.logs, 'dedupe.json'), JSON.stringify({
    version: 1,
    audioHashes: {
      old: { timestampMs: now - 60_000 },
      newest: { timestampMs: now - 1 },
      recent: { timestampMs: now - 2 },
    },
    textHashes: {
      old: { timestampMs: now - 60_000 },
      newest: { timestampMs: now - 1 },
      recent: { timestampMs: now - 2 },
    },
  }, null, 2));
  const server = await createApiServer((request, response) => {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'no files should be posted' }));
  });

  try {
    const result = await runWorker(fixture, server.baseUrl, {
      ASR_DEDUPE_MAX_ENTRIES: '1',
      ASR_DEDUPE_RETENTION_MS: '1000',
      ASR_STABLE_CHECK_MS: '1',
    });
    assert.equal(result.code, 0, result.stderr);
    const persisted = JSON.parse(fs.readFileSync(path.join(fixture.logs, 'dedupe.json'), 'utf8'));
    assert.deepEqual(Object.keys(persisted.audioHashes), ['newest']);
    assert.deepEqual(Object.keys(persisted.textHashes), ['newest']);
  } finally {
    await server.close();
  }
});

test('worker reloads its durable journal after a restart and suppresses repeated transcript text', async (t) => {
  const fixture = createWorkerFixture();
  const transcript = 'The same live television sentence must not create a second event after restart.';
  const received = [];
  const server = await createApiServer((request, response) => {
    received.push(request.body);
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ event: { id: `evt-journal-${received.length}` } }));
  });
  t.after(async () => server.close());

  const overrides = {
    ASR_STABLE_CHECK_MS: '1',
    ASR_DEDUPE_COMPACT_INTERVAL_MS: '3600000',
  };
  writeWavSegment(fixture.incoming, '20260713T120000.wav', transcript, 1);
  const first = await runWorker(fixture, server.baseUrl, overrides);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(received.length, 1);
  assert.match(fs.readFileSync(path.join(fixture.logs, 'dedupe.jsonl'), 'utf8'), /textHash/);

  // A distinct audio file has the same recognized text. The second process must read the journal,
  // not depend on an in-memory cache from the first process.
  writeWavSegment(fixture.incoming, '20260713T120020.wav', transcript, 1.25);
  const second = await runWorker(fixture, server.baseUrl, overrides);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(received.length, 1);
  assert.equal(fs.readdirSync(fixture.processed).filter((name) => name.endsWith('.wav')).length, 2);
});

test('worker prunes expired processed and failed audio artifacts on startup without touching fresh input', async (t) => {
  const fixture = createWorkerFixture();
  const oldProcessed = path.join(fixture.processed, 'old.wav');
  const oldFailed = path.join(fixture.failed, 'old.wav');
  const freshIncoming = path.join(fixture.incoming, 'fresh.wav');
  fs.writeFileSync(oldProcessed, 'old processed');
  fs.writeFileSync(oldFailed, 'old failed');
  fs.writeFileSync(freshIncoming, 'fresh input');
  const oldDate = new Date(Date.now() - 10_000);
  fs.utimesSync(oldProcessed, oldDate, oldDate);
  fs.utimesSync(oldFailed, oldDate, oldDate);
  const server = await createApiServer((request, response) => {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'fresh input should not be processed without a sidecar' }));
  });
  t.after(async () => server.close());

  const result = await runWorker(fixture, server.baseUrl, {
    ASR_AUDIO_RETENTION_MS: '1000',
    ASR_FAILED_RETENTION_MS: '1000',
    ASR_STABLE_CHECK_MS: '1',
    ASR_MIN_AGE_MS: '60000',
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.existsSync(oldProcessed), false);
  assert.equal(fs.existsSync(oldFailed), false);
  assert.equal(fs.existsSync(freshIncoming), true);
});

test('periodic scans reserve a file before its stable-file wait so it posts once', async (t) => {
  const fixture = createWorkerFixture();
  const received = [];
  const server = await createApiServer((request, response) => {
    received.push(request.body);
    setTimeout(() => {
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ event: { id: `evt-overlap-${received.length}` } }));
    }, 180);
  });
  const worker = runWorkerContinuously(fixture, server.baseUrl, {
    ASR_POLL_MS: '5',
    ASR_STABLE_CHECK_MS: '60',
    ASR_MAX_RETRIES: '1',
  });
  t.after(async () => {
    await stopWorker(worker);
    await server.close();
  });

  await waitForCondition(() => fs.existsSync(path.join(fixture.logs, 'health.json')), 1_500);
  writeSegment(fixture.incoming, '20260711T120120.wav', 'A file that must never be processed by overlapping scans.');
  await delay(550);
  await stopWorker(worker);

  assert.equal(received.length, 1);
  assert.equal(fs.readdirSync(fixture.processed).filter((name) => name.endsWith('.wav')).length, 1);
});

test('worker aborts an overdue API request and isolates the segment for recovery', async (t) => {
  const fixture = createWorkerFixture();
  writeSegment(fixture.incoming, '20260711T120140.wav', 'This request should time out before the server responds.');
  const server = await createApiServer((request, response) => {
    setTimeout(() => {
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ event: { id: 'evt-too-late' } }));
    }, 250);
  });
  t.after(async () => server.close());

  const result = await runWorker(fixture, server.baseUrl, {
    ASR_STABLE_CHECK_MS: '1',
    ASR_MAX_RETRIES: '1',
    ASR_HTTP_TIMEOUT_MS: '25',
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.readdirSync(fixture.processed).filter((name) => name.endsWith('.wav')).length, 0);
  assert.equal(fs.readdirSync(fixture.failed).filter((name) => name.endsWith('.wav')).length, 1);
  const health = JSON.parse(fs.readFileSync(path.join(fixture.logs, 'health.json'), 'utf8'));
  assert.match(health.lastError, /timed out/i);
});

test('worker rejects a disabled local Whisper backend and isolates the segment without invoking it', async (t) => {
  const fixture = createWorkerFixture();
  writeSegment(fixture.incoming, '20260711T120200.wav', 'The disabled local Whisper backend must never run.');
  const server = await createApiServer((request, response) => {
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ event: { id: 'should-not-post' } }));
  });
  t.after(async () => server.close());

  const result = await runWorker(fixture, server.baseUrl, {
    ASR_BACKEND: 'whisper',
    ASR_STABLE_CHECK_MS: '1',
    ASR_MAX_RETRIES: '1',
    WHISPER_COMMAND: '/usr/bin/false',
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.readdirSync(fixture.processed).filter((name) => name.endsWith('.wav')).length, 0);
  assert.equal(fs.readdirSync(fixture.failed).filter((name) => name.endsWith('.wav')).length, 1);
  const health = JSON.parse(fs.readFileSync(path.join(fixture.logs, 'health.json'), 'utf8'));
  assert.match(health.lastError, /Unsupported ASR_BACKEND: whisper/i);
});

function createWorkerFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-worker-'));
  const incoming = path.join(root, 'incoming');
  const processed = path.join(root, 'processed');
  const failed = path.join(root, 'failed');
  const logs = path.join(root, 'logs');
  [incoming, processed, failed, logs].forEach((directory) => fs.mkdirSync(directory, { recursive: true }));
  return { root, incoming, processed, failed, logs };
}

function writeSegment(incoming, fileName, text) {
  const audioPath = path.join(incoming, fileName);
  fs.writeFileSync(audioPath, Buffer.from('RIFF----WAVEfmt synthetic-audio'));
  fs.writeFileSync(`${audioPath}.txt`, text);
}

function writeWavSegment(incoming, fileName, text, durationSeconds) {
  const audioPath = path.join(incoming, fileName);
  const sampleRate = 8_000;
  const channels = 1;
  const bytesPerSample = 2;
  const dataLength = Math.round(sampleRate * channels * bytesPerSample * durationSeconds);
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  fs.writeFileSync(audioPath, buffer);
  fs.writeFileSync(`${audioPath}.txt`, text);
}

async function createApiServer(handler) {
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    request.body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function runWorker(fixture, apiBase, overrides = {}) {
  return runWorkerProcess(fixture, apiBase, { once: true, overrides });
}

function runWorkerContinuously(fixture, apiBase, overrides = {}) {
  return runWorkerProcess(fixture, apiBase, { once: false, overrides });
}

function runWorkerProcess(fixture, apiBase, { once, overrides }) {
  const child = spawn(process.execPath, [workerPath, ...(once ? ['--once'] : [])], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ASR_BACKEND: 'sidecar',
      ASR_ONCE: once ? '1' : '0',
      ASR_MIN_AGE_MS: '0',
      ASR_SOURCE_ID: 'bloomberg-tv',
      ASR_SOURCE_NAME: 'Bloomberg TV',
      ASR_SEGMENT_SECONDS: '20',
      ASR_API_BASE: apiBase,
      ASR_WATCH_DIR: fixture.incoming,
      ASR_PROCESSED_DIR: fixture.processed,
      ASR_FAILED_DIR: fixture.failed,
      ASR_LOG_DIR: fixture.logs,
      ASR_WORKER_ID: 'test-worker',
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const closed = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });

  if (!once) return { child, closed };
  return closed;
}

async function stopWorker(worker) {
  if (!worker?.child || worker.child.exitCode !== null || worker.child.signalCode) return;
  worker.child.kill('SIGTERM');
  await waitForWorkerClose(worker, 2_000).catch(() => {
    worker.child.kill('SIGKILL');
  });
}

function waitForWorkerClose(worker, timeoutMs) {
  return Promise.race([
    worker.closed,
    delay(timeoutMs).then(() => {
      throw new Error(`worker did not exit within ${timeoutMs}ms`);
    }),
  ]);
}

async function waitForCondition(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(10);
  }
  throw new Error(`condition did not become true within ${timeoutMs}ms`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
