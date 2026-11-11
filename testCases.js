// Test cases and sample candidate places datasets for Assistive Navigation Voice Engine

export const DEFAULT_USER_LOCATION = {
  lat: 17.38504,
  lon: 78.48667,
  description: "Hyderabad, Telangana, India"
};

export const SAMPLE_PLACES = [
  {
    place_id: "place_washroom_1",
    name: "Public Restroom - Main Concourse",
    category: "washroom",
    types: ["washroom", "restroom", "toilet", "amenity"],
    lat: 17.385160,
    lon: 78.486880, // ~26m away
    address: "Main Concourse, Ground Floor",
    accessible: true,
    floor: "Ground Floor"
  },
  {
    place_id: "place_washroom_2",
    name: "Executive Restrooms - North Wing",
    category: "washroom",
    types: ["washroom", "restroom", "toilet", "amenity"],
    lat: 17.386200,
    lon: 78.487500, // ~155m away
    address: "North Wing near Gate B12",
    accessible: true,
    floor: "2nd Floor"
  },
  {
    place_id: "place_starbucks_1",
    name: "Starbucks Coffee - Market Street",
    category: "cafe",
    types: ["cafe", "coffee_shop", "food", "store"],
    lat: 17.385310,
    lon: 78.486280, // ~50m away
    address: "555 Market St",
    accessible: true,
    floor: "Street Level"
  },
  {
    place_id: "place_starbucks_2",
    name: "Starbucks Coffee - Food Court",
    category: "cafe",
    types: ["cafe", "coffee_shop", "food", "store"],
    lat: 17.384610,
    lon: 78.486980, // ~58m away
    address: "Lower Level Food Court",
    accessible: true,
    floor: "Lower Level"
  },
  {
    place_id: "place_gate_b12",
    name: "Gate B12 - Departure Concourse",
    category: "gate",
    types: ["gate", "airport_gate", "transit"],
    lat: 17.386110,
    lon: 78.487480, // ~145m away
    address: "Concourse B, Gate 12",
    accessible: true,
    floor: "2nd Floor"
  },
  {
    place_id: "place_pharmacy_1",
    name: "Walgreens Pharmacy",
    category: "pharmacy",
    types: ["pharmacy", "store", "health"],
    lat: 17.385910,
    lon: 78.485580, // ~150m away
    address: "600 Market St",
    accessible: true,
    floor: "Street Level"
  },
  {
    place_id: "place_distant_hospital",
    name: "Osmania General Hospital",
    category: "hospital",
    types: ["hospital", "health", "medical"],
    lat: 17.355000,
    lon: 78.460000, // ~4.5km away (>500m radius limit!)
    address: "Afzal Gunj, Hyderabad",
    accessible: true,
    floor: "Main Building"
  },
  {
    place_id: "place_elevator_1",
    name: "Central Elevator Bank A",
    category: "elevator",
    types: ["elevator", "lift", "accessibility"],
    lat: 17.385090,
    lon: 78.486730, // ~8m away
    address: "Central Lobby",
    accessible: true,
    floor: "All Floors"
  }
];

export const PRESET_TEST_SCENARIOS = [
  {
    id: "scenario_1",
    label: "Direct Match: Washroom",
    spoken_text: "Where is the nearest washroom?",
    description: "Requests 'washroom'. Engine should identify closest washrooms or prompt if choices exist."
  },
  {
    id: "scenario_2",
    label: "Ambiguous Match: Starbucks",
    spoken_text: "Take me to Starbucks",
    description: "Two Starbucks exist within 500m (Market St vs Food Court). Engine should trigger CLARIFY with max 2 options."
  },
  {
    id: "scenario_3",
    label: "Direct Match: Gate B12",
    spoken_text: "Guide me to Gate B12",
    description: "Exact match for Gate B12 within 150m. High confidence NAVIGATE."
  },
  {
    id: "scenario_4",
    label: "Out of Radius (>500m): Hospital",
    spoken_text: "Find the nearest hospital",
    description: "Hospital is >500m away. Engine should enforce 500m rule and return low confidence / UNKNOWN or notice."
  },
  {
    id: "scenario_5",
    label: "Direct Match: Elevator",
    spoken_text: "Where is the elevator?",
    description: "Elevator is 10m away. Returns NAVIGATE for Central Elevator Bank A."
  },
  {
    id: "scenario_6",
    label: "Unrecognized / Out of Domain",
    spoken_text: "What is the capital of France?",
    description: "Irrelevant input. Engine returns UNKNOWN with helpful voice prompt."
  }
];

// Sample Google Maps Directions API response payload for pedestrian route testing
export const SAMPLE_DIRECTIONS_PAYLOAD = {
  status: "OK",
  routes: [
    {
      summary: "Market St & 5th St",
      legs: [
        {
          distance: { text: "0.2 km", value: 200 },
          duration: { text: "3 mins", value: 180 },
          start_address: "Powell St Station, Market St, Hyderabad, Telangana, India",
          end_address: "Starbucks, 555 Market St, Hyderabad, Telangana, India",
          start_location: { lat: 17.38504, lng: 78.48667 },
          end_location: { lat: 17.38645, lng: 78.48780 },
          steps: [
            {
              distance: { text: "25 m", value: 25 },
              duration: { text: "1 min", value: 30 },
              start_location: { lat: 17.38504, lng: 78.48667 },
              end_location: { lat: 17.38522, lng: 78.48680 },
              html_instructions: "Head <b>northeast</b> on <b>Market St</b> past the <b>Metro Station entrance</b>",
              maneuver: "head-northeast"
            },
            {
              distance: { text: "60 m", value: 60 },
              duration: { text: "1 min", value: 45 },
              start_location: { lat: 17.38522, lng: 78.48680 },
              end_location: { lat: 17.38566, lng: 78.48710 },
              html_instructions: "Continue straight across the <b>Pedestrian Crosswalk</b> toward <b>5th St</b>",
              maneuver: "straight"
            },
            {
              distance: { text: "45 m", value: 45 },
              duration: { text: "1 min", value: 35 },
              start_location: { lat: 17.38566, lng: 78.48710 },
              end_location: { lat: 17.38600, lng: 78.48735 },
              html_instructions: "Turn <b>right</b> onto <b>5th St</b> past the <b>Walgreens Pharmacy</b> sign",
              maneuver: "turn-right"
            },
            {
              distance: { text: "70 m", value: 70 },
              duration: { text: "1 min", value: 50 },
              start_location: { lat: 17.38600, lng: 78.48735 },
              end_location: { lat: 17.38645, lng: 78.48780 },
              html_instructions: "Turn <b>left</b>. Destination will be on the right past the <b>Starbucks sign</b>",
              maneuver: "turn-left"
            }
          ]
        }
      ]
    }
  ]
};
