import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('README transcript POST example stays aligned with the required ASR provenance contract', () => {
  for (const filename of ['README.md', 'README.zh-CN.md']) {
    const readme = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    for (const field of ['sourceId', 'sourceName', 'timestamp', 'transcript', 'audioWindow', 'audioFile', 'asrBackend', 'workerId']) {
      assert.match(readme, new RegExp(`"${field}"`), `${filename} must document ${field}`);
    }
  }
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  assert.match(readme, /初始一次加最多 3 次.*最多 4 次尝试/s);
  assert.match(readme, /skipped\//);
  assert.match(readme, /recovery\.lock/);
  assert.match(readme, /ASR_RUNTIME_STATE_FILE.*0700/s);
});

test('environment template documents loopback defaults and the explicit retry meaning', () => {
  const environment = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');

  assert.match(environment, /^APP_HOST=127\.0\.0\.1$/m);
  assert.match(environment, /^APP_ALLOW_REMOTE_ACCESS=0$/m);
  assert.match(environment, /^APP_CORS_ORIGINS=$/m);
  assert.match(environment, /3 means at most 4 total attempts/i);
});
