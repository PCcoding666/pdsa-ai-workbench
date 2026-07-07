// Immutable decision records — the spine of the review / calibration loop.
//
// At the moment you commit (or explicitly skip) a thesis, the decision is
// frozen: thesis text, the falsifier that would prove you wrong, your stated
// confidence, and — auto-stamped from the data layer, not typed by you — the
// reference price and the benchmark price. Records are append-only and carry a
// freeze hash so any later edit is detectable. No function edits a frozen
// record; that is the whole point. Without this, every later performance stat
// is just a flattering story written with hindsight.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { UNAVAILABLE } from './market-data.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DATA_DIR = process.env.DATA_DIR || path.join(rootDir, 'data');
export const DECISION_RECORDS_FILE = process.env.DECISION_RECORDS_FILE || path.join(DATA_DIR, 'decision-records.jsonl');

export const DECISION_ACTIONS = ['buy', 'watch', 'skip'];

// Fields that are frozen at decision time and covered by the freeze hash.
const FROZEN_FIELDS = [
  'id',
  'recordedAt',
  'ticker',
  'action',
  'thesis',
  'falsifier',
  'confidence',
  'plannedSizePct',
  'benchmark',
  'referencePrice',
  'benchmarkPrice',
];

// Record a decision. `priceLookup(symbol)` returns a number or `unavailable`;
// it is injected so production wraps the live data layer and tests stub it.
// A price that cannot be fetched is stamped `unavailable` — never fabricated.
export function recordDecision(input = {}, { priceLookup = () => UNAVAILABLE, now = new Date().toISOString() } = {}) {
  const ticker = cleanText(input.ticker).toUpperCase();
  if (!ticker) throw new Error('Decision record requires a ticker');

  const action = cleanText(input.action || 'buy').toLowerCase();
  if (!DECISION_ACTIONS.includes(action)) {
    throw new Error(`Decision action must be one of ${DECISION_ACTIONS.join(', ')}`);
  }

  const thesis = cleanText(input.thesis);
  if (!thesis) throw new Error('Decision record requires a thesis');

  const falsifier = cleanText(input.falsifier);
  if (!falsifier) throw new Error('Decision record requires a falsifier (what would prove this wrong)');

  const confidence = Number(input.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('Decision record requires confidence as a number in [0, 1]');
  }

  const benchmark = cleanText(input.benchmark).toUpperCase();
  if (!benchmark) throw new Error('Decision record requires a benchmark symbol (e.g. SOXX), not SPY by default');

  const plannedSizePct = input.plannedSizePct === undefined || input.plannedSizePct === null
    ? null
    : Number(input.plannedSizePct);
  if (plannedSizePct !== null && (!Number.isFinite(plannedSizePct) || plannedSizePct < 0)) {
    throw new Error('plannedSizePct must be a non-negative number or omitted');
  }

  const record = {
    id: `dr:${crypto.randomUUID()}`,
    recordedAt: now,
    ticker,
    action,
    thesis,
    falsifier,
    confidence,
    plannedSizePct,
    benchmark,
    referencePrice: normalizePrice(priceLookup(ticker)),
    benchmarkPrice: normalizePrice(priceLookup(benchmark)),
  };
  record.freezeHash = computeFreezeHash(record);

  appendRecord(record);
  return record;
}

export function getDecisionRecords({ file = DECISION_RECORDS_FILE } = {}) {
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
    .filter(Boolean);
}

export function getDecisionRecord(id, options = {}) {
  return getDecisionRecords(options).find((record) => record.id === id) || null;
}

// Recompute the freeze hash and compare. Returns false if any frozen field was
// altered after the fact — making hindsight edits detectable.
export function verifyDecisionRecordIntegrity(record) {
  if (!record || typeof record !== 'object') return false;
  return record.freezeHash === computeFreezeHash(record);
}

export function computeFreezeHash(record) {
  const canonical = FROZEN_FIELDS.map((field) => [field, record[field] ?? null]);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function appendRecord(record) {
  fs.mkdirSync(path.dirname(DECISION_RECORDS_FILE), { recursive: true });
  fs.appendFileSync(DECISION_RECORDS_FILE, `${JSON.stringify(record)}\n`, 'utf8');
}

function normalizePrice(value) {
  if (value === UNAVAILABLE || value === null || value === undefined) return UNAVAILABLE;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : UNAVAILABLE;
}

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}
