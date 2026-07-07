import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { UNAVAILABLE } from '../server/market-data.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-scorecard-'));
process.env.DECISION_RESOLUTIONS_FILE = path.join(tempRoot, 'decision-resolutions.jsonl');

const scorecard = await import(`../server/scorecard.js?test=${Date.now()}`);

function record(id, action, { confidence = 0.6, plannedSizePct = null, ticker = id.toUpperCase() } = {}) {
  return { id: `dr:${id}`, ticker, action, confidence, plannedSizePct, recordedAt: '2026-01-01T00:00:00.000Z' };
}

function report(id, excess, horizon = 'm3') {
  return { recordId: `dr:${id}`, horizons: { [horizon]: { status: 'scored', excessReturn: excess } } };
}

test('resolutions are append-only human verdicts; the latest wins without edits', () => {
  const first = scorecard.appendDecisionResolution({ recordId: 'dr:a', thesisCorrect: false, note: 'looked wrong at first' });
  assert.equal(first.thesisCorrect, false);
  scorecard.appendDecisionResolution({ recordId: 'dr:a', thesisCorrect: true, note: 'later filings proved the exposure' });

  const all = scorecard.getDecisionResolutions();
  assert.equal(all.length, 2); // history preserved
  assert.equal(scorecard.latestResolutionByRecord(all).get('dr:a').thesisCorrect, true);

  assert.throws(() => scorecard.appendDecisionResolution({ recordId: '', thesisCorrect: true }), /recordId/);
  assert.throws(() => scorecard.appendDecisionResolution({ recordId: 'dr:x', thesisCorrect: 'yes' }), /boolean/);
});

test('scorecard decomposes discovery, selection and sizing legs', () => {
  const records = [
    record('b1', 'buy', { plannedSizePct: 6 }),
    record('b2', 'buy', { plannedSizePct: 2 }),
    record('s1', 'skip'),
    record('s2', 'skip'),
  ];
  const reports = [
    report('b1', 0.3), // big position, big alpha
    report('b2', -0.1),
    report('s1', 0.05),
    report('s2', -0.05),
  ];

  const card = scorecard.buildScorecard({ records, horizonReports: reports });

  // discovery: everything flagged, equal weight → (0.3 - 0.1 + 0.05 - 0.05)/4
  assert.equal(card.discovery.n, 4);
  assert.equal(card.discovery.meanExcess, 0.05);

  // selection: buys mean 0.1 vs skips mean 0 → +0.1 edge
  assert.equal(card.selection.buyMeanExcess, 0.1);
  assert.equal(card.selection.skipMeanExcess, 0);
  assert.equal(card.selection.selectionEdge, 0.1);

  // sizing: weighted (0.3*6 + -0.1*2)/8 = 0.2 vs equal 0.1 → +0.1 — conviction added value
  assert.equal(card.sizing.weightedExcess, 0.2);
  assert.equal(card.sizing.equalWeightExcess, 0.1);
  assert.equal(card.sizing.sizingEdge, 0.1);

  assert.equal(card.alpha.hitRate, 0.5);
  assert.match(card.caveat, /30 independent decisions/);
});

test('calibration computes Brier over resolved theses and the 2×2 assigns quadrants', () => {
  const records = [
    record('edge', 'buy', { confidence: 0.8 }),
    record('priced', 'buy', { confidence: 0.7 }),
    record('lucky', 'buy', { confidence: 0.9 }),
    record('miss', 'buy', { confidence: 0.4 }),
  ];
  const reports = [
    report('edge', 0.25), // thesis right, paid → verified_edge
    report('priced', -0.05), // thesis right, unpaid → right_but_priced_in
    report('lucky', 0.3), // thesis wrong, paid → lucky_beta
    report('miss', -0.2), // thesis wrong, unpaid → honest_miss
  ];
  const resolutions = [
    { recordId: 'dr:edge', thesisCorrect: true },
    { recordId: 'dr:priced', thesisCorrect: true },
    { recordId: 'dr:lucky', thesisCorrect: false },
    { recordId: 'dr:miss', thesisCorrect: false },
  ];

  const card = scorecard.buildScorecard({ records, horizonReports: reports, resolutions });

  assert.equal(card.quadrants.verified_edge.tickers[0], 'EDGE');
  assert.equal(card.quadrants.right_but_priced_in.tickers[0], 'PRICED');
  assert.equal(card.quadrants.lucky_beta.tickers[0], 'LUCKY');
  assert.equal(card.quadrants.honest_miss.tickers[0], 'MISS');
  assert.match(card.quadrants.lucky_beta.meaning, /Never count as success/);

  // Brier: ((0.8-1)^2 + (0.7-1)^2 + (0.9-0)^2 + (0.4-0)^2)/4 = (0.04+0.09+0.81+0.16)/4 = 0.275
  assert.equal(card.calibration.brierScore, 0.275);
  assert.equal(card.calibration.resolved, 4);
  assert.equal(card.calibration.hitRate, 0.5);
});

test('sparse data yields unavailable legs with reasons, never invented numbers', () => {
  const records = [record('only', 'buy', { plannedSizePct: null })];
  const card = scorecard.buildScorecard({
    records,
    horizonReports: [{ recordId: 'dr:only', horizons: { m3: { status: 'pending' } } }],
  });

  assert.equal(card.discovery.meanExcess, UNAVAILABLE);
  assert.equal(card.selection.selectionEdge, UNAVAILABLE);
  assert.match(card.selection.reason, /record skips too/);
  assert.equal(card.sizing.sizingEdge, UNAVAILABLE);
  assert.equal(card.calibration.brierScore, UNAVAILABLE);
  assert.equal(card.alpha.meanExcess, UNAVAILABLE);
  assert.equal(card.totals.pendingScore, 1);
});

test('the longest matured horizon wins the headline number', () => {
  const records = [record('h', 'buy')];
  const reports = [
    {
      recordId: 'dr:h',
      horizons: {
        m3: { status: 'scored', excessReturn: 0.5 },
        m6: { status: 'scored', excessReturn: 0.1 },
        m12: { status: 'pending' },
      },
    },
  ];
  const card = scorecard.buildScorecard({ records, horizonReports: reports });
  // m6 preferred over m3; m12 pending is skipped
  assert.equal(card.discovery.meanExcess, 0.1);
});
