import express from 'express';
import cors from 'cors';
import { processVoiceInput } from './voiceEngine.js';
import { processDirectionsRoute } from './routeEngine.js';
import { verifyVisualLandmark } from './landmarkEngine.js';
import { processSpatialHazards } from './hazardEngine.js';
import { synthesizeSpatialAudio } from './spatialAudioEngine.js';
import { DEFAULT_USER_LOCATION, SAMPLE_PLACES, SAMPLE_DIRECTIONS_PAYLOAD } from './testCases.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'VoxNav Assistive Navigation Backend API',
    timestamp: new Date().toISOString()
  });
});

// Voice Control Engine Endpoint
app.post('/api/voice/process', (req, res) => {
  try {
    const { raw_user_speech, lat, lon, candidate_places } = req.body;
    const coords = {
      lat: typeof lat === 'number' ? lat : DEFAULT_USER_LOCATION.lat,
      lon: typeof lon === 'number' ? lon : DEFAULT_USER_LOCATION.lon
    };
    const places = Array.isArray(candidate_places) && candidate_places.length > 0 ? candidate_places : SAMPLE_PLACES;
    const result = processVoiceInput(raw_user_speech || '', coords, places, 500);
    return res.json(result);
  } catch (error) {
    console.error("Error processing voice input:", error);
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// Route Processing Engine Endpoint
app.post('/api/route/process', (req, res) => {
  try {
    const { google_maps_directions_response, step_length_m, nearby_places } = req.body;
    const payload = google_maps_directions_response || SAMPLE_DIRECTIONS_PAYLOAD;
    const stepLength = typeof step_length_m === 'number' && step_length_m > 0 ? step_length_m : 0.70;
    const places = Array.isArray(nearby_places) ? nearby_places : SAMPLE_PLACES;
    const result = processDirectionsRoute(payload, stepLength, places);
    return res.json(result);
  } catch (error) {
    console.error("Error processing route directions:", error);
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// Visual Landmark Verification Endpoint
app.post('/api/landmark/verify', (req, res) => {
  try {
    const { array_of_detected_strings, array_of_yolo_detections, expected_landmark_name, list_of_nearby_place_names } = req.body;
    const result = verifyVisualLandmark(
      array_of_detected_strings || [],
      array_of_yolo_detections || [],
      expected_landmark_name || '',
      list_of_nearby_place_names || []
    );
    return res.json(result);
  } catch (error) {
    console.error("Error verifying landmark:", error);
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// Spatial Hazard & Safety Engine Endpoint
app.post('/api/hazard/process', (req, res) => {
  try {
    const { object_detections, depth_map_hazards, user_movement_state } = req.body;
    const result = processSpatialHazards(
      object_detections || [],
      depth_map_hazards || {},
      user_movement_state || {}
    );
    return res.json(result);
  } catch (error) {
    console.error("Error processing spatial hazard:", error);
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// Real-Time Spatial Audio Synthesizer Endpoint
app.post('/api/audio/synthesize', (req, res) => {
  try {
    const { x_center, distance_m, is_critical_hazard, frame_timestamp } = req.body;
    const result = synthesizeSpatialAudio(
      typeof x_center === 'number' ? x_center : 0.0,
      typeof distance_m === 'number' ? distance_m : 2.5,
      Boolean(is_critical_hazard),
      frame_timestamp || Date.now()
    );
    return res.json(result);
  } catch (error) {
    console.error("Error synthesizing spatial audio:", error);
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// Gnani.ai Vachana TTS proxy — keeps GNANI_API_KEY server-side (never shipped to the browser).
// Docs: https://docs.gnani.ai/api/TTS/tts-inference
const GNANI_TTS_URL = 'https://api.vachana.ai/api/v1/tts/inference';
const GNANI_MODELS = new Set(['timbre-v2.5', 'timbre-v3.0']);
const GNANI_CONTAINERS = { wav: 'audio/wav', mp3: 'audio/mpeg' };
const GNANI_SAMPLE_RATES = new Set([8000, 16000, 22050, 24000, 44100, 48000]);
const TTS_MAX_CHARS = 1500;

app.get('/api/tts/status', (req, res) => {
  res.json({ provider: 'gnani', configured: Boolean(process.env.GNANI_API_KEY) });
});

// Gnani.ai Vachana Speech-to-Text proxy (Prisma). Browser POSTs raw audio bytes (16 kHz mono WAV
// from gnaniVoiceService.js); we forward as multipart to Gnani with the server-side key.
// Docs: https://docs.gnani.ai/api/STT/speech-to-text
const GNANI_STT_URL = 'https://api.vachana.ai/stt/v3';
const GNANI_STT_LANGUAGES = new Set(['bn-IN', 'en-IN', 'gu-IN', 'hi-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'pa-IN', 'ta-IN', 'te-IN', 'indic-auto']);
const STT_AUDIO_TYPES = { 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/aac': 'aac', 'audio/mp4': 'm4a' };

app.get('/api/voice/status', (req, res) => {
  const configured = Boolean(process.env.GNANI_API_KEY);
  res.json({ provider: 'gnani', tts: configured, stt: configured });
});

app.post('/api/stt', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '12mb' }), async (req, res) => {
  const apiKey = process.env.GNANI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'STT_NOT_CONFIGURED', message: 'GNANI_API_KEY is not set on the backend.' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length < 100) {
    return res.status(400).json({ error: 'EMPTY_AUDIO', message: 'Request body must be audio bytes.' });
  }

  // language may be a single code or a comma list (prisma-v3.0 accepts up to 4, e.g. "en-IN,hi-IN")
  const requested = String(req.query.language || process.env.GNANI_STT_LANGUAGE || 'en-IN')
    .split(',').map(s => s.trim()).filter(l => GNANI_STT_LANGUAGES.has(l)).slice(0, 4);
  const language = requested.length ? requested.join(',') : 'en-IN';
  const model = req.query.model === 'prisma-v2.5' ? null : 'prisma-v3.0'; // null = omit -> v2.5
  const contentType = (req.headers['content-type'] || 'audio/wav').split(';')[0].trim();
  const ext = STT_AUDIO_TYPES[contentType] || 'wav';

  const form = new FormData();
  form.append('audio_file', new Blob([req.body], { type: contentType }), `utterance.${ext}`);
  form.append('language_code', language);
  if (model) form.append('model', model);

  try {
    const upstream = await fetch(GNANI_STT_URL, {
      method: 'POST',
      headers: { 'X-API-Key-ID': apiKey },
      body: form,
      signal: AbortSignal.timeout(20000)
    });
    let body = {};
    try { body = await upstream.json(); } catch (e) { /* non-JSON */ }

    if (!upstream.ok || body.success === false) {
      // Envelopes: {error:{type,message}} | {detail:{error_code,message}} | {detail:[...]} | {code,...}
      const code = body?.error?.type || body?.detail?.error_code || body?.code || 'UPSTREAM_ERROR';
      const message = body?.error?.message || body?.detail?.message ||
        (Array.isArray(body?.detail) ? JSON.stringify(body.detail) : null) || body?.message ||
        `Gnani STT returned HTTP ${upstream.status}`;
      console.warn(`Gnani STT error ${upstream.status} ${code}: ${message}`);
      return res.status(upstream.status === 401 || upstream.status === 403 ? 502 : (upstream.status >= 400 ? upstream.status : 502))
        .json({ error: code, upstream_status: upstream.status, message });
    }

    const transcript = body.transcript ?? body?.output?.literal ?? body?.output?.transcript ?? '';
    return res.json({
      transcript: String(transcript).trim(),
      detected_language_code: body.detected_language_code || null,
      model: body.model || model || 'prisma-v2.5',
      request_id: body.request_id || null
    });
  } catch (error) {
    const timedOut = error.name === 'TimeoutError';
    console.error('Gnani STT request failed:', error.message);
    return res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNREACHABLE', message: error.message });
  }
});

app.post('/api/tts', async (req, res) => {
  const apiKey = process.env.GNANI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'TTS_NOT_CONFIGURED', message: 'GNANI_API_KEY is not set on the backend.' });
  }

  const { text, model, voice, language, speed, container, sample_rate } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'INVALID_TEXT', message: 'text is required.' });
  }
  if (text.length > TTS_MAX_CHARS) {
    return res.status(413).json({ error: 'TEXT_TOO_LONG', message: `text exceeds ${TTS_MAX_CHARS} characters.` });
  }

  const fmt = GNANI_CONTAINERS[container] ? container : 'wav';
  const rate = GNANI_SAMPLE_RATES.has(Number(sample_rate)) ? Number(sample_rate) : 24000;
  const payload = {
    text: text.trim(),
    model: GNANI_MODELS.has(model) ? model : (process.env.GNANI_TTS_MODEL || 'timbre-v2.5'),
    voice: typeof voice === 'string' && voice ? voice : (process.env.GNANI_TTS_VOICE || 'Nalini'),
    language: typeof language === 'string' && language ? language : (process.env.GNANI_TTS_LANGUAGE || 'en-IN'),
    audio_config: fmt === 'mp3'
      ? { container: 'mp3', sample_rate: rate, num_channels: 1, bitrate: '128k' }
      : { container: 'wav', encoding: 'linear_pcm', sample_rate: rate, num_channels: 1, sample_width: 2 }
  };
  const numericSpeed = Number(speed);
  if (Number.isFinite(numericSpeed)) payload.speed = Math.min(1.15, Math.max(0.85, numericSpeed));

  try {
    const upstream = await fetch(GNANI_TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key-ID': apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000)
    });

    if (!upstream.ok) {
      // Gnani errors: {success,message,status_code} or {detail:{error_code,message,status_code}}
      let message = `Gnani TTS returned HTTP ${upstream.status}`;
      let code = 'UPSTREAM_ERROR';
      try {
        const body = await upstream.json();
        message = body?.detail?.message || body?.message || message;
        code = body?.detail?.error_code || code;
      } catch (e) { /* non-JSON error body */ }
      console.warn(`Gnani TTS error ${upstream.status} ${code}: ${message}`);
      return res.status(upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status)
        .json({ error: code, upstream_status: upstream.status, message });
    }

    const audio = Buffer.from(await upstream.arrayBuffer());
    res.set('Content-Type', upstream.headers.get('content-type') || GNANI_CONTAINERS[fmt]);
    res.set('Cache-Control', 'no-store');
    return res.send(audio);
  } catch (error) {
    const timedOut = error.name === 'TimeoutError';
    console.error('Gnani TTS request failed:', error.message);
    return res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNREACHABLE', message: error.message });
  }
});

// Google Maps Places API (Nearby Search) proxy. Google's web-service endpoint doesn't send CORS
// headers, so the browser can't call it directly; this also keeps the API key server-side.
// Docs: https://developers.google.com/maps/documentation/places/web-service/search-nearby
const GOOGLE_NEARBY_URL = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
const googleMapsKey = () => process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;

app.get('/api/places/status', (req, res) => {
  res.json({ provider: 'google-maps', configured: Boolean(googleMapsKey()) });
});

app.get('/api/places/nearby', async (req, res) => {
  const apiKey = googleMapsKey();
  if (!apiKey) {
    return res.status(503).json({ error: 'PLACES_NOT_CONFIGURED', message: 'GOOGLE_MAPS_API_KEY is not set in backend/.env' });
  }

  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'INVALID_COORDINATES', message: 'lat and lng query parameters are required' });
  }
  const radius = Math.min(Math.max(Number(req.query.radius) || 500, 1), 50000);
  const keyword = String(req.query.keyword || '').trim().slice(0, 200);

  const params = new URLSearchParams({ location: `${lat},${lng}`, radius: String(radius), key: apiKey });
  if (keyword) params.set('keyword', keyword);

  try {
    const upstream = await fetch(`${GOOGLE_NEARBY_URL}?${params}`, { signal: AbortSignal.timeout(8000) });
    const data = await upstream.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error(`Google Places error: ${data.status} ${data.error_message || ''}`);
      return res.status(502).json({ error: data.status, message: data.error_message || 'Google Places request failed' });
    }

    const places = (data.results || []).map(p => ({
      place_id: p.place_id,
      name: p.name,
      category: keyword || (p.types && p.types[0]) || 'place',
      types: p.types || [],
      lat: p.geometry.location.lat,
      lon: p.geometry.location.lng,
      address: p.vicinity || '',
      rating: p.rating ?? null,
      open_now: p.opening_hours?.open_now ?? null,
      source: 'google_places'
    }));

    res.set('Cache-Control', 'no-store');
    return res.json({ status: data.status, places });
  } catch (error) {
    const timedOut = error.name === 'TimeoutError';
    console.error('Google Places request failed:', error.message);
    return res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNREACHABLE', message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`VoxNav Assistive Navigation Backend Server`);
  console.log(`Running on http://localhost:${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  GET  http://localhost:${PORT}/api/health`);
  console.log(`  POST http://localhost:${PORT}/api/voice/process`);
  console.log(`  POST http://localhost:${PORT}/api/route/process`);
  console.log(`  POST http://localhost:${PORT}/api/landmark/verify`);
  console.log(`  POST http://localhost:${PORT}/api/hazard/process`);
  console.log(`  POST http://localhost:${PORT}/api/audio/synthesize`);
  console.log(`  POST http://localhost:${PORT}/api/tts   (Gnani TTS: ${process.env.GNANI_API_KEY ? 'configured' : 'GNANI_API_KEY not set'})`);
  console.log(`  POST http://localhost:${PORT}/api/stt   (Gnani STT: ${process.env.GNANI_API_KEY ? 'configured' : 'GNANI_API_KEY not set'})`);
  console.log(`  GET  http://localhost:${PORT}/api/places/nearby   (Google Places: ${googleMapsKey() ? 'configured' : 'GOOGLE_MAPS_API_KEY not set'})`);
  console.log(`=================================================`);
});

export default app;
