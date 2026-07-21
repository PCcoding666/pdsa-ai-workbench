import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const workerPath = path.join(repoRoot, 'scripts', 'asr-worker.js');

test('synthetic WAV traverses the first-party FunASR realtime adapter, worker, transcript API, and stored event readback', async (t) => {
  const fixture = createFixture();
  const apiPort = await reservePort();
  const api = startApi(apiPort, fixture.dataDir);
  t.after(() => stopChild(api));
  await waitForHealth(`http://127.0.0.1:${apiPort}`, api);

  const realtime = await startRealtimeServer('Nvidia shares rose after earnings.');
  t.after(() => realtime.close());
  writeSyntheticWav(fixture.incoming, '20260720T155000.wav');

  const worker = await runRealtimeWorker(fixture, `http://127.0.0.1:${apiPort}`, realtime.endpoint);
  assert.equal(worker.code, 0, worker.stderr);
  assert.match(worker.stdout, /processed/i);
  assert.equal(realtime.received.runTask.payload.model, 'fun-asr-realtime');
  assert.ok(realtime.received.binaryBytes > 0);
  assert.equal(realtime.received.finishTask.header.action, 'finish-task');

  const stored = await fetch(`http://127.0.0.1:${apiPort}/api/events?stored=1`).then((response) => response.json());
  assert.equal(stored.events.length, 1);
  const [event] = stored.events;
  assert.equal(event.sourceId, 'bloomberg-tv');
  assert.equal(event.asrBackend, 'funasr-realtime');
  assert.equal(event.workerId, 'funasr-realtime-worker');
  assert.equal(event.transcript, 'Nvidia shares rose after earnings.');
  assert.equal(event.verification.needsVerification, true);
  assert.equal(fs.readdirSync(fixture.processed).filter((name) => name.endsWith('.wav')).length, 1);
  assert.equal(fs.readdirSync(fixture.failed).length, 0);

  const realtimeFeed = await fetch(`http://127.0.0.1:${apiPort}/api/events?limit=60`, { signal: AbortSignal.timeout(1_000) }).then((response) => response.json());
  assert.equal(realtimeFeed.events.some((item) => item.id === event.id), true);
  assert.equal(realtimeFeed.events.find((item) => item.id === event.id)?.transcript, event.transcript);
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-asr-funasr-realtime-'));
  const incoming = path.join(root, 'incoming');
  const processed = path.join(root, 'processed');
  const failed = path.join(root, 'failed');
  const logs = path.join(root, 'logs');
  const dataDir = path.join(root, 'data');
  [incoming, processed, failed, logs, dataDir].forEach((directory) => fs.mkdirSync(directory, { recursive: true }));
  return { root, incoming, processed, failed, logs, dataDir };
}

function writeSyntheticWav(directory, name) {
  const samples = Buffer.alloc(16_000 * 2);
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(16_000, 4);
  fmt.writeUInt32LE(32_000, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const body = Buffer.concat([Buffer.from('WAVEfmt '), uint32le(fmt.length), fmt, Buffer.from('data'), uint32le(samples.length), samples]);
  const header = Buffer.concat([Buffer.from('RIFF'), uint32le(body.length), body]);
  fs.writeFileSync(path.join(directory, name), header);
}

async function startRealtimeServer(finalText) {
  const received = { runTask: null, finishTask: null, binaryBytes: 0 };
  const server = http.createServer();
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (request, socket, head) => {
    assert.equal(request.headers.authorization, 'Bearer sk-fake-realtime-key');
    const clientKey = request.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(`${clientKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buffer = Buffer.from(head);
    const consume = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const first = buffer[0];
        const second = buffer[1];
        let length = second & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(offset);
          offset += 2;
        }
        if (length === 127) throw new Error('fixture does not expect oversized client frames');
        if (!(second & 0x80) || buffer.length < offset + 4 + length) return;
        const mask = buffer.subarray(offset, offset + 4);
        offset += 4;
        const payload = Buffer.alloc(length);
        for (let index = 0; index < length; index += 1) payload[index] = buffer[offset + index] ^ mask[index % 4];
        buffer = buffer.subarray(offset + length);
        const opcode = first & 0x0f;
        if (opcode === 0x2) received.binaryBytes += payload.length;
        if (opcode === 0x1) {
          const message = JSON.parse(payload.toString('utf8'));
          if (message.header?.action === 'run-task') {
            received.runTask = message;
            writeServerJson(socket, { header: { event: 'task-started' } });
          }
          if (message.header?.action === 'finish-task') {
            received.finishTask = message;
            writeServerJson(socket, { header: { event: 'result-generated' }, payload: { output: { sentence: { text: finalText, sentence_end: true, sentence_id: 'fixture-final' } } } });
            writeServerJson(socket, { header: { event: 'task-finished' } });
          }
        }
      }
    };
    socket.on('data', consume);
    if (head.length) consume(Buffer.alloc(0));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    endpoint: `ws://127.0.0.1:${port}/inference`,
    received,
    close: () => new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}

function writeServerJson(socket, value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const header = payload.length < 126
    ? Buffer.from([0x81, payload.length])
    : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  socket.write(Buffer.concat([header, payload]));
}

function startApi(port, dataDir) {
  return spawn(process.execPath, ['server/index.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, RSS_CACHE_TTL_MS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runRealtimeWorker(fixture, apiBase, endpoint) {
  return collectChild(spawn(process.execPath, [workerPath, '--once'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ASR_BACKEND: 'funasr-realtime',
      ASR_MODEL: 'fun-asr-realtime',
      ASR_ONCE: '1',
      ASR_MIN_AGE_MS: '0',
      ASR_STABLE_CHECK_MS: '1',
      ASR_SOURCE_ID: 'bloomberg-tv',
      ASR_SOURCE_NAME: 'Bloomberg TV',
      ASR_SEGMENT_SECONDS: '5',
      ASR_API_BASE: apiBase,
      ASR_WATCH_DIR: fixture.incoming,
      ASR_PROCESSED_DIR: fixture.processed,
      ASR_FAILED_DIR: fixture.failed,
      ASR_LOG_DIR: fixture.logs,
      ASR_WORKER_ID: 'funasr-realtime-worker',
      DASHSCOPE_API_KEY: 'sk-fake-realtime-key',
      DASHSCOPE_REALTIME_ENDPOINT: endpoint,
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

function uint32le(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value, 0);
  return output;
}

function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
}
