import express from 'express';
import Parser from 'rss-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const PORT = Number(process.env.PORT || 3002);
const CACHE_TTL_MS = Number(process.env.RSS_CACHE_TTL_MS || 10 * 60 * 1000);
const MAX_ITEMS_PER_SOURCE = Number(process.env.RSS_ITEMS_PER_SOURCE || 8);
const RSS_FETCH_CONCURRENCY = Number(process.env.RSS_FETCH_CONCURRENCY || 6);
const DINGTALK_TIMEOUT_MS = Number(process.env.DINGTALK_TIMEOUT_MS || 10 * 1000);
const DINGTALK_BRIEFING_LIMIT = Number(process.env.DINGTALK_BRIEFING_LIMIT || 8);
const LLM_API_KEY = readEnvValue('LLM_API_KEY');
const LLM_BASE_URL = (process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
const LLM_MODEL = process.env.LLM_MODEL || 'qwen-plus';
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 30 * 1000);
const DATA_DIR = process.env.DATA_DIR || path.join(rootDir, 'data');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const VOC_PROJECTS_FILE = path.join(DATA_DIR, 'voc-projects.json');

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

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-push-token');
  next();
});

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

app.listen(PORT, () => {
  console.log(`RSS briefing API listening on http://localhost:${PORT}`);
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
  const username = process.env.APP_USERNAME;
  const password = process.env.APP_PASSWORD;

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
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
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
