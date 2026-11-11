import { IndoorNavigationEngine } from './indoorNavigationEngine.js';

console.log("=================================================");
console.log("INDOOR NAVIGATION ENGINE - AUTOMATED TEST SUITE");
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

const SAMPLE_AIRPORT_GRAPH = {
  venue_id: "AIRPORT_SFO_TERMINAL_2",
  floor_level: "Departures_L2",
  start_anchor_node: {
    node_id: "NODE_SEC_CHECKPOINT_B_EXIT_L2",
    visual_landmark_text: "Security Checkpoint B Exit - All Gates B1-B24",
    expected_icon_type: "SECURITY_CHECKPOINT"
  },
  route_path: [
    {
      segment_index: 0,
      from_node: "NODE_SEC_CHECKPOINT_B_EXIT_L2",
      to_node: "NODE_CENTRAL_ROTUNDA_L2",
      distance_steps: 36,
      heading_relative_deg: 0,
      expected_verification_landmarks: ["Gates B1-B24 Straight Ahead", "Information Counter B"],
      requires_level_change: false,
      level_change_type: "NONE"
    },
    {
      segment_index: 1,
      from_node: "NODE_CENTRAL_ROTUNDA_L2",
      to_node: "NODE_ESCALATOR_BANK_B_BASE_L2",
      distance_steps: 24,
      heading_relative_deg: 270,
      expected_verification_landmarks: ["Starbucks Storefront Logo", "Gates B1-B14 & Lounges Up"],
      requires_level_change: false,
      level_change_type: "NONE"
    },
    {
      segment_index: 2,
      from_node: "NODE_ESCALATOR_BANK_B_BASE_L2",
      to_node: "NODE_ESCALATOR_BANK_B_LANDING_L3",
      distance_steps: 18,
      heading_relative_deg: 0,
      expected_verification_landmarks: ["Tactile Warning Pavers", "Concourse Level 3"],
      requires_level_change: true,
      level_change_type: "ESCALATOR"
    },
    {
      segment_index: 3,
      from_node: "NODE_ESCALATOR_BANK_B_LANDING_L3",
      to_node: "NODE_GATE_B12_PODIUM_L3",
      distance_steps: 42,
      heading_relative_deg: 90,
      expected_verification_landmarks: ["Gate B12 Sign", "Flight Status Screen B12"],
      requires_level_change: false,
      level_change_type: "NONE"
    }
  ]
};

// Test 1: Instantiation and Graph Loading
const engine = new IndoorNavigationEngine(0.70);
engine.loadGraph(SAMPLE_AIRPORT_GRAPH);

assert(engine.getActiveGraph().venue_id === "AIRPORT_SFO_TERMINAL_2", "Graph loaded correctly with matching venue_id");
assert(engine.getCurrentSegmentIndex() === 0, "Initial segment index is 0");

// Test 2: Inspection Query (0 steps)
const initStatus = engine.processStep(0);
assert(initStatus.remainingSteps === 36, "Initial remaining steps is 36");
assert(initStatus.voiceInstruction.includes("Continue straight ahead"), "Initial instruction is 'Continue straight ahead'");

// Test 3: Advancing through segment 0 with 36 steps
const seg1Status = engine.processStep(36);
assert(seg1Status.remainingSteps === 24, "Next segment remaining steps is 24");
assert(seg1Status.voiceInstruction.includes("Turn 90 degrees left"), "Voice instruction announces 'Turn 90 degrees left'");

// Test 4: Reaching escalator on segment 1 completion
engine.processStep(24);
const escalatorStatus = engine.processStep(18);
assert(escalatorStatus.voiceInstruction.includes("take the escalator"), "Voice instruction instructs to take the escalator");
assert(engine.isWaitingForElevation() === true, "Waiting for altimeter elevation verification");

// Test 5: Elevation Complete Trigger
engine.handleElevationComplete();
assert(engine.isWaitingForElevation() === false, "Elevation wait cleared after handleElevationComplete");
const nextStepStatus = engine.processStep(1);
assert(nextStepStatus.remainingSteps === 41, "Next segment remaining steps correctly decremented from 42 to 41");

console.log("\n=================================================");
console.log(`INDOOR TEST SUMMARY: ${passedCount}/${totalCount} tests passed.`);
console.log("=================================================");
