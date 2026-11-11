/**
 * Airport Navigator: voice-driven route guidance on an indoor venue graph.
 *
 *  - resolves spoken destinations ("Take me to Gate B12", "nearest washroom") to a node on the
 *    venue's route graph and builds a spoken route summary
 *  - drives IndoorNavigationEngine from live step events (countdowns, segment transitions,
 *    escalator hand-off)
 *  - verifies expected route signs seen by YOLO/OCR, correcting step drift
 *  - pauses guidance while a focal-zone hazard is present and resumes when it clears
 *  - answers mid-route voice commands (where am I, washroom on the way, repeat, stop)
 *
 * Pure logic (no DOM, injected clock) so the whole flow is unit-testable in Node.
 */

import { IndoorNavigationEngine } from './indoorNavigationEngine.js';
import { extractTargetAmenity } from './voiceEngine.js';
import { calculateStringSimilarity } from './landmarkEngine.js';

// ---------------------------------------------------------------------------------------------
// Venue graph helpers
// ---------------------------------------------------------------------------------------------

/** NODE_CENTRAL_ROTUNDA_L2 -> "the central rotunda" */
export function nodeDisplayName(nodeId) {
  const core = String(nodeId || '').replace(/^NODE_/, '').replace(/_L\d+$/, '');
  let m;
  if ((m = core.match(/GATE_([A-Z]\d+)/))) return `Gate ${m[1]}`;
  if ((m = core.match(/SEC_CHECKPOINT_([A-Z])/))) return `security checkpoint ${m[1]}`;
  if ((m = core.match(/ESCALATOR_BANK_([A-Z])_LANDING/))) return `the top of escalator bank ${m[1]}`;
  if ((m = core.match(/ESCALATOR_BANK_([A-Z])/))) return `escalator bank ${m[1]}`;
  if (/RESTROOM/.test(core)) return 'the restrooms';
  if (/ROTUNDA/.test(core)) return 'the central rotunda';
  return 'the ' + core.toLowerCase().replace(/_/g, ' ');
}

const levelOf = (nodeId) => Number((String(nodeId).match(/_L(\d+)$/) || [])[1] || 0);

const CATEGORY_PATTERNS = {
  washroom: /restroom|toilet|washroom|bathroom|lavatory/i,
  cafe: /starbucks|coffee|cafe/i,
  shop: /hudson news|newsstand|\bshop\b|duty free/i,
  information: /information/i,
  escalator: /escalator/i,
  elevator: /elevator|lift/i
};

const CATEGORY_SPOKEN = {
  washroom: 'restrooms', cafe: 'a café', shop: 'a shop', information: 'an information counter',
  escalator: 'an escalator', elevator: 'an elevator'
};

/** Categories present at (or along the approach to) a segment's destination node. */
export function segmentCategories(segment) {
  const text = [segment.to_node, ...(segment.expected_verification_landmarks || [])].join(' ');
  return Object.keys(CATEGORY_PATTERNS).filter(c => CATEGORY_PATTERNS[c].test(text));
}

function gateCodeOf(segment) {
  const m = String(segment.to_node).match(/GATE_([A-Z]\d+)/);
  return m ? m[1] : null;
}

/**
 * Turn a spoken request into a destination on the venue graph.
 * @returns {{status:'FOUND', endIndex, name, kind} | {status:'IN_VENUE', venueName} | {status:'NOT_FOUND', target} | {status:'NO_TARGET'}}
 */
export function resolveDestination(graph, speech) {
  const target = extractTargetAmenity(speech);
  const spoken = String(speech || '').toLowerCase();
  const segments = graph.route_path || [];
  if (!target || target.length < 2) return { status: 'NO_TARGET' };

  // Gate codes: "gate b12", "gate b 12"
  const gate = spoken.match(/\bgate\s*([a-z])\s*-?\s*(\d{1,3})\b/i);
  if (gate) {
    const code = (gate[1] + gate[2]).toUpperCase();
    const idx = segments.findIndex(s => gateCodeOf(s) === code);
    if (idx >= 0) return { status: 'FOUND', endIndex: idx, name: `Gate ${code}`, kind: 'gate' };
    return { status: 'NOT_FOUND', target: `Gate ${code}` };
  }

  // Terminal: we're navigating inside a single terminal's graph
  const terminal = spoken.match(/\bterminal\s*(\d+|one|two|three)\b/i);
  if (terminal) {
    const words = { one: '1', two: '2', three: '3' };
    const n = words[terminal[1].toLowerCase()] || terminal[1];
    const inThisTerminal = new RegExp(`TERMINAL_${n}\\b`).test(graph.venue_id || '');
    return inThisTerminal ? { status: 'IN_VENUE', venueName: `Terminal ${n}` } : { status: 'NOT_FOUND', target: `Terminal ${n}` };
  }

  // Amenity categories: first match along the route is the nearest
  const category = Object.keys(CATEGORY_PATTERNS).find(c => c === target || CATEGORY_PATTERNS[c].test(target));
  if (category) {
    const idx = segments.findIndex(s => segmentCategories(s).includes(category));
    if (idx >= 0) return { status: 'FOUND', endIndex: idx, name: nodeDisplayName(segments[idx].to_node), kind: category };
    return { status: 'NOT_FOUND', target };
  }

  // Fuzzy: node names and landmark text
  let best = { score: 0, idx: -1 };
  segments.forEach((s, idx) => {
    for (const cand of [nodeDisplayName(s.to_node), ...(s.expected_verification_landmarks || [])]) {
      const score = calculateStringSimilarity(cand.replace(/^the /, ''), target);
      if (score > best.score) best = { score, idx };
    }
  });
  if (best.score >= 0.8) return { status: 'FOUND', endIndex: best.idx, name: nodeDisplayName(segments[best.idx].to_node), kind: 'place' };
  return { status: 'NOT_FOUND', target };
}

function actionFor(segment) {
  switch (segment.heading_relative_deg) {
    case 90: return 'Turn right, then walk';
    case 270: return 'Turn left, then walk';
    case 180: return 'Turn around, then walk';
    default: return 'Walk straight';
  }
}

/** Spoken guidance for one segment. */
export function segmentInstruction(segment) {
  const n = segment.distance_steps;
  if (segment.requires_level_change && segment.level_change_type !== 'NONE') {
    const kind = segment.level_change_type.toLowerCase();
    const dir = levelOf(segment.to_node) > levelOf(segment.from_node) ? 'up' : 'down';
    return `${actionFor(segment)} ${n} steps to the ${kind} and ride it ${dir}. Hold the handrail.`;
  }
  return `${actionFor(segment)} ${n} steps toward ${nodeDisplayName(segment.to_node)}.`;
}

/** "Route to Gate B12: about 152 steps, 1 escalator. Walk straight 36 steps toward the central rotunda." */
export function buildRouteSummary(segments, destinationName) {
  const total = segments.reduce((sum, s) => sum + s.distance_steps, 0);
  const changes = {};
  segments.forEach(s => {
    if (s.requires_level_change && s.level_change_type !== 'NONE') {
      const k = s.level_change_type.toLowerCase();
      changes[k] = (changes[k] || 0) + 1;
    }
  });
  const changeText = Object.entries(changes).map(([k, c]) => `, ${c} ${k}${c > 1 ? 's' : ''}`).join('');
  return `Route to ${destinationName}: about ${total} steps${changeText}. ${segmentInstruction(segments[0])}`;
}

// ---------------------------------------------------------------------------------------------
// Sign matching
// ---------------------------------------------------------------------------------------------

/** "Overhead Sign: Gates B1-B14 & Lounges Up" -> "Gates B1 to B14" */
export function cleanLandmarkName(landmark) {
  return String(landmark)
    .replace(/^[\w\s-]*?(sign|screen|display)\s*:\s*/i, '')
    .replace(/\bISO 7001 \w+ \w+ \d+\s*/i, '')
    .split(/\s+&\s+|\s+-\s+/)[0]
    .replace(/\b([A-Z]\d+)-([A-Z]\d+)\b/g, '$1 to $2')
    .trim();
}

function isSignLandmark(landmark) {
  return /sign|screen|display/i.test(landmark);
}

const normalizeForMatch = (s) => String(s || '').toLowerCase()
  .replace(/^[\w\s-]*?(sign|screen|display)\s*:\s*/, '')
  .replace(/\biso 7001 \w+ \w+ \d+\b/, '')
  .replace(/\b(storefront|logo|pictogram|symbol|icon|illuminated|high-contrast|overhead)\b/g, '')
  .replace(/[^a-z0-9 -]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Does a detected string (OCR text / YOLO label) match an expected route landmark? */
export function landmarkMatches(detected, expected) {
  const d = normalizeForMatch(String(detected).replace(/_/g, ' '));
  const e = normalizeForMatch(expected);
  if (d.length < 3 || !e) return false;
  // Gate/range codes must match exactly: "B1-B14" must not match "B12"
  const codes = e.match(/\b[a-z]\d+\b/g) || [];
  if (codes.length && !codes.every(c => new RegExp(`\\b${c}\\b`).test(d))) return false;
  if (codes.length) return true;
  return calculateStringSimilarity(d, e) >= 0.75;
}

// Steps left in the segment implied by how close the sign looks
const STEPS_LEFT_BY_PROXIMITY = { IMMEDIATE: 1, CLOSE: 3, FAR: 7 };

// ---------------------------------------------------------------------------------------------
// Voice commands
// ---------------------------------------------------------------------------------------------

export function classifyCommand(text) {
  const t = String(text || '').toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return { type: 'EMPTY' };
  if (/\b(stop|cancel|end|pause) (the )?(navigation|navigating|route|guidance|guiding)\b|^stop$/.test(t)) return { type: 'STOP' };
  if (/\b(where am i|how far|how much (further|farther|longer)|how many (more )?steps|am i close)\b/.test(t)) return { type: 'WHERE_AM_I' };
  if (/\b(is there|are there|any)\b.*\b(washroom|restroom|toilet|bathroom|lavatory|cafe|coffee|starbucks|shop|store|information|help desk)\b/.test(t)) {
    const cat = Object.keys(CATEGORY_PATTERNS).find(c => CATEGORY_PATTERNS[c].test(t)) ||
      (/coffee|starbucks/.test(t) ? 'cafe' : /store/.test(t) ? 'shop' : /help desk/.test(t) ? 'information' : 'washroom');
    return { type: 'AMENITY_ON_ROUTE', category: cat };
  }
  if (/^(please )?(repeat|say (that|it) again|come again|pardon|what did you say|again)\b/.test(t)) return { type: 'REPEAT' };
  if (/\b(i'?m|i am) (off|at the top|at the bottom|done)\b|\boff the (escalator|elevator)\b|\breached the (top|bottom)\b|^(resume|continue)( navigation)?\b/.test(t)) return { type: 'CONTINUE' };
  if (/\b(take me|go to|guide me|navigate|find|where is|where's|how do i get|gate|terminal|washroom|restroom|toilet|bathroom|cafe|coffee)\b/.test(t)) return { type: 'NAVIGATE', text };
  return { type: 'UNKNOWN' };
}

// ---------------------------------------------------------------------------------------------
// Navigator state machine
// ---------------------------------------------------------------------------------------------

export const NAV_STATE = {
  IDLE: 'IDLE',                       // no route; waiting for a destination
  NAVIGATING: 'NAVIGATING',
  AWAITING_LEVEL_CHANGE: 'AWAITING_LEVEL_CHANGE',
  PAUSED_HAZARD: 'PAUSED_HAZARD',
  ARRIVING: 'ARRIVING',               // step count says we're there; waiting to see the sign
  ARRIVED: 'ARRIVED',
  STANDBY: 'STANDBY'                  // user said "stop navigation"; route kept for "resume"
};

const HAZARD_CLEAR_FRAMES = 2;

export class AirportNavigator {
  constructor(graph, { strideMeters = 0.7 } = {}) {
    this.graph = graph;
    this.engine = new IndoorNavigationEngine(strideMeters);
    this.state = NAV_STATE.IDLE;
    this.destination = null;
    this.lastGuidance = null;
    this.verifiedSegments = new Set();
    this.announcedLandmarks = new Set();
    this.usedSignStrings = new Set();
    this.stateBeforeHazard = null;
    this.clearFrames = 0;
    this.lastCountdownAnnounced = null;
    this.lastDriftCorrection = null;
  }

  get route() {
    return this.engine.getActiveGraph()?.route_path || [];
  }

  isActive() {
    return [NAV_STATE.NAVIGATING, NAV_STATE.AWAITING_LEVEL_CHANGE, NAV_STATE.PAUSED_HAZARD, NAV_STATE.ARRIVING].includes(this.state);
  }

  startLocationName() {
    return nodeDisplayName(this.graph.start_anchor_node?.node_id || this.graph.route_path?.[0]?.from_node);
  }

  // ---- destination & route ------------------------------------------------------------------

  /** @returns {string} what to say */
  startRoute(speech) {
    const res = resolveDestination(this.graph, speech);
    if (res.status === 'FOUND') {
      const segments = this.graph.route_path.slice(0, res.endIndex + 1);
      this.engine.loadGraph({ ...this.graph, route_path: segments });
      this.destination = res;
      this.state = NAV_STATE.NAVIGATING;
      this.verifiedSegments = new Set();
      this.announcedLandmarks = new Set();
      this.usedSignStrings = new Set();
      this.lastCountdownAnnounced = null;
      return this.setGuidance(buildRouteSummary(segments, res.name));
    }
    if (res.status === 'IN_VENUE') {
      return `You are already in ${res.venueName}, at ${this.startLocationName()}. Which gate would you like to go to?`;
    }
    if (res.status === 'NOT_FOUND') {
      const gates = this.graph.route_path.map(gateCodeOf).filter(Boolean).map(g => `Gate ${g}`);
      const options = [...gates, 'the restrooms', 'the escalators'].slice(0, 3).join(', ');
      return `I don't have a route to ${res.target} on this terminal map. I can guide you to ${options}.`;
    }
    return "I didn't quite capture that. Where would you like to go?";
  }

  setGuidance(text) {
    this.lastGuidance = text;
    return text;
  }

  currentSegment() {
    return this.engine.getCurrentSegment();
  }

  remainingInSegment() {
    const seg = this.currentSegment();
    return seg ? Math.max(0, seg.distance_steps - this.engine.getAccumulatedSteps()) : 0;
  }

  remainingTotalSteps() {
    const idx = this.engine.getCurrentSegmentIndex();
    return this.remainingInSegment() + this.route.slice(idx + 1).reduce((s, x) => s + x.distance_steps, 0);
  }

  // ---- steps --------------------------------------------------------------------------------

  /** Live step events. Returns announcements: [{ text, priority: 'NORMAL' | 'LOW' }] */
  onSteps(count = 1) {
    const out = [];
    for (let i = 0; i < count; i++) {
      // Steps still count during a hazard pause (the user may keep walking); only speech is held.
      if (![NAV_STATE.NAVIGATING, NAV_STATE.PAUSED_HAZARD].includes(this.state)) break;
      const idxBefore = this.engine.getCurrentSegmentIndex();
      const res = this.engine.processStep(1);
      const paused = this.state === NAV_STATE.PAUSED_HAZARD;

      if (res.isComplete) {
        this.state = NAV_STATE.ARRIVING;
        out.push({ text: this.setGuidance(`${this.destination.name} should be close; please scan around slowly with your camera.`), priority: 'NORMAL' });
        break;
      }
      if (this.engine.isWaitingForElevation()) {
        if (!paused) this.state = NAV_STATE.AWAITING_LEVEL_CHANGE;
        const seg = this.currentSegment();
        const kind = seg.level_change_type.toLowerCase();
        out.push({ text: this.setGuidance(`You've reached the ${kind}. Step on, hold the handrail, and ride it. Say "I'm off the ${kind}" when you get off.`), priority: 'NORMAL' });
        break;
      }
      if (this.engine.getCurrentSegmentIndex() !== idxBefore) {
        this.lastCountdownAnnounced = null;
        out.push({ text: this.setGuidance(segmentInstruction(this.currentSegment())), priority: 'NORMAL' });
        continue;
      }
      const left = res.remainingSteps;
      if ((left === 10 || left === 5) && this.lastCountdownAnnounced !== left) {
        this.lastCountdownAnnounced = left;
        out.push({ text: `${left} more steps to ${nodeDisplayName(this.currentSegment().to_node)}.`, priority: 'LOW' });
      }
    }
    if (this.state === NAV_STATE.PAUSED_HAZARD) return []; // hold guidance until the hazard clears
    // Only the latest of each kind matters when several steps arrive at once
    const important = out.filter(a => a.priority === 'NORMAL');
    return important.length ? [important[important.length - 1]] : out.slice(-1);
  }

  /** Escalator/elevator finished (voice "I'm off the escalator" or the next sign was seen). */
  completeLevelChange() {
    if (this.state !== NAV_STATE.AWAITING_LEVEL_CHANGE) return null;
    this.engine.handleElevationComplete();
    this.lastCountdownAnnounced = null;
    if (this.engine.isRouteCompleted()) {
      this.state = NAV_STATE.ARRIVING;
      return this.setGuidance(`${this.destination.name} should be close; please scan around slowly with your camera.`);
    }
    this.state = NAV_STATE.NAVIGATING;
    return this.setGuidance(segmentInstruction(this.currentSegment()));
  }

  // ---- camera frames ------------------------------------------------------------------------

  /**
   * @param {object} frame { priorityHazard: object|null, detections: analyzed detections from visionAnalysis }
   * @returns {{ announcements: Array<{text, priority}>, verifiedLandmark: string|null }}
   */
  onFrame({ priorityHazard = null, detections = [] } = {}) {
    const result = { announcements: [], verifiedLandmark: null };
    if (!this.isActive()) return result;

    // Hazard pause / resume
    if (priorityHazard) {
      if (this.state !== NAV_STATE.PAUSED_HAZARD) {
        this.stateBeforeHazard = this.state;
        this.state = NAV_STATE.PAUSED_HAZARD;
      }
      this.clearFrames = 0;
      return result; // the hazard alert itself is spoken by the hazard override
    }
    if (this.state === NAV_STATE.PAUSED_HAZARD) {
      this.clearFrames++;
      if (this.clearFrames < HAZARD_CLEAR_FRAMES) return result;
      this.state = this.stateBeforeHazard || NAV_STATE.NAVIGATING;
      if (this.state === NAV_STATE.NAVIGATING && this.engine.isWaitingForElevation()) this.state = NAV_STATE.AWAITING_LEVEL_CHANGE;
      result.announcements.push({ text: `Path clear. ${this.progressSentence()}`, priority: 'NORMAL' });
    }

    const match = this.findRouteSign(detections);
    if (match) {
      const ann = this.applySignMatch(match);
      if (ann) {
        result.announcements.push({ text: ann, priority: 'NORMAL' });
        result.verifiedLandmark = match.landmark;
      }
    }
    return result;
  }

  findRouteSign(detections) {
    // After the step count runs out the engine index points past the end; keep checking the last segment
    const idx = Math.min(this.engine.getCurrentSegmentIndex(), this.route.length - 1);
    const candidates = [idx, idx + 1].filter(i => i < this.route.length && !this.verifiedSegments.has(i));
    for (const segIdx of candidates) {
      for (const landmark of this.route[segIdx].expected_verification_landmarks || []) {
        for (const det of detections) {
          for (const str of [det.signText, ...(det.signAliases || []), det.displayName, det.label]) {
            if (!str || this.usedSignStrings.has(normalizeForMatch(str))) continue;
            if (landmarkMatches(str, landmark)) return { segIdx, landmark, det, str };
          }
        }
      }
    }
    return null;
  }

  /** Strict arrival: for a gate, the camera must have read the gate code itself (e.g. "Gate B12"). */
  confirmsDestination(det, landmark) {
    if (this.destination.kind !== 'gate') return true;
    const code = this.destination.name.replace(/^Gate /, '');
    const codeRe = new RegExp(`\\b${code[0]}\\s*-?\\s*${code.slice(1)}\\b`, 'i');
    return [det.signText, det.displayName, det.label].some(s => s && codeRe.test(String(s).replace(/_/g, ' '))) && /gate/i.test(landmark);
  }

  applySignMatch({ segIdx, landmark, det, str }) {
    const idx = this.engine.getCurrentSegmentIndex();
    const isFinal = segIdx === this.route.length - 1;
    const signName = cleanLandmarkName(landmark) + (isSignLandmark(landmark) && !/sign$/i.test(cleanLandmarkName(landmark)) ? ' sign' : '');
    const where = det.proximity ? `${det.proximity.spoken} ${det.zonePhrase}` : 'ahead';

    if (isFinal && this.confirmsDestination(det, landmark)) {
      this.verifiedSegments.add(segIdx);
      this.state = NAV_STATE.ARRIVED;
      const side = { LEFT: 'on your left', RIGHT: 'on your right', CENTER: 'straight ahead' }[det.zone] || 'ahead';
      return this.setGuidance(`${this.destination.name} confirmed ${side}. You have arrived.`);
    }
    // Final segment stays open until the destination itself is read; other signs on it
    // still correct drift but are announced only once.
    if (!isFinal) this.verifiedSegments.add(segIdx);
    // The same physical sign text can be listed on consecutive segments (e.g. "Gates B1-B14");
    // once it has verified one segment it must not advance another.
    this.usedSignStrings.add(normalizeForMatch(str));
    if (this.announcedLandmarks.has(landmark)) return null;
    this.announcedLandmarks.add(landmark);

    // Seeing the next segment's sign while on an escalator means the ride is over
    if (this.state === NAV_STATE.AWAITING_LEVEL_CHANGE && segIdx === idx + 1) {
      this.engine.handleElevationComplete();
      this.state = NAV_STATE.NAVIGATING;
    }

    // Drift reset: the sign sits near the end of its segment, so re-anchor there
    const seg = this.route[segIdx];
    const stepsLeft = STEPS_LEFT_BY_PROXIMITY[det.proximity?.key] ?? 3;
    const before = this.remainingTotalSteps();
    if (this.state === NAV_STATE.NAVIGATING) {
      this.engine.setPosition(segIdx, seg.distance_steps - stepsLeft);
      this.lastCountdownAnnounced = null;
    }
    this.lastDriftCorrection = { landmark, stepsCorrected: Math.abs(before - this.remainingTotalSteps()) };
    return `Approaching ${signName}, ${where}.`;
  }

  // ---- voice commands -----------------------------------------------------------------------

  progressSentence() {
    if (this.state === NAV_STATE.AWAITING_LEVEL_CHANGE) {
      const seg = this.currentSegment();
      return `You are on the ${seg.level_change_type.toLowerCase()}. Tell me when you get off.`;
    }
    const idx = this.engine.getCurrentSegmentIndex();
    const seg = this.currentSegment();
    if (!seg) return `You should be at ${this.destination.name}.`;
    const total = this.remainingTotalSteps();
    const left = this.remainingInSegment();
    const tail = total > left ? ` ${total} steps to ${this.destination.name} in total.` : '';
    return `You are on segment ${idx + 1} of ${this.route.length}. ${left} steps remaining to ${nodeDisplayName(seg.to_node)}.${tail}`;
  }

  amenityOnRoute(category) {
    const label = CATEGORY_SPOKEN[category] || category;
    const idx = this.isActive() ? this.engine.getCurrentSegmentIndex() : 0;
    const path = this.isActive() ? this.route : this.graph.route_path;
    let stepsAhead = this.isActive() ? this.remainingInSegment() : 0;
    for (let i = idx; i < path.length; i++) {
      if (i > idx || !this.isActive()) stepsAhead += i === idx && this.isActive() ? 0 : path[i].distance_steps;
      if (segmentCategories(path[i]).includes(category)) {
        const after = path.slice(idx, i).some(s => s.requires_level_change && s.level_change_type !== 'NONE')
          ? `, after the ${path.slice(idx, i).find(s => s.requires_level_change).level_change_type.toLowerCase()}` : '';
        return `Yes. There ${category === 'washroom' ? 'are' : 'is'} ${label} at ${nodeDisplayName(path[i].to_node)}, about ${stepsAhead} steps ahead${after}.`;
      }
    }
    const anywhere = this.graph.route_path.findIndex(s => segmentCategories(s).includes(category));
    if (anywhere >= 0) {
      return `There ${category === 'washroom' ? 'are' : 'is'} no ${label} on your route. The nearest is at ${nodeDisplayName(this.graph.route_path[anywhere].to_node)}. Say "take me to the ${category}" to go there.`;
    }
    return `I don't see ${label} on this terminal map.`;
  }

  /**
   * Handle one recognized utterance. Never resets an active route on noise.
   * @returns {string|null} reply to speak (null = say nothing, keep listening)
   */
  handleUtterance(text) {
    const cmd = classifyCommand(text);
    const active = this.isActive();
    switch (cmd.type) {
      case 'EMPTY':
        return null; // silence mid-walk is normal
      case 'STOP':
        if (active) {
          this.state = NAV_STATE.STANDBY;
          return 'Navigation paused. Say "resume" to continue, or tell me a new destination.';
        }
        return null;
      case 'WHERE_AM_I':
        if (active || this.state === NAV_STATE.STANDBY) return this.progressSentence();
        if (this.state === NAV_STATE.ARRIVED) return `You are at ${this.destination.name}.`;
        return `You are at ${this.startLocationName()}. Where would you like to go?`;
      case 'AMENITY_ON_ROUTE':
        return this.amenityOnRoute(cmd.category);
      case 'REPEAT':
        return this.lastGuidance || 'There is no guidance yet. Where would you like to go?';
      case 'CONTINUE':
        if (this.state === NAV_STATE.AWAITING_LEVEL_CHANGE) return this.completeLevelChange();
        if (this.state === NAV_STATE.STANDBY) {
          this.state = this.engine.isWaitingForElevation() ? NAV_STATE.AWAITING_LEVEL_CHANGE : NAV_STATE.NAVIGATING;
          return `Resuming. ${this.progressSentence()}`;
        }
        return active ? this.progressSentence() : null;
      case 'NAVIGATE': {
        const res = resolveDestination(this.graph, cmd.text);
        if (res.status === 'NO_TARGET') break;
        return this.startRoute(cmd.text);
      }
      default:
        break;
    }
    return active
      ? "I didn't quite capture that. You can say where am I, repeat, or stop navigation."
      : "I didn't quite capture that. Where would you like to go?";
  }
}
