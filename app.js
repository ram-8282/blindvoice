import { processVoiceInput, extractTargetAmenity } from './voiceEngine.js';
import { fetchNearbyPlaces, isGoogleMapsAvailable } from './src/services/googleMapsService.js';
import { analyzeDetections, findPriorityHazard, extractSignText, formatSignAnnouncement, extractSceneSignTexts, isActiveHazard } from './visionAnalysis.js';
import { readSignText, findTextSigns, preloadOcr } from './signOcr.js';
import { NavigationModeController, StepDetector } from './navigationModeController.js';
import { createAirportMode } from './src/components/airportMode.js';

let airportMode = null; // created on DOMContentLoaded
import { processDirectionsRoute } from './routeEngine.js';
import { verifyVisualLandmark, calculateStringSimilarity } from './landmarkEngine.js';
import { processSpatialHazards } from './hazardEngine.js';
import { synthesizeSpatialAudio } from './spatialAudioEngine.js';
import { loadDetector, detectObjects } from './browserDetector.js';
import {
  speakText, stopSpeaking as stopGnaniSpeech, isGnaniAvailable,
  listen, stopListening, cancelListening, isRecording, isGnaniSttAvailable
} from './src/services/gnaniVoiceService.js';
import { DEFAULT_USER_LOCATION, SAMPLE_PLACES, PRESET_TEST_SCENARIOS, SAMPLE_DIRECTIONS_PAYLOAD } from './testCases.js';

// Application State
let currentPlaces = [...SAMPLE_PLACES];
let currentDirectionsPayload = { ...SAMPLE_DIRECTIONS_PAYLOAD };
let userLocation = { ...DEFAULT_USER_LOCATION };
let isListening = false;
let speechRecognizer = null;
let lastVoiceOutput = null;
let lastRouteOutput = null;
let lastLandmarkOutput = null;
let lastHazardOutput = null;
let lastSynthAudioOutput = null;
let stepLengthMeters = 0.70;

let audioCtx = null;
let micStream = null;
let micAudioContext = null;
let micAnalyser = null;
let visualizerAnimationFrame = null;
let selectedAudioDeviceId = '';
let activeSpeechUtterance = null;
let cameraStream = null;
let isCameraActive = false;
let autoSimIntervalId = null;

// DOM Elements - Voice Engine
const rawSpeechInput = document.getElementById('raw-speech-input');
const btnProcess = document.getElementById('btn-process');
const btnMic = document.getElementById('btn-mic');
const micStatusText = document.getElementById('mic-status');
const micContainer = document.getElementById('mic-container');
const micDeviceSelect = document.getElementById('mic-device-select');
const btnRefreshMics = document.getElementById('btn-refresh-mics');
const micAudioVisualizer = document.getElementById('mic-audio-visualizer');
const liveSttBadge = document.getElementById('live-stt-badge');
const liveSttPreview = document.getElementById('live-stt-preview');
const toggleConversation = document.getElementById('toggle-conversation-mode');
const spokenCard = document.getElementById('spoken-card');
const presetsContainer = document.getElementById('presets-container');
const spokenResponseText = document.getElementById('spoken-response-text');
const btnSpeakAgain = document.getElementById('btn-speak-again');
const badgeIntent = document.getElementById('badge-intent');
const badgeTarget = document.getElementById('badge-target');
const badgeConfidence = document.getElementById('badge-confidence');
const badgePlaceId = document.getElementById('badge-place-id');
const jsonOutputCode = document.getElementById('json-output-code');
const btnCopyJson = document.getElementById('btn-copy-json');
const inputLat = document.getElementById('input-lat');
const inputLon = document.getElementById('input-lon');
const btnUseGps = document.getElementById('btn-use-gps');
const jsonPlacesInput = document.getElementById('json-places-input');

// DOM Elements - Route Engine
const stepLengthRange = document.getElementById('step-length-range');
const stepLengthValue = document.getElementById('step-length-value');
const btnProcessRoute = document.getElementById('btn-process-route');
const btnReadRouteAloud = document.getElementById('btn-read-route-aloud');
const routeTotalSteps = document.getElementById('route-total-steps');
const routeTotalMilestones = document.getElementById('route-total-milestones');
const milestonesTimelineList = document.getElementById('milestones-timeline-list');

// DOM Elements - Visual Landmark Engine
const targetLandmarkInput = document.getElementById('target-landmark-input');
const btnVerifyLandmark = document.getElementById('btn-verify-landmark');
const landmarkMatchBadge = document.getElementById('landmark-match-badge');
const badgeMatchedLandmark = document.getElementById('badge-matched-landmark');
const spokenLandmarkText = document.getElementById('spoken-landmark-text');
const btnSpeakLandmark = document.getElementById('btn-speak-landmark');

// DOM Elements - Landmark Camera & Dynamic Bounding Boxes
const btnToggleCamera = document.getElementById('btn-toggle-camera');
const btnCameraText = document.getElementById('btn-camera-text');
const cameraVideo = document.getElementById('camera-video');
const cameraImageFallback = document.getElementById('camera-image-fallback');
const cameraPlaceholder = document.getElementById('camera-placeholder');
const cameraFileInput = document.getElementById('camera-file-input');
const cameraOverlaysContainer = document.getElementById('camera-overlays-container');
const cameraViewport = document.getElementById('camera-viewport');
const cameraShutterFlash = document.getElementById('camera-shutter-flash');
const cameraStatusDot = document.getElementById('camera-status-dot');
const cameraStatusBadge = document.getElementById('camera-status-badge');
const hudCamStatus = document.getElementById('hud-cam-status');
const hudDetectionsCount = document.getElementById('hud-detections-count');
const hudSourceBadge = document.getElementById('hud-source-badge');
const btnSimulateCapture = document.getElementById('btn-simulate-capture');
const toggleAutoFrameSim = document.getElementById('toggle-auto-frame-sim');

// DOM Elements - Spatial Hazard Engine
const hazardTypeSelect = document.getElementById('hazard-type-select');
const hazardDistInput = document.getElementById('hazard-dist-input');
const hazardAngleRange = document.getElementById('hazard-angle-range');
const hazardAngleLabel = document.getElementById('hazard-angle-label');
const btnProcessHazard = document.getElementById('btn-process-hazard');
const btnPlaySpatialPing = document.getElementById('btn-play-spatial-ping');
const radarTargetDot = document.getElementById('radar-target-dot');
const hazardRadarViewport = document.getElementById('hazard-radar-viewport');
const hazardMarkersContainer = document.getElementById('hazard-markers-container');
const hazardCountBadge = document.getElementById('hazard-count-badge');
const activeHazardsChips = document.getElementById('active-hazards-chips');
const btnClearAllHazards = document.getElementById('btn-clear-all-hazards');
const btnResetDefaultHazards = document.getElementById('btn-reset-default-hazards');
const badgeHazardPresent = document.getElementById('badge-hazard-present');
const badgeHazardSeverity = document.getElementById('badge-hazard-severity');
const badgeSpatialPan = document.getElementById('badge-spatial-pan');
const badgeSpatialPitch = document.getElementById('badge-spatial-pitch');
const badgeSpatialPulse = document.getElementById('badge-spatial-pulse');
const spokenHazardText = document.getElementById('spoken-hazard-text');
const btnSpeakHazardAlert = document.getElementById('btn-speak-hazard-alert');
const jsonHazardOutputCode = document.getElementById('json-hazard-output-code');
const btnCopyHazardJson = document.getElementById('btn-copy-hazard-json');

// DOM Elements - Spatial Audio Synthesizer Engine
const audioRadarViewport = document.getElementById('audio-radar-viewport');
const audioTargetPuck = document.getElementById('audio-target-puck');
const puckCoordBadge = document.getElementById('puck-coord-badge');
const audioXcenterRange = document.getElementById('audio-xcenter-range');
const audioXcenterLabel = document.getElementById('audio-xcenter-label');
const audioDistRange = document.getElementById('audio-dist-range');
const audioDistLabel = document.getElementById('audio-dist-label');
const audioHazardCheckbox = document.getElementById('audio-hazard-checkbox');
const btnSynthesizeAudio = document.getElementById('btn-synthesize-audio');
const btnPlaySynthPulse = document.getElementById('btn-play-synth-pulse');
const synthBadgePan = document.getElementById('synth-badge-pan');
const synthBadgeFreq = document.getElementById('synth-badge-freq');
const synthBadgeGain = document.getElementById('synth-badge-gain');
const synthBadgePulse = document.getElementById('synth-badge-pulse');
const synthBadgeWaveform = document.getElementById('synth-badge-waveform');
const synthBadgeBracket = document.getElementById('synth-badge-bracket');
const jsonSynthOutputCode = document.getElementById('json-synth-output-code');
const btnCopySynthJson = document.getElementById('btn-copy-synth-json');

// DOM Elements - Tabs
const tabVoiceEngine = document.getElementById('tab-voice-engine');
const tabRouteEngine = document.getElementById('tab-route-engine');
const tabLandmarkEngine = document.getElementById('tab-landmark-engine');
const tabHazardEngine = document.getElementById('tab-hazard-engine');
const tabAudioEngine = document.getElementById('tab-audio-engine');
const viewVoiceEngine = document.getElementById('view-voice-engine');
const viewRouteEngine = document.getElementById('view-route-engine');
const viewLandmarkEngine = document.getElementById('view-landmark-engine');
const viewHazardEngine = document.getElementById('view-hazard-engine');
const viewAudioEngine = document.getElementById('view-audio-engine');
const srAnnouncer = document.getElementById('sr-announcer');
const btnToggleHighContrast = document.getElementById('toggle-high-contrast');

// --- Multi-modal navigation fallback (GPS -> dead reckoning -> visual match) -----------------
const navController = new NavigationModeController({ stepLengthM: stepLengthMeters });
const stepDetector = new StepDetector();

function updateNavModeBadge() {
  const badge = document.getElementById('nav-mode-badge');
  if (!badge) return;
  const status = navController.getStatus();
  if (badge.dataset.mode !== status.mode) announceToScreenReader(`Tracking source: ${status.badge}`);
  badge.dataset.mode = status.mode;
  badge.textContent = `[${status.badge}]`;
  badge.title = status.detail;
  badge.setAttribute('aria-label', `Tracking source: ${status.badge}. ${status.detail}`);
}

function initNavigationTracking() {
  // Mode A: continuous GPS. Fixes with accuracy >= 15 m don't count, so indoors it degrades to Mode B.
  if (navigator.geolocation && navigator.geolocation.watchPosition) {
    navigator.geolocation.watchPosition(
      (pos) => {
        navController.updateGps({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy });
        updateNavModeBadge();
      },
      (err) => console.warn('GPS watch:', err.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
  }

  // Mode B: accelerometer step counting
  const onMotion = (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    if (stepDetector.push(a.x, a.y, a.z, e.timeStamp || performance.now())) {
      navController.addSteps(1);
      updateNavModeBadge();
      if (airportMode) airportMode.onSteps(1);
    }
  };
  const startMotion = () => window.addEventListener('devicemotion', onMotion);
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    // iOS only grants motion access from a user gesture
    window.addEventListener('pointerdown', () => {
      DeviceMotionEvent.requestPermission().then(state => { if (state === 'granted') startMotion(); }).catch(() => {});
    }, { once: true });
  } else if (typeof DeviceMotionEvent !== 'undefined') {
    startMotion();
  }

  // Re-evaluate periodically: GPS goes stale and the visual-match hold expires without new events
  setInterval(() => {
    navController.setStepLength(stepLengthMeters);
    updateNavModeBadge();
  }, 1000);
  updateNavModeBadge();
}

// Show whether voice I/O is running on Gnani.ai or the browser fallback
async function updateGnaniBadge() {
  const badge = document.getElementById('gnani-badge');
  const label = document.getElementById('gnani-badge-text');
  if (!badge || !label) return;
  const [tts, stt] = await Promise.all([isGnaniAvailable(), isGnaniSttAvailable()]);
  let state, text;
  if (tts && stt) {
    state = 'active';
    text = 'Voice powered by Gnani.ai — speech-to-text & text-to-speech active';
  } else if (tts || stt) {
    state = 'partial';
    text = `Voice powered by Gnani.ai — ${tts ? 'text-to-speech' : 'speech-to-text'} active, other uses browser fallback`;
  } else {
    state = 'fallback';
    text = 'Gnani.ai unavailable — using browser speech';
  }
  badge.dataset.state = state;
  label.textContent = text;
}

// Initialize Web App
document.addEventListener('DOMContentLoaded', () => {
  initLocationAndPlaces();
  initRouteSetup();
  initAudioDevices();
  renderPresetButtons();
  initSpeechRecognition();
  bindEvents();
  updateGnaniBadge();
  initNavigationTracking();
  airportMode = createAirportMode({
    speak: (text, level) => speakTextToSpeech(text, { priority: level === 'LOW' ? SPEECH_PRIORITY.LANDMARK : SPEECH_PRIORITY.NORMAL }),
    startCamera: async () => { if (!isCameraActive) await toggleCameraStream(); return isCameraActive; },
    stopCamera: () => { if (isCameraActive) toggleCameraStream(); },
    startAutoDetect,
    stopAutoDetect: stopAutoInferenceLoop,
    startListening: startConversation,
    stopListening: () => endConversation(),
    onVisualMatch: (name) => { navController.confirmVisualMatch(name); updateNavModeBadge(); },
    onModeChange: () => {},
    announce: announceToScreenReader,
    getStepLength: () => stepLengthMeters
  });

  // Auto-run initial scenarios across all 5 engines
  executeVoiceEngine(PRESET_TEST_SCENARIOS[0].spoken_text, false);
  executeRouteEngine(false);
  renderLandmarkIdleState();
  clearDetections();
  syncSelectedHazardToInputs();
  executeHazardEngine(false);
  executeSpatialAudioSynthesizer(false);
});

function initLocationAndPlaces() {
  inputLat.value = userLocation.lat;
  inputLon.value = userLocation.lon;
  jsonPlacesInput.value = JSON.stringify(currentPlaces, null, 2);
}

function initRouteSetup() {
  stepLengthRange.value = stepLengthMeters;
  stepLengthValue.textContent = `${stepLengthMeters.toFixed(2)} meters`;
}

// Microphone Device Enumeration & Selection
async function initAudioDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    if (micDeviceSelect) {
      micDeviceSelect.innerHTML = '<option value="">Default System Microphone</option>';
    }
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');

    if (micDeviceSelect) {
      micDeviceSelect.innerHTML = '';
      if (audioInputs.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Default Microphone (Permission required to label)';
        micDeviceSelect.appendChild(opt);
      } else {
        audioInputs.forEach((device, idx) => {
          const opt = document.createElement('option');
          opt.value = device.deviceId;
          opt.textContent = device.label || `Microphone ${idx + 1} (${device.deviceId.slice(0, 8)}...)`;
          if (device.deviceId === selectedAudioDeviceId) {
            opt.selected = true;
          }
          micDeviceSelect.appendChild(opt);
        });
      }
    }
  } catch (err) {
    console.warn("Could not enumerate audio devices:", err);
  }
}

// Active Audio Visualizer inside Mic Button Container (Web Audio API + fallback)
async function startAudioVisualizer() {
  if (micContainer) micContainer.classList.add('recording');

  try {
    if (!micAudioContext) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        micAudioContext = new AudioCtxClass();
      }
    }
    if (micAudioContext && micAudioContext.state === 'suspended') {
      await micAudioContext.resume();
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const constraints = {
        audio: selectedAudioDeviceId ? { deviceId: { exact: selectedAudioDeviceId } } : true
      };
      micStream = await navigator.mediaDevices.getUserMedia(constraints);
      const source = micAudioContext.createMediaStreamSource(micStream);
      micAnalyser = micAudioContext.createAnalyser();
      micAnalyser.fftSize = 64;
      micAnalyser.smoothingTimeConstant = 0.75;
      source.connect(micAnalyser);

      const bufferLength = micAnalyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const bars = document.querySelectorAll('.mic-audio-visualizer .v-bar');

      function updateVisualizer() {
        if (!isListening) return;
        micAnalyser.getByteFrequencyData(dataArray);

        if (bars.length > 0) {
          const step = Math.max(1, Math.floor(bufferLength / bars.length));
          bars.forEach((bar, idx) => {
            const dataIndex = Math.min(bufferLength - 1, idx * step);
            const value = dataArray[dataIndex] || 0;
            const normalized = Math.max(0.18, Math.min(1.0, value / 170));
            bar.style.transform = `scaleY(${normalized.toFixed(2)})`;
          });
        }
        visualizerAnimationFrame = requestAnimationFrame(updateVisualizer);
      }
      updateVisualizer();
    }
  } catch (err) {
    console.info("Web Audio mic stream unavailable; CSS bar animation fallback active:", err);
  }
}

function stopAudioVisualizer() {
  if (micContainer) micContainer.classList.remove('recording');
  if (visualizerAnimationFrame) {
    cancelAnimationFrame(visualizerAnimationFrame);
    visualizerAnimationFrame = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  const bars = document.querySelectorAll('.mic-audio-visualizer .v-bar');
  bars.forEach(bar => {
    bar.style.transform = 'scaleY(0.18)';
  });
}

function renderPresetButtons() {
  presetsContainer.innerHTML = '';
  PRESET_TEST_SCENARIOS.forEach((scenario, index) => {
    const chip = document.createElement('button');
    chip.className = 'preset-chip' + (index === 0 ? ' active' : '');
    chip.textContent = `"${scenario.spoken_text}"`;
    chip.setAttribute('aria-label', `Test scenario: ${scenario.label}`);
    chip.addEventListener('click', () => {
      // 1. Highlight clicked chip
      document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      // 2. Automatically populate raw input field
      rawSpeechInput.value = scenario.spoken_text;

      // 3. Trigger Voice Engine process and auto-play synthesized spoken response
      executeVoiceEngine(scenario.spoken_text, true);
    });
    presetsContainer.appendChild(chip);
  });
}

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    speechRecognizer = new SpeechRecognition();
    speechRecognizer.continuous = false;
    speechRecognizer.interimResults = true;
    speechRecognizer.lang = 'en-IN';

    speechRecognizer.onstart = () => {
      isListening = true;
      btnMic.classList.add('listening');
      micStatusText.textContent = "Listening... Speak now!";
      if (liveSttBadge) liveSttBadge.classList.remove('hidden');
      if (liveSttPreview) {
        liveSttPreview.classList.remove('hidden');
        liveSttPreview.textContent = "Awaiting speech...";
      }
      rawSpeechInput.classList.add('live-transcribing');
      startAudioVisualizer();
      announceToScreenReader("Microphone active. Listening for destination.");
    };

    speechRecognizer.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';
      for (let i = 0; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      // Display live intermediate STT directly inside rawSpeechInput field
      const liveText = finalTranscript || interimTranscript;
      if (liveText) {
        rawSpeechInput.value = liveText;
        if (liveSttPreview) liveSttPreview.textContent = `Live STT: "${liveText}"`;
      }
    };

    speechRecognizer.onerror = (event) => {
      console.warn("Speech recognition error:", event.error);
      isListening = false;
      btnMic.classList.remove('listening');
      stopAudioVisualizer();
      rawSpeechInput.classList.remove('live-transcribing');
      if (liveSttBadge) liveSttBadge.classList.add('hidden');
      if (liveSttPreview) liveSttPreview.classList.add('hidden');
      micStatusText.textContent = "Voice error. Click mic or type prompt.";
    };

    speechRecognizer.onend = () => {
      isListening = false;
      btnMic.classList.remove('listening');
      stopAudioVisualizer();
      rawSpeechInput.classList.remove('live-transcribing');
      if (liveSttBadge) liveSttBadge.classList.add('hidden');
      if (liveSttPreview) liveSttPreview.classList.add('hidden');
      micStatusText.textContent = "Click button or press Microphone to speak";

      // Auto-trigger the Voice Engine logic with speech synthesis
      const speechQuery = rawSpeechInput.value.trim();
      if (speechQuery && airportMode && airportMode.isActive()) {
        const reply = airportMode.handleTranscript(speechQuery);
        Promise.resolve(reply ? speakTextToSpeech(reply) : null)
          .then(() => { if (conversationMode && airportMode.isHandsFree()) scheduleNextTurn(); });
      } else if (speechQuery) {
        executeVoiceEngine(speechQuery, true);
      }
    };
  } else {
    micStatusText.textContent = "Speech Recognition API not supported in browser. (Use manual input)";
  }
}

// 1. Voice Engine Controller
const PLACES_SEARCH_RADIUS = 500;
let voiceRequestSeq = 0;

function setPlacesSource(state, text) {
  const el = document.getElementById('places-source');
  if (!el) return;
  el.dataset.state = state;
  el.textContent = text;
}

// Fetch live candidates from Google Places for the spoken keyword. Returns null when the
// live search isn't available, so the caller falls back to the JSON in the textarea.
async function loadLiveCandidates(keyword, lat, lon) {
  if (!keyword || keyword.length < 2 || !(await isGoogleMapsAvailable())) return null;
  setPlacesSource('loading', `Searching Google Maps for "${keyword}"…`);
  try {
    const places = await fetchNearbyPlaces(lat, lon, PLACES_SEARCH_RADIUS, keyword);
    setPlacesSource('live', `Live: Google Maps — ${places.length} result${places.length === 1 ? '' : 's'} for "${keyword}"`);
    return places;
  } catch (err) {
    console.warn(`Google Places search failed (${err.code}): ${err.message}`);
    setPlacesSource('error', `Google Maps error (${err.code}) — using sample data`);
    return null;
  }
}

async function executeVoiceEngine(speechText, speakAudio = true) {
  const requestId = ++voiceRequestSeq;
  const lat = parseFloat(inputLat.value) || userLocation.lat;
  const lon = parseFloat(inputLon.value) || userLocation.lon;

  const keyword = extractTargetAmenity(speechText);
  const livePlaces = await loadLiveCandidates(keyword, lat, lon);
  // A newer query started while this one was waiting on Google; drop the stale result.
  if (requestId !== voiceRequestSeq) return lastVoiceOutput;

  let placesList = currentPlaces;
  if (livePlaces) {
    placesList = livePlaces;
    jsonPlacesInput.value = JSON.stringify(livePlaces, null, 2);
  } else {
    try { placesList = JSON.parse(jsonPlacesInput.value); } catch (err) {}
    if (!(await isGoogleMapsAvailable())) setPlacesSource('sample', 'Sample data — add GOOGLE_MAPS_API_KEY to backend/.env for live results');
  }

  const result = processVoiceInput(speechText, { lat, lon }, placesList, PLACES_SEARCH_RADIUS, { preferNearest: Boolean(livePlaces) });
  lastVoiceOutput = result;
  renderVoiceResults(result);

  if (speakAudio && result.spoken_response) {
    speakTextToSpeech(result.spoken_response);
  }
  return result;
}

function renderVoiceResults(result) {
  spokenResponseText.textContent = `"${result.spoken_response}"`;
  badgeIntent.textContent = result.intent;
  badgeIntent.className = 'badge ' + (result.intent === 'NAVIGATE' ? 'badge-navigate' : (result.intent === 'CLARIFY' ? 'badge-clarify' : 'badge-unknown'));
  badgeTarget.textContent = result.target_amenity_or_place || 'null';
  badgeConfidence.textContent = result.confidence.toFixed(2);
  badgePlaceId.textContent = result.selected_place_id || 'null';
  jsonOutputCode.textContent = JSON.stringify(result, null, 2);
  announceToScreenReader(`Voice Engine result: ${result.intent}. ${result.spoken_response}`);
}

// 2. Route Engine Controller
function executeRouteEngine(speakAudio = false) {
  const directionsPayload = currentDirectionsPayload;

  const stepLen = parseFloat(stepLengthRange.value) || 0.70;
  const routeResult = processDirectionsRoute(directionsPayload, stepLen, currentPlaces);
  lastRouteOutput = routeResult;
  renderRouteResults(routeResult);

  if (speakAudio && routeResult.milestones.length > 0) readAllRouteMilestonesAloud(routeResult);
}

function renderRouteResults(routeResult) {
  routeTotalSteps.textContent = `${routeResult.total_steps} steps`;
  routeTotalMilestones.textContent = routeResult.milestones.length;
  milestonesTimelineList.innerHTML = '';

  if (routeResult.milestones.length === 0) {
    milestonesTimelineList.innerHTML = '<p class="text-muted text-sm">No milestones available in payload.</p>';
  } else {
    routeResult.milestones.forEach(m => {
      const item = document.createElement('div');
      const typeClass = m.type.toLowerCase().replace('_', '-');
      item.className = `milestone-item ${typeClass}`;
      const typeBadgeClass = m.type === 'WALK_STRAIGHT' ? 'badge-navigate' : (m.type === 'TURN_LEFT' ? 'badge-clarify' : (m.type === 'TURN_RIGHT' ? 'badge-unknown' : 'badge-navigate'));
      const landmarkTags = m.expected_landmarks.map(l => `<span class="landmark-tag">${l}</span>`).join(' ');

      item.innerHTML = `
        <div class="milestone-header">
          <span class="milestone-index">Milestone ${m.step_index + 1} (${m.distance_in_steps} steps)</span>
          <span class="badge ${typeBadgeClass}">${m.type}</span>
        </div>
        <div class="milestone-instruction">${m.instruction}</div>
        ${m.expected_landmarks.length > 0 ? `<div class="landmarks-row"><span class="landmark-label">Visual Landmarks:</span>${landmarkTags}</div>` : ''}
      `;
      milestonesTimelineList.appendChild(item);
    });
  }

  announceToScreenReader(`Route processed: ${routeResult.total_steps} total steps across ${routeResult.milestones.length} milestones.`);
}

// 3. Visual Landmark Verifier Controller (real in-browser YOLO inference only — no simulated boxes)
const LANDMARK_NEARBY_PLACES = SAMPLE_PLACES.map(p => p.name);

// Last real inference result, kept in SOURCE pixel space so boxes can be re-projected on resize
let lastInference = null; // { detections, srcWidth, srcHeight, sourceEl }
let isInferenceRunning = false;
let queuedInference = null; // { speakAudio } — a request that arrived while inference was busy

function getActiveFrameSource() {
  if ((isCameraActive || isUploadedVideoActive) && cameraVideo && cameraVideo.videoWidth) return cameraVideo;
  if (cameraImageFallback && cameraImageFallback.getAttribute('src') && cameraImageFallback.naturalWidth) return cameraImageFallback;
  return null;
}

function setHudDetections(text) {
  if (hudDetectionsCount) hudDetectionsCount.textContent = text;
}

function clearDetections() {
  lastInference = null;
  renderDynamicBoundingBoxes();
  setHudDetections('DETECTIONS: —');
}

// Capture the current frame (webcam or uploaded image), run the model, draw real boxes, verify landmark
async function runFrameInference(speakAudio = true) {
  const source = getActiveFrameSource();
  if (!source) {
    clearDetections();
    announceToScreenReader('No camera frame. Start the WebCam or upload a frame first.');
    return;
  }
  if (isInferenceRunning) {
    // Don't drop the request (e.g. a new image uploaded while a video frame is mid-inference):
    // run once more as soon as the current pass finishes.
    queuedInference = { speakAudio: speakAudio || Boolean(queuedInference && queuedInference.speakAudio) };
    return;
  }
  isInferenceRunning = true;

  if (cameraShutterFlash) {
    cameraShutterFlash.classList.add('flash');
    setTimeout(() => cameraShutterFlash.classList.remove('flash'), 100);
  }
  setHudDetections('DETECTIONS: RUNNING…');

  try {
    const result = await detectObjects(source);
    if (!result.available) {
      clearDetections();
      setHudDetections('DETECTIONS: MODEL N/A');
      announceToScreenReader('Detection model is not available yet.');
      return;
    }
    // Source may have changed while inference ran (webcam stopped / new upload)
    if (getActiveFrameSource() !== source) return;

    // Spatial grid + proximity + hazard/signage classification for every box
    const analyzed = analyzeDetections(result.detections, result.srcWidth, result.srcHeight);
    const priorityHazard = findPriorityHazard(analyzed);
    lastInference = { ...result, detections: analyzed, priorityHazard, sourceEl: source };
    renderDynamicBoundingBoxes();
    setHudDetections(`DETECTIONS: ${analyzed.length} ${analyzed.length === 1 ? 'BOX' : 'BOXES'}${priorityHazard ? ' · HAZARD' : ''}`);

    // Safety first: a focal-zone hazard is announced before any OCR/landmark work, always
    // (even in silent auto-detect mode), and interrupts lower-priority speech.
    if (priorityHazard) announceHazard(priorityHazard);

    // Cropped OCR: only the regions of detected signs are read, never the full frame
    await readSignsInFrame(source, analyzed);
    await detectTextSigns(source, analyzed, result.srcWidth, result.srcHeight);
    if (getActiveFrameSource() !== source) return;
    renderDynamicBoundingBoxes();

    verifyLandmarkFromDetections(analyzed, speakAudio);
    // Airport Mode: route sign verification, drift reset, hazard pause/resume
    if (airportMode && airportMode.isActive()) airportMode.onFrame({ priorityHazard, detections: analyzed });
  } catch (err) {
    console.error('Inference failed:', err);
    clearDetections();
    setHudDetections('DETECTIONS: ERROR');
  } finally {
    isInferenceRunning = false;
    if (queuedInference) {
      const next = queuedInference;
      queuedInference = null;
      runFrameInference(next.speakAudio);
    }
  }
}

// --- Hazard override -------------------------------------------------------------------------
const HAZARD_REPEAT_COOLDOWN_MS = 6000;
const lastHazardAlertAt = new Map(); // hazardClass -> time
let hazardBannerTimer = null;

function announceHazard({ detection, alert }) {
  const now = Date.now();
  const cls = detection.hazard.hazardClass;
  showHazardBanner(alert, detection.hazard.level);
  if (now - (lastHazardAlertAt.get(cls) || 0) < HAZARD_REPEAT_COOLDOWN_MS) return; // don't spam the same warning
  lastHazardAlertAt.set(cls, now);
  announceToScreenReader(alert);
  speakTextToSpeech(alert, { priority: SPEECH_PRIORITY.HAZARD });
}

function showHazardBanner(text, level) {
  const banner = document.getElementById('hazard-alert-banner');
  if (!banner) return;
  banner.textContent = text;
  banner.dataset.level = level;
  banner.classList.remove('hidden');
  clearTimeout(hazardBannerTimer);
  hazardBannerTimer = setTimeout(() => banner.classList.add('hidden'), 4000);
}

// --- Bounding-box cropped OCR ----------------------------------------------------------------
const MAX_SIGNS_PER_FRAME = 2;
const SIGN_MIN_SCORE = 0.5;

// Text-sign detection: the PaddleOCR text detector finds every text line in the frame (the YOLO
// models rarely box real signs), then only those cropped lines are read. Each line becomes a
// "text_sign" detection with spatial context. Video/webcam: throttled, and the last result is
// carried between scans; still images: every time.
const TEXT_SCAN_INTERVAL_MS = 3000;
let lastTextScan = { at: 0, source: null, signs: [] };

function textLineToDetection(line, srcW, srcH) {
  const [det] = analyzeDetections([{ label: 'text_sign', model: 'ocr', score: line.score, x: line.x, y: line.y, w: line.w, h: line.h }], srcW, srcH);
  const cleaned = line.text.replace(/\s+/g, ' ').trim();
  const aliases = extractSceneSignTexts(cleaned);
  // "GatesABDEE" -> "Gates A, B, D, E" so it's spoken naturally
  const gateLetters = aliases.filter(a => /^Gate [A-Z]$/.test(a)).map(a => a.slice(-1));
  const spoken = gateLetters.length >= 2 ? `Gates ${gateLetters.join(', ')}` : cleaned;
  return { ...det, signText: spoken, ocrRaw: line.text, signAliases: aliases, signTextSource: 'ocr', displayName: `${spoken} sign` };
}

async function detectTextSigns(source, analyzed, srcW, srcH) {
  const isStill = source === cameraImageFallback;
  const due = isStill || lastTextScan.source !== source || Date.now() - lastTextScan.at >= TEXT_SCAN_INTERVAL_MS;
  if (due) {
    lastTextScan.at = Date.now();
    try {
      const lines = await findTextSigns(source);
      lastTextScan = { at: lastTextScan.at, source, signs: lines.map(l => textLineToDetection(l, srcW, srcH)) };
    } catch (err) {
      console.warn('Text sign detection failed:', err);
    }
  }
  if (lastTextScan.source !== source) return;
  // Skip lines already covered by a YOLO sign box that was read directly
  for (const s of lastTextScan.signs) {
    const covered = analyzed.some(d => d.signText && d.model !== 'ocr' &&
      s.x + s.w / 2 > d.x && s.x + s.w / 2 < d.x + d.w && s.y + s.h / 2 > d.y && s.y + s.h / 2 < d.y + d.h);
    if (!covered) analyzed.push(s);
  }
  const texts = lastTextScan.signs.map(s => s.signText);
  if (texts.length) setHudDetections(`DETECTIONS: ${analyzed.filter(d => d.model !== 'ocr').length} OBJECTS · ${texts.length} SIGNS`);
}

async function readSignsInFrame(source, analyzed) {
  const signs = analyzed
    .filter(d => d.isSignage && d.score >= SIGN_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SIGNS_PER_FRAME);
  for (const sign of signs) {
    try {
      const raw = await readSignText(source, sign);
      const parsed = extractSignText(raw, sign.label);
      sign.ocrRaw = raw;
      if (parsed) {
        sign.signText = parsed.text;
        sign.signTextSource = parsed.source;
      }
    } catch (err) {
      console.warn('Sign OCR failed:', err);
    }
  }
}

// --- Landmark verification with OCR text + spatial context -----------------------------------
const LANDMARK_REPEAT_COOLDOWN_MS = 10000;
let lastLandmarkSpeech = { text: null, time: 0 };

function findMatchingDetection(analyzed, landmarkName) {
  let best = null, bestScore = 0;
  for (const d of analyzed) {
    for (const candidate of [d.signText, ...(d.signAliases || []), d.displayName, d.label]) {
      const s = candidate ? calculateStringSimilarity(candidate, landmarkName) : 0;
      if (s > bestScore) { bestScore = s; best = d; }
    }
  }
  return best;
}

function verifyLandmarkFromDetections(analyzed, speakAudio) {
  const targetLandmark = targetLandmarkInput.value.trim();
  // Sign text plus parsed aliases ("GatesABDE" -> "Gate A", "Gate B", ...) so "Gate A" can match
  const ocrStrings = [...new Set(analyzed.filter(d => d.signText).flatMap(d => [d.signText, ...(d.signAliases || [])]))];
  const yoloLabels = analyzed.flatMap(d => [d.label, d.displayName]);
  const landmarkResult = verifyVisualLandmark(ocrStrings, yoloLabels, targetLandmark, LANDMARK_NEARBY_PLACES);

  // Replace generic phrasing with real spatial context from the matching box
  const readSign = analyzed.find(d => d.signText);
  let announcementKind = 'match';
  if (!landmarkResult.matched) announcementKind = readSign ? 'sign' : 'object';
  if (landmarkResult.matched) {
    const det = findMatchingDetection(analyzed, landmarkResult.matched_landmark);
    if (det && det.signText) {
      // Name the specific thing that matched (e.g. "Gate A" out of "Gates A, B, D, E")
      const alias = (det.signAliases || []).find(a => calculateStringSimilarity(a, landmarkResult.matched_landmark) > 0.85);
      landmarkResult.spoken_system_update = formatSignAnnouncement(alias ? `${alias} sign` : det.signText, det);
    } else if (det) {
      landmarkResult.spoken_system_update = `Passing ${landmarkResult.matched_landmark}, ${det.proximity.spoken} ${det.zonePhrase}.`;
    }
    // Mode C: a visual match recalibrates dead reckoning (Airport Mode does this from route signs)
    if (!airportMode || !airportMode.isActive()) {
      navController.confirmVisualMatch(landmarkResult.matched_landmark);
      updateNavModeBadge();
    }
  } else if (readSign) {
    landmarkResult.spoken_system_update = formatSignAnnouncement(readSign.signText, readSign);
  } else if (analyzed.length > 0) {
    const nearest = [...analyzed].sort((a, b) => b.proximity.areaRatio - a.proximity.areaRatio)[0];
    landmarkResult.spoken_system_update = `${nearest.spatialDescription}.`;
  }

  landmarkResult.sign_texts = ocrStrings;
  landmarkResult.spatial_detections = analyzed.map(d => ({
    label: d.label, zone: d.zone, proximity: d.proximity.label,
    in_focal_zone: d.inFocalZone, hazard: d.hazard ? d.hazard.hazardClass : null, sign_text: d.signText || null
  }));
  lastLandmarkOutput = landmarkResult;
  renderLandmarkResults(landmarkResult);

  const text = landmarkResult.spoken_system_update;
  if (!text) return;
  if (airportMode && airportMode.isActive()) return; // Airport Mode speaks its own route-aware updates
  const now = Date.now();
  const isRepeat = text === lastLandmarkSpeech.text && now - lastLandmarkSpeech.time < LANDMARK_REPEAT_COOLDOWN_MS;
  // Manual capture always speaks; auto-detect speaks only new sign/landmark announcements
  // (generic "nearest object" descriptions change every frame on video and would never stop)
  if (speakAudio || (autoSimIntervalId && !isRepeat && announcementKind !== 'object')) {
    lastLandmarkSpeech = { text, time: now };
    speakTextToSpeech(text, { priority: SPEECH_PRIORITY.LANDMARK });
  }
}

function renderLandmarkIdleState() {
  lastLandmarkOutput = null;
  landmarkMatchBadge.textContent = 'AWAITING FRAME';
  landmarkMatchBadge.className = 'badge badge-unknown';
  badgeMatchedLandmark.textContent = '—';
  spokenLandmarkText.textContent = 'Start the WebCam or upload a frame, then verify.';
}

function renderLandmarkResults(res) {
  if (res.matched) {
    landmarkMatchBadge.textContent = 'MATCHED';
    landmarkMatchBadge.className = 'badge badge-navigate';
  } else {
    landmarkMatchBadge.textContent = 'NOT MATCHED';
    landmarkMatchBadge.className = 'badge badge-unknown';
  }

  badgeMatchedLandmark.textContent = res.matched_landmark || 'None detected';
  spokenLandmarkText.textContent = res.spoken_system_update ? `"${res.spoken_system_update}"` : 'No update required.';
  announceToScreenReader(`Landmark verifier result: ${res.matched ? 'Matched landmark ' + res.matched_landmark : 'No match'}`);
}

// Single source of truth for what the viewport shows: live video, uploaded frame, or standby placeholder.
function updateCameraViewportVisibility() {
  const hasImage = !!(cameraImageFallback && cameraImageFallback.getAttribute('src'));
  const hasOverlays = !!(cameraOverlaysContainer && cameraOverlaysContainer.childElementCount > 0);

  const videoShown = isCameraActive || isUploadedVideoActive;
  if (cameraVideo) cameraVideo.classList.toggle('hidden', !videoShown);
  if (cameraImageFallback) cameraImageFallback.classList.toggle('hidden', videoShown || !hasImage);
  if (cameraPlaceholder) cameraPlaceholder.classList.toggle('hidden', videoShown || hasImage || hasOverlays);
  if (cameraViewport) {
    cameraViewport.classList.toggle('is-live', isCameraActive);
    cameraViewport.classList.toggle('has-overlays', hasOverlays);
    cameraViewport.classList.toggle('has-frame', videoShown || hasImage);
  }
}

// Draw boxes from the last REAL inference only. Projects source-pixel boxes through the same
// object-fit: cover transform the <video>/<img> uses, so boxes line up with what's on screen.
function renderDynamicBoundingBoxes() {
  if (!cameraOverlaysContainer) return;
  cameraOverlaysContainer.innerHTML = '';

  const inf = lastInference;
  if (inf && inf.detections.length && cameraViewport && inf.sourceEl === getActiveFrameSource()) {
    const vw = cameraViewport.clientWidth;
    const vh = cameraViewport.clientHeight;
    const scale = Math.max(vw / inf.srcWidth, vh / inf.srcHeight);
    const offX = (vw - inf.srcWidth * scale) / 2;
    const offY = (vh - inf.srcHeight * scale) / 2;

    inf.detections.forEach((d) => {
      if (d.synthetic) return; // overhead-sign scan results have no real box
      // Clip to the visible viewport
      const left = Math.max(0, offX + d.x * scale);
      const top = Math.max(0, offY + d.y * scale);
      const right = Math.min(vw, offX + (d.x + d.w) * scale);
      const bottom = Math.min(vh, offY + (d.y + d.h) * scale);
      if (right - left < 4 || bottom - top < 4) return;

      const box = document.createElement('div');
      const isPriority = inf.priorityHazard && inf.priorityHazard.detection === d;
      // Red only for hazards that matter now (a person far away is just an object)
      box.className = 'dynamic-bbox ' + (isActiveHazard(d) ? 'hazard-box' : d.isSignage ? 'ocr-box' : 'yolo-box') + (isPriority ? ' priority-hazard' : '');
      box.style.left = `${(left / vw) * 100}%`;
      box.style.top = `${(top / vh) * 100}%`;
      box.style.width = `${((right - left) / vw) * 100}%`;
      box.style.height = `${((bottom - top) / vh) * 100}%`;

      const label = document.createElement('span');
      label.className = 'bbox-label';
      const zoneTag = d.zone ? ` · ${d.zone} · ${d.proximity.key}` : '';
      if (d.model === 'ocr') {
        label.textContent = `"${d.signText}" ${(d.score * 100).toFixed(0)}%${zoneTag}`;
      } else {
        const textTag = d.signText ? ` · "${d.signText}"` : '';
        label.textContent = `${d.label} ${(d.score * 100).toFixed(0)}%${zoneTag}${textTag}`;
      }
      box.title = label.textContent; // full text on hover when the label is truncated
      box.appendChild(label);
      cameraOverlaysContainer.appendChild(box);
    });
  }
  updateCameraViewportVisibility();
}

function stopAutoInferenceLoop() {
  if (autoSimIntervalId) {
    clearInterval(autoSimIntervalId);
    autoSimIntervalId = null;
  }
  if (toggleAutoFrameSim) toggleAutoFrameSim.checked = false;
}

// WebCam Live Video Controller via getUserMedia
async function toggleCameraStream() {
  if (isCameraActive) {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
    isCameraActive = false;
    if (cameraVideo) cameraVideo.srcObject = null;
    stopAutoInferenceLoop();
    clearDetections();
    if (btnCameraText) btnCameraText.textContent = "Start WebCam";
    if (cameraStatusDot) cameraStatusDot.className = "camera-status-dot standby";
    if (cameraStatusBadge) {
      cameraStatusBadge.textContent = "STANDBY";
      cameraStatusBadge.className = "badge-subtle";
    }
    if (hudCamStatus) hudCamStatus.textContent = "STATUS: STANDBY";
    if (hudSourceBadge) hudSourceBadge.textContent = "SOURCE: NONE";
  } else {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("getUserMedia is not supported by your browser environment.");
      }
      stopAutoInferenceLoop();
      stopUploadedVideo();
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });

      if (cameraVideo) {
        cameraVideo.srcObject = cameraStream;
        await cameraVideo.play();
      }

      isCameraActive = true;
      if (cameraVideo) fitViewportToMedia(cameraVideo.videoWidth, cameraVideo.videoHeight);
      clearDetections(); // live preview starts clean; boxes appear only after real inference
      if (btnCameraText) btnCameraText.textContent = "Stop WebCam";
      if (cameraStatusDot) cameraStatusDot.className = "camera-status-dot";
      if (cameraStatusBadge) {
        cameraStatusBadge.textContent = "LIVE WEBCAM";
        cameraStatusBadge.className = "badge-subtle live";
      }
      if (hudCamStatus) hudCamStatus.textContent = "STATUS: LIVE";
      if (hudSourceBadge) hudSourceBadge.textContent = "SOURCE: WEBCAM FEED";
      announceToScreenReader("Live WebCam video stream started.");
      loadDetector(); // warm up the model in the background
      preloadOcr();   // and the OCR worker, so the first sign isn't delayed
    } catch (err) {
      console.warn("Could not start WebCam:", err);
      // Airport Mode reports this by voice instead of a blocking dialog
      if (!airportMode || !airportMode.isActive()) alert(`Could not access WebCam (${err.message}). You can use "Upload Frame" to test with an image.`);
    }
  }
}

// Fallback: Local Image Frame Upload
// --- Uploaded video files: played in the same <video> element and processed like the webcam ---
let isUploadedVideoActive = false;
let uploadedVideoUrl = null;
let lastVideoInferenceTime = -1;
const VIDEO_INFERENCE_INTERVAL_MS = 500;   // uploaded video: process as fast as the models allow
const WEBCAM_INFERENCE_INTERVAL_MS = 1500;

function fitViewportToMedia(width, height) {
  // Match the viewer to the media's shape so the whole frame is visible (no cover-cropping)
  if (cameraViewport && width && height) cameraViewport.style.aspectRatio = `${width} / ${height}`;
}

function stopUploadedVideo() {
  if (!isUploadedVideoActive) return;
  isUploadedVideoActive = false;
  if (cameraVideo) {
    cameraVideo.pause();
    cameraVideo.removeAttribute('src');
    cameraVideo.loop = false;
    cameraVideo.load();
  }
  if (uploadedVideoUrl) { URL.revokeObjectURL(uploadedVideoUrl); uploadedVideoUrl = null; }
  const btn = document.getElementById('btn-video-playpause');
  if (btn) btn.classList.add('hidden');
}

function stopWebcamForUpload() {
  if (isCameraActive && cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
    isCameraActive = false;
    if (cameraVideo) cameraVideo.srcObject = null;
    if (btnCameraText) btnCameraText.textContent = "Start WebCam";
  }
}

function startAutoDetect() {
  if (toggleAutoFrameSim && !toggleAutoFrameSim.checked) {
    toggleAutoFrameSim.checked = true;
    toggleAutoFrameSim.dispatchEvent(new Event('change'));
  }
}

function autoDetectTick() {
  // Don't re-process the same frame of a paused video
  if (isUploadedVideoActive && cameraVideo.paused && cameraVideo.currentTime === lastVideoInferenceTime) return;
  if (isUploadedVideoActive) lastVideoInferenceTime = cameraVideo.currentTime;
  runFrameInference(false);
}

async function handleVideoUpload(file) {
  stopWebcamForUpload();
  stopAutoInferenceLoop();
  stopUploadedVideo();
  clearDetections();
  if (cameraImageFallback) cameraImageFallback.removeAttribute('src');

  uploadedVideoUrl = URL.createObjectURL(file);
  cameraVideo.srcObject = null;
  cameraVideo.muted = true;
  cameraVideo.loop = true;
  cameraVideo.src = uploadedVideoUrl;
  try {
    await new Promise((resolve, reject) => {
      cameraVideo.onloadedmetadata = resolve;
      cameraVideo.onerror = () => reject(new Error('this video format is not supported by the browser'));
    });
    await cameraVideo.play();
  } catch (err) {
    stopUploadedVideo();
    updateCameraViewportVisibility();
    alert(`Could not play ${file.name}: ${err.message}. Try an MP4 (H.264) or WebM file.`);
    return;
  }

  isUploadedVideoActive = true;
  lastVideoInferenceTime = -1;
  fitViewportToMedia(cameraVideo.videoWidth, cameraVideo.videoHeight);
  updateCameraViewportVisibility();

  const btn = document.getElementById('btn-video-playpause');
  if (btn) { btn.classList.remove('hidden'); btn.textContent = 'Pause'; btn.setAttribute('aria-label', 'Pause uploaded video'); }
  if (cameraStatusDot) cameraStatusDot.className = "camera-status-dot";
  if (cameraStatusBadge) { cameraStatusBadge.textContent = "VIDEO FILE"; cameraStatusBadge.className = "badge-subtle live"; }
  if (hudCamStatus) hudCamStatus.textContent = "STATUS: VIDEO PLAYING";
  if (hudSourceBadge) hudSourceBadge.textContent = `SOURCE: ${file.name.slice(0, 16)}`;
  announceToScreenReader(`Playing video ${file.name}. Detection is running on every frame it can.`);
  loadDetector();
  preloadOcr();
  startAutoDetect(); // process the video continuously
}

function toggleUploadedVideoPlayback() {
  if (!isUploadedVideoActive) return;
  const btn = document.getElementById('btn-video-playpause');
  if (cameraVideo.paused) {
    cameraVideo.play();
    if (btn) { btn.textContent = 'Pause'; btn.setAttribute('aria-label', 'Pause uploaded video'); }
    if (hudCamStatus) hudCamStatus.textContent = "STATUS: VIDEO PLAYING";
  } else {
    cameraVideo.pause();
    if (btn) { btn.textContent = 'Play'; btn.setAttribute('aria-label', 'Play uploaded video'); }
    if (hudCamStatus) hudCamStatus.textContent = "STATUS: VIDEO PAUSED";
  }
}

function handleCameraImageUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.type.startsWith('video/')) {
    handleVideoUpload(file);
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    stopWebcamForUpload();
    stopAutoInferenceLoop();
    stopUploadedVideo();
    clearDetections();

    if (cameraImageFallback) {
      cameraImageFallback.onload = () => {
        fitViewportToMedia(cameraImageFallback.naturalWidth, cameraImageFallback.naturalHeight);
        updateCameraViewportVisibility();
        runFrameInference(false);
      };
      cameraImageFallback.src = e.target.result;
      cameraImageFallback.alt = `Uploaded camera frame: ${file.name}`;
      cameraImageFallback.removeAttribute('aria-hidden');
    }
    updateCameraViewportVisibility();

    if (cameraStatusDot) cameraStatusDot.className = "camera-status-dot";
    if (cameraStatusBadge) {
      cameraStatusBadge.textContent = "FRAME IMAGE";
      cameraStatusBadge.className = "badge-subtle live";
    }
    if (hudCamStatus) hudCamStatus.textContent = "STATUS: UPLOADED";
    if (hudSourceBadge) hudSourceBadge.textContent = `SOURCE: ${file.name.slice(0, 16)}`;
    announceToScreenReader(`Loaded camera frame image: ${file.name}`);
  };
  reader.readAsDataURL(file);
  event.target.value = ''; // allow re-uploading the same file
}

// 4. Spatial Hazard & Safety Engine Controller (Multi-Hazard & 2D Radar)
const DEFAULT_HAZARDS = [
  { id: 'h_pothole_1', type: 'pothole', label: 'Pothole (Ground Drop)', x_center: -0.4, depth_m: 0.9, isDepthMap: true },
  { id: 'h_branch_1', type: 'branch', label: 'Low Branch', x_center: 0.35, depth_m: 1.6, isDepthMap: false },
  { id: 'h_obstacle_1', type: 'obstacle', label: 'Pole / Obstacle', x_center: 0.1, depth_m: 2.8, isDepthMap: false }
];

let activeHazards = JSON.parse(JSON.stringify(DEFAULT_HAZARDS));
let selectedHazardId = 'h_pothole_1';
let isDraggingHazard = false;
let draggedHazardId = null;

function depthToRadarPercent(depthM) {
  const d = Math.max(0.2, Math.min(5.0, depthM));
  if (d <= 1.2) {
    return 12 + ((d - 0.2) / 1.0) * 28; // 12% - 40% (within critical ring at 44%)
  } else if (d <= 2.0) {
    return 42 + ((d - 1.2) / 0.8) * 26; // 42% - 68% (within override ring at 72%)
  } else {
    return 70 + ((d - 2.0) / 3.0) * 22; // 70% - 92% (outer safe ring at 95%)
  }
}

function radarPercentToDepth(percentBottom) {
  const p = Math.max(10, Math.min(92, percentBottom));
  if (p <= 40) {
    return Number((0.2 + ((p - 12) / 28) * 1.0).toFixed(1));
  } else if (p <= 68) {
    return Number((1.2 + ((p - 42) / 26) * 0.8).toFixed(1));
  } else {
    return Number((2.0 + ((p - 70) / 22) * 3.0).toFixed(1));
  }
}

function syncSelectedHazardToInputs() {
  const selected = activeHazards.find(h => h.id === selectedHazardId);
  if (!selected) return;
  hazardTypeSelect.value = selected.type;
  hazardDistInput.value = selected.depth_m.toFixed(1);
  hazardAngleRange.value = selected.x_center.toFixed(2);
  const side = selected.x_center < -0.2 ? 'Left' : (selected.x_center > 0.2 ? 'Right' : 'Center');
  hazardAngleLabel.textContent = `${selected.x_center.toFixed(2)} (${side})`;
}

function syncInputsToSelectedHazard() {
  const selected = activeHazards.find(h => h.id === selectedHazardId);
  if (!selected) return;
  selected.type = hazardTypeSelect.value;
  selected.depth_m = parseFloat(hazardDistInput.value) || 1.0;
  selected.x_center = parseFloat(hazardAngleRange.value) || 0.0;
  selected.isDepthMap = selected.type === 'pothole' || selected.type === 'curb_drop';
  selected.label = selected.type === 'pothole' ? 'Pothole (Ground Drop)' :
    (selected.type === 'curb_drop' ? 'Curb Drop-off' :
    (selected.type === 'branch' ? 'Low-Hanging Branch' :
    (selected.type === 'obstacle' ? 'Obstacle / Pole' : 'Safe Path')));
}

function renderHazardMarkers() {
  if (!hazardMarkersContainer) return;
  hazardMarkersContainer.innerHTML = '';

  activeHazards.forEach(h => {
    const percentX = 50 + (h.x_center * 40); // 10% to 90%
    const percentY = depthToRadarPercent(h.depth_m);
    const isCritical = h.depth_m < 1.2;
    const isWarning = h.depth_m >= 1.2 && h.depth_m <= 2.0;
    const sevClass = isCritical ? 'critical' : (isWarning ? 'warning' : 'safe');
    const isSelected = h.id === selectedHazardId;

    const markerEl = document.createElement('div');
    markerEl.className = `radar-hazard-marker ${sevClass} ${isSelected ? 'selected' : ''}`;
    markerEl.style.left = `${percentX}%`;
    markerEl.style.bottom = `${percentY}%`;
    markerEl.dataset.id = h.id;
    markerEl.setAttribute('role', 'button');
    markerEl.setAttribute('tabindex', '0');
    markerEl.setAttribute('aria-label', `${h.type} at ${h.depth_m.toFixed(1)} meters, ${isCritical ? 'critical' : (isWarning ? 'warning' : 'safe')}`);

    markerEl.innerHTML = `
      <div class="hazard-marker-node">
        ${isCritical ? '!' : (isWarning ? '▲' : '●')}
      </div>
      <div class="hazard-marker-tag-label">
        ${h.type.toUpperCase()}: ${h.depth_m.toFixed(1)}m ${isCritical ? '(CRITICAL)' : (isWarning ? '(WARNING)' : '')}
      </div>
    `;

    // Pointer down handler for dragging or selecting marker
    markerEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      markerEl.setPointerCapture(e.pointerId);
      isDraggingHazard = true;
      draggedHazardId = h.id;
      selectedHazardId = h.id;
      syncSelectedHazardToInputs();
      renderHazardMarkers();
      renderHazardChips();
    });

    markerEl.addEventListener('pointermove', (e) => {
      if (!isDraggingHazard || draggedHazardId !== h.id) return;
      e.stopPropagation();
      const rect = hazardRadarViewport.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relBottom = (rect.bottom - e.clientY) / rect.height;

      const normX = Math.max(-1.0, Math.min(1.0, (relX - 0.5) / 0.4));
      const depth = radarPercentToDepth(relBottom * 100);

      h.x_center = Number(normX.toFixed(2));
      h.depth_m = depth;

      syncSelectedHazardToInputs();
      executeHazardEngine(false);
    });

    const stopDrag = (e) => {
      if (draggedHazardId === h.id) {
        isDraggingHazard = false;
        draggedHazardId = null;
        try { markerEl.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    markerEl.addEventListener('pointerup', stopDrag);
    markerEl.addEventListener('pointercancel', stopDrag);

    hazardMarkersContainer.appendChild(markerEl);
  });
}

function renderHazardChips() {
  if (!activeHazardsChips) return;
  activeHazardsChips.innerHTML = '';

  if (activeHazards.length === 0) {
    activeHazardsChips.innerHTML = `<span style="font-size: 0.75rem; color: #94a3b8; font-style: italic;">No active hazards. Path is clear.</span>`;
    return;
  }

  activeHazards.forEach(h => {
    const isCritical = h.depth_m < 1.2;
    const isWarning = h.depth_m >= 1.2 && h.depth_m <= 2.0;
    const sevClass = isCritical ? 'critical' : (isWarning ? 'warning' : 'safe');
    const isSelected = h.id === selectedHazardId;

    const chip = document.createElement('div');
    chip.className = `hazard-chip ${sevClass} ${isSelected ? 'active' : ''}`;
    chip.innerHTML = `
      <span>${isCritical ? '🚨' : (isWarning ? '⚠️' : '🚧')} <strong>${h.type}</strong> (${h.depth_m.toFixed(1)}m)</span>
      <span class="hazard-chip-delete" title="Remove hazard">&times;</span>
    `;

    chip.addEventListener('click', (e) => {
      if (e.target.classList.contains('hazard-chip-delete')) {
        e.stopPropagation();
        activeHazards = activeHazards.filter(item => item.id !== h.id);
        if (selectedHazardId === h.id) {
          selectedHazardId = activeHazards.length > 0 ? activeHazards[0].id : null;
        }
        syncSelectedHazardToInputs();
        executeHazardEngine(false);
      } else {
        selectedHazardId = h.id;
        syncSelectedHazardToInputs();
        renderHazardMarkers();
        renderHazardChips();
      }
    });

    activeHazardsChips.appendChild(chip);
  });
}

function executeHazardEngine(speakAudio = true) {
  syncInputsToSelectedHazard();

  // Split hazards into depth map and yolo object lists
  const depthHazardsList = activeHazards.filter(h => h.isDepthMap && h.type !== 'none');
  const objectHazardsList = activeHazards.filter(h => !h.isDepthMap && h.type !== 'none');

  let depthMapHazards = {
    pothole_detected: false,
    curb_drop: false,
    hazard_angle: 0.0,
    hazard_distance_m: 999.0
  };

  if (depthHazardsList.length > 0) {
    depthHazardsList.sort((a, b) => a.depth_m - b.depth_m);
    const closestDepth = depthHazardsList[0];
    depthMapHazards = {
      pothole_detected: closestDepth.type === 'pothole',
      curb_drop: closestDepth.type === 'curb_drop',
      hazard_angle: closestDepth.x_center,
      hazard_distance_m: closestDepth.depth_m
    };
  }

  const yoloObjs = objectHazardsList.map(h => ({
    label: h.type === 'branch' ? 'low_hanging_branch' :
      (h.type === 'curb_drop' ? 'curb_drop' :
      (h.type === 'pothole' ? 'pothole' : 'pole_obstacle')),
    x_center: h.x_center,
    depth_m: h.depth_m
  }));

  const res = processSpatialHazards(yoloObjs, depthMapHazards);
  lastHazardOutput = res;
  renderHazardResults(res);

  if (speakAudio && res.spoken_alert) {
    speakTextToSpeech(res.spoken_alert);
    const isCrit = res.severity === 'CRITICAL';
    playSpatialAudioPulse(
      res.spatial_audio.pan,
      res.spatial_audio.pitch_hz,
      isCrit ? 0.45 : 0.3,
      res.spatial_audio.pulse_rate_ms,
      isCrit ? 'sawtooth' : 'sine',
      btnPlaySpatialPing
    );
  }
}

function renderHazardResults(res) {
  renderHazardMarkers();
  renderHazardChips();

  if (hazardCountBadge) {
    const critCount = activeHazards.filter(h => h.depth_m < 1.2).length;
    hazardCountBadge.textContent = `${activeHazards.length} Hazards (${critCount} Critical)`;
    hazardCountBadge.className = `badge ${critCount > 0 ? 'badge-unknown' : (activeHazards.length > 0 ? 'badge-navigate' : '')}`;
  }

  if (res.hazard_present) {
    badgeHazardPresent.textContent = "HAZARD OVERRIDE ACTIVE";
    badgeHazardPresent.className = "badge badge-unknown";
    badgeHazardSeverity.textContent = res.severity;
    badgeHazardSeverity.className = "stat-value text-crimson";
  } else {
    badgeHazardPresent.textContent = "CLEAR PATH (SAFE)";
    badgeHazardPresent.className = "badge badge-navigate";
    badgeHazardSeverity.textContent = "NONE";
    badgeHazardSeverity.className = "stat-value";
  }

  badgeSpatialPan.textContent = res.spatial_audio.pan.toFixed(2);
  badgeSpatialPitch.textContent = `${res.spatial_audio.pitch_hz} Hz`;
  badgeSpatialPulse.textContent = `${res.spatial_audio.pulse_rate_ms} ms`;
  spokenHazardText.textContent = res.spoken_alert ? `"${res.spoken_alert}"` : 'null (Path clear, navigation active)';
  jsonHazardOutputCode.textContent = JSON.stringify(res, null, 2);
  announceToScreenReader(`Spatial Hazard result: ${res.hazard_present ? res.severity + ' hazard alert: ' + res.spoken_alert : 'Clear path'}`);
}

// 5. Real-Time Spatial Audio Synthesizer Engine Controller (Interactive 2D Radar)
let isDraggingAudioPuck = false;

function syncAudioPuckPosition(xCenter, distM) {
  if (!audioTargetPuck) return;
  const clampedX = Math.max(-1.0, Math.min(1.0, xCenter));
  const clampedDist = Math.max(0.5, Math.min(8.0, distM));

  // Horizontal mapping: [-1.0, 1.0] -> [10%, 90%]
  const percentLeft = 50 + (clampedX * 40);
  // Vertical mapping from bottom: [0.5m, 8.0m] -> [8%, 92%]
  const distRatio = (clampedDist - 0.5) / 7.5;
  const percentBottom = 8 + (distRatio * 84);

  audioTargetPuck.style.left = `${percentLeft}%`;
  audioTargetPuck.style.bottom = `${percentBottom}%`;
  audioTargetPuck.setAttribute('aria-valuenow', clampedX.toFixed(2));

  if (puckCoordBadge) {
    puckCoordBadge.textContent = `X: ${clampedX.toFixed(2)} | ${clampedDist.toFixed(1)}m`;
  }

  if (audioHazardCheckbox && audioHazardCheckbox.checked) {
    audioTargetPuck.classList.add('hazard-active');
  } else {
    audioTargetPuck.classList.remove('hazard-active');
  }
}

function updateAudioPuckFromPointer(e) {
  if (!audioRadarViewport) return;
  const rect = audioRadarViewport.getBoundingClientRect();
  const clientX = e.clientX;
  const clientY = e.clientY;

  // X coordinate: Map relX in [0.1, 0.9] to [-1.0, 1.0]
  const relX = (clientX - rect.left) / rect.width;
  const normX = Math.max(-1.0, Math.min(1.0, (relX - 0.5) / 0.4));
  const xCenter = Number(normX.toFixed(2));

  // Distance: User at bottom, far at top
  const relBottom = (rect.bottom - clientY) / rect.height;
  const normDist = 0.5 + Math.max(0, Math.min(1.0, (relBottom - 0.08) / 0.84)) * 7.5;
  const distM = Number(Math.max(0.5, Math.min(8.0, normDist)).toFixed(1));

  audioXcenterRange.value = xCenter;
  audioDistRange.value = distM;

  const side = xCenter < -0.25 ? 'Left' : (xCenter > 0.25 ? 'Right' : 'Centered Ahead');
  audioXcenterLabel.textContent = `${xCenter.toFixed(2)} (${side})`;

  const bracket = distM < 1.5 ? 'Near < 1.5m' : (distM <= 4.0 ? 'Medium 1.5-4.0m' : 'Far > 4.0m');
  audioDistLabel.textContent = `${distM.toFixed(1)} meters (${bracket})`;

  syncAudioPuckPosition(xCenter, distM);
  executeSpatialAudioSynthesizer(false);
}

function executeSpatialAudioSynthesizer(playAudio = false) {
  const xCenter = parseFloat(audioXcenterRange.value) || -0.6;
  const distanceM = parseFloat(audioDistRange.value) || 1.0;
  const isHazard = audioHazardCheckbox.checked;

  syncAudioPuckPosition(xCenter, distanceM);

  const result = synthesizeSpatialAudio(xCenter, distanceM, isHazard);
  lastSynthAudioOutput = result;

  renderSpatialAudioResults(result, distanceM);

  if (playAudio) {
    const cfg = result.audio_node_config;
    playSpatialAudioPulse(cfg.pan, cfg.frequency_hz, cfg.gain, cfg.pulse_interval_ms, cfg.waveform_type, btnPlaySynthPulse);
  }
}

function renderSpatialAudioResults(res, distanceM) {
  const cfg = res.audio_node_config;
  synthBadgePan.textContent = cfg.pan.toFixed(2);
  synthBadgeFreq.textContent = `${cfg.frequency_hz} Hz`;
  synthBadgeGain.textContent = cfg.gain.toFixed(2);
  synthBadgePulse.textContent = `${cfg.pulse_interval_ms} ms`;

  synthBadgeWaveform.textContent = `${cfg.waveform_type.toUpperCase()} ${cfg.waveform_type === 'sawtooth' ? '(Hazard Override)' : '(Normal)'}`;
  synthBadgeWaveform.className = `badge ${cfg.waveform_type === 'sawtooth' ? 'badge-unknown' : 'badge-navigate'}`;

  const bracket = distanceM < 1.5 ? "NEAR (< 1.5m)" : (distanceM <= 4.0 ? "MEDIUM (1.5m - 4.0m)" : "FAR (> 4.0m)");
  synthBadgeBracket.textContent = bracket;
  synthBadgeBracket.className = `stat-value ${distanceM < 1.5 ? 'text-crimson' : ''}`;

  jsonSynthOutputCode.textContent = JSON.stringify(res, null, 2);
  announceToScreenReader(`Synthesized spatial audio config: Pan ${cfg.pan}, Frequency ${cfg.frequency_hz} Hz, Waveform ${cfg.waveform_type}.`);
}

// Web Audio API Binaural Spatial Synthesizer with Multi-Pulse Cadence
function playSpatialAudioPulse(panValue, pitchHz, gainLevel, pulseRateMs, waveformType = 'sine', triggerButton = null) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    if (triggerButton) {
      triggerButton.classList.add('audio-pulse-active');
      const resetTime = Math.max(300, (pulseRateMs || 200) * 2.2);
      setTimeout(() => triggerButton.classList.remove('audio-pulse-active'), resetTime);
    }

    const clampedPan = Math.max(-1.0, Math.min(1.0, typeof panValue === 'number' ? panValue : 0.0));
    const now = audioCtx.currentTime;

    // 3 rapid pulses for sawtooth hazard alert, 2 smooth pulses for navigation ping
    const numPulses = waveformType === 'sawtooth' ? 3 : 2;
    const pulseDuration = waveformType === 'sawtooth' ? 0.08 : 0.12;
    const intervalSec = Math.max(pulseDuration + 0.03, (pulseRateMs || 200) / 1000);

    for (let i = 0; i < numPulses; i++) {
      const startTime = now + (i * intervalSec);
      const stopTime = startTime + pulseDuration;

      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc.type = waveformType === 'sawtooth' ? 'sawtooth' : 'sine';
      osc.frequency.setValueAtTime(pitchHz || 440, startTime);

      // Volume envelope with quick attack and exponential decay
      gainNode.gain.setValueAtTime(0.001, startTime);
      gainNode.gain.linearRampToValueAtTime((gainLevel || 0.7) * 0.45, startTime + 0.008);
      gainNode.gain.exponentialRampToValueAtTime(0.001, stopTime);

      if (audioCtx.createStereoPanner) {
        const panner = audioCtx.createStereoPanner();
        panner.pan.setValueAtTime(clampedPan, startTime);
        osc.connect(gainNode);
        gainNode.connect(panner);
        panner.connect(audioCtx.destination);
      } else {
        // Fallback for older browsers
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
      }

      osc.start(startTime);
      osc.stop(stopTime);
    }
  } catch (e) {
    console.warn("Web Audio API spatial audio pulse error:", e);
  }
}

function readAllRouteMilestonesAloud(routeResult) {
  if (!routeResult.milestones) return;
  const fullText = `Route starting. Total distance is ${routeResult.total_steps} steps across ${routeResult.milestones.length} milestones. ` +
    routeResult.milestones.map(m => m.instruction).join('. ');
  speakTextToSpeech(fullText);
}

// Speak via Gnani.ai TTS (through the backend proxy) when configured; otherwise, or on any
// failure, fall back to the browser's built-in speechSynthesis so the user always hears it.
//
// Speech priority: a higher-priority announcement interrupts a lower one; a lower one is dropped
// while something more important is still speaking. Hazard alerts outrank everything and use the
// on-device browser voice so they start instantly (no network round-trip to Gnani).
const SPEECH_PRIORITY ={ LANDMARK: 1, NORMAL: 2, HAZARD: 3 };
let speechRequestId = 0;
let activeSpeechPriority = 0;
const GNANI_START_TIMEOUT_MS = 4000; // max wait for Gnani audio before using the browser voice
const GNANI_BACKOFF_MS = 60000;      // after a failure, skip Gnani for a minute
let gnaniTtsBackoffUntil = 0;

function setVoiceFallbackIndicator(onFallback) {
  const badge = document.getElementById('gnani-badge');
  const label = document.getElementById('gnani-badge-text');
  if (!badge || !label) return;
  if (onFallback) {
    badge.dataset.state = 'fallback';
    label.textContent = 'Gnani.ai not responding — using device voice';
  } else {
    updateGnaniBadge();
  }
}

async function speakTextToSpeech(text, { priority = SPEECH_PRIORITY.NORMAL } = {}) {
  if (!text) return;
  if (activeSpeechPriority > priority) return; // don't talk over a more important message
  if (priority === SPEECH_PRIORITY.HAZARD) stopAllSpeech();

  const requestId = ++speechRequestId;
  activeSpeechPriority = priority;
  try {
    try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {}

    const gnaniCoolingDown = Date.now() < gnaniTtsBackoffUntil;
    if (priority !== SPEECH_PRIORITY.HAZARD && !gnaniCoolingDown && await isGnaniAvailable()) {
      if (requestId !== speechRequestId) return; // a newer request superseded this one
      let started = false, gaveUp = false;
      // Guidance must never stall: if Gnani hasn't started playing quickly, abandon it
      const startTimer = setTimeout(() => {
        if (started) return;
        gaveUp = true;
        stopGnaniSpeech();
      }, GNANI_START_TIMEOUT_MS);
      try {
        await speakText(text, {
          onStart: () => { started = true; if (spokenCard) spokenCard.classList.add('speaking-active'); },
          onEnd: () => { if (spokenCard) spokenCard.classList.remove('speaking-active'); }
        });
        clearTimeout(startTimer);
        if (!gaveUp) {
          if (document.getElementById('gnani-badge')?.dataset.state === 'fallback') setVoiceFallbackIndicator(false);
          return;
        }
        console.warn(`Gnani TTS did not start within ${GNANI_START_TIMEOUT_MS} ms. Falling back to browser speech.`);
        gnaniTtsBackoffUntil = Date.now() + GNANI_BACKOFF_MS;
      } catch (err) {
        clearTimeout(startTimer);
        console.warn(`Gnani TTS failed (${err.code || err.name}): ${err.message}. Falling back to browser speech.`);
        gnaniTtsBackoffUntil = Date.now() + GNANI_BACKOFF_MS;
        if (requestId !== speechRequestId) return;
      }
      setVoiceFallbackIndicator(true);
    } else if (gnaniCoolingDown) {
      setVoiceFallbackIndicator(true);
    }
    if (requestId !== speechRequestId) return;
    await speakWithBrowserTTS(text);
  } finally {
    if (requestId === speechRequestId) activeSpeechPriority = 0;
  }
}

/** Stop any speech (Gnani audio or browser synthesis) immediately. */
function stopAllSpeech() {
  activeSpeechPriority = 0;
  speechRequestId++;
  stopGnaniSpeech();
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {}
  if (spokenCard) spokenCard.classList.remove('speaking-active');
}

// Resolves when the utterance finishes (or errors / is cancelled)
function speakWithBrowserTTS(text) {
  if (!('speechSynthesis' in window) || !text) return Promise.resolve();
  return new Promise((resolve) => {
    speakWithBrowserTTSImpl(text, resolve);
  });
}

function speakWithBrowserTTSImpl(text, done) {
  stopGnaniSpeech();
  
  try {
    window.speechSynthesis.cancel();
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  } catch (e) {}

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  activeSpeechUtterance = utterance; // Prevent garbage collection bug in Chromium

  if (spokenCard) spokenCard.classList.add('speaking-active');

  utterance.onend = () => {
    if (spokenCard) spokenCard.classList.remove('speaking-active');
    activeSpeechUtterance = null;
    done();
  };

  utterance.onerror = (e) => {
    if (e.error !== 'interrupted' && e.error !== 'canceled') console.warn("Speech synthesis error:", e);
    if (spokenCard) spokenCard.classList.remove('speaking-active');
    activeSpeechUtterance = null;
    done();
  };

  window.speechSynthesis.speak(utterance);
}

// ─────────────────────────────────────────────────────────────────────────────
// Two-way voice: Gnani STT (listen) -> Voice Engine -> Gnani TTS (reply) -> listen again
// ─────────────────────────────────────────────────────────────────────────────
const VOICE_LANGUAGE = 'en-IN';
const CONVERSATION_EXIT_PHRASES = /^(stop|exit|goodbye|bye|cancel|stop listening|that's all|thank you)\.?$/i;
let conversationMode = false;
let gnaniTurnActive = false;
let consecutiveMisses = 0;

function setMicUI(state, statusText) {
  // state: 'idle' | 'listening' | 'transcribing' | 'speaking'
  isListening = state === 'listening';
  btnMic.classList.toggle('listening', state === 'listening');
  if (micContainer) micContainer.classList.toggle('recording', state === 'listening');
  rawSpeechInput.classList.toggle('live-transcribing', state === 'listening' || state === 'transcribing');
  if (liveSttBadge) liveSttBadge.classList.toggle('hidden', state !== 'listening' && state !== 'transcribing');
  if (liveSttPreview) {
    liveSttPreview.classList.toggle('hidden', state === 'idle');
    if (statusText) liveSttPreview.textContent = statusText;
  }
  micStatusText.textContent = state === 'idle'
    ? (conversationMode ? 'Conversation paused. Tap the mic to talk.' : 'Click button or press Microphone to speak')
    : (statusText || micStatusText.textContent);
  if (state !== 'listening') renderMicLevel(0);
}

function renderMicLevel(level) {
  const bars = document.querySelectorAll('.mic-audio-visualizer .v-bar');
  const n = bars.length;
  bars.forEach((bar, i) => {
    // centre bars react most; small jitter so it looks alive
    const shape = 1 - Math.abs(i - (n - 1) / 2) / n;
    const v = Math.max(0.18, Math.min(1, level * (0.6 + shape) + (level > 0.02 ? Math.random() * 0.12 : 0)));
    bar.style.transform = `scaleY(${v.toFixed(2)})`;
  });
}

// One full turn: listen (Gnani STT) -> process -> speak reply (Gnani TTS / fallback)
function waitForSpeechToFinish(maxMs = 20000) {
  return new Promise(resolve => {
    const start = Date.now();
    const tick = () => (activeSpeechPriority === 0 || Date.now() - start > maxMs ? resolve() : setTimeout(tick, 150));
    tick();
  });
}

async function runVoiceTurn() {
  if (gnaniTurnActive) return;
  gnaniTurnActive = true;
  const airport = airportMode && airportMode.isHandsFree();
  // Airport Mode: let guidance finish instead of cutting it off, then listen again
  if (airport) await waitForSpeechToFinish(); else stopAllSpeech();

  try {
    if (!(await isGnaniSttAvailable())) {
      gnaniTurnActive = false;
      startBrowserRecognition();
      return;
    }

    setMicUI('listening', 'Listening… speak now');
    announceToScreenReader('Listening.');
    const { transcript } = await listen({
      language: VOICE_LANGUAGE,
      deviceId: selectedAudioDeviceId || undefined,
      onLevel: renderMicLevel,
      onSpeechStart: () => { if (liveSttPreview) liveSttPreview.textContent = 'Hearing you…'; },
      onTranscribing: () => setMicUI('transcribing', 'Transcribing with Gnani…')
    });

    if (!transcript && airport) {
      // Silence mid-walk is normal: keep listening without nagging or giving up
      setMicUI('idle');
      if (conversationMode) scheduleNextTurn();
      return;
    }

    if (!transcript) {
      setMicUI('idle');
      consecutiveMisses++;
      if (conversationMode && consecutiveMisses >= 2) {
        endConversation("I didn't hear anything, so I've stopped listening. Tap the microphone to talk again.");
        return;
      }
      if (conversationMode) {
        await speakTextToSpeech("Sorry, I didn't catch that. Please say it again.");
        scheduleNextTurn();
      } else {
        micStatusText.textContent = "Didn't catch that. Tap the mic and try again.";
      }
      return;
    }

    consecutiveMisses = 0;
    rawSpeechInput.value = transcript;
    if (liveSttPreview) liveSttPreview.textContent = `You said: "${transcript}"`;

    if (airport) {
      // "stop" here means stop navigation (handled by the navigator), not stop listening
      const reply = airportMode.handleTranscript(transcript);
      if (reply) {
        setMicUI('speaking', 'Replying…');
        await speakTextToSpeech(reply);
      }
      setMicUI('idle');
      if (conversationMode) scheduleNextTurn();
      return;
    }

    if (conversationMode && CONVERSATION_EXIT_PHRASES.test(transcript.trim())) {
      endConversation('Okay, conversation ended.');
      return;
    }

    setMicUI('transcribing', 'Searching nearby places…');
    const result = await executeVoiceEngine(transcript, false);
    setMicUI('speaking', 'Replying…');
    await speakTextToSpeech(result.spoken_response);
    setMicUI('idle');
    if (conversationMode) scheduleNextTurn();
  } catch (err) {
    console.warn(`Gnani listen failed (${err.code || err.name}): ${err.message}`);
    setMicUI('idle');
    if (err.name === 'NotAllowedError') {
      micStatusText.textContent = 'Microphone permission denied. Allow mic access to talk.';
      conversationMode = false;
      if (toggleConversation) toggleConversation.checked = false;
    } else if (airport && conversationMode) {
      // Transient STT/network error: keep the navigation session alive and retry shortly
      micStatusText.textContent = 'Voice hiccup — listening again…';
      setTimeout(() => { if (conversationMode && !gnaniTurnActive) runVoiceTurn(); }, 1500);
    } else if (speechRecognizer && !conversationMode) {
      micStatusText.textContent = 'Gnani unavailable — using browser speech recognition.';
      gnaniTurnActive = false;
      startBrowserRecognition();
      return;
    } else {
      micStatusText.textContent = `Voice error: ${err.message}`;
    }
  } finally {
    gnaniTurnActive = false;
  }
}

function scheduleNextTurn() {
  // short gap so the reply's tail doesn't get picked up by the mic
  setTimeout(() => { if (conversationMode && !gnaniTurnActive) runVoiceTurn(); }, 450);
}

function startConversation() {
  conversationMode = true;
  consecutiveMisses = 0;
  if (toggleConversation) toggleConversation.checked = true;
  announceToScreenReader('Hands-free conversation on.');
  runVoiceTurn();
}

function endConversation(message) {
  conversationMode = false;
  if (toggleConversation) toggleConversation.checked = false;
  cancelListening();
  setMicUI('idle');
  micStatusText.textContent = 'Click button or press Microphone to speak';
  if (message) speakTextToSpeech(message);
}

function startBrowserRecognition() {
  if (!speechRecognizer) {
    micStatusText.textContent = 'Speech recognition is not available in this browser. Type your request instead.';
    return;
  }
  try { speechRecognizer.start(); } catch (e) { /* already started */ }
}

// Mic button: start a turn; while listening, finish the utterance now; while replying, interrupt and listen
function handleMicButton() {
  if (isRecording()) { stopListening(); return; }
  if (isListening && speechRecognizer) { speechRecognizer.stop(); return; }
  runVoiceTurn();
}

function announceToScreenReader(message) {
  if (srAnnouncer) srAnnouncer.textContent = message;
}

// Bind DOM event handlers
function bindEvents() {
  tabVoiceEngine.addEventListener('click', () => setActiveTab(tabVoiceEngine, viewVoiceEngine, "Voice Control Engine"));
  tabRouteEngine.addEventListener('click', () => setActiveTab(tabRouteEngine, viewRouteEngine, "Route Processing Engine"));
  tabLandmarkEngine.addEventListener('click', () => setActiveTab(tabLandmarkEngine, viewLandmarkEngine, "Visual Landmark Verification Engine"));
  tabHazardEngine.addEventListener('click', () => setActiveTab(tabHazardEngine, viewHazardEngine, "Spatial Hazard & Safety Engine"));
  tabAudioEngine.addEventListener('click', () => setActiveTab(tabAudioEngine, viewAudioEngine, "Spatial Audio Synthesizer Engine"));

  function setActiveTab(activeBtn, activeView, label) {
    [tabVoiceEngine, tabRouteEngine, tabLandmarkEngine, tabHazardEngine, tabAudioEngine].forEach(btn => {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
    });
    [viewVoiceEngine, viewRouteEngine, viewLandmarkEngine, viewHazardEngine, viewAudioEngine].forEach(view => {
      view.classList.remove('active');
    });

    activeBtn.classList.add('active');
    activeBtn.setAttribute('aria-selected', 'true');
    activeView.classList.add('active');
    announceToScreenReader(`Switched to ${label} view.`);
  }

  // Voice Events
  btnProcess.addEventListener('click', () => executeVoiceEngine(rawSpeechInput.value, true));
  rawSpeechInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') executeVoiceEngine(rawSpeechInput.value, true); });
  btnMic.addEventListener('click', handleMicButton);
  if (toggleConversation) {
    toggleConversation.addEventListener('change', (e) => {
      if (e.target.checked) startConversation(); else endConversation();
    });
  }
  btnSpeakAgain.addEventListener('click', () => { if (lastVoiceOutput && lastVoiceOutput.spoken_response) speakTextToSpeech(lastVoiceOutput.spoken_response); });
  btnCopyJson.addEventListener('click', () => copyToClipboard(lastVoiceOutput, btnCopyJson));

  // Audio Device Selection Events
  if (micDeviceSelect) {
    micDeviceSelect.addEventListener('change', () => {
      selectedAudioDeviceId = micDeviceSelect.value;
      if (isListening) {
        stopAudioVisualizer();
        startAudioVisualizer();
      }
    });
  }

  if (btnRefreshMics) {
    btnRefreshMics.addEventListener('click', async () => {
      btnRefreshMics.disabled = true;
      btnRefreshMics.textContent = "Checking...";
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          tempStream.getTracks().forEach(t => t.stop());
        }
      } catch (e) {}
      await initAudioDevices();
      btnRefreshMics.disabled = false;
      btnRefreshMics.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> Refresh Devices`;
    });
  }

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      initAudioDevices();
    });
  }

  // Route Events
  stepLengthRange.addEventListener('input', () => {
    stepLengthValue.textContent = `${parseFloat(stepLengthRange.value).toFixed(2)} meters`;
    executeRouteEngine(false);
  });
  btnProcessRoute.addEventListener('click', () => executeRouteEngine(true));
  btnReadRouteAloud.addEventListener('click', () => { if (lastRouteOutput) readAllRouteMilestonesAloud(lastRouteOutput); });

  // Landmark Events
  btnVerifyLandmark.addEventListener('click', () => runFrameInference(true));
  btnSpeakLandmark.addEventListener('click', () => { if (lastLandmarkOutput && lastLandmarkOutput.spoken_system_update) speakTextToSpeech(lastLandmarkOutput.spoken_system_update); });

  if (btnToggleCamera) {
    btnToggleCamera.addEventListener('click', toggleCameraStream);
  }

  if (cameraFileInput) {
    cameraFileInput.addEventListener('change', handleCameraImageUpload);
  }

  if (btnSimulateCapture) {
    btnSimulateCapture.addEventListener('click', () => runFrameInference(true));
  }

  const btnVideoPlayPause = document.getElementById('btn-video-playpause');
  if (btnVideoPlayPause) btnVideoPlayPause.addEventListener('click', toggleUploadedVideoPlayback);
  // Re-project boxes whenever the viewer changes size (window resize, Airport Mode, new media shape)
  if (cameraViewport && 'ResizeObserver' in window) new ResizeObserver(() => renderDynamicBoundingBoxes()).observe(cameraViewport);

  // Auto-detect loop: re-runs real inference on the live webcam / uploaded video
  if (toggleAutoFrameSim) {
    toggleAutoFrameSim.addEventListener('change', (e) => {
      if (e.target.checked) {
        if (!isCameraActive && !isUploadedVideoActive) {
          e.target.checked = false;
          announceToScreenReader('Start the WebCam or upload a video to use auto-detect.');
          return;
        }
        if (autoSimIntervalId) clearInterval(autoSimIntervalId);
        // Webcam every 1.5s so focal-zone hazards are caught quickly; uploaded video as fast as the
        // models allow. Overlapping runs are skipped inside runFrameInference.
        autoSimIntervalId = setInterval(autoDetectTick, isUploadedVideoActive ? VIDEO_INFERENCE_INTERVAL_MS : WEBCAM_INFERENCE_INTERVAL_MS);
        autoDetectTick();
      } else {
        stopAutoInferenceLoop();
      }
    });
  }

  // Keep real boxes aligned with the frame when the viewport resizes
  if (cameraViewport && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (lastInference) renderDynamicBoundingBoxes(); }).observe(cameraViewport);
  }

  // Spatial Hazard Events & 2D Radar Interactions
  hazardAngleRange.addEventListener('input', () => {
    const val = parseFloat(hazardAngleRange.value);
    const side = val < -0.2 ? 'Left' : (val > 0.2 ? 'Right' : 'Center');
    hazardAngleLabel.textContent = `${val.toFixed(2)} (${side})`;
    executeHazardEngine(false);
  });
  hazardDistInput.addEventListener('input', () => executeHazardEngine(false));
  hazardTypeSelect.addEventListener('change', () => executeHazardEngine(true));
  btnProcessHazard.addEventListener('click', () => executeHazardEngine(true));

  btnPlaySpatialPing.addEventListener('click', () => {
    if (lastHazardOutput && lastHazardOutput.spatial_audio) {
      const isCrit = lastHazardOutput.severity === 'CRITICAL';
      playSpatialAudioPulse(
        lastHazardOutput.spatial_audio.pan,
        lastHazardOutput.spatial_audio.pitch_hz,
        isCrit ? 0.45 : 0.3,
        lastHazardOutput.spatial_audio.pulse_rate_ms,
        isCrit ? 'sawtooth' : 'sine',
        btnPlaySpatialPing
      );
    }
  });

  btnSpeakHazardAlert.addEventListener('click', () => {
    if (lastHazardOutput && lastHazardOutput.spoken_alert) speakTextToSpeech(lastHazardOutput.spoken_alert);
  });
  btnCopyHazardJson.addEventListener('click', () => copyToClipboard(lastHazardOutput, btnCopyHazardJson));

  // Click on empty space in Hazard Radar Viewport to place / add a hazard
  if (hazardRadarViewport) {
    hazardRadarViewport.addEventListener('click', (e) => {
      if (e.target.closest('.radar-hazard-marker') || e.target.closest('.radar-center-user')) return;
      const rect = hazardRadarViewport.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relBottom = (rect.bottom - e.clientY) / rect.height;

      const normX = Math.max(-1.0, Math.min(1.0, (relX - 0.5) / 0.4));
      const depth = radarPercentToDepth(relBottom * 100);

      const type = hazardTypeSelect.value !== 'none' ? hazardTypeSelect.value : 'pothole';
      const newId = `h_${Date.now()}`;
      activeHazards.push({
        id: newId,
        type: type,
        label: type === 'pothole' ? 'Pothole (Ground Drop)' :
          (type === 'curb_drop' ? 'Curb Drop-off' :
          (type === 'branch' ? 'Low-Hanging Branch' : 'Obstacle / Pole')),
        x_center: Number(normX.toFixed(2)),
        depth_m: depth,
        isDepthMap: type === 'pothole' || type === 'curb_drop'
      });
      selectedHazardId = newId;
      syncSelectedHazardToInputs();
      executeHazardEngine(true);
    });
  }

  // Quick Hazard Preset Buttons
  document.querySelectorAll('.hazard-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type || 'pothole';
      const dist = parseFloat(btn.dataset.dist) || 1.0;
      const angle = parseFloat(btn.dataset.angle) || 0.0;

      const newId = `h_${Date.now()}_${type}`;
      activeHazards.push({
        id: newId,
        type: type,
        label: type === 'pothole' ? 'Pothole (Ground Drop)' :
          (type === 'curb_drop' ? 'Curb Drop-off' :
          (type === 'branch' ? 'Low-Hanging Branch' : 'Obstacle / Pole')),
        x_center: angle,
        depth_m: dist,
        isDepthMap: type === 'pothole' || type === 'curb_drop'
      });
      selectedHazardId = newId;
      syncSelectedHazardToInputs();
      executeHazardEngine(true);
    });
  });

  if (btnClearAllHazards) {
    btnClearAllHazards.addEventListener('click', () => {
      activeHazards = [];
      selectedHazardId = null;
      hazardTypeSelect.value = 'none';
      hazardDistInput.value = '2.5';
      hazardAngleRange.value = '0.0';
      hazardAngleLabel.textContent = '0.00 (Center)';
      executeHazardEngine(false);
    });
  }

  if (btnResetDefaultHazards) {
    btnResetDefaultHazards.addEventListener('click', () => {
      activeHazards = JSON.parse(JSON.stringify(DEFAULT_HAZARDS));
      selectedHazardId = 'h_pothole_1';
      syncSelectedHazardToInputs();
      executeHazardEngine(true);
    });
  }

  // Spatial Audio Synthesizer 2D Radar & Slider Synchronization
  if (audioRadarViewport && audioTargetPuck) {
    const handleAudioPointerDown = (e) => {
      isDraggingAudioPuck = true;
      audioTargetPuck.classList.add('dragging');
      try { audioRadarViewport.setPointerCapture(e.pointerId); } catch (_) {}
      updateAudioPuckFromPointer(e);
    };

    const handleAudioPointerMove = (e) => {
      if (!isDraggingAudioPuck) return;
      updateAudioPuckFromPointer(e);
    };

    const handleAudioPointerUp = (e) => {
      if (isDraggingAudioPuck) {
        isDraggingAudioPuck = false;
        audioTargetPuck.classList.remove('dragging');
        try { audioRadarViewport.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };

    audioRadarViewport.addEventListener('pointerdown', handleAudioPointerDown);
    audioRadarViewport.addEventListener('pointermove', handleAudioPointerMove);
    audioRadarViewport.addEventListener('pointerup', handleAudioPointerUp);
    audioRadarViewport.addEventListener('pointercancel', handleAudioPointerUp);

    // Keyboard Accessibility on Audio Puck
    audioTargetPuck.addEventListener('keydown', (e) => {
      let x = parseFloat(audioXcenterRange.value);
      let dist = parseFloat(audioDistRange.value);
      let handled = false;

      if (e.key === 'ArrowLeft') { x = Math.max(-1.0, x - 0.05); handled = true; }
      else if (e.key === 'ArrowRight') { x = Math.min(1.0, x + 0.05); handled = true; }
      else if (e.key === 'ArrowUp') { dist = Math.min(8.0, dist + 0.2); handled = true; }
      else if (e.key === 'ArrowDown') { dist = Math.max(0.5, dist - 0.2); handled = true; }

      if (handled) {
        e.preventDefault();
        audioXcenterRange.value = x.toFixed(2);
        audioDistRange.value = dist.toFixed(1);
        const side = x < -0.25 ? 'Left' : (x > 0.25 ? 'Right' : 'Centered Ahead');
        audioXcenterLabel.textContent = `${x.toFixed(2)} (${side})`;
        const bracket = dist < 1.5 ? 'Near < 1.5m' : (dist <= 4.0 ? 'Medium 1.5-4.0m' : 'Far > 4.0m');
        audioDistLabel.textContent = `${dist.toFixed(1)} meters (${bracket})`;
        syncAudioPuckPosition(x, dist);
        executeSpatialAudioSynthesizer(false);
      }
    });
  }

  audioXcenterRange.addEventListener('input', () => {
    const val = parseFloat(audioXcenterRange.value);
    const dist = parseFloat(audioDistRange.value) || 1.0;
    const side = val < -0.25 ? 'Left' : (val > 0.25 ? 'Right' : 'Centered Ahead');
    audioXcenterLabel.textContent = `${val.toFixed(2)} (${side})`;
    syncAudioPuckPosition(val, dist);
    executeSpatialAudioSynthesizer(false);
  });

  audioDistRange.addEventListener('input', () => {
    const dist = parseFloat(audioDistRange.value);
    const x = parseFloat(audioXcenterRange.value) || -0.6;
    const bracket = dist < 1.5 ? 'Near < 1.5m' : (dist <= 4.0 ? 'Medium 1.5-4.0m' : 'Far > 4.0m');
    audioDistLabel.textContent = `${dist.toFixed(1)} meters (${bracket})`;
    syncAudioPuckPosition(x, dist);
    executeSpatialAudioSynthesizer(false);
  });

  audioHazardCheckbox.addEventListener('change', () => {
    const x = parseFloat(audioXcenterRange.value) || -0.6;
    const dist = parseFloat(audioDistRange.value) || 1.0;
    syncAudioPuckPosition(x, dist);
    executeSpatialAudioSynthesizer(true);
  });

  btnSynthesizeAudio.addEventListener('click', () => executeSpatialAudioSynthesizer(true));

  btnPlaySynthPulse.addEventListener('click', () => {
    if (lastSynthAudioOutput) {
      const cfg = lastSynthAudioOutput.audio_node_config;
      playSpatialAudioPulse(cfg.pan, cfg.frequency_hz, cfg.gain, cfg.pulse_interval_ms, cfg.waveform_type, btnPlaySynthPulse);
    }
  });

  btnCopySynthJson.addEventListener('click', () => copyToClipboard(lastSynthAudioOutput, btnCopySynthJson));

  // Settings & GPS Geolocation
  btnUseGps.addEventListener('click', () => {
    if (navigator.geolocation && navigator.geolocation.getCurrentPosition) {
      btnUseGps.disabled = true;
      btnUseGps.textContent = "Locating...";
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
          inputLat.value = lat.toFixed(6);
          inputLon.value = lon.toFixed(6);
          userLocation.lat = lat;
          userLocation.lon = lon;
          btnUseGps.textContent = "Updated GPS";
          btnUseGps.disabled = false;
          announceToScreenReader(`GPS location updated to latitude ${lat.toFixed(5)}, longitude ${lon.toFixed(5)}`);
          setTimeout(() => { btnUseGps.textContent = "Get GPS"; }, 2500);
          executeVoiceEngine(rawSpeechInput.value, false);
        },
        (error) => {
          console.warn("Geolocation error:", error);
          let msg = error.message;
          if (error.code === error.PERMISSION_DENIED) {
            msg = "Location permission denied. Please allow location access in your browser.";
          } else if (error.code === error.POSITION_UNAVAILABLE) {
            msg = "Location information is unavailable.";
          } else if (error.code === error.TIMEOUT) {
            msg = "Location request timed out.";
          }
          alert(`GPS Error: ${msg}`);
          btnUseGps.textContent = "Get GPS";
          btnUseGps.disabled = false;
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    } else {
      alert("Geolocation is not supported by your browser environment.");
    }
  });

  btnToggleHighContrast.addEventListener('click', () => {
    document.body.classList.toggle('high-contrast');
    const isHC = document.body.classList.contains('high-contrast');
    announceToScreenReader(`High contrast mode ${isHC ? 'enabled' : 'disabled'}`);
  });
}

function copyToClipboard(data, buttonEl) {
  if (data) {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    const origText = buttonEl.textContent;
    buttonEl.textContent = "Copied!";
    setTimeout(() => buttonEl.textContent = origText, 2000);
  }
}
