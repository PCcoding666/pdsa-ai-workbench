import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { UNAVAILABLE } from '../server/market-data.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-entity-store-'));
process.env.ENTITY_STORE_FILE = path.join(tempRoot, 'entity-snapshots.jsonl');

const store = await import(`../server/entity-store.js?test=${Date.now()}`);

function factSheet(ticker, asOf, overrides = {}) {
  return {
    ticker,
    asOf,
    marketCap: 1_000_000_000,
    evToSales: 3,
    sharesOutstanding: 40_000_000,
    pricePerformance: { m3: 5, m6: 10, m12: 20 },
    ...overrides,
  };
}

test('snapshots append and read back in asOf order', () => {
  assert.equal(store.appendFactSheetSnapshot(factSheet('TEST', '2026-03-31')).status, 'appended');
  assert.equal(store.appendFactSheetSnapshot(factSheet('TEST', '2026-06-30', { sharesOutstanding: 50_000_000, evToSales: 5 })).status, 'appended');
  assert.equal(store.appendFactSheetSnapshot(factSheet('OTHR', '2026-06-30')).status, 'appended');

  const snaps = store.getEntitySnapshots('TEST');
  assert.equal(snaps.length, 2);
  assert.equal(snaps[0].asOf, '2026-03-31');
  assert.equal(snaps[1].asOf, '2026-06-30');
  assert.equal(store.getLatestEntitySnapshot('TEST').factSheet.sharesOutstanding, 50_000_000);
  assert.deepEqual(store.listEntityTickers(), ['OTHR', 'TEST']);
});

test('same (ticker, asOf) is skipped as duplicate — idempotent for schedulers', () => {
  const before = store.getEntitySnapshots('TEST').length;
  const result = store.appendFactSheetSnapshot(factSheet('TEST', '2026-06-30', { marketCap: 999 }));
  assert.equal(result.status, 'duplicate_skipped');
  assert.equal(store.getEntitySnapshots('TEST').length, before);
  // the original snapshot was not silently replaced
  assert.equal(store.getLatestEntitySnapshot('TEST').factSheet.marketCap, 1_000_000_000);
});

test('trend computes change across snapshots, including dot paths', () => {
  const shares = store.computeEntityTrend('TEST', 'sharesOutstanding');
  assert.equal(shares.status, 'computed');
  assert.equal(shares.first.value, 40_000_000);
  assert.equal(shares.last.value, 50_000_000);
  assert.equal(shares.change, 10_000_000);
  assert.equal(shares.changePct, 25);

  const ev = store.computeEntityTrend('TEST', 'evToSales');
  assert.equal(ev.changePct, 66.67);

  const nested = store.computeEntityTrend('TEST', 'pricePerformance.m12');
  assert.equal(nested.status, 'computed');
  assert.equal(nested.points.length, 2);
});

test('unavailable readings are skipped, not treated as zeros', () => {
  store.appendFactSheetSnapshot(factSheet('GAPY', '2026-03-31', { evToSales: UNAVAILABLE }));
  store.appendFactSheetSnapshot(factSheet('GAPY', '2026-06-30', { evToSales: 4 }));

  const trend = store.computeEntityTrend('GAPY', 'evToSales');
  assert.equal(trend.status, UNAVAILABLE);
  assert.match(trend.reason, /have 1/);
  assert.equal(trend.points.length, 1);
});

test('snapshot validation rejects missing identity fields', () => {
  assert.throws(() => store.appendFactSheetSnapshot({ asOf: '2026-06-30' }), /ticker/);
  assert.throws(() => store.appendFactSheetSnapshot({ ticker: 'X' }), /asOf/);
});
