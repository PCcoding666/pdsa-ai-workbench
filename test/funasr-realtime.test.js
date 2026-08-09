import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildFinishTask,
  buildRunTask,
  createRealtimeState,
  ingestRealtimeServerEvent,
  parsePcmWav,
  redactSensitiveText,
} from '../scripts/funasr-realtime-core.js';
import {
  checkRealtimeConnection,
  openWebSocket,
  transcribeRealtimeWav,
  validateRealtimeEndpoint,
  waitForSocketEvent,
} from '../scripts/funasr-realtime.js';

test('builds the FunASR realtime duplex task contract for English PCM16 audio', () => {
  const task = buildRunTask({ taskId: 'task-123', language: 'en' });

  assert.deepEqual(task, {
    header: { action: 'run-task', task_id: 'task-123', streaming: 'duplex' },
    payload: {
      task_group: 'audio',
      task: 'asr',
      function: 'recognition',
      model: 'fun-asr-realtime',
      parameters: {
        format: 'pcm',
        sample_rate: 16000,
        language_hints: ['en'],
        semantic_punctuation_enabled: false,
        heartbeat: true,
      },
      input: {},
    },
  });
  assert.deepEqual(buildFinishTask({ taskId: 'task-123' }), {
    header: { action: 'finish-task', task_id: 'task-123', streaming: 'duplex' },
    payload: { input: {} },
  });
});

test('does not permit audio until task-started and retains only final sentence text', () => {
  const state = createRealtimeState();
  assert.equal(state.audioReady, false);

  ingestRealtimeServerEvent(state, { header: { event: 'task-started' } });
  assert.equal(state.audioReady, true);

  ingestRealtimeServerEvent(state, {
    header: { event: 'result-generated' },
    payload: { output: { sentence: { text: 'Nvidia shares', sentence_end: false, heartbeat: false } } },
  });
  ingestRealtimeServerEvent(state, {
    header: { event: 'result-generated' },
    payload: { output: { sentence: { text: 'Nvidia shares rose after earnings.', sentence_end: true, heartbeat: false } } },
  });
  ingestRealtimeServerEvent(state, {
    header: { event: 'result-generated' },
    payload: { output: { sentence: { text: '', sentence_end: true, heartbeat: true } } },
  });

  assert.deepEqual(state.finalTexts, ['Nvidia shares rose after earnings.']);
  assert.equal(state.transcript, 'Nvidia shares rose after earnings.');
});

test('parses only mono 16 kHz PCM16 WAV payload data, including non-44-byte headers', () => {
  const wav = buildPcmWav({ sampleRate: 16000, channels: 1, samples: [0, 1234, -1234], paddingBytes: 12 });
  const parsed = parsePcmWav(wav);

  assert.equal(parsed.sampleRate, 16000);
  assert.equal(parsed.channels, 1);
  assert.equal(parsed.bitsPerSample, 16);
  assert.deepEqual([...parsed.pcm], [...Buffer.from([0, 0, 210, 4, 46, 251])]);
  assert.throws(() => parsePcmWav(buildPcmWav({ sampleRate: 44100, channels: 1, samples: [0] })), /16 kHz/i);
  assert.throws(() => parsePcmWav(buildPcmWav({ sampleRate: 16000, channels: 2, samples: [0, 0] })), /mono/i);
});

test('redacts API keys from adapter errors before they reach worker logs', () => {
  const key = 'sk-example-secret-value';
  assert.equal(redactSensitiveText(`WebSocket rejected Bearer ${key}`), 'WebSocket rejected Bearer [redacted]');
  assert.equal(redactSensitiveText(`token=${key}&reason=bad`), 'token=[redacted]&reason=bad');
});

test('streams PCM only after task-started and returns final FunASR text', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-funasr-realtime-'));
  const audioFile = path.join(directory, 'segment.wav');
  fs.writeFileSync(audioFile, buildPcmWav({ sampleRate: 16000, channels: 1, samples: new Array(2_000).fill(7) }));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const sent = [];
  const incoming = [
    { header: { event: 'task-started' } },
    { header: { event: 'result-generated' }, payload: { output: { sentence: { text: 'Nvidia shares', sentence_end: false } } } },
    { header: { event: 'result-generated' }, payload: { output: { sentence: { text: 'Nvidia shares rose.', sentence_end: true, sentence_id: 'sentence-1' } } } },
    { header: { event: 'task-finished' } },
  ];
  const result = await transcribeRealtimeWav({
    audioFile,
    apiKey: 'sk-test-key',
    language: 'en',
    taskId: 'task-for-test',
    connect: async () => ({
      sendJson: async (message) => { sent.push({ type: 'json', message }); },
      sendBinary: async (chunk) => { sent.push({ type: 'binary', bytes: chunk.length }); },
      nextMessage: async () => incoming.shift(),
      close: async () => { sent.push({ type: 'close' }); },
    }),
  });

  assert.equal(result.text, 'Nvidia shares rose.');
  assert.equal(result.backend, 'funasr-realtime');
  assert.equal(sent[0].message.header.action, 'run-task');
  assert.equal(sent[1].type, 'binary');
  assert.equal(sent.at(-2).message.header.action, 'finish-task');
  assert.equal(sent.at(-1).type, 'close');
});

test('treats a successful FunASR task with no final sentence as no speech, not a retryable adapter error', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-funasr-realtime-no-speech-'));
  const audioFile = path.join(directory, 'segment.wav');
  fs.writeFileSync(audioFile, buildPcmWav({ sampleRate: 16000, channels: 1, samples: new Array(800).fill(0) }));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const incoming = [
    { header: { event: 'task-started' } },
    { header: { event: 'task-finished' } },
  ];
  const result = await transcribeRealtimeWav({
    audioFile,
    apiKey: 'sk-test-key',
    taskId: 'task-no-speech',
    connect: async () => ({
      sendJson: async () => {},
      sendBinary: async () => {},
      nextMessage: async () => incoming.shift(),
      close: async () => {},
    }),
  });

  assert.deepEqual(result, {
    text: '',
    noSpeech: true,
    backend: 'funasr-realtime',
    taskId: 'task-no-speech',
  });
});

test('blocks remote plaintext WebSocket endpoints but permits local fixture endpoints and secure remote endpoints', () => {
  assert.equal(validateRealtimeEndpoint('ws://127.0.0.1:8787/inference'), 'ws://127.0.0.1:8787/inference');
  assert.equal(validateRealtimeEndpoint('wss://dashscope.aliyuncs.com/api-ws/v1/inference'), 'wss://dashscope.aliyuncs.com/api-ws/v1/inference');
  assert.throws(() => validateRealtimeEndpoint('ws://api.example.test/inference'), /loopback/i);
  assert.throws(() => validateRealtimeEndpoint('https://api.example.test/inference'), /ws or wss/i);
});

test('bypasses HTTP proxies for every permitted 127/8 local WebSocket endpoint', async (t) => {
  let proxyConnections = 0;
  const proxy = net.createServer((socket) => {
    proxyConnections += 1;
    socket.once('data', () => socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'));
  });
  const proxyPort = await listen(proxy, '127.0.0.1');
  const targetPort = await reserveClosedPort();
  t.after(async () => {
    await closeServer(proxy);
  });

  await withTemporaryEnv({
    HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
    http_proxy: undefined,
    HTTPS_PROXY: undefined,
    https_proxy: undefined,
    NO_PROXY: '',
    no_proxy: '',
  }, async () => {
    await assert.rejects(() => openWebSocket({
      endpoint: `ws://127.0.0.2:${targetPort}/inference`,
      apiKey: 'sk-test-loopback-proxy-regression',
      timeoutMs: 1_000,
    }));
  });

  assert.equal(proxyConnections, 0);
});

test('destroys a socket when connecting times out', async () => {
  const socket = new EventEmitter();
  socket.destroyed = false;
  socket.destroy = () => { socket.destroyed = true; };

  await assert.rejects(
    () => waitForSocketEvent(socket, 'connect', 1),
    /timed out waiting for connect/i,
  );
  assert.equal(socket.destroyed, true);
});

test('destroys a stalled HTTPS proxy CONNECT socket after its handshake timeout', async (t) => {
  const sockets = new Set();
  let connectRequests = 0;
  const proxy = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('data', (chunk) => {
      if (String(chunk).startsWith('CONNECT ')) connectRequests += 1;
      // Deliberately never reply: this models a stalled proxy CONNECT handshake.
    });
    socket.once('close', () => sockets.delete(socket));
  });
  const proxyPort = await listen(proxy, '127.0.0.1');
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await closeServer(proxy);
  });

  await withTemporaryEnv({
    HTTP_PROXY: undefined,
    http_proxy: undefined,
    HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
    https_proxy: undefined,
    NO_PROXY: '',
    no_proxy: '',
  }, async () => {
    await assert.rejects(
      () => openWebSocket({
        endpoint: 'wss://example.test/inference',
        apiKey: 'sk-test-proxy-connect-timeout',
        timeoutMs: 30,
      }),
      /WebSocket HTTP handshake timed out/i,
    );
  });

  assert.equal(connectRequests, 1);
  assert.equal(await waitFor(() => sockets.size === 0), true);
});

test('fails a realtime task without leaking its API key', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-funasr-realtime-error-'));
  const audioFile = path.join(directory, 'segment.wav');
  fs.writeFileSync(audioFile, buildPcmWav({ sampleRate: 16000, channels: 1, samples: [0] }));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  await assert.rejects(() => transcribeRealtimeWav({
    audioFile,
    apiKey: 'sk-test-key',
    taskId: 'task-failure',
    connect: async () => ({
      sendJson: async () => {},
      sendBinary: async () => {},
      nextMessage: async () => ({ header: { event: 'task-failed', error_message: 'Bearer sk-test-key rejected' } }),
      close: async () => {},
    }),
  }), /Bearer \[redacted\] rejected/);
});

test('verifies DashScope realtime task startup with a one-second silent probe', async () => {
  const sent = [];
  const result = await checkRealtimeConnection({
    apiKey: 'sk-test-check-key',
    taskId: 'task-health-check',
    connect: async () => ({
      sendJson: async (message) => { sent.push(message); },
      sendBinary: async (chunk) => { sent.push({ binaryBytes: chunk.length }); },
      nextMessage: async () => ({ header: { event: sent.length === 1 ? 'task-started' : 'task-finished' } }),
      close: async () => { sent.push({ closed: true }); },
    }),
  });

  assert.deepEqual(result, { reachable: true, backend: 'funasr-realtime' });
  assert.equal(sent[0].header.action, 'run-task');
  assert.equal(sent[1].binaryBytes, 3200);
  assert.equal(sent[10].binaryBytes, 3200);
  assert.equal(sent[11].header.action, 'finish-task');
  assert.equal(sent[12].closed, true);
});

function buildPcmWav({ sampleRate, channels, samples, paddingBytes = 0 }) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * channels * 2, 8);
  fmt.writeUInt16LE(channels * 2, 12);
  fmt.writeUInt16LE(16, 14);
  const padding = Buffer.alloc(paddingBytes);
  const chunks = [
    Buffer.from('fmt '), uint32le(16), fmt,
    ...(padding.length ? [Buffer.from('JUNK'), uint32le(padding.length), padding] : []),
    Buffer.from('data'), uint32le(data.length), data,
  ];
  const body = Buffer.concat([Buffer.from('WAVE'), ...chunks]);
  const output = Buffer.alloc(8);
  output.write('RIFF', 0);
  output.writeUInt32LE(body.length, 4);
  return Buffer.concat([output, body]);
}

function uint32le(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value, 0);
  return output;
}

async function listen(server, host) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server.address().port;
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(() => resolve()));
}

async function reserveClosedPort() {
  const server = net.createServer();
  const port = await listen(server, '127.0.0.1');
  await closeServer(server);
  return port;
}

async function withTemporaryEnv(values, callback) {
  const original = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function waitFor(predicate, { timeoutMs = 250, intervalMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return predicate();
}
