import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSerenityDomainResearchSeed,
  getDefaultSerenityDomainWatchlist,
} from '../server/serenity-domain-scheduler.js';
import { evaluateSerenityRun } from '../server/serenity-v2.js';

test('domain scheduler seeds active research without closing or upgrading candidates', () => {
  const seed = buildSerenityDomainResearchSeed({
    domains: getDefaultSerenityDomainWatchlist(),
    domainIds: ['ai-rack-power-thermal'],
    now: '2026-06-05T00:00:00.000Z',
  });

  assert.equal(seed.runs.length, 1);
  assert.equal(seed.runs[0].id, 'domain-ai-rack-power-thermal-2026-06-05');
  assert.equal(seed.runs[0].status, 'market_discovery');
  assert.ok(seed.runs[0].candidates.length > 0);
  assert.ok(seed.runs[0].candidates.every((candidate) => candidate.status === 'discovered'));

  const validation = evaluateSerenityRun(seed.runs[0]);
  assert.equal(validation.can_close, false);
  assert.ok(validation.missing.includes('core_evidence_count'));
});

test('AI industry-chain domain seed excludes Serenity archive dependency', () => {
  const seed = buildSerenityDomainResearchSeed({
    domains: getDefaultSerenityDomainWatchlist(),
    domainIds: ['ai-industry-chain'],
    now: '2026-06-05T00:00:00.000Z',
  });

  assert.equal(seed.runs.length, 1);
  assert.equal(seed.runs[0].id, 'domain-ai-industry-chain-2026-06-05');
  assert.equal(seed.runs[0].status, 'market_discovery');
  assert.ok(seed.runs[0].markets[0].dependencies.length >= 5);
  assert.ok(seed.runs[0].candidates.every((candidate) => candidate.status === 'discovered'));
  assert.doesNotMatch(JSON.stringify(seed), /serenity-archive|Aleabitoreddit|serenity349/i);
});

test('domain scheduler is deterministic for the same date and domain', () => {
  const first = buildSerenityDomainResearchSeed({
    domains: getDefaultSerenityDomainWatchlist(),
    domainIds: ['ai-photonics-cpo'],
    now: '2026-06-04T16:30:00.000Z',
  });
  const second = buildSerenityDomainResearchSeed({
    domains: getDefaultSerenityDomainWatchlist(),
    domainIds: ['ai-photonics-cpo'],
    now: '2026-06-05T15:30:00.000Z',
  });

  assert.equal(first.runs[0].id, second.runs[0].id);
  assert.deepEqual(
    first.queueInputs.map((item) => item.id),
    second.queueInputs.map((item) => item.id)
  );
});

test('domain scheduler queues the Serenity research sequence', () => {
  const seed = buildSerenityDomainResearchSeed({
    domains: getDefaultSerenityDomainWatchlist(),
    domainIds: ['inference-memory-storage'],
    now: '2026-06-05T00:00:00.000Z',
  });

  const questions = seed.queueInputs.map((item) => item.question).join('\n');
  assert.match(questions, /顶层需求/);
  assert.match(questions, /技术路线/);
  assert.match(questions, /供应商数量/);
  assert.match(questions, /定价缺口/);
  assert.equal(seed.queueInputs.length, 4);
});

test('domain scheduler uses the configured research timezone for run ids', () => {
  const seed = buildSerenityDomainResearchSeed({
    domains: getDefaultSerenityDomainWatchlist(),
    domainIds: ['ai-rack-power-thermal'],
    now: '2026-06-04T16:30:00.000Z',
    timeZone: 'Asia/Singapore',
  });

  assert.equal(seed.runs[0].id, 'domain-ai-rack-power-thermal-2026-06-05');
  assert.equal(seed.runs[0].run_config.research_date, '2026-06-05');
});
