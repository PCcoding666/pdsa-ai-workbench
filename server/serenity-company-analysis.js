export function buildSerenityCompanyAnalysisMock(input = {}, {
  now = new Date().toISOString(),
  researchOwner = 'chengpeng',
} = {}) {
  const ticker = normalizeTicker(input.ticker || input.symbol || '');
  if (!ticker) throw new Error('ticker is required');
  const companyName = cleanText(input.companyName || input.company_name || ticker);
  const runId = `company-${ticker.toLowerCase()}-${toResearchDateSlug(now)}`;

  return {
    mode: 'MOCK',
    workflow: 'A_company_to_chain_analysis',
    generatedAt: now,
    warning: 'This is a mock workflow contract. It is not a completed Research Run, not a valuation conclusion, and not a buy/sell recommendation.',
    input: {
      ticker,
      companyName,
      researchOwner,
    },
    runDraft: {
      run_id: runId,
      run_mode: 'RESEARCH',
      research_date: toResearchDateSlug(now),
      market_data_as_of: toResearchDateSlug(now),
      status: 'queued',
      objective: `Analyze ${ticker} from the company outward: business lines, upstream suppliers, downstream customers, industry-chain positions, bottleneck exposure, financial transmission, market pricing and falsifiers.`,
    },
    requiredSequence: [
      'Define the company business segments and revenue/profit drivers.',
      'Map every material industry chain where the company participates.',
      'For each chain, identify upstream suppliers, critical inputs, downstream customers and demand drivers.',
      'Locate the company position: bottleneck owner, system integrator, substitute supplier, commodity participant or narrative beneficiary.',
      'Test business purity and whether the chain exposure can move company-level financials.',
      'Analyze market pricing: price performance, valuation, consensus, guidance, backlog, margins and narrative saturation.',
      'Run Red Team: why this company, why now, why not a larger peer, what falsifies the thesis.',
      'Output status: rejected, watchlist, active_research or candidate; do not output direct buy/sell instructions.',
    ],
    outputContract: {
      companyProfile: {
        ticker,
        companyName,
        reportCurrency: 'unknown',
        listedSecurityStatus: 'unknown',
        liquidityStatus: 'unknown',
        governanceAuditStatus: 'unknown',
      },
      industryChainMap: [
        {
          chain: 'unknown until source retrieval',
          companyPosition: 'unknown',
          upstream: [],
          downstream: [],
          substitutes: [],
          bottleneckClaim: 'unknown',
          evidenceNeeded: ['10-K / annual report segment notes', 'investor presentation', 'customer or supplier disclosure'],
        },
      ],
      financialTransmission: {
        revenueExposure: 'unknown',
        grossMarginPath: 'unknown',
        utilizationOrBacklogPath: 'unknown',
        capexOrWorkingCapitalRisk: 'unknown',
      },
      pricingGap: {
        pricePerformance3m: 'unknown',
        pricePerformance6m: 'unknown',
        pricePerformance12m: 'unknown',
        valuationVsHistory: 'unknown',
        consensusRevision: 'unknown',
        whatIsPriced: 'unknown',
        whatMayNotBePriced: 'unknown',
      },
      redTeam: {
        strongestBearCase: 'unknown',
        immediateRejectionFact: 'unknown',
        confidenceReducer: 'unknown',
        falsifier: 'unknown',
      },
    },
    nextActions: [
      `Fetch ${ticker} latest 10-K/20-F/annual report and investor presentation.`,
      'Extract segment revenue and business descriptions into companyProfile.',
      'Map at least two industry chains before any candidate status upgrade.',
      'Keep result as active_research or rejected unless Fatal Gate and evidence independence pass.',
    ],
  };
}

function normalizeTicker(value) {
  return cleanText(value).replace(/^\$/g, '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
}

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function toResearchDateSlug(value, timeZone = process.env.TZ || 'Asia/Singapore') {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return 'unknown';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}
