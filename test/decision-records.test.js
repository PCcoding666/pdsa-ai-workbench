import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { UNAVAILABLE } from '../server/market-data.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-decision-records-'));
process.env.DECISION_RECORDS_FILE = path.join(tempRoot, 'decision-records.jsonl');

const records = await import(`../server/decision-records.js?test=${Date.now()}`);

const priceLookup = (symbol) => ({ TEST: 100, SOXX: 200 })[symbol] ?? UNAVAILABLE;

const validDecision = {
  ticker: 'test',
  action: 'buy',
  thesis: 'TEST is the scarce listed carrier of the external-laser bottleneck.',
  falsifier: 'A second qualified laser supplier ships at volume within two quarters.',
  confidence: 0.6,
  plannedSizePct: 3,
  benchmark: 'SOXX',
};

test('recordDecision stamps reference and benchmark prices at decision time', () => {
  const record = records.recordDecision(validDecision, { priceLookup, now: '2026-06-23T00:00:00.000Z' });
  assert.match(record.id, /^dr:/);
  assert.equal(record.ticker, 'TEST');
  assert.equal(record.referencePrice, 100);
  assert.equal(record.benchmarkPrice, 200);
  assert.ok(record.freezeHash);
  assert.equal(records.getDecisionRecord(record.id).thesis, validDecision.thesis);
});

test('freeze hash makes any later edit detectable', () => {
  const record = records.recordDecision(validDecision, { priceLookup });
  assert.equal(records.verifyDecisionRecordIntegrity(record), true);

  const tampered = { ...record, thesis: 'Rewritten with hindsight after the stock moved.' };
  assert.equal(records.verifyDecisionRecordIntegrity(tampered), false);

  const tamperedPrice = { ...record, referencePrice: 1 };
  assert.equal(records.verifyDecisionRecordIntegrity(tamperedPrice), false);
});

test('records are append-only; new decisions never overwrite old ones', () => {
  const before = records.getDecisionRecords().length;
  const first = records.getDecisionRecords()[0];
  records.recordDecision({ ...validDecision, thesis: 'A different thesis for the same name.' }, { priceLookup });
  const after = records.getDecisionRecords();
  assert.equal(after.length, before + 1);
  // the original first record is byte-for-byte unchanged
  assert.deepEqual(after[0], first);
  // the module exposes no mutator for frozen records
  assert.equal(records.updateDecisionRecord, undefined);
  assert.equal(records.editDecisionRecord, undefined);
});

test('a price that cannot be fetched is stamped unavailable, never fabricated', () => {
  const record = records.recordDecision(
    { ...validDecision, ticker: 'NOPX', benchmark: 'SOXX' },
    { priceLookup },
  );
  assert.equal(record.referencePrice, UNAVAILABLE);
  assert.equal(record.benchmarkPrice, 200);
  assert.equal(records.verifyDecisionRecordIntegrity(record), true);
});

test('decision discipline is enforced at record time', () => {
  assert.throws(() => records.recordDecision({ ...validDecision, thesis: '' }, { priceLookup }), /thesis/);
  assert.throws(() => records.recordDecision({ ...validDecision, falsifier: '' }, { priceLookup }), /falsifier/);
  assert.throws(() => records.recordDecision({ ...validDecision, confidence: 5 }, { priceLookup }), /confidence/);
  assert.throws(() => records.recordDecision({ ...validDecision, benchmark: '' }, { priceLookup }), /benchmark/);
  assert.throws(() => records.recordDecision({ ...validDecision, ticker: '' }, { priceLookup }), /ticker/);
});
