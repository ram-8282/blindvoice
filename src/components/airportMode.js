// Airport Mode: the user-facing screen (vs. the developer dashboard).
//
// Plain ES module (the app has no React/bundler). It owns the Airport Mode DOM and the
// AirportNavigator; app.js passes in its camera, detection and speech functions as `deps` and
// forwards transcripts, camera frames and step events to the hooks returned here.

import { AirportNavigator, NAV_STATE } from '../../airportNavigator.js';
import { calculateStringSimilarity } from '../../landmarkEngine.js';

const GRAPH_URL = './src/assets/graphs/sfo_terminal_2.json';
const ECHO_SIMILARITY = 0.6; // transcripts this close to what we just said are our own voice

/**
 * @param {object} deps
 *   speak(text, level)          level: 'HIGH' (guidance) | 'LOW' (countdowns)
 *   startCamera(): Promise<boolean>, stopCamera()
 *   startAutoDetect(), stopAutoDetect()
 *   startListening(), stopListening()
 *   onVisualMatch(landmarkName)   re-anchor the tracking badge (Mode C)
 *   onModeChange(isAirport)
 *   announce(text)               screen-reader live region
 *   getStepLength(): number
 */
export function createAirportMode(deps) {
  const el = {
    toggle: document.getElementById('btn-app-mode'),
    view: document.getElementById('airport-mode-view'),
    cameraSlot: document.getElementById('airport-camera-slot'),
    instruction: document.getElementById('airport-instruction'),
    heard: document.getElementById('airport-heard'),
    destination: document.getElementById('airport-destination'),
    progress: document.getElementById('airport-progress'),
    start: document.getElementById('btn-airport-start'),
    demoSteps: document.getElementById('btn-airport-demo-steps'),
    viewport: document.getElementById('camera-viewport')
  };

  let active = false;        // Airport Mode screen shown
  let handsFree = false;     // camera + mic loop running
  let navigator = null;
  let viewportHome = null;   // where the camera viewport lives in the dashboard
  let lastSpoken = { text: '', time: 0 };

  async function ensureNavigator() {
    if (navigator) return navigator;
    const res = await fetch(GRAPH_URL);
    if (!res.ok) throw new Error(`Could not load venue map (${res.status})`);
    navigator = new AirportNavigator(await res.json(), { strideMeters: deps.getStepLength() });
    return navigator;
  }

  function say(text, level = 'HIGH') {
    if (!text) return;
    lastSpoken = { text, time: Date.now() };
    if (level === 'HIGH') setInstruction(text);
    deps.speak(text, level);
  }

  function setInstruction(text) {
    if (el.instruction) el.instruction.textContent = text;
  }

  function render() {
    if (!navigator) return;
    const n = navigator;
    const dest = n.destination ? n.destination.name : null;
    if (el.destination) el.destination.textContent = dest ? `To ${dest}` : 'No destination yet';
    let progress = '';
    switch (n.state) {
      case NAV_STATE.NAVIGATING: progress = `${n.remainingTotalSteps()} steps to go`; break;
      case NAV_STATE.AWAITING_LEVEL_CHANGE: progress = 'On the escalator'; break;
      case NAV_STATE.PAUSED_HAZARD: progress = 'Paused — hazard ahead'; break;
      case NAV_STATE.ARRIVING: progress = 'Scan for the gate sign'; break;
      case NAV_STATE.ARRIVED: progress = 'Arrived'; break;
      case NAV_STATE.STANDBY: progress = 'Paused'; break;
      default: progress = handsFree ? 'Listening for a destination' : '';
    }
    if (el.progress) el.progress.textContent = progress;
    if (el.view) el.view.dataset.state = n.state;
  }

  // ---- mode switch ----------------------------------------------------------------------------

  function moveViewport(intoAirport) {
    if (!el.viewport || !el.cameraSlot) return;
    if (intoAirport) {
      if (!viewportHome) {
        viewportHome = document.createComment('camera-viewport-home');
        el.viewport.parentNode.insertBefore(viewportHome, el.viewport);
      }
      el.cameraSlot.appendChild(el.viewport);
    } else if (viewportHome) {
      viewportHome.parentNode.insertBefore(el.viewport, viewportHome);
    }
    window.dispatchEvent(new Event('resize')); // re-project boxes for the new size
  }

  async function setMode(airport) {
    if (airport === active) return;
    active = airport;
    document.body.classList.toggle('airport-mode-active', airport);
    if (el.view) el.view.classList.toggle('hidden', !airport);
    if (el.toggle) {
      el.toggle.setAttribute('aria-pressed', String(airport));
      el.toggle.textContent = airport ? 'Developer Dashboard Mode' : 'Airport Navigation Mode';
      el.toggle.title = airport ? 'Switch to the developer dashboard' : 'Switch to the airport navigation screen';
    }
    moveViewport(airport);
    if (!airport && handsFree) stopHandsFree(false);
    deps.onModeChange(airport);
    deps.announce(airport ? 'Airport navigation mode. Press Start Hands-Free Navigation.' : 'Developer dashboard mode.');
    if (airport) {
      try { await ensureNavigator(); render(); } catch (err) { setInstruction(`Venue map unavailable: ${err.message}`); }
    }
  }

  // ---- hands-free session --------------------------------------------------------------------

  async function startHandsFree() {
    try { await ensureNavigator(); } catch (err) { setInstruction(`Venue map unavailable: ${err.message}`); return; }
    handsFree = true;
    if (el.start) {
      el.start.textContent = 'Stop Hands-Free Navigation';
      el.start.classList.add('running');
      el.start.setAttribute('aria-pressed', 'true');
    }
    const cameraOk = await deps.startCamera();
    if (cameraOk) deps.startAutoDetect();
    const intro = navigator.isActive() || navigator.state === NAV_STATE.STANDBY
      ? `Hands-free navigation is back on. ${navigator.progressSentence()}`
      : `Hands-free navigation is on. You are at ${navigator.startLocationName()}. Where would you like to go?`;
    say(cameraOk ? intro : `${intro} The camera is off, so I can't check signs or hazards.`);
    deps.startListening();
    render();
  }

  function stopHandsFree(speak = true) {
    handsFree = false;
    deps.stopListening();
    deps.stopAutoDetect();
    deps.stopCamera();
    if (el.start) {
      el.start.textContent = 'Start Hands-Free Navigation';
      el.start.classList.remove('running');
      el.start.setAttribute('aria-pressed', 'false');
    }
    if (speak) say('Hands-free navigation stopped.');
    render();
  }

  // ---- hooks called by app.js ----------------------------------------------------------------

  /** A recognized utterance while Airport Mode is listening. Returns the reply to speak (or null). */
  function handleTranscript(text) {
    if (!navigator) return null;
    const t = String(text || '').trim();
    // Ignore our own guidance picked up by the mic
    if (t && Date.now() - lastSpoken.time < 15000 && calculateStringSimilarity(t, lastSpoken.text) > ECHO_SIMILARITY) return null;
    if (t && el.heard) el.heard.textContent = `You said: "${t}"`;
    const reply = navigator.handleUtterance(t);
    if (reply) {
      lastSpoken = { text: reply, time: Date.now() };
      setInstruction(reply);
    }
    render();
    return reply;
  }

  /** Called after every analyzed camera frame. */
  function onFrame({ priorityHazard, detections }) {
    if (!active || !navigator) return;
    const wasPaused = navigator.state === NAV_STATE.PAUSED_HAZARD;
    const res = navigator.onFrame({ priorityHazard, detections });
    if (priorityHazard && !wasPaused && navigator.state === NAV_STATE.PAUSED_HAZARD) setInstruction(priorityHazard.alert);
    res.announcements.forEach(a => say(a.text, a.priority === 'LOW' ? 'LOW' : 'HIGH'));
    if (res.verifiedLandmark) deps.onVisualMatch(res.verifiedLandmark);
    render();
  }

  function onSteps(n = 1) {
    if (!active || !navigator) return;
    navigator.onSteps(n).forEach(a => say(a.text, a.priority === 'LOW' ? 'LOW' : 'HIGH'));
    render();
  }

  // ---- wiring --------------------------------------------------------------------------------

  if (el.toggle) el.toggle.addEventListener('click', () => setMode(!active));
  if (el.start) el.start.addEventListener('click', () => (handsFree ? stopHandsFree() : startHandsFree()));
  if (el.demoSteps) el.demoSteps.addEventListener('click', () => onSteps(10));

  return {
    isActive: () => active,
    isHandsFree: () => active && handsFree,
    isNavigating: () => Boolean(navigator && navigator.isActive()),
    handleTranscript,
    onFrame,
    onSteps,
    setMode
  };
}
