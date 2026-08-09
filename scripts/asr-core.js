import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '..');

const LOOPBACK_DEVICE_PATTERN = /blackhole|loopback|soundflower|vb[- ]?cable|virtual\s*audio|aggregate|multi[- ]?output/i;
export const LOCK_INITIALIZATION_GRACE_MS = 5_000;

export function loadSourceConfig({ configPath = process.env.ASR_SOURCE_CONFIG || path.join(REPO_ROOT, 'config', 'asr-sources.json'), sourceId, rootDir = REPO_ROOT } = {}) {
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
  const requestedSourceId = cleanText(sourceId || process.env.ASR_SOURCE_ID || 'bloomberg-tv');
  const source = sources.find((item) => cleanText(item.id) === requestedSourceId);
  if (!source) throw new Error(`ASR source is not configured: ${requestedSourceId}`);

  const defaults = parsed.defaults && typeof parsed.defaults === 'object' ? parsed.defaults : {};
  const merged = { ...defaults, ...source };
  const id = cleanText(merged.id);
  if (!id) throw new Error('ASR source config requires an id');

  const sourceRoot = resolvePath(rootDir, merged.rootDir || path.join('audio', id));
  const apiBase = validateAsrApiBase(process.env.ASR_API_BASE || merged.apiBase || 'http://127.0.0.1:3002');
  return {
    ...merged,
    id,
    sourceId: id,
    sourceName: cleanText(process.env.ASR_SOURCE_NAME || merged.name || id),
    apiBase,
    language: cleanText(process.env.ASR_LANGUAGE || merged.language || 'en') || 'en',
    segmentSeconds: positiveNumber(process.env.ASR_SEGMENT_SECONDS || process.env.SEGMENT_SECONDS || merged.segmentSeconds, 5),
    asrBackend: cleanText(process.env.ASR_BACKEND || merged.asrBackend || 'funasr-realtime') || 'funasr-realtime',
    asrModel: cleanText(process.env.ASR_MODEL || merged.asrModel || 'fun-asr-realtime') || 'fun-asr-realtime',
    deviceName: cleanText(process.env.ASR_DEVICE_NAME || merged.deviceName),
    deviceIndex: optionalInteger(process.env.AUDIO_DEVICE_INDEX ?? process.env.ASR_DEVICE_INDEX ?? merged.deviceIndex),
    pollMs: positiveNumber(process.env.ASR_POLL_MS || merged.pollMs, 500),
    minAgeMs: nonNegativeNumber(process.env.ASR_MIN_AGE_MS || merged.minAgeMs, 750),
    stableCheckMs: positiveNumber(process.env.ASR_STABLE_CHECK_MS || merged.stableCheckMs, 250),
    signalThresholdDb: finiteNumber(process.env.ASR_SIGNAL_THRESHOLD_DB || merged.signalThresholdDb, -55),
    textDedupeWindowMs: nonNegativeNumber(process.env.ASR_TEXT_DEDUPE_WINDOW_MS || merged.textDedupeWindowMs, 10 * 60 * 1000),
    maxRetries: nonNegativeInteger(process.env.ASR_MAX_RETRIES || merged.maxRetries, 3),
    enabled: merged.enabled !== false,
    sourceRoot,
    stagingDir: resolvePath(rootDir, merged.stagingDir || path.join(sourceRoot, 'staging')),
    watchDir: resolvePath(rootDir, process.env.ASR_WATCH_DIR || merged.watchDir || path.join(sourceRoot, 'incoming')),
    processedDir: resolvePath(rootDir, process.env.ASR_PROCESSED_DIR || merged.processedDir || path.join(sourceRoot, 'processed')),
    skippedDir: resolvePath(rootDir, process.env.ASR_SKIPPED_DIR || merged.skippedDir || path.join(sourceRoot, 'skipped')),
    failedDir: resolvePath(rootDir, process.env.ASR_FAILED_DIR || merged.failedDir || path.join(sourceRoot, 'failed')),
    logDir: resolvePath(rootDir, process.env.ASR_LOG_DIR || merged.logDir || path.join(sourceRoot, 'logs')),
    runtimeStateFile: resolvePath(rootDir, process.env.ASR_RUNTIME_STATE_FILE || merged.runtimeStateFile || path.join('audio', 'asr-runtime.json')),
  };
}

export function loadAllSourceConfigs({ configPath = process.env.ASR_SOURCE_CONFIG || path.join(REPO_ROOT, 'config', 'asr-sources.json'), rootDir = REPO_ROOT } = {}) {
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
  return sources.map((source) => loadSourceConfig({ configPath, sourceId: source.id, rootDir }));
}

export function parseAvfoundationAudioDevices(output) {
  const lines = String(output || '').split(/\r?\n/);
  const hasAudioHeader = lines.some((line) => /AVFoundation audio devices:/i.test(line));
  let inAudioSection = !hasAudioHeader;
  const devices = [];

  for (const line of lines) {
    if (/AVFoundation audio devices:/i.test(line)) {
      inAudioSection = true;
      continue;
    }
    if (/AVFoundation video devices:/i.test(line)) {
      inAudioSection = false;
      continue;
    }
    if (!inAudioSection) continue;
    const match = line.match(/\[(\d+)\]\s+(.+?)\s*$/);
    if (!match) continue;
    const index = Number(match[1]);
    const name = cleanText(match[2]);
    if (Number.isInteger(index) && name) devices.push({ index, name });
  }

  return devices.filter((device, index, all) => all.findIndex((item) => item.index === device.index) === index);
}

export function findLoopbackDevices(devices) {
  return (Array.isArray(devices) ? devices : []).filter(isLoopbackDevice);
}

export function isLoopbackDevice(device) {
  return LOOPBACK_DEVICE_PATTERN.test(cleanText(device?.name));
}

export function isConfiguredLoopbackDevice(source, device) {
  const configuredName = cleanText(source?.deviceName).toLowerCase();
  const actualName = cleanText(device?.name).toLowerCase();
  return Boolean(configuredName && actualName && configuredName === actualName && isLoopbackDevice(device));
}

export function resolveDevice(source, devices, runtimeState = {}) {
  const currentDevices = Array.isArray(devices) ? devices : [];
  const sourceId = cleanText(source?.id || source?.sourceId);
  const runtimeIndex = optionalInteger(runtimeState?.sources?.[sourceId]?.deviceIndex);
  const configuredIndex = optionalInteger(source?.deviceIndex);
  const candidateIndexes = [runtimeIndex, configuredIndex].filter((index, position, values) => index !== null && values.indexOf(index) === position);

  for (const index of candidateIndexes) {
    const device = currentDevices.find((item) => item.index === index);
    if (isConfiguredLoopbackDevice(source, device)) return device;
  }

  return currentDevices.find((device) => isConfiguredLoopbackDevice(source, device)) || null;
}

export function resolveDeviceIndex(source, devices, runtimeState = {}) {
  return resolveDevice(source, devices, runtimeState)?.index ?? null;
}

export function parseVolumedetectOutput(output) {
  const findDb = (label) => {
    const value = String(output || '').match(new RegExp(`${label}:\\s*(-?(?:\\d+(?:\\.\\d+)?|inf))\\s*dB`, 'i'))?.[1];
    if (!value || /inf/i.test(value)) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return { meanDb: findDb('mean_volume'), maxDb: findDb('max_volume') };
}

export function isNonSilentSignal(volume, thresholdDb = -55) {
  const meanDb = finiteNumber(volume?.meanDb, null);
  const maxDb = finiteNumber(volume?.maxDb, null);
  if (meanDb === null && maxDb === null) return false;
  return (meanDb !== null && meanDb > thresholdDb) || (maxDb !== null && maxDb > thresholdDb && meanDb !== null && meanDb > thresholdDb - 25);
}

export function snapshotFile(filePath, observedAt = Date.now()) {
  try {
    const stat = fs.statSync(filePath);
    return { exists: stat.isFile(), size: stat.size, mtimeMs: stat.mtimeMs, observedAt };
  } catch {
    return { exists: false, size: 0, mtimeMs: 0, observedAt };
  }
}

export function isStableSnapshot(previous, next, { minAgeMs = 1500 } = {}) {
  if (!previous?.exists || !next?.exists || next.size <= 0) return false;
  if (previous.size !== next.size || previous.mtimeMs !== next.mtimeMs) return false;
  return next.observedAt - next.mtimeMs >= minAgeMs;
}

export function createDedupeState(value = {}) {
  return {
    version: 1,
    audioHashes: value.audioHashes && typeof value.audioHashes === 'object' ? value.audioHashes : {},
    textHashes: value.textHashes && typeof value.textHashes === 'object' ? value.textHashes : {},
  };
}

export function isDuplicateAudio(state, audioHash) {
  return Boolean(state?.audioHashes?.[cleanText(audioHash)]);
}

export function isDuplicateText(state, { sourceId, textHash, timestampMs = Date.now(), windowMs = 10 * 60 * 1000 } = {}) {
  const item = state?.textHashes?.[dedupeTextKey(sourceId, textHash)];
  if (!item) return false;
  return Math.abs(Number(timestampMs) - Number(item.timestampMs || 0)) <= Math.max(0, Number(windowMs) || 0);
}

export function recordDedupe(state, { sourceId, audioHash, textHash, timestampMs = Date.now(), eventId = '' } = {}) {
  const next = createDedupeState(state);
  const record = { timestampMs: Number(timestampMs) || Date.now(), eventId: cleanText(eventId) };
  if (cleanText(audioHash)) next.audioHashes[cleanText(audioHash)] = record;
  if (cleanText(sourceId) && cleanText(textHash)) next.textHashes[dedupeTextKey(sourceId, textHash)] = record;
  return next;
}

export function hashText(value) {
  return crypto.createHash('sha256').update(cleanText(value).toLowerCase()).digest('hex');
}

export function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function buildTranscriptPayload({ source, audioHash, transcript, audioFile, startedAt, durationSeconds, asrBackend, workerId }) {
  const timestamp = new Date(startedAt || Date.now()).toISOString();
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const end = new Date(new Date(timestamp).getTime() + duration * 1000).toISOString();
  const text = cleanText(transcript);
  const sourceId = cleanText(source?.id || source?.sourceId);
  return {
    id: `transcript:${sourceId}:${cleanText(audioHash).slice(0, 32)}`,
    sourceId,
    sourceName: cleanText(source?.sourceName || source?.name || sourceId),
    timestamp,
    title: `Live TV transcript: ${truncate(text, 100)}`,
    transcript: text,
    summary: truncate(text, 260),
    timeWindow: `${timestamp}/${end}`,
    audioWindow: { start: timestamp, end, durationSeconds: duration },
    audioFile: cleanText(audioFile),
    asrBackend: cleanText(asrBackend),
    workerId: cleanText(workerId),
  };
}

export function isLoopbackHostname(value) {
  const hostname = cleanText(value).replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') return true;
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) && octets[0] === 127;
}

export function validateAsrApiBase(value) {
  const raw = cleanText(value).replace(/\/+$/, '');
  let endpoint;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new Error(`ASR API base must be a valid http or https URL: ${raw || '(empty)'}`);
  }
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new Error(`ASR API base must use http or https: ${endpoint.protocol || raw}`);
  }
  if (endpoint.protocol === 'http:' && !isLoopbackHostname(endpoint.hostname)) {
    throw new Error('Remote plaintext ASR API URLs are blocked. Use a loopback http:// address or an https:// endpoint.');
  }
  return endpoint.toString().replace(/\/+$/, '');
}

export function resolveApiCredentials(env = process.env) {
  const asrUsername = cleanText(env?.ASR_API_USERNAME);
  const asrPassword = cleanText(env?.ASR_API_PASSWORD);
  if (asrUsername || asrPassword) {
    if (!asrUsername || !asrPassword) throw new Error('ASR_API_USERNAME and ASR_API_PASSWORD must be set together when API Basic Auth is enabled');
    return { username: asrUsername, password: asrPassword, source: 'ASR_API_*' };
  }

  const appUsername = cleanText(env?.APP_USERNAME);
  const appPassword = cleanText(env?.APP_PASSWORD);
  if (appUsername || appPassword) {
    if (!appUsername || !appPassword) throw new Error('APP_USERNAME and APP_PASSWORD must be set together when API Basic Auth is enabled');
    return { username: appUsername, password: appPassword, source: 'APP_*' };
  }
  return null;
}

export function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function tryCreateExclusiveJsonLock(filePath, value) {
  const resolved = path.resolve(filePath);
  ensurePrivateDirectory(path.dirname(resolved));
  const temporaryPath = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );

  try {
    const descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(value)}\n`, 'utf8');
      fs.fchmodSync(descriptor, 0o600);
    } finally {
      fs.closeSync(descriptor);
    }
    try {
      fs.linkSync(temporaryPath, resolved);
      ensurePrivateFile(resolved);
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') return false;
      throw error;
    }
  } finally {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export function isFreshMalformedJsonLock(filePath, value, {
  now = Date.now(),
  graceMs = LOCK_INITIALIZATION_GRACE_MS,
} = {}) {
  if (hasCompleteLockOwner(value)) return false;
  const grace = Math.max(0, Number(graceMs) || 0);
  if (!grace) return false;
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.mtimeMs >= Number(now) - grace;
  } catch {
    return false;
  }
}

export function tryReclaimStaleJsonLock(filePath, {
  isProcessAlive = () => false,
  now = Date.now(),
  graceMs = LOCK_INITIALIZATION_GRACE_MS,
} = {}) {
  const recoveryGuard = tryAcquireStaleLockRecoveryGuard(filePath);
  if (!recoveryGuard) return { status: 'recovery-locked' };

  try {
    if (!fs.existsSync(filePath)) return { status: 'absent' };
    const current = readJsonFile(filePath, {});
    const pid = Number(current?.pid);
    if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) {
      return { status: 'live', owner: current };
    }
    if (isFreshMalformedJsonLock(filePath, current, { now, graceMs })) {
      return { status: 'initializing', owner: current };
    }
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') return { status: 'absent' };
      throw error;
    }
    return { status: 'reclaimed', owner: current };
  } finally {
    releaseJsonLockIfOwned(recoveryGuard);
  }
}

export function writeJsonAtomic(filePath, value) {
  ensurePrivateDirectory(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fchmodSync(descriptor, 0o600);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporaryPath, filePath);
    ensurePrivateFile(filePath);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') throw cleanupError; }
    throw error;
  }
}

export function appendJsonlWithRotation(filePath, value, { maxBytes = 10 * 1024 * 1024, maxRotatedFiles = 5 } = {}) {
  const line = `${JSON.stringify(value)}\n`;
  const normalizedMaxBytes = Math.max(1, Number(maxBytes) || 1);
  const normalizedMaxRotatedFiles = Math.max(0, Math.floor(Number(maxRotatedFiles) || 0));
  ensurePrivateDirectory(path.dirname(filePath));
  const existingSize = snapshotFile(filePath).size;
  if (existingSize > 0 && existingSize + Buffer.byteLength(line) > normalizedMaxBytes) {
    rotateFile(filePath, normalizedMaxRotatedFiles);
  }
  fs.appendFileSync(filePath, line, { encoding: 'utf8', mode: 0o600 });
  ensurePrivateFile(filePath);
}

export function ensurePrivateDirectory(directory, { enforceExisting = false } = {}) {
  if (!directory) throw new Error('A runtime directory path is required.');
  const resolved = path.resolve(directory);
  const existed = fs.existsSync(resolved);
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error(`Runtime path is not a directory: ${resolved}`);
  if (!existed || enforceExisting) fs.chmodSync(resolved, 0o700);
  return resolved;
}

export function ensurePrivateRuntimeDirectory(directory, { managedRoot = path.join(REPO_ROOT, 'audio') } = {}) {
  if (!directory) throw new Error('A runtime directory path is required.');
  const resolved = path.resolve(directory);
  const normalizedManagedRoot = path.resolve(managedRoot);
  const managedByRepository = resolved === normalizedManagedRoot || resolved.startsWith(`${normalizedManagedRoot}${path.sep}`);
  const existed = fs.existsSync(resolved);
  ensurePrivateDirectory(resolved, { enforceExisting: managedByRepository });
  const mode = fs.statSync(resolved).mode & 0o777;
  if (!managedByRepository && existed && (mode & 0o077) !== 0) {
    throw new Error(`Runtime directory must be a dedicated owner-private directory (0700): ${resolved}`);
  }
  return resolved;
}

export function ensurePrivateFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  fs.chmodSync(filePath, 0o600);
  return true;
}

export function pruneFilesOlderThan({ directory, olderThanMs, now = Date.now(), predicate = () => true } = {}) {
  const retentionMs = Number(olderThanMs);
  if (!directory || !Number.isFinite(retentionMs) || retentionMs <= 0 || !fs.existsSync(directory)) return [];
  const cutoff = Number(now) - retentionMs;
  const removed = [];
  for (const name of fs.readdirSync(directory)) {
    const filePath = path.join(directory, name);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.mtimeMs > cutoff || !predicate({ name, filePath, stat })) continue;
    try {
      fs.unlinkSync(filePath);
      removed.push({ name, filePath, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return removed;
}

export function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function resolvePath(rootDir, value) {
  const candidate = String(value || '');
  return path.isAbsolute(candidate) ? candidate : path.resolve(rootDir, candidate);
}

function hasCompleteLockOwner(value) {
  const pid = Number(value?.pid);
  return Number.isInteger(pid) && pid > 0 && Boolean(cleanText(value?.token));
}

function tryAcquireStaleLockRecoveryGuard(filePath) {
  const guardPath = `${path.resolve(filePath)}.recovery.lock`;
  const owner = {
    pid: process.pid,
    token: crypto.randomUUID(),
    acquiredAt: new Date().toISOString(),
    purpose: 'stale-lock-recovery',
  };
  if (!tryCreateExclusiveJsonLock(guardPath, owner)) return null;
  return { lockPath: guardPath, owner };
}

function releaseJsonLockIfOwned(lock) {
  if (!lock?.lockPath || !lock?.owner?.token) return false;
  const current = readJsonFile(lock.lockPath, {});
  if (current.token !== lock.owner.token) return false;
  try {
    fs.unlinkSync(lock.lockPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function rotateFile(filePath, maxRotatedFiles) {
  if (maxRotatedFiles <= 0) {
    fs.unlinkSync(filePath);
    return;
  }
  const oldest = `${filePath}.${maxRotatedFiles}`;
  if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
  for (let index = maxRotatedFiles - 1; index >= 1; index -= 1) {
    const source = `${filePath}.${index}`;
    if (fs.existsSync(source)) fs.renameSync(source, `${filePath}.${index + 1}`);
  }
  fs.renameSync(filePath, `${filePath}.1`);
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalInteger(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function dedupeTextKey(sourceId, textHash) {
  return `${cleanText(sourceId)}:${cleanText(textHash)}`;
}

function truncate(value, maxLength) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
