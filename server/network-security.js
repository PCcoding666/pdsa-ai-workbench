const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/;

export function isLoopbackHost(value) {
  const host = String(value || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (!LOOPBACK_V4.test(host)) return false;
  return host.split('.').every((part) => {
    const octet = Number(part);
    return Number.isInteger(octet) && octet >= 0 && octet <= 255;
  });
}

export function resolveServerNetworkConfig(env = process.env) {
  const host = String(env?.APP_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const username = String(env?.APP_USERNAME || '');
  const password = String(env?.APP_PASSWORD || '');
  if (Boolean(username) !== Boolean(password)) {
    throw new Error('APP_USERNAME and APP_PASSWORD must be set together when HTTP Basic Auth is enabled.');
  }

  const remoteAccess = !isLoopbackHost(host);
  if (remoteAccess && String(env?.APP_ALLOW_REMOTE_ACCESS || '') !== '1') {
    throw new Error('Non-loopback APP_HOST requires APP_ALLOW_REMOTE_ACCESS=1 as an explicit opt-in.');
  }
  if (remoteAccess && (!username || !password)) {
    throw new Error('Non-loopback APP_HOST requires both APP_USERNAME and APP_PASSWORD.');
  }

  return {
    host,
    remoteAccess,
    auth: username ? { username, password } : null,
    corsOrigins: parseCorsOrigins(env?.APP_CORS_ORIGINS),
  };
}

export function isAllowedCorsOrigin(origin, config) {
  const normalized = normalizeOrigin(origin);
  return Boolean(normalized && config?.corsOrigins?.includes(normalized));
}

export function createCorsMiddleware(config) {
  return (req, res, next) => {
    const origin = req.get?.('origin') || req.headers?.origin || '';
    if (!isAllowedCorsOrigin(origin, config)) {
      next();
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', normalizeOrigin(origin));
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-push-token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

function parseCorsOrigins(value) {
  const entries = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.includes('*')) throw new Error('APP_CORS_ORIGINS must list exact origins; wildcard CORS is not allowed.');
  return [...new Set(entries.map((entry) => {
    const origin = normalizeOrigin(entry);
    if (!origin) throw new Error(`APP_CORS_ORIGINS contains an invalid origin: ${entry}`);
    return origin;
  }))];
}

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const target = new URL(raw);
    if (!['http:', 'https:'].includes(target.protocol)) return '';
    if (target.pathname !== '/' || target.search || target.hash || target.username || target.password) return '';
    return target.origin;
  } catch {
    return '';
  }
}
