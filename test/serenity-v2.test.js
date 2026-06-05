import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SERENITY_CHALLENGE_FIELDS,
  SERENITY_FATAL_GATES,
  buildSerenityObsidianNote,
  canTransitionSerenityRun,
  evaluateSerenityCandidate,
  evaluateSerenityRun,
} from '../server/serenity-v2.js';

function buildPassingRun() {
  const fatalGates = Object.fromEntries(SERENITY_FATAL_GATES.map((gate) => [gate, { passed: true, evidence: 'Verified.' }]));
  const challengeGate = Object.fromEntries(SERENITY_CHALLENGE_FIELDS.map((field) => [field, 'Answered with observable evidence.']));
  const evidence = [
    ['candidate-company-ir', 'candidate_company', true],
    ['customer-official', 'customer_official', false],
    ['government-report', 'government_report', false],
  ].map(([id, family, candidateCompany], index) => ({
    id,
    source: id,
    original_source: id,
    source_type: index === 2 ? 'government_report' : 'official_company',
    published_at: '2026-05-01',
    accessed_at: '2026-06-04',
    author_or_institution: id,
    url: `https://example.com/${id}`,
    is_original_source: true,
    is_independent_source: true,
    is_candidate_company_source: candidateCompany,
    source_family: family,
    allowed_use: 'core_evidence',
    applicable_claims: ['Demand and bottleneck claim'],
    claim_status: 'supported',
    finding: 'Relevant evidence.',
    limitations: 'Does not prove every downstream financial outcome.',
    confidence_impact: 'raise',
  }));

  return {
    id: 'run-test-001',
    title: 'Test Serenity Research Run',
    objective: 'Test the V2 close gate.',
    status: 'closed_candidate_found',
    run_config: {
      run_id: 'run-test-001',
      run_mode: 'RESEARCH',
      research_date: '2026-06-04',
      market_data_as_of: '2026-06-04',
      investment_universe: 'US listed equities',
      included_exchanges: ['NYSE', 'Nasdaq'],
      included_regions: ['United States'],
      excluded_security_types: ['OTC', 'Funds'],
      market_cap_min: 100000000,
      market_cap_max: 10000000000,
      minimum_average_daily_traded_value: 1000000,
      maximum_analyst_coverage: 10,
      minimum_revenue_exposure: 0.1,
      maximum_supplier_count_for_bottleneck: 3,
      minimum_capacity_expansion_lead_time: '12 months',
      source_budget: 20,
      search_budget: 40,
      research_owner: 'test',
      system_version: '2.0.0',
      skill_version: 'test-skill@1',
    },
    topLevelDemand: 'Budgeted demand for a new system architecture increased.',
    currentAnswer: 'A candidate survives the current evidence and challenge gates.',
    searchLedger: Array.from({ length: 5 }, (_, index) => ({ source: `search-${index + 1}` })),
    evidenceLedger: evidence,
    reasoningLedger: [{ hypothesis: 'Demand reaches the bottleneck.', inference: 'Supported.', claimStatus: 'supported' }],
    challengeLedger: [
      { challenge: 'Why now?', result: 'Architecture changed.' },
      { challenge: 'Is the bottleneck scarce?', result: 'Supplier count and lead time are constrained.' },
      { challenge: 'Strongest bear case?', result: 'Substitution or rapid capacity expansion.' },
    ],
    keyConclusions: [{ conclusion: 'The bottleneck is supported.', status: 'supported' }],
    markets: [
      {
        market: 'Test bottleneck market',
        technologyRoutes: ['Primary route'],
        alternativeRoutes: ['Alternative route investigated'],
        dependencies: [{ name: 'System' }, { name: 'Component' }, { name: 'Material' }],
        investigationDirections: ['customer', 'supplier', 'technology', 'regulatory'],
        unknowns: ['Exact quarterly utilization remains unknown.'],
        firstOrderDependencySearchSaturated: true,
        independentChallengeReviewCompleted: true,
        bottleneckStatus: 'identified',
        supplierCount: '2 credible suppliers',
        supplierCountBasis: 'Customer and supplier primary-source disclosures.',
        capacityExpansionLeadTime: 'At least 12 months.',
        listedCarriers: ['TEST'],
        financialPath: 'Demand raises utilization, revenue and gross margin.',
        pricingGap: 'Consensus does not include the new utilization scenario.',
      },
    ],
    candidates: [
      {
        ticker: 'TEST',
        name: 'Test Company',
        status: 'high_conviction_candidate',
        scores: {
          bottleneck_strength: 18,
          supplier_concentration: 13,
          substitution_difficulty: 9,
          capacity_constraint: 9,
          business_purity: 13,
          financial_elasticity: 9,
          pricing_gap: 8,
          catalyst_clarity: 4,
          risk_observability: 5,
        },
        fatal_gates: fatalGates,
        challenge_gate: challengeGate,
        key_falsifier: 'A new qualified supplier removes scarcity.',
        financial_path: 'Higher utilization and pricing reach company-level results.',
      },
    ],
    rejected: [{ target: 'LARGE', reason: 'Demand anchor, not a pure carrier.' }],
    pricingAnalyses: [
      {
        ticker: 'TEST',
        price_performance_3m: 'Flat',
        price_performance_6m: 'Flat',
        price_performance_12m: 'Up modestly',
        market_cap: '$1bn',
        enterprise_value: '$900m',
        valuation_vs_history: 'Near median',
        consensus_changes: 'No material revision',
        guidance_changes: 'No explicit new demand guide',
        capex_and_capacity: 'Capacity remains constrained',
        orders_backlog_or_utilization: 'Utilization has room to rise',
        gross_margin_change: 'Stable',
        ir_theme_emphasis: 'Theme is not heavily emphasized',
        analyst_coverage: 'Low',
        what_is_priced: 'Existing business',
        what_may_not_be_priced: 'New bottleneck demand',
        good_industry: 'Demand is growing',
        good_company: 'Direct exposure is supported',
        good_stock: 'Valuation is not extreme',
        unpriced_opportunity: 'Consensus lacks the utilization scenario',
      },
    ],
    unknowns: ['Exact customer timing remains unknown.'],
    falsifiers: ['A new qualified supplier removes scarcity.'],
    closureReport: 'The run closes with one surviving candidate and explicit falsifiers.',
    stateTransitions: [
      {
        changedAt: '2026-06-04T00:00:00.000Z',
        fromStatus: 'challenge_review',
        toStatus: 'closed_candidate_found',
        reason: 'All close criteria passed.',
        relatedEvidence: ['customer-official'],
        actor: 'test',
      },
    ],
    candidateStateLedger: [
      {
        target: 'TEST',
        changedAt: '2026-06-04T00:00:00.000Z',
        fromStatus: 'active_research',
        toStatus: 'high_conviction_candidate',
        reason: 'Fatal Gate and Challenge Gate passed.',
        relatedEvidence: ['customer-official'],
        actor: 'test',
      },
    ],
    thesisVersionLedger: [
      {
        version: 'v1',
        changedAt: '2026-06-04T00:00:00.000Z',
        changeType: 'created',
        conclusion: 'One candidate survives.',
        reason: 'Close criteria passed.',
        evidenceIds: ['customer-official'],
        actor: 'test',
      },
    ],
    sync: {
      dashboard: { status: 'success' },
      obsidian: { status: 'success', last_synced_at: '2026-06-04T00:00:00.000Z' },
    },
    nextQueue: [{ priority: 1, task: 'Monitor supplier qualification.', falsifier: 'New supplier qualifies.' }],
  };
}

test('state machine rejects direct close before challenge review', () => {
  assert.equal(canTransitionSerenityRun('market_discovery', 'closed_candidate_found'), false);
  assert.equal(canTransitionSerenityRun('challenge_review', 'closed_candidate_found'), true);
});

test('run id must match the recorded research configuration', () => {
  const run = buildPassingRun();
  run.run_config.run_id = 'different-run-id';
  const result = evaluateSerenityRun(run, { targetStatus: 'closed_candidate_found' });

  assert.ok(result.missing.includes('run_id_consistency'));
});

test('high conviction candidate requires Fatal Gate and Challenge Gate', () => {
  const result = evaluateSerenityCandidate({
    ticker: 'TEST',
    status: 'high_conviction_candidate',
    key_falsifier: 'Observable falsifier.',
  });

  assert.equal(result.eligible_for_high_conviction, false);
  assert.equal(result.status_violation, true);
  assert.ok(result.failed_fatal_gates.length > 0);
  assert.ok(result.missing_challenges.length > 0);
});

test('fully populated run passes the close gate', () => {
  const result = evaluateSerenityRun(buildPassingRun(), {
    targetStatus: 'closed_candidate_found',
    now: '2026-06-04T00:00:00.000Z',
  });

  assert.equal(result.coverage_status, 'coverage_sufficient');
  assert.equal(result.can_close, true, result.missing.join(', '));
  assert.deepEqual(result.missing, []);
});

test('duplicated source family does not satisfy evidence independence', () => {
  const run = buildPassingRun();
  run.evidenceLedger = run.evidenceLedger.map((row) => ({
    ...row,
    source_type: 'government_report',
    is_candidate_company_source: false,
    source_family: 'same-family',
  }));
  const result = evaluateSerenityRun(run, { targetStatus: 'closed_candidate_found' });

  assert.equal(result.can_close, false);
  assert.ok(result.missing.includes('independent_source_families'));
});

test('company materials are one source family even when caller labels them differently', () => {
  const run = buildPassingRun();
  run.evidenceLedger = run.evidenceLedger.map((row, index) => ({
    ...row,
    original_source: `Candidate company document ${index + 1}`,
    author_or_institution: 'Same Candidate Company',
    source_type: index === 0 ? 'official_company' : 'sec_filing',
    is_candidate_company_source: true,
    source_family: `caller-family-${index}`,
  }));
  const result = evaluateSerenityRun(run, { targetStatus: 'closed_candidate_found' });

  assert.equal(result.metrics.independent_source_families, 1);
  assert.ok(result.missing.includes('independent_source_families'));
});

test('company filings remain one source family even when not marked as candidate-company sources', () => {
  const run = buildPassingRun();
  run.evidenceLedger = run.evidenceLedger.map((row, index) => ({
    ...row,
    original_source: `Company filing ${index + 1}`,
    author_or_institution: 'Same Filing Company',
    source_type: index === 0 ? 'sec_filing' : 'exchange_filing',
    is_candidate_company_source: false,
    source_family: `caller-family-${index}`,
  }));
  const result = evaluateSerenityRun(run, { targetStatus: 'closed_candidate_found' });

  assert.equal(result.metrics.independent_source_families, 1);
  assert.ok(result.missing.includes('independent_source_families'));
});

test('evidence metadata must record candidate-company source status', () => {
  const run = buildPassingRun();
  delete run.evidenceLedger[0].is_candidate_company_source;
  const result = evaluateSerenityRun(run, { targetStatus: 'closed_candidate_found' });

  assert.ok(result.missing.includes('evidence_metadata_complete'));
});

test('candidate close requires every score dimension to be explicitly recorded', () => {
  const run = buildPassingRun();
  delete run.candidates[0].scores.pricing_gap;
  const result = evaluateSerenityRun(run, { targetStatus: 'closed_candidate_found' });

  assert.ok(result.missing.includes('candidate_scores'));
});

test('normalized zero-value score defaults do not count as explicitly recorded dimensions', () => {
  const run = buildPassingRun();
  run.candidates[0].scoreFieldsRecorded = [];
  const result = evaluateSerenityRun(run, { targetStatus: 'closed_candidate_found' });

  assert.ok(result.missing.includes('candidate_scores'));
});

test('candidate state ledger requires auditable metadata', () => {
  const run = buildPassingRun();
  delete run.candidateStateLedger[0].actor;
  const result = evaluateSerenityRun(run, { targetStatus: 'closed_candidate_found' });

  assert.ok(result.missing.includes('candidate_state_ledger'));
});

test('historical state ledger rejects an illegal transition', () => {
  const run = buildPassingRun();
  run.stateTransitions[0].fromStatus = 'market_discovery';
  const result = evaluateSerenityRun(run, { targetStatus: 'closed_candidate_found' });

  assert.ok(result.missing.includes('state_transition_ledger'));
});

test('numeric research thresholds reject descriptive text without an exception', () => {
  const run = buildPassingRun();
  run.run_config.maximum_supplier_count_for_bottleneck = 'Industry-specific supplier limit';
  const result = evaluateSerenityRun(run, { targetStatus: 'closed_candidate_found' });

  assert.ok(result.missing.includes('run_config_complete'));
  assert.match(
    result.checks.find((item) => item.id === 'run_config_complete').detail,
    /maximum_supplier_count_for_bottleneck/
  );
});

test('industry-specific threshold exception requires a reason and alternative criteria', () => {
  const run = buildPassingRun();
  run.run_config.maximum_supplier_count_for_bottleneck = '';
  run.run_config.threshold_exceptions = {
    maximum_supplier_count_for_bottleneck: {
      reason: 'Supplier relevance depends on qualified production capacity rather than a raw company count.',
      alternative_criteria: 'Record every supplier with qualified volume production and its share of qualified capacity.',
    },
  };
  const result = evaluateSerenityRun(run, { targetStatus: 'closed_candidate_found' });

  assert.equal(result.can_close, true, result.missing.join(', '));
});

test('closed_no_candidate can record that listed-carrier screening found no carrier', () => {
  const run = buildPassingRun();
  run.status = 'closed_no_candidate';
  run.candidates = [];
  run.candidateStateLedger = [];
  run.noCandidateExplanation = 'No listed carrier has direct, material exposure to the bottleneck.';
  run.markets[0].listedCarriers = [];
  run.markets[0].listedCarrierScreening = 'Screened the credible suppliers; none is a tradable listed security.';
  run.pricingAnalyses = [];
  run.stateTransitions[0].toStatus = 'closed_no_candidate';
  const result = evaluateSerenityRun(run, { targetStatus: 'closed_no_candidate' });

  assert.equal(result.can_close, true, result.missing.join(', '));
});

test('Obsidian note contains audit boundary and run id', () => {
  const run = buildPassingRun();
  const validation = evaluateSerenityRun(run, { targetStatus: 'closed_candidate_found' });
  const note = buildSerenityObsidianNote(run, validation);

  assert.match(note, /run_id: "run-test-001"/);
  assert.match(note, /not a guarantee of return or a buy\/sell recommendation/);
  assert.match(note, /## Validation/);
});
