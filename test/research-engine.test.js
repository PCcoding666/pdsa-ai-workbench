import assert from 'node:assert/strict';
import test from 'node:test';

import { UNAVAILABLE, CASH_GENERATIVE, parseStooqCsv } from '../server/market-data.js';
import {
  runResearchEngine,
  normalizeUniverse,
  buildDefaultUniverse,
  priceAtFromSeries,
  sendBarkNotification,
  ALERT_EXCESS_RETURN_THRESHOLD,
} from '../scripts/research-engine.js';

const NOW = '2026-07-02T06:00:00.000Z';

function fixtureSheet(ticker) {
  return {
    ticker,
    asOf: '2026-07-02',
    price: 20,
    marketCap: 900_000_000,
    liquidityAdvUsd: 5_000_000,
    ttmRevenue: 300_000_000,
    cash: 100_000_000,
    totalDebt: 10_000_000,
    enterpriseValue: 810_000_000,
    evToSales: 2.7,
    cashRunwayQuarters: CASH_GENERATIVE,
    shareDilutionYoyPct: 2,
    segmentPurity: UNAVAILABLE,
    pricePerformance: { m3: 10, m6: 20, m12: 30 },
    unavailableReasons: { segmentPurity: 'companyfacts has no clean segment breakdown' },
  };
}

// One buy recorded 100 days ago → m3 matured. Ticker collapsed, benchmark up →
// deeply negative excess → must trigger a falsifier-review alert.
const losingBuy = {
  id: 'dr:losing',
  recordedAt: '2026-03-24T00:00:00.000Z',
  ticker: 'CAND',
  action: 'buy',
  thesis: 'CAND owns the scarce layer.',
  falsifier: 'A second supplier ships at volume.',
  confidence: 0.7,
  plannedSizePct: 3,
  benchmark: 'SOXX',
  referencePrice: 100,
  benchmarkPrice: 50,
};

// A skip is scored (selection skill) but must never raise an urgent alert.
const losingSkip = { ...losingBuy, id: 'dr:skip', action: 'skip' };

const fixturePriceAt = (symbol) => ({ CAND: 60, SOXX: 60 }[symbol] ?? UNAVAILABLE); // CAND -40%, SOXX +20%

function makeDeps(overrides = {}) {
  const calls = { snapshots: [], queues: [], notifications: [] };
  const deps = {
    universe: [
      { ticker: 'CAND', domain: 'ai-photonics-cpo', benchmark: 'SOXX', analystCoverage: 3 },
      { ticker: 'FAIL', domain: 'ai-photonics-cpo', benchmark: 'SOXX' },
    ],
    fetchFactSheet: async (ticker) => {
      if (ticker === 'FAIL') throw new Error('simulated fetch failure');
      return fixtureSheet(ticker);
    },
    priceAt: fixturePriceAt,
    io: {
      appendSnapshot: (sheet) => {
        calls.snapshots.push(sheet.ticker);
        return { status: 'appended', ticker: sheet.ticker, asOf: sheet.asOf };
      },
      getRecords: () => [losingBuy, losingSkip],
      writeQueue: (queue) => {
        calls.queues.push(queue);
        return { jsonPath: '/tmp/fake.json', mdPath: '/tmp/fake.md' };
      },
      notify: async (payload) => {
        calls.notifications.push(payload);
        return { status: 'success' };
      },
    },
    now: NOW,
    ...overrides,
  };
  return { deps, calls };
}

test('one cycle: fact sheets → snapshots → discovery → scoring → alerts → queue → notify', async () => {
  const { deps, calls } = makeDeps();
  const report = await runResearchEngine(deps);

  // fetch failure recorded, does not abort the cycle
  assert.equal(report.factSheets.fetched, 1);
  assert.deepEqual(report.factSheets.failed[0].ticker, 'FAIL');

  // snapshots appended for fetched sheets only
  assert.deepEqual(calls.snapshots, ['CAND']);

  // discovery ran for the domain; FAIL surfaces as insufficient data, not eliminated
  assert.equal(report.discoveries.length, 1);
  const discovery = report.discoveries[0];
  assert.equal(discovery.domain, 'ai-photonics-cpo');
  assert.equal(discovery.shortlist[0].ticker, 'CAND');
  assert.ok(discovery.insufficientData.some((g) => g.ticker === 'FAIL'));

  // both records scored; only the buy raises the urgent falsifier alert
  assert.equal(report.horizonReports.length, 2);
  assert.equal(report.alerts.length, 1);
  assert.equal(report.alerts[0].recordId, 'dr:losing');
  assert.ok(report.alerts[0].excessReturn <= ALERT_EXCESS_RETURN_THRESHOLD);
  assert.equal(report.alerts[0].falsifier, losingBuy.falsifier);

  // queue written once, urgent item first, boundary intact
  assert.equal(calls.queues.length, 1);
  assert.equal(report.queue.items[0].type, 'falsifier_review');
  assert.match(report.boundary, /never places orders/);

  // one summary notification, flagged urgent
  assert.equal(calls.notifications.length, 1);
  assert.match(calls.notifications[0].title, /falsifier review/);
  assert.equal(calls.notifications[0].urgent, true);
});

test('dry run computes everything but writes and notifies nothing', async () => {
  const { deps, calls } = makeDeps({ dryRun: true });
  const report = await runResearchEngine(deps);

  assert.equal(report.dryRun, true);
  assert.ok(report.discoveries.length); // analysis still happened
  assert.ok(report.alerts.length);
  assert.equal(calls.snapshots.length, 0);
  assert.equal(calls.queues.length, 0);
  assert.equal(calls.notifications.length, 0);
  assert.equal(report.artifacts, null);
});

test('priceAtFromSeries answers from the closest close on or before the date', () => {
  const series = parseStooqCsv('Date,Open,High,Low,Close,Volume\n2026-01-02,10,10,10,10,100\n2026-02-02,12,12,12,12,100');
  const priceAt = priceAtFromSeries({ TEST: series });
  assert.equal(priceAt('TEST', Date.parse('2026-01-15')), 10);
  assert.equal(priceAt('TEST', Date.parse('2026-03-01')), 12);
  assert.equal(priceAt('TEST', Date.parse('2025-12-01')), UNAVAILABLE); // before first row
  assert.equal(priceAt('NOPE', Date.parse('2026-03-01')), UNAVAILABLE); // unknown symbol
});

test('default universe derives from the curated domain maps with benchmarks', () => {
  const universe = buildDefaultUniverse();
  assert.ok(universe.length >= 20);
  for (const entry of universe) {
    assert.ok(entry.ticker);
    assert.ok(entry.domain && entry.domain !== 'unspecified-domain');
    assert.equal(entry.benchmark, 'SOXX');
  }
  // duplicates collapse (VRT appears in two domain maps)
  const tickers = universe.map((e) => e.ticker);
  assert.equal(tickers.length, new Set(tickers).size);
});

test('normalizeUniverse dedupes and defaults benchmark', () => {
  const entries = normalizeUniverse(['aaoi', { ticker: 'AAOI' }, { ticker: 'sive', domain: 'photonics', benchmark: 'smh' }]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].benchmark, 'SOXX');
  assert.equal(entries[1].benchmark, 'SMH');
});

test('bark notifier skips honestly when unconfigured and never throws', async () => {
  const skipped = await sendBarkNotification({ title: 't', body: 'b' }, {});
  assert.equal(skipped.status, 'skipped');

  const ok = await sendBarkNotification(
    { title: 't', body: 'b' },
    { BARK_PUSH_URL: 'https://bark.example/key' },
    async () => ({ ok: true, status: 200 }),
  );
  assert.equal(ok.status, 'success');

  const failed = await sendBarkNotification(
    { title: 't', body: 'b' },
    { BARK_PUSH_URL: 'https://bark.example/key' },
    async () => {
      throw new Error('network down');
    },
  );
  assert.equal(failed.status, 'failed');
});
