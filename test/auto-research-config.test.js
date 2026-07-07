import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadUniverse } from '../scripts/research-engine.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(rootDir, 'config', 'auto-research-universe.json');

test('git-tracked auto research universe defines the Mac mini research scope', () => {
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(parsed.name, 'auto-research-universe');
  assert.ok(Array.isArray(parsed.universe));
  assert.equal(parsed.universe.length, 32);

  const tickers = parsed.universe.map((entry) => entry.ticker);
  assert.equal(new Set(tickers).size, tickers.length);

  for (const entry of parsed.universe) {
    assert.match(entry.ticker, /\S/);
    assert.match(entry.domain, /\S/);
    assert.equal(entry.benchmark, 'SOXX');
    assert.match(entry.role, /\S/);
  }
});

test('research engine can load the git-tracked auto research universe', () => {
  const { source, universe } = loadUniverse({ file: configPath });

  assert.equal(source, configPath);
  assert.equal(universe.length, 32);
  assert.ok(universe.every((entry) => entry.benchmark === 'SOXX'));
  assert.ok(universe.some((entry) => entry.ticker === 'NVDA' && entry.domain === 'AI industry chain'));
  assert.ok(universe.some((entry) => entry.ticker === 'POET' && entry.domain.includes('photonics')));
});
