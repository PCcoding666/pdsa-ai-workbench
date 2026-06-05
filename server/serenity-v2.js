export const SERENITY_PROTOCOL_VERSION = '2.0.0';

export const SERENITY_RUN_MODES = ['BUILD', 'RESEARCH', 'MAINTENANCE', 'REVIEW'];

export const SERENITY_RUN_STATUSES = [
  'queued',
  'market_discovery',
  'supply_chain_mapping',
  'candidate_screening',
  'evidence_collection',
  'pricing_analysis',
  'challenge_review',
  'active_research',
  'closed_no_candidate',
  'closed_candidate_found',
  'blocked',
];

export const SERENITY_CANDIDATE_STATUSES = [
  'discovered',
  'screening',
  'active_research',
  'watchlist',
  'high_conviction_candidate',
  'downgraded',
  'rejected',
  'invalidated',
];

export const SERENITY_CLAIM_STATUSES = ['confirmed', 'supported', 'plausible', 'unknown', 'contradicted'];

export const SERENITY_ALLOWED_USES = [
  'core_evidence',
  'structured_cache',
  'consensus_gap',
  'discovery_trigger',
  'reject',
];

export const SERENITY_COMPANY_SOURCE_TYPES = [
  'official_company',
  'company_ir',
  'company_filing',
  'company_presentation',
  'earnings_call',
  'sec_filing',
  'exchange_filing',
];

export const SERENITY_FATAL_GATES = [
  'tradable_listed_security',
  'liquidity_meets_threshold',
  'data_verifiable',
  'direct_bottleneck_link',
  'purity_or_financial_elasticity',
  'not_single_rumor',
  'governance_audit_going_concern_risk_addressed',
  'no_fast_substitution_evidence',
  'not_selected_for_small_cap_only',
];

export const SERENITY_SCORE_DIMENSIONS = {
  bottleneck_strength: 20,
  supplier_concentration: 15,
  substitution_difficulty: 10,
  capacity_constraint: 10,
  business_purity: 15,
  financial_elasticity: 10,
  pricing_gap: 10,
  catalyst_clarity: 5,
  risk_observability: 5,
};

export const SERENITY_CHALLENGE_FIELDS = [
  'why_now',
  'why_not_large_cap_leader',
  'is_bottleneck_irreplaceable',
  'other_suppliers_missing',
  'supplier_count_accuracy',
  'alternative_technology_route',
  'demand_already_priced',
  'business_purity',
  'financial_offset_risk',
  'capacity_expansion_destroys_scarcity',
  'strongest_bear_case',
  'direct_falsifier',
  'confidence_downgrade_trigger',
  'immediate_rejection_trigger',
];

const CONFIG_FIELDS = [
  'run_id',
  'run_mode',
  'research_date',
  'market_data_as_of',
  'investment_universe',
  'included_exchanges',
  'included_regions',
  'excluded_security_types',
  'market_cap_min',
  'market_cap_max',
  'minimum_average_daily_traded_value',
  'maximum_analyst_coverage',
  'minimum_revenue_exposure',
  'maximum_supplier_count_for_bottleneck',
  'minimum_capacity_expansion_lead_time',
  'source_budget',
  'search_budget',
  'research_owner',
  'system_version',
  'skill_version',
];

const THRESHOLD_FIELDS = [
  'market_cap_min',
  'market_cap_max',
  'minimum_average_daily_traded_value',
  'maximum_analyst_coverage',
  'minimum_revenue_exposure',
  'maximum_supplier_count_for_bottleneck',
  'minimum_capacity_expansion_lead_time',
];

const NUMERIC_THRESHOLD_FIELDS = [
  'market_cap_min',
  'market_cap_max',
  'minimum_average_daily_traded_value',
  'maximum_analyst_coverage',
  'minimum_revenue_exposure',
  'maximum_supplier_count_for_bottleneck',
];

const CLOSED_STATUSES = new Set(['closed_no_candidate', 'closed_candidate_found']);
const COMPANY_SOURCE_TYPES = new Set(SERENITY_COMPANY_SOURCE_TYPES);

const TRANSITIONS = {
  queued: ['market_discovery', 'blocked'],
  market_discovery: ['supply_chain_mapping', 'active_research', 'blocked'],
  supply_chain_mapping: ['candidate_screening', 'active_research', 'blocked'],
  candidate_screening: ['evidence_collection', 'active_research', 'blocked'],
  evidence_collection: ['pricing_analysis', 'active_research', 'blocked'],
  pricing_analysis: ['challenge_review', 'active_research', 'blocked'],
  challenge_review: ['active_research', 'closed_no_candidate', 'closed_candidate_found', 'blocked'],
  active_research: [
    'market_discovery',
    'supply_chain_mapping',
    'candidate_screening',
    'evidence_collection',
    'pricing_analysis',
    'challenge_review',
    'closed_no_candidate',
    'closed_candidate_found',
    'blocked',
  ],
  blocked: [
    'queued',
    'market_discovery',
    'supply_chain_mapping',
    'candidate_screening',
    'evidence_collection',
    'pricing_analysis',
    'challenge_review',
    'active_research',
  ],
  closed_no_candidate: [],
  closed_candidate_found: [],
};

export function canTransitionSerenityRun(fromStatus, toStatus) {
  if (!SERENITY_RUN_STATUSES.includes(toStatus)) return false;
  if (!fromStatus || fromStatus === toStatus) return true;
  return (TRANSITIONS[fromStatus] || []).includes(toStatus);
}

export function scoreSerenityCandidate(candidate = {}) {
  const scores = candidate.scores && typeof candidate.scores === 'object' ? candidate.scores : {};
  const normalized = {};
  let total = 0;

  Object.entries(SERENITY_SCORE_DIMENSIONS).forEach(([key, max]) => {
    const value = clampNumber(scores[key], 0, max, 0);
    normalized[key] = value;
    total += value;
  });

  return {
    scores: normalized,
    total_score: Math.round(total * 100) / 100,
  };
}

export function evaluateSerenityCandidate(candidate = {}) {
  const score = scoreSerenityCandidate(candidate);
  const scoreFieldsComplete = hasCompleteCandidateScores(candidate);
  const fatalGates = candidate.fatal_gates && typeof candidate.fatal_gates === 'object' ? candidate.fatal_gates : {};
  const fatalGateResults = SERENITY_FATAL_GATES.map((gate) => {
    const value = fatalGates[gate];
    const evidence = cleanText(value?.evidence || value?.basis || '');
    const passed = (value === true || value?.passed === true) && Boolean(evidence);
    return {
      gate,
      passed,
      evidence,
    };
  });
  const failedFatalGates = fatalGateResults.filter((item) => !item.passed).map((item) => item.gate);
  const challengeGate = candidate.challenge_gate && typeof candidate.challenge_gate === 'object' ? candidate.challenge_gate : {};
  const missingChallenges = SERENITY_CHALLENGE_FIELDS.filter((field) => !cleanText(challengeGate[field]));
  const eligibleForHighConviction =
    failedFatalGates.length === 0 &&
    missingChallenges.length === 0 &&
    Boolean(cleanText(candidate.key_falsifier || candidate.keyFalsifier || ''));
  const requestedStatus = cleanText(candidate.status || 'screening');
  const statusViolation = requestedStatus === 'high_conviction_candidate' && !eligibleForHighConviction;

  return {
    ticker: cleanText(candidate.ticker || ''),
    name: cleanText(candidate.name || ''),
    status: requestedStatus,
    ...score,
    score_fields_complete: scoreFieldsComplete,
    fatal_gate_passed: failedFatalGates.length === 0,
    failed_fatal_gates: failedFatalGates,
    missing_challenges: missingChallenges,
    eligible_for_high_conviction: eligibleForHighConviction,
    status_violation: statusViolation,
  };
}

export function evaluateSupplyChainCoverage(run = {}) {
  const markets = Array.isArray(run.markets) ? run.markets : [];
  const activeMarkets = markets.filter((market) => !['rejected', 'invalidated'].includes(cleanText(market.status)));
  const marketResults = activeMarkets.map((market) => {
    const technologyRoutes = arrayValue(market.technology_routes || market.technologyRoutes);
    const alternativeRoutes = arrayValue(market.alternative_routes || market.alternativeRoutes);
    const dependencies = arrayValue(market.dependencies || market.dependency_levels || market.dependencyLevels);
    const directions = new Set(arrayValue(market.investigation_directions || market.investigationDirections).map(cleanText));
    const unknowns = arrayValue(market.unknowns);
    const checks = {
      technology_routes: technologyRoutes.length > 0,
      alternative_routes: alternativeRoutes.length > 0,
      dependency_levels: dependencies.length >= 3,
      customer_direction: directions.has('customer'),
      supplier_direction: directions.has('supplier'),
      technology_direction: directions.has('technology'),
      regulatory_direction: directions.has('regulatory'),
      unknowns_recorded: unknowns.length > 0,
      first_order_search_saturated:
        market.first_order_dependency_search_saturated === true || market.firstOrderDependencySearchSaturated === true,
      independent_challenge_review:
        market.independent_challenge_review_completed === true || market.independentChallengeReviewCompleted === true,
    };
    const coverageSufficient = Object.values(checks).every(Boolean);
    return {
      market: cleanText(market.market || market.title || ''),
      declared_coverage_status: cleanText(market.coverage_status || market.coverageStatus || ''),
      computed_coverage_status: coverageSufficient ? 'coverage_sufficient' : 'coverage_insufficient',
      checks,
    };
  });

  return {
    coverage_status:
      marketResults.length > 0 && marketResults.every((market) => market.computed_coverage_status === 'coverage_sufficient')
        ? 'coverage_sufficient'
        : 'coverage_insufficient',
    market_results: marketResults,
  };
}

export function evaluateSerenityRun(run = {}, options = {}) {
  const targetStatus = cleanText(options.targetStatus || run.status || 'active_research');
  const config = run.run_config && typeof run.run_config === 'object' ? run.run_config : {};
  const searchLedger = arrayValue(run.search_ledger || run.searchLedger);
  const evidenceLedger = arrayValue(run.evidence_ledger || run.evidenceLedger);
  const reasoningLedger = arrayValue(run.reasoning_ledger || run.reasoningLedger);
  const challengeLedger = arrayValue(run.challenge_ledger || run.challengeLedger);
  const stateTransitions = arrayValue(run.state_transitions || run.stateTransitions);
  const candidateStateLedger = arrayValue(run.candidate_state_ledger || run.candidateStateLedger);
  const thesisVersionLedger = arrayValue(run.thesis_version_ledger || run.thesisVersionLedger);
  const candidates = arrayValue(run.candidates);
  const rejected = arrayValue(run.rejected);
  const nextQueue = arrayValue(run.next_queue || run.nextQueue);
  const unknowns = arrayValue(run.unknowns);
  const keyConclusions = arrayValue(run.key_conclusions || run.keyConclusions);
  const pricingAnalyses = arrayValue(run.pricing_analyses || run.pricingAnalyses);
  const candidateResults = candidates.map(evaluateSerenityCandidate);
  const candidateScoresComplete = candidates.every(hasCompleteCandidateScores);
  const coverage = evaluateSupplyChainCoverage(run);
  const coreEvidence = evidenceLedger.filter((row) => cleanText(row.allowed_use || row.allowedUse) === 'core_evidence');
  const independentFamilies = new Set(
    coreEvidence
      .filter((row) => row.is_independent_source === true || row.isIndependentSource === true)
      .map(getEvidenceSourceFamily)
      .filter(Boolean)
  );
  const configMissing = getMissingConfigFields(config);
  const survivingCandidates = candidates.filter(
    (candidate) => !['rejected', 'invalidated'].includes(cleanText(candidate.status || 'screening'))
  );
  const highConvictionViolations = candidateResults.filter((candidate) => candidate.status_violation);
  const stateTransitionLedgerComplete =
    stateTransitions.length > 0 && stateTransitions.every(hasCompleteStateTransition);
  const candidateStateLedgerComplete =
    candidates.length === 0 ||
    (candidateStateLedger.length > 0 &&
      candidateStateLedger.every(hasCompleteCandidateStateRow) &&
      candidates.every((candidate) => candidateHasStateLedgerRow(candidate, candidateStateLedger)));
  const thesisVersionLedgerComplete =
    thesisVersionLedger.length > 0 && thesisVersionLedger.every(hasCompleteThesisVersionRow);
  const evidenceMetadataComplete =
    evidenceLedger.length > 0 &&
    evidenceLedger.every((row) => {
      const hasLocator = Boolean(cleanText(row.url || row.file_path || row.filePath));
      const hasBooleans =
        typeof (row.is_original_source ?? row.isOriginalSource) === 'boolean' &&
        typeof (row.is_independent_source ?? row.isIndependentSource) === 'boolean' &&
        typeof (row.is_candidate_company_source ?? row.isCandidateCompanySource) === 'boolean';
      return (
        Boolean(cleanText(row.original_source || row.originalSource || row.source)) &&
        Boolean(cleanText(row.source_type || row.sourceType)) &&
        Boolean(cleanText(row.published_at || row.publishedAt)) &&
        Boolean(cleanText(row.accessed_at || row.accessedAt)) &&
        Boolean(cleanText(row.author_or_institution || row.authorOrInstitution)) &&
        hasLocator &&
        hasBooleans &&
        Boolean(cleanText(row.source_family || row.sourceFamily)) &&
        arrayValue(row.applicable_claims || row.applicableClaims).length > 0 &&
        Boolean(cleanText(row.limitations)) &&
        Boolean(cleanText(row.confidence_impact || row.confidenceImpact))
      );
    });
  const skillCandidates = arrayValue(run.skill_candidates || run.skillCandidates);
  const invalidSkillCandidates = skillCandidates.filter((item) => {
    const status = cleanText(item.status || 'skill_candidate');
    const independentRuns = arrayValue(item.independent_run_ids || item.independentRunIds);
    if (status === 'validated_skill_candidate') return independentRuns.length < 2;
    if (status === 'published_skill') {
      return independentRuns.length < 2 || !cleanText(item.review_notes || item.reviewNotes) || !cleanText(item.method);
    }
    return false;
  });
  const completePricingAnalyses = pricingAnalyses.filter(hasPricingAnalysisFields);
  const pricingComplete =
    pricingAnalyses.length > 0 &&
    completePricingAnalyses.length === pricingAnalyses.length &&
    survivingCandidates.every((candidate) => candidateHasPricingAnalysis(candidate, completePricingAnalyses));
  const marketFinancialPaths = arrayValue(run.markets).filter((market) =>
    cleanText(market.financial_path || market.financialPath)
  );
  const marketPricingGaps = arrayValue(run.markets).filter((market) =>
    cleanText(market.pricing_gap || market.pricingGap)
  );
  const specificFalsifiers = uniqueStrings([
    ...arrayValue(run.falsifiers),
    ...candidates.map((candidate) => candidate.key_falsifier || candidate.keyFalsifier),
  ]);
  const sync = run.sync && typeof run.sync === 'object' ? run.sync : {};
  const dashboardSync = sync.dashboard && typeof sync.dashboard === 'object' ? sync.dashboard : {};
  const obsidianSync = sync.obsidian && typeof sync.obsidian === 'object' ? sync.obsidian : {};
  const noCandidateExplanation = cleanText(run.no_candidate_explanation || run.noCandidateExplanation);

  const checks = [
    check('run_config_complete', 'Research configuration is complete', configMissing.length === 0, configMissing.join(', ')),
    check(
      'run_id_consistency',
      'Research Run ID matches run configuration',
      Boolean(cleanText(run.id) && cleanText(config.run_id) === cleanText(run.id))
    ),
    check('run_mode_research', 'Run mode is RESEARCH', cleanText(config.run_mode) === 'RESEARCH', cleanText(config.run_mode)),
    check('top_level_demand', 'Top-level demand change is defined', Boolean(cleanText(run.top_level_demand || run.topLevelDemand))),
    check(
      'research_dates',
      'Research date and market data as-of are recorded',
      Boolean(cleanText(config.research_date) && cleanText(config.market_data_as_of))
    ),
    check(
      'technology_routes',
      'Major technology routes are covered',
      arrayValue(run.markets).length > 0 &&
        arrayValue(run.markets).every((market) => arrayValue(market.technology_routes || market.technologyRoutes).length > 0)
    ),
    check(
      'supply_chain_coverage',
      'Supply-chain map reaches coverage_sufficient',
      coverage.coverage_status === 'coverage_sufficient'
    ),
    check(
      'bottleneck_identified',
      'A bottleneck is identified or explicitly ruled out',
      arrayValue(run.markets).length > 0 &&
        arrayValue(run.markets).every((market) =>
          ['identified', 'none_found'].includes(cleanText(market.bottleneck_status || market.bottleneckStatus))
        )
    ),
    check(
      'supplier_landscape',
      'Supplier count and basis are recorded',
      arrayValue(run.markets).length > 0 &&
        arrayValue(run.markets).every(
          (market) =>
            Boolean(cleanText(market.supplier_count || market.supplierCount)) &&
            Boolean(cleanText(market.supplier_count_basis || market.supplierCountBasis))
        )
    ),
    check(
      'capacity_expansion_lead_time',
      'Capacity expansion lead time is recorded',
      arrayValue(run.markets).length > 0 &&
        arrayValue(run.markets).every((market) =>
          Boolean(cleanText(market.capacity_expansion_lead_time || market.capacityExpansionLeadTime))
        )
    ),
    check(
      'listed_carriers_screened',
      'Investable listed carriers are screened',
      arrayValue(run.markets).length > 0 &&
        arrayValue(run.markets).every(
          (market) =>
            arrayValue(market.listed_carriers || market.listedCarriers || market.publicCarriers).length > 0 ||
            Boolean(cleanText(market.listed_carrier_screening || market.listedCarrierScreening))
        )
    ),
    check(
      'candidate_or_rejection',
      'Candidates or explicit rejections are recorded',
      candidates.length > 0 || rejected.length > 0 || Boolean(noCandidateExplanation)
    ),
    check(
      'financial_path',
      'Financial transmission path is recorded',
      marketFinancialPaths.length > 0 || candidates.some((candidate) => cleanText(candidate.financial_path || candidate.financialPath))
    ),
    check(
      'pricing_analysis',
      'Market expectations and pricing gap are analyzed',
      pricingComplete || (targetStatus === 'closed_no_candidate' && marketPricingGaps.length > 0)
    ),
    check('search_ledger', 'Search ledger is recorded', searchLedger.length >= 5, `${searchLedger.length}/5`),
    check('evidence_ledger', 'Evidence ledger is recorded', evidenceLedger.length > 0, `${evidenceLedger.length}`),
    check('evidence_metadata_complete', 'Evidence ledger metadata is complete', evidenceMetadataComplete),
    check('core_evidence_count', 'At least three Core Evidence rows exist', coreEvidence.length >= 3, `${coreEvidence.length}/3`),
    check(
      'independent_source_families',
      'Core Evidence spans at least two independent source families',
      independentFamilies.size >= 2,
      `${independentFamilies.size}/2`
    ),
    check(
      'non_candidate_company_source',
      'At least one Core Evidence row is not from a candidate company',
      coreEvidence.some((row) => row.is_candidate_company_source === false || row.isCandidateCompanySource === false)
    ),
    check(
      'key_conclusion_labels',
      'Key conclusions use allowed confidence labels',
      keyConclusions.length > 0 &&
        keyConclusions.every((item) => SERENITY_CLAIM_STATUSES.includes(cleanText(item.status || item.claim_status || item.claimStatus)))
    ),
    check('reasoning_ledger', 'Reasoning summary ledger is recorded', reasoningLedger.length > 0),
    check(
      'challenge_review',
      'At least three answered Red Team challenges are recorded',
      challengeLedger.length >= 3 &&
        challengeLedger.every(
          (item) => Boolean(cleanText(item.challenge || item.query)) && Boolean(cleanText(item.result || item.finding))
        ),
      `${challengeLedger.length}/3`
    ),
    check('state_transition_ledger', 'Research Run state transitions are auditable', stateTransitionLedgerComplete),
    check(
      'candidate_state_ledger',
      'Candidate state changes are auditable',
      candidateStateLedgerComplete
    ),
    check('thesis_version_ledger', 'Thesis version changes are auditable', thesisVersionLedgerComplete),
    check('candidate_scores', 'Candidate score dimensions are complete', candidateScoresComplete),
    check('candidate_fatal_gates', 'Candidate Fatal Gates do not have upgrade violations', highConvictionViolations.length === 0),
    check('skill_candidate_lifecycle', 'Skill candidates follow validation and publication lifecycle', invalidSkillCandidates.length === 0),
    check('falsifiers', 'Specific falsification conditions are recorded', specificFalsifiers.length > 0),
    check('unknowns', 'Unknowns and data gaps are recorded', unknowns.length > 0),
    check('next_queue', 'Next research queue is recorded', nextQueue.length > 0),
    check('dashboard_sync', 'Dynamic dashboard sync succeeded', cleanText(dashboardSync.status) === 'success'),
    check('obsidian_sync', 'Obsidian sync succeeded', cleanText(obsidianSync.status) === 'success'),
    check('closure_report', 'Auditable closure report is recorded', Boolean(cleanText(run.closure_report || run.closureReport))),
  ];

  const requiredChecks = checks.filter((item) => item.required);
  const failedChecks = requiredChecks.filter((item) => !item.passed);
  const warnings = [];

  if (targetStatus === 'closed_candidate_found' && survivingCandidates.length === 0) {
    warnings.push('closed_candidate_found requires at least one surviving candidate.');
  }
  if (targetStatus === 'closed_no_candidate' && !noCandidateExplanation && rejected.length === 0) {
    warnings.push('closed_no_candidate requires rejected candidates or a no-candidate explanation.');
  }
  highConvictionViolations.forEach((candidate) => {
    warnings.push(`${candidate.ticker || candidate.name || 'candidate'} cannot be high_conviction_candidate before Fatal Gate and Challenge Gate pass.`);
  });

  const closeStatusConsistent =
    (targetStatus === 'closed_candidate_found' && survivingCandidates.length > 0) ||
    (targetStatus === 'closed_no_candidate' && (rejected.length > 0 || Boolean(noCandidateExplanation)));
  const canClose = failedChecks.length === 0 && closeStatusConsistent;

  return {
    protocol_version: SERENITY_PROTOCOL_VERSION,
    evaluated_at: options.now || new Date().toISOString(),
    target_status: targetStatus,
    can_close: canClose,
    coverage_status: coverage.coverage_status,
    metrics: {
      search_rows: searchLedger.length,
      evidence_rows: evidenceLedger.length,
      core_evidence_rows: coreEvidence.length,
      independent_source_families: independentFamilies.size,
      reasoning_rows: reasoningLedger.length,
      challenge_rows: challengeLedger.length,
      state_transition_rows: stateTransitions.length,
      candidate_state_rows: candidateStateLedger.length,
      thesis_version_rows: thesisVersionLedger.length,
      candidates: candidates.length,
      candidates_with_incomplete_scores: candidates.filter((candidate) => !hasCompleteCandidateScores(candidate)).length,
      surviving_candidates: survivingCandidates.length,
      rejected: rejected.length,
      next_queue_rows: nextQueue.length,
    },
    checks,
    missing: failedChecks.map((item) => item.id),
    warnings,
    candidate_results: candidateResults,
    supply_chain_coverage: coverage,
  };
}

export function buildSerenityObsidianNote(run = {}, validation = {}) {
  const config = run.run_config && typeof run.run_config === 'object' ? run.run_config : {};
  const id = cleanText(run.id || config.run_id || 'unknown-run');
  const status = cleanText(run.status || 'active_research');
  const title = cleanText(run.title || run.objective || id);
  const evidenceLedger = arrayValue(run.evidence_ledger || run.evidenceLedger);
  const challengeLedger = arrayValue(run.challenge_ledger || run.challengeLedger);
  const candidates = arrayValue(run.candidates);
  const rejected = arrayValue(run.rejected);
  const markets = arrayValue(run.markets);
  const nextQueue = arrayValue(run.next_queue || run.nextQueue);
  const unknowns = arrayValue(run.unknowns);
  const keyConclusions = arrayValue(run.key_conclusions || run.keyConclusions);
  const candidateStateLedger = arrayValue(run.candidate_state_ledger || run.candidateStateLedger);
  const thesisVersionLedger = arrayValue(run.thesis_version_ledger || run.thesisVersionLedger);
  const syncFailures = arrayValue(run.sync_failures || run.syncFailures);
  const syncedAt = cleanText(run.sync?.obsidian?.last_synced_at || run.sync?.obsidian?.lastSyncedAt || '');

  return [
    '---',
    `title: "${escapeYaml(title)}"`,
    `run_id: "${escapeYaml(id)}"`,
    `run_mode: "${escapeYaml(config.run_mode || 'RESEARCH')}"`,
    `status: "${escapeYaml(status)}"`,
    `research_date: "${escapeYaml(config.research_date || '')}"`,
    `market_data_as_of: "${escapeYaml(config.market_data_as_of || '')}"`,
    `protocol_version: "${SERENITY_PROTOCOL_VERSION}"`,
    `last_synced_at: "${escapeYaml(syncedAt)}"`,
    'tags:',
    '  - information-gain',
    '  - serenity',
    '  - research-run',
    '---',
    '',
    `# ${title}`,
    '',
    '> [!warning] Research boundary',
    '> This note is an auditable research record, not a guarantee of return or a buy/sell recommendation.',
    '',
    '## Research Run Overview',
    '',
    `- Run ID: \`${id}\``,
    `- Run mode: \`${config.run_mode || 'RESEARCH'}\``,
    `- Research date: ${config.research_date || 'unknown'}`,
    `- Market data as of: ${config.market_data_as_of || 'unknown'}`,
    `- Final/current status: \`${status}\``,
    `- Top-level demand: ${cleanText(run.top_level_demand || run.topLevelDemand) || 'unknown'}`,
    `- Current answer: ${cleanText(run.current_answer || run.currentAnswer) || 'unknown'}`,
    '',
    '## Validation',
    '',
    `- Can close: \`${validation.can_close === true ? 'yes' : 'no'}\``,
    `- Coverage status: \`${validation.coverage_status || 'coverage_insufficient'}\``,
    '',
    ...arrayValue(validation.checks).map(
      (item) => `- [${item.passed ? 'x' : ' '}] ${cleanText(item.label || item.id)}${item.detail ? ` - ${cleanText(item.detail)}` : ''}`
    ),
    '',
    '## Key Conclusions',
    '',
    ...(keyConclusions.length
      ? keyConclusions.map(
          (item) =>
            `- **${cleanText(item.status || item.claim_status || item.claimStatus || 'unknown')}**: ${cleanText(item.conclusion || item.claim || '')}`
        )
      : ['- No key conclusions recorded.']),
    '',
    '## Supply Chain And Bottleneck',
    '',
    ...(markets.length
      ? markets.flatMap((market) => [
          `### ${cleanText(market.market || market.title || 'Unnamed market')}`,
          '',
          `- Bottleneck status: \`${cleanText(market.bottleneck_status || market.bottleneckStatus || 'unknown')}\``,
          `- Chokepoint: ${cleanText(market.chokepoint || '') || 'unknown'}`,
          `- Supplier count: ${cleanText(market.supplier_count || market.supplierCount || '') || 'unknown'}`,
          `- Supplier count basis: ${cleanText(market.supplier_count_basis || market.supplierCountBasis || '') || 'unknown'}`,
          `- Capacity expansion lead time: ${cleanText(market.capacity_expansion_lead_time || market.capacityExpansionLeadTime || '') || 'unknown'}`,
          `- Financial path: ${cleanText(market.financial_path || market.financialPath || '') || 'unknown'}`,
          `- Pricing gap: ${cleanText(market.pricing_gap || market.pricingGap || '') || 'unknown'}`,
          '',
        ])
      : ['No market map recorded.', '']),
    '## Candidates And Rejections',
    '',
    ...(candidates.length
      ? candidates.map(
          (candidate) =>
            `- \`${cleanText(candidate.ticker || '') || cleanText(candidate.name || 'candidate')}\` - ${cleanText(candidate.status || 'screening')} - score ${scoreSerenityCandidate(candidate).total_score}`
        )
      : ['- No surviving candidates recorded.']),
    ...(rejected.length
      ? rejected.map((item) => `- Rejected: ${cleanText(item.target || item.ticker || '')} - ${cleanText(item.reason || '')}`)
      : []),
    '',
    '## Candidate State Ledger',
    '',
    ...(candidateStateLedger.length
      ? candidateStateLedger.map(
          (item) =>
            `- ${cleanText(item.changed_at || item.changedAt || '')} | ${cleanText(item.target || '')} | ${cleanText(item.from_status || item.fromStatus || '')} -> ${cleanText(item.to_status || item.toStatus || '')} | ${cleanText(item.reason || '')}`
        )
      : ['- No candidate state changes recorded.']),
    '',
    '## Thesis Version Ledger',
    '',
    ...(thesisVersionLedger.length
      ? thesisVersionLedger.map(
          (item) =>
            `- ${cleanText(item.version || '')} | ${cleanText(item.change_type || item.changeType || '')} | ${cleanText(item.conclusion || '')}`
        )
      : ['- No thesis versions recorded.']),
    '',
    '## Evidence Ledger',
    '',
    ...(evidenceLedger.length
      ? evidenceLedger.map(
          (row) =>
            `- ${cleanText(row.allowed_use || row.allowedUse || 'unknown')} | ${cleanText(row.source_family || row.sourceFamily || 'unknown family')} | ${cleanText(row.original_source || row.originalSource || row.source || '')} | ${cleanText(row.url || row.file_path || row.filePath || '')}`
        )
      : ['- No evidence ledger rows recorded.']),
    '',
    '## Challenge Review',
    '',
    ...(challengeLedger.length
      ? challengeLedger.map(
          (row) => `- **${cleanText(row.challenge || row.query || '')}**: ${cleanText(row.result || row.finding || '')}`
        )
      : ['- No challenge rows recorded.']),
    '',
    '## Unknowns And Limits',
    '',
    ...(unknowns.length ? unknowns.map((item) => `- ${cleanText(item)}`) : ['- No unknowns recorded.']),
    '',
    '## Closure Report',
    '',
    cleanText(run.closure_report || run.closureReport) || 'Run remains open.',
    '',
    '## Sync Failures',
    '',
    ...(syncFailures.length
      ? syncFailures.map(
          (item) => `- ${cleanText(item.failed_at || item.failedAt || '')} | ${cleanText(item.target || '')} | ${cleanText(item.error || '')}`
        )
      : ['- No sync failures recorded.']),
    '',
    '## Next Research Queue',
    '',
    ...(nextQueue.length
      ? nextQueue.map(
          (item) =>
            `- [ ] P${item.priority || 3} ${cleanText(item.task || '')} | Source: ${cleanText(item.source_to_inspect || item.sourceToInspect || '')} | Falsifier: ${cleanText(item.falsifier || '')}`
        )
      : ['- No next research tasks recorded.']),
    '',
  ].join('\n');
}

function getMissingConfigFields(config) {
  const missing = [];
  CONFIG_FIELDS.forEach((field) => {
    if (['source_budget', 'search_budget'].includes(field)) {
      if (Number(config[field]) > 0) return;
      missing.push(field);
      return;
    }
    if (THRESHOLD_FIELDS.includes(field)) {
      if (NUMERIC_THRESHOLD_FIELDS.includes(field) && typeof config[field] === 'number' && Number.isFinite(config[field])) return;
      if (field === 'minimum_capacity_expansion_lead_time' && hasValue(config[field])) return;
      if (hasThresholdException(config, field)) return;
      missing.push(field);
      return;
    }
    if (hasValue(config[field])) return;
    missing.push(field);
  });

  if (hasValue(config.run_mode) && !SERENITY_RUN_MODES.includes(cleanText(config.run_mode))) {
    missing.push('run_mode_invalid');
  }
  if (
    typeof config.market_cap_min === 'number' &&
    typeof config.market_cap_max === 'number' &&
    config.market_cap_min > config.market_cap_max
  ) {
    missing.push('market_cap_range_invalid');
  }
  return uniqueStrings(missing);
}

function hasThresholdException(config, field) {
  const exceptions =
    config.threshold_exceptions && typeof config.threshold_exceptions === 'object' ? config.threshold_exceptions : {};
  const exception = exceptions[field];
  return Boolean(cleanText(exception?.reason) && cleanText(exception?.alternative_criteria));
}

function hasPricingAnalysisFields(analysis = {}) {
  const required = [
    'price_performance_3m',
    'price_performance_6m',
    'price_performance_12m',
    'market_cap',
    'enterprise_value',
    'valuation_vs_history',
    'consensus_changes',
    'guidance_changes',
    'capex_and_capacity',
    'orders_backlog_or_utilization',
    'gross_margin_change',
    'ir_theme_emphasis',
    'analyst_coverage',
    'what_is_priced',
    'what_may_not_be_priced',
    'good_industry',
    'good_company',
    'good_stock',
    'unpriced_opportunity',
  ];
  return required.every((field) => hasValue(analysis[field]));
}

function candidateHasPricingAnalysis(candidate = {}, analyses = []) {
  const ticker = cleanText(candidate.ticker).toLowerCase();
  const market = cleanText(candidate.market).toLowerCase();
  return analyses.some((analysis) => {
    const analysisTicker = cleanText(analysis.ticker).toLowerCase();
    const analysisMarket = cleanText(analysis.market).toLowerCase();
    return Boolean((ticker && ticker === analysisTicker) || (market && market === analysisMarket));
  });
}

function hasCompleteCandidateScores(candidate = {}) {
  const scores = candidate.scores && typeof candidate.scores === 'object' ? candidate.scores : {};
  const hasRecordedFields =
    Array.isArray(candidate.score_fields_recorded) || Array.isArray(candidate.scoreFieldsRecorded);
  const recordedFields = arrayValue(candidate.score_fields_recorded || candidate.scoreFieldsRecorded);
  const recorded = new Set((hasRecordedFields ? recordedFields : Object.keys(scores)).map(cleanText));
  return Object.entries(SERENITY_SCORE_DIMENSIONS).every(([field, max]) => {
    const value = scores[field];
    return recorded.has(field) && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
  });
}

function hasCompleteStateTransition(item = {}) {
  const fromStatus = cleanText(item.from_status || item.fromStatus);
  const toStatus = cleanText(item.to_status || item.toStatus);
  return (
    Boolean(cleanText(item.changed_at || item.changedAt)) &&
    SERENITY_RUN_STATUSES.includes(fromStatus) &&
    SERENITY_RUN_STATUSES.includes(toStatus) &&
    fromStatus !== toStatus &&
    canTransitionSerenityRun(fromStatus, toStatus) &&
    Boolean(cleanText(item.reason)) &&
    arrayValue(item.related_evidence || item.relatedEvidence).length > 0 &&
    Boolean(cleanText(item.actor || item.responsible))
  );
}

function hasCompleteCandidateStateRow(item = {}) {
  const fromStatus = cleanText(item.from_status || item.fromStatus);
  const toStatus = cleanText(item.to_status || item.toStatus);
  return (
    Boolean(cleanText(item.target || item.ticker || item.name)) &&
    Boolean(cleanText(item.changed_at || item.changedAt)) &&
    SERENITY_CANDIDATE_STATUSES.includes(fromStatus) &&
    SERENITY_CANDIDATE_STATUSES.includes(toStatus) &&
    fromStatus !== toStatus &&
    Boolean(cleanText(item.reason)) &&
    arrayValue(item.related_evidence || item.relatedEvidence).length > 0 &&
    Boolean(cleanText(item.actor || item.responsible))
  );
}

function candidateHasStateLedgerRow(candidate = {}, ledger = []) {
  const identifiers = new Set([candidate.ticker, candidate.name].map((value) => cleanText(value).toLowerCase()).filter(Boolean));
  return ledger.some((item) => identifiers.has(cleanText(item.target || item.ticker || item.name).toLowerCase()));
}

function hasCompleteThesisVersionRow(item = {}) {
  return (
    Boolean(cleanText(item.version)) &&
    Boolean(cleanText(item.changed_at || item.changedAt)) &&
    Boolean(cleanText(item.change_type || item.changeType)) &&
    Boolean(cleanText(item.conclusion || item.current_answer || item.currentAnswer)) &&
    Boolean(cleanText(item.reason)) &&
    arrayValue(item.evidence_ids || item.evidenceIds).length > 0 &&
    Boolean(cleanText(item.actor || item.responsible))
  );
}

function check(id, label, passed, detail = '', required = true) {
  return {
    id,
    label,
    passed: passed === true,
    detail: cleanText(detail),
    required,
  };
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return Boolean(cleanText(value));
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return `${value}`;
  return '';
}

function uniqueStrings(items) {
  return Array.from(new Set(items.map(cleanText).filter(Boolean)));
}

function getEvidenceSourceFamily(row = {}) {
  const sourceType = cleanText(row.source_type || row.sourceType);
  const candidateCompanySource = row.is_candidate_company_source === true || row.isCandidateCompanySource === true;
  const originalSource = cleanText(row.original_source || row.originalSource || row.source);
  const companyIdentifier = cleanText(row.author_or_institution || row.authorOrInstitution) || originalSource;
  if ((COMPANY_SOURCE_TYPES.has(sourceType) || candidateCompanySource) && companyIdentifier) {
    const slug = companyIdentifier.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `company:${slug || companyIdentifier.toLowerCase()}`;
  }
  return cleanText(row.source_family || row.sourceFamily);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function escapeYaml(value) {
  return cleanText(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
