import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const workerPath = path.join(repoRoot, 'scripts', 'asr-worker.js');

test('synthetic WAV and sidecar traverse the real worker, Express transcript API, and stored event readback', async (t) => {
  const fixture = createFixture();
  const port = await reservePort();
  const api = startApi(port, fixture.dataDir);
  t.after(() => stopChild(api));
  await waitForHealth(`http://127.0.0.1:${port}`, api);

  writeSyntheticWav(fixture.incoming, '20260713T151000.wav');
  fs.writeFileSync(path.join(fixture.incoming, '20260713T151000.wav.txt'), 'NVIDIA NVDA commentary covered artificial intelligence data center demand.');

  const worker = await runSidecarWorker(fixture, `http://127.0.0.1:${port}`);
  assert.equal(worker.code, 0, worker.stderr);
  assert.match(worker.stdout, /processed/i);

  const storedResponse = await fetch(`http://127.0.0.1:${port}/api/events?stored=1`);
  assert.equal(storedResponse.status, 200);
  const stored = await storedResponse.json();
  assert.equal(stored.mode, 'stored');
  assert.equal(stored.events.length, 1);
  const [event] = stored.events;
  assert.equal(event.sourceId, 'bloomberg-tv');
  assert.equal(event.sourceName, 'Bloomberg TV');
  assert.equal(event.asrBackend, 'sidecar');
  assert.equal(event.workerId, 'full-pipeline-worker');
  assert.equal(event.verification.needsVerification, true);
  assert.deepEqual(event.tickers, ['NVDA']);
  assert.equal(event.audioWindow.durationSeconds, 1);
  assert.match(event.audioFile, /^audio\/bloomberg-tv\/processed\/\d+-20260713T151000\.wav$/);
  assert.doesNotMatch(event.audioFile, /\.\.\//);
  assert.equal(fs.readdirSync(fixture.processed).filter((name) => name.endsWith('.wav')).length, 1);
  assert.equal(fs.readdirSync(fixture.failed).length, 0);
});

test('terminal API failure isolates audio and a manual recovery replay reaches the real Express API', async (t) => {
  const fixture = createFixture();
  writeSyntheticWav(fixture.incoming, '20260713T151020.wav');
  fs.writeFileSync(path.join(fixture.incoming, '20260713T151020.wav.txt'), 'AMD AMD coverage discussed market volatility.');

  const failedWorker = await runSidecarWorker(fixture, 'http://127.0.0.1:9', {
    ASR_MAX_RETRIES: '1',
    ASR_HTTP_TIMEOUT_MS: '100',
  });
  assert.equal(failedWorker.code, 0, failedWorker.stderr);
  const failedWav = fs.readdirSync(fixture.failed).find((name) => name.endsWith('.wav'));
  assert.ok(failedWav, 'terminal failure should isolate the audio segment');
  const failedError = `${path.join(fixture.failed, failedWav)}.error.json`;
  assert.ok(fs.existsSync(failedError), 'terminal failure should include a diagnostic error file');

  const port = await reservePort();
  const api = startApi(port, fixture.dataDir);
  t.after(() => stopChild(api));
  await waitForHealth(`http://127.0.0.1:${port}`, api);
  fs.renameSync(path.join(fixture.failed, failedWav), path.join(fixture.incoming, 'replayed-20260713T151020.wav'));
  fs.renameSync(`${path.join(fixture.failed, failedWav)}.txt`, path.join(fixture.incoming, 'replayed-20260713T151020.wav.txt'));

  const recoveredWorker = await runSidecarWorker(fixture, `http://127.0.0.1:${port}`);
  assert.equal(recoveredWorker.code, 0, recoveredWorker.stderr);
  const stored = await fetch(`http://127.0.0.1:${port}/api/events?stored=1`).then((response) => response.json());
  assert.equal(stored.events.length, 1);
  assert.match(stored.events[0].transcript, /AMD/);
  assert.equal(fs.readdirSync(fixture.processed).filter((name) => name.endsWith('.wav')).length, 1);
});

test('worker posts to a Basic-Auth-protected local Express API by falling back from empty ASR credentials to APP credentials', async (t) => {
  const fixture = createFixture();
  const port = await reservePort();
  const api = startApi(port, fixture.dataDir, { APP_USERNAME: 'local-asr', APP_PASSWORD: 'local-password' });
  t.after(() => stopChild(api));
  await waitForHealth(`http://127.0.0.1:${port}`, api);
  writeSyntheticWav(fixture.incoming, '20260713T151040.wav');
  fs.writeFileSync(path.join(fixture.incoming, '20260713T151040.wav.txt'), 'Microsoft MSFT mentioned cloud demand.');

  const worker = await runSidecarWorker(fixture, `http://127.0.0.1:${port}`, {
    ASR_API_USERNAME: '',
    ASR_API_PASSWORD: '',
    APP_USERNAME: 'local-asr',
    APP_PASSWORD: 'local-password',
  });
  assert.equal(worker.code, 0, worker.stderr);
  const stored = await fetch(`http://127.0.0.1:${port}/api/events?stored=1`, {
    headers: { authorization: `Basic ${Buffer.from('local-asr:local-password').toString('base64')}` },
  }).then((response) => response.json());
  assert.equal(stored.events.length, 1);
  assert.equal(stored.events[0].sourceId, 'bloomberg-tv');
  assert.equal(fs.readdirSync(fixture.failed).length, 0);
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-full-pipeline-'));
  const incoming = path.join(root, 'incoming');
  const processed = path.join(root, 'processed');
  const skipped = path.join(root, 'skipped');
  const failed = path.join(root, 'failed');
  const logs = path.join(root, 'logs');
  const dataDir = path.join(root, 'data');
  [incoming, processed, skipped, failed, logs, dataDir].forEach(createPrivateDirectory);
  return { root, incoming, processed, skipped, failed, logs, dataDir };
}

function createPrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function writeSyntheticWav(directory, name, durationSeconds = 1) {
  const sampleRate = 16000;
  const samples = sampleRate * durationSeconds;
  const dataSize = samples * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(path.join(directory, name), Buffer.concat([header, Buffer.alloc(dataSize)]));
}

function startApi(port, dataDir, overrides = {}) {
  return spawn(process.execPath, ['server/index.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, RSS_CACHE_TTL_MS: '1', ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runSidecarWorker(fixture, apiBase, overrides = {}) {
  return collectChild(spawn(process.execPath, [workerPath, '--once'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ASR_BACKEND: 'sidecar',
      ASR_ONCE: '1',
      ASR_MIN_AGE_MS: '0',
      ASR_STABLE_CHECK_MS: '1',
      ASR_SOURCE_ID: 'bloomberg-tv',
      ASR_SOURCE_NAME: 'Bloomberg TV',
      ASR_SEGMENT_SECONDS: '20',
      ASR_API_BASE: apiBase,
      ASR_WATCH_DIR: fixture.incoming,
      ASR_PROCESSED_DIR: fixture.processed,
      ASR_SKIPPED_DIR: fixture.skipped,
      ASR_FAILED_DIR: fixture.failed,
      ASR_LOG_DIR: fixture.logs,
      ASR_RUNTIME_STATE_FILE: path.join(fixture.root, 'asr-runtime.json'),
      ASR_WORKER_ID: 'full-pipeline-worker',
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

function collectChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(baseUrl, child) {
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Child process is still binding its local port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Local Express API did not become healthy: ${stderr}`);
}

function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
}
