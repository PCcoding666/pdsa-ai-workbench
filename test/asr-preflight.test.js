import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';

import * as preflight from '../scripts/asr-preflight.js';

const { buildPreflightReport, checkApi, mergePreflightRuntimeState, selectPreflightSources } = preflight;

test('preflight has no local Whisper dependency when FunASR realtime is selected', () => {
  const report = buildPreflightReport({
    dependencies: {
      ffmpeg: { available: true },
      ffprobe: { available: true },
      avfoundation: { available: true },
      blackhole: { installed: true, driverInstalled: true },
      funasr: { adapterPresent: true, adapterUsable: true, credentialPresent: true },
    },
    devices: [{ index: 0, name: 'BlackHole 2ch' }],
    sources: [{
      id: 'bloomberg-tv', sourceName: 'Bloomberg TV', selected: true,
      asrBackend: 'funasr-realtime', deviceName: 'BlackHole 2ch', deviceIndex: 0,
      api: { reachable: true, auth: { ready: true } }, signal: { checked: true, nonSilent: true },
    }],
  });

  assert.equal(Object.hasOwn(report.checks, 'whisper'), false);
  assert.equal(report.ready, true);
  assert.ok(report.humanSteps.every((step) => !/Whisper/i.test(step)));
});

test('preflight reports the exact missing loopback, API, signal, and human completion steps', () => {
  const report = buildPreflightReport({
    dependencies: {
      ffmpeg: { available: true, version: '8.0' },
      ffprobe: { available: true, version: '8.0' },
      avfoundation: { available: true },
      funasr: { credentialPresent: false, adapterConfigured: false },
    },
    devices: [{ index: 0, name: 'MacBook Pro Microphone' }],
    sources: [{
      id: 'bloomberg-tv',
      sourceName: 'Bloomberg TV',
      enabled: true,
      asrBackend: 'funasr-realtime',
      deviceName: 'BlackHole 2ch',
      deviceIndex: null,
      api: { reachable: false, error: 'connect ECONNREFUSED' },
      signal: { checked: false, nonSilent: false, reason: 'no resolved device' },
    }],
  });

  assert.equal(report.checks.ffmpeg.available, true);
  assert.equal(Object.hasOwn(report.checks, 'whisper'), false);
  assert.equal(report.checks.funasr.available, false);
  assert.equal(report.checks.loopback.available, false);
  assert.equal(report.checks.api.reachable, false);
  assert.equal(report.checks.signal.nonSilent, false);
  assert.equal(report.ready, false);
  assert.ok(report.humanSteps.some((step) => step.includes('BlackHole 2ch')));
  assert.ok(report.humanSteps.some((step) => step.includes('npm run server')));
  assert.ok(report.humanSteps.some((step) => step.includes('Multi-Output Device')));
  assert.ok(report.humanSteps.some((step) => step.includes('合法播放')));
});

test('preflight does not mark a microphone selection ready when another loopback exists', () => {
  const report = buildPreflightReport({
    dependencies: {
      ffmpeg: { available: true },
      ffprobe: { available: true },
      avfoundation: { available: true },
      funasr: { sdkAvailable: true, credentialPresent: true, adapterConfigured: true, adapterUsable: true },
    },
    devices: [
      { index: 0, name: 'MacBook Pro Microphone' },
      { index: 3, name: 'BlackHole 2ch' },
    ],
    sources: [{
      id: 'bloomberg-tv',
      sourceName: 'Bloomberg TV',
      enabled: true,
      selected: true,
      asrBackend: 'funasr-realtime',
      deviceName: 'MacBook Pro Microphone',
      deviceIndex: 0,
      api: { reachable: true },
      signal: { checked: true, nonSilent: true },
    }],
  });

  assert.equal(report.ready, false);
  assert.equal(report.checks.sourceDevices.every((source) => source.loopbackResolved), false);
  assert.ok(report.humanSteps.some((step) => step.includes('set each enabled source deviceName')));
});

test('preflight tells a silent resolved loopback to verify Multi-Output routing before lawful playback', () => {
  const report = buildPreflightReport({
    dependencies: {
      ffmpeg: { available: true }, ffprobe: { available: true }, avfoundation: { available: true },
      blackhole: { installed: true, driverInstalled: true },
      funasr: { credentialPresent: true, adapterConfigured: true, adapterUsable: true },
    },
    devices: [{ index: 0, name: 'BlackHole 2ch' }],
    sources: [{
      id: 'bloomberg-tv', sourceName: 'Bloomberg TV', selected: true,
      asrBackend: 'funasr-realtime', deviceName: 'BlackHole 2ch', deviceIndex: 0,
      api: { reachable: true, auth: { ready: true } }, signal: { checked: true, nonSilent: false, meanDb: -91, maxDb: -91 },
    }],
  });

  assert.equal(report.ready, false);
  assert.ok(report.humanSteps.some((step) => /Multi-Output Device/i.test(step)));
  assert.ok(report.humanSteps.some((step) => /合法播放/.test(step)));
});

test('preflight tells an installed-but-not-enumerated BlackHole user to restart rather than reinstall', () => {
  const report = buildPreflightReport({
    dependencies: {
      ffmpeg: { available: true },
      ffprobe: { available: true },
      avfoundation: { available: true },
      blackhole: { installed: true, driverInstalled: true },
      funasr: {},
    },
    devices: [{ index: 0, name: 'MacBook Pro Microphone' }],
    sources: [{
      id: 'bloomberg-tv',
      sourceName: 'Bloomberg TV',
      enabled: true,
      selected: true,
      asrBackend: 'funasr-realtime',
      deviceName: 'BlackHole 2ch',
      deviceIndex: null,
      api: { reachable: true, auth: { ready: true } },
      signal: { checked: false, nonSilent: false, reason: 'no resolved device' },
    }],
  });

  assert.equal(report.checks.blackhole.installed, true);
  assert.ok(report.humanSteps.some((step) => /restart macOS/i.test(step)));
  assert.ok(report.humanSteps.every((step) => !/^Install BlackHole/i.test(step)));
});

test('preflight distinguishes a downloaded BlackHole package from an installed audio driver', () => {
  const report = buildPreflightReport({
    dependencies: {
      ffmpeg: { available: true },
      ffprobe: { available: true },
      avfoundation: { available: true },
      blackhole: { installed: false, packageInstalled: true, driverInstalled: false },
      funasr: {},
    },
    devices: [{ index: 0, name: 'MacBook Pro Microphone' }],
    sources: [{
      id: 'bloomberg-tv',
      sourceName: 'Bloomberg TV',
      enabled: true,
      selected: true,
      asrBackend: 'funasr-realtime',
      deviceName: 'BlackHole 2ch',
      deviceIndex: null,
      api: { reachable: true, auth: { ready: true } },
      signal: { checked: false, nonSilent: false, reason: 'no resolved device' },
    }],
  });

  assert.equal(report.checks.blackhole.packageInstalled, true);
  assert.equal(report.checks.blackhole.driverInstalled, false);
  assert.ok(report.humanSteps.some((step) => /complete the BlackHole 2ch macOS installer/i.test(step)));
  assert.ok(report.humanSteps.every((step) => !/restart macOS now/i.test(step)));
});

test('BlackHole check recognizes a downloaded cask package when Homebrew is unavailable', () => {
  assert.equal(typeof preflight.checkBlackHole, 'function');

  const packageDirectory = '/opt/homebrew/Caskroom/blackhole-2ch';
  let spawnCalls = 0;
  const status = preflight.checkBlackHole({
    platform: 'darwin',
    driverPath: '/Library/Audio/Plug-Ins/HAL/BlackHole2ch.driver',
    packageDirectory,
    existsSync: (candidate) => candidate === packageDirectory,
    spawnSyncImpl: () => {
      spawnCalls += 1;
      return { status: null, error: new Error('Homebrew timed out') };
    },
  });

  assert.equal(status.driverInstalled, false);
  assert.equal(status.packageInstalled, true);
  assert.equal(status.installed, false);
  assert.equal(spawnCalls, 0);
});

test('executable check retries one cold-start timeout before reporting a dependency unavailable', () => {
  assert.equal(typeof preflight.checkExecutable, 'function');

  const results = [
    { stdout: '', stderr: '', status: null, error: Object.assign(new Error('spawnSync ffmpeg ETIMEDOUT'), { code: 'ETIMEDOUT' }) },
    { stdout: 'ffmpeg version 8.0\n', stderr: '', status: 0 },
  ];
  const status = preflight.checkExecutable('ffmpeg', ['-version'], {
    timeoutMs: 100,
    retryOnTimeout: true,
    spawnSyncImpl: () => results.shift(),
  });

  assert.equal(status.available, true);
  assert.equal(status.version, 'ffmpeg version 8.0');
  assert.equal(results.length, 0);
});

test('preflight rejects a disabled local ASR backend and points to FunASR realtime', () => {
  const report = buildPreflightReport({
    dependencies: {
      ffmpeg: { available: true },
      ffprobe: { available: true },
      avfoundation: { available: true },
      funasr: { credentialPresent: true, adapterConfigured: true, adapterUsable: true },
    },
    devices: [{ index: 3, name: 'BlackHole 2ch' }],
    sources: [{
      id: 'bloomberg-tv',
      sourceName: 'Bloomberg TV',
      enabled: true,
      selected: true,
      asrBackend: 'whisper',
      deviceName: 'BlackHole 2ch',
      deviceIndex: 3,
      api: { reachable: true },
      signal: { checked: true, nonSilent: true },
    }],
  });

  assert.equal(report.checks.funasr.workerReady, true);
  assert.equal(report.ready, false);
  assert.ok(report.humanSteps.some((step) => step.includes('ASR_BACKEND=funasr-realtime')));
});

test('preflight treats first-party FunASR realtime as the default cloud backend without local Whisper or Python SDK', () => {
  const missingCredential = buildPreflightReport({
    dependencies: {
      ffmpeg: { available: true },
      ffprobe: { available: true },
      avfoundation: { available: true },
      blackhole: { installed: true, driverInstalled: true },
      funasr: { adapterPresent: true, adapterUsable: true, credentialPresent: false },
    },
    devices: [{ index: 3, name: 'BlackHole 2ch' }],
    sources: [{
      id: 'bloomberg-tv',
      sourceName: 'Bloomberg TV',
      enabled: true,
      selected: true,
      asrBackend: 'funasr-realtime',
      deviceName: 'BlackHole 2ch',
      deviceIndex: 3,
      api: { reachable: true, auth: { ready: true } },
      signal: { checked: true, nonSilent: true },
    }],
  });

  assert.equal(missingCredential.ready, false);
  assert.equal(Object.hasOwn(missingCredential.checks, 'whisper'), false);
  assert.ok(missingCredential.humanSteps.some((step) => step.includes('DASHSCOPE_API_KEY')));
  assert.ok(missingCredential.humanSteps.every((step) => !/local Whisper/i.test(step)));

  const ready = buildPreflightReport({
    dependencies: {
      ffmpeg: { available: true },
      ffprobe: { available: true },
      avfoundation: { available: true },
      blackhole: { installed: true, driverInstalled: true },
      funasr: { adapterPresent: true, adapterUsable: true, credentialPresent: true },
    },
    devices: [{ index: 3, name: 'BlackHole 2ch' }],
    sources: [{
      id: 'bloomberg-tv',
      sourceName: 'Bloomberg TV',
      enabled: true,
      selected: true,
      asrBackend: 'funasr-realtime',
      deviceName: 'BlackHole 2ch',
      deviceIndex: 3,
      api: { reachable: true, auth: { ready: true } },
      signal: { checked: true, nonSilent: true },
    }],
  });

  assert.equal(ready.ready, true);
  assert.equal(ready.checks.funasr.workerReady, true);
});

test('preflight directs an unsupported local backend to the cloud realtime backend', () => {
  const report = buildPreflightReport({
    dependencies: {
      ffmpeg: { available: true },
      ffprobe: { available: true },
      avfoundation: { available: true },
      blackhole: { installed: true, driverInstalled: true },
      funasr: { credentialPresent: true, adapterConfigured: true, adapterUsable: true },
    },
    devices: [{ index: 3, name: 'BlackHole 2ch' }],
    sources: [{
      id: 'bloomberg-tv',
      sourceName: 'Bloomberg TV',
      enabled: true,
      selected: true,
      asrBackend: 'whisper',
      deviceName: 'BlackHole 2ch',
      deviceIndex: 3,
      api: { reachable: true, auth: { ready: true } },
      signal: { checked: true, nonSilent: true },
    }],
  });

  assert.ok(report.humanSteps.some((step) => /ASR_BACKEND=funasr-realtime/i.test(step)));
  assert.ok(report.humanSteps.every((step) => !/^Install local/i.test(step)));
});

test('preflight source selection supports an explicitly requested disabled source', () => {
  const sources = [
    { id: 'bloomberg-tv', enabled: true },
    { id: 'cnbc-live-tv', enabled: false },
  ];

  assert.deepEqual(selectPreflightSources(sources, ['cnbc-live-tv']), [sources[1]]);
  assert.throws(() => selectPreflightSources(sources, ['unknown-tv']), /not configured/i);
});

test('single-source preflight preserves other configured source device mappings and removes only an unresolved selected mapping', () => {
  const sources = [
    { id: 'bloomberg-tv' },
    { id: 'cnbc-live-tv' },
  ];
  const previousRuntime = {
    version: 1,
    devices: [{ index: 3, name: 'BlackHole Bloomberg' }, { index: 7, name: 'BlackHole CNBC' }],
    sources: {
      'bloomberg-tv': { deviceIndex: 3, deviceName: 'BlackHole Bloomberg', resolvedAt: '2026-07-10T00:00:00.000Z' },
      'cnbc-live-tv': { deviceIndex: 6, deviceName: 'Old CNBC Device', resolvedAt: '2026-07-10T00:00:00.000Z' },
      retired: { deviceIndex: 9, deviceName: 'Retired' },
    },
  };

  const runtime = mergePreflightRuntimeState({
    previousRuntime,
    configuredSources: sources,
    selectedSourceIds: ['cnbc-live-tv'],
    devices: [{ index: 3, name: 'BlackHole Bloomberg' }, { index: 7, name: 'BlackHole CNBC' }],
    resolvedSources: {
      'cnbc-live-tv': { deviceIndex: 7, deviceName: 'BlackHole CNBC', resolvedAt: '2026-07-11T00:00:00.000Z' },
    },
    updatedAt: '2026-07-11T00:00:00.000Z',
  });

  assert.deepEqual(runtime.sources, {
    'bloomberg-tv': previousRuntime.sources['bloomberg-tv'],
    'cnbc-live-tv': { deviceIndex: 7, deviceName: 'BlackHole CNBC', resolvedAt: '2026-07-11T00:00:00.000Z' },
  });

  const unresolved = mergePreflightRuntimeState({
    previousRuntime: runtime,
    configuredSources: sources,
    selectedSourceIds: ['cnbc-live-tv'],
    devices: runtime.devices,
    resolvedSources: {},
    updatedAt: '2026-07-12T00:00:00.000Z',
  });
  assert.deepEqual(unresolved.sources, {
    'bloomberg-tv': previousRuntime.sources['bloomberg-tv'],
  });
});

test('preflight verifies a protected API endpoint with configured ASR credentials', async (t) => {
  const expectedAuthorization = `Basic ${Buffer.from('asr-user:asr-password').toString('base64')}`;
  const server = http.createServer((request, response) => {
    if (request.url === '/api/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.url === '/api/events?stored=1&limit=1') {
      if (request.headers.authorization === expectedAuthorization) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ events: [] }));
      } else {
        response.writeHead(401, { 'www-authenticate': 'Basic' });
        response.end('Authentication required');
      }
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const apiBase = `http://127.0.0.1:${port}`;

  const withoutCredentials = await checkApi(apiBase, {
    credentials: { username: '', password: '', source: 'none' },
  });
  assert.equal(withoutCredentials.reachable, false);
  assert.equal(withoutCredentials.auth.required, true);
  assert.equal(withoutCredentials.auth.ready, false);

  const withCredentials = await checkApi(apiBase, {
    credentials: { username: 'asr-user', password: 'asr-password', source: 'ASR_API_*' },
  });
  assert.equal(withCredentials.reachable, true);
  assert.equal(withCredentials.auth.ready, true);
  assert.equal(withCredentials.auth.source, 'ASR_API_*');
});

test('ASR package commands load a local .env file with Node without shell interpolation', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  for (const name of ['asr:preflight', 'asr:bloomberg', 'asr:cnbc', 'capture:bloomberg', 'capture:cnbc', 'asr:stack', 'audio:list', 'server', 'dev:all']) {
    assert.match(packageJson.scripts[name], /node --env-file-if-exists=\.env/);
  }
  assert.match(packageJson.scripts['test:asr'], /test\/funasr-realtime\.test\.js/);
});
