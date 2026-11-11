import {
  getHorizontalZone, isInFocalZone, estimateProximity, classifyHazard, isSignageLabel,
  extractSignText, analyzeDetections, findPriorityHazard, formatSignAnnouncement, humanizeLabel,
  extractSceneSignTexts
} from './visionAnalysis.js';

let passed = 0, total = 0;
function check(name, cond, detail = '') {
  total++;
  if (cond) passed++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ` (${detail})` : ''}`);
}

console.log('=================================================');
console.log('VISION ANALYSIS ENGINE TESTS');
console.log('=================================================');

const W = 1280, H = 720;
const box = (label, score, cxN, cyN, wN, hN) => ({ label, score, x: (cxN - wN / 2) * W, y: (cyN - hN / 2) * H, w: wN * W, h: hN * H });

// Spatial grid
check('x=0.10 -> LEFT', getHorizontalZone(0.10).key === 'LEFT');
check('x=0.50 -> CENTER', getHorizontalZone(0.50).key === 'CENTER');
check('x=0.90 -> RIGHT', getHorizontalZone(0.90).key === 'RIGHT');
check('LEFT phrase is "ahead on your left"', getHorizontalZone(0.1).phrase === 'ahead on your left');

// Focal zone (middle 60%)
check('center point is in focal zone', isInFocalZone(0.5, 0.5));
check('x=0.15 is outside focal zone', !isInFocalZone(0.15, 0.5));
check('y=0.85 is outside focal zone', !isInFocalZone(0.5, 0.85));

// Proximity
check('30% of frame -> IMMEDIATE', estimateProximity(0.6 * W, 0.5 * H, W, H).key === 'IMMEDIATE');
check('8% of frame -> CLOSE', estimateProximity(0.4 * W, 0.2 * H, W, H).key === 'CLOSE');
check('1% of frame -> FAR', estimateProximity(0.1 * W, 0.1 * H, W, H).key === 'FAR');

// Hazard classes (canonical + current-model aliases)
check('staircase is HIGH hazard', classifyHazard('staircase')?.level === 'HIGH');
check('stairs_sign maps to staircase', classifyHazard('stairs_sign')?.hazardClass === 'staircase');
check('road-cone maps to construction_barrier', classifyHazard('road-cone')?.hazardClass === 'construction_barrier');
check('wet_floor_sign is a hazard', classifyHazard('wet_floor_sign')?.hazardClass === 'wet_floor_sign');
check('clock is not a hazard', classifyHazard('clock') === null);
check('chair is a close-range obstacle', classifyHazard('chair')?.minProximity === 'IMMEDIATE');

// Signage
check('exit_sign is signage', isSignageLabel('exit_sign'));
check('room_number_plate is signage', isSignageLabel('room_number_plate'));
check('wet_floor_sign is hazard, not signage', !isSignageLabel('wet_floor_sign'));
check('bathroom_sign displays as Restroom sign', humanizeLabel('bathroom_sign') === 'Restroom sign');

// OCR text extraction
check('OCR "GATE B12" -> Gate B12', extractSignText('  GATE B12 \n', 'boarding_gate_sign')?.text === 'Gate B12');
check('OCR "Gate: 7" -> Gate 7', extractSignText('Gate: 7', 'sign')?.text === 'Gate 7');
check('OCR "ROOM 304" -> Room 304', extractSignText('ROOM 304', 'room_number_plate')?.text === 'Room 304');
check('room plate with only digits -> Room 304', extractSignText('304', 'room_number_plate')?.text === 'Room 304');
check('empty OCR on room_122b_sign falls back to label', extractSignText('', 'room_122b_sign')?.text === 'Room 122B');
check('garbage OCR returns null', extractSignText('|~ ;; ,', 'exit_sign') === null);

// Scene (overhead band) OCR parsing
const scene = extractSceneSignTexts('k Gates A B C D E F\n Airline Club - Delta  Quiet Seating Area  Restrooms\nGATES B1 - B14 ->');
check('scene OCR finds gate range and restrooms', scene.includes('Gates B1-B14') && scene.includes('Restrooms'), JSON.stringify(scene));
check('scene OCR ignores noise', extractSceneSignTexts('xq 7z ;; lorem').length === 0);
const letters = extractSceneSignTexts('GatesABDEE');
check('merged letter gates "GatesABDEE" -> Gate A..E', ['Gate A', 'Gate B', 'Gate D', 'Gate E'].every(g => letters.includes(g)) && letters.length === 4, JSON.stringify(letters));
check('"Gates A B C" spaced letters', extractSceneSignTexts('Gates A B C').join(',') === 'Gate A,Gate B,Gate C');
check('"Gates are open" is not read as gate letters', extractSceneSignTexts('Gates are open').length === 0);
check('"Gate B12" is not split into letters', JSON.stringify(extractSceneSignTexts('Gate B12')) === '["Gate B12"]', JSON.stringify(extractSceneSignTexts('Gate B12')));

// Frame analysis + priority hazard override
const frame = analyzeDetections([
  box('stairs', 0.82, 0.5, 0.55, 0.5, 0.5),        // HIGH, focal, immediate
  box('wet_floor_sign', 0.91, 0.45, 0.5, 0.2, 0.3), // LOW, focal
  box('bathroom_sign', 0.88, 0.15, 0.3, 0.25, 0.3)  // LEFT, close
], W, H);
const hazard = findPriorityHazard(frame);
check('HIGH hazard wins over more-confident LOW hazard', hazard?.detection.label === 'stairs');
check('alert text matches spec', hazard?.alert === 'Warning: Staircase detected directly ahead.', hazard?.alert);
check('restroom sign described spatially',
  frame[2].spatialDescription === 'Restroom sign 2 meters ahead on your left', frame[2].spatialDescription);

const lowConf = analyzeDetections([box('staircase', 0.65, 0.5, 0.5, 0.3, 0.3)], W, H);
check('hazard at 0.65 confidence does not trigger', findPriorityHazard(lowConf) === null);
const offCenter = analyzeDetections([box('pothole', 0.95, 0.1, 0.5, 0.15, 0.2)], W, H);
check('hazard outside focal zone does not trigger', findPriorityHazard(offCenter) === null);
const lowOnly = analyzeDetections([box('construction_barrier', 0.9, 0.5, 0.5, 0.2, 0.2)], W, H);
check('LOW hazard uses "Caution"', findPriorityHazard(lowOnly)?.alert === 'Caution: Construction barrier detected directly ahead.');

// General-model obstacles only alert when within arm's reach, using their own name
const farPerson = analyzeDetections([box('person', 0.9, 0.5, 0.5, 0.1, 0.3)], W, H);
check('person far away in focal zone does not alert', findPriorityHazard(farPerson) === null);
const nearCase = analyzeDetections([box('suitcase', 0.88, 0.5, 0.6, 0.5, 0.6)], W, H);
check('suitcase within 1 m alerts by name', findPriorityHazard(nearCase)?.alert === 'Caution: Suitcase detected directly ahead.', findPriorityHazard(nearCase)?.alert);
check('person is described by name, not "Obstacle"', humanizeLabel('person') === 'Person');

// Sign announcement
const gateDet = analyzeDetections([box('boarding_gate_sign', 0.9, 0.85, 0.3, 0.3, 0.3)], W, H)[0];
check('sign announcement includes text and spatial context',
  formatSignAnnouncement('Gate B12', gateDet) === 'Approaching Gate B12, 2 meters ahead on your right.',
  formatSignAnnouncement('Gate B12', gateDet));

console.log('\n=================================================');
console.log(`TEST SUMMARY: ${passed}/${total} tests passed.`);
console.log('=================================================');
if (passed !== total) process.exit(1);
