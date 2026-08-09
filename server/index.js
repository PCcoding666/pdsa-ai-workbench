import express from 'express';
import Parser from 'rss-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  SERENITY_ALLOWED_USES,
  SERENITY_CANDIDATE_STATUSES,
  SERENITY_CLAIM_STATUSES,
  SERENITY_COMPANY_SOURCE_TYPES,
  SERENITY_FATAL_GATES,
  SERENITY_PROTOCOL_VERSION,
  SERENITY_RUN_MODES,
  SERENITY_RUN_STATUSES,
  SERENITY_SCORE_DIMENSIONS,
  buildSerenityObsidianNote,
  canTransitionSerenityRun,
  evaluateSerenityRun,
  scoreSerenityCandidate,
} from './serenity-v2.js';
import {
  buildSerenityDomainResearchSeed,
  getDefaultSerenityDomainWatchlist,
  mergeSerenityDomainWatchlist,
} from './serenity-domain-scheduler.js';
import { buildSerenityCompanyAnalysisMock } from './serenity-company-analysis.js';
import { selectRealtimeEvents, shouldServeStoredLiveEventsImmediately } from './realtime-events.js';
import { createCorsMiddleware, resolveServerNetworkConfig } from './network-security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const PORT = Number(process.env.PORT || 3002);
const SERVER_NETWORK = resolveServerNetworkConfig(process.env);
const CACHE_TTL_MS = Number(process.env.RSS_CACHE_TTL_MS || 10 * 60 * 1000);
const MAX_ITEMS_PER_SOURCE = Number(process.env.RSS_ITEMS_PER_SOURCE || 8);
const RSS_FETCH_CONCURRENCY = Number(process.env.RSS_FETCH_CONCURRENCY || 6);
const DINGTALK_TIMEOUT_MS = Number(process.env.DINGTALK_TIMEOUT_MS || 10 * 1000);
const DINGTALK_BRIEFING_LIMIT = Number(process.env.DINGTALK_BRIEFING_LIMIT || 8);
const OFFICIAL_HOLDINGS_CACHE_TTL_MS = Number(process.env.OFFICIAL_HOLDINGS_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const OFFICIAL_HOLDINGS_DOCUMENT_LIMIT = Number(process.env.OFFICIAL_HOLDINGS_DOCUMENT_LIMIT || 12);
const OFFICIAL_HOLDINGS_DOCUMENT_CONCURRENCY = Number(process.env.OFFICIAL_HOLDINGS_DOCUMENT_CONCURRENCY || 3);
const LLM_API_KEY = readEnvValue('LLM_API_KEY');
const LLM_BASE_URL = (process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
const LLM_MODEL = process.env.LLM_MODEL || 'qwen-plus';
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 30 * 1000);
const DATA_DIR = process.env.DATA_DIR || path.join(rootDir, 'data');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const VOC_PROJECTS_FILE = path.join(DATA_DIR, 'voc-projects.json');
const SOURCE_REGISTRY_FILE = path.join(DATA_DIR, 'source-registry.json');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const RESEARCH_QUEUE_FILE = path.join(DATA_DIR, 'research-queue.json');
const SERENITY_ARCHIVE_FILE = process.env.SERENITY_ARCHIVE_FILE || path.join(DATA_DIR, 'serenity-archive.json');
const SERENITY_THESIS_FILE = path.join(DATA_DIR, 'serenity-thesis-cards.json');
const SERENITY_DISCOVERY_RUNS_FILE = path.join(DATA_DIR, 'serenity-discovery-runs.json');
const SERENITY_DOMAIN_WATCHLIST_FILE = path.join(DATA_DIR, 'serenity-domain-watchlist.json');
const SERENITY_DOMAIN_SCHEDULER_FILE = path.join(DATA_DIR, 'serenity-domain-scheduler-state.json');
const AI_RADAR_RESEARCH_RUNS_FILE = path.join(DATA_DIR, 'ai-radar-research-runs.json');
const OBSIDIAN_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || path.join(DATA_DIR, 'obsidian');
const SERENITY_OBSIDIAN_DIR = process.env.SERENITY_OBSIDIAN_DIR || 'Projects/Information Gain/Serenity Research Runs';
const OPEN_CABINET_DATA_URL = 'https://open-cabinet.org/data/full-dataset.json';
const CLOSED_SERENITY_STATUSES = new Set(['closed_no_candidate', 'closed_candidate_found']);
const SERENITY_COMPANY_SOURCE_TYPE_SET = new Set(SERENITY_COMPANY_SOURCE_TYPES);

const rssSources = [
  {
    id: 'openai',
    name: 'OpenAI News',
    region: '海外',
    category: '模型',
    url: 'https://openai.com/news/rss.xml',
    alwaysInclude: true,
    tags: ['OpenAI', '模型', '产品发布'],
  },
  {
    id: 'google-ai',
    name: 'Google AI Blog',
    region: '海外',
    category: '模型',
    url: 'https://blog.google/technology/ai/rss/',
    alwaysInclude: true,
    tags: ['Google', 'Gemini', '应用'],
  },
  {
    id: 'google-research',
    name: 'Google Research Blog',
    region: '海外',
    category: '模型',
    url: 'https://research.google/blog/rss/',
    tags: ['Google Research', '研究', '模型'],
  },
  {
    id: 'aws-ml',
    name: 'AWS Machine Learning Blog',
    region: '海外',
    category: '应用',
    url: 'https://aws.amazon.com/blogs/machine-learning/feed/',
    alwaysInclude: true,
    tags: ['云服务', '应用', 'AI Infra'],
  },
  {
    id: 'nvidia-blog',
    name: 'NVIDIA Blog',
    region: '海外',
    category: '生态',
    url: 'https://blogs.nvidia.com/feed/',
    tags: ['NVIDIA', '算力', 'AI Infra'],
  },
  {
    id: 'nvidia-developer',
    name: 'NVIDIA Developer Blog',
    region: '海外',
    category: '生态',
    url: 'https://developer.nvidia.com/blog/feed/',
    tags: ['NVIDIA', '推理', 'AI Infra'],
  },
  {
    id: 'hugging-face',
    name: 'Hugging Face Blog',
    region: '海外',
    category: '生态',
    url: 'https://huggingface.co/blog/feed.xml',
    alwaysInclude: true,
    tags: ['开源', '生态', '模型'],
  },
  {
    id: 'qwen',
    name: 'Qwen Blog',
    region: '国内',
    category: '模型',
    url: 'https://qwenlm.github.io/blog/index.xml',
    alwaysInclude: true,
    tags: ['Qwen', '通义', '百炼'],
  },
  {
    id: 'qbitai',
    name: '量子位',
    region: '国内',
    category: '模型',
    url: 'https://www.qbitai.com/feed',
    tags: ['量子位', '模型', '产业'],
  },
  {
    id: 'arxiv-ai',
    name: 'arXiv cs.AI',
    region: '海外',
    category: '模型',
    url: 'https://rss.arxiv.org/rss/cs.AI',
    tags: ['论文', '研究', '模型'],
  },
  {
    id: 'arxiv-cl',
    name: 'arXiv cs.CL',
    region: '海外',
    category: '模型',
    url: 'https://rss.arxiv.org/rss/cs.CL',
    tags: ['论文', 'NLP', 'LLM'],
  },
  {
    id: 'bair',
    name: 'BAIR Blog',
    region: '海外',
    category: '模型',
    url: 'https://bair.berkeley.edu/blog/feed.xml',
    alwaysInclude: true,
    tags: ['Berkeley', '研究', '模型'],
  },
  {
    id: 'the-gradient',
    name: 'The Gradient',
    region: '海外',
    category: '生态',
    url: 'https://thegradient.pub/rss/',
    alwaysInclude: true,
    tags: ['研究', '观点', 'AI Safety'],
  },
  {
    id: 'techcrunch-ai',
    name: 'TechCrunch AI',
    region: '海外',
    category: '投融资',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    alwaysInclude: true,
    tags: ['投融资', '应用', '创业'],
  },
  {
    id: 'venturebeat-ai',
    name: 'VentureBeat AI',
    region: '海外',
    category: '应用',
    url: 'https://venturebeat.com/category/ai/feed/',
    alwaysInclude: true,
    tags: ['企业 AI', '应用', '投融资'],
  },
  {
    id: 'simon-willison',
    name: 'Simon Willison',
    region: '海外',
    category: '应用',
    url: 'https://simonwillison.net/atom/everything/',
    tags: ['开发者', 'Agent', 'LLM'],
  },
  {
    id: 'latent-space',
    name: 'Latent Space',
    region: '海外',
    category: '生态',
    url: 'https://www.latent.space/feed',
    tags: ['开发者', 'Agent', '生态'],
  },
  {
    id: 'import-ai',
    name: 'Import AI',
    region: '海外',
    category: '生态',
    url: 'https://importai.substack.com/feed',
    tags: ['研究', '政策', '趋势'],
  },
  {
    id: 'infoq-cn',
    name: 'InfoQ 中文',
    region: '国内',
    category: '应用',
    url: 'https://www.infoq.cn/feed',
    tags: ['架构', '工程', '应用'],
  },
  {
    id: '36kr',
    name: '36氪',
    region: '国内',
    category: '投融资',
    url: 'https://www.36kr.com/feed',
    tags: ['投融资', '创业', '商业'],
  },
  {
    id: 'tmtpost',
    name: '钛媒体',
    region: '国内',
    category: '投融资',
    url: 'https://www.tmtpost.com/rss',
    tags: ['产业', '投融资', '商业'],
  },
];

const defaultSourceRegistry = [
  {
    id: 'bloomberg-tv',
    name: 'Bloomberg TV',
    type: 'live_tv',
    group: '实时电视',
    url: 'https://www.bloomberg.com/live/stream',
    access: 'free_or_browser_accessible',
    trustTier: 'secondary_interpretation',
    latency: 'realtime',
    captureMethod: 'browser_audio_asr',
    status: 'candidate',
    priority: 1,
    notes: '优先作为直播 ASR MVP 源；作为快速市场解释和宏观语境，不当作最高可信事实源。',
  },
  {
    id: 'cnbc-live-tv',
    name: 'CNBC Live TV',
    type: 'live_tv',
    group: '实时电视',
    url: 'https://www.cnbc.com/live-tv/',
    access: 'subscription_or_tv_provider',
    trustTier: 'secondary_interpretation',
    latency: 'realtime',
    captureMethod: 'browser_audio_asr',
    status: 'needs_login',
    priority: 2,
    notes: '如果当前机器能合法播放，使用浏览器自动化采集本机音频并转录。',
  },
  {
    id: 'fox-business-live',
    name: 'Fox Business Live',
    type: 'live_tv',
    group: '实时电视',
    url: 'https://www.foxbusiness.com/fbntv',
    access: 'subscription_or_tv_provider',
    trustTier: 'secondary_interpretation',
    latency: 'realtime',
    captureMethod: 'browser_audio_asr',
    status: 'needs_login',
    priority: 3,
    notes: '用于补充美股市场评论和情绪信号；事件需要被官方源或专业媒体交叉验证。',
  },
  {
    id: 'sec-edgar',
    name: 'SEC EDGAR',
    type: 'official',
    group: '官方一手',
    url: 'https://www.sec.gov/edgar',
    access: 'free',
    trustTier: 'primary_official',
    latency: 'near_realtime',
    captureMethod: 'api_or_web',
    status: 'candidate',
    priority: 1,
    notes: '美股事实层核心源：10-K、10-Q、8-K、S-1、Form 4 等。',
  },
  {
    id: 'company-ir',
    name: 'Company Investor Relations',
    type: 'official',
    group: '官方一手',
    url: '',
    access: 'free',
    trustTier: 'primary_company',
    latency: 'near_realtime',
    captureMethod: 'rss_or_web',
    status: 'candidate',
    priority: 1,
    notes: '公司新闻稿、财报材料、电话会信息和管理层口径。',
  },
  {
    id: 'serenity-archive',
    name: 'Serenity / Aleabitoreddit Archive',
    type: 'community_alpha',
    group: '社区研究',
    url: 'https://serenity349.online/',
    access: 'local_archive',
    trustTier: 'social_discovery',
    latency: 'archive',
    captureMethod: 'local_json',
    status: 'active',
    priority: 2,
    notes: '用于抽象产业链瓶颈方法论和候选 thesis；不能替代一手文件验证。',
  },
  {
    id: 'federal-reserve',
    name: 'Federal Reserve',
    type: 'macro',
    group: '宏观官方',
    url: 'https://www.federalreserve.gov/newsevents.htm',
    access: 'free',
    trustTier: 'primary_official',
    latency: 'near_realtime',
    captureMethod: 'rss_or_web',
    status: 'candidate',
    priority: 1,
    notes: 'FOMC、讲话、利率和金融条件相关的一手宏观信息。',
  },
  {
    id: 'bls',
    name: 'Bureau of Labor Statistics',
    type: 'macro',
    group: '宏观官方',
    url: 'https://www.bls.gov/news.release/',
    access: 'free',
    trustTier: 'primary_official',
    latency: 'scheduled',
    captureMethod: 'rss_or_web',
    status: 'candidate',
    priority: 2,
    notes: 'CPI、就业、工资等宏观发布。',
  },
  {
    id: 'bea',
    name: 'Bureau of Economic Analysis',
    type: 'macro',
    group: '宏观官方',
    url: 'https://www.bea.gov/news/current-releases',
    access: 'free',
    trustTier: 'primary_official',
    latency: 'scheduled',
    captureMethod: 'rss_or_web',
    status: 'candidate',
    priority: 2,
    notes: 'GDP、PCE、企业利润等宏观发布。',
  },
  {
    id: 'yahoo-finance',
    name: 'Yahoo Finance',
    type: 'market_media',
    group: '免费媒体',
    url: 'https://finance.yahoo.com/',
    access: 'free',
    trustTier: 'professional_media',
    latency: 'near_realtime',
    captureMethod: 'rss_or_web',
    status: 'candidate',
    priority: 2,
    notes: '美股新闻、行情页面和财报入口；适合与官方源交叉验证。',
  },
  {
    id: 'nasdaq-news',
    name: 'Nasdaq News',
    type: 'market_media',
    group: '免费媒体',
    url: 'https://www.nasdaq.com/news-and-insights',
    access: 'free',
    trustTier: 'professional_media',
    latency: 'near_realtime',
    captureMethod: 'rss_or_web',
    status: 'candidate',
    priority: 3,
    notes: '交易所新闻、公司新闻和市场评论。',
  },
  {
    id: 'marketwatch',
    name: 'MarketWatch',
    type: 'market_media',
    group: '免费媒体',
    url: 'https://www.marketwatch.com/',
    access: 'free',
    trustTier: 'professional_media',
    latency: 'near_realtime',
    captureMethod: 'rss_or_web',
    status: 'candidate',
    priority: 3,
    notes: '市场新闻和个股新闻补充源。',
  },
  {
    id: 'x-social',
    name: 'X / Twitter',
    type: 'social',
    group: '社交舆情',
    url: 'https://x.com/',
    access: 'browser_account',
    trustTier: 'social_discovery',
    latency: 'realtime',
    captureMethod: 'browser_or_api',
    status: 'candidate',
    priority: 4,
    notes: '用于发现和舆情，不作为事实确认源。',
  },
  {
    id: 'open-cabinet',
    name: 'Open Cabinet',
    type: 'political_disclosure',
    group: '官员持仓',
    url: 'https://open-cabinet.org/',
    access: 'free_json_csv',
    trustTier: 'public_records_aggregator',
    latency: 'weekly',
    captureMethod: 'json_download',
    status: 'active',
    priority: 1,
    notes: '结构化追踪行政分支官员 OGE 278-T 交易披露；数据源为 U.S. Office of Government Ethics。',
  },
  {
    id: 'trump-tracker',
    name: 'Trump Tracker',
    type: 'political_disclosure',
    group: '官员持仓',
    url: 'https://trumptracker.org/',
    access: 'free_dashboard',
    trustTier: 'public_records_aggregator',
    latency: 'near_realtime_or_periodic',
    captureMethod: 'web_dashboard',
    status: 'candidate',
    priority: 2,
    notes: '特朗普政府金融与经济仪表盘，展示 cabinet members、latest trades、top holdings 等。',
  },
  {
    id: 'trumpstrades',
    name: 'TrumpTrades',
    type: 'political_disclosure',
    group: '官员持仓',
    url: 'https://trumpstrades.com/',
    access: 'free_dashboard',
    trustTier: 'public_records_aggregator',
    latency: 'periodic',
    captureMethod: 'web_dashboard',
    status: 'candidate',
    priority: 2,
    notes: '特朗普 Q1 2026 OGE 278-T 交易披露分析仪表盘，适合作为 Trump-only drilldown。',
  },
  {
    id: 'oge-presidential-appointees',
    name: 'U.S. Office of Government Ethics',
    type: 'political_disclosure',
    group: '官员持仓',
    url: 'https://extapps2.oge.gov/201/Presiden.nsf',
    access: 'free_public_records',
    trustTier: 'primary_official',
    latency: 'official_filing',
    captureMethod: 'official_portal',
    status: 'candidate',
    priority: 1,
    notes: '行政分支财务披露的一手官方门户；聚合站数据都应回到 OGE 文件验证。',
  },
];

const tickerRules = [
  ['NVDA', ['nvda', 'nvidia', 'gpu', 'cuda', 'blackwell']],
  ['AMD', ['amd', 'instinct', 'mi300', 'mi350']],
  ['AVGO', ['avgo', 'broadcom', 'asic']],
  ['TSM', ['tsm', 'tsmc', 'taiwan semiconductor']],
  ['ARM', ['arm holdings', ' arm ']],
  ['MSFT', ['msft', 'microsoft', 'azure', 'openai']],
  ['GOOG', ['goog', 'googl', 'google', 'alphabet', 'gemini', 'deepmind']],
  ['AMZN', ['amzn', 'amazon', 'aws', 'bedrock']],
  ['META', ['meta', 'llama', 'facebook']],
  ['ORCL', ['orcl', 'oracle']],
  ['PLTR', ['pltr', 'palantir']],
  ['CRM', ['crm', 'salesforce']],
  ['SNOW', ['snowflake', ' snow ']],
  ['TSLA', ['tsla', 'tesla', 'robotaxi', 'optimus']],
  ['AAPL', ['aapl', 'apple', 'siri']],
  ['NFLX', ['nflx', 'netflix']],
  ['SMH', ['smh', 'semiconductor etf']],
  ['SOXX', ['soxx', 'semiconductor index']],
  ['QQQ', ['qqq', 'nasdaq 100']],
  ['SPY', ['spy', 's&p 500', 'sp500']],
  ['COIN', ['coinbase', 'coin']],
  ['MSTR', ['microstrategy', 'mstr', 'bitcoin treasury']],
];

const aiKeywords = [
  'ai',
  'artificial intelligence',
  'llm',
  'agent',
  'agents',
  'model',
  'models',
  'inference',
  'agentic',
  'transformer',
  'multimodal',
  'benchmark',
  'fine-tuning',
  'fine tuning',
  'rag',
  'embedding',
  'embeddings',
  'gpu',
  'cuda',
  'genai',
  'gemini',
  'nvidia',
  'openai',
  'claude',
  'qwen',
  'deepseek',
  'hugging face',
  '人工智能',
  '生成式',
  '大模型',
  '模型',
  '智能体',
  '多模态',
  '推理',
  '算力',
  '机器学习',
  '深度学习',
  '通义',
  '百炼',
  '千问',
  '智能',
  '向量',
  '微调',
  '评测',
  'ai infra',
];

const parser = new Parser({
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 PDSA-AI-Briefing/0.1',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
});

let cache = {
  generatedAt: null,
  expiresAt: 0,
  payload: null,
};
let briefingRefreshPromise = null;

let officialHoldingsCache = {
  generatedAt: null,
  expiresAt: 0,
  payload: null,
};

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(createCorsMiddleware(SERVER_NETWORK));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'pdsa-rss-briefing', time: new Date().toISOString() });
});

app.use(requireBasicAuth);

app.get('/api/sources', (req, res) => {
  res.json({
    total: rssSources.length,
    sources: rssSources.map(({ id, name, region, category, url, tags }) => ({
      id,
      name,
      region,
      category,
      url,
      tags,
    })),
  });
});

app.get('/api/source-registry', (req, res) => {
  const sources = getSourceRegistry();
  const type = cleanText(req.query.type || '');
  const filtered = type ? sources.filter((source) => source.type === type) : sources;
  res.json({
    generatedAt: new Date().toISOString(),
    total: filtered.length,
    sources: filtered,
    summary: summarizeSourceRegistry(filtered),
  });
});

app.get('/api/events', async (req, res) => {
  const limit = clampNumber(req.query.limit, 1, 120, 60);
  const forceRefresh = req.query.refresh === '1';
  const storedOnly = req.query.stored === '1';

  if (storedOnly) {
    const events = getStoredEvents().slice(0, limit);
    res.json({
      generatedAt: new Date().toISOString(),
      events,
      sourceHealth: { total: 0, ok: 0, failed: 0, failures: [] },
      summary: summarizeEvents(events),
      mode: 'stored',
    });
    return;
  }

  try {
    const payload = await getRealtimeEvents({ limit, forceRefresh });
    res.json(payload);
  } catch (error) {
    const storedEvents = getStoredEvents().slice(0, limit);
    res.status(storedEvents.length ? 200 : 502).json({
      generatedAt: new Date().toISOString(),
      events: storedEvents,
      sourceHealth: { total: rssSources.length, ok: 0, failed: rssSources.length },
      warning: error.message,
    });
  }
});

app.post('/api/events/transcripts', (req, res) => {
  try {
    const event = createTranscriptEvent(req.body || {});
    const nextEvents = upsertStoredEvent(event);
    res.status(201).json({ event, total: nextEvents.length });
  } catch (error) {
    res.status(400).json({
      error: 'TRANSCRIPT_EVENT_CREATE_FAILED',
      message: error.message,
    });
  }
});

app.get('/api/research/queue', (req, res) => {
  const items = getResearchQueue();
  res.json({
    generatedAt: new Date().toISOString(),
    total: items.length,
    items,
    summary: summarizeResearchQueue(items),
  });
});

app.post('/api/research/queue', (req, res) => {
  try {
    const item = createResearchQueueItem(req.body || {});
    const items = getResearchQueue();
    const nextItems = [item, ...items.filter((current) => current.id !== item.id)].slice(0, 120);
    writeJsonFile(RESEARCH_QUEUE_FILE, nextItems);
    res.status(201).json({ item, items: nextItems, summary: summarizeResearchQueue(nextItems) });
  } catch (error) {
    res.status(400).json({
      error: 'RESEARCH_QUEUE_CREATE_FAILED',
      message: error.message,
    });
  }
});

app.get('/api/serenity/research-system', (req, res) => {
  try {
    res.json(buildSerenityResearchSystem());
  } catch (error) {
    res.status(500).json({
      error: 'SERENITY_RESEARCH_SYSTEM_FAILED',
      message: error.message,
    });
  }
});

app.get('/api/serenity/domain-research', (req, res) => {
  try {
    const domains = getSerenityDomainWatchlist();
    const schedulerState = readJsonFile(SERENITY_DOMAIN_SCHEDULER_FILE, null);
    res.json({
      generatedAt: new Date().toISOString(),
      total: domains.length,
      domains,
      schedulerState,
      note: 'Module 2 domain research can run independently from live-TV ingestion. Generated runs are framework seeds, not completed investment research.',
    });
  } catch (error) {
    res.status(500).json({
      error: 'SERENITY_DOMAIN_RESEARCH_READ_FAILED',
      message: error.message,
    });
  }
});

app.post('/api/serenity/company-analysis/mock', (req, res) => {
  try {
    const payload = buildSerenityCompanyAnalysisMock(req.body || {});
    res.status(200).json(payload);
  } catch (error) {
    res.status(400).json({
      error: 'SERENITY_COMPANY_ANALYSIS_MOCK_FAILED',
      message: error.message,
    });
  }
});

app.post('/api/serenity/domain-research/run', (req, res) => {
  try {
    const result = runSerenityDomainResearchScheduler(req.body || {}, {
      dryRun: req.query.dryRun === '1',
    });
    res.status(result.dryRun ? 200 : 201).json(result);
  } catch (error) {
    res.status(400).json({
      error: 'SERENITY_DOMAIN_RESEARCH_RUN_FAILED',
      message: error.message,
    });
  }
});

app.post('/api/serenity/thesis-cards', (req, res) => {
  try {
    const card = normalizeSerenityCustomCard(req.body || {});
    const storedCards = readJsonFile(SERENITY_THESIS_FILE, []);
    const nextCards = [card, ...(Array.isArray(storedCards) ? storedCards : []).filter((item) => item.id !== card.id)].slice(0, 80);
    writeJsonFile(SERENITY_THESIS_FILE, nextCards);
    res.status(201).json({ card, total: nextCards.length });
  } catch (error) {
    res.status(400).json({
      error: 'SERENITY_THESIS_CREATE_FAILED',
      message: error.message,
    });
  }
});

app.post('/api/serenity/thesis-cards/:id/research', (req, res) => {
  try {
    const cardId = cleanText(req.params.id || '');
    const payload = buildSerenityResearchSystem();
    const card = (payload.thesisCards || []).find((item) => item.id === cardId);
    if (!card) {
      res.status(404).json({ error: 'SERENITY_THESIS_NOT_FOUND', message: `Cannot find thesis card ${cardId}` });
      return;
    }

    const item = createResearchQueueItem(buildResearchQueueInputFromSerenityCard(card));
    const items = getResearchQueue();
    const nextItems = [item, ...items.filter((current) => current.id !== item.id)].slice(0, 120);
    writeJsonFile(RESEARCH_QUEUE_FILE, nextItems);
    res.status(201).json({ item, items: nextItems, summary: summarizeResearchQueue(nextItems) });
  } catch (error) {
    res.status(400).json({
      error: 'SERENITY_RESEARCH_QUEUE_CREATE_FAILED',
      message: error.message,
    });
  }
});

app.get('/api/serenity/discovery-runs', (req, res) => {
  const runs = getSerenityDiscoveryRuns();
  res.json({
    generatedAt: new Date().toISOString(),
    protocolVersion: SERENITY_PROTOCOL_VERSION,
    total: runs.length,
    runs,
  });
});

app.post('/api/serenity/discovery-runs', (req, res) => {
  try {
    const input = req.body || {};
    const now = new Date().toISOString();
    let run = normalizeSerenityDiscoveryRun(input);
    const existing = getSerenityDiscoveryRunById(run.id);

    if (CLOSED_SERENITY_STATUSES.has(run.status)) {
      res.status(409).json({
        error: 'SERENITY_CLOSE_ENDPOINT_REQUIRED',
        message: 'Use POST /api/serenity/discovery-runs/:id/close to close a Research Run.',
      });
      return;
    }

    if (!existing && run.status !== 'queued') {
      assertSerenityTransition('queued', run.status, input.transition);
      run = appendSerenityStateTransition(run, 'queued', run.status, input.transition, now);
    } else if (existing && existing.status !== run.status) {
      assertSerenityTransition(existing.status, run.status, input.transition);
      run = appendSerenityStateTransition(run, existing.status, run.status, input.transition, now);
    }

    run = markSerenityDashboardSynced(markSerenityObsidianPending(run, 'Research Run changed after last Obsidian sync.'), now);
    const validation = evaluateSerenityRun(run, { now });
    assertSerenityRunConfig(validation);
    assertSerenityCandidateUpgrades(validation);
    run = { ...run, validation };
    const nextRuns = upsertSerenityDiscoveryRun(run);
    res.status(existing ? 200 : 201).json({ run, validation, total: nextRuns.length });
  } catch (error) {
    res.status(400).json({
      error: 'SERENITY_DISCOVERY_RUN_CREATE_FAILED',
      message: error.message,
    });
  }
});

app.get('/api/serenity/discovery-runs/:id/validate', (req, res) => {
  const run = getSerenityDiscoveryRunById(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'SERENITY_DISCOVERY_RUN_NOT_FOUND', message: `Cannot find Research Run ${req.params.id}` });
    return;
  }
  const validation = evaluateSerenityRun(run);
  res.json({ runId: run.id, validation });
});

app.post('/api/serenity/discovery-runs/:id/status', (req, res) => {
  try {
    const run = getSerenityDiscoveryRunById(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'SERENITY_DISCOVERY_RUN_NOT_FOUND', message: `Cannot find Research Run ${req.params.id}` });
      return;
    }

    const nextStatus = cleanText(req.body?.status || '');
    if (CLOSED_SERENITY_STATUSES.has(nextStatus)) {
      res.status(409).json({
        error: 'SERENITY_CLOSE_ENDPOINT_REQUIRED',
        message: 'Use POST /api/serenity/discovery-runs/:id/close to close a Research Run.',
      });
      return;
    }

    assertSerenityTransition(run.status, nextStatus, req.body);
    const now = new Date().toISOString();
    let nextRun = appendSerenityStateTransition({ ...run, status: nextStatus, updatedAt: now }, run.status, nextStatus, req.body, now);
    nextRun = markSerenityDashboardSynced(markSerenityObsidianPending(nextRun, 'Research Run status changed.'), now);
    const validation = evaluateSerenityRun(nextRun, { now });
    nextRun = { ...nextRun, validation };
    upsertSerenityDiscoveryRun(nextRun);
    res.json({ run: nextRun, validation });
  } catch (error) {
    res.status(400).json({
      error: 'SERENITY_DISCOVERY_RUN_STATUS_FAILED',
      message: error.message,
    });
  }
});

app.post('/api/serenity/discovery-runs/:id/sync/obsidian', (req, res) => {
  const run = getSerenityDiscoveryRunById(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'SERENITY_DISCOVERY_RUN_NOT_FOUND', message: `Cannot find Research Run ${req.params.id}` });
    return;
  }

  const now = new Date().toISOString();
  let failureTarget = 'obsidian';
  try {
    const notePath = getSerenityObsidianNotePath(run);
    let nextRun = markSerenityObsidianSynced(run, notePath, now);
    const validation = evaluateSerenityRun(nextRun, { now });
    nextRun = { ...nextRun, validation };
    writeSerenityObsidianNote(nextRun, validation, notePath);
    failureTarget = 'research_run_persistence';
    upsertSerenityDiscoveryRun(nextRun);
    res.json({ run: nextRun, validation, notePath });
  } catch (error) {
    const nextRun = markSerenitySyncFailed(run, failureTarget, error.message, now);
    upsertSerenityDiscoveryRun({ ...nextRun, validation: evaluateSerenityRun(nextRun, { now }) });
    res.status(502).json({
      error: 'SERENITY_OBSIDIAN_SYNC_FAILED',
      message: error.message,
      run: nextRun,
    });
  }
});

app.post('/api/serenity/discovery-runs/:id/close', (req, res) => {
  const run = getSerenityDiscoveryRunById(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'SERENITY_DISCOVERY_RUN_NOT_FOUND', message: `Cannot find Research Run ${req.params.id}` });
    return;
  }

  const targetStatus = cleanText(req.body?.status || '');
  if (!CLOSED_SERENITY_STATUSES.has(targetStatus)) {
    res.status(400).json({
      error: 'SERENITY_CLOSE_STATUS_INVALID',
      message: 'Close status must be closed_no_candidate or closed_candidate_found.',
    });
    return;
  }

  const now = new Date().toISOString();
  try {
    assertSerenityTransition(run.status, targetStatus, req.body);
  } catch (error) {
    res.status(400).json({
      error: 'SERENITY_CLOSE_TRANSITION_INVALID',
      message: error.message,
    });
    return;
  }

  let nextRun = appendSerenityStateTransition(
    { ...run, status: targetStatus, updatedAt: now },
    run.status,
    targetStatus,
    req.body,
    now
  );
  nextRun = markSerenityDashboardSynced(nextRun, now);
  const notePath = getSerenityObsidianNotePath(nextRun);
  nextRun = markSerenityObsidianSynced(nextRun, notePath, now);
  const validation = evaluateSerenityRun(nextRun, { now, targetStatus });

  if (!validation.can_close) {
    res.status(409).json({
      error: 'SERENITY_CLOSE_GATE_FAILED',
      message: 'Research Run cannot close until all V2 close criteria pass.',
      validation,
    });
    return;
  }

  let failureTarget = 'next_queue';
  try {
    nextRun = { ...nextRun, validation };
    const queueSync = syncSerenityNextQueue(nextRun);
    nextRun = {
      ...nextRun,
      sync: {
        ...nextRun.sync,
        next_queue: {
          status: 'success',
          last_synced_at: now,
          items_written: queueSync.itemsWritten,
        },
      },
    };
    const finalValidation = evaluateSerenityRun(nextRun, { now, targetStatus });
    nextRun = { ...nextRun, validation: finalValidation };
    failureTarget = 'obsidian';
    writeSerenityObsidianNote(nextRun, finalValidation, notePath);
    failureTarget = 'research_run_persistence';
    upsertSerenityDiscoveryRun(nextRun);
    res.json({ run: nextRun, validation: finalValidation, notePath, queueSync });
  } catch (error) {
    const blockedAt = new Date().toISOString();
    let blockedRun = markSerenitySyncFailed(run, failureTarget, error.message, blockedAt);
    if (canTransitionSerenityRun(run.status, 'blocked')) {
      blockedRun = appendSerenityStateTransition(
        { ...blockedRun, status: 'blocked', updatedAt: blockedAt },
        run.status,
        'blocked',
        {
          reason: 'Research Run close failed because a required close-time synchronization or persistence step failed.',
          relatedEvidence: error.message,
          actor: cleanText(req.body?.actor || 'system'),
        },
        blockedAt
      );
    }
    blockedRun = { ...blockedRun, validation: evaluateSerenityRun(blockedRun, { now: blockedAt }) };
    if (failureTarget === 'research_run_persistence') {
      try {
        const blockedNotePath = getSerenityObsidianNotePath(blockedRun);
        blockedRun = markSerenityObsidianSynced(blockedRun, blockedNotePath, blockedAt);
        blockedRun = { ...blockedRun, validation: evaluateSerenityRun(blockedRun, { now: blockedAt }) };
        writeSerenityObsidianNote(blockedRun, blockedRun.validation, blockedNotePath);
      } catch (noteError) {
        blockedRun = markSerenityObsidianFailed(blockedRun, noteError.message, blockedAt);
        blockedRun = { ...blockedRun, validation: evaluateSerenityRun(blockedRun, { now: blockedAt }) };
      }
    }
    upsertSerenityDiscoveryRun(blockedRun);
    res.status(502).json({
      error: 'SERENITY_CLOSE_FAILED',
      message: error.message,
      run: blockedRun,
    });
  }
});

app.get('/api/ai-radar/research-runs', (req, res) => {
  const runs = getAiRadarResearchRuns();
  res.json({
    generatedAt: new Date().toISOString(),
    total: runs.length,
    runs,
  });
});

app.post('/api/ai-radar/research-runs', (req, res) => {
  try {
    const run = normalizeAiRadarResearchRun(req.body || {});
    const storedRuns = readJsonFile(AI_RADAR_RESEARCH_RUNS_FILE, []);
    const nextRuns = [run, ...(Array.isArray(storedRuns) ? storedRuns : []).filter((item) => item.id !== run.id)].slice(0, 80);
    writeJsonFile(AI_RADAR_RESEARCH_RUNS_FILE, nextRuns);
    res.status(201).json({ run, total: nextRuns.length });
  } catch (error) {
    res.status(400).json({
      error: 'AI_RADAR_RESEARCH_RUN_CREATE_FAILED',
      message: error.message,
    });
  }
});

app.get('/api/official-holdings', async (req, res) => {
  const forceRefresh = req.query.refresh === '1';
  try {
    const payload = await getOfficialHoldings({ forceRefresh });
    res.json(payload);
  } catch (error) {
    res.status(502).json({
      error: 'OFFICIAL_HOLDINGS_FAILED',
      message: error.message,
      generatedAt: new Date().toISOString(),
      sources: getOfficialHoldingsSources(),
      summary: buildEmptyOfficialHoldingsSummary(),
      officials: [],
      latestTransactions: [],
      tickerExposure: [],
      notableEvents: [],
    });
  }
});

app.get('/api/official-holdings/sources', (req, res) => {
  const sources = getOfficialHoldingsSources();
  res.json({
    generatedAt: new Date().toISOString(),
    total: sources.length,
    sources,
  });
});

app.get('/api/official-holdings/documents/:slug', async (req, res) => {
  try {
    const documents = await fetchOpenCabinetOfficialDocuments(req.params.slug);
    res.json({
      generatedAt: new Date().toISOString(),
      slug: req.params.slug,
      officialUrl: buildOpenCabinetOfficialUrl(req.params.slug),
      documents,
    });
  } catch (error) {
    res.status(502).json({
      error: 'OFFICIAL_DOCUMENTS_FAILED',
      message: error.message,
    });
  }
});

app.get('/api/briefing', async (req, res) => {
  const limit = clampNumber(req.query.limit, 6, 60, 24);
  const forceRefresh = req.query.refresh === '1';

  try {
    const payload = await getBriefing({ forceRefresh });
    const items = payload.items.slice(0, limit);
    res.json({
      ...payload,
      items,
      insights: buildBriefingInsights({ ...payload, items }, limit),
    });
  } catch (error) {
    res.status(502).json({
      error: 'RSS_BRIEFING_FAILED',
      message: error.message,
      generatedAt: new Date().toISOString(),
      items: [],
      sourceHealth: { total: rssSources.length, ok: 0, failed: rssSources.length },
    });
  }
});

app.get('/api/briefing/export.md', async (req, res) => {
  const limit = clampNumber(req.query.limit, 6, 60, 24);
  const forceRefresh = req.query.refresh === '1';

  try {
    const payload = await getBriefing({ forceRefresh });
    const markdown = formatBriefingMarkdown(payload, limit);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pdsa-ai-briefing-${toDateSlug(payload.generatedAt)}.md"`);
    res.send(markdown);
  } catch (error) {
    res.status(502).json({
      error: 'RSS_BRIEFING_EXPORT_FAILED',
      message: error.message,
    });
  }
});

app.get('/api/subscriptions', (req, res) => {
  res.json({ subscriptions: readJsonFile(SUBSCRIPTIONS_FILE, []) });
});

app.post('/api/subscriptions', (req, res) => {
  const subscription = normalizeSubscription(req.body || {});
  const subscriptions = readJsonFile(SUBSCRIPTIONS_FILE, []);
  const nextSubscriptions = [subscription, ...subscriptions].slice(0, 80);
  writeJsonFile(SUBSCRIPTIONS_FILE, nextSubscriptions);
  res.status(201).json({ subscription, subscriptions: nextSubscriptions });
});

app.delete('/api/subscriptions/:id', (req, res) => {
  const subscriptions = readJsonFile(SUBSCRIPTIONS_FILE, []);
  const nextSubscriptions = subscriptions.filter((item) => item.id !== req.params.id);
  writeJsonFile(SUBSCRIPTIONS_FILE, nextSubscriptions);
  res.json({ subscriptions: nextSubscriptions });
});

app.get('/api/voc/projects', (req, res) => {
  const projects = readJsonFile(VOC_PROJECTS_FILE, []);
  res.json({
    projects: projects.map(({ id, product, createdAt, updatedAt, analysis }) => ({
      id,
      product,
      createdAt,
      updatedAt,
      sampleCount: analysis?.posts?.length || 0,
      negativeShare: analysis?.sentimentSummary?.negative || 0,
      topTheme: analysis?.topThemes?.[0]?.theme || '',
      analysisMethod: analysis?.analysisMethod || 'rules',
      model: analysis?.model || '',
    })),
  });
});

app.get('/api/voc/projects/:id', (req, res) => {
  const project = findVocProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'VOC_PROJECT_NOT_FOUND' });
    return;
  }
  res.json({ project });
});

app.post('/api/voc/projects', async (req, res) => {
  try {
    const project = await createVocProject(req.body || {});
    const projects = readJsonFile(VOC_PROJECTS_FILE, []);
    const nextProjects = [project, ...projects.filter((item) => item.id !== project.id)].slice(0, 60);
    writeJsonFile(VOC_PROJECTS_FILE, nextProjects);
    res.status(201).json({ project });
  } catch (error) {
    res.status(500).json({
      error: 'VOC_PROJECT_CREATE_FAILED',
      message: error.message,
    });
  }
});

app.delete('/api/voc/projects/:id', (req, res) => {
  const projects = readJsonFile(VOC_PROJECTS_FILE, []);
  const nextProjects = projects.filter((project) => project.id !== req.params.id);
  writeJsonFile(VOC_PROJECTS_FILE, nextProjects);
  res.json({ projects: nextProjects });
});

app.get('/api/voc/projects/:id/export.md', (req, res) => {
  const project = findVocProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'VOC_PROJECT_NOT_FOUND' });
    return;
  }

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="voc-${project.id}.md"`);
  res.send(formatVocProjectMarkdown(project));
});

app.post('/api/push/dingtalk', async (req, res) => {
  if (!isAuthorizedPushRequest(req)) {
    res.status(401).json({ error: 'UNAUTHORIZED_PUSH_REQUEST', message: 'Invalid push token' });
    return;
  }

  const limit = clampNumber(req.query.limit ?? req.body?.limit, 1, 20, DINGTALK_BRIEFING_LIMIT);
  const forceRefresh = req.query.refresh === '1' || req.body?.refresh === true;

  try {
    const result = await sendDingTalkBriefing({ limit, forceRefresh });
    res.json(result);
  } catch (error) {
    const status = error.code === 'DINGTALK_NOT_CONFIGURED' ? 503 : 502;
    res.status(status).json({
      error: error.code || 'DINGTALK_PUSH_FAILED',
      message: error.message,
    });
  }
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(PORT, SERVER_NETWORK.host, () => {
  console.log(`RSS briefing API listening on http://${SERVER_NETWORK.host}:${PORT}`);
});

async function getBriefing({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cache.payload && cache.expiresAt > now) {
    return { ...cache.payload, cached: true };
  }

  const results = await mapWithConcurrency(rssSources, RSS_FETCH_CONCURRENCY, fetchSource);
  const successful = results
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value.items);
  const failures = results
    .map((result, index) => ({ result, source: rssSources[index] }))
    .filter(({ result }) => result.status === 'rejected')
    .map(({ result, source }) => ({
      id: source.id,
      name: source.name,
      reason: result.reason?.message || 'unknown error',
    }));

  const items = dedupeItems(successful)
    .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime())
    .slice(0, 80);

  const payload = {
    generatedAt: new Date().toISOString(),
    cached: false,
    sourceHealth: {
      total: rssSources.length,
      ok: rssSources.length - failures.length,
      failed: failures.length,
      failures,
    },
    items,
  };

  cache = {
    generatedAt: payload.generatedAt,
    expiresAt: now + CACHE_TTL_MS,
    payload,
  };

  return payload;
}

function getSourceRegistry() {
  const customSources = readJsonFile(SOURCE_REGISTRY_FILE, []);
  const rssRegistry = rssSources.map((source) => ({
    id: `ai-rss-${source.id}`,
    name: source.name,
    type: 'ai_frontier',
    group: 'AI 前沿',
    url: source.url,
    access: 'free_rss',
    trustTier: source.region === '国内' ? 'professional_media' : 'professional_media',
    latency: 'near_realtime',
    captureMethod: 'rss',
    status: 'active',
    priority: source.alwaysInclude ? 2 : 3,
    category: source.category,
    region: source.region,
    tags: source.tags || [],
    notes: `当前 AI 简报 RSS 源，分类：${source.category}。`,
  }));

  const byId = new Map();
  [...defaultSourceRegistry, ...rssRegistry, ...customSources].forEach((source) => {
    const normalized = normalizeSourceRegistryItem(source);
    if (normalized.id) byId.set(normalized.id, normalized);
  });

  return Array.from(byId.values()).sort((a, b) => a.priority - b.priority || a.group.localeCompare(b.group, 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN'));
}

function normalizeSourceRegistryItem(source) {
  return {
    id: truncate(cleanText(source.id || source.name || crypto.randomUUID()).toLowerCase().replace(/[^a-z0-9-]+/g, '-'), 80),
    name: truncate(cleanText(source.name || 'Unknown source'), 120),
    type: truncate(cleanText(source.type || 'other'), 40),
    group: truncate(cleanText(source.group || '未分组'), 60),
    url: truncate(cleanText(source.url || ''), 300),
    access: truncate(cleanText(source.access || 'unknown'), 60),
    trustTier: truncate(cleanText(source.trustTier || 'unknown'), 60),
    latency: truncate(cleanText(source.latency || 'unknown'), 60),
    captureMethod: truncate(cleanText(source.captureMethod || 'manual'), 80),
    status: truncate(cleanText(source.status || 'candidate'), 40),
    priority: clampNumber(source.priority, 1, 9, 5),
    category: truncate(cleanText(source.category || ''), 40),
    region: truncate(cleanText(source.region || ''), 40),
    tags: Array.isArray(source.tags) ? source.tags.map(cleanText).filter(Boolean).slice(0, 8) : [],
    notes: truncate(cleanText(source.notes || ''), 260),
  };
}

function summarizeSourceRegistry(sources) {
  return {
    byType: countBy(sources, (source) => source.type),
    byStatus: countBy(sources, (source) => source.status),
    liveCount: sources.filter((source) => source.type === 'live_tv').length,
    officialCount: sources.filter((source) => ['official', 'macro'].includes(source.type)).length,
    aiCount: sources.filter((source) => source.type === 'ai_frontier').length,
  };
}

function getOfficialHoldingsSources() {
  return getSourceRegistry().filter((source) => source.type === 'political_disclosure');
}

async function getOfficialHoldings({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && officialHoldingsCache.payload && officialHoldingsCache.expiresAt > now) {
    return { ...officialHoldingsCache.payload, cached: true };
  }

  const response = await fetch(OPEN_CABINET_DATA_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 Information-Gain-Official-Holdings/0.1',
      Accept: 'application/json, text/plain, */*',
    },
  });

  if (!response.ok) throw new Error(`Open Cabinet returned HTTP ${response.status}`);
  const dataset = await response.json();
  const payload = await buildOfficialHoldingsPayload(dataset);

  officialHoldingsCache = {
    generatedAt: payload.generatedAt,
    expiresAt: now + OFFICIAL_HOLDINGS_CACHE_TTL_MS,
    payload,
  };

  return payload;
}

async function buildOfficialHoldingsPayload(dataset) {
  const officials = Array.isArray(dataset.officials) ? dataset.officials : [];
  const documentIndex = await buildOfficialDocumentIndex(officials);
  const flattenedTransactions = officials.flatMap((official) =>
    (official.transactions || []).map((transaction) => normalizeOfficialTransaction(official, transaction, documentIndex))
  );
  const latestTransactions = flattenedTransactions
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, 80);
  const trumpOfficial = officials.find((official) => /donald/i.test(official.name || '') && /trump/i.test(official.name || ''));
  const trumpTransactions = trumpOfficial
    ? (trumpOfficial.transactions || []).map((transaction) => normalizeOfficialTransaction(trumpOfficial, transaction, documentIndex))
    : [];
  const payload = {
    generatedAt: new Date().toISOString(),
    exportedAt: normalizeDate(dataset.exportedAt) || '',
    cached: false,
    sources: getOfficialHoldingsSources(),
    summary: buildOfficialHoldingsSummary({ dataset, officials, flattenedTransactions, trumpTransactions }),
    officials: officials
      .map((official) => normalizeOfficialSummary(official, documentIndex.get(cleanText(official.slug || slugify(official.name || 'official')))))
      .sort((a, b) => b.transactionCount - a.transactionCount || a.name.localeCompare(b.name))
      .slice(0, 80),
    latestTransactions,
    tickerExposure: buildOfficialTickerExposure(flattenedTransactions).slice(0, 60),
    trump: {
      official: trumpOfficial ? normalizeOfficialSummary(trumpOfficial, documentIndex.get(cleanText(trumpOfficial.slug || slugify(trumpOfficial.name || 'official')))) : null,
      latestTransactions: trumpTransactions
        .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
        .slice(0, 40),
      tickerExposure: buildOfficialTickerExposure(trumpTransactions).slice(0, 40),
    },
    notableEvents: buildOfficialHoldingEvents({ latestTransactions, trumpTransactions }).slice(0, 24),
  };

  return payload;
}

function buildEmptyOfficialHoldingsSummary() {
  return {
    officialCount: 0,
    transactionCount: 0,
    estimatedMidpoint: 0,
    lateFilingCount: 0,
    latestFilingDate: '',
    trumpTransactionCount: 0,
    trumpEstimatedMidpoint: 0,
  };
}

function buildOfficialHoldingsSummary({ dataset, officials, flattenedTransactions, trumpTransactions }) {
  const latestFilingDate = officials
    .map((official) => normalizeDate(official.mostRecentFilingDate))
    .filter(Boolean)
    .sort()
    .at(-1) || '';

  return {
    officialCount: clampNumber(dataset.officialCount, 0, 9999, officials.length),
    transactionCount: clampNumber(dataset.transactionCount, 0, 999999, flattenedTransactions.length),
    estimatedMidpoint: Math.round(flattenedTransactions.reduce((sum, transaction) => sum + transaction.amountMidpoint, 0)),
    lateFilingCount: flattenedTransactions.filter((transaction) => transaction.lateFilingFlag).length,
    latestFilingDate,
    trumpTransactionCount: trumpTransactions.length,
    trumpEstimatedMidpoint: Math.round(trumpTransactions.reduce((sum, transaction) => sum + transaction.amountMidpoint, 0)),
  };
}

async function buildOfficialDocumentIndex(officials) {
  const priorityOfficials = officials
    .slice()
    .sort((a, b) => {
      const aTrump = /trump/i.test(a.name || '') ? 1 : 0;
      const bTrump = /trump/i.test(b.name || '') ? 1 : 0;
      return bTrump - aTrump || (b.transactionCount || 0) - (a.transactionCount || 0);
    })
    .slice(0, Math.max(1, OFFICIAL_HOLDINGS_DOCUMENT_LIMIT));

  const results = await mapWithConcurrency(priorityOfficials, OFFICIAL_HOLDINGS_DOCUMENT_CONCURRENCY, async (official) => {
    const slug = cleanText(official.slug || slugify(official.name || 'official'));
    const documents = await fetchOpenCabinetOfficialDocuments(slug);
    return { slug, documents };
  });

  const index = new Map();
  results.forEach((result, indexNumber) => {
    const official = priorityOfficials[indexNumber];
    const slug = cleanText(official.slug || slugify(official.name || 'official'));
    if (result.status === 'fulfilled') {
      index.set(result.value.slug, result.value.documents);
    } else {
      console.warn(`Failed to fetch OGE documents for ${slug}: ${result.reason?.message || result.reason}`);
      index.set(slug, []);
    }
  });

  return index;
}

async function fetchOpenCabinetOfficialDocuments(slug) {
  const normalizedSlug = cleanText(slug || '');
  if (!normalizedSlug) return [];
  const url = buildOpenCabinetOfficialUrl(normalizedSlug);
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 Information-Gain-OGE-Verification/0.1',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) throw new Error(`Open Cabinet official page returned HTTP ${response.status}`);
  const html = await response.text();
  return parseOgeDocumentsFromHtml(html);
}

function parseOgeDocumentsFromHtml(html) {
  const rawUrls = Array.from(
    html.matchAll(/https:\/\/extapps2\.oge\.gov\/[^"'\\\s<]+(?:\\\/[^"'\\\s<]+)*?\.pdf/gi)
  ).map(([url]) => cleanupOgeUrl(url));
  const uniqueUrls = uniqueStrings(rawUrls).filter((url) => url.includes('/$FILE/') && url.toLowerCase().endsWith('.pdf'));

  return uniqueUrls.map((url, index) => {
    const decodedUrl = decodeURIComponentSafe(url);
    const fileName = decodedUrl.split('/').pop() || `OGE document ${index + 1}`;
    return {
      id: crypto.createHash('sha1').update(url).digest('hex').slice(0, 16),
      url,
      fileName,
      form: inferOgeFormType(fileName),
      filedDate: inferOgeDocumentDate(fileName),
      recordId: inferOgeRecordId(url),
    };
  });
}

function buildOgeVerificationChain({ official, transactionDate, documents }) {
  const transactionTime = transactionDate ? new Date(transactionDate).getTime() : 0;
  const candidateDocuments = (documents || [])
    .filter((document) => document.form === '278-T' || !document.form)
    .sort((a, b) => {
      const aDistance = getDocumentDistance(a.filedDate, transactionTime);
      const bDistance = getDocumentDistance(b.filedDate, transactionTime);
      return aDistance - bDistance;
    })
    .slice(0, 5);

  return {
    status: candidateDocuments.length ? 'source_documents_available' : 'profile_only',
    openCabinetOfficialUrl: official.openCabinetUrl,
    ogePortalUrl: official.ogePortalUrl,
    sourceDocuments: candidateDocuments,
    verificationNote: candidateDocuments.length
      ? 'Open Cabinet lists OGE source PDFs for this official. Match the transaction against the PDF before using it as hard evidence.'
      : 'No source PDF was found in the fetched Open Cabinet profile. Verify manually in the OGE public disclosure portal.',
  };
}

function buildOpenCabinetOfficialUrl(slug) {
  return `https://open-cabinet.org/officials/${cleanText(slug)}`;
}

function getDocumentDistance(filedDate, transactionTime) {
  if (!filedDate || !transactionTime) return Number.MAX_SAFE_INTEGER;
  const filedTime = new Date(filedDate).getTime();
  if (!Number.isFinite(filedTime)) return Number.MAX_SAFE_INTEGER;
  return Math.abs(filedTime - transactionTime);
}

function cleanupOgeUrl(url) {
  return cleanText(url)
    .replace(/\\+/g, '')
    .replace(/%5C/gi, '')
    .replace(/\\u0026/g, '&');
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function inferOgeFormType(fileName) {
  const text = cleanText(fileName).toLowerCase();
  if (text.includes('278-t') || text.includes('278t')) return '278-T';
  if (text.includes('278e') || text.includes('annual')) return '278e';
  if (text.includes('278')) return '278';
  if (text.includes('ethics')) return 'Ethics Agreement';
  if (text.includes('divestiture')) return 'Certificate of Divestiture';
  return '';
}

function inferOgeDocumentDate(fileName) {
  const text = cleanText(fileName);
  const dotDate = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dotDate) {
    const [, month, day, year] = dotDate;
    return new Date(Number(year), Number(month) - 1, Number(day)).toISOString();
  }
  const dashDate = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dashDate) {
    const [, year, month, day] = dashDate;
    return new Date(Number(year), Number(month) - 1, Number(day)).toISOString();
  }
  return '';
}

function inferOgeRecordId(url) {
  const match = cleanText(url).match(/PAS\+Index\/([^/]+)\//i);
  return match?.[1] || '';
}

function normalizeOfficialSummary(official, sourceDocuments = []) {
  const slug = cleanText(official.slug || slugify(official.name || 'official'));
  return {
    name: cleanText(official.name || ''),
    slug,
    title: cleanText(official.title || ''),
    agency: cleanText(official.agency || ''),
    level: cleanText(official.level || ''),
    confirmedDate: normalizeDate(official.confirmedDate) || cleanText(official.confirmedDate || ''),
    departedDate: normalizeDate(official.departedDate) || cleanText(official.departedDate || ''),
    transactionCount: clampNumber(official.transactionCount, 0, 999999, (official.transactions || []).length),
    mostRecentFilingDate: normalizeDate(official.mostRecentFilingDate) || cleanText(official.mostRecentFilingDate || ''),
    openCabinetUrl: buildOpenCabinetOfficialUrl(slug),
    ogePortalUrl: 'https://extapps2.oge.gov/201/Presiden.nsf',
    sourceDocuments: sourceDocuments.slice(0, 12),
  };
}

function normalizeOfficialTransaction(official, transaction, documentIndex = new Map()) {
  const slug = cleanText(official.slug || slugify(official.name || 'official'));
  const sourceDocuments = documentIndex.get(slug) || [];
  const officialSummary = normalizeOfficialSummary(official, sourceDocuments);
  const amount = cleanText(transaction.amount || '');
  const range = parseDollarRange(amount);
  const description = truncate(cleanText(transaction.description || transaction.asset || ''), 220);
  const ticker = cleanText(transaction.ticker || '').toUpperCase();
  const type = cleanText(transaction.type || '');
  const date = normalizeDate(transaction.date) || cleanText(transaction.date || '');
  const id = crypto
    .createHash('sha1')
    .update(`${officialSummary.slug}:${date}:${ticker}:${type}:${amount}:${description}`)
    .digest('hex')
    .slice(0, 16);

  return {
    id,
    official: officialSummary,
    description,
    ticker,
    type,
    date,
    amount,
    amountLow: range.low,
    amountHigh: range.high,
    amountMidpoint: range.midpoint,
    lateFilingFlag: transaction.lateFilingFlag === true,
    source: 'Open Cabinet / OGE',
    verificationChain: buildOgeVerificationChain({
      official: officialSummary,
      transactionDate: date,
      documents: sourceDocuments,
    }),
  };
}

function buildOfficialTickerExposure(transactions) {
  const rows = new Map();
  transactions.forEach((transaction) => {
    const ticker = cleanText(transaction.ticker || '').toUpperCase();
    if (!ticker) return;
    const row = rows.get(ticker) || {
      ticker,
      company: transaction.description || ticker,
      transactions: 0,
      purchases: 0,
      sales: 0,
      estimatedMidpoint: 0,
      latestDate: '',
      officials: new Set(),
      lateFilings: 0,
    };
    row.transactions += 1;
    if (/purchase/i.test(transaction.type)) row.purchases += 1;
    if (/sale/i.test(transaction.type)) row.sales += 1;
    row.estimatedMidpoint += transaction.amountMidpoint || 0;
    if (!row.latestDate || new Date(transaction.date || 0) > new Date(row.latestDate || 0)) row.latestDate = transaction.date;
    if (transaction.official?.name) row.officials.add(transaction.official.name);
    if (transaction.lateFilingFlag) row.lateFilings += 1;
    rows.set(ticker, row);
  });

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      estimatedMidpoint: Math.round(row.estimatedMidpoint),
      officials: Array.from(row.officials).slice(0, 8),
    }))
    .sort((a, b) => b.estimatedMidpoint - a.estimatedMidpoint || b.transactions - a.transactions || a.ticker.localeCompare(b.ticker));
}

function buildOfficialHoldingEvents({ latestTransactions, trumpTransactions }) {
  const highValueTransactions = [...trumpTransactions, ...latestTransactions]
    .filter((transaction) => transaction.amountMidpoint >= 1000000 || transaction.lateFilingFlag)
    .sort((a, b) => b.amountMidpoint - a.amountMidpoint || new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

  return dedupeEvents(highValueTransactions.map(buildEventFromOfficialTransaction));
}

function buildEventFromOfficialTransaction(transaction) {
  const isTrump = /trump/i.test(transaction.official?.name || '');
  const sourceDocument = transaction.verificationChain?.sourceDocuments?.[0] || null;
  const themes = uniqueStrings([
    'Political disclosure',
    isTrump ? 'Trump holdings' : 'Executive branch holdings',
    transaction.lateFilingFlag ? 'Late filing' : '',
    transaction.type ? `OGE ${transaction.type}` : '',
  ]);
  const title = `${transaction.official?.name || 'U.S. official'} ${transaction.type || 'reported'} ${transaction.ticker || transaction.description}`;
  return normalizeEventInput({
    id: `oge:${transaction.id}`,
    createdAt: new Date().toISOString(),
    publishedAt: transaction.date || new Date().toISOString(),
    source: {
      id: 'open-cabinet',
      name: 'Open Cabinet / OGE',
      type: 'political_disclosure',
      trustTier: 'public_records_aggregator',
    },
    title,
    summary: `${transaction.official?.title || 'Official'} · ${transaction.official?.agency || 'U.S. government'} · ${transaction.amount || 'amount undisclosed'}${transaction.lateFilingFlag ? ' · late filing flagged' : ''}`,
    rawText: JSON.stringify(transaction),
    url: sourceDocument?.url || transaction.verificationChain?.openCabinetOfficialUrl || 'https://open-cabinet.org/',
    tickers: transaction.ticker ? [transaction.ticker] : [],
    themes,
    eventType: 'official_disclosure',
    impact: {
      direction: 'unknown',
      timeHorizon: 'multi-quarter',
      affectedAreas: ['political signal', 'conflict-of-interest risk', 'market narrative'],
    },
    evidence: [
      {
        type: 'public_disclosure',
        text: `${transaction.description} / ${transaction.type} / ${transaction.amount}`,
        timestamp: transaction.date || new Date().toISOString(),
        url: sourceDocument?.url || transaction.verificationChain?.openCabinetOfficialUrl || 'https://open-cabinet.org/download',
      },
    ],
    verification: {
      needsVerification: true,
      verifiedBy: sourceDocument ? ['Open Cabinet dataset', `OGE source PDF: ${sourceDocument.fileName}`] : ['Open Cabinet dataset sourced from OGE'],
      counterEvidence: transaction.verificationChain?.verificationNote ? [transaction.verificationChain.verificationNote] : [],
    },
    score: {
      importance: transaction.amountMidpoint >= 5000000 || isTrump ? 0.86 : 0.68,
      novelty: 0.64,
      confidence: 0.74,
    },
  });
}

function parseDollarRange(value) {
  const numbers = cleanText(value)
    .replace(/,/g, '')
    .match(/\$?(\d+(?:\.\d+)?)([KMB])?/gi);
  if (!numbers?.length) return { low: 0, high: 0, midpoint: 0 };
  const parsed = numbers.map(parseDollarAmount).filter((amount) => Number.isFinite(amount));
  const low = parsed[0] || 0;
  const high = parsed[1] || low;
  return {
    low,
    high,
    midpoint: Math.round((low + high) / 2),
  };
}

function parseDollarAmount(value) {
  const match = cleanText(value).replace(/,/g, '').match(/\$?(\d+(?:\.\d+)?)([KMB])?/i);
  if (!match) return 0;
  const number = Number(match[1]);
  const suffix = (match[2] || '').toUpperCase();
  const multiplier = suffix === 'B' ? 1000000000 : suffix === 'M' ? 1000000 : suffix === 'K' ? 1000 : 1;
  return number * multiplier;
}

async function getRealtimeEvents({ limit = 60, forceRefresh = false } = {}) {
  const storedEvents = getStoredEvents();
  const hasCachedBriefing = Boolean(cache.payload && cache.expiresAt > Date.now());
  if (shouldServeStoredLiveEventsImmediately({ storedEvents, hasCachedBriefing, forceRefresh })) {
    refreshBriefingInBackground();
    const events = selectRealtimeEvents({ storedEvents, generatedEvents: [], limit });
    return {
      generatedAt: new Date().toISOString(),
      events,
      sourceHealth: { total: rssSources.length, ok: 0, failed: 0, failures: [], refreshing: true },
      summary: summarizeEvents(events),
      warning: 'RSS refresh is running in the background; persisted live transcript events are current.',
    };
  }

  let briefingPayload = null;
  let briefingError = '';
  try {
    briefingPayload = await getBriefing({ forceRefresh });
  } catch (error) {
    briefingError = error.message;
  }

  const aiEvents = (briefingPayload?.items || []).map((item) => buildEventFromBriefingItem(item, briefingPayload.generatedAt));
  const events = selectRealtimeEvents({ storedEvents, generatedEvents: aiEvents, limit });

  const sourceHealth = briefingPayload?.sourceHealth || {
    total: rssSources.length,
    ok: 0,
    failed: rssSources.length,
    failures: briefingError ? [{ id: 'ai-rss', name: 'AI RSS pipeline', reason: briefingError }] : [],
  };

  return {
    generatedAt: new Date().toISOString(),
    events,
    sourceHealth,
    summary: summarizeEvents(events),
    warning: briefingError,
  };
}

function refreshBriefingInBackground() {
  if (briefingRefreshPromise) return;
  briefingRefreshPromise = getBriefing()
    .catch(() => null)
    .finally(() => { briefingRefreshPromise = null; });
}

function getStoredEvents() {
  const stored = readJsonFile(EVENTS_FILE, []);
  return Array.isArray(stored) ? stored.map(normalizeEventInput).filter(Boolean) : [];
}

function upsertStoredEvent(event) {
  const normalized = normalizeEventInput(event);
  if (!normalized) throw new Error('Invalid event payload');
  const events = getStoredEvents();
  const nextEvents = [normalized, ...events.filter((item) => item.id !== normalized.id)].slice(0, 500);
  writeJsonFile(EVENTS_FILE, nextEvents);
  return nextEvents;
}

function buildEventFromBriefingItem(item, generatedAt) {
  const text = `${item.title || ''} ${item.summary || ''} ${(item.tags || []).join(' ')}`;
  const tickers = extractTickers(text);
  const themes = uniqueStrings([...(item.tags || []), item.category, ...inferMarketThemes(text)]).slice(0, 8);
  const sourceId = `ai-rss-${rssSources.find((source) => source.name === item.source)?.id || slugify(item.source || 'rss')}`;
  const eventType = inferEventType(text, item.category);
  const importance = item.impact === '高' ? 0.82 : 0.58;

  return normalizeEventInput({
    id: `ai:${crypto.createHash('sha1').update(item.id || item.link || item.title || crypto.randomUUID()).digest('hex').slice(0, 16)}`,
    createdAt: generatedAt || new Date().toISOString(),
    publishedAt: item.publishedAt || generatedAt || new Date().toISOString(),
    source: {
      id: sourceId,
      name: item.source || 'AI RSS',
      type: 'ai_frontier',
      trustTier: 'professional_media',
    },
    title: item.title,
    summary: item.summary,
    rawText: `${item.title || ''}\n${item.summary || ''}`,
    url: item.link || item.sourceUrl || '',
    tickers,
    themes,
    eventType,
    impact: {
      direction: inferImpactDirection(text),
      timeHorizon: eventType === 'funding' ? 'multi-quarter' : 'quarter',
      affectedAreas: inferAffectedAreas(text, themes),
    },
    evidence: [
      {
        type: 'rss_item',
        text: truncate(item.summary || item.title || '', 360),
        timestamp: item.publishedAt || generatedAt || new Date().toISOString(),
        url: item.link || '',
      },
    ],
    verification: {
      needsVerification: true,
      verifiedBy: [],
      counterEvidence: [],
    },
    score: {
      importance,
      novelty: 0.62,
      confidence: 0.68,
    },
  });
}

function createTranscriptEvent(input) {
  const sourceId = cleanText(input.sourceId || input.source || '');
  const source = getSourceRegistry().find((item) => item.id === sourceId || item.name === sourceId);
  const transcript = normalizeMultilineText(input.transcript || input.text || input.rawText || '');
  const timestamp = normalizeDate(input.timestamp || input.publishedAt);
  const sourceName = source?.name || cleanText(input.sourceName || input.source || 'Manual Transcript');
  const audioWindow = normalizeAudioWindow(input.audioWindow, timestamp, input.timeWindow);
  const audioFile = truncate(cleanText(input.audioFile || input.sourceFile || ''), 400);
  const asrBackend = truncate(cleanText(input.asrBackend || ''), 80);
  const workerId = truncate(cleanText(input.workerId || ''), 120);
  const missingFields = [
    ['sourceId', sourceId],
    ['sourceName', cleanText(input.sourceName)],
    ['timestamp', timestamp],
    ['transcript', transcript],
    ['audioWindow', audioWindow],
    ['audioFile', audioFile],
    ['asrBackend', asrBackend],
    ['workerId', workerId],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missingFields.length) throw new Error(`Transcript event requires: ${missingFields.join(', ')}`);

  const title = truncate(cleanText(input.title || summarizeTranscriptTitle(transcript)), 160);
  const tickers = extractTickers(`${title} ${transcript}`);
  const themes = uniqueStrings([...(Array.isArray(input.themes) ? input.themes : []), ...inferMarketThemes(`${title} ${transcript}`)]).slice(0, 8);

  return normalizeEventInput({
    id: input.id || `transcript:${crypto.createHash('sha1').update(`${sourceId}:${timestamp}:${transcript}`).digest('hex').slice(0, 16)}`,
    createdAt: new Date().toISOString(),
    publishedAt: timestamp,
    source: {
      id: source?.id || sourceId || 'manual-transcript',
      name: sourceName,
      type: source?.type || 'live_tv',
      trustTier: source?.trustTier || 'secondary_interpretation',
    },
    sourceId: source?.id || sourceId || 'manual-transcript',
    sourceName,
    timestamp,
    transcript,
    audioWindow,
    audioFile,
    asrBackend,
    workerId,
    title,
    summary: truncate(cleanText(input.summary || transcript), 260),
    rawText: transcript,
    url: source?.url || cleanText(input.url || ''),
    tickers,
    themes,
    eventType: 'broadcast_mention',
    impact: {
      direction: inferImpactDirection(`${title} ${transcript}`),
      timeHorizon: 'intraday',
      affectedAreas: inferAffectedAreas(`${title} ${transcript}`, themes),
    },
    evidence: [
      {
        type: 'transcript_segment',
        text: truncate(transcript, 600),
        timestamp,
        timeWindow: truncate(cleanText(input.timeWindow || formatAudioWindow(audioWindow)), 80),
        audioWindow,
        audioFile,
        asrBackend,
        workerId,
      },
    ],
    verification: {
      needsVerification: true,
      verifiedBy: [],
      counterEvidence: [],
    },
    score: {
      importance: tickers.length ? 0.74 : 0.52,
      novelty: 0.55,
      confidence: 0.58,
    },
  });
}

function normalizeEventInput(input) {
  if (!input || typeof input !== 'object') return null;
  const title = truncate(cleanText(input.title || input.claim || input.summary || ''), 180);
  const rawText = normalizeMultilineText(input.rawText || input.transcript || input.text || input.summary || title);
  if (!title && !rawText) return null;
  const sourceInput = input.source && typeof input.source === 'object' ? input.source : {};
  const sourceName = cleanText(sourceInput.name || input.sourceName || input.source || 'Unknown Source');
  const sourceType = cleanText(sourceInput.type || input.sourceType || 'unknown');
  const sourceId = cleanText(sourceInput.id || input.sourceId || slugify(sourceName || sourceType || 'source'));
  const publishedAt = normalizeDate(input.publishedAt || input.timestamp) || new Date().toISOString();
  const eventText = `${title} ${rawText} ${(input.themes || []).join(' ')}`;
  const tickers = normalizeStringArray(input.tickers).concat(extractTickers(eventText));
  const themes = normalizeStringArray(input.themes).concat(inferMarketThemes(eventText));

  const asrMetadata = normalizeAsrMetadata(input, { sourceId, sourceName, timestamp: publishedAt, rawText });
  return {
    id: cleanText(input.id || `event:${crypto.createHash('sha1').update(`${sourceId}:${publishedAt}:${title || rawText}`).digest('hex').slice(0, 16)}`),
    createdAt: normalizeDate(input.createdAt) || new Date().toISOString(),
    publishedAt,
    source: {
      id: sourceId,
      name: truncate(sourceName, 120),
      type: truncate(sourceType, 40),
      trustTier: truncate(cleanText(sourceInput.trustTier || input.trustTier || 'unknown'), 60),
    },
    title: title || truncate(rawText, 180),
    summary: truncate(cleanText(input.summary || rawText || title), 320),
    rawText,
    url: truncate(cleanText(input.url || input.link || ''), 400),
    tickers: uniqueStrings(tickers).slice(0, 12),
    themes: uniqueStrings(themes).slice(0, 10),
    eventType: truncate(cleanText(input.eventType || inferEventType(eventText, '')), 60),
    impact: normalizeImpact(input.impact, eventText, themes),
    evidence: normalizeEvidence(input.evidence, publishedAt, rawText),
    verification: normalizeVerification(input.verification),
    score: normalizeScore(input.score, eventText),
    ...asrMetadata,
  };
}

function normalizeImpact(input, eventText, themes) {
  const impact = input && typeof input === 'object' ? input : {};
  return {
    direction: cleanText(impact.direction || inferImpactDirection(eventText)),
    timeHorizon: cleanText(impact.timeHorizon || inferTimeHorizon(eventText)),
    affectedAreas: uniqueStrings(normalizeStringArray(impact.affectedAreas).concat(inferAffectedAreas(eventText, themes))).slice(0, 8),
  };
}

function normalizeEvidence(input, timestamp, fallbackText) {
  const evidence = Array.isArray(input) ? input : input ? [input] : [];
  const normalized = evidence
    .map((item) => {
      if (typeof item === 'string') {
        return { type: 'note', text: truncate(cleanText(item), 500), timestamp };
      }
      if (!item || typeof item !== 'object') return null;
      const audioWindow = normalizeAudioWindow(item.audioWindow, timestamp, item.timeWindow);
      return {
        type: truncate(cleanText(item.type || 'source_excerpt'), 60),
        text: truncate(cleanText(item.text || item.excerpt || item.summary || ''), 700),
        timestamp: normalizeDate(item.timestamp) || timestamp,
        url: truncate(cleanText(item.url || ''), 400),
        timeWindow: truncate(cleanText(item.timeWindow || ''), 80),
        ...(audioWindow ? { audioWindow } : {}),
        audioFile: truncate(cleanText(item.audioFile || ''), 400),
        asrBackend: truncate(cleanText(item.asrBackend || ''), 80),
        workerId: truncate(cleanText(item.workerId || ''), 120),
      };
    })
    .filter((item) => item && item.text);

  if (normalized.length) return normalized.slice(0, 6);
  return [{ type: 'source_excerpt', text: truncate(cleanText(fallbackText || ''), 500), timestamp }];
}

function normalizeAsrMetadata(input, { sourceId, sourceName, timestamp, rawText }) {
  const hasTranscriptMetadata = Boolean(input.transcript || input.audioWindow || input.audioFile || input.sourceFile || input.asrBackend || input.workerId);
  if (!hasTranscriptMetadata) return {};
  const audioWindow = normalizeAudioWindow(input.audioWindow, timestamp, input.timeWindow);
  return {
    sourceId,
    sourceName,
    timestamp,
    transcript: normalizeMultilineText(input.transcript || rawText),
    ...(audioWindow ? { audioWindow } : {}),
    audioFile: truncate(cleanText(input.audioFile || input.sourceFile || ''), 400),
    asrBackend: truncate(cleanText(input.asrBackend || ''), 80),
    workerId: truncate(cleanText(input.workerId || ''), 120),
  };
}

function normalizeAudioWindow(value, timestamp, fallbackTimeWindow = '') {
  const raw = value && typeof value === 'object' ? value : {};
  const start = normalizeDate(raw.start) || normalizeDate(timestamp);
  const end = normalizeDate(raw.end);
  const durationSeconds = Number(raw.durationSeconds);
  if (start && end && Number.isFinite(durationSeconds) && durationSeconds >= 0) {
    return { start, end, durationSeconds };
  }
  const range = cleanText(typeof value === 'string' ? value : fallbackTimeWindow);
  const [rangeStart, rangeEnd] = range.split('/').map(normalizeDate);
  if (rangeStart && rangeEnd) {
    return { start: rangeStart, end: rangeEnd, durationSeconds: Math.max(0, Math.round((new Date(rangeEnd).getTime() - new Date(rangeStart).getTime()) / 1000)) };
  }
  return null;
}

function formatAudioWindow(audioWindow) {
  return audioWindow?.start && audioWindow?.end ? `${audioWindow.start}/${audioWindow.end}` : '';
}

function normalizeVerification(input) {
  const verification = input && typeof input === 'object' ? input : {};
  return {
    needsVerification: verification.needsVerification !== false,
    verifiedBy: normalizeStringArray(verification.verifiedBy).slice(0, 8),
    counterEvidence: normalizeStringArray(verification.counterEvidence).slice(0, 8),
  };
}

function normalizeScore(input, eventText) {
  const score = input && typeof input === 'object' ? input : {};
  const tickers = extractTickers(eventText);
  return {
    importance: clampNumber(score.importance, 0, 1, tickers.length ? 0.68 : 0.48),
    novelty: clampNumber(score.novelty, 0, 1, 0.5),
    confidence: clampNumber(score.confidence, 0, 1, 0.6),
  };
}

function summarizeEvents(events) {
  return {
    total: events.length,
    needsVerification: events.filter((event) => event.verification?.needsVerification).length,
    withTickers: events.filter((event) => event.tickers?.length).length,
    bySourceType: countBy(events, (event) => event.source?.type || 'unknown'),
    topTickers: topCounts(events.flatMap((event) => event.tickers || []), 8),
    topThemes: topCounts(events.flatMap((event) => event.themes || []), 8),
  };
}

function getResearchQueue() {
  const stored = readJsonFile(RESEARCH_QUEUE_FILE, []);
  return Array.isArray(stored) ? stored : [];
}

function createResearchQueueItem(input) {
  const event = normalizeEventInput(input.event || {});
  const question = truncate(cleanText(input.question || inferResearchQuestion(event, input)), 220);
  if (!question) throw new Error('Research question is required');

  const tickers = uniqueStrings(normalizeStringArray(input.tickers).concat(event?.tickers || [])).slice(0, 12);
  const themes = uniqueStrings(normalizeStringArray(input.themes).concat(event?.themes || [])).slice(0, 10);
  const now = new Date().toISOString();

  return {
    id: input.id || `rq:${crypto.createHash('sha1').update(`${question}:${tickers.join(',')}:${now}`).digest('hex').slice(0, 16)}`,
    status: 'queued',
    priority: clampNumber(input.priority, 1, 5, event?.score?.importance >= 0.75 ? 1 : 3),
    question,
    tickers,
    themes,
    sourceEventId: event?.id || cleanText(input.sourceEventId || ''),
    sourceEvent: event
      ? {
          id: event.id,
          title: event.title,
          source: event.source,
          publishedAt: event.publishedAt,
          url: event.url,
          evidence: event.evidence?.slice(0, 2) || [],
        }
      : null,
    memoSkeleton: buildResearchMemoSkeleton({ question, event, tickers, themes }),
    createdAt: now,
    updatedAt: now,
  };
}

function summarizeResearchQueue(items) {
  return {
    byStatus: countBy(items, (item) => item.status || 'queued'),
    byPriority: countBy(items, (item) => `${item.priority || 3}`),
    topTickers: topCounts(items.flatMap((item) => item.tickers || []), 8),
    total: items.length,
  };
}

function buildSerenityResearchSystem() {
  const records = getSerenityArchiveRecords();
  const customCards = readJsonFile(SERENITY_THESIS_FILE, []);
  const generatedCards = getSerenityCuratedTheses().map((card) => enrichSerenityCard(card, records));
  const storedCards = (Array.isArray(customCards) ? customCards : []).map((card) => enrichSerenityCard(card, records)).filter(Boolean);
  const cardMap = new Map();

  [...generatedCards, ...storedCards].forEach((card) => {
    if (!card?.id) return;
    cardMap.set(card.id, card);
  });

  const thesisCards = Array.from(cardMap.values()).sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    return cleanText(b.stats?.lastSeen || b.updatedAt || '').localeCompare(cleanText(a.stats?.lastSeen || a.updatedAt || ''));
  });

  return {
    generatedAt: new Date().toISOString(),
    protocol: getSerenityProtocolDefinition(),
    source: {
      archiveFile: SERENITY_ARCHIVE_FILE,
      archiveExists: fs.existsSync(SERENITY_ARCHIVE_FILE),
      customCardsFile: SERENITY_THESIS_FILE,
      discoveryRunsFile: SERENITY_DISCOVERY_RUNS_FILE,
      obsidianVaultPath: OBSIDIAN_VAULT_PATH,
      obsidianDirectory: SERENITY_OBSIDIAN_DIR,
      trustTier: 'social_discovery',
      note: 'Serenity archive is a discovery and methodology source. Company filings, IR, patents and customer disclosures remain the verification layer.',
    },
    methodology: getSerenityMethodology(),
    focusAreas: getSerenityFocusAreas(thesisCards),
    summary: buildSerenityArchiveSummary(records, thesisCards),
    topSymbols: buildSerenityTopSymbols(records),
    evidenceFeed: buildSerenityEvidenceFeed(records),
    discoveryRuns: getSerenityDiscoveryRuns(),
    thesisCards,
  };
}

function getSerenityDomainWatchlist() {
  const overrides = readJsonFile(SERENITY_DOMAIN_WATCHLIST_FILE, []);
  return mergeSerenityDomainWatchlist(getDefaultSerenityDomainWatchlist(), overrides);
}

function runSerenityDomainResearchScheduler(input = {}, options = {}) {
  const now = new Date().toISOString();
  const domains = getSerenityDomainWatchlist();
  const domainIds = normalizeStringArray(input.domainIds || input.domain_ids || input.domainId || input.domain_id);
  const maxDomains =
    input.maxDomains || input.max_domains
      ? clampNumber(input.maxDomains ?? input.max_domains, 1, domains.length, domains.length)
      : domains.length;
  const dryRun = options.dryRun || input.dryRun === true || input.dry_run === true;
  const seed = buildSerenityDomainResearchSeed({
    domains,
    domainIds,
    maxDomains,
    now,
    researchOwner: cleanText(input.researchOwner || input.research_owner || 'chengpeng'),
    systemVersion: cleanText(input.systemVersion || input.system_version || '0.3.0'),
    skillVersion: cleanText(input.skillVersion || input.skill_version || 'serenity-market-discovery@2'),
  });

  if (dryRun) {
    return {
      dryRun: true,
      generatedAt: now,
      seed,
      wouldWrite: {
        discoveryRuns: seed.runs.length,
        researchQueueItems: seed.queueInputs.length,
      },
    };
  }

  const runResults = seed.runs.map((rawRun) => persistSerenityDomainRun(rawRun, now));
  const queueItems = seed.queueInputs.map((item) => createResearchQueueItem(item));
  const queueResult = mergeResearchQueueItems(queueItems);
  const schedulerState = {
    lastRunAt: now,
    mode: seed.mode,
    selectedDomains: seed.selectedDomains.map((domain) => domain.id),
    runIds: runResults.map((item) => item.run.id),
    queueItemIds: queueItems.map((item) => item.id),
    dryRun: false,
    note: 'Framework seed only. It does not claim source retrieval, Core Evidence collection or candidate upgrade completion.',
  };
  writeJsonFile(SERENITY_DOMAIN_SCHEDULER_FILE, schedulerState);

  return {
    dryRun: false,
    generatedAt: now,
    protocolVersion: seed.protocolVersion,
    selectedDomains: seed.selectedDomains,
    runs: runResults,
    researchQueue: queueResult,
    schedulerState,
  };
}

function persistSerenityDomainRun(rawRun, now = new Date().toISOString()) {
  let run = normalizeSerenityDiscoveryRun(rawRun);
  run = markSerenityDashboardSynced(markSerenityObsidianPending(run, 'Module 2 domain scheduler seeded or refreshed this Research Run.'), now);
  let notePath = getSerenityObsidianNotePath(run);
  let obsidianResult = {
    status: 'pending',
    notePath,
    error: '',
  };

  try {
    run = markSerenityObsidianSynced(run, notePath, now);
    const validationForNote = evaluateSerenityRun(run, { now });
    writeSerenityObsidianNote(run, validationForNote, notePath);
    obsidianResult = {
      status: 'success',
      notePath,
      error: '',
    };
  } catch (error) {
    run = markSerenitySyncFailed(run, 'obsidian', error.message, now);
    obsidianResult = {
      status: 'failed',
      notePath,
      error: error.message,
    };
  }

  run = {
    ...run,
    updatedAt: now,
    validation: evaluateSerenityRun(run, { now }),
  };
  upsertSerenityDiscoveryRun(run);
  return {
    run,
    obsidian: obsidianResult,
  };
}

function mergeResearchQueueItems(newItems) {
  const existing = getResearchQueue();
  const newIds = new Set(newItems.map((item) => item.id));
  const nextItems = [...newItems, ...existing.filter((item) => !newIds.has(item.id))].slice(0, 200);
  writeJsonFile(RESEARCH_QUEUE_FILE, nextItems);
  return {
    itemsWritten: newItems.length,
    total: nextItems.length,
    items: nextItems,
    summary: summarizeResearchQueue(nextItems),
  };
}

function getSerenityArchiveRecords() {
  const raw = readJsonFile(SERENITY_ARCHIVE_FILE, []);
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeSerenityArchiveRecord).filter(Boolean);
}

function normalizeSerenityArchiveRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const id = cleanText(record.id || record.statusId || record.url || '');
  const text = cleanText(record.text || record.textPreview || '');
  const textZh = cleanText(record.textZh || '');
  if (!id && !text && !textZh) return null;

  return {
    id,
    url: cleanText(record.url || ''),
    date: normalizeDate(record.date || record.createdAtUtc || record.createdAt || '') || cleanText(record.date || ''),
    createdAtUtc: normalizeDate(record.createdAtUtc || record.createdAt || record.date || ''),
    kind: cleanText(record.kind || 'post'),
    symbols: getSerenityRecordTickers(record),
    mentions: normalizeStringArray(record.mentions).slice(0, 8),
    text,
    textZh,
    textPreview: cleanText(record.textPreview || ''),
    engagement: getSerenityEngagement(record),
    favoriteCount: clampNumber(record.favoriteCount, 0, 9999999, 0),
    replyCount: clampNumber(record.replyCount, 0, 9999999, 0),
    retweetCount: clampNumber(record.retweetCount, 0, 9999999, 0),
    quoteCount: clampNumber(record.quoteCount, 0, 9999999, 0),
  };
}

function getSerenityMethodology() {
  return [
    {
      id: 'top-demand',
      title: '顶层需求',
      prompt: '先确认一个会持续花钱的上层需求，而不是先找股票。',
      output: 'AI capex、CPO、推理内存、机器人、电力等明确预算线。',
    },
    {
      id: 'architecture-shift',
      title: '技术路线',
      prompt: '判断需求增长是否来自架构变化；只有架构变了，供应链利润池才会重分配。',
      output: '800G/1.6T、CPO/硅光、外置光源、HBM/SSD、Neocloud 等路线图。',
    },
    {
      id: 'dependency-map',
      title: '逐层拆 BOM',
      prompt: '从第一层明星公司往下问：这一层要工作，下一层缺什么就会停摆？',
      output: 'GPU -> 数据中心 -> 光互联 -> 激光器 -> InP/晶圆/封装/测试。',
    },
    {
      id: 'scarcity-count',
      title: '数供应商',
      prompt: '统计关键环节全球能量产的玩家数量，优先找一到两家或实质垄断。',
      output: '供应商数量、产能约束、认证周期、替代路线。',
    },
    {
      id: 'public-carrier',
      title: '找上市载体',
      prompt: '优先选择小市值、业务纯度高、低覆盖、能直接吃到瓶颈价格或量的公司。',
      output: 'ticker、收入暴露、客户/认证、产能、资产负债表。',
    },
    {
      id: 'financial-rewrite',
      title: '财务重写',
      prompt: '把技术瓶颈翻译成收入、毛利、产能利用率和估值重估，而不是只讲故事。',
      output: '下一季/下一年收入弹性、毛利弹性、capex、稀释风险。',
    },
    {
      id: 'misclassification',
      title: '市场误分类',
      prompt: '确认市场是否还把它当作旧行业、周期股、低增速硬件或流动性差的小票。',
      output: '覆盖缺口、共识预期、同业估值锚、市场叙事差。',
    },
    {
      id: 'red-team',
      title: '公开反驳',
      prompt: '把论证交给懂行的人反驳，优先修补最强反方而不是寻找认同。',
      output: '反证列表、缺失供应商、客户真实性、技术替代。',
    },
    {
      id: 'catalyst-loop',
      title: '持续验证',
      prompt: '每 24-72 小时更新验证条件；只有 thesis 条件变化才改变判断。',
      output: '财报、IR、专利、海关/产能、论坛需求、客户订单、价格动作。',
    },
  ];
}

function getSerenityFocusAreas(cards = []) {
  const counts = countBy(cards, (card) => cleanText(card.focusArea || '未分组'));
  return [
    {
      id: 'ai-optics',
      title: 'AI 光通信 / CPO',
      cardCount: counts['AI 光通信 / CPO'] || 0,
      why: 'Serenity 最密集的线：GPU 集群扩张会把瓶颈推到光模块、激光器、InP、封装测试。',
      nextSources: ['公司 IR / 10-K', 'OFC / ECOC 会议材料', 'Ayar、POET、Jabil、Broadcom、NVIDIA 生态披露'],
    },
    {
      id: 'upstream-materials',
      title: '材料 / 衬底',
      cardCount: counts['材料 / 衬底'] || 0,
      why: '最符合“紫苏叶”隐喻：价值不在显眼终端，而在无法快速扩产的上游材料。',
      nextSources: ['专利数据库', '晶圆/衬底产能公告', '客户认证周期', '竞争对手产能扩张'],
    },
    {
      id: 'compute-infra',
      title: 'Neocloud / 算力基建',
      cardCount: counts['Neocloud / 算力基建'] || 0,
      why: '从 GPU 供给短缺转向数据中心、融资、利用率和客户合同的财务弹性。',
      nextSources: ['长期客户合同', '债务/租赁结构', '数据中心上线节奏', 'GPU 折旧和利用率'],
    },
    {
      id: 'memory-storage',
      title: '推理内存 / 存储',
      cardCount: counts['推理内存 / 存储'] || 0,
      why: 'AI agent 和推理规模化后，KV cache、SSD、DRAM/NAND 控制器可能成为二级瓶颈。',
      nextSources: ['云厂商实例规格', '供应商 channel check', '财报库存周期', '控制器/模组客户'],
    },
    {
      id: 'power-grid',
      title: '电力 / 电网',
      cardCount: counts['电力 / 电网'] || 0,
      why: 'AI 数据中心扩张向变压器、开关设备、公用事业和电网接入排队转移。',
      nextSources: ['ISO queue', '公用事业 capex plan', '变压器 backlog', '数据中心选址'],
    },
    {
      id: 'physical-ai',
      title: '机器人 / 物理 AI',
      cardCount: counts['机器人 / 物理 AI'] || 0,
      why: '如果机器人路线成立，受益方往往在执行器、传感、仿真和低层控制链条。',
      nextSources: ['BOM 拆解', '供应商认证', '量产良率', '客户试点规模'],
    },
    {
      id: 'latent-demand',
      title: '社区新增需求',
      cardCount: counts['社区新增需求'] || 0,
      why: 'RPI 式路径：开发者社区先出现真实增量需求，华尔街模型尚未计入。',
      nextSources: ['GitHub repo 增速', '论坛采购讨论', '渠道缺货', 'API/SDK 使用量'],
    },
  ];
}

function buildSerenityArchiveSummary(records, thesisCards) {
  const dates = records.map((record) => cleanText(record.date)).filter(Boolean).sort();
  const totalEngagement = records.reduce((sum, record) => sum + getSerenityEngagement(record), 0);
  return {
    archiveRecords: records.length,
    thesisCards: thesisCards.length,
    highScoreCards: thesisCards.filter((card) => card.score >= 78).length,
    withSymbols: records.filter((record) => record.symbols?.length).length,
    uniqueSymbols: new Set(records.flatMap((record) => record.symbols || [])).size,
    totalEngagement,
    dateRange: {
      first: dates[0] || '',
      last: dates[dates.length - 1] || '',
    },
    byKind: countBy(records, (record) => record.kind || 'post'),
  };
}

function buildSerenityTopSymbols(records) {
  const stats = new Map();
  records.forEach((record) => {
    (record.symbols || []).forEach((symbol) => {
      const current = stats.get(symbol) || { symbol, count: 0, engagement: 0, firstSeen: '', lastSeen: '' };
      const date = cleanText(record.date || record.createdAtUtc || '');
      current.count += 1;
      current.engagement += getSerenityEngagement(record);
      current.firstSeen = !current.firstSeen || (date && date < current.firstSeen) ? date : current.firstSeen;
      current.lastSeen = !current.lastSeen || (date && date > current.lastSeen) ? date : current.lastSeen;
      stats.set(symbol, current);
    });
  });

  return Array.from(stats.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.engagement - a.engagement;
    })
    .slice(0, 24);
}

function buildSerenityEvidenceFeed(records) {
  return records
    .filter((record) => record.symbols?.length && getSerenityRecordText(record))
    .sort((a, b) => getSerenityEngagement(b) - getSerenityEngagement(a))
    .slice(0, 18)
    .map((record) => serenityEvidenceFromRecord(record));
}

function getSerenityDiscoveryRuns() {
  const storedRuns = readJsonFile(SERENITY_DISCOVERY_RUNS_FILE, []);
  const runMap = new Map();
  [...getDefaultSerenityDiscoveryRuns(), ...(Array.isArray(storedRuns) ? storedRuns : [])]
    .map(normalizeSerenityDiscoveryRun)
    .filter(Boolean)
    .forEach((run) => runMap.set(run.id, { ...run, validation: evaluateSerenityRun(run) }));

  return Array.from(runMap.values()).sort((a, b) => cleanText(b.updatedAt || b.createdAt).localeCompare(cleanText(a.updatedAt || a.createdAt)));
}

function getSerenityProtocolDefinition() {
  return {
    version: SERENITY_PROTOCOL_VERSION,
    runModes: SERENITY_RUN_MODES,
    runStatuses: SERENITY_RUN_STATUSES,
    candidateStatuses: SERENITY_CANDIDATE_STATUSES,
    claimStatuses: SERENITY_CLAIM_STATUSES,
    allowedUses: SERENITY_ALLOWED_USES,
    companySourceTypes: SERENITY_COMPANY_SOURCE_TYPES,
    fatalGates: SERENITY_FATAL_GATES,
    scoreDimensions: SERENITY_SCORE_DIMENSIONS,
    obsidian: {
      vaultPath: OBSIDIAN_VAULT_PATH,
      directory: SERENITY_OBSIDIAN_DIR,
      fileNamingRule: 'YYYY-MM-DD - <run_id>.md',
      conflictPolicy: 'overwrite_same_run_id_only',
    },
  };
}

function getSerenityDiscoveryRunById(runId) {
  const id = cleanText(runId || '');
  if (!id) return null;
  return getSerenityDiscoveryRuns().find((run) => run.id === id) || null;
}

function upsertSerenityDiscoveryRun(run) {
  const normalized = normalizeSerenityDiscoveryRun(run);
  const storedRuns = readJsonFile(SERENITY_DISCOVERY_RUNS_FILE, []);
  const nextRuns = [normalized, ...(Array.isArray(storedRuns) ? storedRuns : []).filter((item) => cleanText(item.id) !== normalized.id)].slice(0, 120);
  writeJsonFile(SERENITY_DISCOVERY_RUNS_FILE, nextRuns);
  return nextRuns;
}

function assertSerenityRunConfig(validation) {
  if (
    validation.missing.includes('run_config_complete') ||
    validation.missing.includes('run_id_consistency') ||
    validation.missing.includes('run_mode_research')
  ) {
    throw new Error('Research Run configuration is incomplete or run_mode is not RESEARCH.');
  }
}

function assertSerenityCandidateUpgrades(validation) {
  const violations = (validation.candidate_results || []).filter((candidate) => candidate.status_violation);
  if (violations.length) {
    throw new Error(
      `${violations.map((candidate) => candidate.ticker || candidate.name || 'candidate').join(', ')} cannot be high_conviction_candidate before Fatal Gate, Challenge Gate and falsifier checks pass.`
    );
  }
}

function assertSerenityTransition(fromStatus, toStatus, transition = {}) {
  if (!SERENITY_RUN_STATUSES.includes(toStatus)) throw new Error(`Invalid Research Run status: ${toStatus}`);
  if (!canTransitionSerenityRun(fromStatus, toStatus)) {
    throw new Error(`Invalid Research Run transition: ${fromStatus || 'none'} -> ${toStatus}`);
  }
  if (fromStatus === toStatus) return;
  if (!cleanText(transition.reason || '')) throw new Error('State transition reason is required.');
  if (!cleanText(transition.actor || transition.responsible || '')) throw new Error('State transition actor is required.');
  if (!normalizeStringArray(transition.relatedEvidence || transition.related_evidence).length) {
    throw new Error('State transition relatedEvidence is required.');
  }
}

function appendSerenityStateTransition(run, fromStatus, toStatus, transition = {}, changedAt = new Date().toISOString()) {
  if (fromStatus === toStatus) return run;
  const row = normalizeSerenityStateTransition({
    changedAt,
    fromStatus,
    toStatus,
    reason: transition.reason,
    relatedEvidence: transition.relatedEvidence || transition.related_evidence,
    actor: transition.actor || transition.responsible,
  });
  return {
    ...run,
    stateTransitions: [...(run.stateTransitions || []), row].filter(Boolean).slice(-200),
  };
}

function markSerenityDashboardSynced(run, syncedAt = new Date().toISOString()) {
  return {
    ...run,
    sync: {
      ...(run.sync || {}),
      dashboard: {
        status: 'success',
        last_synced_at: syncedAt,
        error: '',
      },
    },
  };
}

function markSerenityObsidianPending(run, reason) {
  return {
    ...run,
    sync: {
      ...(run.sync || {}),
      obsidian: {
        ...(run.sync?.obsidian || {}),
        status: 'pending',
        error: truncate(cleanText(reason || ''), 1000),
        vault_path: OBSIDIAN_VAULT_PATH,
        directory: SERENITY_OBSIDIAN_DIR,
        conflict_policy: 'overwrite_same_run_id_only',
      },
    },
  };
}

function markSerenityObsidianSynced(run, notePath, syncedAt = new Date().toISOString()) {
  return {
    ...run,
    sync: {
      ...(run.sync || {}),
      obsidian: {
        ...(run.sync?.obsidian || {}),
        status: 'success',
        last_synced_at: syncedAt,
        error: '',
        vault_path: OBSIDIAN_VAULT_PATH,
        directory: SERENITY_OBSIDIAN_DIR,
        note_path: notePath,
        conflict_policy: 'overwrite_same_run_id_only',
      },
    },
  };
}

function markSerenityObsidianFailed(run, error, failedAt = new Date().toISOString()) {
  return markSerenitySyncFailed(run, 'obsidian', error, failedAt);
}

function markSerenitySyncFailed(run, target, error, failedAt = new Date().toISOString()) {
  const message = truncate(cleanText(error || 'Unknown Serenity sync error'), 1000);
  const syncTarget = cleanText(target || 'unknown');
  const nextSync = {
    ...(run.sync || {}),
  };
  if (['dashboard', 'next_queue'].includes(syncTarget)) {
    nextSync[syncTarget] = {
      ...(run.sync?.[syncTarget] || {}),
      status: 'failed',
      last_synced_at: failedAt,
      error: message,
    };
  }
  if (syncTarget === 'obsidian') {
    nextSync.obsidian = {
      ...(run.sync?.obsidian || {}),
      status: 'failed',
      last_synced_at: failedAt,
      error: message,
      vault_path: OBSIDIAN_VAULT_PATH,
      directory: SERENITY_OBSIDIAN_DIR,
      conflict_policy: 'overwrite_same_run_id_only',
    };
  }
  return {
    ...run,
    syncFailures: [
      ...(run.syncFailures || []),
      {
        target: syncTarget,
        failedAt,
        error: message,
      },
    ].slice(-200),
    sync: nextSync,
  };
}

function getSerenityObsidianNotePath(run) {
  const researchDate = cleanText(run.run_config?.research_date || run.createdAt || '').slice(0, 10) || toDateSlug();
  const safeId = cleanText(run.id || 'unknown-run').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown-run';
  return path.join(SERENITY_OBSIDIAN_DIR, `${researchDate} - ${safeId}.md`);
}

function writeSerenityObsidianNote(run, validation, notePath) {
  const relativePath = cleanText(notePath || getSerenityObsidianNotePath(run));
  const absolutePath = path.resolve(OBSIDIAN_VAULT_PATH, relativePath);
  const allowedRoot = path.resolve(OBSIDIAN_VAULT_PATH, SERENITY_OBSIDIAN_DIR);
  if (!absolutePath.startsWith(`${allowedRoot}${path.sep}`)) throw new Error('Obsidian note path escaped the configured Serenity directory.');

  if (fs.existsSync(absolutePath)) {
    const existing = fs.readFileSync(absolutePath, 'utf8');
    const existingRunId = existing.match(/^run_id:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim() || '';
    if (existingRunId && existingRunId !== run.id) {
      throw new Error(`Obsidian conflict: ${relativePath} belongs to ${existingRunId}.`);
    }
  }

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  const content = buildSerenityObsidianNote(run, validation);
  const tmpPath = `${absolutePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${content.trimEnd()}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpPath, absolutePath);
  fs.chmodSync(absolutePath, 0o600);
}

function syncSerenityNextQueue(run) {
  const existing = getResearchQueue();
  const generated = (run.nextQueue || []).map((item) =>
    createResearchQueueItem({
      id: `rq:${crypto.createHash('sha1').update(`serenity-next:${run.id}:${item.task}`).digest('hex').slice(0, 16)}`,
      priority: item.priority,
      question: item.task,
      themes: ['Serenity next run', run.title],
      sourceEventId: run.id,
    })
  );
  const generatedIds = new Set(generated.map((item) => item.id));
  const nextItems = [...generated, ...existing.filter((item) => !generatedIds.has(item.id))].slice(0, 120);
  writeJsonFile(RESEARCH_QUEUE_FILE, nextItems);
  return {
    itemsWritten: generated.length,
    total: nextItems.length,
  };
}

function getAiRadarResearchRuns() {
  const storedRuns = readJsonFile(AI_RADAR_RESEARCH_RUNS_FILE, []);
  const runMap = new Map();
  [...(Array.isArray(storedRuns) ? storedRuns : []), ...getDefaultAiRadarResearchRuns()]
    .map(normalizeAiRadarResearchRun)
    .filter(Boolean)
    .forEach((run) => runMap.set(run.id, run));

  return Array.from(runMap.values()).sort((a, b) => cleanText(b.updatedAt || b.startedAt).localeCompare(cleanText(a.updatedAt || a.startedAt)));
}

function normalizeAiRadarResearchRun(input) {
  if (!input || typeof input !== 'object') return null;
  const title = truncate(cleanText(input.title || input.objective || ''), 180);
  const objective = truncate(cleanText(input.objective || title), 360);
  if (!title || !objective) throw new Error('title and objective are required');
  const now = new Date().toISOString();
  return {
    id: cleanText(input.id || `ai-radar-run:${crypto.createHash('sha1').update(`${title}:${objective}`).digest('hex').slice(0, 16)}`),
    title,
    objective,
    status: truncate(cleanText(input.status || 'active_research'), 40),
    startedAt: normalizeDate(input.startedAt) || now,
    updatedAt: normalizeDate(input.updatedAt) || now,
    currentConclusion: truncate(cleanText(input.currentConclusion || ''), 620),
    closeState: truncate(cleanText(input.closeState || 'active_research'), 60),
    confidence: truncate(cleanText(input.confidence || 'medium-low'), 40),
    steps: normalizeDiscoveryRows(input.steps, normalizeAiRadarStep).slice(0, 80),
    sourceLedger: normalizeDiscoveryRows(input.sourceLedger, normalizeAiRadarSourceRow).slice(0, 80),
    challengeLedger: normalizeDiscoveryRows(input.challengeLedger, normalizeAiRadarChallengeRow).slice(0, 40),
    processConclusions: normalizeStringArray(input.processConclusions).slice(0, 20),
    openQuestions: normalizeStringArray(input.openQuestions).slice(0, 20),
    minimumCloseCriteria: normalizeAiRadarCloseCriteria(input.minimumCloseCriteria),
  };
}

function normalizeAiRadarStep(item) {
  const title = truncate(cleanText(item.title || item.step || ''), 180);
  if (!title) return null;
  return {
    time: normalizeDate(item.time) || cleanText(item.time || ''),
    type: truncate(cleanText(item.type || 'process'), 60),
    title,
    detail: truncate(cleanText(item.detail || ''), 620),
    conclusion: truncate(cleanText(item.conclusion || ''), 420),
    status: truncate(cleanText(item.status || 'logged'), 40),
  };
}

function normalizeAiRadarSourceRow(item) {
  const source = truncate(cleanText(item.source || item.query || ''), 220);
  if (!source) return null;
  return {
    source,
    url: truncate(cleanText(item.url || ''), 420),
    sourceType: truncate(cleanText(item.sourceType || 'unknown'), 80),
    allowedUse: truncate(cleanText(item.allowedUse || 'discovery_trigger'), 80),
    convictionImpact: truncate(cleanText(item.convictionImpact || 'neutral'), 60),
    noiseRisk: truncate(cleanText(item.noiseRisk || 'unknown'), 60),
    finding: truncate(cleanText(item.finding || ''), 620),
    nextAction: truncate(cleanText(item.nextAction || ''), 420),
  };
}

function normalizeAiRadarChallengeRow(item) {
  const challenge = truncate(cleanText(item.challenge || item.query || ''), 220);
  if (!challenge) return null;
  return {
    challenge,
    result: truncate(cleanText(item.result || ''), 520),
    impact: truncate(cleanText(item.impact || 'neutral'), 80),
    nextAction: truncate(cleanText(item.nextAction || ''), 420),
  };
}

function normalizeAiRadarCloseCriteria(value = {}) {
  const criteria = value && typeof value === 'object' ? value : {};
  return {
    searchRows: clampNumber(criteria.searchRows, 0, 999, 0),
    coreEvidenceRows: clampNumber(criteria.coreEvidenceRows, 0, 999, 0),
    redTeamRows: clampNumber(criteria.redTeamRows, 0, 999, 0),
    hasSupplyChainMap: criteria.hasSupplyChainMap === true,
    hasFinancialPath: criteria.hasFinancialPath === true,
    hasSpecificFalsifier: criteria.hasSpecificFalsifier === true,
    hasNextQueue: criteria.hasNextQueue === true,
    canClose: criteria.canClose === true,
    reason: truncate(cleanText(criteria.reason || ''), 420),
  };
}

function getDefaultAiRadarResearchRuns() {
  return [
    {
      id: 'live-source-stack-2026-06-03',
      title: 'Live run：AI Stock Radar 信息源与维度接入审计',
      objective: '启动实时 research 过程：先验证数据源分层和噪声过滤，再决定哪些数据能进入 AI Stock Radar，避免把 vendor/news/community 噪声直接变成 thesis。',
      status: 'active_research',
      closeState: 'active_research',
      confidence: 'medium',
      startedAt: '2026-06-03T03:55:00.000Z',
      updatedAt: '2026-06-03T03:55:00.000Z',
      currentConclusion: '本轮没有升级任何投资 thesis。Finnhub 可以作为结构化行情/指标缓存，但 company-news 对 NVDA 返回大量 Yahoo 聚合且样本包含非 NVDA 标题，噪声较高，只能做 discovery trigger。核心事实层仍必须回到 SEC/IR/官方技术文档/标准组织/政府报告。',
      steps: [
        {
          time: '2026-06-03T03:55:00.000Z',
          type: 'rule',
          title: 'Obsidian sync rule accepted',
          detail: '用户要求系统进化过程中任何改动都必须更新 Obsidian；本轮会写入 Obsidian vault 的 Information Gain 变更日志。',
          conclusion: '把 Obsidian 更新加入项目操作规则。',
          status: 'done',
        },
        {
          time: '2026-06-03T03:57:00.000Z',
          type: 'source_handshake',
          title: 'Finnhub NVDA quote / metric / company-news handshake',
          detail: '用用户提供的 Finnhub key 检查 NVDA quote、metric、company-news 可用性。quote/metric 返回可用；company-news 返回 250 条新闻样本，但样本来源为 Yahoo 且出现与 NVDA 不直接相关的 headline。',
          conclusion: 'Finnhub 适合结构化缓存，不适合作为 thesis 核心证据；company-news 必须追原文且做 ticker relevance 过滤。',
          status: 'done',
        },
        {
          time: '2026-06-03T03:59:00.000Z',
          type: 'source_filter',
          title: 'Source stack re-ranked by allowed use',
          detail: '把源分成 core evidence、structured cache、consensus gap、discovery trigger、reject/downweight。',
          conclusion: 'vendor 数据不能证明产业 thesis；新闻聚合和社区源只能触发研究任务。',
          status: 'done',
        },
        {
          time: '2026-06-03T04:01:00.000Z',
          type: 'dimension_gap',
          title: 'AI Stock Radar dimensions mapped to missing data model',
          detail: '截图看板隐含的维度包括 price returns、RSI/MACD、volatility、relative volume、fundamentals、valuation、analyst expectations、AI exposure score、event/news feed。',
          conclusion: '当前系统缺的是数据源和分析维度管线，不是单纯缺行业列表。',
          status: 'done',
        },
        {
          time: '2026-06-03T04:03:00.000Z',
          type: 'challenge_gate',
          title: 'No thesis upgrade before red-team',
          detail: '本轮只启动 source/dimension research，不升级任何标的。下一步必须补 SEC/IR spot-check、ticker relevance filter、red-team rows。',
          conclusion: 'Close state 保持 active_research，不能关闭。',
          status: 'active',
        },
      ],
      sourceLedger: [
        {
          source: 'Finnhub API - quote / stock metric / company news',
          url: 'https://finnhub.io/docs/api',
          sourceType: 'market_data_vendor',
          allowedUse: 'structured_cache',
          convictionImpact: 'neutral',
          noiseRisk: 'medium-high',
          finding: 'NVDA quote and metrics are usable for dashboard fields. Company-news returns high-volume Yahoo aggregation and sample headlines can be irrelevant to NVDA.',
          nextAction: 'Use Finnhub for quote/metric cache only; add relevance filter and original-link tracing before news can enter evidence ledger.',
        },
        {
          source: 'SEC EDGAR APIs / companyfacts',
          url: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces',
          sourceType: 'sec_filing',
          allowedUse: 'core_evidence',
          convictionImpact: 'raise_or_reduce_after_check',
          noiseRisk: 'low',
          finding: 'Best source for financial statement truth layer and spot-checking vendor fundamentals.',
          nextAction: 'Map ticker to CIK and build companyfacts cache for Core 30.',
        },
        {
          source: 'Polygon / Massive Stocks API',
          url: 'https://polygon.io/docs/stocks',
          sourceType: 'market_data_vendor',
          allowedUse: 'structured_cache',
          convictionImpact: 'neutral',
          noiseRisk: 'low-medium',
          finding: 'Appropriate for aggregates, price/volume, volatility and technical screen fields.',
          nextAction: 'Choose Polygon or Finnhub as first market-data connector; do not use price action as thesis evidence.',
        },
        {
          source: 'Financial Modeling Prep API',
          url: 'https://site.financialmodelingprep.com/developer/docs',
          sourceType: 'market_data_vendor',
          allowedUse: 'structured_cache',
          convictionImpact: 'neutral',
          noiseRisk: 'medium',
          finding: 'Useful for normalized statements, ratios, analyst data and news indexing, but must be audited against SEC/IR.',
          nextAction: 'Treat as cache and screener only; require filing spot-check for financial path.',
        },
        {
          source: 'NVIDIA GB200 / rack-scale official docs',
          url: 'https://www.nvidia.com/en-us/data-center/gb200-nvl72/',
          sourceType: 'official_company',
          allowedUse: 'core_evidence',
          convictionImpact: 'raise',
          noiseRisk: 'low',
          finding: 'Official demand anchor for rack-scale AI, liquid cooling and NVLink physical infrastructure.',
          nextAction: 'Use as demand anchor only; still need downstream suppliers and financial translation.',
        },
        {
          source: 'NVIDIA GB200 designs contributed to OCP',
          url: 'https://developer.nvidia.com/blog/?p=90182',
          sourceType: 'official_technical',
          allowedUse: 'core_evidence',
          convictionImpact: 'raise',
          noiseRisk: 'low',
          finding: 'Supports the ecosystem angle for liquid-cooled rack, compute tray, switch tray and reference architecture.',
          nextAction: 'Search OCP specs and partner BOM, then red-team whether public carriers are clean enough.',
        },
      ],
      challengeLedger: [
        {
          challenge: 'Why now?',
          result: 'The system is moving from static coverage board to live data/research run. The immediate change is source stack validation and Finnhub availability.',
          impact: 'kept_active',
          nextAction: 'Move to connector implementation only after source filter policy is visible in UI and Obsidian.',
        },
        {
          challenge: 'Strongest bear case',
          result: 'Vendor/news feeds create false confidence: metrics are normalized, news can be off-topic, and source aggregation can hide original evidence quality.',
          impact: 'reduce_confidence',
          nextAction: 'Require sourceType/allowedUse/convictionImpact labels on every source row.',
        },
        {
          challenge: 'Minimum close criteria',
          result: 'Search rows are present; core evidence exists for source policy and demand anchors. Red-team rows are not enough for any market thesis.',
          impact: 'cannot_close',
          nextAction: 'Close state remains active_research. No thesis candidate upgrade.',
        },
      ],
      processConclusions: [
        'Finnhub key works for quote/metric/news endpoint handshake, but news is noisy and must be filtered.',
        'AI Stock Radar needs source governance before it needs more sectors.',
        'The dashboard should show research steps, source rows, challenge rows and current close state in near real time.',
        'No candidate should be upgraded from this run; this run is infrastructure/source validation.',
      ],
      openQuestions: [
        'Should first live connector be Finnhub-only, or Polygon for market data plus SEC for financials?',
        'What ticker relevance threshold should news pass before it enters event stream?',
        'Should Obsidian update be manual markdown append or a backend API action?',
      ],
      minimumCloseCriteria: {
        searchRows: 6,
        coreEvidenceRows: 3,
        redTeamRows: 3,
        hasSupplyChainMap: false,
        hasFinancialPath: false,
        hasSpecificFalsifier: true,
        hasNextQueue: true,
        canClose: false,
        reason: 'This is a source/dimension research run, not a market thesis run. It cannot close until connector design and Obsidian sync requirements are implemented.',
      },
    },
  ];
}

function normalizeSerenityDiscoveryRun(input) {
  if (!input || typeof input !== 'object') return null;
  const title = truncate(cleanText(input.title || input.objective || ''), 180);
  const objective = truncate(cleanText(input.objective || title), 320);
  if (!title || !objective) throw new Error('title and objective are required');
  const now = new Date().toISOString();
  const configuredRunId = cleanText(input.run_config?.run_id || input.runConfig?.run_id || '');
  const id = cleanText(input.id || configuredRunId || `serenity-discovery:${crypto.createHash('sha1').update(`${title}:${objective}`).digest('hex').slice(0, 16)}`);
  if (configuredRunId && configuredRunId !== id) {
    throw new Error(`Research Run id mismatch: ${id} !== ${configuredRunId}`);
  }
  const requestedStatus = cleanText(input.status || 'market_discovery');
  const status = requestedStatus === 'seed' ? 'market_discovery' : requestedStatus;
  if (!SERENITY_RUN_STATUSES.includes(status)) throw new Error(`Invalid Research Run status: ${requestedStatus}`);
  return {
    id,
    title,
    objective,
    run_config: normalizeSerenityRunConfig(input.run_config || input.runConfig, id),
    status,
    cadence: truncate(cleanText(input.cadence || '24-72h review loop'), 80),
    createdAt: normalizeDate(input.createdAt) || now,
    updatedAt: normalizeDate(input.updatedAt) || now,
    topLevelDemand: truncate(cleanText(input.topLevelDemand || input.top_level_demand || ''), 620),
    currentAnswer: truncate(cleanText(input.currentAnswer || input.current_answer || ''), 1200),
    confidence: truncate(cleanText(input.confidence || 'medium-low'), 40),
    searchLedger: normalizeDiscoveryRows(input.searchLedger || input.search_ledger, normalizeDiscoverySearchRow).slice(0, 120),
    evidenceLedger: normalizeDiscoveryRows(input.evidenceLedger || input.evidence_ledger, normalizeDiscoveryEvidenceRow).slice(0, 160),
    reasoningLedger: normalizeDiscoveryRows(input.reasoningLedger || input.reasoning_ledger, normalizeDiscoveryReasoningRow).slice(0, 80),
    challengeLedger: normalizeDiscoveryRows(input.challengeLedger || input.challenge_ledger, normalizeDiscoveryChallengeRow).slice(0, 80),
    keyConclusions: normalizeDiscoveryRows(input.keyConclusions || input.key_conclusions, normalizeDiscoveryKeyConclusion).slice(0, 60),
    markets: normalizeDiscoveryRows(input.markets, normalizeDiscoveryMarket).slice(0, 40),
    candidates: normalizeDiscoveryRows(input.candidates, normalizeDiscoveryCandidate).slice(0, 80),
    rejected: normalizeDiscoveryRows(input.rejected, normalizeDiscoveryRejected).slice(0, 20),
    pricingAnalyses: normalizeDiscoveryRows(input.pricingAnalyses || input.pricing_analyses, normalizeDiscoveryPricingAnalysis).slice(0, 80),
    unknowns: normalizeStringArray(input.unknowns).slice(0, 80),
    falsifiers: normalizeStringArray(input.falsifiers).slice(0, 80),
    closureReport: truncate(cleanText(input.closureReport || input.closure_report || ''), 6000),
    noCandidateExplanation: truncate(cleanText(input.noCandidateExplanation || input.no_candidate_explanation || ''), 1600),
    skillCandidates: normalizeDiscoveryRows(input.skillCandidates || input.skill_candidates, normalizeSerenitySkillCandidate).slice(0, 40),
    stateTransitions: normalizeDiscoveryRows(input.stateTransitions || input.state_transitions, normalizeSerenityStateTransition).slice(0, 200),
    candidateStateLedger: normalizeDiscoveryRows(input.candidateStateLedger || input.candidate_state_ledger, normalizeSerenityCandidateStateRow).slice(0, 300),
    thesisVersionLedger: normalizeDiscoveryRows(input.thesisVersionLedger || input.thesis_version_ledger, normalizeSerenityThesisVersionRow).slice(0, 200),
    syncFailures: normalizeDiscoveryRows(input.syncFailures || input.sync_failures, normalizeSerenitySyncFailure).slice(0, 200),
    sync: normalizeSerenitySync(input.sync),
    nextQueue: normalizeDiscoveryRows(input.nextQueue || input.next_queue, normalizeDiscoveryQueueItem).slice(0, 80),
  };
}

function normalizeDiscoveryRows(value, normalizeItem) {
  return (Array.isArray(value) ? value : [])
    .map((item) => normalizeItem(item || {}))
    .filter(Boolean);
}

function normalizeDiscoverySearchRow(item) {
  const source = truncate(cleanText(item.source || item.query || ''), 220);
  if (!source) return null;
  return {
    id: cleanText(item.id || `search:${crypto.createHash('sha1').update(`${source}:${item.url || ''}:${item.checkedAt || item.accessedAt || ''}`).digest('hex').slice(0, 16)}`),
    query: truncate(cleanText(item.query || ''), 420),
    source,
    originalSource: truncate(cleanText(item.originalSource || item.original_source || source), 220),
    url: truncate(cleanText(item.url || ''), 420),
    filePath: truncate(cleanText(item.filePath || item.file_path || ''), 420),
    sourceType: truncate(cleanText(item.sourceType || item.source_type || 'unknown'), 80),
    publishedAt: normalizeDate(item.publishedAt || item.published_at) || cleanText(item.publishedAt || item.published_at || ''),
    checkedAt: normalizeDate(item.checkedAt || item.accessedAt || item.accessed_at) || cleanText(item.checkedAt || item.accessedAt || item.accessed_at || ''),
    authorOrInstitution: truncate(cleanText(item.authorOrInstitution || item.author_or_institution || ''), 220),
    isOriginalSource: item.isOriginalSource === true || item.is_original_source === true,
    isIndependentSource: item.isIndependentSource === true || item.is_independent_source === true,
    sourceFamily: truncate(cleanText(item.sourceFamily || item.source_family || ''), 160),
    allowedUse: normalizeAllowedUse(item.allowedUse || item.allowed_use),
    applicableClaims: normalizeStringArray(item.applicableClaims || item.applicable_claims).slice(0, 20),
    limitations: truncate(cleanText(item.limitations || ''), 620),
    convictionImpact: truncate(cleanText(item.convictionImpact || item.conviction_impact || 'neutral'), 80),
    why: truncate(cleanText(item.why || ''), 260),
    finding: truncate(cleanText(item.finding || ''), 520),
    impact: truncate(cleanText(item.impact || 'needs follow-up'), 220),
  };
}

function normalizeDiscoveryEvidenceRow(item) {
  const source = truncate(cleanText(item.source || item.originalSource || item.original_source || ''), 220);
  const url = truncate(cleanText(item.url || ''), 420);
  const filePath = truncate(cleanText(item.filePath || item.file_path || ''), 420);
  if (!source || (!url && !filePath)) return null;
  const originalSource = truncate(cleanText(item.originalSource || item.original_source || source), 220);
  const sourceType = truncate(cleanText(item.sourceType || item.source_type || 'unknown'), 80);
  const authorOrInstitution = truncate(cleanText(item.authorOrInstitution || item.author_or_institution || ''), 220);
  const isCandidateCompanySource =
    item.isCandidateCompanySource === true || item.is_candidate_company_source === true
      ? true
      : item.isCandidateCompanySource === false || item.is_candidate_company_source === false
        ? false
        : null;
  const providedSourceFamily = truncate(cleanText(item.sourceFamily || item.source_family || ''), 160);
  const companyIdentifier = authorOrInstitution || originalSource;
  const companySourceSlug = companyIdentifier.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const sourceFamily =
    SERENITY_COMPANY_SOURCE_TYPE_SET.has(sourceType) || isCandidateCompanySource === true
      ? `company:${companySourceSlug || crypto.createHash('sha1').update(companyIdentifier).digest('hex').slice(0, 12)}`
      : providedSourceFamily;
  return {
    id: cleanText(item.id || `evidence:${crypto.createHash('sha1').update(`${source}:${url}:${filePath}`).digest('hex').slice(0, 16)}`),
    source,
    originalSource,
    sourceType,
    publishedAt: normalizeDate(item.publishedAt || item.published_at) || cleanText(item.publishedAt || item.published_at || ''),
    accessedAt: normalizeDate(item.accessedAt || item.accessed_at || item.checkedAt) || cleanText(item.accessedAt || item.accessed_at || item.checkedAt || ''),
    authorOrInstitution,
    url,
    filePath,
    isOriginalSource: item.isOriginalSource === true || item.is_original_source === true,
    isIndependentSource: item.isIndependentSource === true || item.is_independent_source === true,
    isCandidateCompanySource,
    sourceFamily,
    allowedUse: normalizeAllowedUse(item.allowedUse || item.allowed_use),
    applicableClaims: normalizeStringArray(item.applicableClaims || item.applicable_claims).slice(0, 30),
    claimStatus: normalizeClaimStatus(item.claimStatus || item.claim_status || item.status),
    finding: truncate(cleanText(item.finding || item.evidence || ''), 1200),
    limitations: truncate(cleanText(item.limitations || ''), 800),
    confidenceImpact: truncate(cleanText(item.confidenceImpact || item.confidence_impact || 'neutral'), 80),
  };
}

function normalizeDiscoveryReasoningRow(item) {
  const hypothesis = truncate(cleanText(item.hypothesis || ''), 320);
  if (!hypothesis) return null;
  return {
    step: truncate(cleanText(item.step || ''), 80),
    hypothesis,
    evidence: truncate(cleanText(item.evidence || ''), 420),
    inference: truncate(cleanText(item.inference || ''), 520),
    assumptions: normalizeStringArray(item.assumptions).slice(0, 12),
    counterEvidence: normalizeStringArray(item.counterEvidence || item.counter_evidence).slice(0, 12),
    claimStatus: normalizeClaimStatus(item.claimStatus || item.claim_status || item.status),
    confidence: truncate(cleanText(item.confidence || 'medium-low'), 40),
    nextUncertainty: truncate(cleanText(item.nextUncertainty || ''), 320),
  };
}

function normalizeDiscoveryChallengeRow(item) {
  const challenge = truncate(cleanText(item.challenge || item.query || ''), 320);
  if (!challenge) return null;
  return {
    challenge,
    query: truncate(cleanText(item.query || ''), 420),
    sourceType: truncate(cleanText(item.sourceType || item.source_type || 'unknown'), 80),
    result: truncate(cleanText(item.result || item.finding || ''), 1000),
    impact: truncate(cleanText(item.impact || 'neutral'), 80),
    nextAction: truncate(cleanText(item.nextAction || item.next_action || ''), 620),
    relatedEvidence: normalizeStringArray(item.relatedEvidence || item.related_evidence).slice(0, 20),
  };
}

function normalizeDiscoveryKeyConclusion(item) {
  const conclusion = truncate(cleanText(item.conclusion || item.claim || ''), 1000);
  if (!conclusion) return null;
  return {
    conclusion,
    status: normalizeClaimStatus(item.status || item.claimStatus || item.claim_status),
    evidenceIds: normalizeStringArray(item.evidenceIds || item.evidence_ids).slice(0, 30),
    changedAt: normalizeDate(item.changedAt || item.changed_at) || cleanText(item.changedAt || item.changed_at || ''),
    changeReason: truncate(cleanText(item.changeReason || item.change_reason || ''), 620),
  };
}

function normalizeDiscoveryMarket(item) {
  const market = truncate(cleanText(item.market || item.title || ''), 120);
  if (!market) return null;
  return {
    market,
    demandChain: normalizeStringArray(item.demandChain).slice(0, 8),
    technologyRoutes: normalizeStringArray(item.technologyRoutes || item.technology_routes).slice(0, 20),
    alternativeRoutes: normalizeStringArray(item.alternativeRoutes || item.alternative_routes).slice(0, 20),
    dependencies: normalizeDiscoveryRows(item.dependencies || item.dependency_levels, normalizeDiscoveryDependency).slice(0, 40),
    chokepoint: truncate(cleanText(item.chokepoint || ''), 420),
    bottleneckStatus: truncate(cleanText(item.bottleneckStatus || item.bottleneck_status || 'unknown'), 60),
    supplierCount: truncate(cleanText(item.supplierCount || ''), 120),
    supplierCountBasis: truncate(cleanText(item.supplierCountBasis || item.supplier_count_basis || ''), 1000),
    capacityExpansionLeadTime: truncate(cleanText(item.capacityExpansionLeadTime || item.capacity_expansion_lead_time || ''), 320),
    barriers: normalizeStringArray(item.barriers).slice(0, 20),
    publicCarriers: normalizeStringArray(item.publicCarriers).slice(0, 12),
    listedCarriers: normalizeStringArray(item.listedCarriers || item.listed_carriers || item.publicCarriers).slice(0, 30),
    listedCarrierScreening: truncate(cleanText(item.listedCarrierScreening || item.listed_carrier_screening || ''), 1000),
    investigationDirections: normalizeStringArray(item.investigationDirections || item.investigation_directions).slice(0, 12),
    unknowns: normalizeStringArray(item.unknowns).slice(0, 30),
    firstOrderDependencySearchSaturated: item.firstOrderDependencySearchSaturated === true || item.first_order_dependency_search_saturated === true,
    independentChallengeReviewCompleted: item.independentChallengeReviewCompleted === true || item.independent_challenge_review_completed === true,
    coverageStatus: truncate(cleanText(item.coverageStatus || item.coverage_status || 'coverage_insufficient'), 80),
    financialPath: truncate(cleanText(item.financialPath || item.financial_path || ''), 1200),
    pricingGap: truncate(cleanText(item.pricingGap || item.pricing_gap || ''), 1200),
    status: truncate(cleanText(item.status || 'watch'), 60),
    nextEvidence: normalizeStringArray(item.nextEvidence).slice(0, 8),
  };
}

function normalizeDiscoveryDependency(item) {
  const name = truncate(cleanText(item.name || item.dependency || item.component || ''), 220);
  if (!name) return null;
  return {
    level: clampNumber(item.level, 1, 20, 1),
    name,
    type: truncate(cleanText(item.type || 'unknown'), 80),
    whyNecessary: truncate(cleanText(item.whyNecessary || item.why_necessary || ''), 620),
    substitutionCost: truncate(cleanText(item.substitutionCost || item.substitution_cost || ''), 420),
  };
}

function normalizeDiscoveryCandidate(item) {
  const ticker = normalizeTickerSymbol(item.ticker || '');
  const name = truncate(cleanText(item.name || ticker || ''), 120);
  if (!name) return null;
  const requestedStatus = cleanText(item.status || 'screening');
  if (!SERENITY_CANDIDATE_STATUSES.includes(requestedStatus)) {
    throw new Error(`Invalid Serenity candidate status: ${requestedStatus}`);
  }
  const status = requestedStatus;
  const score = scoreSerenityCandidate({ scores: item.scores });
  return {
    ticker,
    name,
    market: truncate(cleanText(item.market || ''), 120),
    status,
    confidence: truncate(cleanText(item.confidence || 'low'), 60),
    score: Object.keys(item.scores || {}).length ? score.total_score : clampNumber(item.score, 0, 100, 0),
    scores: score.scores,
    scoreFieldsRecorded: normalizeStringArray(
      item.scoreFieldsRecorded || item.score_fields_recorded || Object.keys(item.scores || {})
    ).slice(0, 20),
    fatal_gates: normalizeSerenityFatalGates(item.fatal_gates || item.fatalGates),
    challenge_gate: normalizeSerenityChallengeGate(item.challenge_gate || item.challengeGate),
    publicExposure: truncate(cleanText(item.publicExposure || ''), 280),
    whySurvives: truncate(cleanText(item.whySurvives || ''), 420),
    keyFalsifier: truncate(cleanText(item.keyFalsifier || item.key_falsifier || ''), 320),
    nextEvidence: truncate(cleanText(item.nextEvidence || ''), 320),
    financialPath: truncate(cleanText(item.financialPath || item.financial_path || ''), 1200),
    businessPurity: truncate(cleanText(item.businessPurity || item.business_purity || ''), 620),
    stateReason: truncate(cleanText(item.stateReason || item.state_reason || ''), 620),
  };
}

function normalizeDiscoveryRejected(item) {
  const target = truncate(cleanText(item.target || item.market || item.ticker || ''), 120);
  if (!target) return null;
  return {
    target,
    reason: truncate(cleanText(item.reason || ''), 420),
    evidence: truncate(cleanText(item.evidence || ''), 420),
    recheckTrigger: truncate(cleanText(item.recheckTrigger || ''), 260),
  };
}

function normalizeDiscoveryQueueItem(item) {
  const task = truncate(cleanText(item.task || ''), 260);
  if (!task) return null;
  return {
    priority: clampNumber(item.priority, 1, 5, 3),
    task,
    sourceToInspect: truncate(cleanText(item.sourceToInspect || item.source_to_inspect || ''), 260),
    expectedEvidence: truncate(cleanText(item.expectedEvidence || item.expected_evidence || ''), 320),
    falsifier: truncate(cleanText(item.falsifier || ''), 320),
  };
}

function normalizeDiscoveryPricingAnalysis(item) {
  const ticker = normalizeTickerSymbol(item.ticker || '');
  const market = truncate(cleanText(item.market || ''), 160);
  if (!ticker && !market) return null;
  return {
    ticker,
    market,
    price_performance_3m: truncate(cleanText(item.price_performance_3m || item.pricePerformance3m || ''), 320),
    price_performance_6m: truncate(cleanText(item.price_performance_6m || item.pricePerformance6m || ''), 320),
    price_performance_12m: truncate(cleanText(item.price_performance_12m || item.pricePerformance12m || ''), 320),
    market_cap: truncate(cleanText(item.market_cap || item.marketCap || ''), 220),
    enterprise_value: truncate(cleanText(item.enterprise_value || item.enterpriseValue || ''), 220),
    valuation_vs_history: truncate(cleanText(item.valuation_vs_history || item.valuationVsHistory || ''), 620),
    consensus_changes: truncate(cleanText(item.consensus_changes || item.consensusChanges || ''), 620),
    guidance_changes: truncate(cleanText(item.guidance_changes || item.guidanceChanges || ''), 620),
    capex_and_capacity: truncate(cleanText(item.capex_and_capacity || item.capexAndCapacity || ''), 620),
    orders_backlog_or_utilization: truncate(cleanText(item.orders_backlog_or_utilization || item.ordersBacklogOrUtilization || ''), 620),
    gross_margin_change: truncate(cleanText(item.gross_margin_change || item.grossMarginChange || ''), 620),
    ir_theme_emphasis: truncate(cleanText(item.ir_theme_emphasis || item.irThemeEmphasis || ''), 620),
    analyst_coverage: truncate(cleanText(item.analyst_coverage || item.analystCoverage || ''), 320),
    what_is_priced: truncate(cleanText(item.what_is_priced || item.whatIsPriced || ''), 1000),
    what_may_not_be_priced: truncate(cleanText(item.what_may_not_be_priced || item.whatMayNotBePriced || ''), 1000),
    good_industry: truncate(cleanText(item.good_industry || item.goodIndustry || ''), 620),
    good_company: truncate(cleanText(item.good_company || item.goodCompany || ''), 620),
    good_stock: truncate(cleanText(item.good_stock || item.goodStock || ''), 620),
    unpriced_opportunity: truncate(cleanText(item.unpriced_opportunity || item.unpricedOpportunity || ''), 1000),
  };
}

function normalizeSerenityRunConfig(value = {}, runId) {
  const config = value && typeof value === 'object' ? value : {};
  return {
    run_id: cleanText(config.run_id || runId),
    run_mode: cleanText(config.run_mode || ''),
    research_date: normalizeDate(config.research_date) || cleanText(config.research_date || ''),
    market_data_as_of: normalizeDate(config.market_data_as_of) || cleanText(config.market_data_as_of || ''),
    investment_universe: truncate(cleanText(config.investment_universe || ''), 620),
    included_exchanges: normalizeStringArray(config.included_exchanges).slice(0, 40),
    included_regions: normalizeStringArray(config.included_regions).slice(0, 40),
    excluded_security_types: normalizeStringArray(config.excluded_security_types).slice(0, 40),
    market_cap_min: normalizeConfigThreshold(config.market_cap_min),
    market_cap_max: normalizeConfigThreshold(config.market_cap_max),
    minimum_average_daily_traded_value: normalizeConfigThreshold(config.minimum_average_daily_traded_value),
    maximum_analyst_coverage: normalizeConfigThreshold(config.maximum_analyst_coverage),
    minimum_revenue_exposure: normalizeConfigThreshold(config.minimum_revenue_exposure),
    maximum_supplier_count_for_bottleneck: normalizeConfigThreshold(config.maximum_supplier_count_for_bottleneck),
    minimum_capacity_expansion_lead_time: normalizeConfigThreshold(config.minimum_capacity_expansion_lead_time),
    source_budget: clampNumber(config.source_budget, 0, 100000, 0),
    search_budget: clampNumber(config.search_budget, 0, 100000, 0),
    research_owner: truncate(cleanText(config.research_owner || ''), 160),
    system_version: truncate(cleanText(config.system_version || ''), 80),
    skill_version: truncate(cleanText(config.skill_version || ''), 80),
    threshold_exceptions: normalizeThresholdExceptions(config.threshold_exceptions),
  };
}

function normalizeConfigThreshold(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return truncate(cleanText(value || ''), 160);
}

function normalizeThresholdExceptions(value = {}) {
  const exceptions = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    Object.entries(exceptions)
      .slice(0, 30)
      .map(([key, item]) => [
        cleanText(key),
        {
          reason: truncate(cleanText(item?.reason || ''), 620),
          alternative_criteria: truncate(cleanText(item?.alternative_criteria || item?.alternativeCriteria || ''), 620),
        },
      ])
      .filter(([key, item]) => key && item.reason && item.alternative_criteria)
  );
}

function normalizeAllowedUse(value) {
  const allowedUse = cleanText(value || 'discovery_trigger');
  return SERENITY_ALLOWED_USES.includes(allowedUse) ? allowedUse : 'discovery_trigger';
}

function normalizeClaimStatus(value) {
  const status = cleanText(value || 'unknown');
  return SERENITY_CLAIM_STATUSES.includes(status) ? status : 'unknown';
}

function normalizeSerenityFatalGates(value = {}) {
  const gates = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    SERENITY_FATAL_GATES.map((gate) => {
      const item = gates[gate];
      return [
        gate,
        {
          passed: item === true || item?.passed === true,
          evidence: truncate(cleanText(item?.evidence || item?.basis || ''), 1000),
          notes: truncate(cleanText(item?.notes || ''), 620),
        },
      ];
    })
  );
}

function normalizeSerenityChallengeGate(value = {}) {
  const gate = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    Object.entries(gate)
      .slice(0, 40)
      .map(([key, answer]) => [cleanText(key), truncate(cleanText(answer || ''), 1200)])
      .filter(([key, answer]) => key && answer)
  );
}

function normalizeSerenitySkillCandidate(item) {
  const name = truncate(cleanText(item.name || item.title || ''), 220);
  if (!name) return null;
  const requestedStatus = cleanText(item.status || 'skill_candidate');
  const status = ['skill_candidate', 'validated_skill_candidate', 'published_skill'].includes(requestedStatus)
    ? requestedStatus
    : 'skill_candidate';
  return {
    name,
    status,
    method: truncate(cleanText(item.method || item.description || ''), 1600),
    independentRunIds: normalizeStringArray(item.independentRunIds || item.independent_run_ids).slice(0, 30),
    reviewNotes: truncate(cleanText(item.reviewNotes || item.review_notes || ''), 1000),
  };
}

function normalizeSerenityStateTransition(item) {
  const toStatus = cleanText(item.toStatus || item.to_status || '');
  if (!toStatus) return null;
  return {
    changedAt: normalizeDate(item.changedAt || item.changed_at) || cleanText(item.changedAt || item.changed_at || ''),
    fromStatus: cleanText(item.fromStatus || item.from_status || ''),
    toStatus,
    reason: truncate(cleanText(item.reason || ''), 1000),
    relatedEvidence: normalizeStringArray(item.relatedEvidence || item.related_evidence).slice(0, 30),
    actor: truncate(cleanText(item.actor || item.responsible || ''), 160),
  };
}

function normalizeSerenityCandidateStateRow(item) {
  const target = truncate(cleanText(item.ticker || item.name || item.target || ''), 160);
  const toStatus = cleanText(item.toStatus || item.to_status || '');
  if (!target || !toStatus) return null;
  return {
    target,
    changedAt: normalizeDate(item.changedAt || item.changed_at) || cleanText(item.changedAt || item.changed_at || ''),
    fromStatus: cleanText(item.fromStatus || item.from_status || ''),
    toStatus,
    reason: truncate(cleanText(item.reason || ''), 1000),
    relatedEvidence: normalizeStringArray(item.relatedEvidence || item.related_evidence).slice(0, 30),
    actor: truncate(cleanText(item.actor || item.responsible || ''), 160),
  };
}

function normalizeSerenityThesisVersionRow(item) {
  const version = truncate(cleanText(item.version || item.id || ''), 80);
  const conclusion = truncate(cleanText(item.conclusion || item.currentAnswer || item.current_answer || ''), 1600);
  if (!version || !conclusion) return null;
  return {
    version,
    changedAt: normalizeDate(item.changedAt || item.changed_at) || cleanText(item.changedAt || item.changed_at || ''),
    changeType: truncate(cleanText(item.changeType || item.change_type || 'updated'), 80),
    conclusion,
    reason: truncate(cleanText(item.reason || ''), 1000),
    evidenceIds: normalizeStringArray(item.evidenceIds || item.evidence_ids).slice(0, 40),
    actor: truncate(cleanText(item.actor || item.responsible || ''), 160),
  };
}

function normalizeSerenitySyncFailure(item) {
  const error = truncate(cleanText(item.error || item.message || ''), 1000);
  if (!error) return null;
  return {
    target: truncate(cleanText(item.target || 'unknown'), 80),
    failedAt: normalizeDate(item.failedAt || item.failed_at) || cleanText(item.failedAt || item.failed_at || ''),
    error,
  };
}

function normalizeSerenitySync(value = {}) {
  const sync = value && typeof value === 'object' ? value : {};
  return {
    dashboard: normalizeSerenitySyncTarget(sync.dashboard),
    obsidian: {
      ...normalizeSerenitySyncTarget(sync.obsidian),
      vault_path: truncate(cleanText(sync.obsidian?.vault_path || sync.obsidian?.vaultPath || OBSIDIAN_VAULT_PATH), 420),
      directory: truncate(cleanText(sync.obsidian?.directory || SERENITY_OBSIDIAN_DIR), 420),
      note_path: truncate(cleanText(sync.obsidian?.note_path || sync.obsidian?.notePath || ''), 620),
      conflict_policy: truncate(cleanText(sync.obsidian?.conflict_policy || sync.obsidian?.conflictPolicy || 'overwrite_same_run_id_only'), 120),
    },
    next_queue: normalizeSerenitySyncTarget(sync.next_queue || sync.nextQueue),
  };
}

function normalizeSerenitySyncTarget(value = {}) {
  const target = value && typeof value === 'object' ? value : {};
  return {
    status: truncate(cleanText(target.status || 'pending'), 60),
    last_synced_at: normalizeDate(target.last_synced_at || target.lastSyncedAt) || cleanText(target.last_synced_at || target.lastSyncedAt || ''),
    error: truncate(cleanText(target.error || ''), 1000),
  };
}

function getDefaultSerenityDiscoveryRuns() {
  return [
    {
      id: 'seed-ai-rack-density-2026-06-03',
      title: 'Seed run：AI rack density 之后的新瓶颈市场',
      objective: '不是继续追 NVDA/光模块，而是从 Blackwell/GB200 级别的机架密度出发，寻找下一层更冷门、更物理、更可能被市场误分类的瓶颈市场。',
      run_config: {
        run_id: 'seed-ai-rack-density-2026-06-03',
        run_mode: 'RESEARCH',
        research_date: '2026-06-03',
        market_data_as_of: '2026-06-03',
        investment_universe: 'Global listed equities with direct exposure to AI rack-density bottlenecks.',
        included_exchanges: ['NYSE', 'Nasdaq', 'Korea Exchange', 'Borsa Italiana'],
        included_regions: ['United States', 'Europe', 'Asia'],
        excluded_security_types: ['Private companies', 'OTC securities', 'Funds', 'Derivatives'],
        market_cap_min: 100000000,
        market_cap_max: 50000000000,
        minimum_average_daily_traded_value: 1000000,
        maximum_analyst_coverage: 20,
        minimum_revenue_exposure: 0.1,
        maximum_supplier_count_for_bottleneck: 5,
        minimum_capacity_expansion_lead_time: 'At least multiple quarters unless qualification creates equivalent friction.',
        source_budget: 30,
        search_budget: 50,
        research_owner: 'chengpeng',
        system_version: '0.2.0',
        skill_version: 'serenity-market-discovery@2',
      },
      status: 'active_research',
      cadence: '7x24 discovery loop；每轮必须更新搜索账本和反证队列',
      createdAt: '2026-06-03T03:10:00.000Z',
      updatedAt: '2026-06-03T03:10:00.000Z',
      topLevelDemand: 'AI rack-scale systems are increasing rack density, power delivery, cooling and physical interconnect requirements.',
      currentAnswer: '第一轮保留五个市场进入 active research：液冷/机架电力架构、in-package 硅电容、玻璃核心封装基板、AI 数据中心光纤/空芯光纤、电网变压器/互联队列。它们都还不是结论，下一步要找小市值且业务纯度更高的 public carriers。',
      confidence: 'medium-low',
      stateTransitions: [
        {
          changedAt: '2026-06-03T03:10:00.000Z',
          fromStatus: 'queued',
          toStatus: 'market_discovery',
          reason: 'Legacy seed run entered the V2 market-discovery stage.',
          relatedEvidence: ['NVIDIA GB200 NVL72 official product page'],
          actor: 'system_migration',
        },
        {
          changedAt: '2026-06-03T03:10:01.000Z',
          fromStatus: 'market_discovery',
          toStatus: 'supply_chain_mapping',
          reason: 'Initial demand anchors were decomposed into physical dependency markets.',
          relatedEvidence: ['NVIDIA GB200 NVL72 official product page'],
          actor: 'system_migration',
        },
        {
          changedAt: '2026-06-03T03:10:02.000Z',
          fromStatus: 'supply_chain_mapping',
          toStatus: 'candidate_screening',
          reason: 'Initial listed carriers were identified for further verification.',
          relatedEvidence: ['Samsung Electro-Mechanics: silicon capacitor supply contract'],
          actor: 'system_migration',
        },
        {
          changedAt: '2026-06-03T03:10:03.000Z',
          fromStatus: 'candidate_screening',
          toStatus: 'active_research',
          reason: 'Supplier, purity, pricing and financial-transmission evidence remain incomplete.',
          relatedEvidence: ['Prysmian / Relativity hollow-core fiber partnership'],
          actor: 'system_migration',
        },
      ],
      candidateStateLedger: [
        {
          target: '009150.KS',
          changedAt: '2026-06-03T03:10:00.000Z',
          fromStatus: 'discovered',
          toStatus: 'screening',
          reason: 'Official company evidence created a candidate, but purity and pricing remain unverified.',
          relatedEvidence: ['Samsung Electro-Mechanics: silicon capacitor supply contract'],
          actor: 'system_migration',
        },
        {
          target: 'MOD',
          changedAt: '2026-06-03T03:10:00.000Z',
          fromStatus: 'discovered',
          toStatus: 'screening',
          reason: 'Potential liquid-cooling exposure requires direct business verification.',
          relatedEvidence: ['NVIDIA GB200 NVL72 official product page'],
          actor: 'system_migration',
        },
        {
          target: 'PRY.MI',
          changedAt: '2026-06-03T03:10:00.000Z',
          fromStatus: 'discovered',
          toStatus: 'screening',
          reason: 'Hollow-core fiber partnership is relevant, but business purity is uncertain.',
          relatedEvidence: ['Prysmian / Relativity hollow-core fiber partnership'],
          actor: 'system_migration',
        },
      ],
      thesisVersionLedger: [
        {
          version: 'v1',
          changedAt: '2026-06-03T03:10:00.000Z',
          changeType: 'created',
          conclusion: 'Five markets remain in active research; no listed carrier is upgraded.',
          reason: 'Initial demand-chain decomposition found physical dependencies but incomplete supplier and pricing evidence.',
          evidenceIds: ['nvidia_official', 'us_government_lbnl', 'us_government_doe'],
          actor: 'system_migration',
        },
      ],
      sync: {
        dashboard: {
          status: 'success',
          last_synced_at: '2026-06-04T00:00:00.000Z',
        },
        obsidian: {
          status: 'pending',
          vault_path: OBSIDIAN_VAULT_PATH,
          directory: SERENITY_OBSIDIAN_DIR,
          conflict_policy: 'overwrite_same_run_id_only',
        },
      },
      searchLedger: [
        {
          source: 'NVIDIA GB200 NVL72 official product page',
          url: 'https://www.nvidia.com/en-us/data-center/gb200-nvl72/',
          sourceType: 'official_company',
          checkedAt: '2026-06-03',
          why: '确认 AI rack density 是否真的带来液冷和互联瓶颈，而不是媒体叙事。',
          finding: 'GB200 NVL72 是 36 Grace CPU + 72 Blackwell GPU 的 rack-scale liquid-cooled design，用 NVLink 和液冷缓解通信瓶颈。',
          impact: '保留液冷、机架电力、NVLink cable/cooling 作为二层市场。',
        },
        {
          source: 'NVIDIA Technical Blog: GB200 designs contributed to OCP',
          url: 'https://developer.nvidia.com/blog/?p=90182',
          sourceType: 'official_technical',
          checkedAt: '2026-06-03',
          why: '看 NVIDIA 是否把 rack/cooling 设计开放给生态，形成第三方供应机会。',
          finding: 'NVIDIA 向 OCP 贡献 GB200 NVL72 rack、compute tray、switch tray liquid-cooled designs，并提到与 Vertiv 的 reference architecture。',
          impact: '把 Vertiv/液冷 reference design 作为 anchor，但继续寻找更纯的小供应商。',
        },
        {
          source: 'LBNL 2024 United States Data Center Energy Usage Report',
          url: 'https://energyanalysis.lbl.gov/publications/2024-lbnl-data-center-energy-usage-report',
          sourceType: 'government_report',
          checkedAt: '2026-06-03',
          why: '验证数据中心电力需求是否是长期预算线，而不是短期新闻。',
          finding: '报告给出 2014-2028 的数据中心用电历史和情景预测，数据中心负载增长在过去十年大幅上升。',
          impact: '保留电网/变压器/电力设备市场，作为 AI capex 的物理瓶颈。',
        },
        {
          source: 'DOE Office of Electricity: R&D Efforts to Address Transformer Supply',
          url: 'https://www.energy.gov/oe/rd-efforts-address-transformer-supply',
          sourceType: 'government_report',
          checkedAt: '2026-06-03',
          why: '确认 transformer 是否是供应端瓶颈，并寻找供应短缺原因。',
          finding: 'DOE/OE 指出 transformer demand 受电气化、可再生能源、老化电网、极端天气、utility resilience 投资等多因素推动。',
          impact: '保留 transformer，但需要区别 AI 数据中心增量和泛电气化增量。',
        },
        {
          source: 'Intel newsroom: glass substrates for advanced packaging',
          url: 'https://newsroom.intel.com/artificial-intelligence/intel-unveils-industry-leading-glass-substrates',
          sourceType: 'official_company',
          checkedAt: '2026-06-03',
          why: '寻找 AI package 在 CoWoS/HBM 之外的下一层材料瓶颈。',
          finding: 'Intel 称玻璃基板可带来更高 interconnect density，初始用例包括 data center、AI 和 graphics 等大尺寸高性能封装。',
          impact: '保留 glass core substrates，下一步查设备/材料/基板厂 public carriers。',
        },
        {
          source: 'Samsung Electro-Mechanics: glass core JV with Sumitomo Chemical',
          url: 'https://samsungsem.com/global/newsroom/news/view.do?id=9850',
          sourceType: 'official_company',
          checkedAt: '2026-06-03',
          why: '确认玻璃核心不是单一 Intel 实验，而是产业链公司已经合作布局。',
          finding: 'Samsung Electro-Mechanics 与 Sumitomo Chemical Group 签署 MOU，准备建立 glass core JV，并称其是未来 package substrate 的关键材料。',
          impact: '把 Samsung Electro-Mechanics、Sumitomo Chemical、基板材料链列入候选。',
        },
        {
          source: 'Samsung Electro-Mechanics: silicon capacitor supply contract',
          url: 'https://m.samsungsem.com/global/newsroom/news/view.do?id=10310',
          sourceType: 'official_company',
          checkedAt: '2026-06-03',
          why: '寻找 AI GPU/HBM 封装内部的电源完整性瓶颈。',
          finding: 'Samsung Electro-Mechanics 公告 1.5 万亿韩元 silicon capacitor supply contract，应用于 AI server GPU 和 HBM 等高性能半导体封装。',
          impact: '新保留 in-package silicon capacitor 市场，这比传统 MLCC 更接近 AI package BOM。',
        },
        {
          source: 'Prysmian / Relativity hollow-core fiber partnership',
          url: 'https://www.prysmian.com/en/media/press-releases/relativity-and-prysmian-partner-next-generation-fiber-optic-cable-for-data-centers',
          sourceType: 'official_company',
          checkedAt: '2026-06-03',
          why: '验证 AI data center fiber 是否可能从普通光纤升级为空芯/低延迟特殊光纤。',
          finding: 'Prysmian 与 Relativity Networks 签长期伙伴关系，面向 AI economy data centers 的 hollow-core optical fiber/cable 量产。',
          impact: '保留 hollow-core/dense fiber，但 public exposure 可能偏大或不纯。',
        },
      ],
      evidenceLedger: [
        {
          source: 'NVIDIA GB200 NVL72 official product page',
          originalSource: 'NVIDIA',
          sourceType: 'official_company',
          publishedAt: '2024-03-18',
          accessedAt: '2026-06-03',
          authorOrInstitution: 'NVIDIA',
          url: 'https://www.nvidia.com/en-us/data-center/gb200-nvl72/',
          isOriginalSource: true,
          isIndependentSource: true,
          isCandidateCompanySource: false,
          sourceFamily: 'nvidia_official',
          allowedUse: 'core_evidence',
          applicableClaims: ['AI rack density creates cooling and physical interconnect requirements'],
          claimStatus: 'supported',
          finding: 'GB200 NVL72 is a rack-scale liquid-cooled system using 72 Blackwell GPUs and NVLink.',
          limitations: 'Demand anchor only; it does not identify the scarce component supplier.',
          confidenceImpact: 'raise',
        },
        {
          source: 'LBNL 2024 United States Data Center Energy Usage Report',
          originalSource: 'Lawrence Berkeley National Laboratory',
          sourceType: 'government_report',
          publishedAt: '2024-12-20',
          accessedAt: '2026-06-03',
          authorOrInstitution: 'Lawrence Berkeley National Laboratory',
          url: 'https://energyanalysis.lbl.gov/publications/2024-lbnl-data-center-energy-usage-report',
          isOriginalSource: true,
          isIndependentSource: true,
          isCandidateCompanySource: false,
          sourceFamily: 'us_government_lbnl',
          allowedUse: 'core_evidence',
          applicableClaims: ['Data center power demand is a durable top-level demand change'],
          claimStatus: 'supported',
          finding: 'The report documents historical data-center load growth and scenarios through 2028.',
          limitations: 'It does not isolate AI-only demand or prove a listed-company pricing gap.',
          confidenceImpact: 'raise',
        },
        {
          source: 'DOE Office of Electricity: R&D Efforts to Address Transformer Supply',
          originalSource: 'U.S. Department of Energy Office of Electricity',
          sourceType: 'government_report',
          publishedAt: '2024-01-01',
          accessedAt: '2026-06-03',
          authorOrInstitution: 'U.S. Department of Energy Office of Electricity',
          url: 'https://www.energy.gov/oe/rd-efforts-address-transformer-supply',
          isOriginalSource: true,
          isIndependentSource: true,
          isCandidateCompanySource: false,
          sourceFamily: 'us_government_doe',
          allowedUse: 'core_evidence',
          applicableClaims: ['Transformer supply can constrain grid expansion'],
          claimStatus: 'supported',
          finding: 'DOE identifies multiple demand drivers and supply concerns for transformers.',
          limitations: 'The source does not quantify the incremental contribution from AI data centers.',
          confidenceImpact: 'raise',
        },
      ],
      challengeLedger: [
        {
          challenge: 'Why now?',
          query: 'AI rack density liquid cooling power requirements official documentation',
          sourceType: 'official_company',
          result: 'Rack-scale liquid-cooled reference systems make cooling and power delivery a deployment constraint rather than an optional feature.',
          impact: 'keep_active',
          nextAction: 'Verify component-level suppliers and revenue exposure.',
        },
        {
          challenge: 'Are the bottlenecks truly scarce?',
          query: 'liquid cooling component supplier capacity expansion alternative suppliers',
          sourceType: 'counter_search',
          result: 'Supplier counts and expansion lead times remain unverified for most component-level markets.',
          impact: 'reduce_confidence',
          nextAction: 'Do not upgrade any candidate until supplier count and qualification friction are evidenced.',
        },
        {
          challenge: 'Strongest bear case',
          query: 'AI rack density alternative architecture internal sourcing capacity expansion',
          sourceType: 'counter_search',
          result: 'Large system vendors may internalize the value, components may have many suppliers, and current narratives may already be priced.',
          impact: 'reduce_confidence',
          nextAction: 'Complete pricing analysis and public-carrier purity checks.',
        },
      ],
      keyConclusions: [
        {
          conclusion: 'AI rack density is creating additional physical deployment dependencies beyond GPUs.',
          status: 'supported',
          evidenceIds: ['nvidia_official', 'us_government_lbnl'],
          changedAt: '2026-06-03',
          changeReason: 'Official demand-anchor and government power-demand evidence.',
        },
        {
          conclusion: 'A clean listed bottleneck carrier has been identified.',
          status: 'unknown',
          evidenceIds: [],
          changedAt: '2026-06-03',
          changeReason: 'Supplier counts, purity and pricing gaps remain incomplete.',
        },
      ],
      unknowns: [
        'Component-level supplier counts are not verified for liquid cooling, silicon capacitors, glass core substrates or hollow-core fiber.',
        'Capacity expansion lead times and customer qualification cycles remain incomplete.',
        'Market pricing and analyst expectation data are not yet collected for surviving candidates.',
      ],
      falsifiers: [
        'Critical components have many qualified suppliers and can expand capacity within one or two quarters.',
        'Candidate revenue exposure is too small to affect company-level financial results.',
        'Alternative architectures remove the identified dependency before revenue transmission is visible.',
      ],
      reasoningLedger: [
        {
          step: '1',
          hypothesis: 'AI rack-scale 系统会把瓶颈从 GPU 芯片扩散到液冷、机架电力和物理互联。',
          evidence: 'NVIDIA GB200 NVL72 官方页面和 OCP 技术博客均明确提到 liquid-cooled rack-scale design。',
          inference: '液冷不是辅助题材，而是 Blackwell/Rubin 时代的部署约束；但 VRT 已高覆盖，需要继续找更小、更纯的供应商。',
          confidence: 'medium',
          nextUncertainty: '冷板、CDU、泵阀、快接头、介电冷却液、热交换器中哪个环节供应商最少？',
        },
        {
          step: '2',
          hypothesis: 'AI package 内部电源完整性可能形成新的材料/被动元件瓶颈。',
          evidence: 'Samsung Electro-Mechanics 公告硅电容两年 1.5 万亿韩元合同，明确用于 AI servers GPU 和 HBM。',
          inference: '硅电容可能是比传统 MLCC 更接近 AI package BOM 的“紫苏叶”候选。',
          confidence: 'medium',
          nextUncertainty: '除 Samsung Electro-Mechanics 外，Murata/TDK/其他厂商的 silicon capacitor 产能和客户是谁？',
        },
        {
          step: '3',
          hypothesis: '玻璃基板可能成为后 CoWoS/HBM 时代的大尺寸 AI 封装材料瓶颈。',
          evidence: 'Intel 讲 10x interconnect density，Samsung/ Sumitomo 建 glass core JV。',
          inference: '市场真实但时间可能偏后；需要寻找能在 2026-2028 进入收入表的载体。',
          confidence: 'medium-low',
          nextUncertainty: '量产时间、良率、设备链和基板厂客户认证是否可见？',
        },
        {
          step: '4',
          hypothesis: '数据中心光纤会从“普通网络耗材”转为 AI 后端网络部署瓶颈。',
          evidence: 'Corning GlassWorks AI 和 Prysmian/Relativity 空芯光纤伙伴关系。',
          inference: '需求明显，但 GLW/PRY 都是大公司；要找 preform、特殊连接器、空芯 IP 或区域小供应商。',
          confidence: 'medium-low',
          nextUncertainty: 'AI data center fiber 对应的最稀缺环节是 preform、cable、connector 还是 installation capacity？',
        },
      ],
      markets: [
        {
          market: 'Direct liquid cooling / AI rack thermal architecture',
          demandChain: ['Blackwell/Rubin rack-scale AI', '100kW+ rack density', 'direct-to-chip cooling', 'CDU/cold plate/quick disconnect/coolant', 'deployment bottleneck'],
          chokepoint: '冷板、CDU、泵阀、快接头、液冷回路验证和数据中心改造能力。',
          supplierCount: 'unknown；需要按组件拆分，VRT 是 anchor 但不是小市值纯载体。',
          publicCarriers: ['VRT', 'MOD', 'NVT', 'ETN', 'Delta Electronics', 'Sanhua Intelligent'],
          status: 'active_research',
          nextEvidence: ['查 GB200/GB300 reference BOM', '查冷板/CDU 供应商', '查供应商 backlog 和数据中心客户'],
        },
        {
          market: 'In-package silicon capacitors for AI GPU/HBM',
          demandChain: ['AI GPU/HBM power spikes', 'package-level power integrity', 'silicon capacitors', 'ultra-fine process + package substrate channel'],
          chokepoint: '靠近 GPU/HBM 的高密度电容、硅工艺、客户认证和封装集成。',
          supplierCount: 'unknown；第一条明确证据来自 Samsung Electro-Mechanics。',
          publicCarriers: ['Samsung Electro-Mechanics', 'Murata', 'TDK', 'Yageo', 'Vishay'],
          status: 'active_research',
          nextEvidence: ['查各公司 silicon capacitor 产品线', '查 AI/HBM 客户披露', '查合同是否可转收入和毛利'],
        },
        {
          market: 'Glass core package substrates',
          demandChain: ['larger AI packages', 'higher interconnect density', 'organic substrate limits', 'glass core substrate', 'materials/equipment/substrate suppliers'],
          chokepoint: '玻璃核心材料、通孔/金属化、良率、基板厂认证和封装生态。',
          supplierCount: 'early；Intel/Samsung/Sumitomo 已有官方动作。',
          publicCarriers: ['Samsung Electro-Mechanics', 'Sumitomo Chemical', 'Ibiden', 'AT&S', 'Intel'],
          status: 'active_research',
          nextEvidence: ['查量产时间表', '查设备链', '查客户 qualification 和 capex'],
        },
        {
          market: 'AI data center dense fiber / hollow-core fiber',
          demandChain: ['GPU cluster scale-out', 'backend network density', 'fiber-rich interconnects', 'preform/fiber/cable/connectors', 'data center deployment'],
          chokepoint: '特殊光纤 preform、空芯光纤量产、连接器密度和施工能力。',
          supplierCount: 'unknown；GLW/PRY 是 anchor，需要找更小或更纯的载体。',
          publicCarriers: ['GLW', 'Prysmian', 'STL', 'Hengtong', 'FiberHome'],
          status: 'active_research',
          nextEvidence: ['查 preform 产能', '查 hyperscaler 长约', '查空芯光纤商业化时间'],
        },
        {
          market: 'Grid transformers / AI data center interconnect power',
          demandChain: ['AI data center power demand', 'utility interconnect queue', 'substations', 'transformers/switchgear', 'project delay bottleneck'],
          chokepoint: '变压器交期、开关设备 backlog、公用事业接入和变电站建设。',
          supplierCount: 'fragmented；已有 POWL/HPS.A 等候选，但要分辨 AI 增量。',
          publicCarriers: ['POWL', 'HPS.A', 'ETN', 'GEV', 'Siemens Energy'],
          status: 'watch_active',
          nextEvidence: ['查 backlog 中数据中心占比', '查 utility capex plan', '查 interconnect queue'],
        },
      ],
      candidates: [
        {
          ticker: '009150.KS',
          name: 'Samsung Electro-Mechanics',
          market: 'In-package silicon capacitors / glass core substrates',
          score: 78,
          publicExposure: '同时暴露于 package substrates、glass core 和 silicon capacitors；已有官方大合同和 JV 线索。',
          whySurvives: '官方证据显示 AI GPU/HBM 封装电源完整性和玻璃核心材料都可能进入收入表。',
          keyFalsifier: '合同客户/产品不是 AI GPU/HBM，或业务体量太大导致新线对财务弹性不足。',
          nextEvidence: '读最新财报/IR，拆 silicon capacitor 和 substrate revenue guidance。',
        },
        {
          ticker: 'MOD',
          name: 'Modine Manufacturing',
          market: 'Liquid cooling / thermal systems',
          score: 67,
          publicExposure: '可能暴露于数据中心 thermal management，但需要确认 AI liquid cooling 业务纯度。',
          whySurvives: '比 VRT 更可能有中型市值弹性，但供应链位置不够清楚。',
          keyFalsifier: '数据中心液冷收入占比低，或产品不在 GB200/GB300 关键环节。',
          nextEvidence: '查 10-K、投资者日、数据中心客户和订单 backlog。',
        },
        {
          ticker: 'PRY.MI',
          name: 'Prysmian',
          market: 'Hollow-core / AI data center fiber',
          score: 64,
          publicExposure: '官方与 Relativity Networks 合作量产空芯光纤，但公司体量大、纯度偏低。',
          whySurvives: '可作为空芯光纤商业化 anchor，不一定是最佳弹性标的。',
          keyFalsifier: '空芯光纤放量时间太晚，或收入占比无法改变财务。',
          nextEvidence: '查 1Q26 presentation、Relativity 合作产能、data center revenue split。',
        },
      ],
      rejected: [
        {
          target: 'NVIDIA / hyperscaler first-layer beneficiaries',
          reason: '它们是需求锚，不是 Serenity 方法要找的深层瓶颈载体。',
          evidence: 'GB200/Rubin 带来的是下一层 liquid cooling、power、fiber、substrate demand。',
          recheckTrigger: '只有当内部供应链披露暴露新外部供应商时再用作证据源。',
        },
        {
          target: 'Pure CPO external laser as the only new market',
          reason: '这条线已经高度重合 SIVE/LITE/AAOI，不足以回答“找新的市场”。',
          evidence: '现有 Serenity thesis cards 已覆盖 CPO/外置激光器。',
          recheckTrigger: '出现新的非 SIVE/LITE public carrier 或标准路线切换。',
        },
      ],
      nextQueue: [
        {
          priority: 1,
          task: '拆 GB200/GB300 液冷 BOM：cold plate、CDU、quick disconnect、coolant、heat exchanger 分别有哪些供应商。',
          sourceToInspect: 'NVIDIA OCP specs、Vertiv reference architecture、Supermicro/HPE/Dell datasheets。',
          expectedEvidence: '组件级供应商或 design partner 名单。',
          falsifier: '所有关键组件都由大厂内部或私有供应商垄断，无清洁 public exposure。',
        },
        {
          priority: 1,
          task: '追 silicon capacitor 供应商图谱。',
          sourceToInspect: 'Samsung Electro-Mechanics IR、Murata/TDK product pages、封装专利。',
          expectedEvidence: 'AI GPU/HBM 封装中的电容规格、产能、客户认证。',
          falsifier: '只有 Samsung 一家大公司有暴露，且财务弹性不足。',
        },
        {
          priority: 2,
          task: '查 glass core substrate 量产链条。',
          sourceToInspect: 'Intel packaging docs、Samsung/Sumitomo JV、AT&S/Ibiden/Shinko filings。',
          expectedEvidence: '量产时间、capex、设备供应商、客户 qualification。',
          falsifier: '量产在 2029+，无法形成近期财务重写。',
        },
        {
          priority: 2,
          task: '验证 AI data center fiber 的真正瓶颈是在 preform、fiber、cable、connector 还是安装服务。',
          sourceToInspect: 'Corning、Prysmian、CRU/OFC materials、connector suppliers。',
          expectedEvidence: 'lead time、capacity expansion、hyperscaler commitments。',
          falsifier: '供应扩张快或大型 GLW/PRY 已完全定价。',
        },
      ],
    },
  ];
}

function getSerenityCuratedTheses() {
  return [
    {
      id: 'serenity-axti-inp-substrate',
      source: 'generated',
      title: 'AXTI：AI 光通信向 InP 衬底的上游瓶颈传导',
      primaryTicker: 'AXTI',
      tickers: ['AXTI', 'SMTOY', 'LITE', 'COHR'],
      focusArea: '材料 / 衬底',
      layer: '第五层：InP 衬底 / 化合物半导体材料',
      status: 'research-ready',
      demandSource: 'AI GPU 集群扩张带来数据中心光互联升级，800G/1.6T/CPO 推高 InP 相关材料需求。',
      chain: ['AI capex', 'GPU 数据中心', '高速光互联', '激光器 / 光模块', 'InP 衬底'],
      chokepoint: '全球可规模化量产 InP 衬底的玩家很少，产能、良率和认证周期按年计。',
      businessCarrier: 'AXTI 作为小市值上游衬底公司，理论上比光模块龙头更纯地暴露于材料紧缺。',
      financialTranslation: '验证重点不是“AI 概念”，而是 InP 出货、ASP、毛利率、产能利用率和客户认证是否进入收入表。',
      marketMisclassification: '市场容易把它当作周期性化合物半导体材料小票，而不是 AI photonics 上游瓶颈。',
      validationSignals: ['InP / GaAs 产能利用率和扩产节奏', '客户认证或长期供货披露', 'AI 光通信相关收入占比上升', '毛利率随材料紧缺改善'],
      falsifiers: ['CPO / 高速光互联路线延迟', '主要客户转向其他材料或内部供应', '扩产导致供给过剩', '持续稀释抵消经营弹性'],
      researchQuestions: ['AXTI 当前 InP 收入和 AI 光通信需求之间是否已有可量化桥梁？', 'SMTOY 等竞争对手是否足以削弱稀缺性？'],
      keywords: ['InP', 'substrate', 'phosphide', 'indium phosphide', '磷化铟', '衬底', '$AXTI', 'SMTOY'],
      dimensions: { demandCertainty: 4.5, chokepointScarcity: 4.7, businessPurity: 4.2, marketMisclassification: 4.4, financialElasticity: 4.1, verificationSpeed: 3.2, executionRisk: 3.2, dilutionRisk: 3.5, substitutionRisk: 2.8 },
    },
    {
      id: 'serenity-sive-cpo-laser',
      source: 'generated',
      title: 'SIVE：CPO / 硅光需要外置连续波激光器',
      primaryTicker: 'SIVE',
      tickers: ['SIVE', 'LITE', 'POET', 'JBL', 'COHR'],
      focusArea: 'AI 光通信 / CPO',
      layer: '第四层：外置光源 / CW DFB laser',
      status: 'research-ready',
      demandSource: 'CPO / 硅光把数据中心互联推向更高带宽，但硅本身不能有效发光。',
      chain: ['GPU 集群扩展', '交换和光互联瓶颈', 'CPO / 硅光架构', '外置光源', '高功率 CW DFB laser'],
      chokepoint: '可给 CPO/硅光生态供应高功率连续波激光器的公司有限，客户认证和良率决定放量速度。',
      businessCarrier: 'SIVE 小市值、低覆盖、业务与激光器路线绑定度高，被 Serenity 反复类比为“下一只 LITE”。',
      financialTranslation: '关键是客户 qualification、晶圆代工/封装伙伴、订单转收入，以及毛利率是否出现结构性重估。',
      marketMisclassification: '市场可能仍按瑞典小型半导体或研发型硬件公司定价，而不是按 AI 光源瓶颈定价。',
      validationSignals: ['Win Semi / foundry qualification', 'POET、Ayar、Jabil、O-Net 等生态客户验证', '量产良率和出货节奏', '年度报告中 AI photonics 收入线索'],
      falsifiers: ['CPO 放量时间后移', 'LITE / COHR / AVGO 等大厂内化光源', 'SIVE 客户认证未转订单', '融资稀释或产能执行失败'],
      researchQuestions: ['SIVE 的技术指标是否真能满足 CPO 外置光源需求？', '客户链条是实质订单、样品验证，还是社区推断？'],
      keywords: ['SIVE', '$SIVE', 'CPO', 'silicon photonics', '硅光', 'laser', 'DFB', 'CW laser', 'external laser', 'Win Semi', 'Ayar', 'POET', 'Jabil'],
      dimensions: { demandCertainty: 4.2, chokepointScarcity: 4.5, businessPurity: 4.6, marketMisclassification: 4.7, financialElasticity: 4.8, verificationSpeed: 3.3, executionRisk: 4.0, dilutionRisk: 3.7, substitutionRisk: 3.2 },
    },
    {
      id: 'serenity-aaoi-direct-hyperscaler',
      source: 'generated',
      title: 'AAOI：从“旧光模块小票”重定价为 hyperscaler 直接受益者',
      primaryTicker: 'AAOI',
      tickers: ['AAOI', 'AMZN', 'MSFT', 'JBL', 'LITE', 'COHR'],
      focusArea: 'AI 光通信 / CPO',
      layer: '第三层：800G / 1.6T 光模块与直接客户',
      status: 'research-ready',
      demandSource: 'AWS Trainium、Microsoft Maia 和 hyperscaler AI 集群扩张需要高速光互联。',
      chain: ['AI 自研 ASIC', '数据中心网络升级', '800G / 1.6T 光模块', '直接供货 / 产能爬坡', '收入和毛利改善'],
      chokepoint: '如果 AAOI 的直接 hyperscaler 客户和美国制造能力成立，它不只是跟随光模块 beta，而是吃订单重分配。',
      businessCarrier: 'AAOI 市值较小、历史包袱重，市场可能低估订单恢复后经营杠杆。',
      financialTranslation: 'Serenity 关注的是 2027 revenue guide、backlog、客户集中度、产能爬坡和毛利，而不是单纯追光模块行情。',
      marketMisclassification: '市场容易把 AAOI 当作过去受损的光通信周期股，而非 AI ASIC 网络供应链的一环。',
      validationSignals: ['AMZN / MSFT 相关客户或订单线索', '800G / 1.6T 出货和良率', '2027 收入指引', 'Jabil 等竞争/合作链条变化'],
      falsifiers: ['大客户订单取消或转单', 'Jabil / 其他供应商抢走核心份额', '毛利无法随收入改善', '资本开支或稀释压力超预期'],
      researchQuestions: ['AAOI 的客户与产品路线是否有一手文件支撑？', '2027 指引是否已经被股价充分定价？'],
      keywords: ['AAOI', '$AAOI', '800G', '1.6T', 'Trainium', 'Maia', 'hyperscaler', 'optical module', 'Jabil'],
      dimensions: { demandCertainty: 4.4, chokepointScarcity: 3.6, businessPurity: 4.1, marketMisclassification: 4.1, financialElasticity: 4.5, verificationSpeed: 4.0, executionRisk: 3.8, dilutionRisk: 3.2, substitutionRisk: 3.6 },
    },
    {
      id: 'serenity-lite-cohr-laser-chokepoint',
      source: 'generated',
      title: 'LITE / COHR：激光器瓶颈从组件收入走向结构性重估',
      primaryTicker: 'LITE',
      tickers: ['LITE', 'COHR', 'AVGO', 'MRVL'],
      focusArea: 'AI 光通信 / CPO',
      layer: '第三到四层：EML / 激光器 / 光源',
      status: 'watch',
      demandSource: '高速光模块和 CPO 需要更高功率、更高良率的光源，激光器成为光通信扩张的硬瓶颈。',
      chain: ['AI 数据中心', '高速网络', '光模块 / CPO', '激光器', '供应分配与定价权'],
      chokepoint: '大规模高性能激光器供给集中，且客户认证周期长。',
      businessCarrier: 'LITE / COHR 是更大、更被覆盖的载体，适合做瓶颈价格锚和同业验证。',
      financialTranslation: '用 backlog、datacom 占比、毛利和 capex 来验证 Serenity 对 SIVE/AAOI 的上游判断。',
      marketMisclassification: '从传统光学周期股向 AI photonics capacity allocator 的叙事迁移。',
      validationSignals: ['datacom 收入增长', '客户 capacity reservation', '毛利率拐点', '800G/1.6T 产品组合'],
      falsifiers: ['供应放量导致价格压力', '客户自研或转向替代供应商', 'CPO 商业化低于预期'],
      researchQuestions: ['LITE/COHR 的重估是否已经覆盖绝大多数激光器瓶颈价值？'],
      keywords: ['LITE', '$LITE', 'COHR', '$COHR', 'laser chokepoint', 'EML', 'datacom', 'CPO'],
      dimensions: { demandCertainty: 4.6, chokepointScarcity: 4.1, businessPurity: 3.8, marketMisclassification: 3.2, financialElasticity: 3.7, verificationSpeed: 4.2, executionRisk: 2.8, dilutionRisk: 2.0, substitutionRisk: 3.1 },
    },
    {
      id: 'serenity-rpi-agent-hardware',
      source: 'generated',
      title: 'RPI：开发者社区里的 AI agent 硬件增量需求',
      primaryTicker: 'RPI',
      tickers: ['RPI'],
      focusArea: '社区新增需求',
      layer: '第二层：边缘硬件 / 开发者需求',
      status: 'watch',
      demandSource: 'AI agent、OpenClaw/Picoclaw/Nanobot 等社区项目让 Raspberry Pi 从教育板卡变成低成本 agent 载体。',
      chain: ['AI agent adoption', '本地/边缘部署', '低成本开发板', '渠道采购和缺货', '营收超共识'],
      chokepoint: '真正的瓶颈不是硬件不可替代，而是华尔街模型可能没有捕捉到社区突然出现的新增需求。',
      businessCarrier: 'RPI 是单一品牌/渠道载体，适合用社区行为反推收入弹性。',
      financialTranslation: '用 GitHub 增速、论坛采购、渠道库存和财报营收增速验证是否显著高于共识。',
      marketMisclassification: '市场可能仍把 RPI 当作教育/爱好者板卡公司，而不是 agent 边缘硬件需求代理。',
      validationSignals: ['相关 GitHub repo 增长', '论坛采购讨论', '渠道缺货或涨价', '财报收入增速高于共识'],
      falsifiers: ['社区热度不能转化为采购', '渠道库存充足且 ASP 下滑', '大厂低价替代板卡进入'],
      researchQuestions: ['社区数据和实际采购之间是否有可靠映射？'],
      keywords: ['RPI', 'Raspberry Pi', 'OpenClaw', 'Picoclaw', 'Nanobot', 'AI Agent', 'agent hardware'],
      dimensions: { demandCertainty: 3.8, chokepointScarcity: 2.4, businessPurity: 4.0, marketMisclassification: 4.4, financialElasticity: 4.0, verificationSpeed: 4.5, executionRisk: 2.6, dilutionRisk: 1.8, substitutionRisk: 4.0 },
    },
    {
      id: 'serenity-nbis-neocloud',
      source: 'generated',
      title: 'NBIS：GPU 短缺向 Neocloud 容量和融资结构传导',
      primaryTicker: 'NBIS',
      tickers: ['NBIS', 'NVDA', 'MSFT'],
      focusArea: 'Neocloud / 算力基建',
      layer: '第二层：GPU 云 / 数据中心容量',
      status: 'watch',
      demandSource: '企业和模型公司对 GPU capacity 的需求超过传统云交付节奏。',
      chain: ['AI 模型训练/推理', 'GPU 租赁需求', 'Neocloud 数据中心', '客户合同', '现金流和估值重估'],
      chokepoint: '瓶颈在 GPU 采购、机房上线、电力接入、客户利用率和融资成本。',
      businessCarrier: 'NBIS 这类 Neocloud 公司更直接暴露于 GPU capacity 定价，但财务杠杆也更高。',
      financialTranslation: '重点验证长期合同、GPU 折旧、债务结构、利用率和毛利率。',
      marketMisclassification: '市场可能在“AI 服务器租赁”与“高杠杆数据中心资产”之间摇摆，造成叙事折价。',
      validationSignals: ['Microsoft / 企业客户合同', 'GPU 上线数量', '利用率', '融资成本和现金流'],
      falsifiers: ['GPU 供给宽松导致租金下滑', '融资成本吞噬毛利', '客户合同取消或利用率不足'],
      researchQuestions: ['NBIS 的合同质量是否足以覆盖资产负债表风险？'],
      keywords: ['NBIS', '$NBIS', 'neocloud', 'GPU cloud', 'Microsoft', 'capacity', 'data center'],
      dimensions: { demandCertainty: 4.0, chokepointScarcity: 3.4, businessPurity: 4.2, marketMisclassification: 3.8, financialElasticity: 4.1, verificationSpeed: 3.5, executionRisk: 4.0, dilutionRisk: 3.8, substitutionRisk: 3.4 },
    },
    {
      id: 'serenity-memory-storage-inference',
      source: 'generated',
      title: 'MU / SNDK / SIMO：推理规模化后的内存与存储二级瓶颈',
      primaryTicker: 'MU',
      tickers: ['MU', 'SNDK', 'SIMO', 'WDC', 'STX'],
      focusArea: '推理内存 / 存储',
      layer: '第二到三层：DRAM / NAND / 控制器',
      status: 'watch',
      demandSource: 'AI 推理和 agent 记忆把瓶颈从训练 GPU 扩展到内存带宽、KV cache、SSD 和控制器。',
      chain: ['推理 token 增长', 'KV cache / 数据检索', 'DRAM / NAND / SSD', '控制器和模组', '周期上行 + 结构性需求'],
      chokepoint: '如果推理数据访问成为约束，存储/控制器会从周期品变成 AI infra 二级瓶颈。',
      businessCarrier: 'MU/SNDK 提供容量价格 beta，SIMO 等控制器公司可能提供更小市值弹性。',
      financialTranslation: '观察 ASP、库存周期、AI 服务器规格、控制器 attach rate 和毛利率。',
      marketMisclassification: '市场可能只按存储周期交易，低估 AI inference 对结构性需求的拉动。',
      validationSignals: ['云实例内存/SSD 配置升级', 'NAND/DRAM ASP', '控制器出货', '管理层 AI demand 口径'],
      falsifiers: ['存储供给过剩', '模型优化降低内存/存储需求', 'AI 需求被传统周期库存抵消'],
      researchQuestions: ['推理增长能否改变存储行业的周期弹性？'],
      keywords: ['MU', '$MU', 'SNDK', '$SNDK', 'SIMO', '$SIMO', 'memory', 'NAND', 'DRAM', 'SSD', 'KV cache', 'inference'],
      dimensions: { demandCertainty: 3.9, chokepointScarcity: 2.9, businessPurity: 3.5, marketMisclassification: 3.7, financialElasticity: 3.8, verificationSpeed: 4.0, executionRisk: 2.8, dilutionRisk: 1.8, substitutionRisk: 3.7 },
    },
    {
      id: 'serenity-power-grid-ai',
      source: 'generated',
      title: 'POWL / HPS.A / FLNC：AI 数据中心把瓶颈推向电力设备与电网',
      primaryTicker: 'POWL',
      tickers: ['POWL', 'HPS.A', 'FLNC', 'XLU', 'ETN', 'GEV'],
      focusArea: '电力 / 电网',
      layer: '第二到三层：变压器 / 开关设备 / 储能 / 电网接入',
      status: 'watch',
      demandSource: 'AI 数据中心扩张受限于电力接入、变压器交期、开关设备和储能调峰。',
      chain: ['AI 数据中心 capex', '电力需求', '变压器/开关设备/储能', 'backlog 和定价权', '收入与毛利兑现'],
      chokepoint: '交期长、产能扩张慢、电网排队刚性，造成设备供应商 backlog 的可见度。',
      businessCarrier: 'POWL/HPS.A 等设备商和 FLNC 储能商可以作为电力瓶颈载体；XLU 提供公用事业 beta。',
      financialTranslation: '用 backlog、book-to-bill、毛利、数据中心客户占比和公用事业 capex plan 验证。',
      marketMisclassification: '市场可能把它们当传统工业/公用事业周期，而非 AI capex 的下游硬约束。',
      validationSignals: ['变压器 backlog', '数据中心订单', '公用事业 capex 上调', 'ISO interconnection queue'],
      falsifiers: ['数据中心建设放缓', '设备供给快速释放', '监管或电价限制压低项目回报'],
      researchQuestions: ['AI 电力瓶颈中哪个环节最稀缺、且有小市值上市载体？'],
      keywords: ['POWL', '$POWL', 'HPS.A', 'FLNC', '$FLNC', 'XLU', 'transformer', 'switchgear', 'grid', 'power', 'data center'],
      dimensions: { demandCertainty: 4.2, chokepointScarcity: 3.7, businessPurity: 3.6, marketMisclassification: 3.4, financialElasticity: 3.6, verificationSpeed: 3.6, executionRisk: 2.7, dilutionRisk: 1.7, substitutionRisk: 2.8 },
    },
  ];
}

function enrichSerenityCard(inputCard, records) {
  if (!inputCard || typeof inputCard !== 'object') return null;
  const tickers = uniqueStrings([inputCard.primaryTicker, ...normalizeStringArray(inputCard.tickers)].map(normalizeTickerSymbol)).slice(0, 12);
  const primaryTicker = normalizeTickerSymbol(inputCard.primaryTicker || tickers[0] || '');
  const title = truncate(cleanText(inputCard.title || `${primaryTicker || '候选标的'} Serenity thesis`), 180);
  if (!title) return null;

  const baseCard = {
    id: cleanText(inputCard.id || `serenity:${crypto.createHash('sha1').update(`${title}:${tickers.join(',')}`).digest('hex').slice(0, 16)}`),
    source: cleanText(inputCard.source || 'custom'),
    title,
    primaryTicker,
    tickers,
    focusArea: truncate(cleanText(inputCard.focusArea || '待归类'), 60),
    layer: truncate(cleanText(inputCard.layer || '待定义层级'), 80),
    status: truncate(cleanText(inputCard.status || 'watch'), 40),
    demandSource: truncate(cleanText(inputCard.demandSource || ''), 420),
    chain: normalizeStringArray(inputCard.chain).slice(0, 8),
    chokepoint: truncate(cleanText(inputCard.chokepoint || ''), 420),
    businessCarrier: truncate(cleanText(inputCard.businessCarrier || ''), 420),
    financialTranslation: truncate(cleanText(inputCard.financialTranslation || ''), 420),
    marketMisclassification: truncate(cleanText(inputCard.marketMisclassification || ''), 420),
    validationSignals: normalizeStringArray(inputCard.validationSignals).slice(0, 8),
    falsifiers: normalizeStringArray(inputCard.falsifiers).slice(0, 8),
    researchQuestions: normalizeStringArray(inputCard.researchQuestions).slice(0, 8),
    keywords: normalizeStringArray(inputCard.keywords).slice(0, 16),
    dimensions: normalizeSerenityDimensions(inputCard.dimensions),
    createdAt: normalizeDate(inputCard.createdAt) || new Date().toISOString(),
    updatedAt: normalizeDate(inputCard.updatedAt) || new Date().toISOString(),
  };

  const stats = getSerenityCardStats(baseCard, records);
  return {
    ...baseCard,
    score: scoreSerenityCard(baseCard, stats),
    stats,
    evidence: stats.topEvidence,
  };
}

function normalizeSerenityDimensions(value = {}) {
  const dimensions = value && typeof value === 'object' ? value : {};
  return {
    demandCertainty: clampNumber(dimensions.demandCertainty, 1, 5, 3),
    chokepointScarcity: clampNumber(dimensions.chokepointScarcity, 1, 5, 3),
    businessPurity: clampNumber(dimensions.businessPurity, 1, 5, 3),
    marketMisclassification: clampNumber(dimensions.marketMisclassification, 1, 5, 3),
    financialElasticity: clampNumber(dimensions.financialElasticity, 1, 5, 3),
    verificationSpeed: clampNumber(dimensions.verificationSpeed, 1, 5, 3),
    executionRisk: clampNumber(dimensions.executionRisk, 1, 5, 3),
    dilutionRisk: clampNumber(dimensions.dilutionRisk, 1, 5, 3),
    substitutionRisk: clampNumber(dimensions.substitutionRisk, 1, 5, 3),
  };
}

function scoreSerenityCard(card, stats) {
  const dimensions = normalizeSerenityDimensions(card.dimensions);
  const positive =
    dimensions.demandCertainty +
    dimensions.chokepointScarcity +
    dimensions.businessPurity +
    dimensions.marketMisclassification +
    dimensions.financialElasticity +
    dimensions.verificationSpeed;
  const riskPenalty = (dimensions.executionRisk + dimensions.dilutionRisk + dimensions.substitutionRisk) / 3;
  const evidenceBonus = Math.min(8, Math.log10((stats.postCount || 0) + 1) * 4 + Math.log10((stats.engagement || 0) + 1) * 2);
  const raw = (positive / 30) * 96 + evidenceBonus - riskPenalty * 1.5;
  return Math.round(Math.max(20, Math.min(96, raw)));
}

function getSerenityCardStats(card, records) {
  const tickerSet = new Set((card.tickers || []).map(normalizeTickerSymbol).filter(Boolean));
  const keywordSet = new Set(
    uniqueStrings([
      card.primaryTicker,
      ...(card.tickers || []),
      ...(card.tickers || []).map((ticker) => `$${ticker}`),
      ...(card.keywords || []),
    ])
      .map((keyword) => cleanText(keyword).toLowerCase())
      .filter(Boolean)
  );

  const matched = records.filter((record) => {
    const recordSymbols = new Set((record.symbols || []).map(normalizeTickerSymbol).filter(Boolean));
    if ([...tickerSet].some((ticker) => recordSymbols.has(ticker))) return true;
    const text = getSerenityRecordText(record).toLowerCase();
    return [...keywordSet].some((keyword) => keyword.length >= 3 && text.includes(keyword));
  });

  const dates = matched.map((record) => cleanText(record.date || record.createdAtUtc || '')).filter(Boolean).sort();
  const engagement = matched.reduce((sum, record) => sum + getSerenityEngagement(record), 0);
  const topEvidence = matched
    .slice()
    .sort((a, b) => {
      const engagementDelta = getSerenityEngagement(b) - getSerenityEngagement(a);
      if (engagementDelta) return engagementDelta;
      return cleanText(b.date || '').localeCompare(cleanText(a.date || ''));
    })
    .slice(0, 6)
    .map((record) => serenityEvidenceFromRecord(record));

  return {
    postCount: matched.length,
    engagement,
    firstSeen: dates[0] || '',
    lastSeen: dates[dates.length - 1] || '',
    topEvidence,
  };
}

function serenityEvidenceFromRecord(record) {
  const text = getSerenityRecordText(record);
  return {
    id: cleanText(record.id || record.url || crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)),
    date: cleanText(record.date || record.createdAtUtc || ''),
    url: cleanText(record.url || ''),
    kind: cleanText(record.kind || 'post'),
    tickers: record.symbols || [],
    engagement: getSerenityEngagement(record),
    text: truncate(text, 420),
  };
}

function getSerenityRecordText(record) {
  return cleanText(record?.textZh || record?.text || record?.textPreview || '');
}

function getSerenityRecordTickers(record) {
  const fromSymbols = Array.isArray(record?.symbols) ? record.symbols : [];
  const explicit = cleanText(`${record?.text || ''} ${record?.textZh || ''}`).match(/\$[A-Z][A-Z0-9.]{1,7}\b/g) || [];
  return uniqueStrings([...fromSymbols, ...explicit].map(normalizeTickerSymbol)).slice(0, 16);
}

function getSerenityEngagement(record) {
  const direct = Number(record?.engagement);
  if (Number.isFinite(direct)) return Math.max(0, Math.round(direct));
  return (
    clampNumber(record?.favoriteCount, 0, 9999999, 0) +
    clampNumber(record?.replyCount, 0, 9999999, 0) +
    clampNumber(record?.retweetCount, 0, 9999999, 0) +
    clampNumber(record?.quoteCount, 0, 9999999, 0)
  );
}

function normalizeTickerSymbol(value) {
  return cleanText(value).replace(/^\$/g, '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
}

function normalizeSerenityCustomCard(input) {
  const tickers = uniqueStrings(normalizeStringArray(input.tickers).map(normalizeTickerSymbol)).slice(0, 12);
  const primaryTicker = normalizeTickerSymbol(input.primaryTicker || tickers[0] || '');
  const title = truncate(cleanText(input.title || `${primaryTicker || '新候选'}：Serenity 方法候选卡`), 180);
  const demandSource = truncate(cleanText(input.demandSource || ''), 420);
  const chokepoint = truncate(cleanText(input.chokepoint || ''), 420);
  if (!title || !demandSource || !chokepoint) throw new Error('title, demandSource and chokepoint are required');

  const now = new Date().toISOString();
  const id = cleanText(input.id || `serenity-custom:${crypto.createHash('sha1').update(`${title}:${primaryTicker}:${demandSource}:${now}`).digest('hex').slice(0, 16)}`);
  return {
    id,
    source: 'custom',
    title,
    primaryTicker,
    tickers: uniqueStrings([primaryTicker, ...tickers].filter(Boolean)).slice(0, 12),
    focusArea: truncate(cleanText(input.focusArea || '待归类'), 60),
    layer: truncate(cleanText(input.layer || '待定义层级'), 80),
    status: truncate(cleanText(input.status || 'watch'), 40),
    demandSource,
    chain: normalizeStringArray(input.chain).slice(0, 8),
    chokepoint,
    businessCarrier: truncate(cleanText(input.businessCarrier || ''), 420),
    financialTranslation: truncate(cleanText(input.financialTranslation || ''), 420),
    marketMisclassification: truncate(cleanText(input.marketMisclassification || ''), 420),
    validationSignals: normalizeStringArray(input.validationSignals).slice(0, 8),
    falsifiers: normalizeStringArray(input.falsifiers).slice(0, 8),
    researchQuestions: normalizeStringArray(input.researchQuestions).slice(0, 8),
    keywords: normalizeStringArray(input.keywords).slice(0, 16),
    dimensions: normalizeSerenityDimensions(input.dimensions),
    createdAt: normalizeDate(input.createdAt) || now,
    updatedAt: now,
  };
}

function buildResearchQueueInputFromSerenityCard(card) {
  const tickers = uniqueStrings([card.primaryTicker, ...(card.tickers || [])].map(normalizeTickerSymbol)).slice(0, 12);
  const themes = uniqueStrings([card.focusArea, card.layer, 'Serenity 方法论']).slice(0, 10);
  const rawText = [
    `需求源：${card.demandSource}`,
    `依赖链：${(card.chain || []).join(' -> ')}`,
    `瓶颈：${card.chokepoint}`,
    `上市载体：${card.businessCarrier}`,
    `财务转译：${card.financialTranslation}`,
    `市场误分类：${card.marketMisclassification}`,
    `验证：${(card.validationSignals || []).join('；')}`,
    `反证：${(card.falsifiers || []).join('；')}`,
  ].filter(Boolean).join('\n');

  return {
    id: `rq:${crypto.createHash('sha1').update(`serenity:${card.id}`).digest('hex').slice(0, 16)}`,
    priority: card.score >= 82 ? 1 : card.score >= 70 ? 2 : 3,
    question: `${card.title} 是否满足 Serenity 的财务重写条件？`,
    tickers,
    themes,
    event: {
      id: `event:serenity:${card.id}`,
      source: {
        id: 'serenity-archive',
        name: 'Serenity / Aleabitoreddit Archive',
        type: 'community_alpha',
        trustTier: 'social_discovery',
      },
      title: card.title,
      summary: truncate(card.financialTranslation || card.chokepoint || card.demandSource || card.title, 300),
      rawText,
      url: card.evidence?.[0]?.url || 'https://serenity349.online/',
      tickers,
      themes,
      eventType: 'serenity_thesis',
      impact: {
        direction: 'unknown',
        timeHorizon: 'multi-quarter',
        affectedAreas: ['revenue', 'margin', 'valuation narrative', 'supply chain'],
      },
      evidence: (card.evidence || []).slice(0, 6).map((item) => ({
        type: 'serenity_archive_excerpt',
        text: item.text,
        timestamp: normalizeDate(item.date) || new Date().toISOString(),
        url: item.url,
      })),
      verification: {
        needsVerification: true,
        counterEvidence: card.falsifiers || [],
      },
      score: {
        importance: clampNumber((card.score || 60) / 100, 0.35, 0.95, 0.65),
        novelty: 0.78,
        confidence: 0.48,
      },
    },
  };
}

function inferResearchQuestion(event, input) {
  const text = cleanText(input.title || event?.title || event?.summary || '');
  const tickers = uniqueStrings([...(event?.tickers || []), ...normalizeStringArray(input.tickers)]);
  if (tickers.length && text) return `${tickers.slice(0, 4).join('/')}：${text} 对基本面、市场叙事和待验证数据的影响是什么？`;
  if (text) return `${text} 是否会改变市场叙事或需要进入后续跟踪？`;
  return '';
}

function buildResearchMemoSkeleton({ question, event, tickers, themes }) {
  const evidence = event?.evidence?.map((item) => item.text).filter(Boolean).slice(0, 3) || [];
  return {
    researchObject: tickers.length ? tickers.join(', ') : themes.slice(0, 3).join(', ') || '待定义对象',
    coreQuestion: question,
    currentView: '待研究；禁止直接输出买卖建议。',
    requiredEvidence: [
      '官方一手来源：SEC、公司 IR、财报材料、宏观发布。',
      '专业媒体或直播来源：用于发现市场叙事，但必须交叉验证。',
      '市场数据：价格、成交量、估值、财报日程和同业对比。',
    ],
    seedEvidence: evidence,
    counterEvidencePrompts: [
      '这个事件是否已经被价格提前反映？',
      '是否存在管理层、财报或宏观数据与当前叙事相反？',
      '如果我是反方，最强的反驳是什么？',
    ],
    falsificationChecks: [
      '哪些下一次财报、宏观数据或公司披露会推翻当前判断？',
      '哪些同业数据会证明这只是情绪，而不是基本面变化？',
    ],
    outputRules: [
      '区分事实、解释和市场叙事。',
      '保留证据链和来源链接。',
      '不输出买卖建议。',
    ],
  };
}

function extractTickers(text) {
  const lower = ` ${cleanText(text).toLowerCase()} `;
  const tickers = tickerRules
    .filter(([, keywords]) => keywords.some((keyword) => lower.includes(keyword.toLowerCase())))
    .map(([ticker]) => ticker);
  const explicit = Array.from(cleanText(text).matchAll(/\b[A-Z]{2,5}\b/g))
    .map(([ticker]) => ticker)
    .filter((ticker) => tickerRules.some(([known]) => known === ticker));
  return uniqueStrings([...tickers, ...explicit]);
}

function inferMarketThemes(text) {
  const lower = cleanText(text).toLowerCase();
  const rules = [
    ['AI infrastructure', ['gpu', 'nvidia', 'cuda', 'data center', '算力', '芯片', 'inference', '推理']],
    ['Hyperscaler capex', ['capex', 'capital expenditure', 'azure', 'aws', 'google cloud', 'data center']],
    ['AI models', ['model', 'llm', 'gemini', 'claude', 'openai', 'qwen', 'deepseek', '大模型', '模型']],
    ['Agent', ['agent', 'agentic', 'workflow', '智能体', '工作流']],
    ['Enterprise AI', ['enterprise', 'salesforce', 'palantir', 'oracle', '企业']],
    ['Macro', ['fed', 'inflation', 'cpi', 'jobs', 'rate cut', '利率', '通胀', '就业']],
    ['Crypto equities', ['bitcoin', 'ethereum', 'crypto', 'coinbase', '加密']],
    ['Earnings', ['earnings', 'guidance', 'revenue', 'margin', '财报', '指引', '营收', '利润率']],
    ['Regulation', ['regulation', 'lawsuit', 'copyright', '监管', '诉讼', '版权']],
  ];
  return rules.filter(([, keywords]) => includesAny(lower, keywords)).map(([theme]) => theme);
}

function inferEventType(text, fallbackCategory) {
  const lower = cleanText(text).toLowerCase();
  if (includesAny(lower, ['10-k', '10-q', '8-k', 's-1', 'sec filing'])) return 'filing';
  if (includesAny(lower, ['earnings', 'guidance', '财报', '指引'])) return 'earnings';
  if (includesAny(lower, ['fed', 'cpi', 'jobs report', 'inflation', 'rate cut', '利率', '通胀'])) return 'macro';
  if (includesAny(lower, ['launch', 'release', 'introducing', '发布', '上线'])) return 'product';
  if (includesAny(lower, ['funding', 'valuation', 'acquisition', '融资', '估值', '并购'])) return 'funding';
  if (includesAny(lower, ['regulation', 'lawsuit', 'copyright', '监管', '诉讼', '版权'])) return 'regulation';
  if (fallbackCategory === '投融资') return 'funding';
  if (fallbackCategory === '模型' || fallbackCategory === '应用' || fallbackCategory === '生态') return 'ai_frontier';
  return 'market_signal';
}

function inferImpactDirection(text) {
  const lower = cleanText(text).toLowerCase();
  if (includesAny(lower, ['beats', 'raises guidance', 'strong demand', 'surge', 'record revenue', '利好', '上修', '强劲'])) return 'positive';
  if (includesAny(lower, ['misses', 'cuts guidance', 'weak demand', 'lawsuit', 'probe', 'downgrade', '利空', '下修', '疲软'])) return 'negative';
  if (includesAny(lower, ['mixed', 'but', 'however', 'uncertain', '分歧', '但是'])) return 'mixed';
  return 'unknown';
}

function inferAffectedAreas(text, themes) {
  const lower = cleanText(text).toLowerCase();
  const areas = [];
  if (includesAny(lower, ['revenue', 'sales', '营收'])) areas.push('revenue');
  if (includesAny(lower, ['margin', 'gross margin', 'profit', '利润率', '毛利'])) areas.push('margin');
  if (includesAny(lower, ['capex', 'data center', '算力', '资本开支'])) areas.push('capex');
  if (includesAny(lower, ['competition', 'competitive', 'rival', '替代', '竞争'])) areas.push('competition');
  if (includesAny(lower, ['valuation', 'multiple', '估值'])) areas.push('valuation narrative');
  if (includesAny(lower, ['cost', 'pricing', 'price cut', '成本', '价格', '降价'])) areas.push('cost');
  if ((themes || []).some((theme) => ['AI infrastructure', 'AI models', 'Agent'].includes(theme))) areas.push('AI narrative');
  return areas.length ? areas : ['market narrative'];
}

function inferTimeHorizon(text) {
  const lower = cleanText(text).toLowerCase();
  if (includesAny(lower, ['today', 'intraday', 'pre-market', 'after hours', '盘前', '盘后', '日内'])) return 'intraday';
  if (includesAny(lower, ['this week', 'weekly', '本周'])) return 'days';
  if (includesAny(lower, ['quarter', 'earnings', 'guidance', '财报', '季度'])) return 'quarter';
  return 'multi-quarter';
}

function summarizeTranscriptTitle(transcript) {
  const sentence = cleanText(transcript).split(/[。.!?]/).find(Boolean) || transcript;
  return sentence ? `直播转录：${sentence}` : '直播转录事件';
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return cleanText(value || '')
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function topCounts(values, limit = 8) {
  return Object.entries(countBy(values.filter(Boolean), (item) => item))
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, limit);
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'source';
}

function buildBriefingInsights(payload, limit = 24) {
  const items = (payload.items || []).slice(0, limit);
  const health = payload.sourceHealth || { total: rssSources.length, ok: 0, failed: 0, failures: [] };
  const categoryMix = countBy(items, (item) => item.category || '其他');
  const focusAreas = Object.entries(categoryMix)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, 3)
    .map(([category]) => category);
  const topSignals = pickTopSignals(items);

  return {
    generatedAt: payload.generatedAt,
    headline: buildBriefingHeadline(items, focusAreas, health),
    sourceCoverage: `${health.ok || 0}/${health.total || 0} 正常${health.failed ? `，${health.failed} 个失败` : ''}`,
    categoryMix,
    focusAreas,
    topSignals,
    talkTracks: buildBriefingTalkTracks(items, focusAreas),
    customerAngles: buildBriefingCustomerAngles(items),
    riskFlags: buildBriefingRiskFlags(payload, items),
  };
}

function buildBriefingHeadline(items, focusAreas, health) {
  if (!items.length) {
    return '本轮 RSS 没有抓到可用 AI 资讯，建议稍后刷新或检查来源健康。';
  }

  const highImpactCount = items.filter((item) => item.impact === '高').length;
  const dominant = focusAreas[0] || 'AI 动态';
  const sourceNote = health.failed ? `；${health.failed} 个来源失败，需谨慎补看` : '';
  return `今日重点集中在${focusAreas.join('、') || dominant}，其中 ${highImpactCount} 条可优先转化为客户沟通材料${sourceNote}。`;
}

function pickTopSignals(items) {
  const preferred = items
    .map((item) => ({
      item,
      score: (item.impact === '高' ? 3 : 1) + (item.category === '模型' ? 1 : 0) + (item.tags || []).filter((tag) => ['Qwen', '通义', '百炼', 'Agent', 'AI Infra', '投融资'].includes(tag)).length,
    }))
    .sort((a, b) => b.score - a.score || new Date(b.item.publishedAt || 0).getTime() - new Date(a.item.publishedAt || 0).getTime())
    .map(({ item }) => item);

  return preferred.slice(0, 5).map((item) => ({
    title: truncate(item.title || 'Untitled', 90),
    source: item.source || '未知来源',
    category: item.category || '其他',
    impact: item.impact || '中',
    link: item.link || '',
    why: explainBriefingSignal(item),
  }));
}

function explainBriefingSignal(item) {
  const text = `${item.title} ${item.summary} ${(item.tags || []).join(' ')}`.toLowerCase();
  if (item.category === '投融资') return '反映资本、客户预算或生态方向变化，适合判断客户行业热度与竞品动向。';
  if (includesAny(text, ['qwen', '通义', '百炼'])) return '与通义/百炼相关，可直接沉淀为国产模型路线、迁移方案或客户答疑材料。';
  if (includesAny(text, ['agent', '智能体', 'workflow', '工作流'])) return '适合转化为智能体落地场景、流程改造和客户试点问题清单。';
  if (includesAny(text, ['inference', 'pricing', 'cost', 'gpu', 'cuda', '算力', '推理', '降价'])) return '与推理成本、算力供给或稳定性有关，适合用于方案 TCO 与交付可行性沟通。';
  if (item.category === '模型') return '模型能力变化需要同步关注效果、成本、限流和可替代路径。';
  if (item.category === '应用') return '应用案例可以沉淀为客户场景话术和行业样板。';
  return '可作为客户沟通时的趋势背景或竞品观察素材。';
}

function buildBriefingTalkTracks(items, focusAreas) {
  if (!items.length) return ['暂无可转述内容，建议刷新 RSS 后再生成客户沟通材料。'];

  const tracks = [];
  if (focusAreas.includes('模型')) tracks.push('模型发布不要只讲参数，优先问客户：效果是否可复现、推理成本是否可控、是否能接入现有权限与审计。');
  if (focusAreas.includes('应用')) tracks.push('应用类新闻可以转成场景问题：哪个流程最耗人、是否有知识库和系统接口、是否愿意先做小范围试点。');
  if (focusAreas.includes('投融资')) tracks.push('投融资动态适合判断预算方向和竞品压力，客户沟通时可落到行业趋势、ROI 和实施节奏。');
  if (focusAreas.includes('生态')) tracks.push('生态与开源动态要追问工程可用性：部署方式、限流、SLA、监控、数据边界和供应链风险。');

  if (items.some((item) => `${item.title} ${(item.tags || []).join(' ')}`.toLowerCase().includes('qwen') || (item.tags || []).includes('通义'))) {
    tracks.unshift('通义/Qwen 相关内容可直接对齐百炼能力栈，形成“原平台能力、百炼替代项、迁移风险”的三列表。');
  }

  return uniqueStrings(tracks).slice(0, 4);
}

function buildBriefingCustomerAngles(items) {
  if (!items.length) return ['先补齐真实资讯后，再生成客户沟通角度。'];

  const text = items.map((item) => `${item.title} ${item.summary} ${(item.tags || []).join(' ')}`).join(' ').toLowerCase();
  const angles = [];
  if (includesAny(text, ['qwen', '通义', '百炼'])) angles.push('国产模型路线：把 Qwen/百炼动态沉淀成客户可接受的替换、压测和上线检查清单。');
  if (includesAny(text, ['agent', '智能体', 'workflow', '工作流'])) angles.push('智能体落地：从单点能力转为流程闭环，重点确认权限、工具调用、人工审核和失败回退。');
  if (includesAny(text, ['inference', 'pricing', 'cost', 'gpu', 'cuda', '算力', '推理', '降价'])) angles.push('成本与性能：把推理成本、限流、响应时间和 SLA 作为方案评估主线。');
  if (includesAny(text, ['funding', 'valuation', '融资', '投资', '估值'])) angles.push('竞品与预算：投融资信息可用于判断客户关注度、采购窗口和竞品销售动作。');
  if (includesAny(text, ['security', 'privacy', 'compliance', '安全', '隐私', '合规'])) angles.push('安全合规：优先准备数据边界、日志审计、权限隔离和私有化/专有云选项。');

  return uniqueStrings(angles.length ? angles : ['趋势背景：把今日资讯拆成客户痛点、可落地场景和可验证指标，而不是只转述新闻。']).slice(0, 4);
}

function buildBriefingRiskFlags(payload, items) {
  const health = payload.sourceHealth || {};
  const flags = [];
  if (health.failed) flags.push(`${health.failed} 个 RSS 来源失败，本次简报可能缺少部分海外/国内动态。`);

  const text = items.map((item) => `${item.title} ${item.summary}`).join(' ').toLowerCase();
  if (includesAny(text, ['lawsuit', 'regulation', 'copyright', '安全', '隐私', '合规', '监管', '版权'])) {
    flags.push('出现安全、隐私、合规或版权相关信号，客户方案中需要提前准备风险回应。');
  }
  if (includesAny(text, ['preview', 'beta', 'limited', 'waitlist', '预览', '内测', '限量'])) {
    flags.push('部分能力可能处于预览或限量阶段，客户承诺前需确认区域、额度和 SLA。');
  }
  if (!items.some((item) => item.region === '国内')) {
    flags.push('本轮缺少国内来源，涉及中国客户时建议补看通义、量子位、InfoQ、36氪等来源。');
  }

  return flags.length ? flags.slice(0, 4) : ['暂未发现明显风险信号，但客户沟通前仍需核对原文、发布时间和可用区域。'];
}

async function sendDingTalkBriefing({ limit, forceRefresh }) {
  const payload = await getBriefing({ forceRefresh });
  const message = formatDingTalkBriefing(payload, limit);
  const dingtalk = await postDingTalkMarkdown(message);

  return {
    ok: true,
    pushedAt: new Date().toISOString(),
    generatedAt: payload.generatedAt,
    items: message.itemCount,
    sourceHealth: payload.sourceHealth,
    dingtalk,
  };
}

function formatBriefingMarkdown(payload, limit) {
  const items = payload.items.slice(0, limit);
  const health = payload.sourceHealth || { total: 0, ok: 0, failed: 0, failures: [] };
  const insights = payload.insights || buildBriefingInsights({ ...payload, items }, limit);
  const lines = [
    '# PDSA AI 每日简报',
    '',
    `- 生成时间：${formatDateTime(payload.generatedAt)}`,
    `- 来源状态：${health.ok}/${health.total} 正常${health.failed ? `，${health.failed} 个失败` : ''}`,
    `- 条目数量：${items.length}`,
    '',
  ];

  lines.push('## PDSA 结论', '');
  lines.push(`- 今日判断：${insights.headline}`);
  lines.push(`- 来源覆盖：${insights.sourceCoverage}`);
  lines.push(`- 重点方向：${insights.focusAreas.join('、') || '暂无'}`);
  lines.push('');

  if (insights.topSignals.length) {
    lines.push('### 重点信号', '');
    insights.topSignals.forEach((signal) => {
      lines.push(`- ${signal.title}`);
      lines.push(`  - 价值：${signal.why}`);
      lines.push(`  - 来源：${signal.source} / ${signal.category} / ${signal.impact}`);
    });
    lines.push('');
  }

  lines.push('### 前线话术', '');
  insights.talkTracks.forEach((item) => lines.push(`- ${item}`));
  lines.push('', '### 客户沟通角度', '');
  insights.customerAngles.forEach((item) => lines.push(`- ${item}`));
  lines.push('', '### 风险提醒', '');
  insights.riskFlags.forEach((item) => lines.push(`- ${item}`));
  lines.push('');

  if (health.failures?.length) {
    lines.push('## 失败来源', '');
    health.failures.forEach((failure) => {
      lines.push(`- ${failure.name}：${failure.reason}`);
    });
    lines.push('');
  }

  const grouped = items.reduce((acc, item) => {
    const category = item.category || '其他';
    acc[category] = acc[category] || [];
    acc[category].push(item);
    return acc;
  }, {});

  Object.entries(grouped).forEach(([category, categoryItems]) => {
    lines.push(`## ${category}`, '');
    categoryItems.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.link ? `[${item.title}](${item.link})` : item.title}`);
      lines.push(`   - 摘要：${item.summary}`);
      lines.push(`   - 来源：${item.source} / ${item.region || '未知'} / 影响：${item.impact || '中'}`);
      lines.push(`   - 标签：${(item.tags || []).join('、') || '无'}`);
      lines.push('');
    });
  });

  return lines.join('\n');
}

function formatDingTalkBriefing(payload, limit) {
  const items = payload.items.slice(0, limit);
  const generatedAt = formatDateTime(payload.generatedAt);
  const health = payload.sourceHealth || { total: 0, ok: 0, failed: 0 };
  const insights = buildBriefingInsights({ ...payload, items }, limit);
  const lines = [
    `### PDSA AI 每日简报`,
    '',
    `> 生成时间：${generatedAt}`,
    '',
    `> 来源状态：${health.ok}/${health.total} 正常${health.failed ? `，${health.failed} 个失败` : ''}`,
    '',
    `**今日判断**：${insights.headline}`,
    '',
  ];

  if (insights.talkTracks.length) {
    lines.push('**前线话术**', '');
    insights.talkTracks.slice(0, 3).forEach((item) => {
      lines.push(`- ${item}`);
    });
    lines.push('');
  }

  if (!items.length) {
    lines.push('暂无匹配的 AI 资讯，请稍后重试或检查 RSS 源。');
  } else {
    items.forEach((item, index) => {
      const title = truncate(item.title || 'Untitled', 80);
      const summary = truncate(item.summary || '建议打开原文查看完整内容。', 130);
      const source = [item.source, item.category, item.region].filter(Boolean).join(' / ');
      const tags = Array.isArray(item.tags) && item.tags.length ? ` #${item.tags.join(' #')}` : '';
      const link = item.link || item.sourceUrl || '';

      lines.push(`${index + 1}. **${link ? `[${title}](${link})` : title}**`);
      lines.push('');
      lines.push(`   ${summary}`);
      lines.push('');
      lines.push(`   来源：${source}；影响：${item.impact || '中'}${tags}`);
      lines.push('');
    });
  }

  lines.push('打开工作台：http://47.84.58.79:3002/about-ai');

  return {
    title: `PDSA AI 每日简报 ${generatedAt}`,
    text: lines.join('\n'),
    itemCount: items.length,
  };
}

async function postDingTalkMarkdown(message) {
  const webhook = process.env.DINGTALK_WEBHOOK;
  if (!webhook) {
    const error = new Error('DINGTALK_WEBHOOK is not configured');
    error.code = 'DINGTALK_NOT_CONFIGURED';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DINGTALK_TIMEOUT_MS);

  try {
    const response = await fetch(buildDingTalkWebhookUrl(webhook), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          title: message.title,
          text: message.text,
        },
      }),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = { raw: bodyText };
    }

    if (!response.ok || body.errcode) {
      const error = new Error(body.errmsg || `DingTalk returned HTTP ${response.status}`);
      error.code = 'DINGTALK_PUSH_FAILED';
      error.response = body;
      throw error;
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function buildDingTalkWebhookUrl(webhook) {
  const secret = process.env.DINGTALK_SECRET;
  if (!secret) return webhook;

  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = crypto.createHmac('sha256', secret).update(stringToSign).digest('base64');
  const url = new URL(webhook);
  url.searchParams.set('timestamp', `${timestamp}`);
  url.searchParams.set('sign', sign);
  return url.toString();
}

function isAuthorizedPushRequest(req) {
  const expectedToken = process.env.PUSH_TRIGGER_TOKEN;
  if (!expectedToken) return true;

  const providedToken = req.get('x-push-token') || req.query.token || req.body?.token || '';
  return timingSafeEqual(providedToken, expectedToken);
}

function timingSafeEqual(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

function requireBasicAuth(req, res, next) {
  const username = SERVER_NETWORK.auth?.username;
  const password = SERVER_NETWORK.auth?.password;

  if (!username || !password) {
    next();
    return;
  }

  const header = req.get('authorization') || '';
  const [type, encoded] = header.split(' ');
  if (type !== 'Basic' || !encoded) {
    requestBasicAuth(res);
    return;
  }

  let decoded = '';
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    requestBasicAuth(res);
    return;
  }

  const separator = decoded.indexOf(':');
  const providedUsername = separator >= 0 ? decoded.slice(0, separator) : '';
  const providedPassword = separator >= 0 ? decoded.slice(separator + 1) : '';

  if (timingSafeEqual(providedUsername, username) && timingSafeEqual(providedPassword, password)) {
    next();
    return;
  }

  requestBasicAuth(res);
}

function requestBasicAuth(res) {
  res.setHeader('WWW-Authenticate', 'Basic realm="PDSA AI Workbench", charset="UTF-8"');
  res.status(401).send('Authentication required');
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.warn(`Failed to read ${filePath}: ${error.message}`);
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  ensurePrivateDirectory(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(tmpPath, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.fchmodSync(descriptor, 0o600);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(tmpPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    try { fs.unlinkSync(tmpPath); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') throw cleanupError; }
    throw error;
  }
}

function ensurePrivateDirectory(directory) {
  const resolved = path.resolve(directory);
  const existed = fs.existsSync(resolved);
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error(`Data path is not a directory: ${resolved}`);

  // Only the repository's default data directory is safe to repair in place.
  // A configurable DATA_DIR may be a shared parent such as /tmp, which must
  // never be chmodded by this process.
  const defaultDataDirectory = path.resolve(rootDir, 'data');
  const managedByRepository = resolved === defaultDataDirectory;
  if (!existed || managedByRepository) fs.chmodSync(resolved, 0o700);
  if (!managedByRepository && existed && (fs.statSync(resolved).mode & 0o077) !== 0) {
    throw new Error(`DATA_DIR must be a dedicated owner-private directory (0700): ${resolved}`);
  }
}

function normalizeSubscription(input) {
  const mode = input.mode === '结构化' ? '结构化' : '一句话';
  const channels = Array.isArray(input.channels)
    ? input.channels.map(cleanText).filter(Boolean).slice(0, 5)
    : cleanText(input.channels || '')
      .split(/[,+，、]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 5);

  return {
    id: crypto.randomUUID(),
    name: truncate(cleanText(input.name || input.description || '新的个性化订阅'), 120),
    mode,
    topic: truncate(cleanText(input.topic || ''), 80),
    region: truncate(cleanText(input.region || ''), 80),
    keywords: truncate(cleanText(input.keywords || ''), 180),
    description: truncate(cleanText(input.description || ''), 260),
    cadence: truncate(cleanText(input.cadence || '每日 08:30'), 80),
    channels,
    createdAt: new Date().toISOString(),
  };
}

function findVocProject(id) {
  const projects = readJsonFile(VOC_PROJECTS_FILE, []);
  return projects.find((project) => project.id === id);
}

async function createVocProject(input) {
  const rawText = normalizeMultilineText(input.rawText || input.text || '');
  const selectedSources = Array.isArray(input.selectedSources)
    ? input.selectedSources.map(cleanText).filter(Boolean)
    : [];
  const product = truncate(cleanText(input.product || '客户产品 VOC 分析'), 120);
  const now = new Date().toISOString();
  const fallbackAnalysis = analyzeVocText(rawText, selectedSources, product);
  const analysis = await analyzeVocTextWithLlm({
    product,
    rawText,
    selectedSources: fallbackAnalysis.selectedSources,
    fallbackAnalysis,
  });

  return {
    id: crypto.randomUUID(),
    product,
    rawText,
    selectedSources: analysis.selectedSources,
    analysis,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeMultilineText(value) {
  return toText(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => cleanText(line))
    .filter(Boolean)
    .join('\n')
    .slice(0, 20000);
}

function analyzeVocText(rawText, selectedSources = [], product = '客户产品') {
  const posts = parseVocPosts(rawText);
  const selected = selectedSources.length ? selectedSources : Array.from(new Set(posts.map((post) => post.source)));
  const visiblePosts = posts.filter((post) => selected.includes(post.source));
  const sentimentSummary = summarizeVocSentiment(visiblePosts);
  const topThemes = getTopVocThemes(visiblePosts);
  const dimensions = buildVocDimensions(visiblePosts);

  return {
    posts: visiblePosts,
    allPosts: posts,
    selectedSources: selected,
    sourceOptions: Array.from(new Set([...selected, ...posts.map((post) => post.source), ...VOC_SOURCE_OPTIONS])),
    sentimentSummary,
    topThemes,
    dimensions,
    communicationPack: buildVocCommunicationPack(visiblePosts, dimensions, product),
    analysisMethod: 'rules',
    model: '',
    generatedAt: new Date().toISOString(),
  };
}

async function analyzeVocTextWithLlm({ product, rawText, selectedSources, fallbackAnalysis }) {
  if (!LLM_API_KEY) return fallbackAnalysis;

  try {
    const parsed = await callLlmJson({
      system: [
        '你是面向 PDSA（解决方案架构师）的客户产品 VOC 分析助手。',
        '只基于用户提供的评论样本进行判断，不要编造样本或来源。',
        '输出必须是严格 JSON，不要输出 Markdown。',
      ].join('\n'),
      user: JSON.stringify(
        {
          task: '分析客户产品 VOC，面向前线输出可行动洞察。',
          product,
          selectedSources,
          expectedSchema: {
            posts: [
              {
                source: '原始来源',
                persona: '用户画像',
                text: '用户原声',
                sentiment: '正向/中性/负向',
                theme: '稳定性/效果质量/上手体验/价格成本/团队协作/数据合规/工作流等',
              },
            ],
            sentimentSummary: { positive: 0, neutral: 0, negative: 0 },
            topThemes: [{ theme: '主题', count: 1 }],
            communicationPack: {
              headline: '一句总判断，说明客户最应该关注什么',
              painPoints: ['面向客户的痛点切入，必须来自样本'],
              talkTracks: ['PDSA 可以直接复述给客户的一句话'],
              objectionHandling: ['客户可能提出的异议及回应'],
              nextActions: ['下一步验证或推进动作'],
              evidenceToCollect: ['还需要补充的证据或材料'],
            },
            dimensions: [
              ['核心价值', '一句可用于客户沟通的结论'],
              ['主要痛点', '一句可用于产品/售前动作的结论'],
              ['高频场景', '一句说明用户在什么场景使用或评价'],
              ['购买阻碍', '一句说明成交或扩展风险'],
              ['机会动作', '一句说明前线下一步动作'],
            ],
          },
          fallbackParsedPosts: fallbackAnalysis.posts,
          rawText,
        },
        null,
        2
      ),
    });

    return normalizeLlmVocAnalysis(parsed, fallbackAnalysis);
  } catch (error) {
    console.warn(`LLM VOC analysis failed, falling back to rules: ${error.message}`);
    return {
      ...fallbackAnalysis,
      analysisMethod: 'rules',
      analysisWarning: '大模型分析未成功，已使用本地规则分析。',
      llmError: truncate(error.message, 180),
    };
  }
}

async function callLlmJson({ system, user }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = { raw: bodyText };
    }

    if (!response.ok) {
      throw new Error(body.error?.message || body.message || `LLM returned HTTP ${response.status}`);
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM returned an empty response');
    return extractJsonObject(content);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeLlmVocAnalysis(parsed, fallbackAnalysis) {
  const fallbackPosts = fallbackAnalysis.posts || [];
  const posts = normalizeLlmVocPosts(parsed.posts, fallbackPosts);
  const sentimentSummary = normalizeSentimentSummary(parsed.sentimentSummary) || summarizeVocSentiment(posts);
  const topThemes = normalizeTopThemes(parsed.topThemes, posts);
  const dimensions = normalizeDimensions(parsed.dimensions, posts);
  const communicationPack = normalizeCommunicationPack(parsed.communicationPack, posts, dimensions, fallbackAnalysis.communicationPack);

  return {
    ...fallbackAnalysis,
    posts,
    sentimentSummary,
    topThemes,
    dimensions,
    communicationPack,
    analysisMethod: 'llm',
    model: LLM_MODEL,
    modelProvider: inferLlmProvider(LLM_BASE_URL),
    generatedAt: new Date().toISOString(),
  };
}

function normalizeLlmVocPosts(input, fallbackPosts) {
  if (!Array.isArray(input) || !input.length) return fallbackPosts;

  const posts = input
    .map((post, index) => {
      const source = truncate(cleanText(post.source || fallbackPosts[index]?.source || '未知来源'), 40);
      const persona = truncate(cleanText(post.persona || fallbackPosts[index]?.persona || '未知用户'), 60);
      const text = truncate(cleanText(post.text || fallbackPosts[index]?.text || ''), 600);
      if (!text) return null;

      return {
        id: cleanText(post.id || '') || crypto.createHash('sha1').update(`${source}:${persona}:${text}`).digest('hex').slice(0, 12),
        source,
        persona,
        text,
        sentiment: normalizeSentiment(post.sentiment || fallbackPosts[index]?.sentiment),
        theme: truncate(cleanText(post.theme || fallbackPosts[index]?.theme || inferVocTheme(text)), 40),
      };
    })
    .filter(Boolean);

  return posts.length ? posts : fallbackPosts;
}

function normalizeSentiment(value) {
  const text = cleanText(value);
  if (text.includes('负')) return '负向';
  if (text.includes('正')) return '正向';
  return '中性';
}

function normalizeSentimentSummary(value) {
  if (!value || typeof value !== 'object') return null;
  const positive = clampNumber(value.positive, 0, 100, 0);
  const neutral = clampNumber(value.neutral, 0, 100, 0);
  const negative = clampNumber(value.negative, 0, 100, 0);
  const total = positive + neutral + negative;
  if (!total) return null;
  return {
    positive: Math.round((positive / total) * 100),
    neutral: Math.round((neutral / total) * 100),
    negative: Math.round((negative / total) * 100),
  };
}

function normalizeTopThemes(value, posts) {
  if (!Array.isArray(value) || !value.length) return getTopVocThemes(posts);

  const themes = value
    .map((item) => ({
      theme: truncate(cleanText(item.theme || item.name || ''), 40),
      count: clampNumber(item.count, 1, 999, 1),
    }))
    .filter((item) => item.theme)
    .slice(0, 6);

  return themes.length ? themes : getTopVocThemes(posts);
}

function normalizeDimensions(value, posts) {
  if (!Array.isArray(value)) return buildVocDimensions(posts);
  const dimensions = value
    .map((row) => {
      if (Array.isArray(row)) return [truncate(cleanText(row[0] || ''), 24), truncate(cleanText(row[1] || ''), 260)];
      if (row && typeof row === 'object') return [truncate(cleanText(row.name || row.dimension || ''), 24), truncate(cleanText(row.value || row.insight || ''), 260)];
      return null;
    })
    .filter((row) => row && row[0] && row[1])
    .slice(0, 8);

  return dimensions.length >= 4 ? dimensions : buildVocDimensions(posts);
}

function normalizeCommunicationPack(value, posts, dimensions, fallbackPack) {
  if (!value || typeof value !== 'object') return fallbackPack || buildVocCommunicationPack(posts, dimensions);

  const pack = {
    headline: truncate(cleanText(value.headline || fallbackPack?.headline || ''), 180),
    painPoints: normalizeStringList(value.painPoints || value.pains, 4),
    talkTracks: normalizeStringList(value.talkTracks || value.talkTrack || value.salesTalkTracks, 4),
    objectionHandling: normalizeStringList(value.objectionHandling || value.objections || value.riskResponses, 4),
    nextActions: normalizeStringList(value.nextActions || value.actions, 4),
    evidenceToCollect: normalizeStringList(value.evidenceToCollect || value.evidence || value.followUps, 4),
  };

  const fallback = fallbackPack || buildVocCommunicationPack(posts, dimensions);
  return {
    headline: pack.headline || fallback.headline,
    painPoints: pack.painPoints.length ? pack.painPoints : fallback.painPoints,
    talkTracks: pack.talkTracks.length ? pack.talkTracks : fallback.talkTracks,
    objectionHandling: pack.objectionHandling.length ? pack.objectionHandling : fallback.objectionHandling,
    nextActions: pack.nextActions.length ? pack.nextActions : fallback.nextActions,
    evidenceToCollect: pack.evidenceToCollect.length ? pack.evidenceToCollect : fallback.evidenceToCollect,
  };
}

function normalizeStringList(value, limit = 4) {
  const rawItems = Array.isArray(value) ? value : [value];
  return rawItems
    .map((item) => {
      if (item && typeof item === 'object') return cleanText(item.value || item.text || item.title || item.insight || '');
      return cleanText(item || '');
    })
    .filter(Boolean)
    .map((item) => truncate(item, 220))
    .slice(0, limit);
}

function extractJsonObject(value) {
  const text = cleanText(value).replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('LLM response is not valid JSON');
  }
}

function inferLlmProvider(baseUrl) {
  if (baseUrl.includes('dashscope')) return 'DashScope compatible';
  if (baseUrl.includes('openai')) return 'OpenAI compatible';
  return 'OpenAI-compatible endpoint';
}

const VOC_SOURCE_OPTIONS = ['小红书', 'X/Twitter', '即刻', '微信公众号', 'App Store', '客户访谈'];

const FALLBACK_VOC_POSTS = [
  '小红书｜中小商家运营｜活动海报和商品文案能一起出，减少了重复沟通。',
  'X/Twitter｜开发者｜批量调用时偶发超时，错误信息不够明确。',
  '即刻｜产品经理｜单点能力不错，但团队协作和权限配置还需要更完整。',
  '微信公众号｜企业 IT｜合规材料比较完整，适合拿去做内部评审。',
];

function parseVocPosts(rawText) {
  const rows = (rawText || FALLBACK_VOC_POSTS.join('\n'))
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return rows.map((line, index) => {
    const parts = line.split(/[｜|]/).map((part) => part.trim()).filter(Boolean);
    const source = parts.length >= 3 ? parts[0] : inferVocSource(line, index);
    const persona = parts.length >= 3 ? parts[1] : '未知用户';
    const text = parts.length >= 3 ? parts.slice(2).join('｜') : line;
    return {
      id: crypto.createHash('sha1').update(`${source}:${persona}:${text}`).digest('hex').slice(0, 12),
      source,
      persona,
      text,
      theme: inferVocTheme(text),
      sentiment: inferVocSentiment(text),
    };
  });
}

function inferVocSource(text, index) {
  return VOC_SOURCE_OPTIONS.find((source) => text.includes(source)) || VOC_SOURCE_OPTIONS[index % VOC_SOURCE_OPTIONS.length];
}

function inferVocSentiment(text) {
  const lower = text.toLowerCase();
  const negative = ['不好', '差', '慢', '卡', '贵', '超时', '失败', '报错', '崩', '复杂', '不稳定', '不明确', '不清晰', '不够清晰', '麻烦', '问题', '担心'];
  const positive = ['好', '快', '省', '准确', '方便', '完整', '清晰', '稳定', '喜欢', '提升', '减少', '适合', '不错'];
  const hasNegative = negative.some((word) => lower.includes(word));
  const hasPositive = positive.some((word) => lower.includes(word));
  const hasNegatedPositive = positive.some((word) => lower.includes(`不${word}`) || lower.includes(`不够${word}`));
  if (hasNegative && hasPositive) return hasNegatedPositive ? '负向' : '中性';
  if (hasNegative && !hasPositive) return '负向';
  if (hasPositive && !hasNegative) return '正向';
  return hasPositive ? '正向' : '中性';
}

function inferVocTheme(text) {
  const themeRules = [
    ['稳定性', ['慢', '卡', '超时', '失败', '报错', '崩', '延迟', '不稳定']],
    ['效果质量', ['效果', '准确', '识别', '回答', '质量', '生成', '召回', '幻觉']],
    ['上手体验', ['上手', '方便', '简单', '流程', '配置', '易用', '门槛']],
    ['价格成本', ['贵', '价格', '收费', '成本', '续费', '便宜']],
    ['团队协作', ['权限', '协作', '团队', '审批', '共享', '账号']],
    ['数据合规', ['隐私', '安全', '合规', '数据', '私有化', '审计']],
  ];
  const match = themeRules.find(([, keywords]) => keywords.some((keyword) => text.includes(keyword)));
  return match ? match[0] : '工作流';
}

function summarizeVocSentiment(posts) {
  const total = posts.length || 1;
  const counts = posts.reduce(
    (acc, post) => {
      if (post.sentiment === '正向') acc.positive += 1;
      else if (post.sentiment === '负向') acc.negative += 1;
      else acc.neutral += 1;
      return acc;
    },
    { positive: 0, neutral: 0, negative: 0 }
  );
  return {
    positive: Math.round((counts.positive / total) * 100),
    neutral: Math.round((counts.neutral / total) * 100),
    negative: Math.round((counts.negative / total) * 100),
  };
}

function getTopVocThemes(posts) {
  const counts = posts.reduce((acc, post) => {
    acc[post.theme] = (acc[post.theme] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([theme, count]) => ({ theme, count }))
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme, 'zh-CN'));
}

function buildVocDimensions(posts) {
  if (!posts.length) {
    return [
      ['核心价值', '暂无足够样本判断核心价值。'],
      ['主要痛点', '暂无足够样本判断主要痛点。'],
      ['高频场景', '请先补充用户评论或访谈纪要。'],
      ['购买阻碍', '暂无足够样本判断购买阻碍。'],
      ['机会动作', '补充真实样本后再生成可用于前线沟通的结论。'],
    ];
  }

  const positiveThemes = getTopVocThemes(posts.filter((post) => post.sentiment === '正向')).map((item) => item.theme);
  const negativeThemes = getTopVocThemes(posts.filter((post) => post.sentiment === '负向')).map((item) => item.theme);
  const allThemes = getTopVocThemes(posts).map((item) => item.theme);
  const topSources = Array.from(new Set(posts.map((post) => post.source))).slice(0, 4).join('、');

  return [
    ['核心价值', positiveThemes.length ? `${positiveThemes.slice(0, 3).join('、')}被用户正向提及，可作为客户沟通切入点。` : '当前样本正向信号较少，需要补充更多有效评论。'],
    ['主要痛点', negativeThemes.length ? `${negativeThemes.slice(0, 3).join('、')}是当前优先处理的问题。` : '当前样本未出现明显负向集中点。'],
    ['高频场景', allThemes.length ? `${allThemes.slice(0, 4).join('、')}是评论中最常出现的使用语境。` : '暂无足够样本判断高频场景。'],
    ['购买阻碍', posts.some((post) => ['价格成本', '数据合规', '稳定性'].includes(post.theme)) ? '价格、合规或稳定性相关反馈需要在方案材料中提前回应。' : '购买阻碍暂不明显，可以继续扩大样本验证。'],
    ['机会动作', `${topSources || '已选渠道'}样本可继续扩充；下一步建议沉淀真实原声、竞品对照和销售话术。`],
  ];
}

function buildVocCommunicationPack(posts, dimensions = buildVocDimensions(posts), product = '客户产品') {
  if (!posts.length) {
    return {
      headline: `当前样本不足，暂不建议对 ${product} 做客户判断。`,
      painPoints: ['先补充真实用户评论、访谈纪要或销售反馈。'],
      talkTracks: ['我们先补齐真实原声，再把反馈拆成痛点、价值和下一步验证。'],
      objectionHandling: ['样本不足时不要过早承诺结论，先说明需要扩大样本。'],
      nextActions: ['补充不少于 10 条真实评论，并标注来源、用户画像和场景。'],
      evidenceToCollect: ['评论原文、客户行业、使用场景、竞品名称、成交阶段。'],
    };
  }

  const positiveThemes = getTopVocThemes(posts.filter((post) => post.sentiment === '正向')).map((item) => item.theme);
  const negativeThemes = getTopVocThemes(posts.filter((post) => post.sentiment === '负向')).map((item) => item.theme);
  const allThemes = getTopVocThemes(posts).map((item) => item.theme);
  const topTheme = allThemes[0] || '工作流';
  const firstPain = negativeThemes[0] || allThemes.find((theme) => ['稳定性', '价格成本', '数据合规', '团队协作'].includes(theme)) || topTheme;
  const firstValue = positiveThemes[0] || topTheme;
  const negativeShare = summarizeVocSentiment(posts).negative;
  const sourceNames = Array.from(new Set(posts.map((post) => post.source))).slice(0, 3).join('、');

  return {
    headline: `${product} 的当前 VOC 重点在 ${topTheme}；负向占比 ${negativeShare}%，客户沟通应先回应 ${firstPain}，再放大 ${firstValue} 价值。`,
    painPoints: [
      `${firstPain} 是优先切入点，适合先问客户是否在真实流程中遇到同类阻塞。`,
      negativeThemes.length ? `${negativeThemes.slice(0, 3).join('、')}需要进入售前风险清单。` : '当前负向集中度不高，但仍需扩大样本验证稳定性、成本和合规风险。',
    ],
    talkTracks: [
      `我们先不从功能清单讲起，先看 ${product} 在 ${topTheme} 上的用户反馈，再决定试点场景。`,
      `如果客户担心 ${firstPain}，建议用小范围真实数据压测来验证，而不是只看演示效果。`,
      positiveThemes.length ? `${positiveThemes.slice(0, 2).join('、')}可以作为价值开场，但后续要补 ROI 和上线条件。` : '当前正向样本不足，客户沟通应以问题诊断和试点验证为主。',
    ],
    objectionHandling: [
      posts.some((post) => post.theme === '稳定性') ? '稳定性异议：用错误日志、并发压测和失败回退机制回应。' : '效果异议：用客户真实样本做 A/B 验证，避免只引用通用 benchmark。',
      posts.some((post) => post.theme === '数据合规') ? '合规异议：提前准备数据边界、审计日志和权限隔离说明。' : '合规异议：即使样本未集中提到，也要准备数据边界和权限说明。',
      posts.some((post) => post.theme === '价格成本') ? '成本异议：把单次调用成本、人工节省和上线维护成本放在同一张表里。' : '成本异议：用试点流程节省的人时和响应速度提升来证明 ROI。',
    ],
    nextActions: [
      `从 ${sourceNames || '已选渠道'} 继续补充样本，按行业、角色和场景重新分层。`,
      `围绕 ${firstPain} 设计一个客户验证问题清单，并沉淀可复用答疑。`,
      `把 ${firstValue} 对应的正向原声整理成 2-3 条客户可引用案例。`,
    ],
    evidenceToCollect: [
      '客户真实流程截图或日志',
      '竞品同场景反馈',
      '上线前后耗时、成本、满意度指标',
    ],
  };
}

function formatVocProjectMarkdown(project) {
  const analysis = project.analysis || {};
  const sentiment = analysis.sentimentSummary || { positive: 0, neutral: 0, negative: 0 };
  const lines = [
    `# ${project.product} VOC 洞察`,
    '',
    `- 创建时间：${formatDateTime(project.createdAt)}`,
    `- 分析方式：${analysis.analysisMethod === 'llm' ? `大模型分析（${analysis.model || '未标明模型'}）` : '规则分析'}`,
    `- 样本数：${analysis.posts?.length || 0}`,
    `- 情绪分布：正向 ${sentiment.positive}% / 中性 ${sentiment.neutral}% / 负向 ${sentiment.negative}%`,
    '',
    '## 高频主题',
    '',
  ];

  (analysis.topThemes || []).forEach((item) => {
    lines.push(`- ${item.theme}：${item.count} 条`);
  });

  const pack = analysis.communicationPack || buildVocCommunicationPack(analysis.posts || [], analysis.dimensions || [], project.product);
  lines.push('', '## PDSA 客户沟通包', '');
  lines.push(`- 客户判断：${pack.headline}`);
  lines.push('', '### 痛点切入', '');
  (pack.painPoints || []).forEach((item) => lines.push(`- ${item}`));
  lines.push('', '### 推荐话术', '');
  (pack.talkTracks || []).forEach((item) => lines.push(`- ${item}`));
  lines.push('', '### 异议回应', '');
  (pack.objectionHandling || []).forEach((item) => lines.push(`- ${item}`));
  lines.push('', '### 下一步动作', '');
  (pack.nextActions || []).forEach((item) => lines.push(`- ${item}`));
  lines.push('', '### 需要补充的证据', '');
  (pack.evidenceToCollect || []).forEach((item) => lines.push(`- ${item}`));

  lines.push('', '## 分析维度', '');
  (analysis.dimensions || []).forEach(([name, value]) => {
    lines.push(`- ${name}：${value}`);
  });

  lines.push('', '## 用户原声', '');
  (analysis.posts || []).forEach((post, index) => {
    lines.push(`${index + 1}. [${post.source} / ${post.persona} / ${post.sentiment} / ${post.theme}] ${post.text}`);
  });

  return lines.join('\n');
}

async function fetchSource(source) {
  const feed = await parser.parseURL(source.url);
  const items = (feed.items || [])
    .slice(0, MAX_ITEMS_PER_SOURCE * 3)
    .map((item) => normalizeItem(item, source))
    .filter((item) => source.alwaysInclude || isAiRelated(item))
    .slice(0, MAX_ITEMS_PER_SOURCE);

  return { source: source.id, items };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        results[currentIndex] = {
          status: 'fulfilled',
          value: await mapper(items[currentIndex], currentIndex),
        };
      } catch (reason) {
        results[currentIndex] = {
          status: 'rejected',
          reason,
        };
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

function normalizeItem(item, source) {
  const title = cleanText(item.title || 'Untitled');
  const link = cleanText(item.link);
  const guid = cleanText(item.guid);
  const rawSummary = item.contentSnippet || item.summary || item.content || item.description || '';
  const cleanedSummary = cleanText(stripHtml(rawSummary));
  const summary = isWeakSummary(cleanedSummary) ? '' : truncate(cleanedSummary, 120);
  const categories = normalizeCategories(item.categories);
  const textForClassification = `${title} ${summary} ${categories.join(' ')}`;
  const category = classifyCategory(textForClassification, source.category);
  const impact = classifyImpact(textForClassification, category);
  const publishedAt = normalizeDate(item.isoDate || item.pubDate || item.date);
  const sourceTags = source.tags || [];
  const itemTags = pickTags(textForClassification, sourceTags, category);

  return {
    id: `${source.id}:${guid || link || title}`,
    category,
    region: source.region,
    title,
    summary: summary || `${source.name} 更新：建议打开原文查看完整内容与上下文。`,
    impact,
    source: source.name,
    sourceUrl: source.url,
    link,
    publishedAt,
    tags: itemTags,
  };
}

function classifyCategory(text, fallback) {
  const lower = text.toLowerCase();
  if (includesAny(lower, ['funding', 'raises', 'valuation', 'acquisition', 'ipo', '融资', '投资', '估值', '并购', '上市'])) {
    return '投融资';
  }
  if (includesAny(lower, ['model', 'llm', 'gemini', 'qwen', 'deepseek', 'claude', 'openai', '多模态', '大模型', '模型', '推理'])) {
    return '模型';
  }
  if (includesAny(lower, ['agent', 'workflow', 'customer', 'product', 'application', '应用', '智能体', '工作流', '客服', '营销'])) {
    return '应用';
  }
  if (includesAny(lower, ['open source', 'developer', 'api', 'framework', 'infra', '生态', '开源', '开发者', '框架', '算力'])) {
    return '生态';
  }
  return fallback;
}

function classifyImpact(text, category) {
  const lower = text.toLowerCase();
  if (
    category === '投融资' ||
    includesAny(lower, ['launch', 'release', 'announces', 'introducing', 'available', 'pricing', 'api', '开源', '发布', '上线', '降价', '融资'])
  ) {
    return '高';
  }
  return '中';
}

function pickTags(text, sourceTags, category) {
  const tags = new Set([category, ...sourceTags.slice(0, 2)]);
  const tagRules = [
    ['Agent', ['agent', '智能体']],
    ['多模态', ['multimodal', 'vision', 'video', '多模态', '视觉']],
    ['推理', ['inference', 'reasoning', '推理']],
    ['开源', ['open source', '开源']],
    ['AI Infra', ['infra', 'infrastructure', '算力', '芯片', '网关']],
    ['投融资', ['funding', 'valuation', '融资', '投资', '估值']],
  ];
  const lower = text.toLowerCase();
  for (const [tag, keywords] of tagRules) {
    if (includesAny(lower, keywords)) tags.add(tag);
  }
  return Array.from(tags).slice(0, 4);
}

function isAiRelated(item) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  return aiKeywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = (item.link || item.title).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeCategories(categories) {
  if (!Array.isArray(categories)) return [];
  return categories.map((category) => cleanText(category)).filter(Boolean);
}

function isWeakSummary(value) {
  const text = value.replace(/\s+/g, '');
  if (text.length < 12) return true;
  return ['点击查看原文', '阅读全文', 'readmore', 'continue reading'].some((pattern) =>
    text.toLowerCase().includes(pattern)
  );
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(toText(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString('zh-CN', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toDateSlug(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toISOString().slice(0, 10);
}

function stripHtml(value) {
  return toText(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function cleanText(value) {
  return toText(value)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function toText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return `${value}`;
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    for (const key of ['#', '_', '$text', 'text', 'value', 'name']) {
      if (value[key] !== undefined) return toText(value[key]);
    }
    return Object.values(value).map(toText).filter(Boolean).join(' ');
  }
  return '';
}

function readEnvValue(name) {
  return cleanText(process.env[name] || '');
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function uniqueStrings(items) {
  return Array.from(new Set(items.map((item) => cleanText(item)).filter(Boolean)));
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
