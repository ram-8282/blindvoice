import { processDirectionsRoute, classifyManeuverType, extractLandmarksFromStep, buildMilestoneInstruction } from './routeEngine.js';
import { SAMPLE_DIRECTIONS_PAYLOAD, SAMPLE_PLACES } from './testCases.js';

console.log("=================================================");
console.log("ROUTE PROCESSING ENGINE - AUTOMATED TEST SUITE");
console.log("=================================================\n");

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
  totalCount++;
  if (condition) {
    console.log(`[PASS] ${message}`);
    passedCount++;
  } else {
    console.error(`[FAIL] ${message}`);
  }
}

// Test 1: Maneuver Classification
assert(classifyManeuverType("straight", "", false) === "WALK_STRAIGHT", "Classify 'straight' maneuver as WALK_STRAIGHT");
assert(classifyManeuverType("turn-left", "", false) === "TURN_LEFT", "Classify 'turn-left' maneuver as TURN_LEFT");
assert(classifyManeuverType("turn-right", "", false) === "TURN_RIGHT", "Classify 'turn-right' maneuver as TURN_RIGHT");
assert(classifyManeuverType("", "", true) === "DESTINATION", "Classify last step as DESTINATION");

// Test 2: Distance to Steps Conversion (default 0.7m)
// 25m / 0.7m = ~36 steps
// 60m / 0.7m = ~86 steps
// 45m / 0.7m = ~64 steps
// 70m / 0.7m = ~100 steps
const routeResult = processDirectionsRoute(SAMPLE_DIRECTIONS_PAYLOAD, 0.7, SAMPLE_PLACES);

assert(routeResult && typeof routeResult.total_steps === "number", "Response contains total_steps as integer");
assert(Array.isArray(routeResult.milestones), "Response contains milestones array");
assert(routeResult.milestones.length === 4, `Contains 4 milestones (got: ${routeResult.milestones.length})`);

// Test milestone 0
const m0 = routeResult.milestones[0];
assert(m0.step_index === 0, "Milestone 0 step_index is 0");
assert(m0.distance_in_steps === Math.round(25 / 0.7), `Milestone 0 distance converted to steps (expected ${Math.round(25 / 0.7)}, got ${m0.distance_in_steps})`);
assert(m0.expected_landmarks.length > 0, "Milestone 0 extracted visual landmarks");

// Test milestone 2 (Turn Right)
const m2 = routeResult.milestones[2];
assert(m2.type === "TURN_RIGHT", `Milestone 2 type is TURN_RIGHT (got: ${m2.type})`);
assert(m2.distance_in_steps === Math.round(45 / 0.7), `Milestone 2 distance converted to steps (expected ${Math.round(45 / 0.7)}, got ${m2.distance_in_steps})`);

// Test milestone 3 (Destination / Turn Left)
const m3 = routeResult.milestones[3];
assert(m3.type === "DESTINATION", `Milestone 3 type is DESTINATION (got: ${m3.type})`);
assert(m3.expected_landmarks.some(l => l.includes("Starbucks")), "Milestone 3 extracted Starbucks landmark");

// Test total steps calculation
const expectedTotal = Math.round(25 / 0.7) + Math.round(60 / 0.7) + Math.round(45 / 0.7) + Math.round(70 / 0.7);
assert(routeResult.total_steps === expectedTotal, `Total steps calculated correctly (${routeResult.total_steps} === ${expectedTotal})`);

// Test custom step length (0.5m)
const routeCustomStep = processDirectionsRoute(SAMPLE_DIRECTIONS_PAYLOAD, 0.5, SAMPLE_PLACES);
const expectedCustomTotal = Math.round(25 / 0.5) + Math.round(60 / 0.5) + Math.round(45 / 0.5) + Math.round(70 / 0.5);
assert(routeCustomStep.total_steps === expectedCustomTotal, `Custom step length (0.5m) recalculates total steps (${routeCustomStep.total_steps} === ${expectedCustomTotal})`);

console.log("\n=================================================");
console.log(`TEST SUMMARY: ${passedCount}/${totalCount} tests passed.`);
console.log("=================================================");

if (passedCount !== totalCount) {
  process.exit(1);
}
