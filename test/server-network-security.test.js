import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
  isAllowedCorsOrigin,
  isLoopbackHost,
  resolveServerNetworkConfig,
} from '../server/network-security.js';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('server defaults to a loopback-only bind with no cross-origin allowlist', () => {
  const config = resolveServerNetworkConfig({});

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.remoteAccess, false);
  assert.equal(config.auth, null);
  assert.deepEqual(config.corsOrigins, []);
  assert.equal(isLoopbackHost(config.host), true);
  assert.equal(isAllowedCorsOrigin('http://localhost:3001', config), false);
});

test('non-loopback server binding is an explicit authenticated opt-in and wildcard CORS is rejected', () => {
  assert.throws(() => resolveServerNetworkConfig({ APP_HOST: '0.0.0.0' }), /APP_ALLOW_REMOTE_ACCESS=1/i);
  assert.throws(() => resolveServerNetworkConfig({
    APP_HOST: '0.0.0.0',
    APP_ALLOW_REMOTE_ACCESS: '1',
  }), /APP_USERNAME.*APP_PASSWORD/i);
  assert.throws(() => resolveServerNetworkConfig({
    APP_CORS_ORIGINS: '*',
  }), /wildcard/i);

  const config = resolveServerNetworkConfig({
    APP_HOST: '0.0.0.0',
    APP_ALLOW_REMOTE_ACCESS: '1',
    APP_USERNAME: 'operator',
    APP_PASSWORD: 'strong-local-password',
    APP_CORS_ORIGINS: 'https://console.example.test, https://review.example.test',
  });
  assert.equal(config.remoteAccess, true);
  assert.deepEqual(config.auth, { username: 'operator', password: 'strong-local-password' });
  assert.equal(isAllowedCorsOrigin('https://console.example.test', config), true);
  assert.equal(isAllowedCorsOrigin('https://attacker.example.test', config), false);
});

test('development scripts do not expose Vite or preview on every network interface by default', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  assert.doesNotMatch(packageJson.scripts.dev, /--host\s+0\.0\.0\.0/);
  assert.doesNotMatch(packageJson.scripts['dev:all'], /--host\s+0\.0\.0\.0/);
  assert.doesNotMatch(packageJson.scripts.preview, /--host\s+0\.0\.0\.0/);
});

test('the running API emits CORS headers only for an explicitly allowed origin', async (t) => {
  const port = await reservePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-server-cors-'));
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      APP_HOST: '127.0.0.1',
      APP_ALLOW_REMOTE_ACCESS: '',
      APP_USERNAME: 'cors-operator',
      APP_PASSWORD: 'cors-password',
      APP_CORS_ORIGINS: 'https://console.example.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (server.exitCode === null) server.kill('SIGTERM');
  });
  await waitForHealth(`http://127.0.0.1:${port}`);

  const denied = await fetch(`http://127.0.0.1:${port}/api/health`, {
    headers: { origin: 'https://attacker.example.test' },
  });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);

  const allowed = await fetch(`http://127.0.0.1:${port}/api/health`, {
    headers: { origin: 'https://console.example.test' },
  });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://console.example.test');
  assert.equal(allowed.headers.get('access-control-allow-methods'), 'GET, POST, PUT, DELETE, OPTIONS');

  const preflight = await fetch(`http://127.0.0.1:${port}/api/events/transcripts`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://console.example.test',
      'access-control-request-method': 'POST',
    },
  });
  assert.equal(preflight.status, 204);

  const authorization = `Basic ${Buffer.from('cors-operator:cors-password').toString('base64')}`;
  const protectedUnauthenticated = await fetch(`http://127.0.0.1:${port}/api/sources`, {
    headers: { origin: 'https://console.example.test' },
  });
  assert.equal(protectedUnauthenticated.status, 401);
  assert.equal(protectedUnauthenticated.headers.get('access-control-allow-origin'), 'https://console.example.test');

  const protectedAllowed = await fetch(`http://127.0.0.1:${port}/api/sources`, {
    headers: {
      origin: 'https://console.example.test',
      authorization,
    },
  });
  assert.equal(protectedAllowed.status, 200);
  assert.equal(protectedAllowed.headers.get('access-control-allow-origin'), 'https://console.example.test');

  const protectedDenied = await fetch(`http://127.0.0.1:${port}/api/sources`, {
    headers: {
      origin: 'https://attacker.example.test',
      authorization,
    },
  });
  assert.equal(protectedDenied.status, 200);
  assert.equal(protectedDenied.headers.get('access-control-allow-origin'), null);
});

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The local child process is still binding its loopback port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Server did not become healthy: ${baseUrl}`);
}
