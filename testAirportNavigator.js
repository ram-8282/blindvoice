import { readFileSync } from 'fs';
import {
  AirportNavigator, NAV_STATE, resolveDestination, buildRouteSummary, classifyCommand,
  landmarkMatches, cleanLandmarkName, nodeDisplayName
} from './airportNavigator.js';
import { analyzeDetections } from './visionAnalysis.js';

const graph = JSON.parse(readFileSync(new URL('./src/assets/graphs/sfo_terminal_2.json', import.meta.url)));

let passed = 0, total = 0;
function check(name, cond, detail = '') {
  total++;
  if (cond) passed++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ` (${detail})` : ''}`);
}

// Build an analyzed detection (as the camera pipeline would) for a sign at a screen position
const W = 1280, H = 720;
function seen(label, { signText = null, cx = 0.8, size = 0.25, score = 0.9 } = {}) {
  const [d] = analyzeDetections([{ label, score, x: (cx - size / 2) * W, y: 0.3 * H, w: size * W, h: size * H }], W, H);
  return { ...d, signText };
}

console.log('=================================================');
console.log('AIRPORT NAVIGATOR TESTS');
console.log('=================================================');

// --- Destination parsing --------------------------------------------------------------------
check('node name: rotunda', nodeDisplayName('NODE_CENTRAL_ROTUNDA_L2') === 'the central rotunda');
check('"Take me to Gate B12" -> gate segment 4', resolveDestination(graph, 'Take me to Gate B12').endIndex === 4);
check('"gate b 12" spoken with a space still resolves', resolveDestination(graph, 'go to gate b 12').name === 'Gate B12');
const wc = resolveDestination(graph, 'Find the nearest washroom');
check('"nearest washroom" -> restrooms (segment 3)', wc.status === 'FOUND' && wc.endIndex === 3, JSON.stringify(wc));
check('"Guide me to Terminal 2" -> already in venue', resolveDestination(graph, 'Guide me to Terminal 2').status === 'IN_VENUE');
check('"Gate C40" -> not on map', resolveDestination(graph, 'take me to gate C40').status === 'NOT_FOUND');

const summary = buildRouteSummary(graph.route_path, 'Gate B12');
check('route summary format', summary === 'Route to Gate B12: about 152 steps, 1 escalator. Walk straight 36 steps toward the central rotunda.', summary);

// --- Command classification -----------------------------------------------------------------
check('"Where am I?" -> WHERE_AM_I', classifyCommand('Where am I?').type === 'WHERE_AM_I');
check('"How far?" -> WHERE_AM_I', classifyCommand('how far').type === 'WHERE_AM_I');
check('"Is there a washroom on the way?" -> AMENITY', classifyCommand('Is there a washroom on the way?').category === 'washroom');
check('"Repeat" -> REPEAT', classifyCommand('Repeat.').type === 'REPEAT');
check('"Stop navigation" -> STOP', classifyCommand('stop navigation').type === 'STOP');
check('"I\'m off the escalator" -> CONTINUE', classifyCommand("I'm off the escalator").type === 'CONTINUE');
check('"find the nearest washroom" is a destination, not a question', classifyCommand('find the nearest washroom').type === 'NAVIGATE');
check('background noise -> UNKNOWN', classifyCommand('uh the uh hmm').type === 'UNKNOWN');

// --- Sign matching --------------------------------------------------------------------------
const b1b14 = 'Overhead Sign: Gates B1-B14 & Lounges Up';
check('OCR "GATES B1-B14" matches overhead sign', landmarkMatches('GATES B1-B14', b1b14));
check('"Gate B12" does NOT match the B1-B14 sign', !landmarkMatches('Gate B12', b1b14));
check('clean sign name reads naturally', cleanLandmarkName(b1b14) === 'Gates B1 to B14', cleanLandmarkName(b1b14));

// --- Full walk ------------------------------------------------------------------------------
const nav = new AirportNavigator(graph);
check('idle "where am I" names the start', /security checkpoint B/.test(nav.handleUtterance('where am I')));
const start = nav.handleUtterance('Take me to Gate B12');
check('starting a route speaks the summary', start.startsWith('Route to Gate B12: about 152 steps, 1 escalator.'), start);
check('state NAVIGATING', nav.state === NAV_STATE.NAVIGATING);

let ann = nav.onSteps(26);
check('countdown at 10 steps left', ann[0]?.text === '10 more steps to the central rotunda.', ann[0]?.text);
ann = nav.onSteps(10);
check('segment transition announces the turn', ann[0]?.text === 'Turn left, then walk 24 steps toward escalator bank B.', ann[0]?.text);

nav.onSteps(4);
const where = nav.handleUtterance('Where am I?');
check('"where am I" mid-route', where === 'You are on segment 2 of 5. 20 steps remaining to escalator bank B. 112 steps to Gate B12 in total.', where);
check('"repeat" re-announces last guidance', nav.handleUtterance('repeat') === 'Turn left, then walk 24 steps toward escalator bank B.');
const washroom = nav.handleUtterance('Is there a washroom on the way?');
check('washroom on the way answer', /^Yes\. There are restrooms at the restrooms, about \d+ steps ahead, after the escalator\.$/.test(washroom), washroom);
check('noise re-prompts without resetting', /didn't quite capture/.test(nav.handleUtterance('blah blah')) && nav.state === NAV_STATE.NAVIGATING);
check('silence says nothing', nav.handleUtterance('') === null);

// Early sign -> drift reset (camera sees the B1-B14 sign while step count says 20 left)
let frame = nav.onFrame({ detections: [seen('sign', { signText: 'Gates B1-B14', cx: 0.15 })] });
check('early sign spoken with spatial context', frame.announcements[0]?.text === 'Approaching Gates B1 to B14 sign, 2 meters ahead on your left.', frame.announcements[0]?.text);
check('drift corrected: 3 steps left in segment', nav.remainingInSegment() === 3, String(nav.remainingInSegment()));
check('verified landmark reported for re-anchoring', frame.verifiedLandmark === b1b14);
check('same sign is not announced twice', nav.onFrame({ detections: [seen('sign', { signText: 'Gates B1-B14' })] }).announcements.length === 0);

// Hazard pauses guidance, then resumes
const hazard = { detection: {}, alert: 'Caution: Wet floor sign detected directly ahead.' };
nav.onFrame({ priorityHazard: hazard, detections: [] });
check('hazard pauses navigation', nav.state === NAV_STATE.PAUSED_HAZARD);
check('no step guidance while paused', nav.onSteps(3).length === 0);
nav.onFrame({ detections: [] });
frame = nav.onFrame({ detections: [] });
check('resumes after hazard clears', /^Path clear\./.test(frame.announcements[0]?.text || ''), frame.announcements[0]?.text);
check('steps walked during the pause still counted (now on segment 3)', /segment 3 of 5\. 18 steps remaining to the top of escalator bank B/.test(frame.announcements[0]?.text || ''));

// Escalator approach: 18 steps, then wait for the ride
ann = nav.onSteps(18);
check('reaching the escalator gives ride instructions', /^You've reached the escalator\./.test(ann[0]?.text || ''), ann[0]?.text);
check('state AWAITING_LEVEL_CHANGE', nav.state === NAV_STATE.AWAITING_LEVEL_CHANGE, nav.state);
check('steps on the escalator are ignored', nav.onSteps(10).length === 0);
const offEsc = nav.handleUtterance("I'm off the escalator");
check('"I\'m off the escalator" continues to next segment', offEsc === 'Turn right, then walk 32 steps toward the restrooms.', offEsc);

// Stop / resume keeps the route
check('stop navigation -> standby', /Navigation paused/.test(nav.handleUtterance('stop navigation')) && nav.state === NAV_STATE.STANDBY);
check('steps ignored in standby', nav.onSteps(5).length === 0);
check('resume restores progress', /^Resuming\. You are on segment 4 of 5\./.test(nav.handleUtterance('resume')));

// Walk to the end without seeing the gate
nav.onSteps(32);
ann = nav.onSteps(42);
check('step count reached -> scan prompt, not arrival', ann[0]?.text === 'Gate B12 should be close; please scan around slowly with your camera.', ann[0]?.text);
check('state ARRIVING (not ARRIVED)', nav.state === NAV_STATE.ARRIVING);

// Aircraft pictogram / unrelated text must not count as arrival
nav.onFrame({ detections: [seen('sign', { signText: 'Gate B14' })] });
check('wrong gate text does not confirm arrival', nav.state === NAV_STATE.ARRIVING);

frame = nav.onFrame({ detections: [seen('sign', { signText: 'GATE B12', cx: 0.85 })] });
check('reading "Gate B12" confirms arrival', frame.announcements[0]?.text === 'Gate B12 confirmed on your right. You have arrived.', frame.announcements[0]?.text);
check('state ARRIVED', nav.state === NAV_STATE.ARRIVED);

console.log('\n=================================================');
console.log(`TEST SUMMARY: ${passed}/${total} tests passed.`);
console.log('=================================================');
if (passed !== total) process.exit(1);
