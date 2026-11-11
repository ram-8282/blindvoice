import { NavigationModeController, StepDetector } from './navigationModeController.js';

let passed = 0, total = 0;
function check(name, cond, detail = '') {
  total++;
  if (cond) passed++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ` (${detail})` : ''}`);
}

console.log('=================================================');
console.log('NAVIGATION MODE CONTROLLER TESTS');
console.log('=================================================');

let t = 0;
const nav = new NavigationModeController({ now: () => t, stepLengthM: 0.7 });

check('starts in DEAD_RECKONING with no GPS', nav.getMode().key === 'DEAD_RECKONING');

nav.updateGps({ lat: 17.38504, lon: 78.48667, accuracy: 8 });
check('accurate fix (8 m) -> GPS', nav.getMode().key === 'GPS');
check('badge text is GPS ONLINE', nav.getStatus().badge === 'GPS ONLINE');

t += 3000;
nav.updateGps({ lat: 17.38504, lon: 78.48667, accuracy: 40 });
check('degraded fix (40 m) keeps GPS until stale', nav.getMode().key === 'GPS');
t += 11000;
check('no good fix for >10 s -> DEAD_RECKONING', nav.getMode().key === 'DEAD_RECKONING');
check('badge text is INDOOR DEAD RECKONING', nav.getStatus().badge === 'INDOOR DEAD RECKONING');

nav.addSteps(20);
check('dead reckoning tracks 20 steps = 14 m', nav.getStatus().distanceSinceAnchorM === 14, String(nav.getStatus().distanceSinceAnchorM));

nav.confirmVisualMatch('Gate B12');
check('landmark match -> VISUAL_MATCH', nav.getMode().key === 'VISUAL_MATCH');
check('badge text is VISUAL MATCH CONFIRMED', nav.getStatus().badge === 'VISUAL MATCH CONFIRMED');
check('drift of 14 m recorded as correction', nav.lastCorrection.driftMeters === 14);
check('step counter re-anchored to 0', nav.getStatus().stepsSinceAnchor === 0);

t += 7000;
check('visual hold expires -> back to DEAD_RECKONING', nav.getMode().key === 'DEAD_RECKONING');
check('anchor is now the landmark', /since Gate B12/.test(nav.getStatus().detail), nav.getStatus().detail);

nav.updateGps({ lat: 17.38504, lon: 78.48667, accuracy: 12 });
check('GPS recovers outdoors -> GPS', nav.getMode().key === 'GPS');

// Step detector: simulated walking at ~2 steps/s (peaks of 12.5 m/s^2 over a 9.8 baseline)
const sd = new StepDetector();
let steps = 0;
for (let ms = 0; ms < 5000; ms += 20) {
  const phase = (ms % 500) / 500;
  const mag = 9.8 + (phase < 0.15 ? 2.7 : 0);
  if (sd.push(0, 0, mag, ms)) steps++;
}
check('detects 10 steps in 5 s of walking', steps === 10, `got ${steps}`);

const still = new StepDetector();
let falseSteps = 0;
for (let ms = 0; ms < 5000; ms += 20) if (still.push(0.1, 0.1, 9.8 + Math.sin(ms) * 0.2, ms)) falseSteps++;
check('no steps while standing still', falseSteps === 0, `got ${falseSteps}`);

console.log('\n=================================================');
console.log(`TEST SUMMARY: ${passed}/${total} tests passed.`);
console.log('=================================================');
if (passed !== total) process.exit(1);
