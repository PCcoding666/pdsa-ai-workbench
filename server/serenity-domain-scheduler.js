import crypto from 'node:crypto';
import {
  SERENITY_PROTOCOL_VERSION,
} from './serenity-v2.js';

export const DEFAULT_SERENITY_DOMAIN_CADENCE_HOURS = 24;

export function getDefaultSerenityDomainWatchlist() {
  return [
    {
      id: 'ai-industry-chain',
      title: 'AI industry chain',
      priority: 1,
      cadenceHours: 24,
      topLevelDemand: 'Enterprise, consumer and developer AI adoption is driving sustained demand for compute, memory, networking, data-center power/cooling and AI software infrastructure.',
      demandChain: [
        'AI model and application usage',
        'cloud / hyperscaler / enterprise AI capex',
        'accelerators, memory, networking and storage',
        'foundry, advanced packaging, equipment and materials',
        'data-center power, cooling and grid connection',
        'software and application monetization',
      ],
      technologyRoutes: [
        'GPU-accelerated training and inference',
        'Custom ASIC / TPU / Trainium-style accelerators',
        'High-bandwidth memory and advanced packaging',
        'Scale-out Ethernet / InfiniBand / optical interconnect',
        'High-density liquid-cooled data centers',
        'AI application and agent software layers',
      ],
      alternativeRoutes: [
        'Model efficiency reduces compute per task',
        'Custom accelerators substitute some merchant GPU demand',
        'Edge inference shifts load away from centralized data centers',
        'Power constraints slow deployment rather than shift the bottleneck',
        'Open-source models commoditize application monetization',
      ],
      dependencyLevels: [
        {
          level: 1,
          name: 'AI applications and model usage',
          type: 'demand',
          whyNecessary: 'Without durable usage and monetization, infrastructure capex can become overbuild.',
          substitutionCost: 'Low if users churn or cheaper models satisfy demand.',
        },
        {
          level: 2,
          name: 'Cloud and enterprise AI infrastructure capex',
          type: 'system',
          whyNecessary: 'Large-scale AI workloads require deployed compute capacity, networking and facilities.',
          substitutionCost: 'Capex can be delayed, shifted to partners or optimized through software.',
        },
        {
          level: 3,
          name: 'Accelerators, HBM, networking, storage and server integration',
          type: 'subsystem',
          whyNecessary: 'Compute clusters require chips, memory, interconnect and systems to work together.',
          substitutionCost: 'Changing architecture affects performance, software stack and procurement.',
        },
        {
          level: 4,
          name: 'Foundry, advanced packaging, semiconductor equipment and materials',
          type: 'manufacturing',
          whyNecessary: 'AI chips depend on leading-node wafers, CoWoS-like packaging, substrates and equipment capacity.',
          substitutionCost: 'Qualification, capex and yield ramps are slow.',
        },
        {
          level: 5,
          name: 'Data-center power, cooling and grid connection',
          type: 'physical infrastructure',
          whyNecessary: 'High-density clusters cannot deploy without power delivery, thermal management and interconnection capacity.',
          substitutionCost: 'Site design, utility coordination and equipment lead times can take quarters or years.',
        },
      ],
      companies: [
        { ticker: 'NVDA', name: 'NVIDIA', role: 'accelerator and rack-scale platform demand anchor' },
        { ticker: 'AMD', name: 'Advanced Micro Devices', role: 'accelerator alternative and CPU/GPU platform supplier' },
        { ticker: 'AVGO', name: 'Broadcom', role: 'custom silicon and networking anchor' },
        { ticker: 'TSM', name: 'Taiwan Semiconductor Manufacturing', role: 'leading-node foundry and advanced packaging anchor' },
        { ticker: 'ASML', name: 'ASML', role: 'lithography equipment bottleneck anchor' },
        { ticker: 'AMAT', name: 'Applied Materials', role: 'semiconductor equipment anchor' },
        { ticker: 'MU', name: 'Micron', role: 'HBM / DRAM / NAND memory anchor' },
        { ticker: 'ANET', name: 'Arista Networks', role: 'AI data-center networking anchor' },
        { ticker: 'VRT', name: 'Vertiv', role: 'data-center power and cooling infrastructure anchor' },
        { ticker: 'ETN', name: 'Eaton', role: 'electrical equipment and power distribution anchor' },
      ],
      sourcePlan: [
        'Hyperscaler annual reports and capex commentary: MSFT, AMZN, GOOGL, META',
        'NVIDIA official rack-scale platform documents and DGX GB hardware guide',
        'TSMC annual report and advanced packaging / CoWoS disclosures',
        'Micron AI memory and storage product / investor materials',
        'LBNL data-center energy usage report and DOE transformer / grid supply documents',
        'Candidate company 10-K / 20-F / annual reports and investor presentations',
      ],
      unknowns: [
        'Which layer has the strongest non-obvious scarcity after excluding already-dominant mega-cap anchors?',
        'Whether current capex demand is durable or vulnerable to model-efficiency gains and ROI scrutiny.',
        'Which listed carrier has enough business purity and financial elasticity to matter.',
        'How much of each layer is already reflected in price, consensus and investor narrative.',
      ],
      falsifiers: [
        'AI usage grows but infrastructure spend slows because model efficiency, custom silicon or overbuild reduces marginal capex.',
        'The most scarce layers are controlled by mega-cap incumbents or private suppliers with no clean listed carrier.',
        'Supplier counts are broad enough and expansion fast enough that no durable bottleneck exists.',
        'Financial transmission is diluted by other business lines or already fully priced by the market.',
      ],
    },
    {
      id: 'ai-rack-power-thermal',
      title: 'AI rack power and thermal architecture',
      priority: 1,
      cadenceHours: 24,
      topLevelDemand: 'Blackwell/Rubin-class rack-scale AI systems raise rack density, power delivery and thermal-management requirements.',
      demandChain: ['AI rack-scale systems', '100kW+ rack density', 'power delivery and heat removal', 'liquid cooling / switchgear / grid connection', 'deployment bottleneck'],
      technologyRoutes: ['Direct-to-chip liquid cooling', 'Rear-door heat exchangers', 'High-density rack power distribution', 'Medium-voltage data-center power architecture'],
      alternativeRoutes: ['Air cooling with lower rack density', 'Immersion cooling', 'Geographic load shifting', 'Slower cluster deployment'],
      dependencyLevels: [
        { level: 1, name: 'AI rack system', type: 'system', whyNecessary: 'High-density GPU racks need power and heat-removal paths to deploy at scale.', substitutionCost: 'Lower density or delayed deployment reduces compute economics.' },
        { level: 2, name: 'Liquid cooling and rack power distribution', type: 'subsystem', whyNecessary: 'Rack density makes air-only cooling and legacy power distribution insufficient for many deployments.', substitutionCost: 'Requires data-center redesign, new suppliers and customer qualification.' },
        { level: 3, name: 'Cold plates, CDUs, quick disconnects, pumps, switchgear and transformers', type: 'component', whyNecessary: 'Physical components determine lead time, reliability and install capacity.', substitutionCost: 'Supplier qualification and site-level integration are slow.' },
      ],
      companies: [
        { ticker: 'VRT', name: 'Vertiv', role: 'liquid cooling and power infrastructure anchor' },
        { ticker: 'MOD', name: 'Modine', role: 'thermal-management exposure to data-center cooling' },
        { ticker: 'ETN', name: 'Eaton', role: 'power distribution and electrical equipment anchor' },
        { ticker: 'POWL', name: 'Powell Industries', role: 'switchgear and electrical infrastructure watchlist' },
        { ticker: 'GEV', name: 'GE Vernova', role: 'grid and power equipment anchor' },
      ],
      sourcePlan: [
        'NVIDIA / OCP rack specifications and reference architecture',
        'Vertiv, Modine, Eaton and Powell filings / IR materials',
        'DOE, LBNL and utility interconnection reports',
        'Supplier product pages for cold plates, CDUs, quick disconnects and switchgear',
      ],
      unknowns: [
        'Which component has the fewest qualified scale suppliers?',
        'Which listed carrier has enough data-center revenue exposure to matter at company level?',
        'Whether the theme is already fully reflected in valuation and backlog expectations.',
      ],
      falsifiers: [
        'Critical cooling and electrical components have many qualified suppliers and short lead times.',
        'Data-center exposure is too small to move company-level revenue or margin.',
        'Hyperscalers redesign around the identified component bottleneck.',
      ],
    },
    {
      id: 'ai-photonics-cpo',
      title: 'AI photonics, CPO and external light sources',
      priority: 1,
      cadenceHours: 24,
      topLevelDemand: 'AI cluster bandwidth growth pushes data-center networks toward 800G/1.6T optics, silicon photonics and CPO-related architectures.',
      demandChain: ['AI training and inference clusters', 'east-west bandwidth growth', '800G / 1.6T optical interconnect', 'laser / modulator / optical engine supply', 'network deployment bottleneck'],
      technologyRoutes: ['Pluggable 800G/1.6T optics', 'CPO / silicon photonics', 'External continuous-wave laser sources', 'Linear-drive optics'],
      alternativeRoutes: ['Copper / active electrical cable for short reach', 'More switches with lower link speed', 'Internal hyperscaler optical designs'],
      dependencyLevels: [
        { level: 1, name: 'AI data-center network', type: 'system', whyNecessary: 'Cluster performance depends on high-bandwidth low-latency interconnect.', substitutionCost: 'Lower network bandwidth constrains cluster utilization.' },
        { level: 2, name: 'Optical module or CPO architecture', type: 'subsystem', whyNecessary: 'Electrical interconnect cannot cover every high-bandwidth reach and power envelope.', substitutionCost: 'Architecture and switch platform changes are costly.' },
        { level: 3, name: 'Lasers, modulators, InP wafers, optical engines and packaging/test', type: 'component', whyNecessary: 'Optical performance, yield and customer qualification depend on scarce components.', substitutionCost: 'Alternative suppliers need long validation and may not match specs.' },
      ],
      companies: [
        { ticker: 'LITE', name: 'Lumentum', role: 'laser and optical component anchor' },
        { ticker: 'COHR', name: 'Coherent', role: 'laser / optical component anchor' },
        { ticker: 'AAOI', name: 'Applied Optoelectronics', role: 'smaller optical-module watchlist' },
        { ticker: 'SIVE', name: 'Sivers Semiconductors', role: 'external laser / silicon-photonics watchlist' },
        { ticker: 'POET', name: 'POET Technologies', role: 'optical engine packaging watchlist' },
      ],
      sourcePlan: [
        'OFC / ECOC materials and vendor product pages',
        'NVIDIA, Broadcom, Marvell and switch ecosystem disclosures',
        'Lumentum, Coherent, AAOI, Sivers and POET filings / IR materials',
        'Customer qualification, yield and capacity commentary',
      ],
      unknowns: [
        'Whether the scarce layer is laser supply, InP substrate, optical engine packaging, test capacity or customer qualification.',
        'Whether smaller carriers have verified revenue exposure rather than ecosystem narrative only.',
        'How much of the CPO/light-source thesis is already priced.',
      ],
      falsifiers: [
        'CPO adoption slips materially and pluggable optics absorb demand without a new bottleneck.',
        'Large vendors internalize the scarce layer and leave no clean smaller public carrier.',
        'Candidate customer validation does not convert into orders or revenue.',
      ],
    },
    {
      id: 'advanced-packaging-materials',
      title: 'Advanced packaging materials and package-level power integrity',
      priority: 2,
      cadenceHours: 48,
      topLevelDemand: 'AI accelerators and HBM integration increase package complexity, interconnect density and power-integrity requirements.',
      demandChain: ['AI accelerator complexity', 'HBM / advanced packaging', 'substrate and package power integrity', 'glass core / silicon capacitor / compound substrate', 'qualified material bottleneck'],
      technologyRoutes: ['CoWoS-like advanced packaging', 'Glass-core substrates', 'In-package silicon capacitors', 'Compound semiconductor substrates for photonics'],
      alternativeRoutes: ['Organic substrate improvements', 'Different package architectures', 'Internal supply by large IDMs or OSATs'],
      dependencyLevels: [
        { level: 1, name: 'AI accelerator package', type: 'system', whyNecessary: 'Compute, memory and IO density depend on packaging.', substitutionCost: 'Package redesign changes performance, supply chain and validation.' },
        { level: 2, name: 'Advanced substrate and package-level passives', type: 'subsystem', whyNecessary: 'High-density interconnect and power integrity are deployment constraints.', substitutionCost: 'Yield and qualification cycles are long.' },
        { level: 3, name: 'Glass core, silicon capacitor, InP/GaAs substrates, process equipment and test', type: 'material', whyNecessary: 'Material quality and tool availability determine scale production.', substitutionCost: 'Alternative materials may lag in density, reliability or customer qualification.' },
      ],
      companies: [
        { ticker: 'AXTI', name: 'AXT', role: 'compound semiconductor substrate watchlist' },
        { ticker: '009150.KS', name: 'Samsung Electro-Mechanics', role: 'silicon capacitor and glass-core substrate anchor' },
        { ticker: 'SMTOY', name: 'Sumitomo Chemical', role: 'glass-core material partner watchlist' },
        { ticker: 'AMKR', name: 'Amkor', role: 'advanced packaging / OSAT anchor' },
        { ticker: 'MKSI', name: 'MKS Instruments', role: 'process equipment and advanced manufacturing exposure' },
      ],
      sourcePlan: [
        'Company product pages and investor presentations for substrates, silicon capacitors and packaging',
        'Patent searches around glass core, silicon capacitor and substrate processes',
        'Customer package roadmap disclosures from GPU, HBM and OSAT ecosystems',
        'Capex and capacity expansion commentary',
      ],
      unknowns: [
        'Which material is on a near-term revenue path versus a 2028+ technology option.',
        'Supplier count and qualified capacity by material.',
        'Whether public exposure is too diluted inside large diversified companies.',
      ],
      falsifiers: [
        'Material route is delayed beyond the investment horizon.',
        'Capacity expands faster than demand or many suppliers qualify quickly.',
        'Candidate revenue exposure remains too small for company-level financial transmission.',
      ],
    },
    {
      id: 'inference-memory-storage',
      title: 'Inference memory, storage and controller bottlenecks',
      priority: 2,
      cadenceHours: 48,
      topLevelDemand: 'Scaling inference, agents and retrieval-heavy workloads increases pressure on memory capacity, bandwidth, SSD performance and controller attach rates.',
      demandChain: ['Inference and agent usage growth', 'KV cache / retrieval / memory footprint', 'DRAM / NAND / SSD / controller demand', 'cycle plus structural AI demand', 'earnings and margin transmission'],
      technologyRoutes: ['HBM and high-performance DRAM', 'Enterprise SSDs for AI servers', 'Controller and firmware specialization', 'Memory expansion / tiered storage'],
      alternativeRoutes: ['Model compression', 'KV cache optimization', 'Cloud architecture changes', 'More efficient retrieval patterns'],
      dependencyLevels: [
        { level: 1, name: 'Inference infrastructure', type: 'system', whyNecessary: 'Serving workloads require memory and storage around accelerators.', substitutionCost: 'Optimization can reduce but not eliminate data movement needs.' },
        { level: 2, name: 'Memory and storage hierarchy', type: 'subsystem', whyNecessary: 'Latency, throughput and capacity determine serving economics.', substitutionCost: 'Changing hierarchy requires hardware, software and procurement changes.' },
        { level: 3, name: 'DRAM, NAND, SSD controllers, enterprise firmware and modules', type: 'component', whyNecessary: 'Supply, ASP and attach rates determine financial transmission.', substitutionCost: 'Alternative suppliers may exist, so scarcity must be proven.' },
      ],
      companies: [
        { ticker: 'MU', name: 'Micron', role: 'DRAM / HBM / NAND anchor' },
        { ticker: 'WDC', name: 'Western Digital', role: 'storage anchor' },
        { ticker: 'STX', name: 'Seagate', role: 'storage watchlist' },
        { ticker: 'SIMO', name: 'Silicon Motion', role: 'controller watchlist' },
        { ticker: 'SNDK', name: 'SanDisk', role: 'NAND / storage watchlist; listed-security status must be verified' },
      ],
      sourcePlan: [
        'Cloud instance specifications and AI server BOM disclosures',
        'Micron, WDC, Seagate, Silicon Motion and SanDisk filings / IR materials',
        'DRAM/NAND ASP and inventory-cycle data from structured vendors',
        'Technical papers on KV cache, retrieval and inference memory requirements',
      ],
      unknowns: [
        'Whether inference creates a structural demand layer beyond the memory/storage cycle.',
        'Which listed carrier has the most direct financial elasticity.',
        'Whether price and consensus already reflect the cycle recovery.',
      ],
      falsifiers: [
        'Model optimization materially reduces memory/storage demand per token.',
        'Commodity supply growth overwhelms AI demand.',
        'AI demand is visible but already fully reflected in estimates and valuation.',
      ],
    },
    {
      id: 'physical-ai-robotics',
      title: 'Physical AI, robotics components and edge hardware',
      priority: 3,
      cadenceHours: 72,
      topLevelDemand: 'Robotics foundation models, warehouse automation and edge agents could increase demand for actuators, sensors, control hardware and developer platforms.',
      demandChain: ['Physical AI capability improvement', 'robotics pilots and automation capex', 'actuators / sensors / controllers / edge compute', 'qualified component suppliers', 'revenue transmission'],
      technologyRoutes: ['Humanoid robotics', 'Warehouse automation', 'Surgical / industrial robotics', 'Edge AI developer hardware'],
      alternativeRoutes: ['Software-only productivity gains', 'Manual labor substitution delayed by unit economics', 'Private robotics suppliers without public carriers'],
      dependencyLevels: [
        { level: 1, name: 'Robotics system', type: 'system', whyNecessary: 'Physical AI must be embodied in hardware to create component demand.', substitutionCost: 'If deployments stay experimental, component demand remains small.' },
        { level: 2, name: 'Actuation, sensing, control and edge compute', type: 'subsystem', whyNecessary: 'System performance and reliability depend on qualified hardware layers.', substitutionCost: 'Safety validation and customer qualification slow substitution.' },
        { level: 3, name: 'Motors, reducers, sensors, controllers, boards and integration services', type: 'component', whyNecessary: 'The scarce layer may sit below the robot brand.', substitutionCost: 'Supplier switching can be slow but must be proven by evidence.' },
      ],
      companies: [
        { ticker: 'RPI', name: 'Raspberry Pi', role: 'edge / developer hardware watchlist' },
        { ticker: 'SYM', name: 'Symbotic', role: 'warehouse automation watchlist' },
        { ticker: 'TER', name: 'Teradyne', role: 'collaborative robotics and test anchor' },
        { ticker: 'ISRG', name: 'Intuitive Surgical', role: 'robotics anchor for contrast, likely not small/pure Serenity carrier' },
        { ticker: 'ROK', name: 'Rockwell Automation', role: 'industrial automation anchor' },
      ],
      sourcePlan: [
        'Company filings and segment disclosures for robotics / edge hardware exposure',
        'Developer community demand signals only as discovery triggers',
        'Customer pilot, backlog and deployment data',
        'Component supplier and BOM teardown searches',
      ],
      unknowns: [
        'Whether deployments are large enough to matter in 2026-2027 financials.',
        'Whether the bottleneck is component supply, integration capacity, software reliability or customer ROI.',
        'Whether any listed carrier has sufficient purity.',
      ],
      falsifiers: [
        'Robotics pilots fail to scale into material orders.',
        'Public companies have only diluted or indirect exposure.',
        'Component layers are broadly supplied and lack pricing power.',
      ],
    },
  ];
}

export function mergeSerenityDomainWatchlist(defaultDomains, overrideDomains) {
  const map = new Map();
  (defaultDomains || []).forEach((domain) => {
    if (domain?.id) map.set(domain.id, normalizeDomain(domain));
  });
  (Array.isArray(overrideDomains) ? overrideDomains : []).forEach((domain) => {
    if (!domain?.id) return;
    const existing = map.get(domain.id) || {};
    map.set(domain.id, normalizeDomain({ ...existing, ...domain }));
  });
  return Array.from(map.values()).sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));
}

export function buildSerenityDomainResearchSeed({
  domains = getDefaultSerenityDomainWatchlist(),
  domainIds = [],
  maxDomains = domains.length,
  now = new Date().toISOString(),
  timeZone = process.env.TZ || 'Asia/Singapore',
  researchOwner = 'chengpeng',
  systemVersion = '0.3.0',
  skillVersion = 'serenity-market-discovery@2',
} = {}) {
  const researchDate = toResearchDateSlug(now, timeZone);
  const selectedIds = new Set(normalizeStringArray(domainIds));
  const selected = domains
    .map(normalizeDomain)
    .filter((domain) => !selectedIds.size || selectedIds.has(domain.id))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, Number(maxDomains) || domains.length));

  const runs = selected.map((domain) =>
    buildSerenityDomainResearchRun(domain, {
      now,
      researchDate,
      researchOwner,
      systemVersion,
      skillVersion,
    })
  );
  const queueInputs = runs.flatMap((run, index) =>
    buildSerenityDomainQueueInputs(selected[index], run, { now, researchDate })
  );

  return {
    generatedAt: now,
    protocolVersion: SERENITY_PROTOCOL_VERSION,
    mode: 'module_2_domain_research_seed',
    assumption: 'Module 2 can run scheduled Serenity research independently from Module 1 live TV ingestion. Live TV becomes an additional discovery source later.',
    selectedDomains: selected.map((domain) => ({
      id: domain.id,
      title: domain.title,
      priority: domain.priority,
      cadenceHours: domain.cadenceHours,
      companies: domain.companies,
    })),
    runs,
    queueInputs,
  };
}

export function buildSerenityDomainResearchRun(domainInput, {
  now = new Date().toISOString(),
  researchDate = toResearchDateSlug(now),
  researchOwner = 'chengpeng',
  systemVersion = '0.3.0',
  skillVersion = 'serenity-market-discovery@2',
} = {}) {
  const domain = normalizeDomain(domainInput);
  const date = researchDate;
  const runId = `domain-${domain.id}-${date}`;
  const evidenceAnchor = `domain-watchlist:${domain.id}`;
  const tickers = domain.companies.map((company) => company.ticker).filter(Boolean);
  const dependencies = domain.dependencyLevels.map((item) => ({
    level: item.level,
    name: item.name,
    type: item.type,
    whyNecessary: item.whyNecessary,
    substitutionCost: item.substitutionCost,
  }));

  return {
    id: runId,
    title: `Domain run：${domain.title}`,
    objective: `用 Serenity 线性框架定期拆解 ${domain.title}，先验证研究框架稳定性，再逐步接入 Chromium 搜索、搜索 API、Core Evidence 和市场数据。`,
    run_config: {
      run_id: runId,
      run_mode: 'RESEARCH',
      research_date: date,
      market_data_as_of: date,
      investment_universe: 'Global listed equities and ADRs with direct or indirect exposure to the tracked domain.',
      included_exchanges: ['NYSE', 'Nasdaq', 'Major non-US exchanges where ADR or ordinary shares are trackable'],
      included_regions: ['United States', 'Europe', 'Asia'],
      excluded_security_types: ['Private companies', 'OTC securities unless explicitly approved', 'Funds', 'Derivatives'],
      market_cap_min: 100000000,
      market_cap_max: 75000000000,
      minimum_average_daily_traded_value: 1000000,
      maximum_analyst_coverage: 20,
      minimum_revenue_exposure: 0.1,
      maximum_supplier_count_for_bottleneck: 5,
      minimum_capacity_expansion_lead_time: 12,
      source_budget: 16,
      search_budget: 32,
      research_owner: researchOwner,
      system_version: systemVersion,
      skill_version: skillVersion,
    },
    status: 'market_discovery',
    cadence: `scheduled module-2 domain research; target cadence ${domain.cadenceHours || DEFAULT_SERENITY_DOMAIN_CADENCE_HOURS}h`,
    createdAt: now,
    updatedAt: now,
    topLevelDemand: domain.topLevelDemand,
    currentAnswer: 'Scheduler seed only. No Core Evidence has been collected in this step, no candidate is upgraded, and all company links remain low-confidence until source retrieval and Red Team checks run.',
    confidence: 'low',
    stateTransitions: [
      {
        changedAt: now,
        fromStatus: 'queued',
        toStatus: 'market_discovery',
        reason: 'Module 2 scheduler seeded a recurring Serenity domain research run before Module 1 live-TV ingestion is ready.',
        relatedEvidence: [evidenceAnchor],
        actor: 'module_2_domain_scheduler',
      },
    ],
    reasoningLedger: [
      {
        step: '1',
        hypothesis: domain.topLevelDemand,
        evidence: 'Configured domain watchlist seed; this is a planning input, not Core Evidence.',
        inference: 'The domain is worth recurring decomposition, but demand validity must be checked against primary sources.',
        assumptions: ['Module 2 can run independently from live TV ingestion.', 'Framework stability is the first target; candidate quality comes later.'],
        counterEvidence: domain.falsifiers.slice(0, 3),
        claimStatus: 'plausible',
        confidence: 'low',
        nextUncertainty: 'Find current primary-source evidence for the top-level demand change and timing.',
      },
      {
        step: '2',
        hypothesis: 'A deeper supply-chain layer may be more interesting than the obvious first-layer beneficiaries.',
        evidence: `Initial dependency map: ${domain.demandChain.join(' -> ')}`,
        inference: 'The next run should verify supplier counts, capacity expansion lead time and public-carrier purity rather than forcing a ticker.',
        assumptions: ['Long-tracked companies are starting points, not conclusions.'],
        counterEvidence: ['No bottleneck may exist after supplier-count checks.', 'The theme may already be fully priced.'],
        claimStatus: 'plausible',
        confidence: 'low',
        nextUncertainty: 'Which dependency layer is truly scarce and investable?',
      },
    ],
    keyConclusions: [
      {
        conclusion: 'Module 2 research can start before Bloomberg/CNBC/Fox live capture is implemented.',
        status: 'supported',
        evidenceIds: [evidenceAnchor],
        changedAt: now,
        changeReason: 'Research queue and Serenity V2 runs already provide a persistent process layer.',
      },
      {
        conclusion: `A qualified listed bottleneck carrier exists in ${domain.title}.`,
        status: 'unknown',
        evidenceIds: [],
        changedAt: now,
        changeReason: 'This seed has not collected Core Evidence, supplier counts, Fatal Gate evidence or pricing analysis.',
      },
    ],
    markets: [
      {
        market: domain.title,
        demandChain: domain.demandChain,
        technologyRoutes: domain.technologyRoutes,
        alternativeRoutes: domain.alternativeRoutes,
        dependencies,
        chokepoint: 'Unknown at seed time; identify only after source retrieval proves scarce, necessary and hard-to-substitute dependency layers.',
        bottleneckStatus: 'unknown',
        supplierCount: 'unknown',
        supplierCountBasis: 'Not yet searched. Scheduler seed only records the planned decomposition path.',
        capacityExpansionLeadTime: 'unknown',
        barriers: ['customer qualification', 'yield', 'capex', 'equipment availability', 'integration risk'],
        publicCarriers: tickers,
        listedCarriers: tickers,
        listedCarrierScreening: 'Watchlist carriers recorded for screening only. Tradability, liquidity, revenue exposure and governance risk remain unverified.',
        investigationDirections: ['customer', 'supplier', 'technology', 'regulatory'],
        unknowns: domain.unknowns,
        firstOrderDependencySearchSaturated: false,
        independentChallengeReviewCompleted: false,
        coverageStatus: 'coverage_insufficient',
        financialPath: 'Unknown until revenue exposure, utilization, backlog, margin and capex evidence are collected.',
        pricingGap: 'Unknown until 3/6/12 month price action, consensus changes, valuation range and narrative saturation are checked.',
        status: 'active_research',
        nextEvidence: domain.sourcePlan.slice(0, 8),
      },
    ],
    candidates: domain.companies.map((company) => ({
      ticker: company.ticker,
      name: company.name,
      market: domain.title,
      status: 'discovered',
      confidence: 'low',
      publicExposure: company.role,
      whySurvives: 'Long-tracked company or sector anchor included for recurring decomposition only; not a thesis candidate.',
      keyFalsifier: 'No direct, material revenue exposure to the verified bottleneck, or liquidity/tradability fails the configured universe.',
      nextEvidence: 'Verify listed security status, segment exposure, customer evidence, supplier role and pricing gap.',
      financialPath: 'Unknown at scheduler seed stage.',
      businessPurity: 'Unknown at scheduler seed stage.',
      stateReason: 'Added by module-2 domain scheduler as a watchlist carrier, not upgraded.',
    })),
    challengeLedger: [
      {
        challenge: 'Why start before live TV ingestion?',
        query: 'Module 2 research queue Serenity framework independence from Module 1 live ingestion',
        sourceType: 'system_design',
        result: 'The research engine can run from scheduled domain seeds and source retrieval; live TV is an additional discovery source, not a prerequisite.',
        impact: 'raise_process_confidence',
        nextAction: 'Run scheduled seeds and observe whether queues/runs remain auditable and non-duplicative.',
        relatedEvidence: [evidenceAnchor],
      },
      {
        challenge: 'Could this force weak stock ideas?',
        query: `${domain.title} weak public carrier purity supplier count red team`,
        sourceType: 'red_team_plan',
        result: 'Yes. Therefore generated companies remain discovered/watchlist only and cannot upgrade without Fatal Gate, Core Evidence and pricing checks.',
        impact: 'reduce_candidate_confidence',
        nextAction: 'Allow closed_no_candidate or active_research as valid outcomes.',
        relatedEvidence: [evidenceAnchor],
      },
      {
        challenge: 'What would make this domain seed low value?',
        query: `${domain.title} alternatives no bottleneck already priced`,
        sourceType: 'red_team_plan',
        result: 'If primary sources show broad supplier availability, fast expansion, weak revenue exposure or full market pricing, the domain should be downgraded.',
        impact: 'keep_active',
        nextAction: 'Search supplier count, expansion lead time and pricing saturation before any candidate work.',
        relatedEvidence: [evidenceAnchor],
      },
    ],
    unknowns: domain.unknowns,
    falsifiers: domain.falsifiers,
    closureReport: '',
    noCandidateExplanation: '',
    skillCandidates: [
      {
        name: 'module_2_domain_scheduler',
        status: 'skill_candidate',
        method: 'Use recurring domain seeds to exercise the Serenity framework before live TV ingestion is complete. This remains a candidate method until at least two independent domain runs prove it creates useful, auditable research state.',
        independentRunIds: [runId],
        reviewNotes: 'Do not publish as a formal skill until recurring runs demonstrate stable queue creation, source retrieval and Red Team behavior.',
      },
    ],
    sync: {
      dashboard: { status: 'pending' },
      obsidian: { status: 'pending' },
      next_queue: { status: 'pending' },
    },
    nextQueue: buildDomainNextQueue(domain),
  };
}

export function buildSerenityDomainQueueInputs(domainInput, run, {
  now = new Date().toISOString(),
  researchDate = toResearchDateSlug(now),
} = {}) {
  const domain = normalizeDomain(domainInput);
  const date = researchDate;
  const tickers = domain.companies.map((company) => company.ticker).filter(Boolean).slice(0, 12);
  const themes = ['Serenity domain research', domain.title];
  return buildDomainNextQueue(domain).map((task, index) => ({
    id: `rq:${hashText(`serenity-domain:${date}:${domain.id}:${index}:${task.task}`)}`,
    priority: task.priority,
    question: task.task,
    tickers,
    themes,
    sourceEventId: run.id,
    event: {
      id: `event:serenity-domain:${run.id}:${index}`,
      source: {
        id: 'serenity-domain-scheduler',
        name: 'Serenity Module 2 Domain Scheduler',
        type: 'system_seed',
        trustTier: 'research_process_seed',
      },
      title: `Scheduled Serenity domain task：${domain.title}`,
      summary: task.expectedEvidence,
      rawText: [
        `Domain: ${domain.title}`,
        `Top-level demand: ${domain.topLevelDemand}`,
        `Task: ${task.task}`,
        `Source to inspect: ${task.sourceToInspect}`,
        `Falsifier: ${task.falsifier}`,
      ].join('\n'),
      url: '',
      tickers,
      themes,
      eventType: 'serenity_domain_seed',
      impact: {
        direction: 'unknown',
        timeHorizon: 'multi-quarter',
        affectedAreas: ['research coverage', 'supply chain', 'market narrative'],
      },
      evidence: [
        {
          type: 'system_seed',
          text: `Scheduler queued Serenity research for ${domain.title}; no source retrieval has been executed yet.`,
          timestamp: now,
        },
      ],
      verification: {
        needsVerification: true,
        counterEvidence: domain.falsifiers,
      },
      score: {
        importance: Math.max(0.35, Math.min(0.9, 0.95 - domain.priority * 0.1)),
        novelty: 0.6,
        confidence: 0.25,
      },
    },
  }));
}

function buildDomainNextQueue(domain) {
  return [
    {
      priority: domain.priority,
      task: `【${domain.title}】确认顶层需求变化的时间、持续性和一手来源。`,
      sourceToInspect: domain.sourcePlan.slice(0, 2).join('；'),
      expectedEvidence: '官方文件、公司 IR、政府/标准组织/技术白皮书中的需求 anchor。',
      falsifier: '需求变化只是短期叙事，或没有预算/部署/订单层面的持续性证据。',
    },
    {
      priority: domain.priority,
      task: `【${domain.title}】按 Serenity 顺序拆主要技术路线、替代路线和三层依赖。`,
      sourceToInspect: domain.sourcePlan.join('；'),
      expectedEvidence: '主要路线、替代路线、三层依赖、每层为何必要以及替代成本。',
      falsifier: '存在低成本替代技术路线，或依赖层不是部署约束。',
    },
    {
      priority: Math.min(5, domain.priority + 1),
      task: `【${domain.title}】统计候选瓶颈供应商数量、扩产周期和上市载体纯度。`,
      sourceToInspect: '供应商 filings、产品文档、客户披露、专利、产能和 capex 资料。',
      expectedEvidence: '可规模量产供应商数量、判断依据、上市公司、收入暴露和 Fatal Gate 初筛。',
      falsifier: '供应商很多、扩产很快、或没有业务纯度足够的上市载体。',
    },
    {
      priority: Math.min(5, domain.priority + 1),
      task: `【${domain.title}】执行定价缺口和 Red Team：区分好行业、好公司、好股票和未定价机会。`,
      sourceToInspect: '市场数据、估值历史、共识预期、IR 主题强调、期权/资金/新闻热度。',
      expectedEvidence: '3/6/12 个月表现、估值、共识变化、IR 叙事饱和度、最强 bear case 和证伪条件。',
      falsifier: '主题已经充分定价，或财务传导会被其他业务抵消。',
    },
  ];
}

function normalizeDomain(input = {}) {
  const companies = (Array.isArray(input.companies) ? input.companies : [])
    .map((company) => ({
      ticker: cleanText(company?.ticker || '').toUpperCase(),
      name: cleanText(company?.name || company?.ticker || ''),
      role: cleanText(company?.role || 'watchlist carrier'),
    }))
    .filter((company) => company.ticker || company.name);
  return {
    id: slugify(input.id || input.title || 'domain'),
    title: cleanText(input.title || input.id || 'Untitled domain'),
    priority: clampNumber(input.priority, 1, 5, 3),
    cadenceHours: clampNumber(input.cadenceHours ?? input.cadence_hours, 1, 24 * 30, DEFAULT_SERENITY_DOMAIN_CADENCE_HOURS),
    topLevelDemand: cleanText(input.topLevelDemand || input.top_level_demand || ''),
    demandChain: normalizeStringArray(input.demandChain || input.demand_chain),
    technologyRoutes: normalizeStringArray(input.technologyRoutes || input.technology_routes),
    alternativeRoutes: normalizeStringArray(input.alternativeRoutes || input.alternative_routes),
    dependencyLevels: normalizeDependencyLevels(input.dependencyLevels || input.dependencies || input.dependency_levels),
    companies,
    sourcePlan: normalizeStringArray(input.sourcePlan || input.source_plan),
    unknowns: normalizeStringArray(input.unknowns),
    falsifiers: normalizeStringArray(input.falsifiers),
  };
}

function normalizeDependencyLevels(value) {
  return (Array.isArray(value) ? value : [])
    .map((item, index) => ({
      level: clampNumber(item?.level, 1, 20, index + 1),
      name: cleanText(item?.name || item?.dependency || item?.component || ''),
      type: cleanText(item?.type || 'unknown'),
      whyNecessary: cleanText(item?.whyNecessary || item?.why_necessary || ''),
      substitutionCost: cleanText(item?.substitutionCost || item?.substitution_cost || ''),
    }))
    .filter((item) => item.name)
    .slice(0, 20);
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return cleanText(value || '')
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'domain';
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function hashText(value) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
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
