import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-research-ops-'));
process.env.DATA_DIR = path.join(tempRoot, 'data');
process.env.RESEARCH_MEMOS_DIR = path.join(tempRoot, 'memos');
process.env.RESEARCH_OPS_LOG_FILE = path.join(tempRoot, 'ops-log.jsonl');
process.env.OBSIDIAN_VAULT_PATH = path.join(tempRoot, 'obsidian');
process.env.RESEARCH_MEMOS_OBSIDIAN_DIR = 'Projects/Information Gain/Research Memos';

const researchOps = await import(`../server/research-ops.js?test=${Date.now()}`);

const serenityChain = [
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

function sampleSerenityLoop() {
  return {
    loopVerdict: 'partial_not_candidate_ready',
    scarcityAssessment: 'The scarce layer is plausible but not yet proven by supplier-count and lead-time evidence.',
    candidateMappings: [
      {
        ticker: 'TEST',
        name: 'Test Carrier',
        role: 'Potential listed carrier for the suspected bottleneck layer.',
        demandLink: 'Demand would need to show up in segment revenue, backlog, margin or utilization.',
        gap: 'No primary-source segment exposure proof has been recorded.',
        status: 'screening',
      },
    ],
    demandToTickerGap: 'Demand is not yet connected to company-level financial transmission.',
    fatalGateReview: [
      {
        gate: 'Direct business relationship to bottleneck',
        status: 'unknown',
        gap: 'Needs filing or customer qualification evidence.',
      },
    ],
    pricingGap: 'No good-stock conclusion until expectations and valuation are checked.',
    valuationReview: [
      {
        ticker: 'TEST',
        asOfDate: '2026-06-23',
        marketCap: 'unknown',
        enterpriseValue: 'unknown',
        peTtm: 'not meaningful until profitability is verified',
        salesMultiple: 'unknown',
        pricePerformance: 'not reviewed',
        historicalRange: 'not reviewed',
        consensusTrend: 'not reviewed',
        guidanceTrend: 'not reviewed',
        conclusion: 'unknown_not_cheap_or_expensive',
        gap: 'Valuation data must be checked before any good-stock conclusion.',
      },
    ],
    nextDecisiveEvidence: ['Check latest filing segment exposure.'],
  };
}

function sampleChallengeReview() {
  return {
    reviewVerdict: 'fail_upgrade: Serenity chain is incomplete.',
    upgradeDecision: 'Do not upgrade until supplier count and pricing gap are reviewed.',
    chainCoverage: serenityChain.map((name) => ({
      name,
      status: ['top-level demand', 'risk', 'falsifier'].includes(name) ? 'covered' : 'missing',
      gap: ['top-level demand', 'risk', 'falsifier'].includes(name) ? '' : 'Reviewer requires more evidence.',
    })),
    missingLayers: ['supplier landscape', 'pricing gap'],
    challengeQuestions: [
      {
        name: 'Is demand growth already reflected in price and expectations?',
        status: 'unanswered',
        gap: 'No valuation or expectations review.',
      },
    ],
    redTeamSearches: [
      { name: 'TEST competitor supplier', status: 'needed', gap: 'Not yet run.' },
      { name: 'TEST alternative technology', status: 'needed', gap: 'Not yet run.' },
      { name: 'TEST gross margin risk', status: 'needed', gap: 'Not yet run.' },
    ],
    requiredFixes: ['Complete supplier count and pricing-gap review before upgrade.'],
    nextChallengeTasks: ['Run competitor supplier search.'],
  };
}

test('research ops claims the highest priority queued item and writes a memo', () => {
  const created = researchOps.addResearchQueueItems([
    { id: 'rq:test-p3', priority: 3, question: 'Lower priority task', tickers: ['LOW'] },
    { id: 'rq:test-p1', priority: 1, question: 'Highest priority task', tickers: ['HIGH'] },
  ]);
  assert.equal(created.summary.total, 2);

  const claim = researchOps.claimNextResearchQueueItem({ actor: 'test-agent' });
  assert.equal(claim.status, 'claimed');
  assert.equal(claim.item.id, 'rq:test-p1');
  assert.equal(claim.item.status, 'in_progress');
  assert.ok(fs.existsSync(claim.item.memoPath));
  assert.equal(claim.item.memoSyncStatus, 'success');
  assert.ok(fs.existsSync(path.join(process.env.OBSIDIAN_VAULT_PATH, claim.item.obsidianMemoPath)));
});

test('research ops enforces queue state transition rules', () => {
  assert.throws(
    () => researchOps.updateResearchQueueItemStatus('rq:test-p3', { status: 'done', actor: 'test-agent', resultSummary: 'done' }),
    /Illegal research queue transition/
  );

  const started = researchOps.updateResearchQueueItemStatus('rq:test-p3', {
    status: 'in_progress',
    actor: 'test-agent',
    reason: 'Start task.',
  });
  assert.equal(started.item.status, 'in_progress');

  assert.throws(
    () => researchOps.updateResearchQueueItemStatus('rq:test-p3', { status: 'done', actor: 'test-agent' }),
    /requires resultSummary or memo/
  );
});

test('research ops completes a task and records auditable memo evidence', () => {
  assert.throws(
    () =>
      researchOps.updateResearchQueueItemStatus('rq:test-p3', {
        status: 'done',
        actor: 'test-agent',
        resultSummary: 'The evidence supports a follow-up, not a closed conclusion.',
      }),
    /requires complete Serenity loop and Challenge Agent review/
  );

  const completed = researchOps.updateResearchQueueItemStatus('rq:test-p3', {
    status: 'done',
    actor: 'test-agent',
    resultSummary: 'The evidence supports a follow-up, not a closed conclusion.',
    serenityLoop: sampleSerenityLoop(),
    challengeReview: sampleChallengeReview(),
  });
  assert.equal(completed.item.status, 'done');
  assert.ok(completed.item.completedAt);

  const memo = researchOps.writeResearchQueueMemo('rq:test-p3', {
    actor: 'test-agent',
    summary: completed.item.resultSummary,
    serenityLoop: sampleSerenityLoop(),
    challengeReview: sampleChallengeReview(),
    evidence: [
      {
        source: 'Example filing',
        url: 'https://example.com/filing',
        sourceType: 'company_filing',
        sourceFamily: 'issuer',
        allowedUse: 'core_evidence',
        claimStatus: 'supported',
        claim: 'Example claim for the memo evidence ledger.',
      },
    ],
    counterEvidence: ['Alternative explanation remains possible.'],
    falsifiers: ['Future filing contradicts the claimed exposure.'],
  });
  const content = fs.readFileSync(memo.localPath, 'utf8');
  assert.match(content, /Evidence Ledger/);
  assert.match(content, /Example filing/);
  assert.match(content, /Serenity Loop Verdict/);
  assert.match(content, /partial_not_candidate_ready/);
  assert.match(content, /Candidate Mapping/);
  assert.match(content, /TEST \/ Test Carrier/);
  assert.match(content, /Fatal Gate Review/);
  assert.match(content, /Direct business relationship to bottleneck/);
  assert.match(content, /Valuation \/ Expensive-Cheap Check/);
  assert.match(content, /unknown_not_cheap_or_expensive/);
  assert.match(content, /Serenity Challenge Agent Review/);
  assert.match(content, /fail_upgrade/);
  assert.match(content, /supplier landscape/);
  assert.equal(memo.obsidian.status, 'success');
});

test('research ops rejects mapped candidates without valuation review', () => {
  researchOps.addResearchQueueItems([{ id: 'rq:test-valuation-gate', priority: 1, question: 'Valuation gate task' }]);
  researchOps.updateResearchQueueItemStatus('rq:test-valuation-gate', {
    status: 'in_progress',
    actor: 'test-agent',
    reason: 'Start valuation gate test.',
  });

  const loopWithoutValuation = sampleSerenityLoop();
  delete loopWithoutValuation.valuationReview;

  assert.throws(
    () =>
      researchOps.updateResearchQueueItemStatus('rq:test-valuation-gate', {
        status: 'done',
        actor: 'test-agent',
        resultSummary: 'Mapped a candidate but did not check valuation.',
        serenityLoop: loopWithoutValuation,
        challengeReview: sampleChallengeReview(),
      }),
    /serenityLoop\.valuationReview/
  );
});

test('research ops runner rejects completion without Serenity loop review', () => {
  researchOps.addResearchQueueItems([{ id: 'rq:test-runner-loop', priority: 1, question: 'Runner loop contract task' }]);
  researchOps.updateResearchQueueItemStatus('rq:test-runner-loop', {
    status: 'in_progress',
    actor: 'test-agent',
    reason: 'Start runner contract test.',
  });

  const result = spawnSync(process.execPath, ['scripts/research-ops-runner.js', '--complete'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RESEARCH_QUEUE_ITEM_ID: 'rq:test-runner-loop',
      RESEARCH_RESULT_SUMMARY: 'Summary without Serenity loop fields.',
      RESEARCH_AGENT_NAME: 'test-runner',
    },
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires a Serenity loop review/);
});

test('research ops runner rejects completion without Challenge Agent review', () => {
  researchOps.addResearchQueueItems([{ id: 'rq:test-runner-challenge', priority: 1, question: 'Runner challenge contract task' }]);
  researchOps.updateResearchQueueItemStatus('rq:test-runner-challenge', {
    status: 'in_progress',
    actor: 'test-agent',
    reason: 'Start challenge contract test.',
  });

  const result = spawnSync(process.execPath, ['scripts/research-ops-runner.js', '--complete'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RESEARCH_QUEUE_ITEM_ID: 'rq:test-runner-challenge',
      RESEARCH_RESULT_SUMMARY: 'Summary with Serenity loop but without reviewer.',
      RESEARCH_AGENT_NAME: 'test-runner',
      RESEARCH_LOOP_VERDICT: 'partial_not_candidate_ready',
      RESEARCH_SCARCITY_ASSESSMENT: 'Scarce layer not yet proven.',
      RESEARCH_CANDIDATE_CONCLUSION: 'No candidate upgrade.',
      RESEARCH_DEMAND_TO_TICKER_GAP: 'Financial transmission missing.',
      RESEARCH_FATAL_GATE_REVIEW_JSON: JSON.stringify([{ gate: 'Direct business relationship to bottleneck', status: 'unknown' }]),
      RESEARCH_PRICING_GAP: 'Pricing gap missing.',
      RESEARCH_NEXT_DECISIVE_EVIDENCE_JSON: JSON.stringify(['Supplier count review.']),
    },
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires an independent Serenity Challenge Agent review/);
});

test('research ops runner rejects mapped candidates without valuation review', () => {
  researchOps.addResearchQueueItems([{ id: 'rq:test-runner-valuation', priority: 1, question: 'Runner valuation contract task' }]);
  researchOps.updateResearchQueueItemStatus('rq:test-runner-valuation', {
    status: 'in_progress',
    actor: 'test-agent',
    reason: 'Start runner valuation contract test.',
  });

  const result = spawnSync(process.execPath, ['scripts/research-ops-runner.js', '--complete'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RESEARCH_QUEUE_ITEM_ID: 'rq:test-runner-valuation',
      RESEARCH_RESULT_SUMMARY: 'Summary with a mapped candidate but no valuation review.',
      RESEARCH_AGENT_NAME: 'test-runner',
      RESEARCH_LOOP_VERDICT: 'partial_not_candidate_ready',
      RESEARCH_SCARCITY_ASSESSMENT: 'Scarce layer not yet proven.',
      RESEARCH_CANDIDATE_MAPPINGS_JSON: JSON.stringify([{ ticker: 'TEST', status: 'screening' }]),
      RESEARCH_DEMAND_TO_TICKER_GAP: 'Financial transmission missing.',
      RESEARCH_FATAL_GATE_REVIEW_JSON: JSON.stringify([{ gate: 'Direct business relationship to bottleneck', status: 'unknown' }]),
      RESEARCH_PRICING_GAP: 'Pricing gap missing.',
      RESEARCH_NEXT_DECISIVE_EVIDENCE_JSON: JSON.stringify(['Supplier count review.']),
      RESEARCH_CHALLENGE_VERDICT: 'fail_upgrade.',
      RESEARCH_UPGRADE_DECISION: 'Do not upgrade.',
      RESEARCH_CHAIN_COVERAGE_JSON: JSON.stringify(serenityChain.map((name) => ({ name, status: 'partial' }))),
      RESEARCH_MISSING_LAYERS_JSON: JSON.stringify(['pricing gap']),
      RESEARCH_CHALLENGE_QUESTIONS_JSON: JSON.stringify([{ name: 'Is demand reflected in price?', status: 'unanswered' }]),
      RESEARCH_RED_TEAM_SEARCHES_JSON: JSON.stringify([
        { name: 'TEST competitor supplier', status: 'needed' },
        { name: 'TEST alternative technology', status: 'needed' },
        { name: 'TEST gross margin risk', status: 'needed' },
      ]),
      RESEARCH_REVIEWER_REQUIRED_FIXES_JSON: JSON.stringify(['Add valuation review.']),
    },
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RESEARCH_VALUATION_REVIEW_JSON/);
});
