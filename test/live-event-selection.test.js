import assert from 'node:assert/strict';
import test from 'node:test';

import { selectRealtimeEvents, shouldServeStoredLiveEventsImmediately } from '../server/realtime-events.js';

test('keeps a stored live transcript visible when newer RSS events exhaust the normal page limit', () => {
  const transcript = {
    id: 'transcript:bloomberg-tv:fixture',
    publishedAt: '2026-07-14T05:04:00.000Z',
    source: { id: 'bloomberg-tv', type: 'live_tv' },
    transcript: 'NVIDIA discussion from a live audio segment.',
  };
  const rssEvents = Array.from({ length: 70 }, (_, index) => ({
    id: `rss-${index}`,
    publishedAt: `2026-07-14T${String(6 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00.000Z`,
    source: { id: 'ai-rss', type: 'ai_frontier' },
  }));

  const selected = selectRealtimeEvents({ storedEvents: [transcript], generatedEvents: rssEvents, limit: 60 });

  assert.equal(selected.length, 60);
  assert.equal(selected[0].id, transcript.id);
  assert.equal(selected.some((event) => event.id === transcript.id), true);
  assert.equal(selected.some((event) => event.id === 'rss-0'), false);
});

test('serves a persisted live transcript immediately while the first RSS refresh is pending', () => {
  const transcript = {
    id: 'transcript:bloomberg-tv:fast-path',
    source: { id: 'bloomberg-tv', type: 'live_tv' },
    transcript: 'A live Bloomberg segment must not wait for RSS.',
  };

  assert.equal(shouldServeStoredLiveEventsImmediately({ storedEvents: [transcript], hasCachedBriefing: false, forceRefresh: false }), true);
  assert.equal(shouldServeStoredLiveEventsImmediately({ storedEvents: [transcript], hasCachedBriefing: true, forceRefresh: false }), false);
  assert.equal(shouldServeStoredLiveEventsImmediately({ storedEvents: [transcript], hasCachedBriefing: false, forceRefresh: true }), false);
});
