// L5 calibration scorecard — answers the only question that matters over time:
// did the COGNITION pay, or did the market pay everyone?
//
// Decomposition (each leg isolates one skill):
//   discovery — equal-weight excess of EVERYTHING the machine flagged, buys and
//               skips alike, vs each record's committed benchmark. Tests the
//               funnel, independent of your choices.
//   selection — mean excess of your buys minus mean excess of your skips. If
//               your skips outperform your buys, your judgment subtracts value.
//   sizing    — plannedSizePct-weighted excess of buys minus their equal-weight
//               excess. Negative means your conviction concentrated the wrong
//               names.
//   calibration — Brier score of stated confidence vs human-resolved thesis
//               outcomes. The early, regime-independent signal.
//   2×2       — thesis-correct × stock-paid. Only the verified_edge cell is
//               skill; lucky_beta must never be celebrated.
//
// Thesis correctness is a HUMAN judgment. It arrives as an append-only
// resolution event referencing the frozen record — the record itself is never
// edited. Missing data → unavailable, never guessed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { UNAVAILABLE } from './market-data.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DATA_DIR = process.env.DATA_DIR || path.join(rootDir, 'data');
export const RESOLUTIONS_FILE = process.env.DECISION_RESOLUTIONS_FILE || path.join(DATA_DIR, 'decision-resolutions.jsonl');

// Horizon preference for the scorecard's headline number: the longest matured
// horizon wins (m12 over m6 over m3).
const HORIZON_PREFERENCE = ['m12', 'm6', 'm3'];

// ---------------------------------------------------------------------------
// Resolutions (append-only human verdicts on frozen records)
// ---------------------------------------------------------------------------

export function appendDecisionResolution({ recordId, thesisCorrect, note = '' } = {}, { now = new Date().toISOString() } = {}) {
  const id = String(recordId || '').trim();
  if (!id) throw new Error('Resolution requires recordId');
  if (typeof thesisCorrect !== 'boolean') throw new Error('Resolution requires thesisCorrect as a boolean — "not sure yet" means do not resolve');

  const resolution = { recordId: id, thesisCorrect, note: String(note || '').trim(), resolvedAt: now };
  fs.mkdirSync(path.dirname(RESOLUTIONS_FILE), { recursive: true });
  fs.appendFileSync(RESOLUTIONS_FILE, `${JSON.stringify(resolution)}\n`, 'utf8');
  return resolution;
}

export function getDecisionResolutions({ file = RESOLUTIONS_FILE } = {}) {
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

// The LAST resolution for a record wins (you may re-resolve as facts emerge;
// history is preserved because the file is append-only).
export function latestResolutionByRecord(resolutions) {
  const map = new Map();
  for (const res of resolutions) map.set(res.recordId, res);
  return map;
}

// ---------------------------------------------------------------------------
// Scorecard (pure)
// ---------------------------------------------------------------------------

export function buildScorecard({ records = [], horizonReports = [], resolutions = [] } = {}) {
  const scoreByRecord = new Map();
  for (const report of horizonReports) {
    const best = pickPreferredMaturedScore(report);
    if (best) scoreByRecord.set(report.recordId, best);
  }
  const resolutionByRecord = latestResolutionByRecord(resolutions);

  const rows = records.map((record) => {
    const score = scoreByRecord.get(record.id) || null;
    const resolution = resolutionByRecord.get(record.id) || null;
    return {
      recordId: record.id,
      ticker: record.ticker,
      action: record.action,
      confidence: record.confidence,
      plannedSizePct: record.plannedSizePct ?? null,
      horizon: score?.horizon ?? null,
      excessReturn: typeof score?.excessReturn === 'number' ? score.excessReturn : UNAVAILABLE,
      thesisCorrect: resolution ? resolution.thesisCorrect : UNAVAILABLE,
    };
  });

  const scored = rows.filter((r) => typeof r.excessReturn === 'number');
  const buys = scored.filter((r) => r.action === 'buy');
  const skips = scored.filter((r) => r.action === 'skip');

  // discovery: does the funnel's raw output beat its benchmark at all?
  const discovery = scored.length
    ? { n: scored.length, meanExcess: round(mean(scored.map((r) => r.excessReturn)), 4) }
    : { n: 0, meanExcess: UNAVAILABLE, reason: 'no records with matured scores yet' };

  // selection: your picks vs your passes on the same flagged names.
  let selection;
  if (buys.length && skips.length) {
    const buyMean = mean(buys.map((r) => r.excessReturn));
    const skipMean = mean(skips.map((r) => r.excessReturn));
    selection = {
      buys: buys.length,
      skips: skips.length,
      buyMeanExcess: round(buyMean, 4),
      skipMeanExcess: round(skipMean, 4),
      selectionEdge: round(buyMean - skipMean, 4),
    };
  } else {
    selection = {
      buys: buys.length,
      skips: skips.length,
      selectionEdge: UNAVAILABLE,
      reason: 'needs matured scores on both buys and skips — record skips too, they are half the experiment',
    };
  }

  // sizing: did conviction weighting add anything over equal weight?
  const sizedBuys = buys.filter((r) => typeof r.plannedSizePct === 'number' && r.plannedSizePct > 0);
  let sizing;
  if (sizedBuys.length >= 2) {
    const totalWeight = sizedBuys.reduce((s, r) => s + r.plannedSizePct, 0);
    const weighted = sizedBuys.reduce((s, r) => s + r.excessReturn * r.plannedSizePct, 0) / totalWeight;
    const equal = mean(sizedBuys.map((r) => r.excessReturn));
    sizing = {
      n: sizedBuys.length,
      weightedExcess: round(weighted, 4),
      equalWeightExcess: round(equal, 4),
      sizingEdge: round(weighted - equal, 4),
      excludedForMissingSize: buys.length - sizedBuys.length,
    };
  } else {
    sizing = { n: sizedBuys.length, sizingEdge: UNAVAILABLE, reason: 'needs at least 2 scored buys with plannedSizePct' };
  }

  // calibration: Brier over human-resolved theses (lower is better; 0.25 = coin flip).
  const resolved = rows.filter((r) => typeof r.thesisCorrect === 'boolean' && typeof r.confidence === 'number');
  let calibration;
  if (resolved.length) {
    const brier = mean(resolved.map((r) => (r.confidence - (r.thesisCorrect ? 1 : 0)) ** 2));
    calibration = {
      resolved: resolved.length,
      unresolved: rows.length - resolved.length,
      brierScore: round(brier, 4),
      meanConfidence: round(mean(resolved.map((r) => r.confidence)), 4),
      hitRate: round(resolved.filter((r) => r.thesisCorrect).length / resolved.length, 4),
    };
  } else {
    calibration = { resolved: 0, unresolved: rows.length, brierScore: UNAVAILABLE, reason: 'no human-resolved theses yet' };
  }

  // 2×2: thesis-correct × stock-paid. Needs both a resolution and a matured score.
  const quadrants = { verified_edge: [], right_but_priced_in: [], lucky_beta: [], honest_miss: [] };
  for (const row of rows) {
    if (typeof row.thesisCorrect !== 'boolean' || typeof row.excessReturn !== 'number') continue;
    const paid = row.excessReturn > 0;
    const cell = row.thesisCorrect ? (paid ? 'verified_edge' : 'right_but_priced_in') : paid ? 'lucky_beta' : 'honest_miss';
    quadrants[cell].push(row.ticker);
  }

  // headline alpha summary over scored rows.
  const alpha = scored.length
    ? {
        n: scored.length,
        hitRate: round(scored.filter((r) => r.excessReturn > 0).length / scored.length, 4),
        meanExcess: round(mean(scored.map((r) => r.excessReturn)), 4),
        medianExcess: round(median(scored.map((r) => r.excessReturn)), 4),
      }
    : { n: 0, meanExcess: UNAVAILABLE, reason: 'no matured scored records yet' };

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      records: records.length,
      scored: scored.length,
      pendingScore: records.length - scored.length,
      resolved: calibration.resolved ?? 0,
    },
    discovery,
    selection,
    sizing,
    calibration,
    quadrants: {
      verified_edge: { count: quadrants.verified_edge.length, tickers: quadrants.verified_edge, meaning: 'thesis right AND paid vs benchmark — the only cell that is skill' },
      right_but_priced_in: { count: quadrants.right_but_priced_in.length, tickers: quadrants.right_but_priced_in, meaning: 'right thesis, no alpha — your weakness is pricing, not analysis' },
      lucky_beta: { count: quadrants.lucky_beta.length, tickers: quadrants.lucky_beta, meaning: 'wrong thesis, still paid — luck. Never count as success' },
      honest_miss: { count: quadrants.honest_miss.length, tickers: quadrants.honest_miss, meaning: 'wrong and unpaid — the system caught it; check the falsifier reaction time' },
    },
    alpha,
    caveat:
      'Fewer than ~30 independent decisions, or zero drawdowns lived through, means none of these numbers are conclusive. Calibration stabilizes first; returns last.',
  };
}

function pickPreferredMaturedScore(report) {
  for (const horizon of HORIZON_PREFERENCE) {
    const score = report?.horizons?.[horizon];
    if (score?.status === 'scored' && typeof score.excessReturn === 'number') {
      return { horizon, excessReturn: score.excessReturn };
    }
  }
  return null;
}

function mean(values) {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(value, dp) {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}
