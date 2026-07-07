import assert from 'node:assert/strict';
import test from 'node:test';

import { UNAVAILABLE, CASH_GENERATIVE } from '../server/market-data.js';
import { runDiscovery, DISCOVERY_DEFAULTS } from '../server/discovery.js';

// Inline fixture fact sheets matching the market-data.js fact-sheet shape.
function sheet(ticker, overrides = {}) {
  return {
    ticker,
    asOf: '2026-06-30',
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
    ...overrides,
  };
}

test('qualified path: survivors are ranked with screens, flags and open questions', () => {
  const result = runDiscovery({
    domain: 'ai-photonics-cpo',
    universe: [{ ticker: 'CLEAN', analystCoverage: 3 }, { ticker: 'FLAGGY', analystCoverage: 4 }],
    factSheets: [
      sheet('CLEAN'),
      sheet('FLAGGY', { shareDilutionYoyPct: 12, evToSales: 9 }), // two flags
    ],
    asOf: '2026-06-30',
  });

  assert.equal(result.status, 'candidates_found');
  assert.equal(result.shortlist.length, 2);
  // fewer flags ranks first
  assert.equal(result.shortlist[0].ticker, 'CLEAN');
  assert.equal(result.shortlist[0].rank, 1);
  assert.equal(result.shortlist[1].ticker, 'FLAGGY');
  assert.equal(result.shortlist[1].flagCount, 2);

  // every survivor carries the standing judgment questions (supplier count, pricing gap, purity)
  for (const row of result.shortlist) {
    const texts = row.openQuestions.map((q) => q.question).join(' | ');
    assert.match(texts, /qualified suppliers/);
    assert.match(texts, /priced in/);
    assert.match(texts, /segment purity/);
  }

  // flags produce follow-up questions and screen provenance is attached
  const flaggy = result.shortlist[1];
  assert.ok(flaggy.openQuestions.some((q) => q.kind === 'flag_follow_up'));
  assert.equal(flaggy.screens.shareDilutionYoyPct.status, 'flag');
  assert.match(flaggy.screens.shareDilutionYoyPct.source, /companyfacts/);
  assert.match(result.boundary, /no_candidate is a valid/);
});

test('no_candidate is returned when everything is eliminated — never a forced pick', () => {
  const result = runDiscovery({
    domain: 'test-domain',
    universe: ['HUGE', 'ILLIQ', 'BURNY', 'PRICED'],
    factSheets: [
      sheet('HUGE', { marketCap: 200_000_000_000 }), // above band
      sheet('ILLIQ', { liquidityAdvUsd: 50_000 }), // below ADV floor
      sheet('BURNY', { cashRunwayQuarters: 1 }), // imminent financing risk
      sheet('PRICED', { evToSales: 45 }), // already priced
    ],
  });
  // COVERED gets eliminated via analyst coverage using per-entry input
  const covered = runDiscovery({
    domain: 'test-domain',
    universe: [{ ticker: 'COVERED', analystCoverage: 35 }],
    factSheets: [sheet('COVERED')],
  });

  assert.equal(covered.status, 'no_candidate');
  assert.equal(covered.shortlist.length, 0);
  assert.equal(covered.eliminated[0].stage, 'quant_pre_screen');
  assert.match(covered.eliminated[0].reasons[0], /analyst coverage 35/);

  assert.equal(result.status, 'no_candidate');
  assert.equal(result.shortlist.length, 0);
  const byTicker = Object.fromEntries(result.eliminated.map((e) => [e.ticker, e]));
  assert.equal(byTicker.HUGE.stage, 'quant_pre_screen');
  assert.match(byTicker.HUGE.reasons[0], /outside band/);
  assert.equal(byTicker.ILLIQ.stage, 'quant_pre_screen');
  assert.equal(byTicker.BURNY.stage, 'hard_disqualifier');
  assert.match(byTicker.BURNY.reasons[0], /financing risk/);
  assert.equal(byTicker.PRICED.stage, 'hard_disqualifier');
  assert.match(byTicker.PRICED.reasons[0], /already prices/);
});

test('unavailable ≠ fail: missing stage-③ data survives as an open question', () => {
  const result = runDiscovery({
    domain: 'test-domain',
    universe: ['GAPPY'],
    factSheets: [
      sheet('GAPPY', {
        cashRunwayQuarters: UNAVAILABLE,
        shareDilutionYoyPct: UNAVAILABLE,
        evToSales: UNAVAILABLE,
        unavailableReasons: {
          cashRunwayQuarters: 'no operating cash flow source data',
          shareDilutionYoyPct: 'no shares-outstanding source data',
          evToSales: 'needs enterpriseValue and positive ttmRevenue',
          segmentPurity: 'companyfacts has no clean segment breakdown',
        },
      }),
    ],
  });

  assert.equal(result.status, 'candidates_found');
  const row = result.shortlist[0];
  assert.equal(row.ticker, 'GAPPY');
  assert.equal(row.screens.cashRunwayQuarters.status, 'unavailable');
  assert.equal(row.screens.evToSales.status, 'unavailable');
  // not eliminated, and each gap is handed to the human as a question
  const gapQuestions = row.openQuestions.filter((q) => q.kind === 'data_gap');
  assert.ok(gapQuestions.some((q) => q.question.includes('cashRunwayQuarters')));
  assert.ok(gapQuestions.some((q) => q.question.includes('evToSales')));
  assert.equal(result.eliminated.length, 0);
});

test('unavailable ≠ silent pass: missing market cap or ADV goes to insufficientData, not the shortlist', () => {
  const result = runDiscovery({
    domain: 'test-domain',
    universe: ['GHOST', 'NOSHEET'],
    factSheets: [
      sheet('GHOST', { marketCap: UNAVAILABLE, liquidityAdvUsd: UNAVAILABLE }),
      // NOSHEET has no fact sheet at all
    ],
  });

  assert.equal(result.status, 'no_candidate');
  assert.equal(result.shortlist.length, 0);
  assert.equal(result.eliminated.length, 0); // NOT killed — handed over
  const byTicker = Object.fromEntries(result.insufficientData.map((e) => [e.ticker, e]));
  assert.deepEqual(byTicker.GHOST.missing.sort(), ['liquidityAdvUsd', 'marketCap']);
  assert.deepEqual(byTicker.NOSHEET.missing, ['factSheet']);
});

test('shortlist is capped and ranking prefers fewer flags, then fewer gaps, then smaller caps', () => {
  const universe = [];
  const factSheets = [];
  for (let i = 0; i < 14; i += 1) {
    const ticker = `T${String(i).padStart(2, '0')}`;
    universe.push({ ticker, analystCoverage: 2 });
    factSheets.push(sheet(ticker, { marketCap: 200_000_000 + i * 50_000_000 }));
  }
  const result = runDiscovery({ domain: 'cap-test', universe, factSheets });

  assert.equal(result.shortlist.length, DISCOVERY_DEFAULTS.maxShortlist);
  assert.equal(result.belowCutoff.length, 4);
  // smallest market cap first when flags/gaps tie
  assert.equal(result.shortlist[0].ticker, 'T00');
  assert.ok(result.shortlist[0].marketCap < result.shortlist[9].marketCap);
});

test('thresholds are configurable without editing code', () => {
  const result = runDiscovery({
    domain: 'cfg-test',
    universe: ['SMALL'],
    factSheets: [sheet('SMALL', { marketCap: 50_000_000 })],
    config: { marketCapMin: 10_000_000 },
  });
  assert.equal(result.status, 'candidates_found');
  assert.equal(result.config.marketCapMin, 10_000_000);
  assert.equal(result.config.marketCapMax, DISCOVERY_DEFAULTS.marketCapMax);
});
