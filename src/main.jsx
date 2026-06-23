import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3,
  Bell,
  Check,
  Clock3,
  ClipboardList,
  Database,
  ExternalLink,
  FileSearch,
  Filter,
  Globe2,
  Landmark,
  ListChecks,
  MessageSquareText,
  Newspaper,
  Radio,
  RefreshCcw,
  Rocket,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import './styles.css';

const routes = [
  { path: '/realtime-flow', label: '实时信息流', icon: Radio },
  { path: '/research-queue', label: '研究队列', icon: ListChecks },
  { path: '/serenity-research', label: 'Serenity研究', icon: Search },
  { path: '/ai-stock-radar', label: 'AI股票雷达', icon: BarChart3 },
  { path: '/official-holdings', label: '官员持仓', icon: Landmark },
  { path: '/about-ai', label: 'AI简报', icon: Newspaper },
  { path: '/voc-insights', label: 'VOC洞察', icon: MessageSquareText },
];

const API_BASE =
  window.location.protocol === 'file:'
    ? 'http://localhost:3002'
    : window.location.port === '3001'
      ? `${window.location.protocol}//${window.location.hostname}:3002`
      : '';
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

const radarCoreStocks = [
  ['NVDA', 'NVIDIA', 'Compute / GPU / ASIC', '$215.21', '+1.76%', 87, '需求锚：GPU、CUDA、NVLink、rack-scale AI。'],
  ['AMD', 'Advanced Micro Devices', 'Compute / GPU / ASIC', '$145.19', '+11.44%', 72, 'MI 系列和 CPU/GPU 组合，适合作为 NVDA 以外的算力锚。'],
  ['AVGO', 'Broadcom', 'Networking / ASIC', '$430.00', '+4.23%', 84, '自研 ASIC、交换芯片、光通信链条的核心大盘 anchor。'],
  ['MRVL', 'Marvell Technology', 'Networking / Optical', '$170.13', '+6.32%', 75, 'ASIC、DSP、光互联与 cloud custom silicon。'],
  ['INTC', 'Intel', 'Foundry / Packaging', '$124.89', '+13.93%', 58, '代工、先进封装和玻璃基板路线锚。'],
  ['ARM', 'Arm Holdings', 'Compute / CPU IP', '$213.27', '-0.02%', 76, 'CPU IP 和边缘/云端低功耗计算。'],
  ['QCOM', 'Qualcomm', 'Consumer AI / Device', '$219.09', '+8.17%', 69, '端侧 AI、手机和边缘推理。'],
  ['TSM', 'Taiwan Semiconductor', 'Foundry', '$411.68', '-0.60%', 85, 'AI 芯片制造和先进封装核心 anchor。'],
  ['ASML', 'ASML Holding', 'Semi Equipment', '$1,592.02', '+4.97%', 83, 'EUV/DUV 光刻瓶颈。'],
  ['AMAT', 'Applied Materials', 'Semi Equipment', '$435.35', '+6.02%', 74, '沉积、刻蚀和先进封装设备。'],
  ['CDNS', 'Cadence Design', 'EDA / Design Software', '$382.70', '+1.63%', 78, '芯片设计软件和仿真。'],
  ['SNPS', 'Synopsys', 'EDA / Design Software', '$516.48', '+2.23%', 79, 'EDA、IP、验证。'],
  ['MU', 'Micron Technology', 'Memory / Storage', '$746.79', '+15.49%', 73, 'HBM/DRAM/NAND 周期和 AI memory。'],
  ['MSFT', 'Microsoft', 'Cloud / Hyperscaler', '$415.06', '-1.36%', 86, 'Azure、OpenAI、Maia/数据中心 capex。'],
  ['GOOGL', 'Alphabet', 'Cloud / Hyperscaler', '$400.71', '+0.68%', 82, 'TPU、Gemini、广告/云。'],
  ['AMZN', 'Amazon', 'Cloud / Hyperscaler', '$272.68', '+0.56%', 84, 'AWS、Trainium、物流机器人。'],
  ['META', 'Meta Platforms', 'AI Application', '$609.63', '-1.16%', 80, '推荐系统、AI capex、开源模型。'],
  ['ORCL', 'Oracle', 'AI Cloud / GPU Cloud', '$195.94', '+0.69%', 70, 'AI cloud capacity 和数据库客户。'],
  ['ANET', 'Arista Networks', 'Networking / Optical', '$141.77', '+0.01%', 77, 'AI 数据中心以太网交换。'],
  ['VRT', 'Vertiv', 'Data Center Infrastructure', '$339.97', '-0.01%', 75, '液冷、电源、机架级数据中心基础设施。'],
  ['ETN', 'Eaton', 'Power / Grid', '$401.61', '+0.59%', 71, '电力设备、配电、数据中心电力。'],
  ['GEV', 'GE Vernova', 'Power / Grid', '$1,040.15', '-0.52%', 68, '电网、电力设备、能源基础设施。'],
  ['CEG', 'Constellation Energy', 'Power / Nuclear', '$303.63', '-2.46%', 69, '核电和数据中心电力 PPA。'],
  ['VST', 'Vistra', 'Power / Nuclear', '$147.72', '-4.05%', 66, '电力和数据中心负载叙事。'],
  ['DELL', 'Dell Technologies', 'Data Center Infrastructure', '$260.31', '+13.05%', 67, 'AI server 交付和企业基础设施。'],
  ['SNOW', 'Snowflake', 'Data / Software Platform', '$152.45', '-0.83%', 64, '数据平台和 AI 数据工作流。'],
  ['PLTR', 'Palantir', 'Data / Software Platform', '$137.80', '+0.55%', 68, '企业 AI 平台、国防/商业数据工作流。'],
  ['CRWD', 'CrowdStrike', 'Cybersecurity', '$527.77', '+4.36%', 70, 'AI security 与 endpoint/cloud security。'],
  ['NOW', 'ServiceNow', 'AI Application', '$991.18', '-2.58%', 72, '企业 workflow AI。'],
  ['APP', 'AppLovin', 'AI Application', '$468.55', '-6.08%', 65, 'AI 广告优化和应用变现。'],
].map(([ticker, name, sector, price, move, score, thesis]) => ({ ticker, name, sector, price, move, score, thesis }));

const radarAnomalies = [
  ['UEC', 'Power / Grid / Nuclear', '+297.3%', 'missing'],
  ['AKAM', 'Data Center / Edge', '+26.5%', 'missing'],
  ['MU', 'Memory / Storage', '+15.49%', 'covered'],
  ['HUBS', 'AI Application', '-19.03%', 'missing'],
  ['IONQ', 'Quantum / Frontier', '+2.02%', 'missing'],
  ['QBTS', 'Quantum / Frontier', '+1.78%', 'missing'],
  ['NET', 'Networking / Edge', '-23.75%', 'partial'],
  ['NBIS', 'AI Cloud / GPU Cloud', '+3.51%', 'covered'],
  ['CRWV', 'AI Cloud / GPU Cloud', '+1.68%', 'partial'],
  ['IREN', 'AI Cloud / GPU Cloud', '+1.68%', 'partial'],
  ['SOUN', 'AI Application', '+0.99%', 'missing'],
  ['TEM', 'Healthcare AI', '+0.83%', 'missing'],
].map(([ticker, theme, move, coverage]) => ({ ticker, theme, move, coverage }));

const radarSubsectors = [
  ['Power / Grid / Nuclear', '+0.59%', 'covered', ['POWL', 'HPS.A', 'ETN', 'GEV', 'CEG'], '我们覆盖了电网/变压器/AI 数据中心电力，但核电燃料链和 UEC/CCJ/LEU 尚未深入。'],
  ['Data / Software Platform', '-1.68%', 'missing', ['SNOW', 'PLTR', 'DDOG', 'MDB'], '缺企业数据平台、AI 数据管道、semantic layer 的 Serenity 式瓶颈拆解。'],
  ['Data Center Infrastructure', '+1.80%', 'covered', ['VRT', 'DELL', 'MOD', 'NVT'], '已开始液冷/机架电力/GB200 rack density；还需补 cold plate/CDU 供应商。'],
  ['Industrial Automation / Robotics', '-0.38%', 'partial', ['TER', 'ROK', 'ISRG', 'SYM'], '只有“物理 AI”概念，还没拆执行器、伺服、传感、仿真、工厂自动化供应链。'],
  ['Networking / Optical', '+1.70%', 'covered', ['ANET', 'AAOI', 'SIVE', 'LITE', 'COHR'], 'CPO/光模块/激光器/InP 是当前覆盖最深的线。'],
  ['AI Application', '-1.40%', 'missing', ['NOW', 'APP', 'SOUN', 'HUBS'], '我们偏 infra，几乎没有做应用层的新增需求和财务弹性筛选。'],
  ['Compute / GPU / ASIC', '+4.45%', 'partial', ['NVDA', 'AMD', 'AVGO', 'MRVL', 'ARM'], '我们把它当需求锚，而不是系统覆盖 GPU/ASIC 载体。'],
  ['Cybersecurity', '+3.11%', 'missing', ['CRWD', 'PANW', 'ZS', 'NET'], 'AI security / inference security / identity / endpoint 没有进入 discovery run。'],
  ['Semiconductor Equipment', '+3.37%', 'partial', ['ASML', 'AMAT', 'LRCX', 'KLAC'], '只作为 packaging/glass substrate 的辅助线，没有单独拆设备瓶颈。'],
  ['Cloud / Hyperscaler', '+0.32%', 'partial', ['MSFT', 'AMZN', 'GOOGL', 'ORCL'], '已有 NBIS/Neocloud，但 hyperscaler 资本开支、租赁、GPU cloud 还未成完整看板。'],
  ['Financial / Research Data', '-0.79%', 'missing', ['SPGI', 'MSCI', 'MCO', 'FDS'], '没有覆盖 AI agent 对金融数据、研究终端、数据授权的新增需求。'],
  ['Autonomous / Mobility', '+1.59%', 'missing', ['TSLA', 'MBLY', 'AUR', 'OUST'], '没有拆自动驾驶、LiDAR、地图、车载计算供应链。'],
  ['Critical Minerals / Rare Earths', '-1.64%', 'missing', ['MP', 'UUUU', 'LAC', 'ALB'], '缺电力/机器人/电池/稀土磁材上游。'],
  ['Healthcare AI', '+0.11%', 'missing', ['TEM', 'RXRX', 'SDGR', 'EXAI'], '没有覆盖医疗 AI、药物发现、医院 workflow AI。'],
  ['Memory / Storage', '+4.85%', 'covered', ['MU', 'SNDK', 'SIMO', 'WDC'], '已覆盖推理内存/存储/KV cache，但需要更强一手证据。'],
  ['AI Cloud / GPU Cloud', '-1.37%', 'covered', ['NBIS', 'CRWV', 'IREN', 'ORCL'], '已有 NBIS/Neocloud；CRWV/IREN 需要补融资结构和客户合同。'],
  ['Foundry / Packaging', '+2.07%', 'covered', ['TSM', 'INTC', 'TSEM', 'IBDNF', 'AT&S'], '已扩展到 glass core substrate、silicon capacitors、advanced packaging。'],
  ['Quantum / Frontier Computing', '+2.19%', 'missing', ['IONQ', 'QBTS', 'RGTI', 'ARQQ'], '截图有量子板块，我们当前没有研究。'],
  ['Consumer AI / Device', '-2.20%', 'missing', ['AAPL', 'QCOM', 'META', 'RPI'], '只覆盖 RPI 社区需求，没有系统覆盖端侧 AI device。'],
  ['EDA / Design Software', '+1.93%', 'missing', ['CDNS', 'SNPS', 'ANSS', 'ALTR'], 'AI 芯片设计复杂度带来的 EDA 瓶颈未拆。'],
].map(([name, move, coverage, tickers, gap]) => ({ name, move, coverage, tickers, gap }));

const radarStats = [
  ['AI Universe', '191', 'Benchmark universe'],
  ['Core', '30', 'Core Research 30'],
  ['High Conv.', '15', 'High-conv sample'],
  ['覆盖缺口', `${radarSubsectors.filter((item) => item.coverage === 'missing').length}`, 'Missing sectors'],
  ['已覆盖', `${radarSubsectors.filter((item) => item.coverage === 'covered').length}`, 'Covered by our research'],
  ['部分覆盖', `${radarSubsectors.filter((item) => item.coverage === 'partial').length}`, 'Needs deeper chain work'],
];

const radarSourceStack = [
  {
    layer: '价格与技术指标',
    screenshotSignals: ['latest price', '1D/5D/1M/3M/6M/YTD/1Y', 'RSI14', 'MACD', 'volatility', 'relative volume', '52W high/low'],
    preferredSources: ['Polygon/Massive 或同级行情 API', 'IEX Cloud / Nasdaq Data Link', '交易所或 SIP 数据'],
    currentStatus: 'missing',
    filterRule: '只用于价格、量、技术状态和异动触发；不能证明产业 thesis。',
  },
  {
    layer: '基本面与估值',
    screenshotSignals: ['revenue', 'gross margin', 'R&D', 'EPS', 'FCF', 'ROE', 'PE/PS/EV-FCF', 'debt ratio'],
    preferredSources: ['SEC EDGAR / companyfacts', '公司 10-K/10-Q/8-K', 'FMP/Polygon/Finnhub 作为结构化 vendor 兜底'],
    currentStatus: 'missing',
    filterRule: '优先 SEC/IR；vendor 数字只能作为索引，关键数值必须回到 filing 或财报材料。',
  },
  {
    layer: '公司事件与新闻',
    screenshotSignals: ['FMP news', 'press release', 'Yahoo Finance source row', 'earnings / corporate actions'],
    preferredSources: ['公司 IR 新闻稿', 'SEC 8-K', 'BusinessWire / GlobeNewswire / PRNewswire 原始稿', 'FMP/Yahoo 只做聚合提示'],
    currentStatus: 'partial',
    filterRule: '聚合新闻必须追到原文；Motley Fool / Yahoo 二手文章不进入核心证据，只能触发待验证任务。',
  },
  {
    layer: '分析师与预期',
    screenshotSignals: ['price target', 'rating', 'forward EPS / PE', 'analyst consensus'],
    preferredSources: ['Finnhub/FMP analyst endpoint', '券商报告摘要', '公司 guidance / earnings call'],
    currentStatus: 'missing',
    filterRule: '只能衡量市场共识和 misclassification；不能作为技术瓶颈证据。',
  },
  {
    layer: 'AI 产业分类与角色',
    screenshotSignals: ['AI industry category', 'AI role', 'AI exposure score', 'investment certainty'],
    preferredSources: ['手工 taxonomy', '公司 segment/KPI', '客户/伙伴披露', '标准组织和行业会议材料'],
    currentStatus: 'partial',
    filterRule: '分类必须能映射到收入暴露或供应链位置；不接受“AI 概念”标签。',
  },
  {
    layer: 'Serenity 深层瓶颈',
    screenshotSignals: ['不是截图主维度；这是我们的增量维度'],
    preferredSources: ['公司 IR/filings', '专利', 'OCP/JEDEC/OFC/ECOC/MLPerf', 'DOE/EIA/FERC/LBNL/NERC', '客户 BOM 和伙伴披露'],
    currentStatus: 'covered',
    filterRule: '用于 thesis 核心；必须同时有供应链位置、供应商数量、财务转译和反证条件。',
  },
  {
    layer: '社区与开发者发现',
    screenshotSignals: ['截图没有明显展示，但类似 Serenity/RPI 路径需要'],
    preferredSources: ['Serenity archive', 'GitHub repo/activity', 'Reddit/X/HN/论坛', '开发者采购讨论'],
    currentStatus: 'partial',
    filterRule: '只做 discovery；除非能映射到采购/缺货/收入，否则不提高置信度。',
  },
];

const radarDimensionAudit = [
  {
    group: 'Universe / Screener',
    screenshotDimensions: ['191 股票池', 'Core 30', 'High Conv. 15', '筛选表', '行业/AI角色/评级/地区/市值/估值/状态过滤'],
    ourStatus: 'missing',
    action: '需要建立 AI Universe registry，而不是只靠 thesis cards；每个 ticker 要有 sector、AI role、coverage status、research priority。',
  },
  {
    group: 'Market / Technical',
    screenshotDimensions: ['最新价', '日内涨跌', '1D/5D/1M/3M/6M/YTD/1Y', 'RSI14', 'MACD', '20D volatility', '成交量/相对成交量', '52W high/low', 'beta'],
    ourStatus: 'missing',
    action: '接行情 API 后只做异动和 risk context；不要用技术指标生成 Serenity thesis。',
  },
  {
    group: 'Fundamental / Valuation',
    screenshotDimensions: ['营收', '毛利率', 'R&D', 'EPS', 'FCF margin', 'ROE', 'PE TTM', 'Forward PE', 'PS', 'EV/FCF', 'FCF yield', 'debt ratio'],
    ourStatus: 'missing',
    action: '用 SEC/IR 为主，vendor 数据做缓存；重点补“财务转译”校验。',
  },
  {
    group: 'AI Exposure Score',
    screenshotDimensions: ['Business Quality', 'Moat', 'AI Exposure', 'Growth', 'Profitability', 'Valuation', 'Momentum', 'Risk', 'Wisdom/Consensus'],
    ourStatus: 'partial',
    action: '我们已有 thesis score，但缺横向股票评分。需要把 Serenity score 和常规质量/估值/动量评分分开。',
  },
  {
    group: 'News / Catalyst',
    screenshotDimensions: ['新闻与事件', 'press release', '财报新闻', '异常波动理由', '来源名和时间'],
    ourStatus: 'partial',
    action: '已有 RSS/事件流，但缺 ticker 绑定、事件分类、source quality 和去噪规则。',
  },
  {
    group: 'Industry Heatmap',
    screenshotDimensions: ['20 个 AI layer', '每层股票数', '涨跌统计', '强弱/RS 排名'],
    ourStatus: 'partial',
    action: '已补板块审计，但还没接入真实 universe 和层内统计。',
  },
  {
    group: 'Supply-chain Thesis',
    screenshotDimensions: ['截图弱；右侧 AI 角色里有部分描述'],
    ourStatus: 'covered',
    action: '这是我们相比截图应该强化的维度：需求链、瓶颈、供应商数量、public carrier、验证/反证。',
  },
];

const challengeGateRules = [
  {
    name: '状态机',
    status: 'required',
    rule: 'Research Run 只能按 V2 状态机推进，并且只能关闭为 closed_no_candidate 或 closed_candidate_found。',
    failAction: '关闭条件不足时保持 active_research；只有硬阻塞才标记 blocked。',
  },
  {
    name: '候选挑战',
    status: 'required',
    rule: '升级前回答为什么现在、替代路线、遗漏供应商、业务纯度、定价、最强 bear case 和证伪条件等 14 条问题。',
    failAction: '任一问题答不清，不能升级为 high_conviction_candidate。',
  },
  {
    name: '反方搜索',
    status: 'required',
    rule: '每个 surviving candidate 至少 3 条 counter-search：替代路线、内部供应、扩产、稀释、延迟采用、short report。',
    failAction: '反方不足时，标记 Active Research，不给高置信评分。',
  },
  {
    name: '最低证据门槛',
    status: 'required',
    rule: '3+ Core Evidence、2+ 独立来源家族、1+ 非候选公司来源，并记录证据元数据、财务路径、定价分析和 falsifier。',
    failAction: '未满足时不得关闭 Research Run。',
  },
  {
    name: '同步门槛',
    status: 'required',
    rule: '关闭前必须同步动态看板、Obsidian、关闭报告和下一轮 Research Run 队列。',
    failAction: 'Obsidian 同步失败时保持 active_research 或标记 blocked。',
  },
];

const challengeQueries = [
  '<company/market> competitor supplier',
  '<technology> alternative',
  '<customer> internal sourcing',
  '<component> capacity expansion',
  '<company> gross margin risk',
  '<company> dilution debt cash burn',
  '<technology> delayed adoption',
  '<standard> not adopted',
  '<company> short report',
];

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
            <strong>Information Gain</strong>
            <span>美股信息优势与 AI 前沿工作台</span>
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
            <span className="eyebrow">Information Gain</span>
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

        {path === '/realtime-flow' && <RealtimeFlow />}
        {path === '/research-queue' && <ResearchQueue />}
        {path === '/serenity-research' && <SerenityResearch />}
        {path === '/ai-stock-radar' && <AiStockRadar />}
        {path === '/official-holdings' && <OfficialHoldings />}
        {path === '/about-ai' && <AboutAi />}
        {path === '/voc-insights' && <VocInsights />}
      </main>
    </div>
  );
}

function normalizePath(rawPath) {
  if (routes.some((route) => route.path === rawPath)) return rawPath;
  return routes[0].path;
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

function formatEventTime(value) {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '--';
  return `${Math.round(parsed * 100)}%`;
}

function formatMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return '--';
  if (parsed >= 1_000_000_000) return `$${(parsed / 1_000_000_000).toFixed(1)}B`;
  if (parsed >= 1_000_000) return `$${(parsed / 1_000_000).toFixed(1)}M`;
  if (parsed >= 1_000) return `$${Math.round(parsed / 1_000)}K`;
  return `$${Math.round(parsed)}`;
}

function formatDateShort(value) {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  });
}

function joinCompact(items, fallback = '暂无') {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  return values.length ? values.join('、') : fallback;
}

function formatQueueStatus(status) {
  const labels = {
    queued: '待研究',
    in_progress: '研究中',
    done: '已完成',
    blocked: '阻塞',
  };
  return labels[status] || status || '待研究';
}

function formatTicker(value) {
  const ticker = String(value || '').replace(/^\$/, '').trim().toUpperCase();
  return ticker ? `$${ticker}` : '待定义';
}

function scoreClass(score) {
  if (score >= 82) return 'score-badge strong';
  if (score >= 70) return 'score-badge watch';
  return 'score-badge muted';
}

function coverageLabel(value) {
  if (value === 'covered') return '已覆盖';
  if (value === 'partial') return '部分覆盖';
  if (value === 'missing') return '遗漏';
  return '未标记';
}

function formatSourceType(type) {
  const labels = {
    live_tv: '直播',
    official: '官方',
    macro: '宏观',
    market_media: '媒体',
    social: '社交',
    ai_frontier: 'AI',
    political_disclosure: '官员持仓',
    community_alpha: '社区Alpha',
  };
  return labels[type] || type || '未知';
}

function formatTrustTier(tier) {
  const labels = {
    primary_official: '一手官方',
    primary_company: '公司一手',
    professional_media: '专业媒体',
    secondary_interpretation: '二手解读',
    social_discovery: '舆情发现',
    public_records_aggregator: '公开记录聚合',
  };
  return labels[tier] || tier || '未标记';
}

function RealtimeFlow() {
  const [sources, setSources] = useState([]);
  const [eventsData, setEventsData] = useState({ events: [], summary: {}, sourceHealth: {} });
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('');
  const [activeType, setActiveType] = useState('all');

  const loadRealtime = async ({ refresh = false } = {}) => {
    setState('loading');
    setMessage('');
    try {
      const [sourcePayload, eventPayload] = await Promise.all([
        apiFetch('/api/source-registry'),
        apiFetch(`/api/events?limit=60${refresh ? '&refresh=1' : ''}`),
      ]);
      setSources(sourcePayload.sources || []);
      setEventsData(eventPayload);
      setState('ready');
    } catch (error) {
      setState('error');
      setMessage('实时事件接口暂不可用，请检查后端服务。');
    }
  };

  useEffect(() => {
    loadRealtime();
  }, []);

  const addToResearchQueue = async (event) => {
    setMessage('正在加入研究队列');
    try {
      await apiFetch('/api/research/queue', {
        method: 'POST',
        body: JSON.stringify({ event }),
      });
      setMessage('已加入研究队列');
    } catch (error) {
      setMessage('加入研究队列失败');
    }
  };

  const events = eventsData.events || [];
  const sourceTypes = ['all', ...Array.from(new Set(sources.map((source) => source.type)))];
  const visibleSources = activeType === 'all' ? sources : sources.filter((source) => source.type === activeType);
  const liveSources = sources.filter((source) => source.type === 'live_tv');
  const officialSources = sources.filter((source) => ['official', 'macro'].includes(source.type));
  const needsVerification = events.filter((event) => event.verification?.needsVerification).length;
  const health = eventsData.sourceHealth || {};

  return (
    <section className="workspace-grid">
      <div className="wide-panel realtime-hero">
        <div className="hero-copy">
          <span className="badge blue">Phase 1 · Source Registry + Event Flow</span>
          <h2>把直播、官方源、媒体和 AI 前沿统一成可验证事件流</h2>
        </div>
        <div className="metric-strip">
          <Metric icon={Radio} label="直播候选源" value={liveSources.length} />
          <Metric icon={ShieldCheck} label="官方与宏观源" value={officialSources.length} />
          <Metric icon={Database} label="当前事件" value={events.length} />
        </div>
      </div>

      <div className="content-panel span-2">
        <PanelHeader icon={Radio} title="实时事件流" meta={eventsData.generatedAt ? `${formatEventTime(eventsData.generatedAt)} 更新` : '等待同步'} />
        <div className="briefing-tools">
          <span className={`data-state ${state}`}>{state === 'loading' ? '同步中' : state === 'error' ? message : `${health.ok || 0}/${health.total || 0} RSS 正常`}</span>
          <div className="toolbar-actions">
            <button className="small-button" onClick={() => loadRealtime({ refresh: true })} disabled={state === 'loading'}>
              <RefreshCcw size={14} />
              <span>刷新事件</span>
            </button>
          </div>
        </div>

        {message && state !== 'error' && <div className="inline-note">{message}</div>}

        <div className="event-list">
          {events.length ? (
            events.map((event) => (
              <article className="event-card" key={event.id}>
                <div className="row-head">
                  <span>{formatSourceType(event.source?.type)} · {event.source?.name || '未知来源'}</span>
                  <span>{formatEventTime(event.publishedAt)}</span>
                </div>
                <h3>{event.url ? <a href={event.url} target="_blank" rel="noreferrer">{event.title}</a> : event.title}</h3>
                <p>{event.summary}</p>
                <div className="event-meta-grid">
                  <div>
                    <strong>标的</strong>
                    <span>{joinCompact(event.tickers)}</span>
                  </div>
                  <div>
                    <strong>主题</strong>
                    <span>{joinCompact(event.themes?.slice(0, 4))}</span>
                  </div>
                  <div>
                    <strong>置信度</strong>
                    <span>{formatPercent(event.score?.confidence)}</span>
                  </div>
                </div>
                <div className="event-actions">
                  <span className={event.verification?.needsVerification ? 'verify-pill warning' : 'verify-pill'}>
                    {event.verification?.needsVerification ? '待交叉验证' : '已验证'}
                  </span>
                  <button className="small-button" onClick={() => addToResearchQueue(event)}>
                    <ListChecks size={14} />
                    <span>加入研究</span>
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <Radio size={24} />
              <strong>{state === 'loading' ? '正在构建事件流' : '暂无事件'}</strong>
              <span>{state === 'error' ? message : '后续直播 ASR 和 RSS 会进入这里。'}</span>
            </div>
          )}
        </div>
      </div>

      <div className="content-panel">
        <PanelHeader icon={Database} title="源注册表" meta={`${visibleSources.length}/${sources.length || 0} 个`} />
        <div className="source-filter-row">
          {sourceTypes.map((type) => (
            <button className={activeType === type ? 'selected' : ''} key={type} onClick={() => setActiveType(type)}>
              {type === 'all' ? '全部' : formatSourceType(type)}
            </button>
          ))}
        </div>
        <div className="registry-list">
          {visibleSources.slice(0, 18).map((source) => (
            <div className="registry-row" key={source.id}>
              <div>
                <strong>{source.name}</strong>
                <span>{source.group} · {formatTrustTier(source.trustTier)} · {source.captureMethod}</span>
              </div>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer" title="打开源">
                  <ExternalLink size={15} />
                </a>
              ) : (
                <span className="status-text">{source.status}</span>
              )}
            </div>
          ))}
        </div>
        <div className="source-health">
          <div>
            <strong>验证压力</strong>
            <span>{needsVerification} 条待验证</span>
          </div>
          <p>
            <span>直播源边界</span>
            <small>只采集当前机器可合法播放的音频，不绕 DRM。</small>
          </p>
        </div>
      </div>
    </section>
  );
}

function ResearchQueue() {
  const [queueData, setQueueData] = useState({ items: [], summary: {} });
  const [eventsData, setEventsData] = useState({ events: [] });
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('');
  const [question, setQuestion] = useState('NVDA / AI capex：市场是否低估 hyperscaler 资本开支持续性？');
  const [tickers, setTickers] = useState('NVDA, MSFT, GOOG, AMZN, AMD, AVGO');
  const [statusFilter, setStatusFilter] = useState('all');
  const [actionItemId, setActionItemId] = useState('');

  const loadQueue = async () => {
    setState('loading');
    setMessage('');
    try {
      const [queuePayload, eventPayload] = await Promise.all([
        apiFetch('/api/research/queue'),
        apiFetch('/api/events?limit=12'),
      ]);
      setQueueData(queuePayload);
      setEventsData(eventPayload);
      setState('ready');
    } catch (error) {
      setState('error');
      setMessage('研究队列接口暂不可用。');
    }
  };

  useEffect(() => {
    loadQueue();
  }, []);

  const createManualTask = async () => {
    setMessage('正在创建研究任务');
    try {
      await apiFetch('/api/research/queue', {
        method: 'POST',
        body: JSON.stringify({ question, tickers }),
      });
      setMessage('已创建研究任务');
      await loadQueue();
    } catch (error) {
      setMessage('创建研究任务失败');
    }
  };

  const createFromEvent = async (event) => {
    setMessage('正在从事件创建研究任务');
    try {
      await apiFetch('/api/research/queue', {
        method: 'POST',
        body: JSON.stringify({ event }),
      });
      setMessage('已加入研究队列');
      await loadQueue();
    } catch (error) {
      setMessage('加入研究队列失败');
    }
  };

  const updateQueueStatus = async (item, status) => {
    let payload = {
      status,
      actor: 'research-queue-ui',
      reason: `Manual transition to ${status}.`,
    };

    if (status === 'done') {
      const resultSummary = window.prompt('完成这条研究任务的结论摘要是什么？');
      if (!resultSummary) return;
      const serenityLoopJson = window.prompt('粘贴 Main Research Agent 的 Serenity loop JSON。缺少该 JSON 不能标记 done。');
      if (!serenityLoopJson) return;
      const challengeReviewJson = window.prompt('粘贴 Serenity Challenge Agent review JSON。缺少该 JSON 不能标记 done。');
      if (!challengeReviewJson) return;
      let serenityLoop;
      let challengeReview;
      try {
        serenityLoop = JSON.parse(serenityLoopJson);
        challengeReview = JSON.parse(challengeReviewJson);
      } catch (error) {
        setMessage('完成失败：Serenity loop 或 Challenge review 不是合法 JSON');
        return;
      }
      payload = {
        ...payload,
        resultSummary,
        serenityLoop,
        challengeReview,
        reason: 'Marked done from research queue UI.',
      };
    }

    if (status === 'blocked') {
      const reason = window.prompt('这条任务为什么阻塞？');
      if (!reason) return;
      payload = {
        ...payload,
        reason,
      };
    }

    setActionItemId(item.id);
    setMessage('正在更新研究任务状态');
    try {
      await apiFetch(`/api/research/queue/${encodeURIComponent(item.id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setMessage('研究任务状态已更新');
      await loadQueue();
    } catch (error) {
      setMessage('更新研究任务状态失败');
    } finally {
      setActionItemId('');
    }
  };

  const items = queueData.items || [];
  const statusOptions = useMemo(() => {
    const values = ['all', 'queued', 'in_progress', 'blocked', 'done'];
    return values.map((value) => ({
      value,
      label: value === 'all' ? '全部' : formatQueueStatus(value),
      count: value === 'all' ? items.length : items.filter((item) => (item.status || 'queued') === value).length,
    }));
  }, [items]);
  const visibleItems = useMemo(() => (
    statusFilter === 'all'
      ? items
      : items.filter((item) => (item.status || 'queued') === statusFilter)
  ), [items, statusFilter]);
  const suggestedEvents = (eventsData.events || []).filter((event) => event.tickers?.length).slice(0, 5);

  return (
    <section className="workspace-grid">
      <div className="wide-panel research-hero">
        <div className="hero-copy">
          <span className="badge green">Research Queue · Evidence First</span>
          <h2>事件先进入研究队列，再产出证据链 memo 和自省问题</h2>
        </div>
        <div className="metric-strip">
          <Metric icon={ListChecks} label="队列任务" value={items.length} />
          <Metric icon={Clock3} label="待研究" value={(queueData.summary?.byStatus?.queued || 0)} />
          <Metric icon={Rocket} label="研究中" value={(queueData.summary?.byStatus?.in_progress || 0)} />
          <Metric icon={ShieldCheck} label="高优先级" value={items.filter((item) => item.priority <= 2).length} />
        </div>
      </div>

      <div className="content-panel">
        <PanelHeader icon={FileSearch} title="手动加入研究问题" meta={state === 'loading' ? '同步中' : '可创建'} />
        <label className="field">
          <span>核心问题</span>
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={5} />
        </label>
        <label className="field">
          <span>相关标的</span>
          <input value={tickers} onChange={(event) => setTickers(event.target.value)} />
        </label>
        <button className="primary-action" onClick={createManualTask}>
          <ListChecks size={18} />
          <span>加入研究队列</span>
        </button>
        {message && <div className="inline-note">{message}</div>}
      </div>

      <div className="content-panel span-2">
        <PanelHeader icon={ListChecks} title="研究队列" meta={`${visibleItems.length}/${items.length} 个任务`} />
        <div className="source-filter-row">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              className={statusFilter === option.value ? 'selected' : ''}
              onClick={() => setStatusFilter(option.value)}
            >
              {option.label} · {option.count}
            </button>
          ))}
        </div>
        <div className="queue-list">
          {visibleItems.length ? (
            visibleItems.map((item) => (
              <article className="queue-card" key={item.id}>
                <div className="row-head">
                  <span>Priority {item.priority} · {formatQueueStatus(item.status)}</span>
                  <span>{formatEventTime(item.createdAt)}</span>
                </div>
                <h3>{item.question}</h3>
                <div className="tag-list">
                  {(item.tickers || []).map((ticker) => <span key={ticker}>{ticker}</span>)}
                  {(item.themes || []).slice(0, 4).map((theme) => <span key={theme}>{theme}</span>)}
                </div>
                <div className="memo-grid">
                  <div>
                    <strong>必须收集证据</strong>
                    <ul>{(item.memoSkeleton?.requiredEvidence || []).slice(0, 3).map((value) => <li key={value}>{value}</li>)}</ul>
                  </div>
                  <div>
                    <strong>自省问题</strong>
                    <ul>{(item.memoSkeleton?.counterEvidencePrompts || []).slice(0, 3).map((value) => <li key={value}>{value}</li>)}</ul>
                  </div>
                </div>
                <div className="queue-action-row">
                  {(item.status || 'queued') === 'queued' && (
                    <button className="small-button" onClick={() => updateQueueStatus(item, 'in_progress')} disabled={actionItemId === item.id}>
                      <Rocket size={14} />
                      <span>开始</span>
                    </button>
                  )}
                  {(item.status || 'queued') === 'in_progress' && (
                    <>
                      <button className="small-button" onClick={() => updateQueueStatus(item, 'done')} disabled={actionItemId === item.id}>
                        <Check size={14} />
                        <span>完成</span>
                      </button>
                      <button className="small-button" onClick={() => updateQueueStatus(item, 'blocked')} disabled={actionItemId === item.id}>
                        <ShieldCheck size={14} />
                        <span>阻塞</span>
                      </button>
                    </>
                  )}
                  {['blocked', 'done'].includes(item.status) && (
                    <button className="small-button" onClick={() => updateQueueStatus(item, 'queued')} disabled={actionItemId === item.id}>
                      <RefreshCcw size={14} />
                      <span>重新排队</span>
                    </button>
                  )}
                  {item.memoPath && <span className="status-text">Memo 已生成</span>}
                  {item.obsidianMemoPath && <span className="status-text">Obsidian 已同步</span>}
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <ListChecks size={24} />
              <strong>{state === 'loading' ? '正在读取研究队列' : '暂无研究任务'}</strong>
              <span>{state === 'error' ? message : '可以手动加入问题，或从实时事件生成任务。'}</span>
            </div>
          )}
        </div>
      </div>

      <div className="content-panel span-3">
        <PanelHeader icon={Database} title="可转研究的近期事件" meta={`${suggestedEvents.length} 条`} />
        <div className="suggested-event-grid">
          {suggestedEvents.map((event) => (
            <article className="suggested-event" key={event.id}>
              <div>
                <strong>{event.title}</strong>
                <span>{event.source?.name} · {joinCompact(event.tickers)}</span>
              </div>
              <button className="small-button" onClick={() => createFromEvent(event)}>
                <ListChecks size={14} />
                <span>加入</span>
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function SerenityResearch() {
  const [payload, setPayload] = useState({
    methodology: [],
    focusAreas: [],
    summary: {},
    thesisCards: [],
    topSymbols: [],
    evidenceFeed: [],
    discoveryRuns: [],
    protocol: {},
    source: {},
  });
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('');
  const [selectedFocus, setSelectedFocus] = useState('all');
  const [activeCardId, setActiveCardId] = useState('');
  const [builder, setBuilder] = useState({
    title: '',
    primaryTicker: '',
    tickers: '',
    focusArea: 'AI 光通信 / CPO',
    layer: '第三层：待定义供应链层级',
    demandSource: '',
    chain: '',
    chokepoint: '',
    businessCarrier: '',
    financialTranslation: '',
    marketMisclassification: '',
    validationSignals: '',
    falsifiers: '',
    keywords: '',
  });

  const loadSystem = async () => {
    setState('loading');
    setMessage('');
    try {
      const data = await apiFetch('/api/serenity/research-system');
      setPayload({
        ...data,
        methodology: Array.isArray(data.methodology) ? data.methodology : [],
        focusAreas: Array.isArray(data.focusAreas) ? data.focusAreas : [],
        thesisCards: Array.isArray(data.thesisCards) ? data.thesisCards : [],
        topSymbols: Array.isArray(data.topSymbols) ? data.topSymbols : [],
        evidenceFeed: Array.isArray(data.evidenceFeed) ? data.evidenceFeed : [],
        discoveryRuns: Array.isArray(data.discoveryRuns) ? data.discoveryRuns : [],
      });
      setState('ready');
    } catch (error) {
      setState('error');
      setMessage('Serenity 研究系统接口暂不可用。');
    }
  };

  useEffect(() => {
    loadSystem();
  }, []);

  const updateBuilder = (key, value) => {
    setBuilder((current) => ({ ...current, [key]: value }));
  };

  const createCustomCard = async () => {
    setMessage('正在保存候选卡');
    try {
      await apiFetch('/api/serenity/thesis-cards', {
        method: 'POST',
        body: JSON.stringify(builder),
      });
      setMessage('已保存候选卡');
      setBuilder((current) => ({
        ...current,
        title: '',
        primaryTicker: '',
        tickers: '',
        demandSource: '',
        chain: '',
        chokepoint: '',
        businessCarrier: '',
        financialTranslation: '',
        marketMisclassification: '',
        validationSignals: '',
        falsifiers: '',
        keywords: '',
      }));
      await loadSystem();
    } catch (error) {
      setMessage('保存候选卡失败：需要标题、需求源和瓶颈。');
    }
  };

  const addToResearchQueue = async (card) => {
    setActiveCardId(card.id);
    setMessage('正在加入研究队列');
    try {
      await apiFetch(`/api/serenity/thesis-cards/${encodeURIComponent(card.id)}/research`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setMessage(`${formatTicker(card.primaryTicker)} 已加入研究队列`);
    } catch (error) {
      setMessage('加入研究队列失败');
    } finally {
      setActiveCardId('');
    }
  };

  const summary = payload.summary || {};
  const cards = payload.thesisCards || [];
  const focusOptions = payload.focusAreas || [];
  const visibleCards = selectedFocus === 'all' ? cards : cards.filter((card) => card.focusArea === selectedFocus);
  const topSymbols = (payload.topSymbols || []).slice(0, 12);
  const evidenceFeed = (payload.evidenceFeed || []).slice(0, 8);
  const discoveryRuns = payload.discoveryRuns || [];
  const activeRun = discoveryRuns[0] || null;
  const activeValidation = activeRun?.validation || {};
  const activeConfig = activeRun?.run_config || {};
  const failedCloseChecks = (activeValidation.checks || []).filter((item) => !item.passed);
  const candidateValidation = new Map((activeValidation.candidate_results || []).map((item) => [item.ticker || item.name, item]));

  return (
    <section className="workspace-grid">
      <div className="wide-panel serenity-hero">
        <div className="hero-copy">
          <span className="badge blue">Serenity Method · Bottleneck First</span>
          <h2>从顶层需求拆到供应链瓶颈，再把候选标的转成可验证 thesis</h2>
        </div>
        <div className="metric-strip">
          <Metric icon={Database} label="Archive 记录" value={summary.archiveRecords || 0} />
          <Metric icon={FileSearch} label="Thesis cards" value={summary.thesisCards || 0} />
          <Metric icon={ShieldCheck} label="高分候选" value={summary.highScoreCards || 0} />
        </div>
      </div>

      <div className="content-panel span-3">
        <PanelHeader icon={Search} title="线性方法论" meta={payload.generatedAt ? `${formatEventTime(payload.generatedAt)} 更新` : state === 'loading' ? '同步中' : '本地'} />
        <div className="serenity-pipeline">
          {(payload.methodology || []).map((step, index) => (
            <article className="method-step" key={step.id || step.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{step.title}</strong>
              <p>{step.prompt}</p>
              <small>{step.output}</small>
            </article>
          ))}
        </div>
      </div>

      <div className="content-panel span-3">
        <PanelHeader icon={Globe2} title="新市场 Discovery Runs" meta={`${discoveryRuns.length} runs · ${activeRun?.cadence || 'waiting'}`} />
        {activeRun ? (
          <div className="discovery-layout">
            <article className="discovery-summary">
              <div className="run-badge-row">
                <span className="badge amber">{activeRun.status}</span>
                <span className={`badge ${activeValidation.can_close ? 'green' : 'blue'}`}>
                  {activeValidation.can_close ? 'Close gate passed' : 'Cannot close'}
                </span>
              </div>
              <h3>{activeRun.title}</h3>
              <p>{activeRun.objective}</p>
              <strong>顶层需求</strong>
              <p>{activeRun.topLevelDemand || '未记录'}</p>
              <strong>当前答案</strong>
              <p>{activeRun.currentAnswer}</p>
              <small>
                {activeConfig.run_id || activeRun.id} · {activeConfig.run_mode || 'legacy'} · Market data {formatDateShort(activeConfig.market_data_as_of)}
              </small>
              <div className="run-metric-row">
                <span>Search {activeValidation.metrics?.search_rows || 0}</span>
                <span>Core {activeValidation.metrics?.core_evidence_rows || 0}</span>
                <span>Families {activeValidation.metrics?.independent_source_families || 0}</span>
                <span>Red {activeValidation.metrics?.challenge_rows || 0}</span>
              </div>
            </article>
            <div className="market-map-grid">
              {(activeRun.markets || []).slice(0, 6).map((market) => (
                <article className="market-map-card" key={market.market}>
                  <div className="market-card-head">
                    <strong>{market.market}</strong>
                    <span>{market.coverageStatus || 'coverage_insufficient'}</span>
                  </div>
                  <p>{market.chokepoint}</p>
                  <div className="serenity-chain mini">
                    {(market.demandChain || []).slice(0, 5).map((item) => <span key={item}>{item}</span>)}
                  </div>
                  <small>{market.supplierCount} · {market.capacityExpansionLeadTime || '扩产周期未记录'}</small>
                  {market.listedCarrierScreening && <small>上市载体筛选：{market.listedCarrierScreening}</small>}
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <Globe2 size={24} />
            <strong>暂无 discovery run</strong>
            <span>下一轮 research 会把搜索与推理过程写入这里。</span>
          </div>
        )}
      </div>

      {activeRun && (
        <>
          <div className="content-panel span-2">
            <PanelHeader
              icon={ShieldCheck}
              title="V2 关闭门槛"
              meta={`${(activeValidation.checks || []).length - failedCloseChecks.length}/${(activeValidation.checks || []).length} passed`}
            />
            <div className="validation-grid">
              {(activeValidation.checks || []).map((item) => (
                <article className={`validation-row ${item.passed ? 'passed' : 'failed'}`} key={item.id}>
                  <span>{item.passed ? 'PASS' : 'OPEN'}</span>
                  <div>
                    <strong>{item.label}</strong>
                    {item.detail && <small>{item.detail}</small>}
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="content-panel">
            <PanelHeader icon={Settings2} title="Research Run 配置" meta={`Protocol ${payload.protocol?.version || 'V2'}`} />
            <div className="run-config-list">
              <div><span>Run ID</span><strong>{activeConfig.run_id || activeRun.id}</strong></div>
              <div><span>Mode</span><strong>{activeConfig.run_mode || '未记录'}</strong></div>
              <div><span>Research date</span><strong>{formatDateShort(activeConfig.research_date)}</strong></div>
              <div><span>Market data</span><strong>{formatDateShort(activeConfig.market_data_as_of)}</strong></div>
              <div><span>Universe</span><strong>{activeConfig.investment_universe || '未记录'}</strong></div>
              <div><span>Exchanges</span><strong>{(activeConfig.included_exchanges || []).join(', ') || '未记录'}</strong></div>
              <div><span>Regions</span><strong>{(activeConfig.included_regions || []).join(', ') || '未记录'}</strong></div>
              <div><span>Market cap</span><strong>{activeConfig.market_cap_min ?? 'open'} - {activeConfig.market_cap_max ?? 'open'}</strong></div>
              <div><span>Minimum ADTV</span><strong>{activeConfig.minimum_average_daily_traded_value ?? '未记录'}</strong></div>
              <div><span>Maximum analysts</span><strong>{activeConfig.maximum_analyst_coverage ?? '未记录'}</strong></div>
              <div><span>Minimum exposure</span><strong>{activeConfig.minimum_revenue_exposure ?? '未记录'}</strong></div>
              <div><span>Maximum suppliers</span><strong>{activeConfig.maximum_supplier_count_for_bottleneck ?? '未记录'}</strong></div>
              <div><span>Expansion lead time</span><strong>{activeConfig.minimum_capacity_expansion_lead_time || '未记录'}</strong></div>
              <div><span>Search budget</span><strong>{activeConfig.search_budget || 0}</strong></div>
              <div><span>Source budget</span><strong>{activeConfig.source_budget || 0}</strong></div>
              <div><span>Dashboard sync</span><strong>{activeRun.sync?.dashboard?.status || 'pending'}</strong></div>
              <div><span>Obsidian sync</span><strong>{activeRun.sync?.obsidian?.status || 'pending'}</strong></div>
            </div>
            <p className="inline-note">{activeRun.sync?.obsidian?.note_path || payload.source?.obsidianDirectory || 'Obsidian note path 未生成'}</p>
          </div>

          <div className="content-panel span-2">
            <PanelHeader icon={Search} title="搜索账本" meta={`${activeRun.searchLedger?.length || 0} 条`} />
            <div className="ledger-list">
              {(activeRun.searchLedger || []).map((row) => (
                <article className="ledger-row" key={`${row.source}-${row.url}`}>
                  <div>
                    <strong>{row.source}</strong>
                    <span>{row.sourceType} · {row.allowedUse || 'unclassified'} · {formatDateShort(row.checkedAt)}</span>
                  </div>
                  <p>{row.why}</p>
                  <p>{row.finding}</p>
                  <small>{row.impact}</small>
                  {row.url && (
                    <a href={row.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={13} />
                      <span>Source</span>
                    </a>
                  )}
                </article>
              ))}
            </div>
          </div>

          <div className="content-panel">
            <PanelHeader icon={ShieldCheck} title="推理账本" meta={`${activeRun.reasoningLedger?.length || 0} steps`} />
            <div className="reasoning-list">
              {(activeRun.reasoningLedger || []).map((row) => (
                <article className="reasoning-row" key={`${row.step}-${row.hypothesis}`}>
                  <span>Step {row.step || '-'}</span>
                  <strong>{row.hypothesis}</strong>
                  <p>{row.inference}</p>
                  <small>{row.claimStatus || 'unknown'} · {row.confidence} · Next: {row.nextUncertainty}</small>
                </article>
              ))}
            </div>
          </div>

          <div className="content-panel span-2">
            <PanelHeader icon={Database} title="证据账本" meta={`${activeRun.evidenceLedger?.length || 0} evidence rows`} />
            <div className="evidence-ledger-grid">
              {(activeRun.evidenceLedger || []).map((row) => (
                <article className="evidence-ledger-row" key={row.id || `${row.source}-${row.url}`}>
                  <div>
                    <span className={`badge ${row.allowedUse === 'core_evidence' ? 'green' : 'blue'}`}>{row.allowedUse}</span>
                    <strong>{row.originalSource || row.source}</strong>
                    <small>{row.sourceFamily || 'source family 未记录'} · {row.claimStatus || 'unknown'}</small>
                  </div>
                  <p>{row.finding}</p>
                  <small>限制：{row.limitations || '未记录'}</small>
                  {row.url && <a href={row.url} target="_blank" rel="noreferrer">Source</a>}
                </article>
              ))}
            </div>
          </div>

          <div className="content-panel">
            <PanelHeader icon={ShieldCheck} title="Challenge / Red Team" meta={`${activeRun.challengeLedger?.length || 0} rows`} />
            <div className="challenge-summary-list">
              {(activeRun.challengeLedger || []).map((row) => (
                <article key={`${row.challenge}-${row.query}`}>
                  <strong>{row.challenge}</strong>
                  <p>{row.result}</p>
                  <small>{row.impact} · {row.nextAction}</small>
                </article>
              ))}
            </div>
            <div className="unknown-list">
              <strong>未知项与数据缺口</strong>
              <ul>{(activeRun.unknowns || []).map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          </div>

          <div className="content-panel span-2">
            <PanelHeader icon={BarChart3} title="候选标的与淘汰项" meta={`${activeRun.candidates?.length || 0} candidates`} />
            <div className="candidate-grid">
              {(activeRun.candidates || []).map((candidate) => (
                <article className="candidate-card" key={`${candidate.ticker}-${candidate.name}`}>
                  <div className="thesis-card-head">
                    <div>
                      <div className="run-badge-row">
                        <span className="badge blue">{candidate.market}</span>
                        <span className="badge amber">{candidate.status || 'screening'}</span>
                      </div>
                      <h3>{candidate.ticker ? formatTicker(candidate.ticker) : candidate.name}</h3>
                      <p>{candidate.publicExposure}</p>
                    </div>
                    <span className={scoreClass(candidate.score)}>{candidate.score}</span>
                  </div>
                  <strong>为什么暂时保留</strong>
                  <p>{candidate.whySurvives}</p>
                  <strong>关键反证</strong>
                  <p>{candidate.keyFalsifier}</p>
                  <small>
                    Fatal Gate: {candidateValidation.get(candidate.ticker || candidate.name)?.fatal_gate_passed ? 'pass' : 'open'} · Score fields: {candidateValidation.get(candidate.ticker || candidate.name)?.score_fields_complete ? 'complete' : 'open'} · {candidate.nextEvidence}
                  </small>
                </article>
              ))}
              {(activeRun.rejected || []).map((item) => (
                <article className="candidate-card rejected" key={item.target}>
                  <span className="badge amber">Rejected</span>
                  <h3>{item.target}</h3>
                  <p>{item.reason}</p>
                  <small>{item.recheckTrigger}</small>
                </article>
              ))}
            </div>
          </div>

          <div className="content-panel">
            <PanelHeader icon={Clock3} title="下一轮 24-72h research" meta={`${activeRun.nextQueue?.length || 0} tasks`} />
            <div className="next-queue">
              {(activeRun.nextQueue || []).map((item) => (
                <article className="next-task" key={item.task}>
                  <span>Priority {item.priority}</span>
                  <strong>{item.task}</strong>
                  <p>{item.sourceToInspect}</p>
                  <small>反证：{item.falsifier}</small>
                </article>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="content-panel">
        <PanelHeader icon={SlidersHorizontal} title="研究焦点" meta={`${focusOptions.length} 条线`} />
        <div className="source-filter-row compact-filter">
          <button className={selectedFocus === 'all' ? 'selected' : ''} onClick={() => setSelectedFocus('all')}>全部</button>
          {focusOptions.map((area) => (
            <button
              key={area.title}
              className={selectedFocus === area.title ? 'selected' : ''}
              onClick={() => setSelectedFocus(area.title)}
            >
              {area.title}
            </button>
          ))}
        </div>
        <div className="focus-list">
          {focusOptions.map((area) => (
            <article className="focus-row" key={area.id || area.title}>
              <div>
                <strong>{area.title}</strong>
                <span>{area.why}</span>
              </div>
              <small>{area.cardCount || 0} cards</small>
            </article>
          ))}
        </div>
      </div>

      <div className="content-panel span-2">
        <PanelHeader icon={FileSearch} title="Serenity thesis cards" meta={`${visibleCards.length}/${cards.length} 个`} />
        <div className="thesis-grid">
          {visibleCards.length ? (
            visibleCards.map((card) => (
              <article className="thesis-card" key={card.id}>
                <div className="thesis-card-head">
                  <div>
                    <span className="badge green">{card.focusArea}</span>
                    <h3>{card.title}</h3>
                    <div className="tag-list">
                      <span>{formatTicker(card.primaryTicker)}</span>
                      <span>{card.layer}</span>
                      <span>{card.status}</span>
                    </div>
                  </div>
                  <span className={scoreClass(card.score)}>{card.score}</span>
                </div>

                <div className="serenity-chain">
                  {(card.chain || []).slice(0, 6).map((item) => <span key={item}>{item}</span>)}
                </div>

                <div className="thesis-columns">
                  <div>
                    <strong>需求源</strong>
                    <p>{card.demandSource || '待补充'}</p>
                  </div>
                  <div>
                    <strong>瓶颈</strong>
                    <p>{card.chokepoint || '待补充'}</p>
                  </div>
                  <div>
                    <strong>财务转译</strong>
                    <p>{card.financialTranslation || '待补充'}</p>
                  </div>
                  <div>
                    <strong>市场误分类</strong>
                    <p>{card.marketMisclassification || '待补充'}</p>
                  </div>
                </div>

                <div className="thesis-checks">
                  <div>
                    <strong>验证信号</strong>
                    <ul>{(card.validationSignals || []).slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                  <div>
                    <strong>反证条件</strong>
                    <ul>{(card.falsifiers || []).slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                </div>

                <div className="evidence-strip">
                  <span>{card.stats?.postCount || 0} archive hits</span>
                  <span>{card.stats?.engagement || 0} engagement</span>
                  <span>{card.stats?.lastSeen ? formatDateShort(card.stats.lastSeen) : '未命中'}</span>
                </div>

                <div className="evidence-stack">
                  {(card.evidence || []).slice(0, 3).map((item) => (
                    <a href={item.url} target="_blank" rel="noreferrer" key={item.id || item.url || item.text}>
                      <span>{formatDateShort(item.date)} · {joinCompact((item.tickers || []).map(formatTicker), '无 ticker')}</span>
                      <p>{item.text}</p>
                    </a>
                  ))}
                </div>

                <button className="primary-action compact" onClick={() => addToResearchQueue(card)} disabled={activeCardId === card.id}>
                  <ListChecks size={18} />
                  <span>{activeCardId === card.id ? '加入中' : '加入研究队列'}</span>
                </button>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <FileSearch size={24} />
              <strong>{state === 'loading' ? '正在读取 Serenity archive' : '暂无候选卡'}</strong>
              <span>{state === 'error' ? message : '切换焦点或创建新的候选卡。'}</span>
            </div>
          )}
        </div>
      </div>

      <div className="content-panel">
        <PanelHeader icon={Rocket} title="候选卡构建器" meta="线性 thesis" />
        <label className="field">
          <span>标题</span>
          <input value={builder.title} onChange={(event) => updateBuilder('title', event.target.value)} placeholder="例如：某材料商卡住 CPO 上游产能" />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>主标的</span>
            <input value={builder.primaryTicker} onChange={(event) => updateBuilder('primaryTicker', event.target.value)} placeholder="SIVE" />
          </label>
          <label className="field">
            <span>相关标的</span>
            <input value={builder.tickers} onChange={(event) => updateBuilder('tickers', event.target.value)} placeholder="SIVE, LITE, COHR" />
          </label>
        </div>
        <label className="field">
          <span>焦点线</span>
          <input value={builder.focusArea} onChange={(event) => updateBuilder('focusArea', event.target.value)} />
        </label>
        <label className="field">
          <span>层级</span>
          <input value={builder.layer} onChange={(event) => updateBuilder('layer', event.target.value)} />
        </label>
        <label className="field">
          <span>顶层需求</span>
          <textarea value={builder.demandSource} onChange={(event) => updateBuilder('demandSource', event.target.value)} rows={3} />
        </label>
        <label className="field">
          <span>依赖链</span>
          <input value={builder.chain} onChange={(event) => updateBuilder('chain', event.target.value)} placeholder="AI capex, GPU, 光互联, 材料" />
        </label>
        <label className="field">
          <span>瓶颈</span>
          <textarea value={builder.chokepoint} onChange={(event) => updateBuilder('chokepoint', event.target.value)} rows={3} />
        </label>
        <label className="field">
          <span>上市载体</span>
          <textarea value={builder.businessCarrier} onChange={(event) => updateBuilder('businessCarrier', event.target.value)} rows={2} />
        </label>
        <label className="field">
          <span>财务转译</span>
          <textarea value={builder.financialTranslation} onChange={(event) => updateBuilder('financialTranslation', event.target.value)} rows={2} />
        </label>
        <label className="field">
          <span>市场误分类</span>
          <textarea value={builder.marketMisclassification} onChange={(event) => updateBuilder('marketMisclassification', event.target.value)} rows={2} />
        </label>
        <label className="field">
          <span>验证信号</span>
          <textarea value={builder.validationSignals} onChange={(event) => updateBuilder('validationSignals', event.target.value)} rows={2} placeholder="每行或逗号分隔" />
        </label>
        <label className="field">
          <span>反证条件</span>
          <textarea value={builder.falsifiers} onChange={(event) => updateBuilder('falsifiers', event.target.value)} rows={2} />
        </label>
        <label className="field">
          <span>证据关键词</span>
          <input value={builder.keywords} onChange={(event) => updateBuilder('keywords', event.target.value)} placeholder="CPO, InP, customer qualification" />
        </label>
        <button className="primary-action" onClick={createCustomCard}>
          <Check size={18} />
          <span>保存候选卡</span>
        </button>
        {message && <div className="inline-note">{message}</div>}
      </div>

      <div className="content-panel">
        <PanelHeader icon={BarChart3} title="高频标的" meta={`${topSymbols.length} 个`} />
        <div className="symbol-table">
          {topSymbols.map((item) => (
            <div className="symbol-row" key={item.symbol}>
              <strong>{formatTicker(item.symbol)}</strong>
              <span>{item.count} posts</span>
              <span>{item.engagement} eng</span>
              <small>{item.lastSeen ? formatDateShort(item.lastSeen) : '未知'}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="content-panel span-2">
        <PanelHeader icon={Database} title="Archive 证据片段" meta={payload.source?.archiveExists ? '本地 JSON 已连接' : 'archive 未找到'} />
        <div className="archive-feed">
          {evidenceFeed.map((item) => (
            <a href={item.url} target="_blank" rel="noreferrer" key={item.id || item.url}>
              <div>
                <strong>{joinCompact((item.tickers || []).map(formatTicker), '无 ticker')}</strong>
                <span>{formatDateShort(item.date)} · {item.engagement} engagement</span>
              </div>
              <p>{item.text}</p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function AiStockRadar() {
  const [serenityData, setSerenityData] = useState({ discoveryRuns: [], focusAreas: [], thesisCards: [] });
  const [researchRuns, setResearchRuns] = useState([]);
  const [selectedTicker, setSelectedTicker] = useState('NVDA');
  const [selectedSector, setSelectedSector] = useState('AI Application');
  const [message, setMessage] = useState('');

  const loadRadarContext = async () => {
    try {
      const [data, researchPayload] = await Promise.all([
        apiFetch('/api/serenity/research-system'),
        apiFetch('/api/ai-radar/research-runs'),
      ]);
      setSerenityData({
        discoveryRuns: Array.isArray(data.discoveryRuns) ? data.discoveryRuns : [],
        focusAreas: Array.isArray(data.focusAreas) ? data.focusAreas : [],
        thesisCards: Array.isArray(data.thesisCards) ? data.thesisCards : [],
      });
      setResearchRuns(Array.isArray(researchPayload.runs) ? researchPayload.runs : []);
    } catch (error) {
      setMessage('Serenity research context 暂不可用；看板仍可查看 benchmark 缺口。');
    }
  };

  useEffect(() => {
    loadRadarContext();
    const timer = window.setInterval(loadRadarContext, 10000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedStock = radarCoreStocks.find((stock) => stock.ticker === selectedTicker) || radarCoreStocks[0];
  const selectedSectorData = radarSubsectors.find((sector) => sector.name === selectedSector) || radarSubsectors.find((sector) => sector.coverage === 'missing');
  const missingSectors = radarSubsectors.filter((sector) => sector.coverage === 'missing');
  const partialSectors = radarSubsectors.filter((sector) => sector.coverage === 'partial');
  const activeMarkets = (serenityData.discoveryRuns || []).flatMap((run) => run.markets || []);
  const activeResearchRun = researchRuns[0] || null;
  const activeCloseCriteria = activeResearchRun?.minimumCloseCriteria || {};
  const activeNextActions = activeResearchRun
    ? [
        ...(activeResearchRun.openQuestions || []).slice(0, 3),
        ...(activeResearchRun.sourceLedger || []).map((item) => item.nextAction).filter(Boolean).slice(0, 2),
      ].slice(0, 5)
    : [];
  const coverageCounts = {
    covered: radarSubsectors.filter((sector) => sector.coverage === 'covered').length,
    partial: partialSectors.length,
    missing: missingSectors.length,
  };

  const addGapToQueue = async (sector) => {
    setMessage(`正在把 ${sector.name} 加入研究队列`);
    try {
      await apiFetch('/api/research/queue', {
        method: 'POST',
        body: JSON.stringify({
          question: `${sector.name}：是否存在 Serenity 式深层瓶颈和小市值/低覆盖 public carrier？`,
          tickers: sector.tickers,
          themes: [sector.name, 'AI Stock Radar gap', 'Serenity market discovery'],
          priority: sector.coverage === 'missing' ? 2 : 3,
        }),
      });
      setMessage(`${sector.name} 已加入研究队列`);
    } catch (error) {
      setMessage('加入研究队列失败');
    }
  };

  return (
    <section className="radar-shell">
      <div className="radar-left">
        <header className="radar-hero">
          <div>
            <span className="radar-eyebrow">AI Stock Radar · Benchmark View</span>
            <h2>AI Universe 覆盖雷达</h2>
            <p>结构参考截图看板；当前不接实时行情，重点用于发现我们的 research 覆盖缺口。</p>
          </div>
          <button className="radar-refresh" onClick={loadRadarContext}>
            <RefreshCcw size={15} />
            <span>刷新</span>
          </button>
        </header>

        <div className="radar-stat-grid">
          {radarStats.map(([label, value, note]) => (
            <div className="radar-stat" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{note}</small>
            </div>
          ))}
        </div>

        {activeResearchRun && (
          <section className="radar-panel active-output-panel">
            <div className="radar-panel-head">
              <div>
                <strong>Active Research Output</strong>
                <span>当前研究状态的结果层；结论、不能关闭原因和下一步会实时透出</span>
              </div>
              <small>{activeResearchRun.closeState}</small>
            </div>
            <div className="active-output-grid">
              <article className="active-output-main">
                <span className="radar-eyebrow">{activeResearchRun.status} · {activeResearchRun.confidence}</span>
                <h3>{activeResearchRun.title}</h3>
                <p>{activeResearchRun.currentConclusion}</p>
              </article>
              <article className="active-output-card">
                <strong>为什么不能关闭</strong>
                <p>{activeCloseCriteria.reason || 'Close gate 尚未满足。'}</p>
                <div className="active-evidence-row">
                  <span>Search {activeCloseCriteria.searchRows || 0}</span>
                  <span>Core {activeCloseCriteria.coreEvidenceRows || 0}</span>
                  <span>Red {activeCloseCriteria.redTeamRows || 0}</span>
                  <span>{activeCloseCriteria.canClose ? 'Can close' : 'Cannot close'}</span>
                </div>
              </article>
              <article className="active-output-card">
                <strong>过程结论</strong>
                <ul>
                  {(activeResearchRun.processConclusions || []).slice(0, 4).map((item) => <li key={item}>{item}</li>)}
                </ul>
              </article>
              <article className="active-output-card">
                <strong>下一步</strong>
                <ul>
                  {activeNextActions.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </article>
            </div>
          </section>
        )}

        <section className="radar-panel live-run-panel">
          <div className="radar-panel-head">
            <div>
              <strong>Live Research Run</strong>
              <span>实时同步 research 步骤、搜索源、挑战结果和过程结论；每 10 秒轮询一次</span>
            </div>
            <small>{activeResearchRun?.closeState || 'waiting'}</small>
          </div>
          {activeResearchRun ? (
            <div className="live-run-layout">
              <article className="live-run-summary">
                <span className="radar-eyebrow">{activeResearchRun.status} · {activeResearchRun.confidence}</span>
                <h3>{activeResearchRun.title}</h3>
                <p>{activeResearchRun.objective}</p>
                <strong>当前过程结论</strong>
                <p>{activeResearchRun.currentConclusion}</p>
                <div className="close-criteria-grid">
                  <div><span>Search</span><strong>{activeResearchRun.minimumCloseCriteria?.searchRows || 0}</strong></div>
                  <div><span>Core</span><strong>{activeResearchRun.minimumCloseCriteria?.coreEvidenceRows || 0}</strong></div>
                  <div><span>Red team</span><strong>{activeResearchRun.minimumCloseCriteria?.redTeamRows || 0}</strong></div>
                  <div><span>Can close</span><strong>{activeResearchRun.minimumCloseCriteria?.canClose ? 'Yes' : 'No'}</strong></div>
                </div>
              </article>

              <div className="research-step-list">
                {(activeResearchRun.steps || []).map((step) => (
                  <article className={`research-step ${step.status}`} key={`${step.time}-${step.title}`}>
                    <div>
                      <strong>{step.title}</strong>
                      <span>{step.type} · {formatDateShort(step.time)} · {step.status}</span>
                    </div>
                    <p>{step.detail}</p>
                    <small>{step.conclusion}</small>
                  </article>
                ))}
              </div>

              <div className="source-ledger-live">
                {(activeResearchRun.sourceLedger || []).map((source) => (
                  <article className="source-live-row" key={`${source.source}-${source.allowedUse}`}>
                    <div>
                      <strong>{source.source}</strong>
                      <span>{source.sourceType} · {source.allowedUse} · {source.convictionImpact}</span>
                    </div>
                    <p>{source.finding}</p>
                    <small>{source.nextAction}</small>
                    {source.url && <a href={source.url} target="_blank" rel="noreferrer">source</a>}
                  </article>
                ))}
              </div>

              <div className="challenge-live-list">
                {(activeResearchRun.challengeLedger || []).map((row) => (
                  <article className="challenge-live-row" key={row.challenge}>
                    <strong>{row.challenge}</strong>
                    <p>{row.result}</p>
                    <small>{row.impact} · {row.nextAction}</small>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <Radio size={24} />
              <strong>等待 research run</strong>
              <span>后端没有返回 live run。</span>
            </div>
          )}
        </section>

        <section className="radar-panel">
          <div className="radar-panel-head">
            <div>
              <strong>信息源审计</strong>
              <span>截图看板隐含的源：行情、基本面、新闻、分析师、产业分类；这里按用途和信噪比重新分层</span>
            </div>
            <small>{radarSourceStack.length} source layers</small>
          </div>
          <div className="source-audit-grid">
            {radarSourceStack.map((source) => (
              <article className={`source-audit-card ${source.currentStatus}`} key={source.layer}>
                <div>
                  <strong>{source.layer}</strong>
                  <span>{coverageLabel(source.currentStatus)}</span>
                </div>
                <p>{source.filterRule}</p>
                <small>截图维度：{joinCompact(source.screenshotSignals.slice(0, 4))}</small>
                <small>建议源：{joinCompact(source.preferredSources.slice(0, 3))}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="radar-panel">
          <div className="radar-panel-head">
            <div>
              <strong>分析维度审计</strong>
              <span>不是看少了几个领域，而是缺了行情、基本面、估值、新闻、AI exposure 和筛选器维度</span>
            </div>
            <small>{radarDimensionAudit.length} dimension groups</small>
          </div>
          <div className="dimension-audit-list">
            {radarDimensionAudit.map((item) => (
              <article className={`dimension-audit-row ${item.ourStatus}`} key={item.group}>
                <div>
                  <strong>{item.group}</strong>
                  <span>{coverageLabel(item.ourStatus)}</span>
                </div>
                <p>{joinCompact(item.screenshotDimensions)}</p>
                <small>{item.action}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="radar-panel">
          <div className="radar-panel-head">
            <div>
              <strong>Challenge Gate</strong>
              <span>防止 research 过早结束；每个候选必须先被反方挑战和最低证据门槛卡住</span>
            </div>
            <small>{challengeGateRules.length} gates</small>
          </div>
          <div className="challenge-gate-grid">
            {challengeGateRules.map((item) => (
              <article className="challenge-gate-card" key={item.name}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.status}</span>
                </div>
                <p>{item.rule}</p>
                <small>{item.failAction}</small>
              </article>
            ))}
          </div>
          <div className="counter-query-strip">
            {challengeQueries.map((query) => <span key={query}>{query}</span>)}
          </div>
        </section>

        <section className="radar-panel">
          <div className="radar-panel-head">
            <div>
              <strong>异常脉动</strong>
              <span>截图 benchmark 中出现但我们未必覆盖的异动线索</span>
            </div>
            <small>{radarAnomalies.length} signals</small>
          </div>
          <div className="anomaly-grid">
            {radarAnomalies.map((item) => (
              <button className={`anomaly-row ${item.coverage}`} key={item.ticker} onClick={() => setSelectedSector(item.theme)}>
                <strong>{item.ticker}</strong>
                <span>{item.theme}</span>
                <b>{item.move}</b>
              </button>
            ))}
          </div>
        </section>

        <section className="radar-panel">
          <div className="radar-panel-head">
            <div>
              <strong>Core Research 30</strong>
              <span>大盘 anchor + 研究基准；深层瓶颈仍要从它们向下拆</span>
            </div>
            <small>30 tickers</small>
          </div>
          <div className="core-card-grid">
            {radarCoreStocks.map((stock) => (
              <button
                className={`core-stock-card ${selectedTicker === stock.ticker ? 'selected' : ''}`}
                key={stock.ticker}
                onClick={() => {
                  setSelectedTicker(stock.ticker);
                  setSelectedSector(stock.sector);
                }}
              >
                <div>
                  <strong>{stock.ticker}</strong>
                  <span>{stock.name}</span>
                </div>
                <b>{stock.price}</b>
                <small className={stock.move.startsWith('-') ? 'down' : 'up'}>{stock.move}</small>
                <em>{stock.sector}</em>
              </button>
            ))}
          </div>
        </section>

        <section className="radar-panel">
          <div className="radar-panel-head">
            <div>
              <strong>AI 子板块热力图</strong>
              <span>绿色=我们已覆盖；黄色=部分覆盖；红色=相对截图看板遗漏</span>
            </div>
            <small>{coverageCounts.covered}/{coverageCounts.partial}/{coverageCounts.missing}</small>
          </div>
          <div className="sector-heatmap">
            {radarSubsectors.map((sector) => (
              <button
                className={`sector-tile ${sector.coverage} ${selectedSector === sector.name ? 'selected' : ''}`}
                key={sector.name}
                onClick={() => setSelectedSector(sector.name)}
              >
                <strong>{sector.name}</strong>
                <b>{sector.move}</b>
                <span>{coverageLabel(sector.coverage)}</span>
                <small>{joinCompact(sector.tickers.slice(0, 4))}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="radar-panel">
          <div className="radar-panel-head">
            <div>
              <strong>Coverage Gap vs 当前搜集</strong>
              <span>从截图看板倒推出我们缺失的研究域</span>
            </div>
            <small>{missingSectors.length} hard gaps</small>
          </div>
          <div className="gap-table">
            {[...missingSectors, ...partialSectors].map((sector) => (
              <article className={`gap-row ${sector.coverage}`} key={sector.name}>
                <div>
                  <strong>{sector.name}</strong>
                  <span>{coverageLabel(sector.coverage)} · {joinCompact(sector.tickers)}</span>
                </div>
                <p>{sector.gap}</p>
                <button className="radar-action" onClick={() => addGapToQueue(sector)}>
                  <ListChecks size={14} />
                  <span>加入队列</span>
                </button>
              </article>
            ))}
          </div>
          {message && <div className="radar-note">{message}</div>}
        </section>
      </div>

      <aside className="radar-detail">
        {activeResearchRun && (
          <div className="detail-card">
            <span className="radar-eyebrow">Live Conclusions</span>
            <div className="filter-policy-list">
              {(activeResearchRun.processConclusions || []).slice(0, 5).map((item) => (
                <article key={item}>
                  <strong>Process</strong>
                  <span>{item}</span>
                </article>
              ))}
            </div>
          </div>
        )}

        {activeResearchRun && (
          <div className="detail-card">
            <span className="radar-eyebrow">Open Questions</span>
            <div className="filter-policy-list">
              {(activeResearchRun.openQuestions || []).slice(0, 5).map((item) => (
                <article key={item}>
                  <strong>Next</strong>
                  <span>{item}</span>
                </article>
              ))}
            </div>
          </div>
        )}

        <div className="detail-card">
          <span className="radar-eyebrow">个股详情</span>
          <div className="detail-title">
            <div>
              <h3>{selectedStock.ticker}</h3>
              <span>{selectedStock.name}</span>
            </div>
            <b className={selectedStock.move.startsWith('-') ? 'down' : 'up'}>{selectedStock.move}</b>
          </div>
          <p>{selectedStock.thesis}</p>
          <div className="detail-metrics">
            <div><span>价格样本</span><strong>{selectedStock.price}</strong></div>
            <div><span>AI Exposure</span><strong>{selectedStock.score}</strong></div>
            <div><span>分类</span><strong>{selectedStock.sector}</strong></div>
            <div><span>角色</span><strong>{selectedStock.ticker === 'NVDA' ? '需求锚' : '对照/载体'}</strong></div>
          </div>
        </div>

        <div className="detail-card">
          <span className="radar-eyebrow">选中板块</span>
          <h3>{selectedSectorData?.name}</h3>
          <div className={`coverage-pill ${selectedSectorData?.coverage}`}>{coverageLabel(selectedSectorData?.coverage)}</div>
          <p>{selectedSectorData?.gap}</p>
          <div className="detail-tags">
            {(selectedSectorData?.tickers || []).map((ticker) => <span key={ticker}>{ticker}</span>)}
          </div>
          {selectedSectorData && (
            <button className="radar-action wide" onClick={() => addGapToQueue(selectedSectorData)}>
              <ListChecks size={14} />
              <span>转入研究队列</span>
            </button>
          )}
        </div>

        <div className="detail-card">
          <span className="radar-eyebrow">我们当前已搜集</span>
          <div className="collected-list">
            {(activeMarkets.length ? activeMarkets : serenityData.focusAreas).slice(0, 8).map((item) => (
              <article key={item.market || item.title}>
                <strong>{item.market || item.title}</strong>
                <span>{item.status || item.why || 'active research'}</span>
              </article>
            ))}
          </div>
        </div>

        <div className="detail-card">
          <span className="radar-eyebrow">Source Filter Policy</span>
          <div className="filter-policy-list">
            <article>
              <strong>事实层</strong>
              <span>SEC / company IR / official technical docs / standards / government reports，可进入 thesis 核心。</span>
            </article>
            <article>
              <strong>数据层</strong>
              <span>Polygon/FMP/Finnhub 等只做行情、财务缓存、预期数据，关键数字必须回到 filing 或 IR。</span>
            </article>
            <article>
              <strong>发现层</strong>
              <span>Yahoo/FMP news/X/Reddit/GitHub 只能触发 research task，不能直接提高 conviction。</span>
            </article>
            <article>
              <strong>剔除/降权</strong>
              <span>Motley Fool、二手新闻、无原文链接聚合、重复转载，不进入核心证据链。</span>
            </article>
          </div>
        </div>

        <div className="detail-card">
          <span className="radar-eyebrow">Close Rule</span>
          <div className="filter-policy-list">
            <article>
              <strong>V2 State Machine</strong>
              <span>Research Run 只能关闭为 closed_no_candidate 或 closed_candidate_found。</span>
            </article>
            <article>
              <strong>Upgrade Gate</strong>
              <span>没有 Fatal Gate、Challenge Gate、财务路径和具体反证，不允许升级为 high_conviction_candidate。</span>
            </article>
            <article>
              <strong>Close Gate</strong>
              <span>关闭前必须完成证据独立性、coverage_sufficient、定价分析、Red Team、看板与 Obsidian 同步。</span>
            </article>
          </div>
        </div>

        <div className="detail-card">
          <span className="radar-eyebrow">结论</span>
          <p>相比截图看板，真正缺的不是领域，而是行情/技术指标、基本面/估值、分析师预期、事件新闻、筛选器和横向 AI exposure score。领域缺口可以后补，源和维度要先定过滤规则。</p>
        </div>
      </aside>
    </section>
  );
}

function OfficialHoldings() {
  const [holdingsData, setHoldingsData] = useState({
    summary: {},
    officials: [],
    latestTransactions: [],
    tickerExposure: [],
    trump: { latestTransactions: [], tickerExposure: [], official: null },
    sources: [],
    notableEvents: [],
  });
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('');

  const loadHoldings = async ({ refresh = false } = {}) => {
    setState('loading');
    setMessage('');
    try {
      const data = await apiFetch(`/api/official-holdings${refresh ? '?refresh=1' : ''}`);
      setHoldingsData({
        ...data,
        officials: Array.isArray(data.officials) ? data.officials : [],
        latestTransactions: Array.isArray(data.latestTransactions) ? data.latestTransactions : [],
        tickerExposure: Array.isArray(data.tickerExposure) ? data.tickerExposure : [],
        sources: Array.isArray(data.sources) ? data.sources : [],
        notableEvents: Array.isArray(data.notableEvents) ? data.notableEvents : [],
        trump: data.trump || { latestTransactions: [], tickerExposure: [], official: null },
      });
      setState('ready');
    } catch (error) {
      setState('error');
      setMessage('官员持仓数据暂不可用，请稍后刷新。');
    }
  };

  useEffect(() => {
    loadHoldings();
  }, []);

  const addToResearchQueue = async (event) => {
    setMessage('正在加入研究队列');
    try {
      await apiFetch('/api/research/queue', {
        method: 'POST',
        body: JSON.stringify({ event }),
      });
      setMessage('已加入研究队列');
    } catch (error) {
      setMessage('加入研究队列失败');
    }
  };

  const summary = holdingsData.summary || {};
  const trumpExposure = holdingsData.trump?.tickerExposure || [];
  const trumpTransactions = holdingsData.trump?.latestTransactions || [];
  const trumpDocuments = holdingsData.trump?.official?.sourceDocuments || [];
  const sources = holdingsData.sources || [];

  return (
    <section className="workspace-grid">
      <div className="wide-panel holdings-hero">
        <div className="hero-copy">
          <span className="badge amber">Political Disclosure Branch</span>
          <h2>追踪特朗普与美国行政分支官员的公开持仓、交易披露和潜在市场信号</h2>
        </div>
        <div className="metric-strip">
          <Metric icon={UsersRound} label="追踪官员" value={summary.officialCount || 0} />
          <Metric icon={ClipboardList} label="披露交易" value={summary.transactionCount || 0} />
          <Metric icon={BarChart3} label="估算中值" value={formatMoney(summary.estimatedMidpoint)} />
        </div>
      </div>

      <div className="content-panel span-2">
        <PanelHeader icon={Landmark} title="特朗普 / 官员披露事件" meta={holdingsData.exportedAt ? `数据 ${formatDateShort(holdingsData.exportedAt)}` : '等待数据'} />
        <div className="briefing-tools">
          <span className={`data-state ${state}`}>{state === 'loading' ? '同步中' : state === 'error' ? message : holdingsData.cached ? '已使用缓存' : '已同步公开数据'}</span>
          <div className="toolbar-actions">
            <button className="small-button" onClick={() => loadHoldings({ refresh: true })} disabled={state === 'loading'}>
              <RefreshCcw size={14} />
              <span>刷新</span>
            </button>
          </div>
        </div>
        {message && state !== 'error' && <div className="inline-note">{message}</div>}

        <div className="holdings-split">
          <div className="holdings-block">
            <strong>Trump 最新披露</strong>
            <div className="transaction-list compact">
              {trumpTransactions.slice(0, 10).map((transaction) => (
                <div className="transaction-row" key={transaction.id}>
                  <div>
                    <strong>{transaction.ticker || transaction.description}</strong>
                    <span>
                      {transaction.type} · {transaction.amount} · {formatDateShort(transaction.date)}
                      {transaction.verificationChain?.sourceDocuments?.[0]?.url ? (
                        <>
                          {' · '}
                          <a href={transaction.verificationChain.sourceDocuments[0].url} target="_blank" rel="noreferrer">OGE PDF</a>
                        </>
                      ) : ''}
                    </span>
                  </div>
                  {transaction.lateFilingFlag && <span className="verify-pill warning">Late</span>}
                </div>
              ))}
              {!trumpTransactions.length && (
                <div className="empty-compact">
                  <strong>暂无 Trump 交易</strong>
                  <span>等待 Open Cabinet / OGE 数据返回。</span>
                </div>
              )}
            </div>
          </div>
          <div className="holdings-block">
            <strong>高价值/异常事件</strong>
            <div className="event-list compact">
              {(holdingsData.notableEvents || []).slice(0, 8).map((event) => (
                <article className="mini-event" key={event.id}>
                  <div>
                    <strong>{event.title}</strong>
                    <span>{joinCompact(event.tickers)} · {event.summary}</span>
                  </div>
                  <button className="small-button" onClick={() => addToResearchQueue(event)}>
                    <ListChecks size={14} />
                    <span>研究</span>
                  </button>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="content-panel">
        <PanelHeader icon={Database} title="信息源" meta={`${sources.length} 个`} />
        <div className="registry-list">
          {sources.map((source) => (
            <div className="registry-row" key={source.id}>
              <div>
                <strong>{source.name}</strong>
                <span>{formatTrustTier(source.trustTier)} · {source.captureMethod}</span>
              </div>
              {source.url && (
                <a href={source.url} target="_blank" rel="noreferrer" title="打开源">
                  <ExternalLink size={15} />
                </a>
              )}
            </div>
          ))}
        </div>
        <div className="source-health">
          <div>
            <strong>OGE 原始文件</strong>
            <span>{trumpDocuments.length} 份可验证</span>
          </div>
          {trumpDocuments.slice(0, 3).map((document) => (
            <p key={document.id}>
              <span>{document.form || 'OGE'}</span>
              <small>
                <a href={document.url} target="_blank" rel="noreferrer">{document.fileName}</a>
              </small>
            </p>
          ))}
          <p>
            <span>验证边界</span>
            <small>聚合源用于发现，重大结论必须回到 OGE 原始披露文件。</small>
          </p>
        </div>
      </div>

      <div className="content-panel">
        <PanelHeader icon={BarChart3} title="Trump 标的暴露" meta={`${trumpExposure.length} 个 ticker`} />
        <div className="exposure-list">
          {trumpExposure.slice(0, 12).map((row) => (
            <div className="exposure-row" key={row.ticker}>
              <div>
                <strong>{row.ticker}</strong>
                <span>{row.transactions} 笔 · 买 {row.purchases} / 卖 {row.sales}</span>
              </div>
              <b>{formatMoney(row.estimatedMidpoint)}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="content-panel span-2">
        <PanelHeader icon={Globe2} title="全体官员热门标的" meta={`${holdingsData.tickerExposure?.length || 0} 个`} />
        <div className="ticker-table">
          {(holdingsData.tickerExposure || []).slice(0, 18).map((row) => (
            <div className="ticker-row" key={row.ticker}>
              <strong>{row.ticker}</strong>
              <span>{row.company}</span>
              <span>{row.officials?.slice(0, 2).join('、') || '未知官员'}</span>
              <b>{formatMoney(row.estimatedMidpoint)}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="content-panel span-3">
        <PanelHeader icon={UsersRound} title="追踪官员" meta={`${holdingsData.officials?.length || 0} 个`} />
        <div className="official-grid">
          {(holdingsData.officials || []).slice(0, 12).map((official) => (
            <div className="official-card" key={official.slug}>
              <strong>{official.name}</strong>
              <span>{official.title}</span>
              <small>{official.agency} · {official.transactionCount} 笔 · 最新 {formatDateShort(official.mostRecentFilingDate)}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
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
