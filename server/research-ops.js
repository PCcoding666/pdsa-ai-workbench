import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const DATA_DIR = process.env.DATA_DIR || path.join(rootDir, 'data');
export const RESEARCH_QUEUE_FILE = path.join(DATA_DIR, 'research-queue.json');
export const RESEARCH_MEMOS_DIR = process.env.RESEARCH_MEMOS_DIR || path.join(DATA_DIR, 'research-memos');
export const RESEARCH_OPS_LOG_FILE = process.env.RESEARCH_OPS_LOG_FILE || path.join(DATA_DIR, 'research-ops-log.jsonl');
export const OBSIDIAN_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || '/Users/chengpeng/Documents/Obsidian Vault';
export const RESEARCH_MEMOS_OBSIDIAN_DIR =
  process.env.RESEARCH_MEMOS_OBSIDIAN_DIR || 'Projects/Information Gain/Research Memos';

export const RESEARCH_QUEUE_STATUSES = ['queued', 'in_progress', 'done', 'blocked'];

const STATUS_TRANSITIONS = {
  queued: ['in_progress', 'blocked'],
  in_progress: ['done', 'blocked', 'queued'],
  blocked: ['queued', 'in_progress'],
  done: ['queued'],
};

const SERENITY_CHAIN = [
  'top-level demand',
  'technology route',
  'necessary dependency',
  'bottleneck',
  'supplier landscape',
  'listed carrier',
  'business purity',
  'financial transmission',
  'market expectations',
  'pricing gap',
  'catalyst',
  'risk',
  'falsifier',
];

export function getResearchQueue() {
  const stored = readJsonFile(RESEARCH_QUEUE_FILE, []);
  return Array.isArray(stored) ? stored : [];
}

export function summarizeResearchQueue(items = getResearchQueue()) {
  const nextItem = selectNextResearchQueueItem(items);
  return {
    byStatus: countBy(items, (item) => item.status || 'queued'),
    byPriority: countBy(items, (item) => `${item.priority || 3}`),
    topTickers: topCounts(items.flatMap((item) => item.tickers || []), 8),
    total: items.length,
    ready: items.filter((item) => (item.status || 'queued') === 'queued').length,
    active: items.filter((item) => item.status === 'in_progress').length,
    blocked: items.filter((item) => item.status === 'blocked').length,
    done: items.filter((item) => item.status === 'done').length,
    nextItem: nextItem ? compactQueueItem(nextItem) : null,
  };
}

export function selectNextResearchQueueItem(items = getResearchQueue()) {
  return [...items]
    .filter((item) => (item.status || 'queued') === 'queued')
    .sort((a, b) => {
      const priorityDiff = clampNumber(a.priority, 1, 99, 3) - clampNumber(b.priority, 1, 99, 3);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    })[0] || null;
}

export function updateResearchQueueItemStatus(itemId, input = {}) {
  const id = cleanText(itemId);
  if (!id) throw new Error('Queue item id is required');

  const status = cleanText(input.status || '');
  if (!RESEARCH_QUEUE_STATUSES.includes(status)) throw new Error(`Unsupported research queue status: ${status}`);

  const items = getResearchQueue();
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) throw new Error(`Research queue item not found: ${id}`);

  const current = items[index];
  const fromStatus = current.status || 'queued';
  if (fromStatus !== status && !canTransitionResearchQueue(fromStatus, status)) {
    throw new Error(`Illegal research queue transition: ${fromStatus} -> ${status}`);
  }

  const now = new Date().toISOString();
  const actor = truncate(cleanText(input.actor || 'codex-research-ops'), 80);
  const reason = truncate(cleanText(input.reason || input.note || ''), 1000);
  const resultSummary = truncate(cleanText(input.resultSummary || input.summary || current.resultSummary || ''), 4000);
  const linkedRunId = truncate(cleanText(input.linkedRunId || input.linked_run_id || current.linkedRunId || ''), 160);
  const discoveredTasks = normalizeDiscoveredTasks(input.discoveredTasks || input.discovered_tasks || []);
  const serenityLoop = resolveSerenityLoopReview(input, current);
  const challengeReview = resolveChallengeReview(input, current);

  const nextItem = {
    ...current,
    status,
    updatedAt: now,
    actor,
    linkedRunId,
    resultSummary,
    notes: truncate(cleanText(input.notes || current.notes || ''), 4000),
    statusHistory: [
      ...(Array.isArray(current.statusHistory) ? current.statusHistory : []),
      {
        from: fromStatus,
        to: status,
        at: now,
        actor,
        reason,
      },
    ].slice(-100),
  };

  if (status === 'in_progress') {
    nextItem.startedAt = current.startedAt || now;
    nextItem.completedAt = '';
    nextItem.blockedAt = '';
    nextItem.blockedReason = '';
  }

  if (status === 'done') {
    if (!resultSummary && !cleanText(input.memo || '')) {
      throw new Error('Completing a research queue item requires resultSummary or memo');
    }
    validateResearchCompletionContract(serenityLoop, challengeReview);
    nextItem.completedAt = now;
    nextItem.blockedAt = '';
    nextItem.blockedReason = '';
  }

  if (status === 'blocked') {
    if (!reason) throw new Error('Blocking a research queue item requires a reason');
    nextItem.blockedAt = now;
    nextItem.blockedReason = reason;
  }

  if (status === 'queued') {
    nextItem.blockedAt = '';
    nextItem.blockedReason = '';
  }

  if (discoveredTasks.length) {
    nextItem.discoveredTasks = [...discoveredTasks, ...(Array.isArray(current.discoveredTasks) ? current.discoveredTasks : [])].slice(0, 50);
  }
  if (hasSerenityLoopReview(serenityLoop)) {
    nextItem.serenityLoop = serenityLoop;
  }
  if (hasChallengeReview(challengeReview)) {
    nextItem.challengeReview = challengeReview;
  }

  const nextItems = [...items];
  nextItems[index] = nextItem;
  writeJsonFile(RESEARCH_QUEUE_FILE, nextItems);
  appendResearchOpsLog({
    type: 'queue_status_changed',
    itemId: id,
    fromStatus,
    toStatus: status,
    actor,
    reason,
    linkedRunId,
    at: now,
  });

  return {
    item: nextItem,
    items: nextItems,
    summary: summarizeResearchQueue(nextItems),
  };
}

export function createResearchQueueItem(input = {}) {
  const question = truncate(cleanText(input.question || input.title || ''), 220);
  if (!question) throw new Error('Research question is required');

  const tickers = uniqueStrings(normalizeStringArray(input.tickers)).slice(0, 12);
  const themes = uniqueStrings(normalizeStringArray(input.themes)).slice(0, 10);
  const now = new Date().toISOString();
  return {
    id:
      input.id ||
      `rq:${crypto.createHash('sha1').update(`${question}:${tickers.join(',')}:${now}`).digest('hex').slice(0, 16)}`,
    status: 'queued',
    priority: clampNumber(input.priority, 1, 5, 3),
    question,
    tickers,
    themes,
    sourceEventId: cleanText(input.sourceEventId || input.source_event_id || ''),
    sourceEvent: null,
    memoSkeleton: buildDefaultMemoSkeleton(question, tickers, themes),
    createdAt: now,
    updatedAt: now,
  };
}

export function addResearchQueueItems(inputs = [], options = {}) {
  const existing = getResearchQueue();
  const newItems = inputs.map((input) => createResearchQueueItem(input));
  const newIds = new Set(newItems.map((item) => item.id));
  const nextItems = [...newItems, ...existing.filter((item) => !newIds.has(item.id))].slice(0, options.limit || 240);
  writeJsonFile(RESEARCH_QUEUE_FILE, nextItems);
  appendResearchOpsLog({
    type: 'queue_items_added',
    count: newItems.length,
    itemIds: newItems.map((item) => item.id),
    actor: cleanText(options.actor || 'codex-research-ops'),
    at: new Date().toISOString(),
  });
  return {
    items: nextItems,
    created: newItems,
    summary: summarizeResearchQueue(nextItems),
  };
}

export function writeResearchQueueMemo(itemId, input = {}) {
  const id = cleanText(itemId);
  const items = getResearchQueue();
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) throw new Error(`Research queue item not found: ${id}`);

  const item = items[index];
  const now = new Date().toISOString();
  const serenityLoop = resolveSerenityLoopReview(input, item);
  const challengeReview = resolveChallengeReview(input, item);
  const memoContent = buildResearchQueueMemo(item, input, now);
  const filename = `${toDateSlug(now)} - ${safeSlug(item.question || item.id).slice(0, 80)} - ${safeSlug(item.id)}.md`;
  const localPath = path.join(RESEARCH_MEMOS_DIR, filename);
  writeTextFile(localPath, memoContent);

  let obsidian = {
    status: 'skipped',
    notePath: '',
    error: '',
  };

  if (input.syncObsidian !== false) {
    const notePath = path.join(RESEARCH_MEMOS_OBSIDIAN_DIR, filename);
    try {
      writeResearchMemoObsidianNote(notePath, memoContent, item.id);
      obsidian = {
        status: 'success',
        notePath,
        error: '',
      };
    } catch (error) {
      obsidian = {
        status: 'failed',
        notePath,
        error: error.message,
      };
    }
  }

  const nextItem = {
    ...item,
    memoPath: localPath,
    obsidianMemoPath: obsidian.notePath || item.obsidianMemoPath || '',
    memoSyncedAt: obsidian.status === 'success' ? now : item.memoSyncedAt || '',
    memoSyncStatus: obsidian.status,
    memoSyncError: obsidian.error,
    updatedAt: now,
  };
  if (hasSerenityLoopReview(serenityLoop)) {
    nextItem.serenityLoop = serenityLoop;
  }
  if (hasChallengeReview(challengeReview)) {
    nextItem.challengeReview = challengeReview;
  }
  const nextItems = [...items];
  nextItems[index] = nextItem;
  writeJsonFile(RESEARCH_QUEUE_FILE, nextItems);
  appendResearchOpsLog({
    type: 'research_memo_written',
    itemId: id,
    localPath,
    obsidian,
    actor: truncate(cleanText(input.actor || 'codex-research-ops'), 80),
    at: now,
  });

  return {
    item: nextItem,
    localPath,
    obsidian,
    summary: summarizeResearchQueue(nextItems),
  };
}

export function claimNextResearchQueueItem(input = {}) {
  const item = selectNextResearchQueueItem();
  if (!item) {
    return {
      item: null,
      status: 'empty',
      summary: summarizeResearchQueue(),
    };
  }

  const result = updateResearchQueueItemStatus(item.id, {
    status: 'in_progress',
    actor: input.actor || 'codex-research-ops',
    reason: input.reason || 'Claimed by research automation.',
  });
  const memo = writeResearchQueueMemo(item.id, {
    actor: input.actor || 'codex-research-ops',
    summary: 'Research automation claimed this item. Evidence collection has not been completed yet.',
    syncObsidian: input.syncObsidian !== false,
  });
  return {
    status: 'claimed',
    item: memo.item,
    memo,
    summary: result.summary,
  };
}

export async function sendBarkNotification(input = {}, env = process.env) {
  const resolved = resolveBarkTarget(env);
  if (!resolved.url) {
    return {
      status: 'skipped',
      reason: 'Bark is not configured. Set BARK_PUSH_URL or BARK_SERVER plus BARK_KEY.',
    };
  }

  const title = truncate(cleanText(input.title || 'Information Gain Research'), 120);
  const body = truncate(cleanText(input.body || input.message || ''), 2000);
  const url = resolved.mode === 'template' ? buildBarkUrl(resolved.url, title, body, input, env) : resolved.url;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(env.BARK_TIMEOUT_MS || 10000));
  try {
    const response = await fetch(url, {
      method: resolved.mode === 'template' ? 'GET' : cleanText(env.BARK_METHOD || 'POST') || 'POST',
      headers: resolved.mode === 'template' ? undefined : { 'content-type': 'application/json' },
      body: resolved.mode === 'template' ? undefined : JSON.stringify({ title, body, group: input.group || 'Information Gain' }),
      signal: controller.signal,
    });
    return {
      status: response.ok ? 'success' : 'failed',
      httpStatus: response.status,
      endpoint: sanitizeBarkEndpoint(url),
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error.message,
      endpoint: sanitizeBarkEndpoint(url),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function appendResearchOpsLog(entry = {}) {
  const row = {
    at: new Date().toISOString(),
    ...entry,
  };
  fs.mkdirSync(path.dirname(RESEARCH_OPS_LOG_FILE), { recursive: true });
  fs.appendFileSync(RESEARCH_OPS_LOG_FILE, `${JSON.stringify(row)}\n`, 'utf8');
  return row;
}

export function readResearchOpsLog(limit = 100) {
  if (!fs.existsSync(RESEARCH_OPS_LOG_FILE)) return [];
  const lines = fs.readFileSync(RESEARCH_OPS_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
  return lines
    .slice(-clampNumber(limit, 1, 1000, 100))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { type: 'invalid_log_line', line };
      }
    })
    .reverse();
}

export function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function canTransitionResearchQueue(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  return (STATUS_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

function buildResearchQueueMemo(item, input = {}, now = new Date().toISOString()) {
  const evidenceRows = normalizeEvidenceRows(input.evidence || input.evidenceLedger || []);
  const counterEvidence = normalizeStringArray(input.counterEvidence || input.counter_evidence || []);
  const falsifiers = normalizeStringArray(input.falsifiers || []);
  const discoveredTasks = normalizeDiscoveredTasks(input.discoveredTasks || input.discovered_tasks || []);
  const summary = cleanText(input.summary || input.resultSummary || item.resultSummary || '');
  const linkedRunId = cleanText(input.linkedRunId || item.linkedRunId || '');
  const serenityLoop = normalizeSerenityLoopReview(input.serenityLoop || input.serenity_loop || item.serenityLoop || input);
  const challengeReview = normalizeChallengeReview(input.challengeReview || input.challenge_review || item.challengeReview || input);

  return [
    '---',
    `title: "${escapeYaml(item.question || item.id)}"`,
    `queue_id: "${escapeYaml(item.id)}"`,
    `status: "${escapeYaml(item.status || 'queued')}"`,
    `priority: ${clampNumber(item.priority, 1, 99, 3)}`,
    `linked_run_id: "${escapeYaml(linkedRunId)}"`,
    `created_at: "${escapeYaml(item.createdAt || '')}"`,
    `updated_at: "${escapeYaml(now)}"`,
    'tickers:',
    ...(item.tickers || []).map((ticker) => `  - "${escapeYaml(ticker)}"`),
    'tags:',
    '  - information-gain',
    '  - research-queue',
    '  - research-memo',
    '---',
    '',
    `# ${item.question || item.id}`,
    '',
    '> Research boundary: this memo is an auditable research record, not investment advice. Seeded or partial work must not be presented as a completed conclusion.',
    '',
    '## Queue Metadata',
    '',
    `- Queue ID: \`${item.id}\``,
    `- Status: \`${item.status || 'queued'}\``,
    `- Priority: ${item.priority || 3}`,
    `- Tickers: ${(item.tickers || []).join(', ') || 'none'}`,
    `- Themes: ${(item.themes || []).join(', ') || 'none'}`,
    `- Linked run: ${linkedRunId || 'not linked'}`,
    '',
    '## Research Question',
    '',
    item.question || 'Not recorded.',
    '',
    '## Current Answer',
    '',
    summary || 'No researched answer recorded yet.',
    '',
    '## Serenity Loop Verdict',
    '',
    ...formatSerenityLoopVerdict(serenityLoop),
    '',
    '## Scarcity Layer Assessment',
    '',
    ...formatSerenityTextBlock(
      serenityLoop.scarcityAssessment,
      'Not recorded. This memo cannot support a candidate upgrade until the scarce layer is explicitly identified or ruled out.'
    ),
    '',
    '## Candidate Mapping',
    '',
    ...formatCandidateMappings(serenityLoop.candidateMappings),
    '',
    '## Demand-to-Ticker Gap',
    '',
    ...formatSerenityTextBlock(
      serenityLoop.demandToTickerGap,
      'Not recorded. The memo has not yet shown how domain demand reaches company-level revenue, margin, cash flow or valuation.'
    ),
    '',
    '## Fatal Gate Review',
    '',
    ...formatFatalGateReview(serenityLoop.fatalGateReview),
    '',
    '## Pricing / Expectation Gap',
    '',
    ...formatSerenityTextBlock(
      serenityLoop.pricingGap,
      'Not recorded. The memo has not yet separated good industry, good company and good stock.'
    ),
    '',
    '## Valuation / Expensive-Cheap Check',
    '',
    ...formatValuationReview(serenityLoop.valuationReview),
    '',
    '## Next Decisive Evidence',
    '',
    ...toBulletLines(
      serenityLoop.nextDecisiveEvidence.length
        ? serenityLoop.nextDecisiveEvidence
        : ['Record the next evidence that would move the loop from demand/route proof to candidate selection or rejection.']
    ),
    '',
    '## Serenity Challenge Agent Review',
    '',
    ...formatChallengeReview(challengeReview),
    '',
    '## Required Evidence',
    '',
    ...toBulletLines(item.memoSkeleton?.requiredEvidence || []),
    '',
    '## Evidence Ledger',
    '',
    ...formatEvidenceRows(evidenceRows),
    '',
    '## Counter Evidence',
    '',
    ...toBulletLines(counterEvidence.length ? counterEvidence : item.memoSkeleton?.counterEvidencePrompts || []),
    '',
    '## Falsifiers',
    '',
    ...toBulletLines(falsifiers.length ? falsifiers : ['Specific falsifiers have not been recorded yet.']),
    '',
    '## Discovered Follow-Up Tasks',
    '',
    ...formatDiscoveredTasks(discoveredTasks),
    '',
    '## Agent Notes',
    '',
    cleanText(input.notes || item.notes || '') || 'No additional notes recorded.',
    '',
  ].join('\n');
}

function writeResearchMemoObsidianNote(notePath, content, queueId) {
  const relativePath = cleanText(notePath);
  const absolutePath = path.resolve(OBSIDIAN_VAULT_PATH, relativePath);
  const allowedRoot = path.resolve(OBSIDIAN_VAULT_PATH, RESEARCH_MEMOS_OBSIDIAN_DIR);
  if (!absolutePath.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error('Obsidian note path escaped the configured research memo directory.');
  }

  if (fs.existsSync(absolutePath)) {
    const existing = fs.readFileSync(absolutePath, 'utf8');
    const existingQueueId = existing.match(/^queue_id:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim() || '';
    if (existingQueueId && existingQueueId !== queueId) {
      throw new Error(`Obsidian conflict: ${relativePath} belongs to ${existingQueueId}.`);
    }
  }

  writeTextFile(absolutePath, content);
}

function writeTextFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${content.trimEnd()}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function buildDefaultMemoSkeleton(question, tickers, themes) {
  return {
    thesis: `Research whether: ${question}`,
    requiredEvidence: [
      'Primary company materials or filings.',
      'Independent source that is not the candidate company.',
      'Scarce layer, supplier-count basis, or explicit no-bottleneck finding.',
      'Candidate mapping from demand to revenue, margin, backlog, cash flow or valuation.',
      'Fatal Gate status with evidence and gaps.',
      'Independent Serenity Challenge Agent review covering chain completeness, omitted layers and upgrade blockers.',
      'Structured valuation sanity check: market cap, enterprise value, P/E or reason P/E is not meaningful, sales multiple, price performance, historical range, consensus or guidance trend, and a cheap/fair/expensive/unknown conclusion.',
      'Counter-evidence or substitution route.',
    ],
    counterEvidencePrompts: [
      'What would make this thesis false?',
      'Is the market already pricing the claim?',
      'Is the business exposure too indirect or too small?',
    ],
    candidateTickers: tickers,
    themes,
  };
}

function normalizeEvidenceRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      source: truncate(cleanText(row.source || row.title || ''), 160),
      url: truncate(cleanText(row.url || row.href || ''), 500),
      sourceType: truncate(cleanText(row.sourceType || row.source_type || row.type || ''), 80),
      sourceFamily: truncate(cleanText(row.sourceFamily || row.source_family || ''), 120),
      allowedUse: truncate(cleanText(row.allowedUse || row.allowed_use || ''), 80),
      claimStatus: truncate(cleanText(row.claimStatus || row.claim_status || row.status || 'unknown'), 80),
      claim: truncate(cleanText(row.claim || row.finding || row.summary || ''), 1000),
      limitations: truncate(cleanText(row.limitations || row.caveat || ''), 1000),
    }))
    .filter((row) => row.source || row.url || row.claim);
}

function formatEvidenceRows(rows) {
  if (!rows.length) {
    return ['- No evidence recorded yet. This memo is an operating scaffold, not a completed research result.'];
  }

  return rows.map((row) => {
    const source = row.url ? `[${row.source || row.url}](${row.url})` : row.source || 'Unrecorded source';
    const meta = [row.sourceType, row.sourceFamily, row.allowedUse, row.claimStatus].filter(Boolean).join(' / ');
    const tail = row.limitations ? ` Limitation: ${row.limitations}` : '';
    return `- ${source}${meta ? ` (${meta})` : ''}: ${row.claim || 'No claim recorded.'}${tail}`;
  });
}

function normalizeDiscoveredTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : [])
    .map((task) => {
      if (typeof task === 'string') {
        return { question: truncate(cleanText(task), 220), priority: 3, tickers: [], themes: [] };
      }
      return {
        question: truncate(cleanText(task.question || task.title || task.task || ''), 220),
        priority: clampNumber(task.priority, 1, 5, 3),
        tickers: uniqueStrings(normalizeStringArray(task.tickers)).slice(0, 12),
        themes: uniqueStrings(normalizeStringArray(task.themes)).slice(0, 10),
      };
    })
    .filter((task) => task.question);
}

function formatDiscoveredTasks(tasks) {
  if (!tasks.length) return ['- None recorded.'];
  return tasks.map((task) => `- P${task.priority}: ${task.question}${task.tickers.length ? ` (${task.tickers.join(', ')})` : ''}`);
}

function normalizeSerenityLoopReview(input = {}) {
  const candidateMappings = normalizeCandidateMappings(
    input.candidateMappings || input.candidate_mappings || input.candidates || []
  );
  const fatalGateReview = normalizeFatalGateReview(
    input.fatalGateReview || input.fatal_gate_review || input.fatalGates || input.fatal_gates || []
  );
  const valuationReview = normalizeValuationReview(
    input.valuationReview || input.valuation_review || input.valuation || input.valuationRows || input.valuation_rows || []
  );

  return {
    loopVerdict: truncate(cleanText(input.loopVerdict || input.loop_verdict || input.verdict || ''), 1000),
    scarcityAssessment: truncate(
      cleanText(input.scarcityAssessment || input.scarcity_assessment || input.scarcityLayer || input.scarcity_layer || ''),
      2000
    ),
    demandToTickerGap: truncate(
      cleanText(input.demandToTickerGap || input.demand_to_ticker_gap || input.financialTransmission || input.financial_transmission || ''),
      2000
    ),
    pricingGap: truncate(cleanText(input.pricingGap || input.pricing_gap || input.expectationGap || input.expectation_gap || ''), 2000),
    candidateConclusion: truncate(
      cleanText(input.candidateConclusion || input.candidate_conclusion || input.tickerConclusion || input.ticker_conclusion || ''),
      2000
    ),
    candidateMappings,
    fatalGateReview,
    valuationReview,
    nextDecisiveEvidence: normalizeStringArray(input.nextDecisiveEvidence || input.next_decisive_evidence || []),
  };
}

function resolveSerenityLoopReview(input = {}, item = {}) {
  const explicit = normalizeSerenityLoopReview(input.serenityLoop || input.serenity_loop || {});
  if (hasSerenityLoopReview(explicit)) return explicit;
  const existing = normalizeSerenityLoopReview(item.serenityLoop || item.serenity_loop || {});
  if (hasSerenityLoopReview(existing)) return existing;
  return normalizeSerenityLoopReview(input);
}

function hasSerenityLoopReview(review = {}) {
  return Boolean(
    cleanText(review.loopVerdict) ||
      cleanText(review.scarcityAssessment) ||
      cleanText(review.demandToTickerGap) ||
      cleanText(review.pricingGap) ||
      cleanText(review.candidateConclusion) ||
      review.candidateMappings?.length ||
      review.fatalGateReview?.length ||
      review.valuationReview?.length ||
      review.nextDecisiveEvidence?.length
  );
}

function validateResearchCompletionContract(serenityLoop, challengeReview) {
  const missing = [
    ...getSerenityLoopCompletionGaps(serenityLoop),
    ...getChallengeReviewCompletionGaps(challengeReview),
  ];
  if (missing.length) {
    throw new Error(`Completing a research queue item requires complete Serenity loop and Challenge Agent review. Missing: ${missing.join(', ')}`);
  }
}

function getSerenityLoopCompletionGaps(review = {}) {
  const missing = [];
  if (!cleanText(review.loopVerdict)) missing.push('serenityLoop.loopVerdict');
  if (!cleanText(review.scarcityAssessment)) missing.push('serenityLoop.scarcityAssessment');
  if (!review.candidateMappings?.length && !cleanText(review.candidateConclusion)) {
    missing.push('serenityLoop.candidateMappings or candidateConclusion');
  }
  if (!cleanText(review.demandToTickerGap)) missing.push('serenityLoop.demandToTickerGap');
  if (!review.fatalGateReview?.length) missing.push('serenityLoop.fatalGateReview');
  if (!cleanText(review.pricingGap)) missing.push('serenityLoop.pricingGap');
  if (review.candidateMappings?.length && !review.valuationReview?.length) {
    missing.push('serenityLoop.valuationReview for mapped candidates');
  }
  if (!review.nextDecisiveEvidence?.length) missing.push('serenityLoop.nextDecisiveEvidence');
  return missing;
}

function normalizeCandidateMappings(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      if (typeof row === 'string') {
        return { ticker: '', role: truncate(cleanText(row), 500), demandLink: '', gap: '', status: 'unknown' };
      }
      return {
        ticker: truncate(cleanText(row.ticker || row.symbol || ''), 40),
        name: truncate(cleanText(row.name || row.company || ''), 120),
        role: truncate(cleanText(row.role || row.layer || row.exposure || ''), 500),
        demandLink: truncate(cleanText(row.demandLink || row.demand_link || row.financialPath || row.financial_path || ''), 1000),
        gap: truncate(cleanText(row.gap || row.missingEvidence || row.missing_evidence || row.risk || ''), 1000),
        status: truncate(cleanText(row.status || row.verdict || 'unknown'), 80),
      };
    })
    .filter((row) => row.ticker || row.name || row.role || row.demandLink || row.gap);
}

function normalizeValuationReview(rows) {
  const list = Array.isArray(rows)
    ? rows
    : Object.entries(rows && typeof rows === 'object' ? rows : {}).map(([ticker, value]) => ({
        ticker,
        ...(value && typeof value === 'object' ? value : { valuationConclusion: value }),
      }));

  return list
    .map((row) => ({
      ticker: truncate(cleanText(row.ticker || row.symbol || row.name || ''), 40),
      asOfDate: truncate(cleanText(row.asOfDate || row.as_of_date || row.date || ''), 40),
      marketCap: truncate(cleanText(row.marketCap || row.market_cap || ''), 80),
      enterpriseValue: truncate(cleanText(row.enterpriseValue || row.enterprise_value || row.ev || ''), 80),
      peTtm: truncate(cleanText(row.peTtm || row.pe_ttm || row.ttmPe || row.ttm_pe || row.pe || ''), 80),
      peForward: truncate(cleanText(row.peForward || row.pe_forward || row.forwardPe || row.forward_pe || ''), 80),
      salesMultiple: truncate(cleanText(row.salesMultiple || row.sales_multiple || row.ps || row.priceSales || row.evSales || ''), 80),
      pricePerformance: truncate(
        cleanText(row.pricePerformance || row.price_performance || row.performance || row.pricePerf || ''),
        240
      ),
      historicalRange: truncate(cleanText(row.historicalRange || row.historical_range || row.history || ''), 240),
      consensusTrend: truncate(cleanText(row.consensusTrend || row.consensus_trend || row.estimates || ''), 240),
      guidanceTrend: truncate(cleanText(row.guidanceTrend || row.guidance_trend || row.guidance || ''), 240),
      conclusion: truncate(
        cleanText(row.conclusion || row.valuationConclusion || row.valuation_conclusion || row.verdict || row.status || ''),
        120
      ),
      evidence: truncate(cleanText(row.evidence || row.basis || row.reason || ''), 1000),
      gap: truncate(cleanText(row.gap || row.missingEvidence || row.missing_evidence || row.limitations || ''), 1000),
    }))
    .filter((row) => row.ticker || row.conclusion || row.evidence || row.gap);
}

function normalizeFatalGateReview(rows) {
  const list = Array.isArray(rows)
    ? rows
    : Object.entries(rows && typeof rows === 'object' ? rows : {}).map(([gate, value]) => ({
        gate,
        ...(value && typeof value === 'object' ? value : { status: value === true ? 'pass' : value === false ? 'fail' : 'unknown' }),
      }));

  return list
    .map((row) => ({
      gate: truncate(cleanText(row.gate || row.name || ''), 120),
      status: truncate(cleanText(row.status || row.result || (row.passed === true ? 'pass' : row.passed === false ? 'fail' : 'unknown')), 40),
      evidence: truncate(cleanText(row.evidence || row.basis || row.reason || ''), 1000),
      gap: truncate(cleanText(row.gap || row.missingEvidence || row.missing_evidence || row.risk || ''), 1000),
    }))
    .filter((row) => row.gate || row.evidence || row.gap);
}

function formatValuationReview(rows = []) {
  if (!rows.length) {
    return [
      '- Not recorded. No candidate should be described as cheap, expensive, attractive, or mispriced until valuation is checked.',
    ];
  }
  return rows.map((row) => {
    const label = row.ticker || 'Unspecified candidate';
    const parts = [
      row.asOfDate ? `as of: ${row.asOfDate}` : '',
      row.marketCap ? `market cap: ${row.marketCap}` : '',
      row.enterpriseValue ? `EV: ${row.enterpriseValue}` : '',
      row.peTtm ? `P/E TTM: ${row.peTtm}` : '',
      row.peForward ? `P/E forward: ${row.peForward}` : '',
      row.salesMultiple ? `sales multiple: ${row.salesMultiple}` : '',
      row.pricePerformance ? `price performance: ${row.pricePerformance}` : '',
      row.historicalRange ? `historical range: ${row.historicalRange}` : '',
      row.consensusTrend ? `consensus: ${row.consensusTrend}` : '',
      row.guidanceTrend ? `guidance: ${row.guidanceTrend}` : '',
      row.conclusion ? `conclusion: ${row.conclusion}` : '',
      row.evidence ? `evidence: ${row.evidence}` : '',
      row.gap ? `gap: ${row.gap}` : '',
    ].filter(Boolean);
    return `- ${label}: ${parts.join('; ') || 'No valuation details recorded.'}`;
  });
}

function formatSerenityLoopVerdict(review = {}) {
  const rows = [];
  rows.push(`- Verdict: ${review.loopVerdict || 'Not recorded. Treat this memo as partial until a loop verdict is stated.'}`);
  if (review.candidateConclusion) rows.push(`- Candidate conclusion: ${review.candidateConclusion}`);
  return rows;
}

function formatSerenityTextBlock(value, fallback) {
  const text = cleanText(value);
  return [`- ${text || fallback}`];
}

function formatCandidateMappings(rows = []) {
  if (!rows.length) {
    return ['- Not recorded. No ticker can be promoted from this memo without explicit candidate mapping.'];
  }
  return rows.map((row) => {
    const label = [row.ticker, row.name].filter(Boolean).join(' / ') || 'Unspecified candidate';
    const parts = [
      row.role ? `role: ${row.role}` : '',
      row.demandLink ? `demand link: ${row.demandLink}` : '',
      row.gap ? `gap: ${row.gap}` : '',
      row.status ? `status: ${row.status}` : '',
    ].filter(Boolean);
    return `- ${label}: ${parts.join('; ') || 'No mapping details recorded.'}`;
  });
}

function formatFatalGateReview(rows = []) {
  if (!rows.length) {
    return ['- Not recorded. Fatal Gate status is unknown; do not upgrade any candidate from this memo.'];
  }
  return rows.map((row) => {
    const parts = [
      row.status ? `status: ${row.status}` : '',
      row.evidence ? `evidence: ${row.evidence}` : '',
      row.gap ? `gap: ${row.gap}` : '',
    ].filter(Boolean);
    return `- ${row.gate || 'Unnamed gate'}: ${parts.join('; ') || 'No gate details recorded.'}`;
  });
}

function normalizeChallengeReview(input = {}) {
  return {
    reviewerAgent: truncate(cleanText(input.reviewerAgent || input.reviewer_agent || 'serenity-challenge-agent'), 80),
    reviewVerdict: truncate(cleanText(input.reviewVerdict || input.review_verdict || input.challengeVerdict || input.challenge_verdict || ''), 1000),
    upgradeDecision: truncate(cleanText(input.upgradeDecision || input.upgrade_decision || ''), 1000),
    chainCoverage: normalizeChallengeRows(input.chainCoverage || input.chain_coverage || []),
    challengeQuestions: normalizeChallengeRows(input.challengeQuestions || input.challenge_questions || []),
    redTeamSearches: normalizeChallengeRows(input.redTeamSearches || input.red_team_searches || []),
    missingLayers: normalizeStringArray(input.missingLayers || input.missing_layers || []),
    requiredFixes: normalizeStringArray(input.requiredFixes || input.required_fixes || input.fixes || []),
    nextChallengeTasks: normalizeStringArray(input.nextChallengeTasks || input.next_challenge_tasks || []),
  };
}

function resolveChallengeReview(input = {}, item = {}) {
  const explicit = normalizeChallengeReview(input.challengeReview || input.challenge_review || {});
  if (hasChallengeReview(explicit)) return explicit;
  const existing = normalizeChallengeReview(item.challengeReview || item.challenge_review || {});
  if (hasChallengeReview(existing)) return existing;
  return normalizeChallengeReview(input);
}

function normalizeChallengeRows(rows) {
  const list = Array.isArray(rows)
    ? rows
    : Object.entries(rows && typeof rows === 'object' ? rows : {}).map(([name, value]) => ({
        name,
        ...(value && typeof value === 'object' ? value : { status: cleanText(value) || 'unknown' }),
      }));

  return list
    .map((row) => ({
      name: truncate(cleanText(row.name || row.layer || row.question || row.search || row.gate || ''), 160),
      status: truncate(cleanText(row.status || row.result || row.verdict || 'unknown'), 80),
      evidence: truncate(cleanText(row.evidence || row.answer || row.finding || row.basis || ''), 1000),
      gap: truncate(cleanText(row.gap || row.missing || row.missingEvidence || row.missing_evidence || row.followUp || row.follow_up || ''), 1000),
    }))
    .filter((row) => row.name || row.evidence || row.gap);
}

function hasChallengeReview(review = {}) {
  return Boolean(
    cleanText(review.reviewVerdict) ||
      cleanText(review.upgradeDecision) ||
      review.chainCoverage?.length ||
      review.challengeQuestions?.length ||
      review.redTeamSearches?.length ||
      review.missingLayers?.length ||
      review.requiredFixes?.length ||
      review.nextChallengeTasks?.length
  );
}

function getChallengeReviewCompletionGaps(review = {}) {
  const missing = [];
  if (!cleanText(review.reviewVerdict)) missing.push('challengeReview.reviewVerdict');
  if (!cleanText(review.upgradeDecision)) missing.push('challengeReview.upgradeDecision');
  if (!review.chainCoverage?.length) missing.push('challengeReview.chainCoverage');
  if (!review.missingLayers?.length) missing.push('challengeReview.missingLayers');
  if (!review.challengeQuestions?.length) missing.push('challengeReview.challengeQuestions');
  if ((review.redTeamSearches || []).length < 3) missing.push('challengeReview.redTeamSearches >= 3');
  if (!review.requiredFixes?.length && !review.nextChallengeTasks?.length) {
    missing.push('challengeReview.requiredFixes or nextChallengeTasks');
  }

  const coveredNames = new Set((review.chainCoverage || []).map((row) => cleanText(row.name).toLowerCase()));
  const uncovered = SERENITY_CHAIN.filter((layer) => !coveredNames.has(layer));
  if (uncovered.length) missing.push(`challengeReview.chainCoverage missing layers: ${uncovered.join(', ')}`);

  return missing;
}

function formatChallengeReview(review = {}) {
  if (!hasChallengeReview(review)) {
    return [
      '- Reviewer: serenity-challenge-agent',
      '- Verdict: Not recorded. This memo has not passed independent chain-completeness review.',
      '- Required fix: Run a Serenity Challenge Agent review before upgrading or closing a candidate.',
    ];
  }

  return [
    `- Reviewer: ${review.reviewerAgent || 'serenity-challenge-agent'}`,
    `- Verdict: ${review.reviewVerdict || 'Not recorded.'}`,
    review.upgradeDecision ? `- Upgrade decision: ${review.upgradeDecision}` : '',
    '',
    '### Chain Coverage',
    '',
    ...formatChallengeRows(review.chainCoverage, 'No chain-coverage checklist recorded.'),
    '',
    '### Missing / Weak Layers',
    '',
    ...toBulletLines(review.missingLayers.length ? review.missingLayers : ['No missing layers recorded.']),
    '',
    '### Challenge Questions',
    '',
    ...formatChallengeRows(review.challengeQuestions, 'No challenge questions recorded.'),
    '',
    '### Red Team Searches',
    '',
    ...formatChallengeRows(review.redTeamSearches, 'No Red Team searches recorded.'),
    '',
    '### Required Fixes',
    '',
    ...toBulletLines(review.requiredFixes.length ? review.requiredFixes : ['No required fixes recorded.']),
    '',
    '### Next Challenge Tasks',
    '',
    ...toBulletLines(review.nextChallengeTasks.length ? review.nextChallengeTasks : ['No next challenge tasks recorded.']),
  ].filter((line) => line !== '');
}

function formatChallengeRows(rows = [], fallback) {
  if (!rows.length) return [`- ${fallback}`];
  return rows.map((row) => {
    const parts = [
      row.status ? `status: ${row.status}` : '',
      row.evidence ? `evidence: ${row.evidence}` : '',
      row.gap ? `gap: ${row.gap}` : '',
    ].filter(Boolean);
    return `- ${row.name || 'Unnamed review item'}: ${parts.join('; ') || 'No review details recorded.'}`;
  });
}

function compactQueueItem(item) {
  return {
    id: item.id,
    status: item.status || 'queued',
    priority: item.priority || 3,
    question: item.question,
    tickers: item.tickers || [],
    createdAt: item.createdAt || '',
    linkedRunId: item.linkedRunId || '',
  };
}

function resolveBarkTarget(env) {
  const direct = cleanText(env.BARK_PUSH_URL || env.BARK_WEBHOOK_URL || '');
  if (direct) return { url: direct, mode: 'direct' };

  const server = cleanText(env.BARK_SERVER || '').replace(/\/+$/, '');
  const key = cleanText(env.BARK_KEY || env.BARK_DEVICE_KEY || '');
  if (server && key) return { url: `${server}/${encodeURIComponent(key)}`, mode: 'template' };
  return { url: '', mode: '' };
}

function buildBarkUrl(baseUrl, title, body, input, env) {
  const params = new URLSearchParams();
  params.set('group', cleanText(input.group || env.BARK_GROUP || 'Information Gain'));
  if (input.url || env.BARK_OPEN_URL) params.set('url', cleanText(input.url || env.BARK_OPEN_URL));
  return `${baseUrl}/${encodeURIComponent(title)}/${encodeURIComponent(body)}?${params.toString()}`;
}

function sanitizeBarkEndpoint(url) {
  return url.replace(/\/([^/?]{8})[^/?]*(?=\/|$)/, '/$1...');
}

function toBulletLines(values) {
  const lines = normalizeStringArray(values);
  return lines.length ? lines.map((value) => `- ${value}`) : ['- Not recorded.'];
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return cleanText(value)
    .split(/[,\n，、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function topCounts(values, limit = 8) {
  return Object.entries(countBy(values.filter(Boolean), (value) => value))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function toDateSlug(value = new Date().toISOString()) {
  return cleanText(value).slice(0, 10) || new Date().toISOString().slice(0, 10);
}

function safeSlug(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'research-memo';
}

function escapeYaml(value) {
  return cleanText(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(value, max) {
  const text = cleanText(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
