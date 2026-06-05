#!/usr/bin/env node

const DEFAULT_API_BASE = process.env.SERENITY_API_BASE || 'http://127.0.0.1:3002';
const DEFAULT_INTERVAL_HOURS = Number(process.env.SERENITY_DOMAIN_SCHEDULER_INTERVAL_HOURS || 24);

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(`[serenity-domain-scheduler] fatal: ${error.stack || error.message}`);
  process.exit(1);
});

async function main() {
  if (args.help) {
    printHelp();
    return;
  }

  if (args.watch) {
    await runOnce();
    const intervalMs = Math.max(1, Number(args.intervalHours || DEFAULT_INTERVAL_HOURS)) * 60 * 60 * 1000;
    console.log(`[serenity-domain-scheduler] watching; next run every ${Math.round(intervalMs / 60 / 60 / 1000)}h`);
    setInterval(() => {
      runOnce().catch((error) => {
        console.error(`[serenity-domain-scheduler] run failed: ${error.message}`);
      });
    }, intervalMs);
    return;
  }

  await runOnce();
}

async function runOnce() {
  const apiBase = String(args.apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
  const endpoint = `${apiBase}/api/serenity/domain-research/run${args.dryRun ? '?dryRun=1' : ''}`;
  const body = {
    domainIds: args.domainIds,
    maxDomains: args.maxDomains,
    dryRun: args.dryRun,
  };
  const startedAt = new Date().toISOString();
  console.log(`[serenity-domain-scheduler] ${args.dryRun ? 'dry-run' : 'run'} started at ${startedAt}`);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message = payload.message || payload.error || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }

  const runCount = payload.runs?.length || payload.seed?.runs?.length || 0;
  const queueCount = payload.researchQueue?.itemsWritten || payload.seed?.queueInputs?.length || 0;
  console.log(`[serenity-domain-scheduler] wrote runs=${runCount} queueItems=${queueCount}`);
  if (payload.schedulerState?.runIds?.length) {
    console.log(`[serenity-domain-scheduler] runIds=${payload.schedulerState.runIds.join(',')}`);
  }
  return payload;
}

function parseArgs(argv) {
  const parsed = {
    apiBase: '',
    domainIds: [],
    maxDomains: undefined,
    dryRun: false,
    watch: false,
    intervalHours: undefined,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--watch') parsed.watch = true;
    else if (arg === '--api-base') parsed.apiBase = argv[++index] || '';
    else if (arg === '--domain') parsed.domainIds.push(argv[++index] || '');
    else if (arg === '--domains') parsed.domainIds.push(...String(argv[++index] || '').split(','));
    else if (arg === '--max-domains') parsed.maxDomains = Number(argv[++index]);
    else if (arg === '--interval-hours') parsed.intervalHours = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  parsed.domainIds = parsed.domainIds.map((item) => item.trim()).filter(Boolean);
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  node scripts/serenity-domain-scheduler.js [options]

Options:
  --dry-run                 Preview generated Serenity runs and queue items without writing.
  --watch                   Keep running on an interval. Prefer launchd/cron/CI for durable 7x24 scheduling.
  --interval-hours <n>      Watch interval. Default: ${DEFAULT_INTERVAL_HOURS}.
  --api-base <url>          API base. Default: ${DEFAULT_API_BASE}.
  --domain <id>             Run one domain. Can be repeated.
  --domains <a,b,c>         Run a comma-separated domain list.
  --max-domains <n>         Limit selected domains by priority.
`);
}
