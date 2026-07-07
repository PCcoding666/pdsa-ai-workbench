#!/usr/bin/env node
// L3 research engine — the 7×24 night shift, designed to be invoked by
// cron/launchd (see docs/deployment/). One invocation = one cycle:
//
//   refresh fact sheets → append entity snapshots → run discovery per domain
//   → score open decisions at matured horizons → detect falsifier-review
//   alerts → write the daily decision queue → push a Bark summary.
//
// The engine ends at the decision GATE. It never trades, never moves money,
// and a no_candidate day is a valid, expected outcome.
//
// All I/O (fact-sheet fetching, price lookup, storage, notification) is
// injectable so the fixture test suite exercises the full cycle without any
// network. The CLI wires live implementations.
//
// Usage:
//   node scripts/research-engine.js --once        # one real cycle
//   node scripts/research-engine.js --dry-run     # full cycle, no writes/notifications

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  UNAVAILABLE,
  getFactSheet,
  fetchPriceSeries,
  closeOnOrBefore,
} from '../server/market-data.js';
import { runDiscovery } from '../server/discovery.js';
import { appendFactSheetSnapshot } from '../server/entity-store.js';
import { getDecisionRecords } from '../server/decision-records.js';
import { scoreDecisionAtHorizons } from '../server/decision-scoring.js';
import { buildDecisionQueue, writeDecisionQueue } from '../server/decision-queue.js';
import { getDefaultSerenityDomainWatchlist } from '../server/serenity-domain-scheduler.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR || path.join(rootDir, 'data');
const UNIVERSE_FILE = process.env.UNIVERSE_FILE || path.join(DATA_DIR, 'universe.json');

// Excess return at or below this at any matured horizon → urgent falsifier review.
// Reviewable default, documented in docs/PROGRESS.md.
export const ALERT_EXCESS_RETURN_THRESHOLD = -0.2;

// Default benchmark when the universe entry does not specify one. SOXX is the
// "obvious semis basket" — the honest counterfactual for AI-supply-chain picks.
export const DEFAULT_BENCHMARK = 'SOXX';

// ---------------------------------------------------------------------------
// Engine core (pure orchestration over injected I/O)
// ---------------------------------------------------------------------------

export async function runResearchEngine({
  universe,
  fetchFactSheet, // async (ticker) => factSheet
  priceAt, // (symbol, dateMs) => number | UNAVAILABLE
  io = {},
  now = new Date().toISOString(),
  dryRun = false,
  alertThreshold = ALERT_EXCESS_RETURN_THRESHOLD,
  discoveryConfig = {},
  log = () => {},
} = {}) {
  if (!Array.isArray(universe) || !universe.length) throw new Error('runResearchEngine requires a non-empty universe');
  if (typeof fetchFactSheet !== 'function') throw new Error('runResearchEngine requires fetchFactSheet');
  if (typeof priceAt !== 'function') throw new Error('runResearchEngine requires priceAt');

  const {
    appendSnapshot = appendFactSheetSnapshot,
    getRecords = getDecisionRecords,
    writeQueue = writeDecisionQueue,
    notify = async () => ({ status: 'skipped', reason: 'no notifier injected' }),
  } = io;

  const asOf = now.slice(0, 10);
  const entries = normalizeUniverse(universe);

  // 1) fact sheets — one failure never aborts the cycle.
  const factSheets = [];
  const fetchFailures = [];
  for (const entry of entries) {
    try {
      const sheet = await fetchFactSheet(entry.ticker);
      if (sheet && sheet.ticker) factSheets.push(sheet);
      else fetchFailures.push({ ticker: entry.ticker, error: 'empty fact sheet' });
    } catch (error) {
      fetchFailures.push({ ticker: entry.ticker, error: error.message });
    }
  }
  log(`fact sheets: ${factSheets.length} fetched, ${fetchFailures.length} failed`);

  // 2) entity memory.
  const snapshots = [];
  if (!dryRun) {
    for (const sheet of factSheets) {
      snapshots.push(appendSnapshot(sheet, { now }));
    }
  }

  // 3) discovery per domain.
  const byDomain = groupBy(entries, (e) => e.domain);
  const discoveries = [];
  for (const [domain, domainEntries] of byDomain) {
    discoveries.push(
      runDiscovery({
        domain,
        universe: domainEntries,
        factSheets,
        config: discoveryConfig[domain] || discoveryConfig.default || {},
        asOf,
      }),
    );
  }

  // 4) score open decisions. Every buy/watch record is monitored (skips are
  // scored too — they feed the selection-skill leg of the scorecard — but only
  // buy/watch can raise urgent alerts).
  const records = getRecords();
  const horizonReports = [];
  const alerts = [];
  for (const record of records) {
    const report = scoreDecisionAtHorizons(record, priceAt, { asOf: now });
    horizonReports.push(report);
    if (!['buy', 'watch'].includes(record.action)) continue;
    const worst = worstMaturedExcess(report);
    if (worst !== null && worst.excessReturn <= alertThreshold) {
      alerts.push({
        recordId: record.id,
        ticker: record.ticker,
        reason: `excess return ${(worst.excessReturn * 100).toFixed(1)}% at ${worst.horizon} breached ${(alertThreshold * 100).toFixed(0)}% threshold`,
        excessReturn: worst.excessReturn,
        falsifier: record.falsifier,
      });
    }
  }

  // 5) the decision gate.
  const queue = buildDecisionQueue({ asOf, generatedAt: now, discoveries, horizonReports, alerts });
  let artifacts = null;
  if (!dryRun) artifacts = writeQueue(queue);

  // 6) notification — summary always, urgent flagged in the title.
  const notifications = [];
  if (!dryRun) {
    const candidateCount = discoveries.reduce((n, d) => n + d.shortlist.length, 0);
    const noCandidateDomains = discoveries.filter((d) => d.status === 'no_candidate').map((d) => d.domain);
    notifications.push(
      await notify({
        title: queue.urgentCount
          ? `⚠️ Research engine: ${queue.urgentCount} falsifier review(s)`
          : `Research engine daily — ${asOf}`,
        body: [
          `candidates: ${candidateCount}`,
          `queue items: ${queue.items.length}`,
          `urgent: ${queue.urgentCount}`,
          noCandidateDomains.length ? `no_candidate: ${noCandidateDomains.join(', ')}` : '',
          `fetch failures: ${fetchFailures.length}`,
        ]
          .filter(Boolean)
          .join(' · '),
        urgent: queue.urgentCount > 0,
      }),
    );
  }

  return {
    asOf,
    generatedAt: now,
    dryRun,
    universeSize: entries.length,
    factSheets: { fetched: factSheets.length, failed: fetchFailures },
    snapshots: snapshots.map((s) => ({ ticker: s.ticker, status: s.status })),
    discoveries,
    horizonReports,
    alerts,
    queue,
    artifacts,
    notifications,
    boundary: queue.boundary,
  };
}

// Worst matured excess return across horizons; null when nothing matured/scored.
function worstMaturedExcess(report) {
  let worst = null;
  for (const [horizon, score] of Object.entries(report.horizons || {})) {
    if (score.status !== 'scored') continue;
    if (typeof score.excessReturn !== 'number') continue;
    if (!worst || score.excessReturn < worst.excessReturn) worst = { horizon, excessReturn: score.excessReturn };
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Universe + live wiring helpers (pure parts exported for tests)
// ---------------------------------------------------------------------------

export function normalizeUniverse(universe) {
  const entries = [];
  const seen = new Set();
  for (const item of Array.isArray(universe) ? universe : []) {
    const ticker = String(typeof item === 'string' ? item : item?.ticker || '').toUpperCase().trim();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    entries.push({
      ticker,
      domain: cleanText(item?.domain) || 'unspecified-domain',
      benchmark: (cleanText(item?.benchmark) || DEFAULT_BENCHMARK).toUpperCase(),
      analystCoverage: Number.isFinite(Number(item?.analystCoverage)) ? Number(item.analystCoverage) : null,
    });
  }
  return entries;
}

// Default universe: the tickers already curated in the 6 Serenity domain maps.
export function buildDefaultUniverse() {
  const universe = [];
  for (const domain of getDefaultSerenityDomainWatchlist()) {
    for (const company of domain.companies || []) {
      if (!company.ticker) continue;
      universe.push({ ticker: company.ticker, domain: domain.title, benchmark: DEFAULT_BENCHMARK });
    }
  }
  return normalizeUniverse(universe);
}

export function loadUniverse({ file = UNIVERSE_FILE } = {}) {
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const normalized = normalizeUniverse(Array.isArray(parsed) ? parsed : parsed.universe);
      if (normalized.length) return { source: file, universe: normalized };
    } catch (error) {
      // fall through to default — a corrupt universe file must not silence the engine
      return { source: 'default_watchlist', universe: buildDefaultUniverse(), warning: `universe file unreadable: ${error.message}` };
    }
  }
  return { source: 'default_watchlist', universe: buildDefaultUniverse() };
}

// Build a priceAt(symbol, dateMs) lookup from prefetched daily series.
export function priceAtFromSeries(seriesBySymbol) {
  return (symbol, dateMs) => {
    const series = seriesBySymbol[String(symbol || '').toUpperCase()] || [];
    const row = closeOnOrBefore(series, dateMs);
    return row ? row.close : UNAVAILABLE;
  };
}

// Minimal Bark notifier. Unconfigured → skipped, never fails the cycle.
export async function sendBarkNotification({ title, body }, env = process.env, fetchImpl = fetch) {
  const base = cleanText(env.BARK_PUSH_URL || (env.BARK_SERVER && env.BARK_KEY ? `${env.BARK_SERVER.replace(/\/$/, '')}/${env.BARK_KEY}` : ''));
  if (!base) return { status: 'skipped', reason: 'Bark not configured (set BARK_PUSH_URL or BARK_SERVER + BARK_KEY)' };
  try {
    const url = `${base.replace(/\/$/, '')}/${encodeURIComponent(title || 'Information Gain')}/${encodeURIComponent(body || '')}`;
    const res = await fetchImpl(url);
    return { status: res.ok ? 'success' : 'failed', httpStatus: res.status };
  } catch (error) {
    return { status: 'failed', error: error.message };
  }
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// CLI (live wiring; not exercised by tests)
// ---------------------------------------------------------------------------

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const once = args.has('--once') || dryRun;
  if (!once) {
    console.log('Usage: node scripts/research-engine.js --once [--dry-run]');
    console.log('Scheduling is cron/launchd\'s job (see docs/deployment/); this process runs one cycle and exits.');
    process.exit(1);
  }

  const { source, universe, warning } = loadUniverse();
  if (warning) console.warn(warning);
  console.log(`universe: ${universe.length} tickers from ${source}${dryRun ? ' (dry run)' : ''}`);

  // Prefetch price series once per symbol (tickers + benchmarks) for scoring.
  const symbols = [...new Set([...universe.map((e) => e.ticker), ...universe.map((e) => e.benchmark)])];
  const seriesBySymbol = {};
  for (const symbol of symbols) {
    try {
      seriesBySymbol[symbol] = await fetchPriceSeries(symbol);
    } catch {
      seriesBySymbol[symbol] = []; // priceAt will answer UNAVAILABLE
    }
  }

  const report = await runResearchEngine({
    universe,
    fetchFactSheet: (ticker) => getFactSheet(ticker),
    priceAt: priceAtFromSeries(seriesBySymbol),
    io: { notify: (payload) => sendBarkNotification(payload) },
    dryRun,
    log: (line) => console.log(line),
  });

  console.log(JSON.stringify({
    asOf: report.asOf,
    dryRun: report.dryRun,
    factSheets: report.factSheets.fetched,
    fetchFailures: report.factSheets.failed.length,
    queueItems: report.queue.items.length,
    urgent: report.queue.urgentCount,
    artifacts: report.artifacts,
    boundary: report.boundary,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
