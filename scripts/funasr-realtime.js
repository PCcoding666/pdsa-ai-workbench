#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

import {
  buildFinishTask,
  buildRunTask,
  cleanText,
  createRealtimeState,
  ingestRealtimeServerEvent,
  parsePcmWav,
  redactSensitiveText,
} from './funasr-realtime-core.js';
import { isLoopbackHostname } from './asr-core.js';

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_ENDPOINT = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

if (isMainModule()) {
  main().catch((error) => {
    console.error(`[funasr-realtime] ${redactError(error)}`);
    process.exitCode = 1;
  });
}

export async function checkRealtimeConnection({
  apiKey,
  endpoint = process.env.DASHSCOPE_REALTIME_ENDPOINT || DEFAULT_ENDPOINT,
  language = 'en',
  taskId = crypto.randomUUID(),
  connect = openWebSocket,
  probePcm = Buffer.alloc(32_000),
  chunkBytes = 3200,
  startupTimeoutMs = positiveInteger(process.env.FUNASR_REALTIME_STARTUP_TIMEOUT_MS, 20_000),
  resultTimeoutMs = positiveInteger(process.env.FUNASR_REALTIME_RESULT_TIMEOUT_MS, 45_000),
} = {}) {
  const normalizedKey = cleanText(apiKey);
  if (!normalizedKey) throw new Error('DASHSCOPE_API_KEY is required for FunASR realtime.');
  const normalizedEndpoint = validateRealtimeEndpoint(endpoint);
  let socket;
  try {
    socket = await connect({ endpoint: normalizedEndpoint, apiKey: normalizedKey, timeoutMs: startupTimeoutMs });
    const state = createRealtimeState();
    await socket.sendJson(buildRunTask({ taskId, language }));
    await waitForRealtimeState(socket, state, {
      timeoutMs: startupTimeoutMs,
      predicate: (current) => current.audioReady,
      waitingFor: 'task-started',
    });
    for (let offset = 0; offset < probePcm.length; offset += chunkBytes) {
      await socket.sendBinary(probePcm.subarray(offset, Math.min(probePcm.length, offset + chunkBytes)));
    }
    await socket.sendJson(buildFinishTask({ taskId }));
    await waitForRealtimeState(socket, state, {
      timeoutMs: resultTimeoutMs,
      predicate: (current) => current.taskFinished,
      waitingFor: 'task-finished',
    });
    return { reachable: true, backend: 'funasr-realtime' };
  } catch (error) {
    throw redactError(error, normalizedKey);
  } finally {
    if (socket) await socket.close().catch(() => {});
  }
}

export async function transcribeRealtimeWav({
  audioFile,
  apiKey,
  endpoint = process.env.DASHSCOPE_REALTIME_ENDPOINT || DEFAULT_ENDPOINT,
  language = 'en',
  taskId = crypto.randomUUID(),
  connect = openWebSocket,
  chunkBytes = positiveInteger(process.env.FUNASR_REALTIME_CHUNK_BYTES, 3200),
  startupTimeoutMs = positiveInteger(process.env.FUNASR_REALTIME_STARTUP_TIMEOUT_MS, 20_000),
  resultTimeoutMs = positiveInteger(process.env.FUNASR_REALTIME_RESULT_TIMEOUT_MS, 45_000),
} = {}) {
  const normalizedKey = cleanText(apiKey);
  if (!normalizedKey) throw new Error('DASHSCOPE_API_KEY is required for FunASR realtime.');
  if (!audioFile || !fs.existsSync(audioFile)) throw new Error(`Audio file does not exist: ${audioFile || '(empty)'}`);
  const normalizedEndpoint = validateRealtimeEndpoint(endpoint);

  const { pcm } = parsePcmWav(fs.readFileSync(audioFile));
  if (!pcm.length) throw new Error('FunASR realtime audio segment is empty.');

  let socket;
  try {
    socket = await connect({ endpoint: normalizedEndpoint, apiKey: normalizedKey, timeoutMs: startupTimeoutMs });
    const state = createRealtimeState();
    await socket.sendJson(buildRunTask({ taskId, language }));
    await waitForRealtimeState(socket, state, {
      timeoutMs: startupTimeoutMs,
      predicate: (current) => current.audioReady,
      waitingFor: 'task-started',
    });

    for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
      await socket.sendBinary(pcm.subarray(offset, Math.min(pcm.length, offset + chunkBytes)));
    }
    await socket.sendJson(buildFinishTask({ taskId }));
    await waitForRealtimeState(socket, state, {
      timeoutMs: resultTimeoutMs,
      predicate: (current) => current.taskFinished,
      waitingFor: 'task-finished',
    });
    const text = cleanText(state.transcript);
    return { text, noSpeech: !text, backend: 'funasr-realtime', taskId };
  } catch (error) {
    throw redactError(error, normalizedKey);
  } finally {
    if (socket) await socket.close().catch(() => {});
  }
}

export function validateRealtimeEndpoint(value) {
  const raw = cleanText(value);
  let target;
  try {
    target = new URL(raw);
  } catch {
    throw new Error(`FunASR realtime endpoint must be a valid ws or wss URL: ${raw || '(empty)'}`);
  }
  if (!['ws:', 'wss:'].includes(target.protocol)) {
    throw new Error(`FunASR realtime endpoint must use ws or wss: ${target.protocol || raw}`);
  }
  if (target.protocol === 'ws:' && !isLoopbackHostname(target.hostname)) {
    throw new Error('Remote plaintext FunASR WebSocket endpoints are blocked. Use a loopback ws:// fixture or a secure wss:// endpoint.');
  }
  return target.toString().replace(/\/$/, '');
}

export async function openWebSocket({ endpoint, apiKey, timeoutMs = 20_000 } = {}) {
  const target = new URL(validateRealtimeEndpoint(endpoint));
  const transport = await createTransport(target, timeoutMs);
  try {
    const key = crypto.randomBytes(16).toString('base64');
    const requestTarget = transport.proxy && target.protocol === 'ws:' ? target.toString() : `${target.pathname || '/'}${target.search || ''}`;
    const request = [
      `GET ${requestTarget} HTTP/1.1`,
      `Host: ${target.host}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      `Authorization: Bearer ${apiKey}`,
      '',
      '',
    ].join('\r\n');
    transport.socket.write(request);
    const response = await readHttpHeaders(transport.socket, timeoutMs);
    const lines = response.header.split('\r\n');
    if (!/^HTTP\/1\.1\s+101\b/.test(lines[0] || '')) {
      throw new Error(`WebSocket upgrade rejected: ${cleanText(lines[0] || 'invalid HTTP response')}`);
    }
    const headers = Object.fromEntries(lines.slice(1).map((line) => {
      const index = line.indexOf(':');
      return index > 0 ? [line.slice(0, index).toLowerCase(), line.slice(index + 1).trim()] : [];
    }).filter((entry) => entry.length));
    const expectedAccept = crypto.createHash('sha1').update(`${key}${WEBSOCKET_GUID}`).digest('base64');
    if (headers['sec-websocket-accept'] !== expectedAccept) throw new Error('WebSocket upgrade returned an invalid accept key.');
    const socket = new RawWebSocketConnection(transport.socket);
    socket.acceptInitialData(response.rest);
    return socket;
  } catch (error) {
    transport.socket.destroy();
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    const result = await checkRealtimeConnection({
      apiKey: process.env.DASHSCOPE_API_KEY,
      endpoint: process.env.DASHSCOPE_REALTIME_ENDPOINT || DEFAULT_ENDPOINT,
      language: optionValue(args, '--language') || process.env.ASR_LANGUAGE || 'en',
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const audioFile = args.find((argument) => !argument.startsWith('--'));
  if (!audioFile) throw new Error('Usage: funasr-realtime.js <segment.wav> [--language en] [--model fun-asr-realtime]');
  const model = optionValue(args, '--model') || 'fun-asr-realtime';
  if (model !== 'fun-asr-realtime') throw new Error(`Unsupported realtime model: ${model}`);
  const result = await transcribeRealtimeWav({
    audioFile,
    apiKey: process.env.DASHSCOPE_API_KEY,
    endpoint: process.env.DASHSCOPE_REALTIME_ENDPOINT || DEFAULT_ENDPOINT,
    language: optionValue(args, '--language') || process.env.ASR_LANGUAGE || 'en',
  });
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(result)}\n`);
  else if (result.text) process.stdout.write(`${result.text}\n`);
}

async function waitForRealtimeState(socket, state, { timeoutMs, predicate, waitingFor }) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate(state)) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error(`FunASR realtime timed out waiting for ${waitingFor}.`);
    const message = await socket.nextMessage({ timeoutMs: remainingMs });
    if (!message || typeof message !== 'object') throw new Error('FunASR realtime WebSocket closed before a task result arrived.');
    ingestRealtimeServerEvent(state, message);
    if (state.taskError) throw new Error(state.taskError);
  }
}

async function createTransport(target, timeoutMs) {
  const proxy = resolveProxy(target);
  if (!proxy) {
    if (target.protocol === 'wss:') {
      const socket = tls.connect({ host: target.hostname, port: target.port || 443, servername: target.hostname });
      await waitForSocketEvent(socket, 'secureConnect', timeoutMs);
      return { socket, proxy: false };
    }
    const socket = net.connect({ host: target.hostname, port: target.port || 80 });
    await waitForSocketEvent(socket, 'connect', timeoutMs);
    return { socket, proxy: false };
  }

  const proxySocket = net.connect({ host: proxy.hostname, port: proxy.port || 80 });
  await waitForSocketEvent(proxySocket, 'connect', timeoutMs);
  if (target.protocol === 'ws:') return { socket: proxySocket, proxy: true };

  const authority = `${target.hostname}:${target.port || 443}`;
  const credentials = proxy.username
    ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password || '')}`).toString('base64')}\r\n`
    : '';
  proxySocket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${credentials}\r\n`);
  const response = await readHttpHeaders(proxySocket, timeoutMs);
  if (!/^HTTP\/1\.1\s+2\d\d\b/.test(response.header.split('\r\n')[0] || '')) {
    proxySocket.destroy();
    throw new Error(`HTTPS proxy tunnel rejected: ${cleanText(response.header.split('\r\n')[0] || 'invalid HTTP response')}`);
  }
  const socket = tls.connect({ socket: proxySocket, servername: target.hostname });
  await waitForSocketEvent(socket, 'secureConnect', timeoutMs);
  return { socket, proxy: false };
}

function resolveProxy(target) {
  if (shouldBypassProxy(target.hostname)) return null;
  const raw = target.protocol === 'wss:'
    ? process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
    : process.env.HTTP_PROXY || process.env.http_proxy;
  if (!raw) return null;
  try {
    const proxy = new URL(raw);
    if (!['http:', 'https:'].includes(proxy.protocol)) return null;
    return proxy;
  } catch {
    return null;
  }
}

function shouldBypassProxy(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (isLoopbackHostname(host)) return true;
  const entries = String(process.env.NO_PROXY || process.env.no_proxy || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  return entries.some((entry) => entry === '*' || host === entry || (entry.startsWith('.') && host.endsWith(entry)) || host.endsWith(`.${entry}`));
}

export function waitForSocketEvent(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(reject, new Error(`WebSocket transport timed out waiting for ${event}.`)), timeoutMs);
    const onError = (error) => finish(reject, error);
    const onEvent = () => finish(resolve);
    const finish = (callback, value) => {
      clearTimeout(timeout);
      socket.off('error', onError);
      socket.off(event, onEvent);
      if (callback === reject && typeof socket.destroy === 'function' && !socket.destroyed) socket.destroy();
      callback(value);
    };
    socket.once('error', onError);
    socket.once(event, onEvent);
  });
}

function readHttpHeaders(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => finish(reject, new Error('WebSocket HTTP handshake timed out.')), timeoutMs);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const marker = buffer.indexOf('\r\n\r\n');
      if (marker < 0) return;
      finish(resolve, { header: buffer.subarray(0, marker).toString('utf8'), rest: buffer.subarray(marker + 4) });
    };
    const onError = (error) => finish(reject, error);
    const onClose = () => finish(reject, new Error('WebSocket connection closed during HTTP handshake.'));
    const finish = (callback, value) => {
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      if (callback === reject && typeof socket.destroy === 'function' && !socket.destroyed) socket.destroy();
      callback(value);
    };
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

class RawWebSocketConnection {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragmentOpcode = null;
    this.fragmentChunks = [];
    this.messages = [];
    this.waiters = [];
    this.closed = false;
    socket.on('data', (chunk) => this.acceptInitialData(chunk));
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('FunASR realtime WebSocket closed.')));
  }

  acceptInitialData(chunk) {
    if (!chunk?.length || this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = Boolean(first & 0x80);
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        const numericLength = Number(this.buffer.readBigUInt64BE(offset));
        if (!Number.isSafeInteger(numericLength)) return this.fail(new Error('WebSocket frame is too large.'));
        length = numericLength;
        offset += 8;
      }
      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + length) return;
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : null;
      offset += maskLength;
      let payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      this.buffer = this.buffer.subarray(offset + length);
      if (mask) payload = unmask(payload, mask);
      this.handleFrame({ fin, opcode, payload });
    }
  }

  handleFrame({ fin, opcode, payload }) {
    if (opcode === 0x8) {
      if (!this.closed) this.sendFrame(0x8, payload).catch(() => {});
      this.fail(new Error('FunASR realtime WebSocket closed.'));
      return;
    }
    if (opcode === 0x9) {
      this.sendFrame(0xA, payload).catch(() => {});
      return;
    }
    if (opcode === 0xA) return;
    if (opcode === 0x0) {
      if (this.fragmentOpcode === null) return this.fail(new Error('WebSocket continuation frame has no preceding message.'));
      this.fragmentChunks.push(payload);
      if (fin) this.finishFragment();
      return;
    }
    if (!fin) {
      this.fragmentOpcode = opcode;
      this.fragmentChunks = [payload];
      return;
    }
    this.handleMessage(opcode, payload);
  }

  finishFragment() {
    const opcode = this.fragmentOpcode;
    const payload = Buffer.concat(this.fragmentChunks);
    this.fragmentOpcode = null;
    this.fragmentChunks = [];
    this.handleMessage(opcode, payload);
  }

  handleMessage(opcode, payload) {
    if (opcode !== 0x1) return;
    let message;
    try {
      message = JSON.parse(payload.toString('utf8'));
    } catch {
      this.fail(new Error('FunASR realtime returned invalid JSON.'));
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(message);
    else this.messages.push(message);
  }

  async sendJson(message) {
    await this.sendFrame(0x1, Buffer.from(JSON.stringify(message), 'utf8'));
  }

  async sendBinary(chunk) {
    await this.sendFrame(0x2, Buffer.from(chunk));
  }

  sendFrame(opcode, body) {
    if (this.closed) return Promise.reject(new Error('FunASR realtime WebSocket is closed.'));
    const payload = Buffer.from(body || '');
    const mask = crypto.randomBytes(4);
    let header;
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    } else if (payload.length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    return new Promise((resolve, reject) => {
      this.socket.write(Buffer.concat([header, mask, unmask(payload, mask)]), (error) => error ? reject(error) : resolve());
    });
  }

  nextMessage({ timeoutMs = 20_000 } = {}) {
    if (this.messages.length) return Promise.resolve(this.messages.shift());
    if (this.closed) return Promise.reject(new Error('FunASR realtime WebSocket is closed.'));
    return new Promise((resolve, reject) => {
      const waiter = { resolve: (message) => finish(resolve, message), reject: (error) => finish(reject, error) };
      const timer = setTimeout(() => waiter.reject(new Error('FunASR realtime WebSocket message timed out.')), timeoutMs);
      const finish = (callback, value) => {
        clearTimeout(timer);
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        callback(value);
      };
      this.waiters.push(waiter);
    });
  }

  async close() {
    if (this.closed) return;
    try {
      await this.sendFrame(0x8, Buffer.alloc(0));
    } catch {
      // The socket may already have been closed by the remote service.
    }
    this.closed = true;
    const forceClose = setTimeout(() => this.socket.destroy(), 250);
    forceClose.unref?.();
    this.socket.once('close', () => clearTimeout(forceClose));
    this.socket.end();
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length) this.waiters.shift().reject(error);
  }
}

function unmask(payload, mask) {
  const output = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) output[index] = payload[index] ^ mask[index % 4];
  return output;
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function redactError(error, apiKey = '') {
  const message = error instanceof Error ? error.message : String(error || 'Unknown FunASR realtime error');
  return redactSensitiveText(message.replaceAll(String(apiKey || ''), apiKey ? '[redacted]' : ''));
}

function isMainModule() {
  return process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
}
