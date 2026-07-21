import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { buildStackPlan, stopManagedChildren } from '../scripts/asr-stack.js';

test('stack keeps workers independent and blocks only the capture that shares a loopback device', () => {
  const plan = buildStackPlan({
    sources: [
      { id: 'bloomberg-tv', enabled: true },
      { id: 'cnbc-live-tv', enabled: true },
    ],
    runtime: {
      sources: {
        'bloomberg-tv': { deviceIndex: 3 },
        'cnbc-live-tv': { deviceIndex: 3 },
      },
    },
  });

  assert.deepEqual(plan.map((item) => ({ id: item.id, startWorker: item.startWorker, startCapture: item.startCapture })), [
    { id: 'bloomberg-tv', startWorker: true, startCapture: true },
    { id: 'cnbc-live-tv', startWorker: true, startCapture: false },
  ]);
  assert.match(plan[1].captureBlockedReason, /already assigned/i);
});

test('stack waits for managed children to acknowledge SIGTERM before reporting stopped', async () => {
  const child = new EventEmitter();
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === 'SIGTERM') setTimeout(() => child.emit('close', 0, signal), 5);
    return true;
  };

  await stopManagedChildren(new Map([['bloomberg-tv:worker', child]]), { graceMs: 100, forceMs: 25 });
  assert.deepEqual(child.signals, ['SIGTERM']);
});
