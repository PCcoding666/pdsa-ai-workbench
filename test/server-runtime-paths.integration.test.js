import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('portable Serenity defaults remain under the configured data directory', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-serenity-paths-'));
  const port = await reservePort();
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      SERENITY_ARCHIVE_FILE: '',
      OBSIDIAN_VAULT_PATH: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  server.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(() => {
    if (server.exitCode === null) server.kill('SIGTERM');
  });

  await waitForHealth(`http://127.0.0.1:${port}`, stderr);
  const response = await fetch(`http://127.0.0.1:${port}/api/serenity/research-system`);
  assert.equal(response.status, 200);
  const system = await response.json();

  assert.equal(system.source.archiveFile, path.join(dataDir, 'serenity-archive.json'));
  assert.equal(system.source.obsidianVaultPath, path.join(dataDir, 'obsidian'));
  assert.doesNotMatch(JSON.stringify(system.source), /\/Users\/chengpeng/);
});

test('tracked runtime and deployment documentation contains no developer-specific absolute path', () => {
  for (const relativePath of [
    'server/index.js',
    'README.md',
    'README.zh-CN.md',
    'docs/serenity-v2.md',
    'docs/serenity-v2.zh-CN.md',
    'docs/deployment/README.md',
  ]) {
    const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.doesNotMatch(content, /\/Users\/chengpeng/);
  }
});

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(baseUrl, stderr) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The local child process is still binding its loopback port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Server did not become healthy: ${stderr}`);
}
