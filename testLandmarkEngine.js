import { verifyVisualLandmark, calculateStringSimilarity, levenshteinDistance } from './landmarkEngine.js';

console.log("=================================================");
console.log("VISUAL LANDMARK ENGINE - AUTOMATED TEST SUITE");
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

// Test 1: Levenshtein Distance & Similarity
assert(levenshteinDistance("Starbucks", "Starbks") === 2, "Levenshtein distance between 'Starbucks' and 'Starbks' is 2");
assert(calculateStringSimilarity("Starbucks Coffee", "Starbucks") > 0.8, "Substring match similarity is > 0.8");

// Test 2: Target landmark high-confidence match (> 0.8)
const res1 = verifyVisualLandmark(
  ["Starbks Coffee 555 Market"],
  ["coffee_cup_logo"],
  "Starbucks Coffee",
  ["Walgreens", "Metro Entrance"]
);
assert(res1.matched === true, "Landmark matched is true");
assert(res1.matched_landmark === "Starbucks Coffee", `Matched landmark is Starbucks Coffee (got: ${res1.matched_landmark})`);
assert(res1.confidence > 0.80, `Confidence is > 0.80 (got: ${res1.confidence})`);
assert(res1.location_correction_needed === false, "No correction needed when primary landmark matches");
assert(res1.spoken_system_update.includes("Starbucks Coffee"), "Spoken system update includes landmark name");

// Test 3: Nearby place match (re-anchoring position trigger)
const res2 = verifyVisualLandmark(
  ["Walgreens Pharmacy 600"],
  [],
  "Starbucks Coffee",
  ["Walgreens Pharmacy", "Metro Entrance"]
);
assert(res2.matched === true, "Nearby landmark matched");
assert(res2.matched_landmark === "Walgreens Pharmacy", `Matched landmark is Walgreens Pharmacy (got: ${res2.matched_landmark})`);
assert(res2.confidence > 0.80, "Confidence is > 0.80");
assert(res2.location_correction_needed === true, "Location correction set to true when nearby place matched instead");

// Test 4: Low confidence match (<= 0.80)
const res3 = verifyVisualLandmark(
  ["Random Shoe Store"],
  ["shoe"],
  "Starbucks Coffee",
  ["Metro Entrance"]
);
assert(res3.matched === false, "Unmatched when OCR text is completely unrelated");
assert(res3.matched_landmark === null, "Matched landmark is null");
assert(res3.spoken_system_update === null, "Spoken system update is null");

console.log("\n=================================================");
console.log(`TEST SUMMARY: ${passedCount}/${totalCount} tests passed.`);
console.log("=================================================");

if (passedCount !== totalCount) {
  process.exit(1);
}
