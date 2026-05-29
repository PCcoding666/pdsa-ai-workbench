import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3,
  Bell,
  Check,
  ClipboardList,
  FileSearch,
  Filter,
  Globe2,
  MessageSquareText,
  Newspaper,
  RefreshCcw,
  Rocket,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import './styles.css';

const routes = [
  { path: '/about-ai', label: 'AI简报', icon: Newspaper },
  { path: '/voc-insights', label: 'VOC洞察', icon: MessageSquareText },
];

const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3002' : '';
const briefingCategories = ['模型', '应用', '投融资', '生态'];

const defaultSubscriptions = [
  { name: '海外模型厂商发布 + 价格变化', mode: '一句话', cadence: '每日 08:30' },
  { name: 'AI Infra 投融资与客户案例', mode: '结构化', cadence: '工作日 09:00' },
  { name: '客户所在行业与竞品应用案例', mode: '结构化', cadence: '工作日 09:30' },
];

const vocSourceOptions = ['小红书', 'X/Twitter', '即刻', '微信公众号', 'App Store', '客户访谈'];

const vocPosts = [
  {
    source: '小红书',
    sentiment: '正向',
    persona: '中小商家运营',
    theme: '上手快',
    text: '活动海报和商品文案能一起出，减少了重复沟通。',
  },
  {
    source: 'X/Twitter',
    sentiment: '负向',
    persona: '开发者',
    theme: '稳定性',
    text: '批量调用时偶发超时，错误信息不够明确。',
  },
  {
    source: '即刻',
    sentiment: '中性',
    persona: '产品经理',
    theme: '工作流',
    text: '单点能力不错，但团队协作和权限配置还需要更完整。',
  },
  {
    source: '微信公众号',
    sentiment: '正向',
    persona: '企业 IT',
    theme: '私有化',
    text: '合规材料比较完整，适合拿去做内部评审。',
  },
];

const vocDimensions = [
  ['核心价值', '提效、降低内容生产沟通成本、方案材料更快成型'],
  ['主要痛点', '稳定性、错误反馈、批量处理、团队权限'],
  ['高频场景', '营销内容、客服知识库、方案初稿、竞品材料整理'],
  ['购买阻碍', '数据边界、模型效果一致性、试用转正式的 ROI 证明'],
  ['机会动作', '补充行业模板、开放调用日志、提供基准测试报告'],
];

const sampleVocText = [
  '小红书｜中小商家运营｜活动海报和商品文案能一起出，减少了重复沟通。',
  'X/Twitter｜开发者｜批量调用时偶发超时，错误信息不够明确。',
  '即刻｜产品经理｜单点能力不错，但团队协作和权限配置还需要更完整。',
  '微信公众号｜企业 IT｜合规材料比较完整，适合拿去做内部评审。',
  'App Store｜销售运营｜价格有点贵，但生成日报和客户纪要确实省时间。',
].join('\n');

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function downloadUrl(path) {
  window.open(`${API_BASE}${path}`, '_blank', 'noopener,noreferrer');
}

function App() {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));

  const navigate = (nextPath) => {
    window.history.pushState({}, '', nextPath);
    setPath(normalizePath(nextPath));
  };

  React.useEffect(() => {
    const handler = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  const activeRoute = routes.find((route) => route.path === path) ?? routes[0];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={20} />
          </div>
          <div>
            <strong>PDSA AI Workbench</strong>
            <span>方案架构师资讯与客户洞察工具</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="主导航">
          {routes.map((route) => {
            const Icon = route.icon;
            const active = route.path === activeRoute.path;
            return (
              <button
                key={route.path}
                className={`nav-item ${active ? 'active' : ''}`}
                onClick={() => navigate(route.path)}
              >
                <Icon size={18} />
                <span>{route.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" />
          <span>RSS 聚合后端在线</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">PDSA 工作台</span>
            <h1>{activeRoute.label}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" title="刷新">
              <RefreshCcw size={18} />
            </button>
            <button className="icon-button" title="筛选">
              <Filter size={18} />
            </button>
          </div>
        </header>

        {path === '/about-ai' && <AboutAi />}
        {path === '/voc-insights' && <VocInsights />}
      </main>
    </div>
  );
}

function normalizePath(rawPath) {
  if (routes.some((route) => route.path === rawPath)) return rawPath;
  return '/about-ai';
}

function formatBriefingTime(value) {
  if (!value) return '尚未同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBriefingDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  });
}

function formatAnalysisMethod(value) {
  const method = value?.analysisMethod;
  if (method === 'llm') return value?.model ? `大模型分析 · ${value.model}` : '大模型分析';
  if (method === 'rules' && value?.analysisWarning) return '规则兜底';
  if (method === 'rules') return '规则分析';
  return '未保存';
}

function getAnalysisStatus(analysis) {
  if (!analysis) {
    return {
      tone: 'preview',
      label: '未保存',
      title: '当前为前端预览',
      detail: '点击生成分析后，结果会保存到后端。',
      failure: '',
    };
  }

  if (analysis.analysisMethod === 'llm') {
    return {
      tone: 'llm',
      label: '大模型分析',
      title: analysis.model ? `大模型分析 · ${analysis.model}` : '大模型分析',
      detail: analysis.modelProvider || 'OpenAI-compatible endpoint',
      failure: '',
    };
  }

  if (analysis.analysisWarning) {
    return {
      tone: 'fallback',
      label: '规则兜底',
      title: '规则兜底',
      detail: analysis.analysisWarning,
      failure: analysis.llmError ? `失败原因：${analysis.llmError}` : '',
    };
  }

  return {
    tone: 'rules',
    label: '规则分析',
    title: '规则分析',
    detail: '未配置大模型时使用本地规则分析。',
    failure: '',
  };
}

function buildVocFingerprint(product, rawText, selectedSources) {
  return JSON.stringify({
    product: product.trim(),
    rawText: rawText.trim(),
    selectedSources: [...selectedSources].sort(),
  });
}

function buildLocalCommunicationPack(posts, product, dimensions) {
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

  const themes = getTopThemes(posts).map((item) => item.theme);
  const positiveThemes = getTopThemes(posts.filter((post) => post.sentiment === '正向')).map((item) => item.theme);
  const negativeThemes = getTopThemes(posts.filter((post) => post.sentiment === '负向')).map((item) => item.theme);
  const topTheme = themes[0] || '工作流';
  const pain = negativeThemes[0] || themes.find((theme) => ['稳定性', '价格成本', '数据合规', '团队协作'].includes(theme)) || topTheme;
  const value = positiveThemes[0] || topTheme;
  const negativeShare = summarizeSentiment(posts).negative;
  const sourceNames = Array.from(new Set(posts.map((post) => post.source))).slice(0, 3).join('、');

  return {
    headline: `${product} 的当前 VOC 重点在 ${topTheme}；负向占比 ${negativeShare}%，客户沟通应先回应 ${pain}，再放大 ${value} 价值。`,
    painPoints: [
      `${pain} 是优先切入点，适合先问客户是否在真实流程中遇到同类阻塞。`,
      dimensions?.[1]?.[1] || '把高频负向反馈进入售前风险清单。',
    ],
    talkTracks: [
      `我们先不从功能清单讲起，先看 ${product} 在 ${topTheme} 上的用户反馈，再决定试点场景。`,
      `如果客户担心 ${pain}，建议用小范围真实数据压测来验证，而不是只看演示效果。`,
      positiveThemes.length ? `${positiveThemes.slice(0, 2).join('、')}可以作为价值开场，但后续要补 ROI 和上线条件。` : '当前正向样本不足，客户沟通应以问题诊断和试点验证为主。',
    ],
    objectionHandling: [
      posts.some((post) => post.theme === '稳定性') ? '稳定性异议：用错误日志、并发压测和失败回退机制回应。' : '效果异议：用客户真实样本做 A/B 验证，避免只引用通用 benchmark。',
      posts.some((post) => post.theme === '数据合规') ? '合规异议：提前准备数据边界、审计日志和权限隔离说明。' : '合规异议：即使样本未集中提到，也要准备数据边界和权限说明。',
      posts.some((post) => post.theme === '价格成本') ? '成本异议：把单次调用成本、人工节省和上线维护成本放在同一张表里。' : '成本异议：用试点流程节省的人时和响应速度提升来证明 ROI。',
    ],
    nextActions: [
      `从 ${sourceNames || '已选渠道'} 继续补充样本，按行业、角色和场景重新分层。`,
      `围绕 ${pain} 设计一个客户验证问题清单，并沉淀可复用答疑。`,
      `把 ${value} 对应的正向原声整理成 2-3 条客户可引用案例。`,
    ],
    evidenceToCollect: ['客户真实流程截图或日志', '竞品同场景反馈', '上线前后耗时、成本、满意度指标'],
  };
}

function AboutAi() {
  const [mode, setMode] = useState('natural');
  const [subscriptions, setSubscriptions] = useState(() =>
    defaultSubscriptions.map((item, index) => ({ ...item, id: `default-${index + 1}`, channels: ['钉钉', '微信'] }))
  );
  const [subscriptionState, setSubscriptionState] = useState('ready');
  const [briefingData, setBriefingData] = useState({
    items: [],
    generatedAt: null,
    sourceHealth: { total: 0, ok: 0, failed: 0 },
    insights: null,
  });
  const [briefingState, setBriefingState] = useState('loading');
  const [briefingError, setBriefingError] = useState('');
  const [naturalText, setNaturalText] = useState('每天早上推送海外多模态模型、企业 Agent、AI Infra 投融资，优先保留可用于客户沟通的变化。');
  const [structured, setStructured] = useState({
    topic: '模型与应用',
    region: '国内 + 海外',
    keywords: 'Qwen, Agent, AI Infra, 企业应用',
    cadence: '每日 08:30',
  });
  const [channels, setChannels] = useState({
    dingtalk: true,
    wechat: true,
    email: false,
  });

  const loadBriefing = async ({ refresh = false } = {}) => {
    setBriefingState('loading');
    setBriefingError('');
    try {
      const response = await fetch(`${API_BASE}/api/briefing?limit=24${refresh ? '&refresh=1' : ''}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setBriefingData({
        ...data,
        items: Array.isArray(data.items) ? data.items : [],
      });
      setBriefingState('ready');
    } catch (error) {
      setBriefingData({
        items: [],
        generatedAt: null,
        sourceHealth: { total: 0, ok: 0, failed: 0 },
        insights: null,
      });
      setBriefingError('RSS 后端暂不可用，请稍后刷新');
      setBriefingState('error');
    }
  };

  const loadSubscriptions = async () => {
    try {
      const data = await apiFetch('/api/subscriptions');
      if (Array.isArray(data.subscriptions) && data.subscriptions.length) {
        setSubscriptions(data.subscriptions);
      }
    } catch (error) {
      setSubscriptionState('error');
    }
  };

  useEffect(() => {
    loadBriefing();
    loadSubscriptions();
  }, []);

  const briefingList = briefingData.items || [];
  const sourceHealth = briefingData.sourceHealth || { total: 0, ok: 0, failed: 0 };
  const sourceValue = sourceHealth.total ? `${sourceHealth.ok}/${sourceHealth.total}` : '--';
  const highImpactCount = briefingList.filter((item) => item.impact === '高').length;
  const sourceFailures = Array.isArray(sourceHealth.failures) ? sourceHealth.failures : [];
  const briefingInsights = briefingData.insights || null;
  const insightSignals = briefingInsights?.topSignals || [];
  const talkTracks = briefingInsights?.talkTracks || [];
  const customerAngles = briefingInsights?.customerAngles || [];
  const riskFlags = briefingInsights?.riskFlags || [];
  const briefingMeta = briefingData.generatedAt ? `${formatBriefingTime(briefingData.generatedAt)} 生成` : '等待 RSS';
  const stateLabel =
    briefingState === 'loading'
      ? '正在拉取 RSS'
      : briefingState === 'error'
        ? briefingError
        : briefingData.cached
          ? '已使用缓存'
          : briefingList.length
            ? '真实 RSS 已同步'
            : 'RSS 已同步，暂无匹配条目';

  const grouped = useMemo(() => {
    const buckets = briefingList.reduce((acc, item) => {
      acc[item.category] = acc[item.category] || [];
      acc[item.category].push(item);
      return acc;
    }, {});
    return briefingCategories
      .filter((category) => buckets[category]?.length)
      .map((category) => [category, buckets[category]]);
  }, [briefingList]);

  const addSubscription = async () => {
    const name =
      mode === 'natural'
        ? naturalText.trim().slice(0, 36) || '新的个性化订阅'
        : `${structured.region}｜${structured.topic}｜${structured.keywords}`;
    const activeChannels = Object.entries(channels)
      .filter(([, enabled]) => enabled)
      .map(([channel]) => ({ dingtalk: '钉钉', wechat: '微信', email: '邮件' })[channel]);
    const payload = {
      name,
      mode: mode === 'natural' ? '一句话' : '结构化',
      description: mode === 'natural' ? naturalText : '',
      topic: structured.topic,
      region: structured.region,
      keywords: structured.keywords,
      cadence: structured.cadence,
      channels: activeChannels,
    };

    setSubscriptionState('saving');
    try {
      const data = await apiFetch('/api/subscriptions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setSubscriptions(data.subscriptions || [data.subscription, ...subscriptions].filter(Boolean));
      setSubscriptionState('saved');
    } catch (error) {
      setSubscriptions([{ ...payload, id: `local-${Date.now()}` }, ...subscriptions]);
      setSubscriptionState('error');
    }
  };

  return (
    <section className="workspace-grid">
      <div className="wide-panel brief-hero">
        <div className="hero-copy">
          <span className="badge green">无昼每日简报 2.0</span>
          <h2>模型、应用、投融资与生态动态集中成一份 PDSA 早报</h2>
        </div>
        <div className="metric-strip">
          <Metric icon={Globe2} label="RSS 源可用" value={sourceValue} />
          <Metric icon={Rocket} label="高影响事件" value={highImpactCount} />
          <Metric icon={Bell} label="订阅草稿" value={subscriptions.length} />
        </div>
      </div>

      {briefingInsights && (
        <div className="content-panel span-3 executive-panel">
          <PanelHeader icon={Sparkles} title="今日结论" meta={briefingInsights.sourceCoverage || briefingMeta} />
          <div className="executive-layout">
            <div className="executive-summary">
              <span className="section-kicker">PDSA 判断</span>
              <strong>{briefingInsights.headline}</strong>
              <p>{briefingInsights.focusAreas?.length ? `今日优先关注：${briefingInsights.focusAreas.join('、')}` : '等待更多可用信号。'}</p>
            </div>
            <div className="must-read-panel">
              <div className="section-kicker">今日必读 3 条</div>
              <div className="must-read-list">
                {insightSignals.slice(0, 3).map((signal, index) => (
                  <a href={signal.link || undefined} target="_blank" rel="noreferrer" key={`${signal.source}-${signal.title}`}>
                    <i>{index + 1}</i>
                    <span>
                      <strong>{signal.title}</strong>
                      <small>{signal.source} · {signal.category} · {signal.impact}</small>
                    </span>
                  </a>
                ))}
              </div>
            </div>
            <div className="talk-track-panel">
              <div className="section-kicker">可直接使用话术</div>
              <ul className="action-list">
                {talkTracks.slice(0, 3).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="executive-support">
            <div>
              <strong>客户沟通角度</strong>
              <span>{customerAngles[0] || '把今日资讯拆成客户痛点、可落地场景和可验证指标。'}</span>
            </div>
            <div>
              <strong>风险提醒</strong>
              <span>{riskFlags[0] || '客户沟通前仍需核对原文、发布时间和可用区域。'}</span>
            </div>
          </div>
        </div>
      )}

      <div className="content-panel span-2">
        <PanelHeader icon={Newspaper} title="资讯列表" meta={briefingMeta} />
        <div className="briefing-tools">
          <span className={`data-state ${briefingState}`}>{stateLabel}</span>
          <div className="toolbar-actions">
            <button className="small-button" onClick={() => downloadUrl('/api/briefing/export.md?limit=24')} disabled={!briefingList.length}>
              <ClipboardList size={14} />
              <span>导出</span>
            </button>
            <button className="small-button" onClick={() => loadBriefing({ refresh: true })} disabled={briefingState === 'loading'}>
              <RefreshCcw size={14} />
              <span>刷新 RSS</span>
            </button>
          </div>
        </div>
        {grouped.length ? (
          <div className="briefing-columns">
            {grouped.map(([category, items]) => (
              <div className="briefing-column" key={category}>
                <div className="column-title">
                  <span>{category}</span>
                  <strong>{items.length}</strong>
                </div>
                {items.map((item) => (
                  <article className="brief-row" key={item.id || item.title}>
                    <div className="row-head">
                      <span className={`impact impact-${item.impact}`}>{item.impact}</span>
                      <span>{item.region}</span>
                    </div>
                    <h3>
                      {item.link ? (
                        <a href={item.link} target="_blank" rel="noreferrer">
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      )}
                    </h3>
                    <p>{item.summary}</p>
                    <div className="tag-list">
                      {(item.tags || []).map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                    <small>
                      {item.source}
                      {formatBriefingDate(item.publishedAt) ? ` · ${formatBriefingDate(item.publishedAt)}` : ''}
                    </small>
                  </article>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Newspaper size={24} />
            <strong>{briefingState === 'loading' ? '正在拉取真实 RSS' : '暂无真实 RSS 条目'}</strong>
            <span>{briefingState === 'error' ? briefingError : '可以刷新 RSS 或在后端增加更多源。'}</span>
          </div>
        )}
      </div>

      <div className="content-panel">
        <PanelHeader
          icon={SlidersHorizontal}
          title="个性化订阅"
          meta={subscriptionState === 'saving' ? '保存中' : subscriptionState === 'saved' ? '已保存' : subscriptionState === 'error' ? '本地显示' : '已持久化'}
        />
        <Segmented
          value={mode}
          options={[
            ['natural', '一句话'],
            ['structured', '结构化'],
          ]}
          onChange={setMode}
        />

        {mode === 'natural' ? (
          <label className="field">
            <span>订阅描述</span>
            <textarea value={naturalText} onChange={(event) => setNaturalText(event.target.value)} rows={5} />
          </label>
        ) : (
          <div className="form-grid">
            <label className="field">
              <span>主题</span>
              <select value={structured.topic} onChange={(event) => setStructured({ ...structured, topic: event.target.value })}>
                <option>模型与应用</option>
                <option>投融资与生态</option>
                <option>行业案例</option>
                <option>竞品切换</option>
              </select>
            </label>
            <label className="field">
              <span>区域</span>
              <select value={structured.region} onChange={(event) => setStructured({ ...structured, region: event.target.value })}>
                <option>国内 + 海外</option>
                <option>国内</option>
                <option>海外</option>
              </select>
            </label>
            <label className="field full">
              <span>关键词</span>
              <input value={structured.keywords} onChange={(event) => setStructured({ ...structured, keywords: event.target.value })} />
            </label>
            <label className="field full">
              <span>推送时间</span>
              <input value={structured.cadence} onChange={(event) => setStructured({ ...structured, cadence: event.target.value })} />
            </label>
          </div>
        )}

        <div className="channel-row" aria-label="期望渠道">
          <Toggle label="钉钉" checked={channels.dingtalk} onChange={() => setChannels({ ...channels, dingtalk: !channels.dingtalk })} />
          <Toggle label="微信" checked={channels.wechat} onChange={() => setChannels({ ...channels, wechat: !channels.wechat })} />
          <Toggle label="邮件" checked={channels.email} onChange={() => setChannels({ ...channels, email: !channels.email })} />
        </div>

        <button className="primary-action" onClick={addSubscription}>
          <Bell size={18} />
          <span>{subscriptionState === 'saving' ? '保存中' : '保存订阅'}</span>
        </button>

        <div className="subscription-list">
          {subscriptions.map((item, index) => (
            <div className="subscription-row" key={`${item.name}-${index}`}>
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.mode} · {item.cadence}
                  {item.channels?.length ? ` · ${Array.isArray(item.channels) ? item.channels.join(' + ') : item.channels}` : ''}
                </span>
              </div>
              <Check size={17} />
            </div>
          ))}
        </div>

        <div className="source-health">
          <div>
            <strong>来源健康</strong>
            <span>{sourceValue}</span>
          </div>
          {sourceFailures.length ? (
            sourceFailures.slice(0, 3).map((failure) => (
              <p key={failure.id}>
                <span>{failure.name}</span>
                <small>{failure.reason}</small>
              </p>
            ))
          ) : (
            <p>
              <span>全部来源可用</span>
              <small>最近一次同步没有失败源</small>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function VocInsights() {
  const [product, setProduct] = useState('客户智能客服产品');
  const [selectedSources, setSelectedSources] = useState(vocSourceOptions.slice(0, 4));
  const [draftText, setDraftText] = useState(sampleVocText);
  const [analysisText, setAnalysisText] = useState(sampleVocText);
  const [savedProject, setSavedProject] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectState, setProjectState] = useState('ready');
  const [lastAnalyzedFingerprint, setLastAnalyzedFingerprint] = useState('');

  const localPosts = useMemo(() => parseVocPosts(analysisText), [analysisText]);
  const serverAnalysis = savedProject?.analysis || null;
  const analyzedPosts = serverAnalysis?.allPosts || localPosts;
  const sourceOptions = useMemo(() => {
    const sourceSet = new Set(vocSourceOptions);
    (serverAnalysis?.sourceOptions || []).forEach((source) => sourceSet.add(source));
    analyzedPosts.forEach((post) => sourceSet.add(post.source));
    return Array.from(sourceSet);
  }, [analyzedPosts, serverAnalysis]);

  const loadProjects = async () => {
    try {
      const data = await apiFetch('/api/voc/projects');
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (error) {
      setProjectState('error');
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const toggleSource = (source) => {
    setSelectedSources((current) =>
      current.includes(source) ? current.filter((item) => item !== source) : [...current, source]
    );
  };

  const runAnalysis = async () => {
    const nextPosts = parseVocPosts(draftText);
    const nextSelectedSources = Array.from(new Set([...selectedSources, ...nextPosts.map((post) => post.source)]));
    const nextFingerprint = buildVocFingerprint(product, draftText, nextSelectedSources);
    setAnalysisText(draftText);
    setSelectedSources(nextSelectedSources);
    setProjectState('saving');
    try {
      const data = await apiFetch('/api/voc/projects', {
        method: 'POST',
        body: JSON.stringify({ product, rawText: draftText, selectedSources: nextSelectedSources }),
      });
      setSavedProject(data.project);
      setLastAnalyzedFingerprint(nextFingerprint);
      setProjects((current) => [
        {
          id: data.project.id,
          product: data.project.product,
          createdAt: data.project.createdAt,
          updatedAt: data.project.updatedAt,
          sampleCount: data.project.analysis?.posts?.length || 0,
          negativeShare: data.project.analysis?.sentimentSummary?.negative || 0,
          topTheme: data.project.analysis?.topThemes?.[0]?.theme || '',
          analysisMethod: data.project.analysis?.analysisMethod || 'rules',
          model: data.project.analysis?.model || '',
        },
        ...current.filter((item) => item.id !== data.project.id),
      ]);
      setProjectState('saved');
    } catch (error) {
      setSavedProject(null);
      setLastAnalyzedFingerprint('');
      setProjectState('error');
    }
  };

  const openProject = async (id) => {
    setProjectState('loading');
    try {
      const data = await apiFetch(`/api/voc/projects/${id}`);
      const project = data.project;
      setSavedProject(project);
      setProduct(project.product);
      setDraftText(project.rawText || '');
      setAnalysisText(project.rawText || '');
      setSelectedSources(project.selectedSources?.length ? project.selectedSources : vocSourceOptions.slice(0, 4));
      setLastAnalyzedFingerprint(buildVocFingerprint(project.product, project.rawText || '', project.selectedSources?.length ? project.selectedSources : vocSourceOptions.slice(0, 4)));
      setProjectState('saved');
    } catch (error) {
      setProjectState('error');
    }
  };

  const visiblePosts = serverAnalysis?.posts || analyzedPosts.filter((post) => selectedSources.includes(post.source));
  const sentimentSummary = serverAnalysis?.sentimentSummary || summarizeSentiment(visiblePosts);
  const dimensionRows = serverAnalysis?.dimensions || buildVocDimensions(visiblePosts);
  const topThemes = (serverAnalysis?.topThemes || getTopThemes(visiblePosts)).slice(0, 3);
  const communicationPack = serverAnalysis?.communicationPack || buildLocalCommunicationPack(visiblePosts, product, dimensionRows);
  const totalMentions = visiblePosts.length;
  const analysisMethodLabel = formatAnalysisMethod(serverAnalysis);
  const analysisStatus = getAnalysisStatus(serverAnalysis);
  const currentFingerprint = buildVocFingerprint(product, draftText, selectedSources);
  const hasStaleAnalysis = Boolean(savedProject && lastAnalyzedFingerprint && currentFingerprint !== lastAnalyzedFingerprint);
  const analysisMeta =
    projectState === 'saving'
      ? '分析中'
      : savedProject
        ? analysisMethodLabel
        : `${totalMentions} 条纳入分析`;

  return (
    <section className="workspace-grid">
      <div className="wide-panel voc-toolbar">
        <div>
          <span className="badge amber">VOC 洞察</span>
          <h2>客户产品 VOC 洞察</h2>
        </div>
        <label className="search-box">
          <Search size={18} />
          <input value={product} onChange={(event) => setProduct(event.target.value)} />
        </label>
        <button className="primary-action compact" onClick={runAnalysis} disabled={projectState === 'saving'}>
          <FileSearch size={18} />
          <span>{projectState === 'saving' ? '分析中' : savedProject ? '重新生成' : '生成分析'}</span>
        </button>
      </div>

      <div className="content-panel">
        <PanelHeader icon={Settings2} title="采集源" meta="社媒 + 内容平台" />
        <div className="source-grid">
          {sourceOptions.map((source) => (
            <button
              key={source}
              className={`source-tile ${selectedSources.includes(source) ? 'selected' : ''}`}
              onClick={() => toggleSource(source)}
            >
              <span>{source}</span>
              {selectedSources.includes(source) && <Check size={16} />}
            </button>
          ))}
        </div>
        <div className="sentiment-block">
          <div className="sentiment-line">
            <span>正向</span>
            <div><i style={{ width: `${sentimentSummary.positive}%` }} /></div>
            <strong>{sentimentSummary.positive}%</strong>
          </div>
          <div className="sentiment-line">
            <span>中性</span>
            <div><i style={{ width: `${sentimentSummary.neutral}%` }} /></div>
            <strong>{sentimentSummary.neutral}%</strong>
          </div>
          <div className="sentiment-line">
            <span>负向</span>
            <div><i style={{ width: `${sentimentSummary.negative}%` }} /></div>
            <strong>{sentimentSummary.negative}%</strong>
          </div>
        </div>
      </div>

      <div className="content-panel span-2">
        <PanelHeader
          icon={ClipboardList}
          title="评论输入"
          meta={projectState === 'error' ? '本地分析' : analysisMeta}
        />
        <label className="field">
          <span>每行一条，格式可用：来源｜用户画像｜评论内容</span>
          <textarea className="voc-input" value={draftText} onChange={(event) => setDraftText(event.target.value)} rows={8} />
        </label>
        <div className={`analysis-status ${analysisStatus.tone}`}>
          <Sparkles size={15} />
          <strong>{analysisStatus.label}</strong>
          <span>{savedProject ? analysisStatus.title : analysisStatus.detail}</span>
          {savedProject && analysisStatus.detail && <small>{analysisStatus.detail}</small>}
          {analysisStatus.failure && <small>{analysisStatus.failure}</small>}
          {hasStaleAnalysis && <small className="stale-note">评论或产品名已修改，当前结果未更新。</small>}
        </div>
        <div className="analysis-actions">
          <button className="small-button" onClick={runAnalysis} disabled={projectState === 'saving'}>
            <RefreshCcw size={14} />
            <span>{savedProject ? '重新生成分析' : '生成并保存分析'}</span>
          </button>
        </div>
        <div className="insight-strip">
          <Metric icon={UsersRound} label="样本数" value={totalMentions} />
          <Metric icon={MessageSquareText} label="高频主题" value={topThemes[0]?.theme || '--'} />
          <Metric icon={BarChart3} label="负向占比" value={`${sentimentSummary.negative}%`} />
        </div>
        {savedProject && (
          <button className="secondary-action" onClick={() => downloadUrl(`/api/voc/projects/${savedProject.id}/export.md`)}>
            <ClipboardList size={16} />
            <span>导出 VOC Markdown</span>
          </button>
        )}
      </div>

      <div className="content-panel span-3 communication-panel">
        <PanelHeader icon={Rocket} title="PDSA 客户沟通包" meta={savedProject ? analysisMethodLabel : '前端预览'} />
        <div className="communication-headline">
          <strong>{communicationPack.headline}</strong>
        </div>
        <div className="communication-grid">
          <CommunicationBlock title="痛点切入" items={communicationPack.painPoints} />
          <CommunicationBlock title="推荐话术" items={communicationPack.talkTracks} />
          <CommunicationBlock title="异议回应" items={communicationPack.objectionHandling} />
          <CommunicationBlock title="下一步动作" items={communicationPack.nextActions} />
          <CommunicationBlock title="需要补充的证据" items={communicationPack.evidenceToCollect} />
        </div>
      </div>

      <div className="content-panel span-2">
        <PanelHeader icon={UsersRound} title="用户原声" meta={product} />
        <div className="voc-feed">
          {visiblePosts.map((post) => (
            <article className="voc-row" key={post.text}>
              <div className="row-head">
                <span>{post.source}</span>
                <span className={`sentiment sentiment-${post.sentiment}`}>{post.sentiment}</span>
              </div>
              <p>{post.text}</p>
              <div className="voc-meta">
                <span>{post.persona}</span>
                <span>{post.theme}</span>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="content-panel">
        <PanelHeader icon={BarChart3} title="高频主题" meta="按评论命中聚合" />
        <div className="theme-stack">
          {topThemes.map((item) => (
            <div className="theme-row" key={item.theme}>
              <div>
                <strong>{item.theme}</strong>
                <span>{item.count} 条</span>
              </div>
              <i>
                <b style={{ width: `${Math.max(12, Math.round((item.count / Math.max(totalMentions, 1)) * 100))}%` }} />
              </i>
            </div>
          ))}
        </div>
      </div>

      <div className="content-panel">
        <PanelHeader icon={ClipboardList} title="历史项目" meta={`${projects.length} 个`} />
        <div className="project-list">
          {projects.length ? (
            projects.slice(0, 6).map((project) => (
              <button className="project-row" key={project.id} onClick={() => openProject(project.id)}>
                <strong>{project.product}</strong>
                <span>{project.sampleCount} 条 · 负向 {project.negativeShare}% · {project.topTheme || '暂无主题'} · {formatAnalysisMethod(project)}</span>
              </button>
            ))
          ) : (
            <div className="empty-compact">
              <strong>暂无历史项目</strong>
              <span>生成一次分析后会自动保存在这里。</span>
            </div>
          )}
        </div>
      </div>

      <div className="content-panel span-3">
        <PanelHeader icon={BarChart3} title="分析维度" meta="前线客户视角" />
        <div className="dimension-table">
          {dimensionRows.map(([name, value]) => (
            <div className="dimension-row" key={name}>
              <strong>{name}</strong>
              <span>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function parseVocPosts(rawText) {
  const rows = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!rows.length) return vocPosts.map(enrichVocPost);

  return rows.map((line, index) => {
    const parts = line.split(/[｜|]/).map((part) => part.trim()).filter(Boolean);
    const source = parts.length >= 3 ? parts[0] : inferSource(line, index);
    const persona = parts.length >= 3 ? parts[1] : '未知用户';
    const text = parts.length >= 3 ? parts.slice(2).join('｜') : line;
    return enrichVocPost({ source, persona, text });
  });
}

function enrichVocPost(post) {
  const theme = post.theme || inferTheme(post.text);
  return {
    ...post,
    theme,
    sentiment: post.sentiment || inferSentiment(post.text),
  };
}

function inferSource(text, index) {
  const knownSource = vocSourceOptions.find((source) => text.includes(source));
  return knownSource || vocSourceOptions[index % vocSourceOptions.length];
}

function inferSentiment(text) {
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

function inferTheme(text) {
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

function summarizeSentiment(posts) {
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

function getTopThemes(posts) {
  const counts = posts.reduce((acc, post) => {
    acc[post.theme] = (acc[post.theme] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([theme, count]) => ({ theme, count }))
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme, 'zh-CN'));
}

function buildVocDimensions(posts) {
  if (!posts.length) return vocDimensions;

  const positiveThemes = getTopThemes(posts.filter((post) => post.sentiment === '正向')).map((item) => item.theme);
  const negativeThemes = getTopThemes(posts.filter((post) => post.sentiment === '负向')).map((item) => item.theme);
  const allThemes = getTopThemes(posts).map((item) => item.theme);
  const topSources = Array.from(new Set(posts.map((post) => post.source))).slice(0, 4).join('、');

  return [
    ['核心价值', positiveThemes.length ? `${positiveThemes.slice(0, 3).join('、')}被用户正向提及，可作为客户沟通切入点。` : '当前样本正向信号较少，需要补充更多有效评论。'],
    ['主要痛点', negativeThemes.length ? `${negativeThemes.slice(0, 3).join('、')}是当前优先处理的问题。` : '当前样本未出现明显负向集中点。'],
    ['高频场景', allThemes.length ? `${allThemes.slice(0, 4).join('、')}是评论中最常出现的使用语境。` : '暂无足够样本判断高频场景。'],
    ['购买阻碍', posts.some((post) => ['价格成本', '数据合规', '稳定性'].includes(post.theme)) ? '价格、合规或稳定性相关反馈需要在方案材料中提前回应。' : '购买阻碍暂不明显，可以继续扩大样本验证。'],
    ['机会动作', `${topSources || '已选渠道'}样本可继续扩充；下一步建议沉淀真实原声、竞品对照和销售话术。`],
  ];
}

function CommunicationBlock({ title, items = [] }) {
  return (
    <div className="communication-block">
      <strong>{title}</strong>
      <ul>
        {items.slice(0, 4).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="metric">
      <Icon size={18} />
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function PanelHeader({ icon: Icon, title, meta }) {
  return (
    <div className="panel-header">
      <div>
        <Icon size={19} />
        <strong>{title}</strong>
      </div>
      <span>{meta}</span>
    </div>
  );
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="segmented">
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          className={value === optionValue ? 'selected' : ''}
          onClick={() => onChange(optionValue)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <button className={`toggle ${checked ? 'checked' : ''}`} onClick={onChange}>
      <span className="toggle-control">{checked && <Check size={13} />}</span>
      <span>{label}</span>
    </button>
  );
}

createRoot(document.getElementById('root')).render(<App />);
