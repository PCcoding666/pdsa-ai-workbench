import assert from 'node:assert/strict';
import test from 'node:test';

import { UNAVAILABLE } from '../server/market-data.js';
import { scoreDecision, scoreDecisionAtHorizons } from '../server/decision-scoring.js';

const baseRecord = {
  id: 'dr:test-1',
  recordedAt: '2026-01-01T00:00:00.000Z',
  ticker: 'TEST',
  benchmark: 'SOXX',
  referencePrice: 100,
  benchmarkPrice: 50,
};

test('scoreDecision computes excess return over the benchmark', () => {
  const score = scoreDecision(baseRecord, {
    asOfPrice: 150,
    asOfBenchmarkPrice: 60,
    asOfDate: '2026-07-01',
  });
  assert.equal(score.tickerReturn, 0.5); // +50%
  assert.equal(score.benchmarkReturn, 0.2); // +20%
  assert.equal(score.excessReturn, 0.3); // alpha = 30 points
  assert.equal(score.daysHeld, 181);
  assert.equal(score.status, 'scored');
});

test('a beat in absolute terms can still be negative alpha', () => {
  // ticker +10%, but the benchmark it committed to did +20% → the thesis added nothing
  const score = scoreDecision(baseRecord, { asOfPrice: 110, asOfBenchmarkPrice: 60, asOfDate: '2026-07-01' });
  assert.equal(score.tickerReturn, 0.1);
  assert.equal(score.benchmarkReturn, 0.2);
  assert.equal(score.excessReturn, -0.1);
});

test('a missing as-of price leaves the score incomplete, not guessed', () => {
  const score = scoreDecision(baseRecord, {
    asOfPrice: UNAVAILABLE,
    asOfBenchmarkPrice: 60,
    asOfDate: '2026-07-01',
  });
  assert.equal(score.tickerReturn, UNAVAILABLE);
  assert.equal(score.excessReturn, UNAVAILABLE);
  assert.equal(score.status, 'incomplete_prices');
});

test('an unavailable stamped reference price cannot be scored', () => {
  const score = scoreDecision({ ...baseRecord, referencePrice: UNAVAILABLE }, {
    asOfPrice: 150,
    asOfBenchmarkPrice: 60,
    asOfDate: '2026-07-01',
  });
  assert.equal(score.excessReturn, UNAVAILABLE);
  assert.equal(score.status, 'incomplete_prices');
});

test('horizon scoring marks future horizons pending and past horizons scored', () => {
  const priceAt = (symbol, dateMs) => {
    const days = (dateMs - Date.parse(baseRecord.recordedAt)) / (24 * 60 * 60 * 1000);
    if (symbol === 'TEST') return 100 + days * 0.5; // strong
    if (symbol === 'SOXX') return 50 + days * 0.1; // weaker benchmark
    return UNAVAILABLE;
  };

  const result = scoreDecisionAtHorizons(baseRecord, priceAt, { asOf: '2026-05-01T00:00:00.000Z' });
  assert.equal(result.horizons.m3.status, 'scored'); // +90d is before as-of
  assert.equal(result.horizons.m6.status, 'pending'); // +180d is after as-of
  assert.equal(result.horizons.m12.status, 'pending');
  assert.ok(result.horizons.m3.excessReturn > 0);
  assert.ok(result.horizons.m6.dueDate);
});
