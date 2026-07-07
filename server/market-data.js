// Market data layer for the Information Gain discovery machine and review loop.
//
// Hard boundary (Serenity rule): every numeric field is either a real value
// computed from source data, or the sentinel `unavailable` with a recorded
// reason. We never fabricate a placeholder number. This is what makes the
// downstream disqualifier screen and the calibration loop trustworthy.
//
// Design: network I/O (SEC EDGAR, price source) is isolated in thin fetch
// wrappers. All extraction and computation is done by pure functions that take
// already-parsed inputs, so tests run on fixtures without touching the network.

export const UNAVAILABLE = 'unavailable';
export const CASH_GENERATIVE = 'cash_generative';

const SEC_USER_AGENT = process.env.SEC_USER_AGENT || 'Information Gain research (contact: set SEC_USER_AGENT)';
const DAY_MS = 24 * 60 * 60 * 1000;

// Revenue concepts in priority order; companies tag revenue under different us-gaap names.
const REVENUE_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'SalesRevenueNet',
];
const CASH_CONCEPTS = [
  'CashAndCashEquivalentsAtCarryingValue',
  'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
];
const OPERATING_CASH_FLOW_CONCEPTS = [
  'NetCashProvidedByUsedInOperatingActivities',
  'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
];
const SHARES_CONCEPTS = ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding'];

// ---------------------------------------------------------------------------
// Pure: SEC companyfacts extraction
// ---------------------------------------------------------------------------

function unavailable(reason) {
  return { value: UNAVAILABLE, reason };
}

function available(value, meta = {}) {
  return { value, ...meta };
}

function getConceptUnits(companyFacts, taxonomy, concept) {
  const node = companyFacts?.facts?.[taxonomy]?.[concept];
  if (!node || !node.units || typeof node.units !== 'object') return null;
  return node.units;
}

// Returns the array of fact entries for the first matching concept in any taxonomy.
function findConceptEntries(companyFacts, concepts, { taxonomies = ['us-gaap', 'dei'], unit } = {}) {
  for (const concept of concepts) {
    for (const taxonomy of taxonomies) {
      const units = getConceptUnits(companyFacts, taxonomy, concept);
      if (!units) continue;
      const unitKey = unit || Object.keys(units)[0];
      const entries = units[unitKey];
      if (Array.isArray(entries) && entries.length) {
        return { concept, taxonomy, unit: unitKey, entries };
      }
    }
  }
  return null;
}

function isInstantEntry(entry) {
  return entry && entry.end && !entry.start;
}

function durationDays(entry) {
  if (!entry?.start || !entry?.end) return null;
  return Math.round((Date.parse(entry.end) - Date.parse(entry.start)) / DAY_MS);
}

function isQuarterlyDuration(entry) {
  const days = durationDays(entry);
  return days !== null && days >= 80 && days <= 100;
}

// Latest instant value (e.g. shares, cash, debt) at or before asOf.
export function latestInstant(companyFacts, concepts, { asOf } = {}) {
  const found = findConceptEntries(companyFacts, concepts);
  if (!found) return unavailable(`no source data for ${concepts[0]}`);
  const cutoff = asOf ? Date.parse(asOf) : Infinity;
  const candidates = found.entries
    .filter((e) => isInstantEntry(e) && Date.parse(e.end) <= cutoff && Number.isFinite(Number(e.val)))
    .sort((a, b) => Date.parse(b.end) - Date.parse(a.end));
  if (!candidates.length) return unavailable(`no dated values for ${found.concept}`);
  return available(Number(candidates[0].val), { asOf: candidates[0].end, concept: found.concept });
}

// Trailing-twelve-month sum of the four most recent distinct quarterly periods.
export function ttmFromQuarters(companyFacts, concepts, { asOf } = {}) {
  const found = findConceptEntries(companyFacts, concepts);
  if (!found) return unavailable(`no source data for ${concepts[0]}`);
  const cutoff = asOf ? Date.parse(asOf) : Infinity;
  const byEnd = new Map();
  for (const entry of found.entries) {
    if (!isQuarterlyDuration(entry)) continue;
    if (Date.parse(entry.end) > cutoff) continue;
    if (!Number.isFinite(Number(entry.val))) continue;
    // Prefer 10-Q/10-K reported figures over restatements when the period end collides.
    const existing = byEnd.get(entry.end);
    if (!existing || formRank(entry.form) >= formRank(existing.form)) byEnd.set(entry.end, entry);
  }
  const quarters = [...byEnd.values()].sort((a, b) => Date.parse(b.end) - Date.parse(a.end)).slice(0, 4);
  if (quarters.length < 4) return unavailable(`fewer than 4 quarterly periods for ${found.concept}`);
  const sum = quarters.reduce((acc, q) => acc + Number(q.val), 0);
  return available(sum, { concept: found.concept, periods: quarters.map((q) => q.end) });
}

function formRank(form) {
  if (form === '10-K') return 2;
  if (form === '10-Q') return 2;
  return 1;
}

// Year-over-year share-count change in percent (dilution > 0).
export function shareDilutionYoyPct(companyFacts, { asOf } = {}) {
  const found = findConceptEntries(companyFacts, SHARES_CONCEPTS);
  if (!found) return unavailable('no shares-outstanding source data');
  const cutoff = asOf ? Date.parse(asOf) : Infinity;
  const dated = found.entries
    .filter((e) => e.end && Date.parse(e.end) <= cutoff && Number.isFinite(Number(e.val)))
    .sort((a, b) => Date.parse(b.end) - Date.parse(a.end));
  if (!dated.length) return unavailable('no dated shares values');
  const latest = dated[0];
  const targetPrior = Date.parse(latest.end) - 365 * DAY_MS;
  // Closest prior reading within +/- 45 days of one year before latest.
  let prior = null;
  for (const entry of dated.slice(1)) {
    if (Math.abs(Date.parse(entry.end) - targetPrior) <= 45 * DAY_MS) {
      prior = entry;
      break;
    }
  }
  if (!prior) return unavailable('no ~1-year-prior shares reading for YoY dilution');
  const pct = ((Number(latest.val) - Number(prior.val)) / Number(prior.val)) * 100;
  return available(round(pct, 2), { latest: latest.end, prior: prior.end });
}

// Cash runway in quarters: cash / quarterly operating burn. If operating cash
// flow is positive, the company is not burning — reported as CASH_GENERATIVE.
export function cashRunwayQuarters(companyFacts, { asOf } = {}) {
  const cash = latestInstant(companyFacts, CASH_CONCEPTS, { asOf });
  if (cash.value === UNAVAILABLE) return unavailable('cash unavailable');
  const ocfFound = findConceptEntries(companyFacts, OPERATING_CASH_FLOW_CONCEPTS);
  if (!ocfFound) return unavailable('no operating cash flow source data');
  const cutoff = asOf ? Date.parse(asOf) : Infinity;
  const latestQuarter = ocfFound.entries
    .filter((e) => isQuarterlyDuration(e) && Date.parse(e.end) <= cutoff && Number.isFinite(Number(e.val)))
    .sort((a, b) => Date.parse(b.end) - Date.parse(a.end))[0];
  if (!latestQuarter) return unavailable('no quarterly operating cash flow period');
  const quarterlyOcf = Number(latestQuarter.val);
  if (quarterlyOcf >= 0) return available(CASH_GENERATIVE, { basis: latestQuarter.end });
  const runway = cash.value / Math.abs(quarterlyOcf);
  return available(round(runway, 2), { cash: cash.value, quarterlyBurn: quarterlyOcf, basis: latestQuarter.end });
}

export function totalDebt(companyFacts, { asOf } = {}) {
  const longTermNon = latestInstant(companyFacts, ['LongTermDebtNoncurrent'], { asOf });
  const longTermCur = latestInstant(companyFacts, ['LongTermDebtCurrent'], { asOf });
  if (longTermNon.value !== UNAVAILABLE || longTermCur.value !== UNAVAILABLE) {
    const sum = num(longTermNon.value) + num(longTermCur.value);
    return available(sum, { components: ['LongTermDebtNoncurrent', 'LongTermDebtCurrent'] });
  }
  const single = latestInstant(companyFacts, ['LongTermDebt', 'DebtLongtermAndShorttermCombinedAmount'], { asOf });
  if (single.value !== UNAVAILABLE) return available(single.value, { components: [single.concept] });
  return unavailable('no debt source data');
}

// ---------------------------------------------------------------------------
// Pure: price-series computations
// ---------------------------------------------------------------------------

// Parse a stooq daily CSV: "Date,Open,High,Low,Close,Volume".
export function parseStooqCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase();
  if (!header.includes('date') || !header.includes('close')) return [];
  const rows = [];
  for (const line of lines.slice(1)) {
    const [date, open, high, low, close, volume] = line.split(',');
    if (!date || !close) continue;
    const closeNum = Number(close);
    if (!Number.isFinite(closeNum)) continue;
    rows.push({
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: closeNum,
      volume: Number(volume) || 0,
    });
  }
  return rows.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

function latestRow(series, { asOf } = {}) {
  const cutoff = asOf ? Date.parse(asOf) : Infinity;
  const eligible = series.filter((r) => Date.parse(r.date) <= cutoff);
  return eligible.length ? eligible[eligible.length - 1] : null;
}

export function closeOnOrBefore(series, targetDateMs) {
  let chosen = null;
  for (const row of series) {
    if (Date.parse(row.date) <= targetDateMs) chosen = row;
    else break;
  }
  return chosen;
}

export function latestClose(series, { asOf } = {}) {
  const row = latestRow(series, { asOf });
  if (!row) return unavailable('no price rows at or before asOf');
  return available(row.close, { asOf: row.date });
}

// Average daily traded value (close * volume) over the most recent `days` rows.
export function averageDailyTradedValue(series, { asOf, days = 20, minRows = 5 } = {}) {
  const cutoff = asOf ? Date.parse(asOf) : Infinity;
  const eligible = series.filter((r) => Date.parse(r.date) <= cutoff);
  const recent = eligible.slice(-days);
  if (recent.length < minRows) return unavailable(`fewer than ${minRows} price rows for ADV`);
  const sum = recent.reduce((acc, r) => acc + r.close * r.volume, 0);
  return available(round(sum / recent.length, 2), { rows: recent.length });
}

// Price performance over a calendar lookback (days), e.g. 90/180/365.
export function pricePerformancePct(series, { asOf, lookbackDays } = {}) {
  const current = latestRow(series, { asOf });
  if (!current) return unavailable('no current price');
  const past = closeOnOrBefore(series, Date.parse(current.date) - lookbackDays * DAY_MS);
  if (!past) return unavailable(`no price ~${lookbackDays}d before ${current.date}`);
  const pct = ((current.close - past.close) / past.close) * 100;
  return available(round(pct, 2), { from: past.date, to: current.date });
}

// ---------------------------------------------------------------------------
// Pure: assemble the fact sheet
// ---------------------------------------------------------------------------

export function buildFactSheet({ ticker, companyFacts = {}, priceSeries = [], asOf = isoDate(new Date()) } = {}) {
  const reasons = {};
  const mark = (field, result) => {
    if (result.value === UNAVAILABLE) reasons[field] = result.reason;
    return result.value;
  };

  const shares = latestInstant(companyFacts, SHARES_CONCEPTS, { asOf });
  const close = latestClose(priceSeries, { asOf });
  const ttmRevenue = ttmFromQuarters(companyFacts, REVENUE_CONCEPTS, { asOf });
  const cash = latestInstant(companyFacts, CASH_CONCEPTS, { asOf });
  const debt = totalDebt(companyFacts, { asOf });
  const adv = averageDailyTradedValue(priceSeries, { asOf });
  const runway = cashRunwayQuarters(companyFacts, { asOf });
  const dilution = shareDilutionYoyPct(companyFacts, { asOf });

  const price = mark('price', close);
  const sharesOutstanding = mark('sharesOutstanding', shares);
  const ttmRevenueVal = mark('ttmRevenue', ttmRevenue);
  const cashVal = mark('cash', cash);
  const debtVal = mark('totalDebt', debt);

  // Derived: market cap = price * shares.
  let marketCap = UNAVAILABLE;
  if (isNum(price) && isNum(sharesOutstanding)) marketCap = round(price * sharesOutstanding, 2);
  else reasons.marketCap = 'needs price and sharesOutstanding';

  // Derived: enterprise value = market cap + total debt - cash.
  let enterpriseValue = UNAVAILABLE;
  if (isNum(marketCap) && isNum(debtVal) && isNum(cashVal)) {
    enterpriseValue = round(marketCap + debtVal - cashVal, 2);
  } else reasons.enterpriseValue = 'needs marketCap, totalDebt and cash';

  // Derived: EV / TTM sales.
  let evToSales = UNAVAILABLE;
  if (isNum(enterpriseValue) && isNum(ttmRevenueVal) && ttmRevenueVal > 0) {
    evToSales = round(enterpriseValue / ttmRevenueVal, 2);
  } else reasons.evToSales = 'needs enterpriseValue and positive ttmRevenue';

  return {
    ticker: String(ticker || '').toUpperCase(),
    asOf,
    currency: 'USD',
    price,
    sharesOutstanding,
    marketCap,
    liquidityAdvUsd: mark('liquidityAdvUsd', adv),
    ttmRevenue: ttmRevenueVal,
    cash: cashVal,
    totalDebt: debtVal,
    enterpriseValue,
    evToSales,
    cashRunwayQuarters: mark('cashRunwayQuarters', runway),
    shareDilutionYoyPct: mark('shareDilutionYoyPct', dilution),
    // companyfacts does not expose clean segment breakdowns; honestly unavailable
    // from this source. A dedicated segment source is required to fill it.
    segmentPurity: UNAVAILABLE,
    pricePerformance: {
      m3: mark('pricePerformance.m3', pricePerformancePct(priceSeries, { asOf, lookbackDays: 90 })),
      m6: mark('pricePerformance.m6', pricePerformancePct(priceSeries, { asOf, lookbackDays: 180 })),
      m12: mark('pricePerformance.m12', pricePerformancePct(priceSeries, { asOf, lookbackDays: 365 })),
    },
    unavailableReasons: { ...reasons, segmentPurity: 'companyfacts has no clean segment breakdown' },
  };
}

// ---------------------------------------------------------------------------
// I/O wrappers (live network). Not exercised by the fixture test suite.
// `fetchImpl` is injectable so callers / tests can stub it.
// ---------------------------------------------------------------------------

export async function fetchTickerToCik(ticker, { fetchImpl = fetch } = {}) {
  const symbol = String(ticker || '').toUpperCase();
  const res = await fetchImpl('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': SEC_USER_AGENT },
  });
  if (!res.ok) throw new Error(`SEC ticker map HTTP ${res.status}`);
  const map = await res.json();
  for (const row of Object.values(map)) {
    if (String(row.ticker).toUpperCase() === symbol) {
      return String(row.cik_str).padStart(10, '0');
    }
  }
  return null;
}

export async function fetchCompanyFacts(cik, { fetchImpl = fetch } = {}) {
  const padded = String(cik).padStart(10, '0');
  const res = await fetchImpl(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`, {
    headers: { 'User-Agent': SEC_USER_AGENT },
  });
  if (!res.ok) throw new Error(`SEC companyfacts HTTP ${res.status}`);
  return res.json();
}

export async function fetchPriceSeries(ticker, { fetchImpl = fetch } = {}) {
  const symbol = String(ticker || '').toLowerCase();
  const res = await fetchImpl(`https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}.us&i=d`);
  if (!res.ok) throw new Error(`stooq price HTTP ${res.status}`);
  return parseStooqCsv(await res.text());
}

// Orchestrator for live use. Any leg that fails leaves its fields unavailable
// rather than aborting the whole fact sheet.
export async function getFactSheet(ticker, { fetchImpl = fetch, asOf } = {}) {
  let companyFacts = {};
  let priceSeries = [];
  try {
    const cik = await fetchTickerToCik(ticker, { fetchImpl });
    if (cik) companyFacts = await fetchCompanyFacts(cik, { fetchImpl });
  } catch {
    // leave companyFacts empty → fundamental fields report unavailable
  }
  try {
    priceSeries = await fetchPriceSeries(ticker, { fetchImpl });
  } catch {
    // leave priceSeries empty → price fields report unavailable
  }
  return buildFactSheet({ ticker, companyFacts, priceSeries, asOf });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function num(value) {
  return isNum(value) ? value : 0;
}

function round(value, dp) {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}
