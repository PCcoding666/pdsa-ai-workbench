#!/usr/bin/env node

import {
  addResearchQueueItems,
  appendResearchOpsLog,
  claimNextResearchQueueItem,
  getResearchQueue,
  readResearchOpsLog,
  sendBarkNotification,
  summarizeResearchQueue,
  updateResearchQueueItemStatus,
  writeResearchQueueMemo,
} from '../server/research-ops.js';

const args = new Set(process.argv.slice(2));
const actor = process.env.RESEARCH_AGENT_NAME || 'research-ops-runner';
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

async function main() {
  if (args.has('--summary')) {
    const items = getResearchQueue();
    console.log(JSON.stringify({ summary: summarizeResearchQueue(items) }, null, 2));
    return;
  }

  if (args.has('--log')) {
    console.log(JSON.stringify({ entries: readResearchOpsLog(50) }, null, 2));
    return;
  }

  if (args.has('--notify-test')) {
    const result = await sendBarkNotification({
      title: 'Information Gain Research Ops',
      body: 'Bark notification channel is reachable.',
      group: 'Information Gain',
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.has('--complete')) {
    const itemId = readRequiredEnv('RESEARCH_QUEUE_ITEM_ID');
    const resultSummary = readRequiredEnv('RESEARCH_RESULT_SUMMARY');
    const discoveredTasks = readJsonEnv('RESEARCH_DISCOVERED_TASKS_JSON', []);
    const serenityLoop = buildSerenityLoopFromEnv();
    const challengeReview = buildChallengeReviewFromEnv();
    validateSerenityLoopForCompletion(serenityLoop);
    validateChallengeReviewForCompletion(challengeReview);
    const statusResult = updateResearchQueueItemStatus(itemId, {
      status: 'done',
      actor,
      resultSummary,
      reason: process.env.RESEARCH_STATUS_REASON || 'Research completed by automation.',
      linkedRunId: process.env.RESEARCH_LINKED_RUN_ID || '',
      notes: process.env.RESEARCH_AGENT_NOTES || '',
      discoveredTasks,
      serenityLoop,
      challengeReview,
    });
    const memoResult = writeResearchQueueMemo(itemId, {
      actor,
      summary: resultSummary,
      linkedRunId: process.env.RESEARCH_LINKED_RUN_ID || '',
      notes: process.env.RESEARCH_AGENT_NOTES || '',
      evidence: readJsonEnv('RESEARCH_EVIDENCE_JSON', []),
      counterEvidence: readJsonEnv('RESEARCH_COUNTER_EVIDENCE_JSON', []),
      falsifiers: readJsonEnv('RESEARCH_FALSIFIERS_JSON', []),
      discoveredTasks,
      serenityLoop,
      challengeReview,
    });
    const discoveredQueueResult = discoveredTasks.length
      ? addResearchQueueItems(
          discoveredTasks.map((task) => ({
            ...task,
            sourceEventId: itemId,
            themes: [...new Set([...(Array.isArray(task.themes) ? task.themes : []), 'discovered follow-up'])],
          })),
          { actor }
        )
      : null;
    await notifyQueueResult('Research task completed', memoResult.item);
    console.log(JSON.stringify({ statusResult, memoResult, discoveredQueueResult }, null, 2));
    return;
  }

  if (args.has('--block')) {
    const itemId = readRequiredEnv('RESEARCH_QUEUE_ITEM_ID');
    const reason = readRequiredEnv('RESEARCH_BLOCKED_REASON');
    const result = updateResearchQueueItemStatus(itemId, {
      status: 'blocked',
      actor,
      reason,
      notes: process.env.RESEARCH_AGENT_NOTES || '',
    });
    writeResearchQueueMemo(itemId, {
      actor,
      summary: `Blocked: ${reason}`,
      notes: process.env.RESEARCH_AGENT_NOTES || '',
    });
    await notifyQueueResult('Research task blocked', result.item);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const claimResult = claimNextResearchQueueItem({
    actor,
    reason: 'Claimed by scheduled research operations runner.',
    syncObsidian: true,
  });

  if (!claimResult.item) {
    appendResearchOpsLog({
      type: 'runner_idle',
      actor,
      reason: 'No queued research items available.',
    });
    await sendBarkNotification({
      title: 'Information Gain Research Ops',
      body: 'No queued research items are currently available.',
      group: 'Information Gain',
    });
    console.log(JSON.stringify(claimResult, null, 2));
    return;
  }

  await notifyQueueResult('Research task claimed', claimResult.item);
  console.log(JSON.stringify(claimResult, null, 2));
}

async function notifyQueueResult(title, item) {
  const result = await sendBarkNotification({
    title: `Information Gain: ${title}`,
    body: [
      `Queue: ${item.id}`,
      `Priority: ${item.priority}`,
      `Status: ${item.status}`,
      `Question: ${item.question}`,
      item.memoPath ? `Memo: ${item.memoPath}` : '',
      item.obsidianMemoPath ? `Obsidian: ${item.obsidianMemoPath}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    group: 'Information Gain',
  });
  appendResearchOpsLog({
    type: 'bark_notification',
    itemId: item.id,
    notificationTitle: title,
    result,
    actor,
  });
}

function readRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readJsonEnv(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error.message}`);
  }
}

function buildSerenityLoopFromEnv() {
  const base = readJsonEnv('RESEARCH_SERENITY_LOOP_JSON', {});
  if (!base || typeof base !== 'object' || Array.isArray(base)) {
    throw new Error('RESEARCH_SERENITY_LOOP_JSON must be a JSON object when set');
  }

  const serenityLoop = { ...base };
  applyStringEnv(serenityLoop, 'loopVerdict', 'RESEARCH_LOOP_VERDICT');
  applyStringEnv(serenityLoop, 'scarcityAssessment', 'RESEARCH_SCARCITY_ASSESSMENT');
  applyStringEnv(serenityLoop, 'candidateConclusion', 'RESEARCH_CANDIDATE_CONCLUSION');
  applyStringEnv(serenityLoop, 'demandToTickerGap', 'RESEARCH_DEMAND_TO_TICKER_GAP');
  applyStringEnv(serenityLoop, 'pricingGap', 'RESEARCH_PRICING_GAP');

  applyJsonEnv(serenityLoop, 'candidateMappings', 'RESEARCH_CANDIDATE_MAPPINGS_JSON');
  applyJsonEnv(serenityLoop, 'fatalGateReview', 'RESEARCH_FATAL_GATE_REVIEW_JSON');
  applyJsonEnv(serenityLoop, 'nextDecisiveEvidence', 'RESEARCH_NEXT_DECISIVE_EVIDENCE_JSON');

  return serenityLoop;
}

function validateSerenityLoopForCompletion(serenityLoop) {
  if (process.env.RESEARCH_SERENITY_LOOP_REQUIRED === '0') {
    logCompletionContractBypass('serenity_loop');
    return;
  }

  const missing = [];
  if (!cleanEnvText(serenityLoop.loopVerdict || serenityLoop.loop_verdict || serenityLoop.verdict)) {
    missing.push('RESEARCH_LOOP_VERDICT');
  }
  if (!cleanEnvText(serenityLoop.scarcityAssessment || serenityLoop.scarcity_assessment || serenityLoop.scarcityLayer || serenityLoop.scarcity_layer)) {
    missing.push('RESEARCH_SCARCITY_ASSESSMENT');
  }
  if (!hasArrayOrText(serenityLoop.candidateMappings || serenityLoop.candidate_mappings || serenityLoop.candidates) && !cleanEnvText(serenityLoop.candidateConclusion || serenityLoop.candidate_conclusion)) {
    missing.push('RESEARCH_CANDIDATE_MAPPINGS_JSON or RESEARCH_CANDIDATE_CONCLUSION');
  }
  if (!cleanEnvText(serenityLoop.demandToTickerGap || serenityLoop.demand_to_ticker_gap || serenityLoop.financialTransmission || serenityLoop.financial_transmission)) {
    missing.push('RESEARCH_DEMAND_TO_TICKER_GAP');
  }
  if (!hasArrayOrText(serenityLoop.fatalGateReview || serenityLoop.fatal_gate_review || serenityLoop.fatalGates || serenityLoop.fatal_gates)) {
    missing.push('RESEARCH_FATAL_GATE_REVIEW_JSON');
  }
  if (!cleanEnvText(serenityLoop.pricingGap || serenityLoop.pricing_gap || serenityLoop.expectationGap || serenityLoop.expectation_gap)) {
    missing.push('RESEARCH_PRICING_GAP');
  }
  if (!hasArrayOrText(serenityLoop.nextDecisiveEvidence || serenityLoop.next_decisive_evidence)) {
    missing.push('RESEARCH_NEXT_DECISIVE_EVIDENCE_JSON');
  }

  if (missing.length) {
    throw new Error(
      [
        'Completing a research task now requires a Serenity loop review.',
        `Missing: ${missing.join(', ')}.`,
        'Backfill bypass requires RESEARCH_SERENITY_LOOP_REQUIRED=0, RESEARCH_CONTRACT_BYPASS_MODE=backfill and RESEARCH_CONTRACT_BYPASS_REASON.',
      ].join(' ')
    );
  }
}

function buildChallengeReviewFromEnv() {
  const base = readJsonEnv('RESEARCH_CHALLENGE_REVIEW_JSON', {});
  if (!base || typeof base !== 'object' || Array.isArray(base)) {
    throw new Error('RESEARCH_CHALLENGE_REVIEW_JSON must be a JSON object when set');
  }

  const challengeReview = { ...base };
  applyStringEnv(challengeReview, 'reviewVerdict', 'RESEARCH_CHALLENGE_VERDICT');
  applyStringEnv(challengeReview, 'upgradeDecision', 'RESEARCH_UPGRADE_DECISION');
  applyJsonEnv(challengeReview, 'chainCoverage', 'RESEARCH_CHAIN_COVERAGE_JSON');
  applyJsonEnv(challengeReview, 'missingLayers', 'RESEARCH_MISSING_LAYERS_JSON');
  applyJsonEnv(challengeReview, 'challengeQuestions', 'RESEARCH_CHALLENGE_QUESTIONS_JSON');
  applyJsonEnv(challengeReview, 'redTeamSearches', 'RESEARCH_RED_TEAM_SEARCHES_JSON');
  applyJsonEnv(challengeReview, 'requiredFixes', 'RESEARCH_REVIEWER_REQUIRED_FIXES_JSON');
  applyJsonEnv(challengeReview, 'nextChallengeTasks', 'RESEARCH_NEXT_CHALLENGE_TASKS_JSON');
  return challengeReview;
}

function validateChallengeReviewForCompletion(challengeReview) {
  if (process.env.RESEARCH_CHALLENGE_REVIEW_REQUIRED === '0') {
    logCompletionContractBypass('challenge_review');
    return;
  }

  const missing = [];
  if (!cleanEnvText(challengeReview.reviewVerdict || challengeReview.review_verdict || challengeReview.challengeVerdict || challengeReview.challenge_verdict)) {
    missing.push('RESEARCH_CHALLENGE_VERDICT');
  }
  if (!cleanEnvText(challengeReview.upgradeDecision || challengeReview.upgrade_decision)) {
    missing.push('RESEARCH_UPGRADE_DECISION');
  }
  if (!hasArrayOrText(challengeReview.chainCoverage || challengeReview.chain_coverage)) {
    missing.push('RESEARCH_CHAIN_COVERAGE_JSON');
  }
  if (!hasArrayOrText(challengeReview.missingLayers || challengeReview.missing_layers)) {
    missing.push('RESEARCH_MISSING_LAYERS_JSON');
  }
  if (!hasArrayOrText(challengeReview.challengeQuestions || challengeReview.challenge_questions)) {
    missing.push('RESEARCH_CHALLENGE_QUESTIONS_JSON');
  }
  const redTeamSearches = challengeReview.redTeamSearches || challengeReview.red_team_searches || [];
  if (!Array.isArray(redTeamSearches) || redTeamSearches.length < 3) {
    missing.push('RESEARCH_RED_TEAM_SEARCHES_JSON with at least 3 rows');
  }
  if (!hasArrayOrText(challengeReview.requiredFixes || challengeReview.required_fixes || challengeReview.fixes) && !hasArrayOrText(challengeReview.nextChallengeTasks || challengeReview.next_challenge_tasks)) {
    missing.push('RESEARCH_REVIEWER_REQUIRED_FIXES_JSON or RESEARCH_NEXT_CHALLENGE_TASKS_JSON');
  }
  const chainCoverage = challengeReview.chainCoverage || challengeReview.chain_coverage || [];
  const coveredNames = new Set(
    (Array.isArray(chainCoverage) ? chainCoverage : Object.keys(chainCoverage || {})).map((row) =>
      cleanEnvText(typeof row === 'string' ? row : row?.name || row?.layer || row?.question || '').toLowerCase()
    )
  );
  const uncovered = SERENITY_CHAIN.filter((layer) => !coveredNames.has(layer));
  if (uncovered.length) {
    missing.push(`RESEARCH_CHAIN_COVERAGE_JSON missing layers: ${uncovered.join(', ')}`);
  }

  if (missing.length) {
    throw new Error(
      [
        'Completing a research task now requires an independent Serenity Challenge Agent review.',
        `Missing: ${missing.join(', ')}.`,
        'Backfill bypass requires RESEARCH_CHALLENGE_REVIEW_REQUIRED=0, RESEARCH_CONTRACT_BYPASS_MODE=backfill and RESEARCH_CONTRACT_BYPASS_REASON.',
      ].join(' ')
    );
  }
}

function logCompletionContractBypass(contract) {
  const mode = cleanEnvText(process.env.RESEARCH_CONTRACT_BYPASS_MODE || '');
  const reason = cleanEnvText(process.env.RESEARCH_CONTRACT_BYPASS_REASON || '');
  if (mode !== 'backfill' || !reason) {
    throw new Error(
      `${contract} completion contract bypass requires RESEARCH_CONTRACT_BYPASS_MODE=backfill and RESEARCH_CONTRACT_BYPASS_REASON`
    );
  }
  appendResearchOpsLog({
    type: 'completion_contract_bypassed',
    contract,
    actor,
    reason,
  });
}

function applyStringEnv(target, key, name) {
  if (process.env[name]) target[key] = process.env[name];
}

function applyJsonEnv(target, key, name) {
  if (process.env[name]) target[key] = readJsonEnv(name, undefined);
}

function hasArrayOrText(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(cleanEnvText(value));
}

function cleanEnvText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
