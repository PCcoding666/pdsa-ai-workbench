#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findLoopbackDevices,
  isConfiguredLoopbackDevice,
  isNonSilentSignal,
  loadAllSourceConfigs,
  parseAvfoundationAudioDevices,
  parseVolumedetectOutput,
  readJsonFile,
  resolveDevice,
  writeJsonAtomic,
} from './asr-core.js';
import { checkRealtimeConnection } from './funasr-realtime.js';

const __filename = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);

if (isMainModule()) {
  main().catch((error) => {
    console.error(`[asr-preflight] fatal: ${error.message}`);
    process.exitCode = 1;
  });
}

export function buildPreflightReport({ dependencies, devices, sources }) {
  const loopbackDevices = findLoopbackDevices(devices);
  const selectedSources = sources.filter((source) => source.selected === true || source.enabled !== false);
  const sourceDevices = selectedSources.map((source) => {
    const device = (Array.isArray(devices) ? devices : []).find((item) => item.index === source.deviceIndex);
    return {
      id: source.id,
      sourceName: source.sourceName,
      deviceName: source.deviceName,
      deviceIndex: source.deviceIndex ?? null,
      resolvedDeviceName: device?.name || '',
      loopbackResolved: isConfiguredLoopbackDevice(source, device),
    };
  });
  const ffmpeg = dependencies.ffmpeg || { available: false };
  const ffprobe = dependencies.ffprobe || { available: false };
  const avfoundation = dependencies.avfoundation || { available: false };
  const blackhole = dependencies.blackhole || { installed: false };
  const blackholeDriverInstalled = Boolean(blackhole.driverInstalled ?? blackhole.installed);
  const funasr = dependencies.funasr || {};
  const apiReachable = selectedSources.length > 0 && selectedSources.every((source) => source.api?.reachable);
  const apiAuthenticationReady = selectedSources.length > 0 && selectedSources.every((source) => source.api?.auth?.ready ?? source.api?.reachable);
  const nonSilent = selectedSources.length > 0 && selectedSources.every((source) => source.signal?.nonSilent);
  const resolvedDevices = sourceDevices.length > 0 && sourceDevices.every((source) => source.loopbackResolved);
  const requiresFunASRRealtime = selectedSources.some((source) => source.asrBackend === 'funasr-realtime');
  const unsupportedBackends = selectedSources
    .filter((source) => !['sidecar', 'funasr-realtime'].includes(source.asrBackend))
    .map((source) => source.id);
  const realtimeAdapterUsable = Boolean(funasr.realtimeAdapter?.usable ?? funasr.adapterUsable ?? funasr.adapterConfigured);
  const funasrRemoteReady = funasr.remote ? funasr.remote.reachable === true : true;
  const funasrRealtimeWorkerReady = Boolean(realtimeAdapterUsable && funasr.credentialPresent && funasrRemoteReady);
  const funasrWorkerReady = !requiresFunASRRealtime || funasrRealtimeWorkerReady;
  const humanSteps = [];

  if (!ffmpeg.available || !ffprobe.available) humanSteps.push('Install FFmpeg (including ffprobe) and rerun npm run asr:preflight.');
  if (requiresFunASRRealtime && !funasrRealtimeWorkerReady) humanSteps.push('Set DASHSCOPE_API_KEY before starting a FunASR realtime source; the repository includes the required first-party WebSocket adapter.');
  if (requiresFunASRRealtime && funasr.remote?.checked && !funasr.remote.reachable) humanSteps.push('Verify the DashScope FunASR realtime credential and network route, then rerun npm run asr:preflight.');
  if (unsupportedBackends.length) humanSteps.push(`Set ASR_BACKEND=funasr-realtime for: ${unsupportedBackends.join(', ')}. The production worker does not run local Whisper or legacy adapters.`);
  if (!avfoundation.available) humanSteps.push('Install an FFmpeg build with AVFoundation input support on this Mac.');
  if (!loopbackDevices.length) {
    if (blackhole.packageInstalled && !blackholeDriverInstalled) {
      humanSteps.push('Complete the BlackHole 2ch macOS installer, approve the administrator prompt, then restart macOS and rerun npm run asr:preflight.');
    } else if (blackholeDriverInstalled) {
      humanSteps.push('Restart macOS now so the installed BlackHole 2ch driver is enumerated, then rerun npm run asr:preflight.');
    } else {
      humanSteps.push('Install BlackHole 2ch, approve the macOS administrator prompt if shown, then rerun npm run asr:preflight.');
    }
  }
  if (!resolvedDevices) humanSteps.push('In Audio MIDI Setup, create a Multi-Output Device with speakers + BlackHole, route Chrome to it, and set each enabled source deviceName in config/asr-sources.json.');
  if (!apiReachable) humanSteps.push('Start the local API with npm run server, then rerun npm run asr:preflight.');
  if (!nonSilent) humanSteps.push('在 Audio MIDI Setup 确认系统输出是包含扬声器和 BlackHole 的 Multi-Output Device；随后在 Chrome 合法播放选定的 Bloomberg TV 或 CNBC Live TV，并在出现提示时批准 macOS 音频权限；然后重新运行 npm run asr:preflight。');

  return {
    generatedAt: new Date().toISOString(),
    ready: Boolean(ffmpeg.available && ffprobe.available && funasrWorkerReady && !unsupportedBackends.length && avfoundation.available && loopbackDevices.length && resolvedDevices && apiReachable && nonSilent),
    checks: {
      ffmpeg,
      ffprobe,
      avfoundation,
      blackhole,
      funasr: {
        ...funasr,
        available: funasrWorkerReady,
        adapterUsable: realtimeAdapterUsable,
        realtimeAdapterUsable,
        remote: funasr.remote || { checked: false, reachable: false, reason: 'not checked' },
        workerReady: funasrWorkerReady,
      },
      loopback: { available: loopbackDevices.length > 0, devices: loopbackDevices },
      sourceDevices,
      api: {
        reachable: apiReachable,
        authentication: {
          ready: apiAuthenticationReady,
          sources: selectedSources.map((source) => ({
            id: source.id,
            ...(source.api?.auth || { ready: Boolean(source.api?.reachable), source: 'not-reported' }),
          })),
        },
      },
      signal: { nonSilent, sources: selectedSources.map((source) => ({ id: source.id, ...source.signal })) },
    },
    sources,
    humanSteps,
  };
}

export function selectPreflightSources(sources, requestedSourceIds = []) {
  const allSources = Array.isArray(sources) ? sources : [];
  const requested = [...new Set((Array.isArray(requestedSourceIds) ? requestedSourceIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))];
  if (!requested.length) {
    const enabled = allSources.filter((source) => source.enabled !== false);
    if (!enabled.length) throw new Error('No enabled ASR sources. Enable a source in config/asr-sources.json or pass --source <id>.');
    return enabled;
  }
  const selected = requested.map((id) => allSources.find((source) => String(source.id || '').trim() === id));
  const missing = requested.filter((id, index) => !selected[index]);
  if (missing.length) throw new Error(`ASR source is not configured: ${missing.join(', ')}`);
  return selected;
}

async function main() {
  const ffmpegCommand = process.env.FFMPEG_COMMAND || 'ffmpeg';
  const ffprobeCommand = process.env.FFPROBE_COMMAND || 'ffprobe';
  const nativeDependencyCheck = { timeoutMs: 15000, retryOnTimeout: true };
  const dependencies = {
    ffmpeg: checkExecutable(ffmpegCommand, ['-version'], nativeDependencyCheck),
    ffprobe: checkExecutable(ffprobeCommand, ['-version'], nativeDependencyCheck),
    avfoundation: { available: false },
    blackhole: checkBlackHole(),
    funasr: checkFunASR(),
  };
  if (dependencies.funasr.credentialPresent && dependencies.funasr.adapterUsable) {
    try {
      await checkRealtimeConnection({
        apiKey: process.env.DASHSCOPE_API_KEY,
        endpoint: process.env.DASHSCOPE_REALTIME_ENDPOINT,
        language: process.env.ASR_LANGUAGE || 'en',
      });
      dependencies.funasr.remote = { checked: true, reachable: true, error: '' };
    } catch (error) {
      dependencies.funasr.remote = { checked: true, reachable: false, error: String(error.message || 'FunASR realtime check failed') };
    }
  } else {
    dependencies.funasr.remote = { checked: false, reachable: false, error: 'credential or first-party adapter is unavailable' };
  }
  const avfoundationResult = dependencies.ffmpeg.available
    ? spawnSync(ffmpegCommand, ['-hide_banner', '-devices'], { encoding: 'utf8', timeout: 5000 })
    : { stdout: '', stderr: '' };
  const deviceSupportOutput = `${avfoundationResult.stdout || ''}\n${avfoundationResult.stderr || ''}`;
  dependencies.avfoundation = { available: /\bavfoundation\b/i.test(deviceSupportOutput) };

  const deviceOutput = dependencies.ffmpeg.available && dependencies.avfoundation.available
    ? enumerateAudioDevices(ffmpegCommand)
    : '';
  const devices = parseAvfoundationAudioDevices(deviceOutput);
  if (args.includes('--list-devices')) {
    print({ devices, loopbackDevices: findLoopbackDevices(devices) });
    return;
  }

  const sourceConfigs = selectPreflightSources(loadAllSourceConfigs(), optionValues('--source'));
  const runtimeFile = sourceConfigs[0]?.runtimeStateFile || path.resolve('audio', 'asr-runtime.json');
  const previousRuntime = readJsonFile(runtimeFile, {});
  const runtime = {
    version: 1,
    updatedAt: new Date().toISOString(),
    devices,
    sources: {},
  };
  const sourceChecks = [];
  for (const source of sourceConfigs) {
    const device = resolveDevice(source, devices, previousRuntime);
    const deviceIndex = device?.index ?? null;
    if (device) {
      runtime.sources[source.id] = {
        deviceIndex,
        deviceName: device.name,
        resolvedAt: new Date().toISOString(),
      };
    }
    const api = await checkApi(source.apiBase);
    const signal = args.includes('--no-signal') || deviceIndex === null
      ? { checked: false, nonSilent: false, reason: deviceIndex === null ? 'no resolved device' : 'disabled by --no-signal' }
      : await measureSignal(ffmpegCommand, deviceIndex, source.signalThresholdDb);
    sourceChecks.push({
      id: source.id,
      sourceName: source.sourceName,
      enabled: source.enabled,
      selected: true,
      asrBackend: source.asrBackend,
      deviceName: source.deviceName,
      deviceIndex,
      loopbackResolved: Boolean(device),
      api,
      signal,
    });
  }
  writeJsonAtomic(runtimeFile, runtime);

  const report = buildPreflightReport({ dependencies, devices, sources: sourceChecks });
  writeJsonAtomic(path.join(path.dirname(runtimeFile), 'asr-preflight.json'), report);
  print(report);
  if (process.env.ASR_PREFLIGHT_STRICT === '1' && !report.ready) process.exitCode = 1;
}

export function checkExecutable(command, commandArgs, {
  timeoutMs = 5000,
  retryOnTimeout = false,
  spawnSyncImpl = spawnSync,
} = {}) {
  let result = spawnSyncImpl(command, commandArgs, { encoding: 'utf8', timeout: timeoutMs });
  if (retryOnTimeout && result?.error?.code === 'ETIMEDOUT') {
    result = spawnSyncImpl(command, commandArgs, { encoding: 'utf8', timeout: timeoutMs });
  }
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return {
    available: !result.error && result.status === 0,
    command,
    version: output.split(/\r?\n/).find((line) => /version/i.test(line))?.trim() || '',
    error: result.error?.message || '',
  };
}

function checkFunASR() {
  const realtimeAdapterPath = path.join(path.dirname(__filename), 'funasr-realtime.js');
  const realtimeAdapter = checkFirstPartyFunASRRealtimeAdapter(realtimeAdapterPath);
  return {
    credentialPresent: Boolean(String(process.env.DASHSCOPE_API_KEY || '').trim()),
    adapterPresent: realtimeAdapter.present,
    adapterConfigured: realtimeAdapter.usable,
    adapterUsable: realtimeAdapter.usable,
    adapterError: realtimeAdapter.error,
    realtimeAdapter,
  };
}

function checkFirstPartyFunASRRealtimeAdapter(adapterPath) {
  try {
    fs.accessSync(adapterPath, fs.constants.R_OK);
    return { path: adapterPath, present: true, usable: true, error: '' };
  } catch (error) {
    return { path: adapterPath, present: false, usable: false, error: error.message };
  }
}

export function checkBlackHole({
  platform = process.platform,
  driverPath = '/Library/Audio/Plug-Ins/HAL/BlackHole2ch.driver',
  packageDirectory = path.join(process.env.HOMEBREW_PREFIX || '/opt/homebrew', 'Caskroom', 'blackhole-2ch'),
  existsSync = fs.existsSync,
  spawnSyncImpl = spawnSync,
} = {}) {
  if (platform !== 'darwin') return { installed: false, checked: false, error: 'BlackHole is a macOS device' };
  const driverInstalled = existsSync(driverPath);
  const packageDirectoryExists = existsSync(packageDirectory);
  const result = packageDirectoryExists
    ? null
    : spawnSyncImpl('brew', ['list', '--cask', 'blackhole-2ch'], { encoding: 'utf8', timeout: 5000 });
  const packageInstalled = packageDirectoryExists || (!result?.error && result?.status === 0);
  return {
    installed: driverInstalled,
    packageInstalled,
    driverInstalled,
    driverPath,
    packageDirectory,
    checked: true,
    command: 'brew list --cask blackhole-2ch',
    error: result?.error?.message || '',
  };
}

function enumerateAudioDevices(ffmpegCommand) {
  const result = spawnSync(ffmpegCommand, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { encoding: 'utf8', timeout: 8000 });
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

export async function checkApi(apiBase, { credentials = getApiCredentials(), fetchImpl = fetch } = {}) {
  const normalizedCredentials = normalizeApiCredentials(credentials);
  const headers = normalizedCredentials.complete
    ? { Authorization: `Basic ${Buffer.from(`${normalizedCredentials.username}:${normalizedCredentials.password}`).toString('base64')}` }
    : {};
  try {
    const health = await fetchImpl(`${apiBase}/api/health`, { headers, signal: AbortSignal.timeout(2500) });
    if (!health.ok) {
      return {
        reachable: false,
        status: health.status,
        error: `Health HTTP ${health.status}`,
        health: { reachable: false, status: health.status },
        auth: { ...apiAuthStatus(normalizedCredentials), attempted: false, required: false, ready: false, status: 0, error: '' },
      };
    }
    const protectedResponse = await fetchImpl(`${apiBase}/api/events?stored=1&limit=1`, { headers, signal: AbortSignal.timeout(2500) });
    const protectedReady = protectedResponse.ok;
    return {
      reachable: protectedReady,
      status: protectedResponse.status,
      error: protectedReady ? '' : `Protected API HTTP ${protectedResponse.status}`,
      health: { reachable: true, status: health.status },
      auth: {
        ...apiAuthStatus(normalizedCredentials),
        attempted: true,
        required: protectedResponse.status === 401,
        ready: protectedReady,
        status: protectedResponse.status,
        error: protectedReady ? '' : `HTTP ${protectedResponse.status}`,
      },
    };
  } catch (error) {
    return {
      reachable: false,
      status: 0,
      error: error.message,
      health: { reachable: false, status: 0 },
      auth: { ...apiAuthStatus(normalizedCredentials), attempted: false, required: false, ready: false, status: 0, error: error.message },
    };
  }
}

function getApiCredentials() {
  const asrUsername = String(process.env.ASR_API_USERNAME || '');
  const asrPassword = String(process.env.ASR_API_PASSWORD || '');
  if (asrUsername || asrPassword) return { username: asrUsername, password: asrPassword, source: 'ASR_API_*' };
  return {
    username: String(process.env.APP_USERNAME || ''),
    password: String(process.env.APP_PASSWORD || ''),
    source: 'APP_*',
  };
}

function normalizeApiCredentials(credentials = {}) {
  const username = String(credentials.username || '');
  const password = String(credentials.password || '');
  return {
    username,
    password,
    source: String(credentials.source || 'none'),
    configured: Boolean(username || password),
    complete: Boolean(username && password),
  };
}

function apiAuthStatus(credentials) {
  return {
    configured: credentials.configured,
    complete: credentials.complete,
    source: credentials.configured ? credentials.source : 'none',
  };
}

async function measureSignal(ffmpegCommand, deviceIndex, thresholdDb) {
  try {
    const result = await captureCommand(ffmpegCommand, [
      '-hide_banner', '-nostdin', '-f', 'avfoundation', '-i', `:${deviceIndex}`,
      '-t', String(Math.max(1, Number(process.env.ASR_SIGNAL_SECONDS || 2))),
      '-af', 'volumedetect', '-f', 'null', '-',
    ], 6000);
    const volume = parseVolumedetectOutput(`${result.stdout}\n${result.stderr}`);
    return { checked: true, ...volume, nonSilent: isNonSilentSignal(volume, thresholdDb), reason: '' };
  } catch (error) {
    return { checked: true, nonSilent: false, reason: error.message };
  }
}

function captureCommand(command, commandArgs, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code}: ${stderr.slice(-400)}`));
    });
  });
}

function print(payload) {
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (payload.devices) {
    process.stdout.write(`AVFoundation audio devices (${payload.devices.length}):\n`);
    payload.devices.forEach((device) => process.stdout.write(`  [${device.index}] ${device.name}\n`));
    process.stdout.write(`Loopback candidates: ${payload.loopbackDevices.map((device) => `[${device.index}] ${device.name}`).join(', ') || 'none'}\n`);
    return;
  }
  process.stdout.write(`ASR preflight: ${payload.ready ? 'READY' : 'NOT READY'}\n`);
  process.stdout.write(`  ffmpeg: ${payload.checks.ffmpeg.available ? 'detected' : 'missing'}\n`);
  process.stdout.write(`  ffprobe: ${payload.checks.ffprobe.available ? 'detected' : 'missing'}\n`);
  const funasrRemote = payload.checks.funasr.remote?.checked
    ? (payload.checks.funasr.remote.reachable ? 'reachable' : 'unreachable')
    : 'not checked';
  process.stdout.write(`  FunASR realtime/Model Studio: ${payload.checks.funasr.available ? 'configured' : 'not configured'} (remote ${funasrRemote})\n`);
  process.stdout.write(`  BlackHole package: ${payload.checks.blackhole?.installed ? 'installed' : 'not detected'}\n`);
  process.stdout.write(`  loopback input: ${payload.checks.loopback.available ? payload.checks.loopback.devices.map((device) => `[${device.index}] ${device.name}`).join(', ') : 'not detected'}\n`);
  process.stdout.write(`  API: ${payload.checks.api.reachable ? 'reachable' : 'unreachable'} (authentication ${payload.checks.api.authentication?.ready ? 'ready' : 'not ready'})\n`);
  process.stdout.write(`  current signal: ${payload.checks.signal.nonSilent ? 'non-silent' : 'silent/unavailable'}\n`);
  payload.sources.forEach((source) => process.stdout.write(`  source ${source.id}: device=${source.deviceIndex ?? 'unresolved'} api=${source.api.reachable ? 'ok' : 'down'} auth=${source.api.auth?.ready ? 'ready' : source.api.auth ? 'not-ready' : 'n/a'} signal=${source.signal.nonSilent ? 'active' : source.signal.reason || 'silent'}\n`));
  if (payload.humanSteps.length) {
    process.stdout.write('  Human steps:\n');
    payload.humanSteps.forEach((step, index) => process.stdout.write(`    ${index + 1}. ${step}\n`));
  }
}

function optionValues(name) {
  const values = [];
  args.forEach((value, index) => {
    if (value === name && args[index + 1]) values.push(args[index + 1]);
  });
  return values;
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === __filename;
}
