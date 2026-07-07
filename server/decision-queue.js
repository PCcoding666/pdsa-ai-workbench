// L4 decision gate — the boundary between machine work and human judgment.
//
// The nightly engine produces candidates, matured scores and alerts; this
// module folds them into ONE short daily queue (JSON + markdown) that a human
// clears in minutes. Every item is explicitly handed to human judgment.
//
// Hard rule: this file must never grow trading capability. No order objects,
// no broker calls, no position mutations. The machine proposes; the human
// disposes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { UNAVAILABLE } from './market-data.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DATA_DIR = process.env.DATA_DIR || path.join(rootDir, 'data');
export const DECISION_QUEUE_DIR = process.env.DECISION_QUEUE_DIR || path.join(DATA_DIR, 'decision-queue');

export const QUEUE_BOUNDARY =
  'Every item below requires human judgment. This system never places orders, never moves money, and a no_candidate day is a valid outcome — not a failure.';

export function buildDecisionQueue({
  asOf = new Date().toISOString().slice(0, 10),
  discoveries = [],
  horizonReports = [],
  alerts = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const items = [];

  for (const discovery of discoveries) {
    for (const row of discovery.shortlist || []) {
      items.push({
        type: 'new_candidate',
        urgency: 'normal',
        handedTo: 'human_judgment',
        domain: discovery.domain,
        ticker: row.ticker,
        rank: row.rank,
        marketCap: row.marketCap,
        flags: (row.flags || []).map((f) => `${f.field}=${f.value}`),
        openQuestions: row.openQuestions || [],
        ask: 'Judge stage ②: is this a real bottleneck carrier? Work the open questions before any decision record.',
      });
    }
    for (const gap of discovery.insufficientData || []) {
      items.push({
        type: 'data_gap',
        urgency: 'low',
        handedTo: 'human_judgment',
        domain: discovery.domain,
        ticker: gap.ticker,
        missing: gap.missing,
        ask: `Verify manually: ${gap.note}`,
      });
    }
    if (discovery.status === 'no_candidate') {
      items.push({
        type: 'no_candidate_note',
        urgency: 'info',
        handedTo: 'human_judgment',
        domain: discovery.domain,
        ask: 'Machine found no qualified candidate in this domain this round. This is a valid outcome; no action required.',
      });
    }
  }

  for (const report of horizonReports) {
    for (const [horizon, score] of Object.entries(report.horizons || {})) {
      if (score.status === 'scored') {
        items.push({
          type: 'horizon_scored',
          urgency: 'normal',
          handedTo: 'human_judgment',
          recordId: report.recordId,
          ticker: score.ticker,
          horizon,
          excessReturn: score.excessReturn,
          tickerReturn: score.tickerReturn,
          benchmarkReturn: score.benchmarkReturn,
          ask: 'Review the matured horizon: was the thesis right, and did the stock pay beyond its benchmark? Record a resolution.',
        });
      } else if (score.status === 'incomplete_prices') {
        items.push({
          type: 'score_incomplete',
          urgency: 'low',
          handedTo: 'human_judgment',
          recordId: report.recordId,
          horizon,
          ask: 'Horizon matured but prices were unavailable; verify the symbols and re-run scoring. Never fill in a guessed return.',
        });
      }
    }
  }

  for (const alert of alerts) {
    items.push({
      type: 'falsifier_review',
      urgency: 'urgent',
      handedTo: 'human_judgment',
      recordId: alert.recordId,
      ticker: alert.ticker,
      reason: alert.reason,
      excessReturn: alert.excessReturn ?? UNAVAILABLE,
      falsifier: alert.falsifier || '',
      ask: 'Underperformance breached the alert threshold. Re-read the frozen falsifier: is it triggered? Holding a broken thesis is the failure mode this system exists to prevent.',
    });
  }

  const urgencyRank = { urgent: 0, normal: 1, low: 2, info: 3 };
  items.sort((a, b) => (urgencyRank[a.urgency] ?? 9) - (urgencyRank[b.urgency] ?? 9));

  return {
    asOf,
    generatedAt,
    boundary: QUEUE_BOUNDARY,
    counts: countBy(items, 'type'),
    urgentCount: items.filter((i) => i.urgency === 'urgent').length,
    items,
  };
}

export function renderDecisionQueueMarkdown(queue) {
  const lines = [
    `# Decision queue — ${queue.asOf}`,
    '',
    `> ${queue.boundary}`,
    '',
    `Generated: ${queue.generatedAt} · Items: ${queue.items.length} · Urgent: ${queue.urgentCount}`,
    '',
  ];

  if (!queue.items.length) {
    lines.push('Nothing requires judgment today.');
    return `${lines.join('\n')}\n`;
  }

  for (const item of queue.items) {
    const head = [item.urgency === 'urgent' ? '🔴' : item.urgency === 'normal' ? '🟡' : 'ℹ️', `**${item.type}**`];
    if (item.ticker) head.push(`\`${item.ticker}\``);
    if (item.domain) head.push(`(${item.domain})`);
    lines.push(`## ${head.join(' ')}`, '');
    if (item.recordId) lines.push(`- Record: \`${item.recordId}\``);
    if (item.horizon) lines.push(`- Horizon: ${item.horizon} · excess ${fmt(item.excessReturn)} (ticker ${fmt(item.tickerReturn)} vs benchmark ${fmt(item.benchmarkReturn)})`);
    if (item.reason) lines.push(`- Reason: ${item.reason}`);
    if (item.falsifier) lines.push(`- Frozen falsifier: ${item.falsifier}`);
    if (item.flags?.length) lines.push(`- Flags: ${item.flags.join(', ')}`);
    if (item.missing?.length) lines.push(`- Missing data: ${item.missing.join(', ')}`);
    lines.push(`- **Ask**: ${item.ask}`, '');
    if (item.openQuestions?.length) {
      lines.push('Open questions:', '');
      for (const q of item.openQuestions) lines.push(`- [${q.kind}] ${q.question}`);
      lines.push('');
    }
  }

  return `${lines.join('\n')}\n`;
}

export function writeDecisionQueue(queue, { dir = DECISION_QUEUE_DIR } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, `${queue.asOf}.json`);
  const mdPath = path.join(dir, `${queue.asOf}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, renderDecisionQueueMarkdown(queue), 'utf8');
  return { jsonPath, mdPath };
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[item[key]] = (counts[item[key]] || 0) + 1;
  return counts;
}

function fmt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return `${(value * 100).toFixed(1)}%`;
  return String(value ?? UNAVAILABLE);
}
