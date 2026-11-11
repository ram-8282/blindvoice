// Gnani.ai Vachana Text-to-Speech for the VoxNav web app.
//
// The browser never sees GNANI_API_KEY: requests go to the VoxNav backend's /api/tts proxy
// (backend/server.js), which reads process.env.GNANI_API_KEY and calls
// https://api.vachana.ai/api/v1/tts/inference. Audio comes back as WAV/MP3 and is played
// with the HTML5 Audio API.

const DEFAULT_OPTIONS = {
  model: 'timbre-v2.5',   // or 'timbre-v3.0' (voices: Avinash, Shivani, Lakshmi, ...)
  voice: 'Nalini',        // must exist in the chosen model's catalog
  language: 'en-IN',
  speed: 1.0,             // 0.85 – 1.15
  container: 'wav',       // 'wav' (linear_pcm) or 'mp3'
  sample_rate: 24000
};

// Backend proxy base URL. Override before first use with configureGnaniVoice({ proxyUrl }).
let proxyUrl = 'http://localhost:4000';
let defaults = { ...DEFAULT_OPTIONS };

const TTS_CLIENT_TIMEOUT_MS = 12000;
// Errors that won't fix themselves this session -> stop trying Gnani TTS, go straight to fallback
const PERMANENT_TTS_ERRORS = new Set(['TTS_NOT_CONFIGURED', 'SCOPE_NOT_ALLOWED', 'INVALID_API_KEY', 'MISSING_API_KEY']);

let currentAudio = null;
let currentObjectUrl = null;
let currentAbort = null;
let statusCache = null; // Promise<boolean>
let ttsDisabledReason = null;

export class GnaniTTSError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = 'GnaniTTSError';
    this.code = code;
    this.status = status;
  }
}

export function configureGnaniVoice({ proxyUrl: url, ...opts } = {}) {
  if (url) proxyUrl = url.replace(/\/+$/, '');
  defaults = { ...defaults, ...opts };
  statusCache = null;
}

/** True when the backend is reachable AND has GNANI_API_KEY set. Cached; never throws. */
export function isGnaniAvailable() {
  if (ttsDisabledReason) return Promise.resolve(false);
  if (!statusCache) {
    statusCache = fetch(`${proxyUrl}/api/tts/status`, { signal: AbortSignal.timeout(3000) })
      .then(r => (r.ok ? r.json() : { configured: false }))
      .then(s => Boolean(s.configured))
      .catch(() => false);
  }
  return statusCache;
}

/** Stop any in-flight request and current playback. */
export function stopSpeaking() {
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

/**
 * Synthesize `text` with Gnani TTS and play it. Interrupts anything already speaking.
 * @param {string} text
 * @param {object} [options] model, voice, language, speed, container, sample_rate,
 *                           onStart(), onEnd() callbacks
 * @returns {Promise<void>} resolves when playback finishes (or is interrupted by a newer call);
 *                          rejects with GnaniTTSError if synthesis or playback fails.
 */
export async function speakText(text, options = {}) {
  if (typeof text !== 'string' || !text.trim()) return;
  const { onStart, onEnd, ...overrides } = options;
  const opts = { ...defaults, ...overrides };

  stopSpeaking();
  const abort = new AbortController();
  currentAbort = abort;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort.abort(); }, TTS_CLIENT_TIMEOUT_MS);

  let response, blob;
  try {
    response = await fetch(`${proxyUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...opts }),
      signal: abort.signal
    });

    if (!response.ok) {
      let body = {};
      try { body = await response.json(); } catch (e) { /* ignore */ }
      const code = body.error || 'TTS_FAILED';
      if (PERMANENT_TTS_ERRORS.has(code)) {
        ttsDisabledReason = code;
        statusCache = Promise.resolve(false);
      }
      throw new GnaniTTSError(body.message || `TTS failed (HTTP ${response.status})`, {
        code,
        status: body.upstream_status || response.status
      });
    }
    blob = await response.blob();
  } catch (err) {
    if (err instanceof GnaniTTSError) throw err;
    if (err.name === 'AbortError') {
      if (!timedOut) return; // superseded by a newer speakText()/stopSpeaking()
      throw new GnaniTTSError(`TTS timed out after ${TTS_CLIENT_TIMEOUT_MS / 1000}s`, { code: 'CLIENT_TIMEOUT' });
    }
    throw new GnaniTTSError(`TTS backend unreachable at ${proxyUrl}: ${err.message}`, { code: 'BACKEND_UNREACHABLE' });
  } finally {
    clearTimeout(timer);
  }

  if (abort.signal.aborted) return;
  currentAbort = null;

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;
  currentObjectUrl = url;

  await new Promise((resolve, reject) => {
    const cleanup = () => {
      if (currentAudio === audio) {
        currentAudio = null;
        URL.revokeObjectURL(url);
        currentObjectUrl = null;
      }
    };
    audio.onended = () => { cleanup(); if (onEnd) onEnd(); resolve(); };
    audio.onpause = () => { if (!audio.ended && currentAudio !== audio) { if (onEnd) onEnd(); resolve(); } };
    audio.onerror = () => {
      cleanup();
      if (onEnd) onEnd();
      reject(new GnaniTTSError('Browser could not play the returned audio.', { code: 'PLAYBACK_FAILED' }));
    };
    audio.play().then(() => { if (onStart) onStart(); }).catch((err) => {
      cleanup();
      if (onEnd) onEnd();
      // NotAllowedError = autoplay policy (no user gesture yet)
      reject(new GnaniTTSError(`Playback blocked: ${err.message}`, { code: err.name === 'NotAllowedError' ? 'AUTOPLAY_BLOCKED' : 'PLAYBACK_FAILED' }));
    });
  });
}

/** Why Gnani TTS was switched off this session (e.g. 'SCOPE_NOT_ALLOWED'), or null. */
export function getTtsDisabledReason() {
  return ttsDisabledReason;
}

// ─────────────────────────────────────────────────────────────────────────────
// Speech-to-Text (listening side of the two-way loop) — Gnani Prisma via /api/stt
// ─────────────────────────────────────────────────────────────────────────────

const STT_SAMPLE_RATE = 16000;     // Gnani converts to 16 kHz mono anyway
const STT_MAX_MS = 15000;          // hard stop (Gnani limit is 30 s)
const STT_SILENCE_MS = 1400;       // end of utterance after this much silence following speech
const STT_NO_SPEECH_MS = 7000;     // give up if the user never starts speaking
const STT_LEVEL_THRESHOLD = 0.035; // RMS above this counts as speech
const STT_CLIENT_TIMEOUT_MS = 20000;
const PERMANENT_STT_ERRORS = new Set(['STT_NOT_CONFIGURED', 'SCOPE_NOT_ALLOWED', 'INVALID_API_KEY', 'MISSING_API_KEY']);

let sttDisabledReason = null;
let sttStatusCache = null;
let activeRecording = null; // { stop(), cancel() }

/** True when the backend has Gnani STT configured (and it hasn't failed permanently). Never throws. */
export function isGnaniSttAvailable() {
  if (sttDisabledReason) return Promise.resolve(false);
  if (!sttStatusCache) {
    sttStatusCache = fetch(`${proxyUrl}/api/voice/status`, { signal: AbortSignal.timeout(3000) })
      .then(r => (r.ok ? r.json() : { stt: false }))
      .then(s => Boolean(s.stt))
      .catch(() => false);
  }
  return sttStatusCache;
}

export function getSttDisabledReason() {
  return sttDisabledReason;
}

/** True while the mic is open for an utterance. */
export function isRecording() {
  return activeRecording !== null;
}

/** Finish the current utterance now (it is still transcribed). */
export function stopListening() {
  if (activeRecording) activeRecording.stop();
}

/** Abort the current utterance without transcribing. */
export function cancelListening() {
  if (activeRecording) activeRecording.cancel();
}

/**
 * Record one utterance from the microphone. Stops automatically on trailing silence,
 * after STT_MAX_MS, or when stopListening() is called. Resolves to a 16 kHz mono WAV Blob,
 * or null if no speech was heard / cancelled.
 * @param {object} [o] deviceId, onLevel(0..1), onSpeechStart()
 */
export async function recordUtterance({ deviceId, onLevel, onSpeechStart } = {}) {
  if (activeRecording) activeRecording.cancel();
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new GnaniTTSError('Microphone recording is not supported in this browser.', { code: 'NO_MEDIARECORDER' });
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1,
      echoCancellation: true,   // avoid transcribing our own spoken reply
      noiseSuppression: true
    }
  });

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  return new Promise((resolve, reject) => {
    let heardSpeech = false;
    let cancelled = false;
    let lastVoiceAt = performance.now();
    const startedAt = lastVoiceAt;
    let rafId = null;

    const teardown = () => {
      if (rafId) cancelAnimationFrame(rafId);
      stream.getTracks().forEach(t => t.stop());
      ctx.close().catch(() => {});
      activeRecording = null;
      if (onLevel) onLevel(0);
    };

    const finish = () => { if (recorder.state !== 'inactive') recorder.stop(); };

    recorder.onstop = async () => {
      teardown();
      if (cancelled || !heardSpeech || !chunks.length) return resolve(null);
      try {
        resolve(await encodeWav16kMono(new Blob(chunks, { type: recorder.mimeType })));
      } catch (err) {
        reject(new GnaniTTSError(`Could not process recording: ${err.message}`, { code: 'ENCODE_FAILED' }));
      }
    };
    recorder.onerror = (e) => {
      teardown();
      reject(new GnaniTTSError(`Recorder error: ${e.error?.message || 'unknown'}`, { code: 'RECORDER_ERROR' }));
    };

    // Simple energy-based voice activity detection
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);
      if (onLevel) onLevel(Math.min(1, rms * 8));

      const now = performance.now();
      if (rms > STT_LEVEL_THRESHOLD) {
        if (!heardSpeech && onSpeechStart) onSpeechStart();
        heardSpeech = true;
        lastVoiceAt = now;
      }
      if ((heardSpeech && now - lastVoiceAt > STT_SILENCE_MS) ||
          (!heardSpeech && now - startedAt > STT_NO_SPEECH_MS) ||
          now - startedAt > STT_MAX_MS) {
        return finish();
      }
      rafId = requestAnimationFrame(tick);
    };

    activeRecording = {
      stop: finish,
      cancel: () => { cancelled = true; finish(); }
    };
    recorder.start(250);
    tick();
  });
}

/** Decode any browser-recorded blob (webm/ogg/...) and re-encode as 16 kHz mono 16-bit PCM WAV. */
async function encodeWav16kMono(blob) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const decodeCtx = new AudioCtx();
  let decoded;
  try {
    decoded = await decodeCtx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    decodeCtx.close().catch(() => {});
  }
  const length = Math.max(1, Math.ceil(decoded.duration * STT_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, length, STT_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination); // down-mixes to mono
  src.start();
  const pcm = (await offline.startRendering()).getChannelData(0);
  return pcmToWav(pcm, STT_SAMPLE_RATE);
}

/** Float32 mono samples -> 16-bit PCM WAV Blob. Exported for testing. */
export function pcmToWav(pcm, sampleRate) {
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); writeStr(8, 'WAVE');
  writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0, off = 44; i < pcm.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Send audio to Gnani STT. Resolves to { transcript, detected_language_code }.
 * @param {Blob} audio WAV/MP3/OGG/FLAC/AAC/M4A, <= 30 s
 * @param {object} [o] language ('en-IN', 'hi-IN', 'en-IN,hi-IN', 'indic-auto', ...)
 */
export async function transcribeAudio(audio, { language } = {}) {
  const qs = language ? `?language=${encodeURIComponent(language)}` : '';
  let response;
  try {
    response = await fetch(`${proxyUrl}/api/stt${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': audio.type || 'audio/wav' },
      body: audio,
      signal: AbortSignal.timeout(STT_CLIENT_TIMEOUT_MS)
    });
  } catch (err) {
    const code = err.name === 'TimeoutError' ? 'CLIENT_TIMEOUT' : 'BACKEND_UNREACHABLE';
    throw new GnaniTTSError(`STT request failed: ${err.message}`, { code });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = body.error || 'STT_FAILED';
    if (PERMANENT_STT_ERRORS.has(code)) {
      sttDisabledReason = code;
      sttStatusCache = Promise.resolve(false);
    }
    throw new GnaniTTSError(body.message || `STT failed (HTTP ${response.status})`, { code, status: body.upstream_status || response.status });
  }
  return { transcript: body.transcript || '', detected_language_code: body.detected_language_code || null };
}

/**
 * Listen for one utterance and transcribe it with Gnani.
 * Resolves to { transcript, detected_language_code } (transcript '' if nothing was said).
 */
export async function listen({ language, deviceId, onLevel, onSpeechStart, onTranscribing } = {}) {
  stopSpeaking(); // never record over our own voice
  const wav = await recordUtterance({ deviceId, onLevel, onSpeechStart });
  if (!wav) return { transcript: '', detected_language_code: null };
  if (onTranscribing) onTranscribing();
  return transcribeAudio(wav, { language });
}
