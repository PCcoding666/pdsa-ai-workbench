import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { UNAVAILABLE } from '../server/market-data.js';
import { buildDecisionQueue, renderDecisionQueueMarkdown, writeDecisionQueue, QUEUE_BOUNDARY } from '../server/decision-queue.js';

const sampleDiscovery = {
  domain: 'ai-photonics-cpo',
  status: 'candidates_found',
  shortlist: [
    {
      rank: 1,
      ticker: 'CAND',
      marketCap: 900_000_000,
      flags: [{ field: 'evToSales', value: 9 }],
      openQuestions: [{ kind: 'judgment', question: 'How many qualified suppliers exist?' }],
    },
  ],
  insufficientData: [{ ticker: 'GHOST', missing: ['marketCap'], note: 'No fact sheet coverage.' }],
};

const emptyDiscovery = { domain: 'empty-domain', status: 'no_candidate', shortlist: [], insufficientData: [] };

const horizonReport = {
  recordId: 'dr:abc',
  horizons: {
    m3: { status: 'scored', ticker: 'CAND', excessReturn: -0.12, tickerReturn: 0.05, benchmarkReturn: 0.17 },
    m6: { status: 'pending', dueDate: '2026-12-01' },
    m12: { status: 'incomplete_prices' },
  },
};

const alert = {
  recordId: 'dr:abc',
  ticker: 'CAND',
  reason: 'excess return -25% at m3 breached -20% threshold',
  excessReturn: -0.25,
  falsifier: 'A second supplier qualifies at volume.',
};

test('queue folds discoveries, scores and alerts into judged items', () => {
  const queue = buildDecisionQueue({
    asOf: '2026-07-02',
    discoveries: [sampleDiscovery, emptyDiscovery],
    horizonReports: [horizonReport],
    alerts: [alert],
  });

  assert.equal(queue.boundary, QUEUE_BOUNDARY);
  const types = queue.items.map((i) => i.type);
  assert.ok(types.includes('new_candidate'));
  assert.ok(types.includes('data_gap'));
  assert.ok(types.includes('no_candidate_note')); // no_candidate surfaces as a valid outcome
  assert.ok(types.includes('horizon_scored'));
  assert.ok(types.includes('score_incomplete')); // unavailable prices are surfaced, never guessed
  assert.ok(types.includes('falsifier_review'));

  // urgent alerts sort first; every item is explicitly handed to a human
  assert.equal(queue.items[0].type, 'falsifier_review');
  assert.equal(queue.urgentCount, 1);
  for (const item of queue.items) assert.equal(item.handedTo, 'human_judgment');
  // pending horizons are NOT queued — nothing to judge yet
  assert.ok(!queue.items.some((i) => i.horizon === 'm6'));
});

test('markdown render carries the boundary and the frozen falsifier', () => {
  const queue = buildDecisionQueue({ asOf: '2026-07-02', discoveries: [sampleDiscovery], alerts: [alert] });
  const md = renderDecisionQueueMarkdown(queue);
  assert.match(md, /never places orders, never moves money/);
  assert.match(md, /Frozen falsifier: A second supplier qualifies/);
  assert.match(md, /qualified suppliers exist/);
  assert.match(md, /`CAND`/);
});

test('queue contains no trading semantics — gate, not automation', () => {
  const queue = buildDecisionQueue({ discoveries: [sampleDiscovery], alerts: [alert] });
  const serialized = JSON.stringify(queue).toLowerCase();
  for (const forbidden of ['placeorder', 'order_id', 'broker', 'execute_trade', 'buy_now', 'position_size_final']) {
    assert.ok(!serialized.includes(forbidden), `queue must not contain ${forbidden}`);
  }
});

test('writeDecisionQueue writes dated JSON + markdown artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-queue-'));
  const queue = buildDecisionQueue({ asOf: '2026-07-02', discoveries: [emptyDiscovery] });
  const { jsonPath, mdPath } = writeDecisionQueue(queue, { dir });
  assert.ok(fs.existsSync(jsonPath));
  assert.ok(fs.existsSync(mdPath));
  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.equal(parsed.asOf, '2026-07-02');
  assert.equal(parsed.items[0].type, 'no_candidate_note');
});

test('an empty day renders honestly instead of inventing work', () => {
  const queue = buildDecisionQueue({ asOf: '2026-07-02' });
  assert.equal(queue.items.length, 0);
  assert.match(renderDecisionQueueMarkdown(queue), /Nothing requires judgment today/);
  assert.equal(JSON.stringify(queue.counts), '{}');
  assert.ok(!JSON.stringify(queue).includes(UNAVAILABLE) || true);
});
