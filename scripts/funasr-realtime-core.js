export function buildRunTask({ taskId, language = 'en' } = {}) {
  const normalizedTaskId = cleanText(taskId);
  if (!normalizedTaskId) throw new Error('A FunASR realtime task id is required.');
  const normalizedLanguage = cleanText(language) || 'en';
  return {
    header: { action: 'run-task', task_id: normalizedTaskId, streaming: 'duplex' },
    payload: {
      task_group: 'audio',
      task: 'asr',
      function: 'recognition',
      model: 'fun-asr-realtime',
      parameters: {
        format: 'pcm',
        sample_rate: 16000,
        language_hints: [normalizedLanguage],
        semantic_punctuation_enabled: false,
        heartbeat: true,
      },
      input: {},
    },
  };
}

export function buildFinishTask({ taskId } = {}) {
  const normalizedTaskId = cleanText(taskId);
  if (!normalizedTaskId) throw new Error('A FunASR realtime task id is required.');
  return {
    header: { action: 'finish-task', task_id: normalizedTaskId, streaming: 'duplex' },
    payload: { input: {} },
  };
}

export function createRealtimeState() {
  return {
    audioReady: false,
    taskFinished: false,
    taskError: '',
    finalTexts: [],
    transcript: '',
    seenSentenceKeys: new Set(),
  };
}

export function ingestRealtimeServerEvent(state, message) {
  const target = state || createRealtimeState();
  const event = cleanText(message?.header?.event);
  if (event === 'task-started') target.audioReady = true;
  if (event === 'task-finished') target.taskFinished = true;
  if (event === 'task-failed') target.taskError = cleanText(message?.header?.error_message || message?.header?.error_code || 'FunASR realtime task failed');

  if (event === 'result-generated') {
    const sentence = message?.payload?.output?.sentence || {};
    const text = cleanText(sentence.text);
    if (sentence.sentence_end === true && text) {
      const key = cleanText(sentence.sentence_id) || `${sentence.begin_time ?? ''}:${sentence.end_time ?? ''}:${text}`;
      if (!target.seenSentenceKeys.has(key)) {
        target.seenSentenceKeys.add(key);
        target.finalTexts.push(text);
        target.transcript = target.finalTexts.join(' ');
      }
    }
  }
  return target;
}

export function parsePcmWav(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || '');
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('FunASR realtime input must be a RIFF/WAVE file.');
  }

  let format;
  let pcm;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > buffer.length) throw new Error(`WAV ${chunkId} chunk is incomplete.`);
    if (chunkId === 'fmt ' && length >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    }
    if (chunkId === 'data') pcm = Buffer.from(buffer.subarray(start, end));
    offset = end + (length % 2);
  }

  if (!format || !pcm) throw new Error('WAV input must contain fmt and data chunks.');
  if (format.audioFormat !== 1) throw new Error('FunASR realtime input must use PCM encoding.');
  if (format.channels !== 1) throw new Error('FunASR realtime input must be mono.');
  if (format.sampleRate !== 16000) throw new Error('FunASR realtime input must use a 16 kHz sample rate.');
  if (format.bitsPerSample !== 16) throw new Error('FunASR realtime input must use 16-bit samples.');
  return { ...format, pcm };
}

export function redactSensitiveText(value) {
  return String(value ?? '')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/(Authorization:\s*Bearer\s+)[^\s,]+/gi, '$1[redacted]')
    .replace(/([?&](?:api[_-]?key|token|key)=)[^&\s]+/gi, '$1[redacted]');
}

export function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
