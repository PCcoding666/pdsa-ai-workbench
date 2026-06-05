import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSerenityCompanyAnalysisMock } from '../server/serenity-company-analysis.js';

test('company analysis mock returns workflow A contract for a ticker', () => {
  const result = buildSerenityCompanyAnalysisMock({
    ticker: 'NVDA',
    companyName: 'NVIDIA',
  }, {
    now: '2026-06-05T00:00:00.000Z',
  });

  assert.equal(result.mode, 'MOCK');
  assert.equal(result.workflow, 'A_company_to_chain_analysis');
  assert.equal(result.input.ticker, 'NVDA');
  assert.equal(result.runDraft.status, 'queued');
  assert.match(result.warning, /not a buy\/sell recommendation/);
  assert.ok(result.requiredSequence.some((step) => step.includes('industry chain')));
});

test('company analysis mock requires a ticker', () => {
  assert.throws(() => buildSerenityCompanyAnalysisMock({}), /ticker is required/);
});
