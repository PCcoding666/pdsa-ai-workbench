// L1 discovery funnel — turns a domain universe + verified fact sheets into a
// ranked shortlist (or an explicit no_candidate).
//
// Stages implemented here (see docs/discovery-machine.md):
//   ① quant pre-screen  — market-cap band, ADV liquidity, analyst coverage
//   ③ hard-disqualifier — cash runway, dilution, EV/Sales → pass | flag | fail
//   ④ open questions    — every survivor carries the judgment questions the
//                         machine cannot answer (supplier count, pricing gap,
//                         segment purity) plus one question per missing field.
// Stage ② (bottleneck → carrier mapping) and ⑤ (sizing/trade) are human/LLM
// judgment by design and are NOT automated here.
//
// Hard rules:
// - unavailable ≠ fail: a missing field never eliminates a name and never
//   silently passes it. Missing stage-③ data becomes an open question. Missing
//   stage-① identity data (market cap / ADV) moves the name to an explicit
//   `insufficientData` bucket — not killed, not shortlisted, handed to a human.
// - The funnel must be willing to return status `no_candidate`.

import { UNAVAILABLE, CASH_GENERATIVE } from './market-data.js';

// Reviewable defaults. Band/ADV/coverage align with the serenity domain
// run_config already in the repo; the rest are documented in docs/PROGRESS.md.
export const DISCOVERY_DEFAULTS = {
  marketCapMin: 100_000_000,
  marketCapMax: 75_000_000_000,
  minAdvUsd: 1_000_000,
  maxAnalystCoverage: 20,
  cashRunwayFailQuarters: 2, // < 2 quarters runway → imminent financing risk
  cashRunwayFlagQuarters: 6, // 2–6 quarters → survives but flagged
  dilutionFlagPct: 5, // YoY share growth above this → flag
  dilutionFailPct: 20, // above this → fail
  evToSalesFlagX: 6, // above this → flag (rich vs. history of small caps)
  evToSalesFailX: 20, // above this → fail (likely already priced)
  maxShortlist: 10,
};

const FIELD_SOURCES = {
  marketCap: 'computed: stooq close × EDGAR shares outstanding',
  liquidityAdvUsd: 'stooq daily close × volume (20d avg)',
  analystCoverage: 'external universe input (not available from EDGAR/stooq)',
  cashRunwayQuarters: 'SEC EDGAR companyfacts (cash / quarterly operating burn)',
  shareDilutionYoyPct: 'SEC EDGAR companyfacts (shares outstanding YoY)',
  evToSales: 'computed: (marketCap + debt − cash) / TTM revenue (EDGAR + stooq)',
};

// Judgment questions the machine must always hand to a human — these are the
// irreducible Serenity layers (supplier scarcity, pricing gap, purity).
const STANDING_JUDGMENT_QUESTIONS = [
  {
    kind: 'judgment',
    question: 'How many qualified suppliers exist for the claimed bottleneck layer, and how slow is qualification/expansion?',
    why: 'Supplier count and qualification barriers are the load-bearing Serenity claim; no free data source proves them.',
  },
  {
    kind: 'judgment',
    question: 'What is already priced in? Compare expectations (consensus, guidance, narrative saturation) against the thesis.',
    why: 'Good industry and good company do not imply a good stock; the pricing gap is a human/LLM judgment.',
  },
  {
    kind: 'data_gap',
    question: 'Verify segment purity from the 10-K segment notes: how much revenue actually touches the bottleneck layer?',
    why: 'companyfacts has no clean segment breakdown, so purity cannot be computed here.',
  },
];

export function runDiscovery({
  domain = 'unspecified-domain',
  universe = [],
  factSheets = [],
  config = {},
  asOf = new Date().toISOString().slice(0, 10),
} = {}) {
  const cfg = { ...DISCOVERY_DEFAULTS, ...config };
  const sheetsByTicker = indexFactSheets(factSheets);
  const entries = normalizeUniverse(universe);

  const eliminated = [];
  const insufficientData = [];
  const survivors = [];

  for (const entry of entries) {
    const sheet = sheetsByTicker.get(entry.ticker);
    if (!sheet) {
      insufficientData.push({
        ticker: entry.ticker,
        missing: ['factSheet'],
        note: 'No fact sheet was provided for this ticker; cannot verify universe membership.',
      });
      continue;
    }

    // ① quant pre-screen ---------------------------------------------------
    const stage1 = screenStage1(entry, sheet, cfg);
    if (stage1.insufficient.length) {
      insufficientData.push({
        ticker: entry.ticker,
        missing: stage1.insufficient,
        note: 'Market cap and ADV define universe membership; with them unavailable the name is handed to a human instead of being ranked or dropped.',
      });
      continue;
    }
    if (stage1.eliminations.length) {
      eliminated.push({ ticker: entry.ticker, stage: 'quant_pre_screen', reasons: stage1.eliminations });
      continue;
    }

    // ③ hard-disqualifier screen -------------------------------------------
    const stage3 = screenStage3(sheet, cfg);
    if (stage3.fails.length) {
      eliminated.push({
        ticker: entry.ticker,
        stage: 'hard_disqualifier',
        reasons: stage3.fails.map((f) => `${f.field}: ${f.note}`),
        screens: stage3.screens,
      });
      continue;
    }

    // ④ open questions ------------------------------------------------------
    const openQuestions = [
      ...STANDING_JUDGMENT_QUESTIONS,
      ...stage1.openQuestions,
      ...stage3.openQuestions,
    ];

    survivors.push({
      ticker: entry.ticker,
      domain,
      marketCap: sheet.marketCap,
      liquidityAdvUsd: sheet.liquidityAdvUsd,
      screens: { ...stage1.checks, ...stage3.screens },
      flags: stage3.flags,
      flagCount: stage3.flags.length,
      unavailableCount: openQuestions.filter((q) => q.kind === 'data_gap').length,
      openQuestions,
    });
  }

  const ranked = rankSurvivors(survivors);
  const shortlist = ranked.slice(0, cfg.maxShortlist).map((row, index) => ({ rank: index + 1, ...row }));
  const belowCutoff = ranked.slice(cfg.maxShortlist).map((row) => row.ticker);

  return {
    domain,
    asOf,
    config: cfg,
    universeSize: entries.length,
    status: shortlist.length ? 'candidates_found' : 'no_candidate',
    shortlist,
    belowCutoff,
    eliminated,
    insufficientData,
    boundary:
      'Machine output stops at stage ④. Every shortlisted name still requires human judgment on supplier scarcity, pricing gap and purity. no_candidate is a valid, expected outcome. This is not investment advice and nothing here trades.',
  };
}

// ---------------------------------------------------------------------------
// stage ①: quant pre-screen
// ---------------------------------------------------------------------------

function screenStage1(entry, sheet, cfg) {
  const eliminations = [];
  const insufficient = [];
  const openQuestions = [];
  const checks = {};

  // Market cap band — identity-level: unavailable → insufficient data bucket.
  if (isNum(sheet.marketCap)) {
    const inBand = sheet.marketCap >= cfg.marketCapMin && sheet.marketCap <= cfg.marketCapMax;
    checks.marketCap = check('marketCap', sheet.marketCap, inBand ? 'pass' : 'fail', `band ${cfg.marketCapMin}–${cfg.marketCapMax}`, inBand ? 'within configured band' : 'outside configured market-cap band');
    if (!inBand) eliminations.push(`marketCap ${sheet.marketCap} outside band ${cfg.marketCapMin}–${cfg.marketCapMax}`);
  } else {
    insufficient.push('marketCap');
  }

  // Liquidity — identity-level: unavailable → insufficient data bucket.
  if (isNum(sheet.liquidityAdvUsd)) {
    const liquid = sheet.liquidityAdvUsd >= cfg.minAdvUsd;
    checks.liquidityAdvUsd = check('liquidityAdvUsd', sheet.liquidityAdvUsd, liquid ? 'pass' : 'fail', `min ${cfg.minAdvUsd}`, liquid ? 'meets minimum ADV' : 'below minimum average daily traded value');
    if (!liquid) eliminations.push(`ADV ${sheet.liquidityAdvUsd} below minimum ${cfg.minAdvUsd}`);
  } else {
    insufficient.push('liquidityAdvUsd');
  }

  // Analyst coverage — externally sourced; commonly unavailable → open question.
  if (isNum(entry.analystCoverage)) {
    const underCovered = entry.analystCoverage <= cfg.maxAnalystCoverage;
    checks.analystCoverage = check('analystCoverage', entry.analystCoverage, underCovered ? 'pass' : 'fail', `max ${cfg.maxAnalystCoverage}`, underCovered ? 'under-covered' : 'too widely covered for an information edge');
    if (!underCovered) eliminations.push(`analyst coverage ${entry.analystCoverage} above maximum ${cfg.maxAnalystCoverage}`);
  } else {
    checks.analystCoverage = check('analystCoverage', UNAVAILABLE, 'unavailable', `max ${cfg.maxAnalystCoverage}`, 'no coverage count provided in universe input');
    openQuestions.push({
      kind: 'data_gap',
      question: 'How many sell-side analysts cover this name? (>20 weakens the under-the-radar premise)',
      why: 'Coverage count is not derivable from EDGAR/stooq; it must be supplied or checked manually.',
    });
  }

  return { eliminations, insufficient, openQuestions, checks };
}

// ---------------------------------------------------------------------------
// stage ③: hard-disqualifier screen
// ---------------------------------------------------------------------------

function screenStage3(sheet, cfg) {
  const screens = {};
  const fails = [];
  const flags = [];
  const openQuestions = [];

  const record = (field, result) => {
    screens[field] = result;
    if (result.status === 'fail') fails.push(result);
    if (result.status === 'flag') flags.push(result);
    if (result.status === 'unavailable') {
      openQuestions.push({
        kind: 'data_gap',
        question: `${field} could not be computed (${sheet.unavailableReasons?.[field] || 'no source data'}). Verify manually before judging.`,
        why: 'unavailable ≠ fail: missing data must be resolved by a human, not guessed by the machine.',
      });
    }
  };

  // Cash runway.
  const runway = sheet.cashRunwayQuarters;
  if (runway === CASH_GENERATIVE) {
    record('cashRunwayQuarters', check('cashRunwayQuarters', runway, 'pass', `fail<${cfg.cashRunwayFailQuarters}q flag<${cfg.cashRunwayFlagQuarters}q`, 'operating cash flow is positive'));
  } else if (isNum(runway)) {
    const status = runway < cfg.cashRunwayFailQuarters ? 'fail' : runway < cfg.cashRunwayFlagQuarters ? 'flag' : 'pass';
    record('cashRunwayQuarters', check('cashRunwayQuarters', runway, status, `fail<${cfg.cashRunwayFailQuarters}q flag<${cfg.cashRunwayFlagQuarters}q`,
      status === 'fail' ? 'imminent financing risk at current burn' : status === 'flag' ? 'thin runway; financing terms will matter' : 'sufficient runway'));
  } else {
    record('cashRunwayQuarters', check('cashRunwayQuarters', UNAVAILABLE, 'unavailable', '', ''));
  }

  // Dilution.
  const dilution = sheet.shareDilutionYoyPct;
  if (isNum(dilution)) {
    const status = dilution > cfg.dilutionFailPct ? 'fail' : dilution > cfg.dilutionFlagPct ? 'flag' : 'pass';
    record('shareDilutionYoyPct', check('shareDilutionYoyPct', dilution, status, `fail>${cfg.dilutionFailPct}% flag>${cfg.dilutionFlagPct}%`,
      status === 'fail' ? 'shareholders are being diluted faster than the thesis can pay' : status === 'flag' ? 'meaningful dilution; check financing history' : 'dilution within tolerance'));
  } else {
    record('shareDilutionYoyPct', check('shareDilutionYoyPct', UNAVAILABLE, 'unavailable', '', ''));
  }

  // EV / TTM sales.
  const evToSales = sheet.evToSales;
  if (isNum(evToSales)) {
    const status = evToSales > cfg.evToSalesFailX ? 'fail' : evToSales > cfg.evToSalesFlagX ? 'flag' : 'pass';
    record('evToSales', check('evToSales', evToSales, status, `fail>${cfg.evToSalesFailX}x flag>${cfg.evToSalesFlagX}x`,
      status === 'fail' ? 'valuation likely already prices the theme' : status === 'flag' ? 'rich multiple; pricing-gap judgment is decisive' : 'multiple within band'));
  } else {
    record('evToSales', check('evToSales', UNAVAILABLE, 'unavailable', '', ''));
  }

  // Flags become follow-up questions for the human.
  for (const flag of flags) {
    openQuestions.push({
      kind: 'flag_follow_up',
      question: `${flag.field} = ${flag.value} (${flag.note}). Does this break or merely complicate the thesis?`,
      why: 'Flagged, not fatal: the judgment belongs to a human.',
    });
  }

  return { screens, fails, flags, openQuestions };
}

// ---------------------------------------------------------------------------
// ranking + helpers
// ---------------------------------------------------------------------------

// Fewer flags, then fewer data gaps, then smaller market cap (under-covered
// small caps are the point of the funnel), then ticker for determinism.
function rankSurvivors(survivors) {
  return [...survivors].sort(
    (a, b) =>
      a.flagCount - b.flagCount ||
      a.unavailableCount - b.unavailableCount ||
      numOr(a.marketCap, Infinity) - numOr(b.marketCap, Infinity) ||
      a.ticker.localeCompare(b.ticker),
  );
}

function check(field, value, status, threshold, note) {
  return { field, value, status, threshold, note, source: FIELD_SOURCES[field] || 'unknown source' };
}

function indexFactSheets(factSheets) {
  const map = new Map();
  const list = Array.isArray(factSheets) ? factSheets : Object.values(factSheets || {});
  for (const sheet of list) {
    if (sheet && sheet.ticker) map.set(String(sheet.ticker).toUpperCase(), sheet);
  }
  return map;
}

function normalizeUniverse(universe) {
  const seen = new Set();
  const entries = [];
  for (const item of Array.isArray(universe) ? universe : []) {
    const ticker = String(typeof item === 'string' ? item : item?.ticker || '').toUpperCase().trim();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    const analystCoverage = typeof item === 'object' && item !== null ? Number(item.analystCoverage) : NaN;
    entries.push({ ticker, analystCoverage: Number.isFinite(analystCoverage) ? analystCoverage : null });
  }
  return entries;
}

function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function numOr(value, fallback) {
  return isNum(value) ? value : fallback;
}
