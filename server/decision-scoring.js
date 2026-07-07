// Scheduled scoring for decision records — the second read of the same data
// layer. A decision stamped its reference and benchmark prices at decision
// time; here we read prices again at an as-of date and compute the holding-
// period return RELATIVE TO THE BENCHMARK. Absolute return is meaningless on
// its own — in a bull market everything goes up. Excess return (alpha over the
// benchmark you committed to) is the only honest measure of whether the thesis
// added anything beyond beta.
//
// Pure and injectable: callers pass already-resolved as-of prices, so the
// scheduled job and the fixture tests share the same code with no network.

import { UNAVAILABLE } from './market-data.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Score one decision at a given as-of point. Any missing price leaves the
// affected leg `unavailable` rather than guessing a return.
export function scoreDecision(record, { asOfPrice, asOfBenchmarkPrice, asOfDate } = {}) {
  if (!record || typeof record !== 'object') throw new Error('scoreDecision requires a decision record');

  const tickerReturn = simpleReturn(record.referencePrice, asOfPrice);
  const benchmarkReturn = simpleReturn(record.benchmarkPrice, asOfBenchmarkPrice);

  let excessReturn = UNAVAILABLE;
  if (isNum(tickerReturn) && isNum(benchmarkReturn)) {
    excessReturn = round(tickerReturn - benchmarkReturn, 4);
  }

  const daysHeld = record.recordedAt && asOfDate
    ? Math.max(0, Math.round((Date.parse(asOfDate) - Date.parse(record.recordedAt)) / DAY_MS))
    : UNAVAILABLE;

  return {
    recordId: record.id || null,
    ticker: record.ticker || null,
    benchmark: record.benchmark || null,
    asOfDate: asOfDate || null,
    daysHeld,
    tickerReturn: isNum(tickerReturn) ? round(tickerReturn, 4) : UNAVAILABLE,
    benchmarkReturn: isNum(benchmarkReturn) ? round(benchmarkReturn, 4) : UNAVAILABLE,
    excessReturn,
    status: excessReturn === UNAVAILABLE ? 'incomplete_prices' : 'scored',
  };
}

// Score a decision at +3 / +6 / +12 month horizons. `priceAt(symbol, dateMs)`
// returns a number or `unavailable`; it is injected so tests pass a fixture
// lookup and production wraps the price series. Horizons in the future relative
// to `asOf` are reported as `pending`.
export function scoreDecisionAtHorizons(record, priceAt, { asOf = new Date().toISOString() } = {}) {
  if (typeof priceAt !== 'function') throw new Error('scoreDecisionAtHorizons requires a priceAt(symbol, dateMs) lookup');
  const recordedMs = Date.parse(record.recordedAt);
  const asOfMs = Date.parse(asOf);
  const horizons = { m3: 90, m6: 180, m12: 365 };
  const result = {};
  for (const [key, days] of Object.entries(horizons)) {
    const horizonMs = recordedMs + days * DAY_MS;
    if (horizonMs > asOfMs) {
      result[key] = { status: 'pending', dueDate: isoDate(horizonMs) };
      continue;
    }
    result[key] = scoreDecision(record, {
      asOfPrice: priceAt(record.ticker, horizonMs),
      asOfBenchmarkPrice: priceAt(record.benchmark, horizonMs),
      asOfDate: isoDate(horizonMs),
    });
  }
  return { recordId: record.id || null, horizons: result };
}

function simpleReturn(from, to) {
  if (from === UNAVAILABLE || to === UNAVAILABLE) return UNAVAILABLE;
  const a = Number(from);
  const b = Number(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) return UNAVAILABLE;
  return (b - a) / a;
}

function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function round(value, dp) {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
