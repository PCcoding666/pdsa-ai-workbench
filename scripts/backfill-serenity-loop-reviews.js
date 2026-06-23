#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import {
  OBSIDIAN_VAULT_PATH,
  RESEARCH_QUEUE_FILE,
  appendResearchOpsLog,
  getResearchQueue,
  writeJsonFile,
} from '../server/research-ops.js';

const actor = process.env.RESEARCH_AGENT_NAME || 'serenity-loop-backfill';
const now = new Date().toISOString();

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

const LOOP_REVIEWS = {
  'rq:efd26209adcbaaea': {
    loopVerdict: 'partial_not_candidate_ready: top-level AI demand timing and persistence are supported, but this memo does not identify a scarce layer or promote a ticker.',
    scarcityAssessment:
      'No scarce layer was proven in this loop. The supported judgment is demand durability: Microsoft, Alphabet, TSMC and ASML evidence show sustained AI infrastructure demand, while bottleneck, supplier-count and listed-carrier purity remain separate work.',
    candidateMappings: [
      {
        ticker: 'NVDA / AMD',
        role: 'Merchant accelerator route candidates.',
        demandLink: 'Demand can reach revenue through data-center accelerator shipments, but this memo did not test share durability, margin, backlog or valuation.',
        gap: 'Needs route/substitution work versus custom ASICs plus pricing-gap analysis.',
        status: 'not_upgraded',
      },
      {
        ticker: 'TSM / ASML / AMAT / MU',
        role: 'Upstream manufacturing, tools and HBM dependency candidates.',
        demandLink: 'AI demand could transmit through node, packaging, lithography, process tools and memory capacity.',
        gap: 'This memo did not identify which upstream dependency is binding or underpriced.',
        status: 'screening_funnel',
      },
      {
        ticker: 'ANET / VRT / ETN',
        role: 'Networking and facility infrastructure candidates.',
        demandLink: 'Demand could transmit through AI networking, power and thermal buildout.',
        gap: 'This memo did not map supplier count, business purity or valuation for these layers.',
        status: 'screening_funnel',
      },
    ],
    demandToTickerGap:
      'The memo establishes demand persistence, not company-level financial transmission. It still needs route mapping, necessary dependency selection, supplier-count basis, revenue exposure, margin/backlog conversion and market-expectation analysis.',
    fatalGateReview: [
      {
        gate: 'Direct business relationship to bottleneck',
        status: 'unknown',
        gap: 'No bottleneck was selected in this demand-timing loop.',
      },
      {
        gate: 'Business purity or financial elasticity',
        status: 'unknown',
        gap: 'No candidate revenue exposure, margin sensitivity or backlog path was tested.',
      },
      {
        gate: 'Substitution risk',
        status: 'unknown',
        gap: 'Custom ASIC, merchant GPU, networking, memory and power routes remain unresolved.',
      },
    ],
    pricingGap:
      'Not established. A durable AI demand wave can still be fully priced in large liquid winners; this memo did not separate good industry, good company and good stock.',
    nextDecisiveEvidence: [
      'Complete route and dependency mapping for the AI industry chain.',
      'For each candidate layer, record supplier count, capacity lead time and listed-carrier purity.',
      'Run pricing-gap review using valuation, consensus changes, guidance, backlog and IR theme saturation.',
    ],
  },
  'rq:3d2ef9a2f5599134': {
    loopVerdict: 'partial_not_candidate_ready: route/dependency map is supported, but no listed carrier is upgraded because supplier count, purity and pricing gap are not closed.',
    scarcityAssessment:
      'The most plausible scarce layers are TSMC-class leading-edge manufacturing, HBM/advanced packaging, and facility power/cooling. The map also shows substitute routes, so scarcity is plausible but not yet isolated to one Fatal Gate-ready layer.',
    candidateMappings: [
      {
        ticker: 'NVDA / AMD',
        role: 'Merchant GPU route.',
        demandLink: 'AI demand reaches accelerator revenue if merchant GPU systems remain the default volume route.',
        gap: 'Custom ASIC substitution and current valuation/expectation gap are unresolved.',
        status: 'screening',
      },
      {
        ticker: 'AVGO / MSFT / GOOG',
        role: 'Custom ASIC and cloud-specific route.',
        demandLink: 'Demand reaches ASIC/networking economics through hyperscaler in-house architectures.',
        gap: 'Large-cap first-layer winners may already price the theme; direct public financial transmission differs by company.',
        status: 'screening',
      },
      {
        ticker: 'TSM / ASML / AMAT / MU',
        role: 'Shared upstream constraints across GPU and ASIC routes.',
        demandLink: 'Even substitute accelerator routes need leading-edge manufacturing, process tools, packaging and HBM.',
        gap: 'Need supplier-count, capacity lead-time and pricing-gap proof by sublayer.',
        status: 'screening',
      },
      {
        ticker: 'ANET / VRT / ETN',
        role: 'Networking, power and cooling dependencies.',
        demandLink: 'AI clusters require networking plus megawatt-scale power and thermal systems.',
        gap: 'This memo did not test business purity, supplier concentration or margin elasticity.',
        status: 'screening',
      },
    ],
    demandToTickerGap:
      'The route map narrows where demand can travel, but it has not proven that any one ticker has scarce exposure, measurable financial elasticity, or an unpriced catalyst.',
    fatalGateReview: [
      {
        gate: 'Direct business relationship to bottleneck',
        status: 'unknown',
        gap: 'Several bottleneck candidates exist, but none was selected and verified.',
      },
      {
        gate: 'No fast substitute replacing the route',
        status: 'unknown',
        gap: 'Custom ASIC and Ethernet routes are real and must be tested before upgrading GPU/networking candidates.',
      },
      {
        gate: 'Business purity or financial elasticity',
        status: 'unknown',
        gap: 'No segment revenue, backlog, utilization or margin bridge was recorded for a specific candidate.',
      },
    ],
    pricingGap:
      'Not established. The memo intentionally stops before market expectations; large-cap AI winners may already reflect much of the route map.',
    nextDecisiveEvidence: [
      'Pick one dependency layer and complete supplier-count plus capacity lead-time evidence.',
      'Map candidate-specific revenue exposure and margin/backlog path.',
      'Run Red Team on custom ASIC substitution, capacity expansion and valuation saturation.',
    ],
  },
  'rq:94d5a6bf022601bf': {
    loopVerdict: 'partial_not_candidate_ready: AI photonics demand is supported, but CPO/ELS is not yet proven as the binding scarce layer and no ticker is upgraded.',
    scarcityAssessment:
      'Near-term demand is real for 800G and 1.6T optics. The scarce layer is not proven: pluggables remain the current volume path, while CPO/external light sources are active but not confirmed as dominant deployment layers.',
    candidateMappings: [
      {
        ticker: 'LITE / COHR',
        role: 'Optical component, laser and ELS/CPO-exposed suppliers.',
        demandLink: 'Demand can reach revenue through 800G/1.6T optics and external-laser products.',
        gap: 'Need customer-qualified share, capacity constraints, segment exposure and market-expectation analysis.',
        status: 'screening',
      },
      {
        ticker: 'AAOI',
        role: 'AI datacenter optical module supplier.',
        demandLink: 'Demand can reach revenue through hyperscaler 800G/1.6T orders.',
        gap: 'Backlog durability, customer concentration and gross-margin conversion remain decisive.',
        status: 'active_follow_up',
      },
      {
        ticker: 'SIVE / POET',
        role: 'Smaller potential photonics/ELS routes.',
        demandLink: 'Could benefit if CPO/ELS components become scarce and customer-qualified.',
        gap: 'Needs primary proof of orders, liquidity, governance, financial runway and customer qualification.',
        status: 'screening',
      },
      {
        ticker: 'AVGO / NVDA',
        role: 'System and platform anchors for AI networking/CPO.',
        demandLink: 'Demand reaches AI networking platforms, but they are large first-layer winners.',
        gap: 'Need evidence of underpriced incremental exposure rather than broad AI pricing.',
        status: 'context_anchor',
      },
    ],
    demandToTickerGap:
      'The memo proves optical demand timing but not which listed carrier captures scarce economics. It still needs route dominance, supplier count, business purity, revenue/margin conversion and valuation work.',
    fatalGateReview: [
      {
        gate: 'Direct business relationship to bottleneck',
        status: 'unknown',
        gap: 'CPO/ELS bottleneck status is not confirmed.',
      },
      {
        gate: 'Data is verifiable',
        status: 'partial',
        evidence: 'Demand timing is supported by primary sources.',
        gap: 'Customer-qualified CPO/ELS share is not verified.',
      },
      {
        gate: 'No fast substitute replacing the route',
        status: 'unknown',
        gap: 'AEC/copper, LPO/LRO, VCSEL/NPO and pluggables remain alternative routes.',
      },
    ],
    pricingGap:
      'Not established. AI photonics can be a good industry while individual optical names may already price the 800G/1.6T ramp or lack enough pure exposure.',
    nextDecisiveEvidence: [
      'Complete route/dependency and supplier-count work for CPO/ELS versus pluggables.',
      'Verify customer-qualified supplier count and capacity expansion lead times.',
      'Run ticker-level pricing gap for AAOI, SIVE, LITE, COHR and POET.',
    ],
  },
  'rq:5ac85f3dbd3426cb': {
    loopVerdict: 'partial_not_candidate_ready: photonics route map is supported, but route dominance and ticker-level economics remain open.',
    scarcityAssessment:
      'The plausible scarcity layer is external laser source plus optical-engine packaging for CPO/NPO, not generic 800G/1.6T pluggable modules. Scarcity remains unconfirmed because standards and product evidence show multiple competing routes.',
    candidateMappings: [
      {
        ticker: 'LITE / COHR',
        role: 'ELS, laser and optical component suppliers tied to the CPO/NPO route.',
        demandLink: 'If external lasers become required and capacity constrained, demand can reach laser revenue and margin.',
        gap: 'Need proof of customer-qualified share, order conversion and business purity.',
        status: 'screening',
      },
      {
        ticker: 'AAOI',
        role: 'Pluggable module route.',
        demandLink: 'Demand reaches AAOI through hyperscaler optical-module orders rather than necessarily through CPO/ELS scarcity.',
        gap: 'Module layer may be broad; needs backlog durability and gross-margin proof.',
        status: 'active_follow_up',
      },
      {
        ticker: 'SIVE / POET',
        role: 'Potential smaller ELS/SiPh/photonic-engine carriers.',
        demandLink: 'Demand could matter if their products are customer-qualified into the scarce route.',
        gap: 'Need purchase-order conversion, liquidity/runway and governance/audit review.',
        status: 'screening',
      },
      {
        ticker: 'AVGO / NVDA',
        role: 'CPO/system-platform route anchors.',
        demandLink: 'They validate the route but may not provide small underpriced pure-play exposure.',
        gap: 'Need pricing-gap work and supplier relationship proof.',
        status: 'context_anchor',
      },
    ],
    demandToTickerGap:
      'The memo defines the route stack but does not prove which component supplier has irreplaceable exposure, capacity scarcity, financial elasticity or underpriced expectations.',
    fatalGateReview: [
      {
        gate: 'No fast substitute replacing the route',
        status: 'unknown',
        gap: 'Copper/AEC, LPO/LRO, VCSEL/NPO and integrated-laser CPO remain credible substitutes.',
      },
      {
        gate: 'Direct business relationship to bottleneck',
        status: 'unknown',
        gap: 'ELS bottleneck is plausible but not proven as mandatory.',
      },
      {
        gate: 'Business purity or financial elasticity',
        status: 'unknown',
        gap: 'No ticker-level financial bridge was recorded.',
      },
    ],
    pricingGap:
      'Not established. Route importance is not equivalent to an unpriced stock; the next loop must test market expectations for each surviving carrier.',
    nextDecisiveEvidence: [
      'Count customer-qualified ELS/CPO suppliers and exclude generic module-only suppliers.',
      'Find capacity lead times for CW/UHP lasers, FAU/PM fiber, isolators, TEC and optical-engine packaging.',
      'Run candidate scorecards and pricing-gap review for LITE, COHR, AAOI, SIVE and POET.',
    ],
  },
  'rq:f0fe39a80a87b00a': {
    loopVerdict: 'closed_no_candidate_for_module_layer; active_research_for_ELS_layer. Public evidence contradicts module-layer scarcity and leaves ELS/CPO scarcity plausible but unconfirmed.',
    scarcityAssessment:
      'Generic AI optical modules are not the scarce layer on disclosed evidence because at least seven public supplier groups show 800G/1.6T products. External-laser/CPO is narrower, but public evidence still shows multiple routes and suppliers, so it is not yet Fatal Gate-ready scarcity.',
    candidateMappings: [
      {
        ticker: 'LITE',
        role: 'ELS, lasers and AI optical infrastructure supplier.',
        demandLink: 'Demand could reach revenue through UHP laser/ELSFP products and optical modules.',
        gap: 'Need customer-qualified share, capacity constraint and valuation/expectation gap.',
        status: 'screening',
      },
      {
        ticker: 'COHR',
        role: 'Transceiver, InP CW laser and ELS/CPO participant.',
        demandLink: 'Demand could reach revenue through 1.6T transceivers and ELS qualification.',
        gap: 'ELS qualification timing and high-volume order conversion remain unverified.',
        status: 'screening',
      },
      {
        ticker: 'AVGO / GFS',
        role: 'CPO platform plus silicon-photonics manufacturing ecosystem.',
        demandLink: 'Demand reaches CPO switch and SiPh platform economics if Broadcom route scales.',
        gap: 'Need purity and incremental pricing gap; GFS is enabling ecosystem depth, not proven sole-source exposure.',
        status: 'screening',
      },
      {
        ticker: 'POET / O-Net / Enablence',
        role: 'Smaller disclosed light-source or optical-engine ecosystem participants.',
        demandLink: 'Demand could matter if demos/orders convert into qualified volume.',
        gap: 'Need customer qualification, liquidity, governance and durable financial transmission.',
        status: 'screening',
      },
      {
        ticker: 'AAOI / InnoLight / Eoptolink / Accelink / LIGENT',
        role: 'Module-layer suppliers.',
        demandLink: 'They benefit from optical module demand, but broad supplier count weakens scarcity.',
        gap: 'Need company-specific order quality and margin proof, not generic module scarcity.',
        status: 'module_scarcity_rejected',
      },
    ],
    demandToTickerGap:
      'Supplier count narrows the thesis away from generic modules. To reach a stock conclusion, the next loop must prove ELS/CPO qualification, capacity lead time, business purity, financial elasticity and expectations gap for each carrier.',
    fatalGateReview: [
      {
        gate: 'Direct business relationship to bottleneck',
        status: 'partial',
        evidence: 'LITE, COHR, AVGO and POET have public ELS/CPO-related disclosures.',
        gap: 'Customer-qualified share and economic bottleneck status are not proven.',
      },
      {
        gate: 'No evidence of fast substitute',
        status: 'unknown',
        gap: 'Pluggables, LPO/LRO, VCSEL/NPO, integrated-laser CPO and multiple module suppliers remain substitutes.',
      },
      {
        gate: 'Business purity or financial elasticity',
        status: 'unknown',
        gap: 'No candidate-level revenue exposure or margin bridge was completed in this supplier-count memo.',
      },
      {
        gate: 'Candidate not selected only because it is small-cap',
        status: 'open',
        gap: 'Small names such as POET/O-Net/Enablence need extra liquidity, governance and runway review.',
      },
    ],
    pricingGap:
      'Not established. The module-layer good-industry thesis is weakened by broad supply; ELS/CPO still needs expectations, valuation and catalyst review before any good-stock claim.',
    nextDecisiveEvidence: [
      'Obtain customer-qualified ELS/CPO supplier count by customer or platform.',
      'Verify capacity expansion lead times and purchase-order conversion for LITE, COHR, POET and smaller carriers.',
      'Complete pricing-gap and Red Team review for surviving ELS/CPO candidates.',
    ],
  },
  'rq:7befc4d8e4146bba': {
    loopVerdict: 'candidate_watchlist_not_upgraded: AAOI has direct AI-optics exposure, but backlog durability, customer concentration and gross-margin conversion fail to clear upgrade gates.',
    scarcityAssessment:
      'AAOI is exposed to the AI optical-module ramp, but module-layer scarcity is not proven and later supplier-count work points to broad module supply. Any AAOI thesis must rest on company-specific 1.6T order conversion and margin improvement, not generic module scarcity.',
    candidateMappings: [
      {
        ticker: 'AAOI',
        role: 'AI datacenter optical module supplier with 800G/1.6T ramp exposure.',
        demandLink: 'Demand can reach revenue through hyperscaler purchase orders, 800G capacity and the disclosed >$200 million 1.6T order.',
        gap: 'Backlog is a weak signal because orders are cancellable/reschedulable; customer concentration and margin improvement remain unresolved.',
        status: 'watchlist_not_upgraded',
      },
    ],
    demandToTickerGap:
      'The demand-to-revenue link exists but is fragile. The memo shows purchase-order exposure and capacity ramp, yet durable revenue, gross-margin expansion, receivable quality and customer diversification remain unproven.',
    fatalGateReview: [
      {
        gate: 'Tradable listed security',
        status: 'pass',
        evidence: 'AAOI is a listed public company.',
      },
      {
        gate: 'Data is verifiable',
        status: 'pass',
        evidence: 'Key facts were taken from SEC filings and company IR releases.',
      },
      {
        gate: 'Direct business relationship to bottleneck',
        status: 'partial',
        evidence: 'AAOI reports data-center optical revenue and 800G/1.6T capacity ramp.',
        gap: 'Module-layer bottleneck status is not proven and supplier count appears broad.',
      },
      {
        gate: 'Business purity or financial elasticity',
        status: 'partial',
        evidence: 'Q1 2026 data-center revenue was 53.9% of total revenue.',
        gap: 'Gross margin fell year over year and improvement is still forward-looking.',
      },
      {
        gate: 'Thesis not dependent on one unverifiable order',
        status: 'open',
        gap: 'The >$200 million 1.6T order lacks disclosed cancellation protections and backlog is not a reliable indicator.',
      },
    ],
    pricingGap:
      'Not closed. AAOI may be a good company exposure if orders convert and margins improve, but this memo did not prove that the stock is cheap relative to those expectations.',
    nextDecisiveEvidence: [
      'Check Q2-Q4 2026 filings for 1.6T shipment conversion and customer mix.',
      'Verify gross-margin recovery after capacity ramp and inventory reserves.',
      'Compare valuation, consensus revisions and short interest against realized order conversion.',
    ],
  },
  'rq:9be8233b6e66e754': {
    loopVerdict: 'partial_not_candidate_ready: AI rack power and thermal demand is supported, but the scarce sublayer and ticker-level gap are not identified.',
    scarcityAssessment:
      'The demand layer is real and durable. The memo does not prove whether scarcity sits in CDUs/cold plates, switchgear, transformers, busbars, modular electrical systems, grid equipment or project execution capacity.',
    candidateMappings: [
      {
        ticker: 'VRT',
        role: 'Power and thermal infrastructure supplier.',
        demandLink: 'Demand can reach orders/backlog from hyperscale and AI infrastructure buildouts.',
        gap: 'Need mix, margin, backlog conversion and valuation gap by sublayer.',
        status: 'screening',
      },
      {
        ticker: 'MOD',
        role: 'Data-center cooling supplier.',
        demandLink: 'Demand can reach cooling shipments and capacity agreements.',
        gap: 'Need concentration, capacity execution and margin bridge.',
        status: 'screening',
      },
      {
        ticker: 'ETN / POWL / GEV',
        role: 'Electrical, switchgear and power/grid infrastructure carriers.',
        demandLink: 'Demand can reach orders through grid-to-chip electrical distribution, data-center orders and electrification.',
        gap: 'Need data-center exposure, bottleneck status, lead times and pricing gap.',
        status: 'screening',
      },
      {
        ticker: 'NVDA',
        role: 'Platform architecture anchor.',
        demandLink: 'NVIDIA defines the rack-scale demand pull, but is not the pure power/thermal carrier.',
        gap: 'Use as route anchor, not as proof of infrastructure underpricing.',
        status: 'context_anchor',
      },
    ],
    demandToTickerGap:
      'The memo shows demand and orders at the infrastructure level, but not which subcomponent is scarce or which company has underpriced financial elasticity.',
    fatalGateReview: [
      {
        gate: 'Direct business relationship to bottleneck',
        status: 'unknown',
        gap: 'No bottleneck sublayer was selected.',
      },
      {
        gate: 'Business purity or financial elasticity',
        status: 'unknown',
        gap: 'Company-specific data-center mix, backlog conversion and margin bridge were not completed.',
      },
      {
        gate: 'Market already pricing the claim',
        status: 'open',
        gap: 'Memo notes demanding valuations/elevated market caps but does not quantify expectations.',
      },
    ],
    pricingGap:
      'Not established. Demand is likely visible to the market; the next loop must decide whether any carrier is still mispriced after order/backlog and valuation moves.',
    nextDecisiveEvidence: [
      'Select one scarce sublayer and count credible suppliers with lead-time evidence.',
      'Map VRT, MOD, ETN, POWL and GEV data-center revenue, backlog and margin exposure.',
      'Run pricing-gap review using 3M/6M/12M performance, valuation, consensus and guidance changes.',
    ],
  },
  'rq:7d1f11d3cdc81783': {
    loopVerdict: 'partial_not_candidate_ready: rack power/thermal route map is supported, but supplier scarcity, listed-carrier purity and pricing gap remain open.',
    scarcityAssessment:
      'The strongest candidate scarce layers are high-density liquid-cooling assemblies, CDUs/manifolds/quick disconnects/cold plates, and high-current or higher-voltage rack power distribution. The memo does not prove which layer has few suppliers or durable pricing power.',
    candidateMappings: [
      {
        ticker: 'VRT / MOD',
        role: 'Thermal management and liquid-cooling infrastructure carriers.',
        demandLink: 'Demand could reach revenue through CDUs, liquid-cooling systems, thermal equipment and deployment services.',
        gap: 'Need supplier count, capacity lead times, mix, margin and customer concentration.',
        status: 'screening',
      },
      {
        ticker: 'ETN / POWL',
        role: 'Electrical distribution, switchgear and rack/facility power carriers.',
        demandLink: 'Demand could reach orders through high-density electrical systems and data-center power infrastructure.',
        gap: 'Need sublayer exposure, backlog duration, pricing power and valuation gap.',
        status: 'screening',
      },
      {
        ticker: 'GEV',
        role: 'Grid and generation-side electrification carrier.',
        demandLink: 'Demand can transmit through data-center electrification orders and grid capacity.',
        gap: 'Need purity and timing because grid constraints can delay monetization.',
        status: 'screening',
      },
      {
        ticker: 'NVDA',
        role: 'Architecture driver for GB200/NVL and high-density rack requirements.',
        demandLink: 'Validates route pressure but is not the pure infrastructure bottleneck carrier.',
        gap: 'Use as technical anchor only.',
        status: 'context_anchor',
      },
    ],
    demandToTickerGap:
      'The route map identifies components and alternatives, but financial transmission requires supplier-count proof, qualified vendor lists, order/backlog conversion, margin bridge and valuation work.',
    fatalGateReview: [
      {
        gate: 'No fast substitute replacing the route',
        status: 'unknown',
        gap: 'Hybrid air/RDHx and immersion remain alternatives for some densities.',
      },
      {
        gate: 'Direct business relationship to bottleneck',
        status: 'unknown',
        gap: 'The memo does not pick one bottleneck subcomponent.',
      },
      {
        gate: 'Business purity or financial elasticity',
        status: 'unknown',
        gap: 'Ticker-level revenue exposure and margins were not analyzed.',
      },
    ],
    pricingGap:
      'Not established. Route importance does not equal an unpriced stock until supplier scarcity and company-level economics are measured.',
    nextDecisiveEvidence: [
      'Count suppliers and qualification lead times for CDUs, cold plates, quick disconnects, busbars and switchgear.',
      'Validate data-center exposure and backlog conversion for VRT, MOD, ETN, POWL and GEV.',
      'Run Red Team on commoditization, air/hybrid substitution, utility interconnection delays and valuation saturation.',
    ],
  },
};

const CHALLENGE_REVIEWS = {
  'rq:ai-policy-export-control-energy-permits': buildChallengeReview({
    verdict: 'fail_upgrade: policy chokepoints are real, but the chain has not reached ranked listed carriers with financial sensitivity and pricing gap.',
    upgrade: 'No candidate upgrade. Split into export-control transmission and large-load power beneficiary follow-ups.',
    covered: ['top-level demand', 'bottleneck', 'listed carrier', 'risk', 'falsifier'],
    partial: ['technology route', 'necessary dependency', 'supplier landscape', 'financial transmission'],
    missing: ['business purity', 'market expectations', 'pricing gap', 'catalyst'],
    questions: [
      question('Why now?', 'covered', 'FERC, DOE and BIS actions are dated 2025-2026 and policy timing is explicit.', ''),
      question('Why not a large-cap first-layer winner?', 'unanswered', '', 'No ranking between broad incumbents and second-order beneficiaries.'),
      question('Is business purity sufficient?', 'weak', 'Candidate mapping exists for ETN, GEV, CEG, NVDA, TSM and ASML.', 'Diversification and policy-specific exposure are not quantified.'),
      question('Is demand growth already reflected in price and expectations?', 'unanswered', '', 'No consensus, valuation or narrative-saturation review.'),
      question('Can other businesses offset the financial transmission?', 'partial', 'Memo names order/backlog links for several carriers.', 'EPS/FCF sensitivity and margin bridge are missing.'),
      question('Which observable fact directly falsifies the thesis?', 'partial', 'FERC, DOE, demand and BIS falsifiers are recorded.', 'Ticker-level rejection thresholds are not defined.'),
    ],
    fixes: [
      'Split the lane into export-control transmission and large-load power beneficiary maps.',
      'Quantify policy-specific revenue, EPS/FCF and backlog conversion for each mapped ticker.',
      'Run market pricing and consensus review before candidate upgrade.',
    ],
  }),
  'rq:efd26209adcbaaea': buildChallengeReview({
    verdict: 'fail_upgrade: demand timing is supported, but the Serenity chain stops before route, bottleneck, supplier and stock-level proof.',
    upgrade: 'No candidate upgrade. Treat as demand anchor only.',
    covered: ['top-level demand', 'risk', 'falsifier'],
    missing: [
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
    ],
    questions: [
      question('Why now?', 'partial', 'The public demand inflection and 2026 persistence are recorded.', 'Still needs why a specific stock is mispriced now.'),
      question('Why not a large-cap first-layer winner?', 'unanswered', '', 'No comparison between first-layer winners and second-order bottlenecks.'),
      question('Is demand growth already reflected in price and expectations?', 'unanswered', '', 'No valuation or consensus evidence.'),
      question('Which observable fact directly falsifies the thesis?', 'partial', 'Falsifiers were recorded for demand persistence.', 'No ticker-level falsifier.'),
    ],
    fixes: [
      'Run route/dependency map before candidate selection.',
      'Select one scarce dependency layer and count credible suppliers.',
      'Add pricing-gap evidence before any ticker conclusion.',
    ],
  }),
  'rq:3d2ef9a2f5599134': buildChallengeReview({
    verdict: 'fail_upgrade: route and dependency map improved the chain, but bottleneck selection, supplier count and stock economics remain incomplete.',
    upgrade: 'No candidate upgrade. Keep as route-map input for downstream bottleneck research.',
    covered: ['top-level demand', 'technology route', 'necessary dependency', 'risk', 'falsifier'],
    partial: ['bottleneck', 'listed carrier'],
    missing: ['supplier landscape', 'business purity', 'financial transmission', 'market expectations', 'pricing gap', 'catalyst'],
    questions: [
      question('Can the downstream customer choose an alternative technology route?', 'partial', 'Custom ASIC and Ethernet alternatives are recorded.', 'Need impact on each candidate route.'),
      question('Were other suppliers omitted?', 'unanswered', '', 'Supplier-count work is not done.'),
      question('Is business purity sufficient?', 'unanswered', '', 'No candidate-level segment exposure.'),
      question('Can capacity expansion destroy scarcity and pricing power?', 'unanswered', '', 'No capacity lead-time evidence by layer.'),
    ],
    fixes: [
      'Choose one dependency layer and run supplier-count plus capacity lead-time research.',
      'Map each candidate to revenue/margin/backlog exposure.',
      'Run Red Team on ASIC substitution and valuation saturation.',
    ],
  }),
  'rq:94d5a6bf022601bf': buildChallengeReview({
    verdict: 'fail_upgrade: photonics demand is real, but the reviewer cannot approve CPO/ELS or any ticker as scarce from demand evidence alone.',
    upgrade: 'No candidate upgrade. Use as photonics demand anchor.',
    covered: ['top-level demand', 'risk', 'falsifier'],
    partial: ['technology route', 'listed carrier'],
    missing: ['necessary dependency', 'bottleneck', 'supplier landscape', 'business purity', 'financial transmission', 'market expectations', 'pricing gap', 'catalyst'],
    questions: [
      question('Is the bottleneck truly irreplaceable or costly to replace?', 'unanswered', '', 'CPO/ELS dominance is not proven.'),
      question('Can the downstream customer choose an alternative technology route?', 'partial', 'Alternative routes are named.', 'Need route-share and customer qualification evidence.'),
      question('Is demand growth already reflected in price and expectations?', 'unanswered', '', 'No pricing-gap work.'),
      question('Which fact immediately rejects the candidate?', 'unanswered', '', 'No candidate-specific reject trigger.'),
    ],
    fixes: [
      'Run CPO/ELS route dominance and customer-qualified supplier-count work.',
      'Separate pluggable module demand from external-light-source scarcity.',
      'Attach each candidate to a financial transmission path.',
    ],
  }),
  'rq:5ac85f3dbd3426cb': buildChallengeReview({
    verdict: 'fail_upgrade: route map is useful, but standards evidence shows plural routes and no candidate survives review yet.',
    upgrade: 'No candidate upgrade. Use to scope ELS/CPO follow-up tasks.',
    covered: ['top-level demand', 'technology route', 'necessary dependency', 'risk', 'falsifier'],
    partial: ['bottleneck', 'listed carrier'],
    missing: ['supplier landscape', 'business purity', 'financial transmission', 'market expectations', 'pricing gap', 'catalyst'],
    questions: [
      question('Can the downstream customer choose an alternative technology route?', 'partial', 'Copper/AEC, LPO/LRO, VCSEL/NPO and integrated-laser paths are listed.', 'Need evidence on adoption share and constraints.'),
      question('Were other suppliers omitted?', 'unanswered', '', 'Supplier-count work remains queued.'),
      question('Is supplier count overstated or understated?', 'unanswered', '', 'No customer-qualified supplier list.'),
      question('Which observable fact directly falsifies the thesis?', 'partial', 'Route-level falsifiers exist.', 'Candidate-level falsifiers are missing.'),
    ],
    fixes: [
      'Count customer-qualified ELS/CPO suppliers, not generic module vendors.',
      'Verify capacity lead times for lasers, FAU/PM fiber, isolators, TEC and optical-engine packaging.',
      'Run candidate scorecards for LITE, COHR, AAOI, SIVE and POET.',
    ],
  }),
  'rq:f0fe39a80a87b00a': buildChallengeReview({
    verdict: 'pass_as_challenge_input_not_candidate: module-layer scarcity is challenged successfully, while ELS/CPO remains active research.',
    upgrade: 'Reject generic module-scarcity upgrade. Keep ELS/CPO candidates in screening only.',
    covered: ['technology route', 'supplier landscape', 'listed carrier', 'risk', 'falsifier'],
    partial: ['top-level demand', 'necessary dependency', 'bottleneck'],
    missing: ['business purity', 'financial transmission', 'market expectations', 'pricing gap', 'catalyst'],
    questions: [
      question('Were other suppliers omitted?', 'partial', 'Multiple public supplier groups are recorded.', 'Need customer-qualified rather than public-product count.'),
      question('Is supplier count overstated or understated?', 'partial', 'Module count appears broad; ELS count remains uncertain.', 'Need platform/customer qualification evidence.'),
      question('Can capacity expansion destroy scarcity and pricing power?', 'unanswered', '', 'Capacity lead times are not recorded.'),
      question('Is business purity sufficient?', 'unanswered', '', 'No candidate-level exposure bridge.'),
    ],
    fixes: [
      'Create a narrower ELS/CPO customer-qualified supplier-count task.',
      'Reject any thesis relying on generic pluggable-module scarcity.',
      'Add valuation and consensus review for surviving ELS/CPO carriers.',
    ],
  }),
  'rq:7befc4d8e4146bba': buildChallengeReview({
    verdict: 'pass_watchlist_not_upgrade: AAOI has direct exposure, but reviewer blocks upgrade on backlog quality, concentration, margin and pricing-gap holes.',
    upgrade: 'Keep AAOI as watchlist/active follow-up, not high-conviction candidate.',
    covered: ['listed carrier', 'business purity', 'financial transmission', 'risk', 'falsifier'],
    partial: ['top-level demand', 'technology route', 'necessary dependency', 'bottleneck', 'supplier landscape'],
    missing: ['market expectations', 'pricing gap', 'catalyst'],
    questions: [
      question('Is the bottleneck truly irreplaceable or costly to replace?', 'weak', 'AAOI has AI module exposure.', 'Generic module-layer scarcity is not proven.'),
      question('Is business purity sufficient?', 'partial', 'Data-center revenue exposure is recorded.', 'Customer concentration and receivable concentration are high.'),
      question('Can other businesses offset the financial transmission?', 'partial', 'Data-center mix is material.', 'Gross margin fell and ramp costs can offset revenue.'),
      question('Is demand growth already reflected in price and expectations?', 'unanswered', '', 'No valuation, consensus or price-performance review.'),
      question('Which fact immediately rejects the candidate?', 'partial', 'Shipment slippage or margin failure would weaken the thesis.', 'Need explicit rejection threshold.'),
    ],
    fixes: [
      'Check Q2-Q4 2026 filings for 1.6T order conversion and customer mix.',
      'Quantify gross-margin bridge after ramp costs and inventory reserves.',
      'Run market-pricing analysis before any upgrade.',
    ],
  }),
  'rq:9be8233b6e66e754': buildChallengeReview({
    verdict: 'fail_upgrade: rack power/thermal demand is supported, but the scarce sublayer and stock-level capture are not reviewed enough.',
    upgrade: 'No candidate upgrade. Use as demand anchor for power/thermal infrastructure.',
    covered: ['top-level demand', 'risk', 'falsifier'],
    partial: ['technology route', 'listed carrier'],
    missing: ['necessary dependency', 'bottleneck', 'supplier landscape', 'business purity', 'financial transmission', 'market expectations', 'pricing gap', 'catalyst'],
    questions: [
      question('Is the bottleneck truly irreplaceable or costly to replace?', 'unanswered', '', 'No sublayer such as CDU, switchgear, transformer or busbar is selected.'),
      question('Were other suppliers omitted?', 'unanswered', '', 'No supplier-count work.'),
      question('Is demand growth already reflected in price and expectations?', 'partial', 'Memo warns valuations are demanding.', 'No quantitative pricing analysis.'),
      question('Can deployment constraints break financial transmission?', 'partial', 'Grid and facility constraints are recorded.', 'Need ticker-level timing impact.'),
    ],
    fixes: [
      'Select one power/thermal sublayer and count qualified suppliers.',
      'Map VRT, MOD, ETN, POWL and GEV backlog/margin exposure.',
      'Run valuation, consensus and guidance-change review.',
    ],
  }),
  'rq:7d1f11d3cdc81783': buildChallengeReview({
    verdict: 'fail_upgrade: route/dependency map is supported, but reviewer finds no supplier scarcity or pricing gap closure.',
    upgrade: 'No candidate upgrade. Keep as route-map input.',
    covered: ['top-level demand', 'technology route', 'necessary dependency', 'risk', 'falsifier'],
    partial: ['bottleneck', 'listed carrier'],
    missing: ['supplier landscape', 'business purity', 'financial transmission', 'market expectations', 'pricing gap', 'catalyst'],
    questions: [
      question('Can the downstream customer choose an alternative technology route?', 'partial', 'Hybrid air/RDHx and immersion are acknowledged.', 'Need adoption and economics by density band.'),
      question('Were other suppliers omitted?', 'unanswered', '', 'No supplier-count map for CDUs, cold plates, busbars or switchgear.'),
      question('Can capacity expansion destroy scarcity and pricing power?', 'unanswered', '', 'Lead times and qualification barriers are not recorded.'),
      question('Which observable fact directly falsifies the thesis?', 'partial', 'Route-level falsifiers are recorded.', 'Candidate-level falsifiers are missing.'),
    ],
    fixes: [
      'Count qualified suppliers for CDUs, cold plates, quick disconnects, busbars and switchgear.',
      'Add candidate-level business purity and financial-transmission analysis.',
      'Red Team utility interconnection delays, commoditization and valuation saturation.',
    ],
  }),
};

function main() {
  const items = getResearchQueue();
  let updated = 0;
  const nextItems = items.map((item) => {
    const loop = LOOP_REVIEWS[item.id];
    const challenge = CHALLENGE_REVIEWS[item.id];
    if (!loop && !challenge) return item;

    updateMemoFile(item.memoPath, loop, challenge);
    if (item.obsidianMemoPath) {
      updateMemoFile(path.join(OBSIDIAN_VAULT_PATH, item.obsidianMemoPath), loop, challenge);
    }

    updated += 1;
    const nextItem = {
      ...item,
      updatedAt: now,
      memoSyncedAt: item.obsidianMemoPath ? now : item.memoSyncedAt || '',
      memoSyncStatus: item.obsidianMemoPath ? 'success' : item.memoSyncStatus || '',
    };
    if (loop) nextItem.serenityLoop = loop;
    if (challenge) nextItem.challengeReview = challenge;
    return nextItem;
  });

  writeJsonFile(RESEARCH_QUEUE_FILE, nextItems);
  appendResearchOpsLog({
    type: 'serenity_loop_backfilled',
    count: updated,
    itemIds: Object.keys({ ...LOOP_REVIEWS, ...CHALLENGE_REVIEWS }),
    actor,
    at: now,
  });
  console.log(JSON.stringify({ updated, itemIds: Object.keys({ ...LOOP_REVIEWS, ...CHALLENGE_REVIEWS }) }, null, 2));
}

function updateMemoFile(filePath, loop, challenge) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const current = fs.readFileSync(filePath, 'utf8');
  const withoutExisting = removeExistingLoopSections(current);
  const updated = withoutExisting
    .replace(/^updated_at: ".*"$/m, `updated_at: "${now}"`)
    .replace(/\n## Required Evidence\n/, `\n${formatLoopSections(loop, challenge)}\n## Required Evidence\n`);
  fs.writeFileSync(filePath, updated, 'utf8');
}

function removeExistingLoopSections(content) {
  return content.replace(
    /\n## Serenity Loop Verdict\n[\s\S]*?(?=\n## Required Evidence\n)/,
    '\n'
  );
}

function formatLoopSections(loop, challenge) {
  return [
    ...(loop ? formatSerenityLoopSections(loop) : []),
    ...(challenge ? formatChallengeSections(challenge) : []),
  ].join('\n');
}

function formatSerenityLoopSections(loop) {
  return [
    '## Serenity Loop Verdict',
    '',
    `- Verdict: ${loop.loopVerdict}`,
    '',
    '## Scarcity Layer Assessment',
    '',
    `- ${loop.scarcityAssessment}`,
    '',
    '## Candidate Mapping',
    '',
    ...loop.candidateMappings.map(formatCandidateMapping),
    '',
    '## Demand-to-Ticker Gap',
    '',
    `- ${loop.demandToTickerGap}`,
    '',
    '## Fatal Gate Review',
    '',
    ...loop.fatalGateReview.map(formatFatalGate),
    '',
    '## Pricing / Expectation Gap',
    '',
    `- ${loop.pricingGap}`,
    '',
    '## Next Decisive Evidence',
    '',
    ...loop.nextDecisiveEvidence.map((evidence) => `- ${evidence}`),
    '',
  ];
}

function formatChallengeSections(challenge) {
  return [
    '## Serenity Challenge Agent Review',
    '',
    `- Reviewer: ${challenge.reviewerAgent}`,
    `- Verdict: ${challenge.reviewVerdict}`,
    `- Upgrade decision: ${challenge.upgradeDecision}`,
    '',
    '### Chain Coverage',
    '',
    ...challenge.chainCoverage.map(formatReviewRow),
    '',
    '### Missing / Weak Layers',
    '',
    ...challenge.missingLayers.map((layer) => `- ${layer}`),
    '',
    '### Challenge Questions',
    '',
    ...challenge.challengeQuestions.map(formatReviewRow),
    '',
    '### Red Team Searches',
    '',
    ...challenge.redTeamSearches.map(formatReviewRow),
    '',
    '### Required Fixes',
    '',
    ...challenge.requiredFixes.map((fix) => `- ${fix}`),
    '',
    '### Next Challenge Tasks',
    '',
    ...challenge.nextChallengeTasks.map((task) => `- ${task}`),
    '',
  ];
}

function formatCandidateMapping(row) {
  return [
    `- ${row.ticker}:`,
    row.role ? `  - Role: ${row.role}` : '',
    row.demandLink ? `  - Demand link: ${row.demandLink}` : '',
    row.gap ? `  - Gap: ${row.gap}` : '',
    row.status ? `  - Status: ${row.status}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatFatalGate(row) {
  return [
    `- ${row.gate}:`,
    row.status ? `  - Status: ${row.status}` : '',
    row.evidence ? `  - Evidence: ${row.evidence}` : '',
    row.gap ? `  - Gap: ${row.gap}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatReviewRow(row) {
  return [
    `- ${row.name}:`,
    row.status ? `  - Status: ${row.status}` : '',
    row.evidence ? `  - Evidence: ${row.evidence}` : '',
    row.gap ? `  - Gap: ${row.gap}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildChallengeReview(input) {
  return {
    reviewerAgent: 'serenity-challenge-agent',
    reviewVerdict: input.verdict,
    upgradeDecision: input.upgrade,
    chainCoverage: buildChainCoverage(input),
    missingLayers: [...new Set([...(input.partial || []), ...(input.missing || [])])],
    challengeQuestions: input.questions,
    redTeamSearches: buildRedTeamSearches(input),
    requiredFixes: input.fixes,
    nextChallengeTasks: input.fixes,
  };
}

function buildChainCoverage(input) {
  const covered = new Set(input.covered || []);
  const partial = new Set(input.partial || []);
  const missing = new Set(input.missing || []);
  return SERENITY_CHAIN.map((layer) => ({
    name: layer,
    status: covered.has(layer) ? 'covered' : partial.has(layer) ? 'partial' : missing.has(layer) ? 'missing' : 'unknown',
    evidence: covered.has(layer) ? 'Covered by the existing memo evidence or loop review.' : '',
    gap:
      partial.has(layer) || missing.has(layer) || (!covered.has(layer) && !partial.has(layer) && !missing.has(layer))
        ? 'Reviewer requires additional evidence before candidate upgrade or run closure.'
        : '',
  }));
}

function buildRedTeamSearches(input) {
  return [
    reviewRow('competitor supplier / omitted suppliers', 'needed', '', 'Verify supplier count and omitted suppliers for the proposed bottleneck.'),
    reviewRow('alternative technology route', 'needed', '', 'Test whether a substitute route weakens scarcity.'),
    reviewRow('gross margin / valuation / capacity expansion risk', 'needed', '', 'Check whether economics are already priced or can be diluted by capacity.'),
  ];
}

function question(name, status, evidence = '', gap = '') {
  return reviewRow(name, status, evidence, gap);
}

function reviewRow(name, status, evidence = '', gap = '') {
  return { name, status, evidence, gap };
}

main();
