import { processVoiceInput, calculateDistanceMeters, extractTargetAmenity } from './voiceEngine.js';
import { DEFAULT_USER_LOCATION, SAMPLE_PLACES, PRESET_TEST_SCENARIOS } from './testCases.js';

console.log("=================================================");
console.log("VOICE CONTROL ENGINE - AUTOMATED TEST SUITE");
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

// Test 1: Target extraction
assert(extractTargetAmenity("Where is the nearest washroom?") === "washroom", "Extract 'washroom' amenity category");
assert(extractTargetAmenity("Take me to Starbucks") === "starbucks", "Extract brand name 'starbucks'");
assert(extractTargetAmenity("Guide me to Gate B12") === "gate b12", "Extract specific gate 'gate b12'");

// Test 2: Distance calculation
const dist = calculateDistanceMeters(37.774929, -122.419416, 37.775050, -122.419200);
assert(dist > 10 && dist < 100, `Haversine distance calculation (~25m away, calculated: ${Math.round(dist)}m)`);

// Test 3: Scenario 1 - Direct NAVIGATE to washroom
const res1 = processVoiceInput("Where is the nearest washroom?", DEFAULT_USER_LOCATION, SAMPLE_PLACES);
assert(res1.intent === "NAVIGATE" || res1.intent === "CLARIFY", `Scenario 1 Intent is NAVIGATE/CLARIFY (got: ${res1.intent})`);
assert(res1.target_amenity_or_place === "washroom", `Target amenity extracted as washroom (got: ${res1.target_amenity_or_place})`);
assert(typeof res1.spoken_response === "string" && res1.spoken_response.length > 5, "Has spoken response");

// Test 4: Scenario 2 - CLARIFY between 2 Starbucks
const res2 = processVoiceInput("Take me to Starbucks", DEFAULT_USER_LOCATION, SAMPLE_PLACES);
assert(res2.intent === "CLARIFY", `Scenario 2 Intent is CLARIFY for ambiguous Starbucks (got: ${res2.intent})`);
assert(res2.selected_place_id === null, "Selected place ID is null during CLARIFY intent");
assert(res2.spoken_response.includes("two locations") || res2.spoken_response.includes("Starbucks"), "Spoken response asks clarifying question with options");

// Test 5: Scenario 3 - Direct NAVIGATE to Gate B12
const res3 = processVoiceInput("Guide me to Gate B12", DEFAULT_USER_LOCATION, SAMPLE_PLACES);
assert(res3.intent === "NAVIGATE", `Scenario 3 Intent is NAVIGATE (got: ${res3.intent})`);
assert(res3.selected_place_id === "place_gate_b12", `Selected place ID is place_gate_b12 (got: ${res3.selected_place_id})`);

// Test 6: Scenario 4 - 500m radius limit enforcement
const res4 = processVoiceInput("Find the nearest hospital", DEFAULT_USER_LOCATION, SAMPLE_PLACES);
assert(res4.intent === "UNKNOWN", `Distant hospital (>500m) returns UNKNOWN intent due to 500m rule (got: ${res4.intent})`);

console.log("\n=================================================");
console.log(`TEST SUMMARY: ${passedCount}/${totalCount} tests passed.`);
console.log("=================================================");

if (passedCount !== totalCount) {
  process.exit(1);
}
