#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendJsonlWithRotation, ensurePrivateRuntimeDirectory, loadAllSourceConfigs, readJsonFile, writeJsonAtomic } from './asr-core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const LOG_MAX_BYTES = positiveNumber(process.env.ASR_LOG_MAX_BYTES, 10 * 1024 * 1024);
const LOG_MAX_ROTATED_FILES = nonNegativeInteger(process.env.ASR_LOG_MAX_ROTATED_FILES, 5);

if (isMainModule()) {
  main().catch((error) => {
    console.error(`[asr-stack] fatal: ${error.message}`);
    process.exitCode = 1;
  });
}

export function buildStackPlan({ sources, runtime }) {
  const claimedDeviceIndexes = new Map();
  return (sources || []).map((source) => {
    const runtimeIndex = Number(runtime?.sources?.[source.id]?.deviceIndex);
    const deviceIndex = Number.isInteger(runtimeIndex) && runtimeIndex >= 0 ? runtimeIndex : null;
    let startCapture = source.enabled !== false && deviceIndex !== null;
    let captureBlockedReason = '';
    if (source.enabled === false) {
      startCapture = false;
      captureBlockedReason = 'source disabled in configuration';
    } else if (deviceIndex === null) {
      captureBlockedReason = 'no resolved device; run npm run asr:preflight';
    } else if (claimedDeviceIndexes.has(deviceIndex)) {
      startCapture = false;
      captureBlockedReason = `device index ${deviceIndex} is already assigned to ${claimedDeviceIndexes.get(deviceIndex)}`;
    } else {
      claimedDeviceIndexes.set(deviceIndex, source.id);
    }
    return {
      ...source,
      deviceIndex,
      startWorker: source.enabled !== false,
      startCapture,
      captureBlockedReason,
    };
  });
}

export async function stopManagedChildren(children, { graceMs = 10000, forceMs = 1000 } = {}) {
  const managedChildren = [...(children?.values?.() || [])].filter(Boolean);
  await Promise.all(managedChildren.map((child) => stopManagedChild(child, { graceMs, forceMs })));
}

export function isBlockedExitCode(code) {
  return Number(code) === 3;
}

function stopManagedChild(child, { graceMs, forceMs }) {
  return new Promise((resolve) => {
    let finished = false;
    let forceTimer;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(graceTimer);
      clearTimeout(forceTimer);
      child.removeListener?.('close', finish);
      resolve();
    };
    const graceTimer = setTimeout(() => {
      if (finished) return;
      const sent = child.kill?.('SIGKILL');
      if (sent === false) {
        finish();
        return;
      }
      forceTimer = setTimeout(finish, Math.max(0, Number(forceMs) || 0));
    }, Math.max(0, Number(graceMs) || 0));

    child.once?.('close', finish);
    const sent = child.kill?.('SIGTERM');
    if (sent === false) finish();
  });
}

async function main() {
  const sourceConfigs = loadAllSourceConfigs();
  const requestedSources = optionValues('--source');
  const selected = sourceConfigs.filter((source) => requestedSources.length ? requestedSources.includes(source.id) : source.enabled !== false);
  if (!selected.length) throw new Error('No enabled ASR sources. Enable a source in config/asr-sources.json or pass --source <id>.');

  const runtimeFile = selected[0].runtimeStateFile;
  ensurePrivateRuntimeDirectory(path.dirname(runtimeFile));
  const runtime = readJsonFile(runtimeFile, {});
  const plan = buildStackPlan({ sources: selected, runtime });
  const stateFile = path.join(path.dirname(runtimeFile), 'asr-stack.json');
  const logFile = path.join(path.dirname(runtimeFile), 'asr-stack.jsonl');
  const state = {
    status: 'starting',
    startedAt: new Date().toISOString(),
    components: {},
    plan: plan.map(({ id, startWorker, startCapture, deviceIndex, captureBlockedReason }) => ({ id, startWorker, startCapture, deviceIndex, captureBlockedReason })),
  };
  const children = new Map();
  const restartTimers = new Set();
  let stopping = false;
  let resolveStopped;
  const stopped = new Promise((resolve) => { resolveStopped = resolve; });
  const writeState = () => writeJsonAtomic(stateFile, { ...state, updatedAt: new Date().toISOString() });
  const log = (type, data = {}) => appendJsonlWithRotation(logFile, {
    time: new Date().toISOString(),
    type,
    ...data,
  }, { maxBytes: LOG_MAX_BYTES, maxRotatedFiles: LOG_MAX_ROTATED_FILES });

  const startManaged = (source, role) => {
    const componentKey = `${source.id}:${role}`;
    const component = state.components[componentKey] || { sourceId: source.id, role, restarts: 0, status: 'starting', lastError: '' };
    state.components[componentKey] = component;
    const launch = () => {
      if (stopping) return;
      const script = role === 'worker' ? 'asr-worker.js' : 'asr-capture.js';
      const child = spawn(process.execPath, [path.join(__dirname, script), '--source', source.id], {
        cwd: repoRoot,
        env: process.env,
        stdio: 'inherit',
      });
      children.set(componentKey, child);
      component.status = 'running';
      component.pid = child.pid;
      component.lastError = '';
      writeState();
      log('component_start', { componentKey, pid: child.pid });
      child.on('error', (error) => {
        component.lastError = error.message;
        log('component_error', { componentKey, error: error.message });
      });
      child.on('close', (code, signal) => {
        children.delete(componentKey);
        if (stopping) {
          component.status = 'stopped';
          writeState();
          return;
        }
        component.lastError = `exit code ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}`;
        if (isBlockedExitCode(code)) {
          component.status = 'blocked';
          writeState();
          log('component_blocked', { componentKey, ...component });
          return;
        }
        component.status = 'restarting';
        component.restarts += 1;
        const delayMs = Math.min(30000, 1000 * (2 ** Math.min(component.restarts - 1, 5)));
        writeState();
        log('component_restart_scheduled', { componentKey, delayMs, ...component });
        const restartTimer = setTimeout(() => {
          restartTimers.delete(restartTimer);
          launch();
        }, delayMs);
        restartTimers.add(restartTimer);
      });
    };
    launch();
  };

  state.status = 'running';
  writeState();
  log('stack_start', { plan: state.plan });
  for (const item of plan) {
    if (item.startWorker) startManaged(item, 'worker');
    if (item.startCapture) startManaged(item, 'capture');
    if (!item.startCapture) log('capture_not_started', { sourceId: item.id, reason: item.captureBlockedReason });
  }

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    state.status = 'stopping';
    writeState();
    log('stack_stop');
    for (const timer of restartTimers) clearTimeout(timer);
    restartTimers.clear();
    await stopManagedChildren(children, {
      graceMs: Number(process.env.ASR_STOP_GRACE_MS) || 10000,
      forceMs: Number(process.env.ASR_STOP_FORCE_MS) || 1000,
    });
    state.status = 'stopped';
    writeState();
    log('stack_stopped');
    resolveStopped();
  };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  await stopped;
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

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
