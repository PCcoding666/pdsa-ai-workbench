import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  UNAVAILABLE,
  buildFactSheet,
  parseStooqCsv,
  ttmFromQuarters,
  cashRunwayQuarters,
  shareDilutionYoyPct,
} from '../server/market-data.js';

const fixtureDir = fileURLToPath(new URL('./fixtures/', import.meta.url));
const companyFacts = JSON.parse(fs.readFileSync(`${fixtureDir}sample-companyfacts.json`, 'utf8'));
const priceSeries = parseStooqCsv(fs.readFileSync(`${fixtureDir}sample-prices.csv`, 'utf8'));
const ASOF = '2026-06-30';

test('parseStooqCsv parses and sorts ascending', () => {
  assert.equal(priceSeries.length, 23);
  assert.equal(priceSeries[0].date, '2025-06-30');
  assert.equal(priceSeries[priceSeries.length - 1].date, '2026-06-30');
  assert.equal(priceSeries[priceSeries.length - 1].close, 100);
});

test('buildFactSheet computes every field from source data', () => {
  const sheet = buildFactSheet({ ticker: 'test', companyFacts, priceSeries, asOf: ASOF });

  assert.equal(sheet.ticker, 'TEST');
  assert.equal(sheet.price, 100);
  assert.equal(sheet.sharesOutstanding, 50000000);
  assert.equal(sheet.marketCap, 5000000000);
  assert.equal(sheet.ttmRevenue, 380000000);
  assert.equal(sheet.cash, 120000000);
  assert.equal(sheet.totalDebt, 25000000);
  assert.equal(sheet.enterpriseValue, 4905000000);
  assert.equal(sheet.evToSales, 12.91);
  assert.equal(sheet.liquidityAdvUsd, 100000000);
  assert.equal(sheet.cashRunwayQuarters, 4);
  assert.equal(sheet.shareDilutionYoyPct, 25);
  assert.equal(sheet.pricePerformance.m3, -20);
  assert.equal(sheet.pricePerformance.m6, 25);
  assert.equal(sheet.pricePerformance.m12, 100);
});

test('ttm ignores the annual period and sums only four quarters', () => {
  const ttm = ttmFromQuarters(companyFacts, ['RevenueFromContractWithCustomerExcludingAssessedTax'], { asOf: ASOF });
  assert.equal(ttm.value, 380000000);
  assert.equal(ttm.periods.length, 4);
});

test('cash runway uses quarterly burn; dilution is year-over-year', () => {
  assert.equal(cashRunwayQuarters(companyFacts, { asOf: ASOF }).value, 4);
  assert.equal(shareDilutionYoyPct(companyFacts, { asOf: ASOF }).value, 25);
});

test('segment purity is honestly unavailable from companyfacts', () => {
  const sheet = buildFactSheet({ ticker: 'TEST', companyFacts, priceSeries, asOf: ASOF });
  assert.equal(sheet.segmentPurity, UNAVAILABLE);
  assert.ok(sheet.unavailableReasons.segmentPurity);
});

test('missing source data is marked unavailable, never fabricated', () => {
  const sheet = buildFactSheet({ ticker: 'EMPTY', companyFacts: {}, priceSeries: [], asOf: ASOF });
  for (const field of [
    'price',
    'sharesOutstanding',
    'marketCap',
    'ttmRevenue',
    'cash',
    'totalDebt',
    'enterpriseValue',
    'evToSales',
    'liquidityAdvUsd',
    'cashRunwayQuarters',
    'shareDilutionYoyPct',
  ]) {
    assert.equal(sheet[field], UNAVAILABLE, `${field} should be unavailable`);
  }
  assert.equal(sheet.pricePerformance.m12, UNAVAILABLE);
  assert.ok(Object.keys(sheet.unavailableReasons).length > 0);
});

test('a missing input only voids its dependent fields, not the whole sheet', () => {
  const noDebt = structuredClone(companyFacts);
  delete noDebt.facts['us-gaap'].LongTermDebtNoncurrent;
  delete noDebt.facts['us-gaap'].LongTermDebtCurrent;

  const sheet = buildFactSheet({ ticker: 'TEST', companyFacts: noDebt, priceSeries, asOf: ASOF });
  assert.equal(sheet.totalDebt, UNAVAILABLE);
  assert.equal(sheet.enterpriseValue, UNAVAILABLE);
  assert.equal(sheet.evToSales, UNAVAILABLE);
  // price-derived fields remain available
  assert.equal(sheet.marketCap, 5000000000);
  assert.equal(sheet.price, 100);
});
