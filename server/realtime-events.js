function eventTimestamp(event) {
  const timestamp = new Date(event?.publishedAt || event?.createdAt || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function eventKey(event) {
  return String(event?.id || event?.url || `${event?.source?.id || ''}:${event?.title || ''}`).toLowerCase();
}

function isLiveTranscript(event) {
  return event?.source?.type === 'live_tv' && Boolean(String(event?.transcript || '').trim());
}

export function shouldServeStoredLiveEventsImmediately({ storedEvents = [], hasCachedBriefing = false, forceRefresh = false } = {}) {
  return !forceRefresh && !hasCachedBriefing && (Array.isArray(storedEvents) ? storedEvents : []).some(isLiveTranscript);
}

export function selectRealtimeEvents({ storedEvents = [], generatedEvents = [], limit = 60 } = {}) {
  const seen = new Set();
  const merged = [...storedEvents, ...generatedEvents]
    .filter((event) => {
      const key = eventKey(event);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => eventTimestamp(right) - eventTimestamp(left));

  const pinnedLiveTranscripts = merged.filter(isLiveTranscript);
  const pinnedIds = new Set(pinnedLiveTranscripts.map(eventKey));
  const remaining = merged.filter((event) => !pinnedIds.has(eventKey(event)));
  const normalizedLimit = Math.max(1, Math.min(120, Math.floor(Number(limit) || 60)));
  return [...pinnedLiveTranscripts, ...remaining].slice(0, normalizedLimit);
}
