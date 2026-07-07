// L2 entity memory — an append-only time series of fact-sheet snapshots per
// ticker. This is what turns research from isolated leaves into longitudinal
// state: the 50th look at a ticker starts from its history (share count creep,
// EV/Sales re-rating, runway erosion), not from zero.
//
// Storage: one JSONL file, one line per {ticker, asOf} snapshot. Snapshots are
// never edited; a re-run on the same asOf is skipped as a duplicate so a 7×24
// scheduler can call this idempotently every day.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { UNAVAILABLE } from './market-data.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DATA_DIR = process.env.DATA_DIR || path.join(rootDir, 'data');
export const ENTITY_STORE_FILE = process.env.ENTITY_STORE_FILE || path.join(DATA_DIR, 'entity-snapshots.jsonl');

// Append one fact-sheet snapshot. Deduped on (ticker, asOf): calling the
// scheduler twice on the same day must not double-write history.
export function appendFactSheetSnapshot(factSheet, { now = new Date().toISOString() } = {}) {
  const ticker = String(factSheet?.ticker || '').toUpperCase().trim();
  const asOf = String(factSheet?.asOf || '').trim();
  if (!ticker) throw new Error('Snapshot requires factSheet.ticker');
  if (!asOf) throw new Error('Snapshot requires factSheet.asOf');

  const existing = getEntitySnapshots(ticker);
  if (existing.some((snap) => snap.asOf === asOf)) {
    return { status: 'duplicate_skipped', ticker, asOf };
  }

  const snapshot = { ticker, asOf, recordedAt: now, factSheet };
  fs.mkdirSync(path.dirname(ENTITY_STORE_FILE), { recursive: true });
  fs.appendFileSync(ENTITY_STORE_FILE, `${JSON.stringify(snapshot)}\n`, 'utf8');
  return { status: 'appended', ticker, asOf, snapshot };
}

export function getEntitySnapshots(ticker, { file = ENTITY_STORE_FILE } = {}) {
  const symbol = String(ticker || '').toUpperCase().trim();
  return readAllSnapshots(file)
    .filter((snap) => snap.ticker === symbol)
    .sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf));
}

export function getLatestEntitySnapshot(ticker, options = {}) {
  const snapshots = getEntitySnapshots(ticker, options);
  return snapshots.length ? snapshots[snapshots.length - 1] : null;
}

export function listEntityTickers({ file = ENTITY_STORE_FILE } = {}) {
  return [...new Set(readAllSnapshots(file).map((snap) => snap.ticker))].sort();
}

// Trend of one numeric fact-sheet field across snapshots (dot paths allowed,
// e.g. "pricePerformance.m12"). UNAVAILABLE readings are skipped — they are
// honest gaps, not zeros. Fewer than 2 numeric points → trend unavailable.
export function computeEntityTrend(ticker, fieldPath, options = {}) {
  const snapshots = getEntitySnapshots(ticker, options);
  const points = [];
  for (const snap of snapshots) {
    const value = getPath(snap.factSheet, fieldPath);
    if (typeof value === 'number' && Number.isFinite(value)) {
      points.push({ asOf: snap.asOf, value });
    }
  }
  if (points.length < 2) {
    return {
      ticker: String(ticker || '').toUpperCase(),
      field: fieldPath,
      status: UNAVAILABLE,
      reason: `need at least 2 numeric readings, have ${points.length}`,
      points,
    };
  }
  const first = points[0];
  const last = points[points.length - 1];
  const change = round(last.value - first.value, 4);
  const changePct = first.value !== 0 ? round((change / Math.abs(first.value)) * 100, 2) : UNAVAILABLE;
  return {
    ticker: String(ticker || '').toUpperCase(),
    field: fieldPath,
    status: 'computed',
    points,
    first,
    last,
    change,
    changePct,
  };
}

function readAllSnapshots(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((snap) => snap && snap.ticker && snap.asOf);
}

function getPath(obj, fieldPath) {
  return String(fieldPath || '')
    .split('.')
    .reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), obj);
}

function round(value, dp) {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}
