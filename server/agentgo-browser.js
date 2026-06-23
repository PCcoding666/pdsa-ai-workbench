export async function fetchAgentGoPageSnapshot(input = {}, env = process.env) {
  const url = cleanText(input.url || '');
  if (!url) throw new Error('AgentGo URL is required');
  if (!/^https?:\/\//i.test(url)) throw new Error('AgentGo only accepts http(s) URLs');
  if (!env.AGENTGO_API_KEY) {
    return {
      status: 'skipped',
      reason: 'AGENTGO_API_KEY is not configured.',
      url,
    };
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    return {
      status: 'skipped',
      reason: 'playwright@1.51.0 is required for AgentGo browser access.',
      error: error.message,
      url,
    };
  }

  const launchOptions = encodeURIComponent(JSON.stringify({ _apikey: env.AGENTGO_API_KEY }));
  const browser = await chromium.connect(`wss://app.browsers.live?launch-options=${launchOptions}`);
  try {
    const page = await browser.newPage();
    await page.goto(url, {
      waitUntil: cleanText(input.waitUntil || 'domcontentloaded'),
      timeout: clampNumber(input.timeoutMs || env.AGENTGO_TIMEOUT_MS, 5000, 120000, 45000),
    });
    const title = await page.title();
    const text = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '');
    const links = await page
      .locator('a[href]')
      .evaluateAll((nodes) =>
        nodes.slice(0, 80).map((node) => ({
          text: node.textContent?.replace(/\s+/g, ' ').trim() || '',
          href: node.href,
        }))
      )
      .catch(() => []);

    return {
      status: 'success',
      url: page.url(),
      title,
      text: truncate(text, clampNumber(input.maxTextChars, 1000, 50000, 12000)),
      links,
    };
  } finally {
    await browser.close();
  }
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(value, max) {
  const text = cleanText(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
