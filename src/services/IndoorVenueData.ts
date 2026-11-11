import { VenueGraph } from './IndoorNavigationEngine';

export const VENUE_AIRPORT_SFO_T2: VenueGraph = {
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
      expected_verification_landmarks: [
        "Overhead Sign: Gates B1-B24 Straight Ahead",
        "Information Counter B",
        "ISO 7001 PI PF 001 Information Icon"
      ],
      requires_level_change: false,
      level_change_type: "NONE"
    },
    {
      segment_index: 1,
      from_node: "NODE_CENTRAL_ROTUNDA_L2",
      to_node: "NODE_ESCALATOR_BANK_B_BASE_L2",
      distance_steps: 24,
      heading_relative_deg: 270,
      expected_verification_landmarks: [
        "Starbucks Storefront Logo",
        "Overhead Sign: Gates B1-B14 & Lounges Up",
        "ISO 7001 PI PF 004 Escalator Up Pictogram"
      ],
      requires_level_change: false,
      level_change_type: "NONE"
    },
    {
      segment_index: 2,
      from_node: "NODE_ESCALATOR_BANK_B_BASE_L2",
      to_node: "NODE_ESCALATOR_BANK_B_LANDING_L3",
      distance_steps: 18,
      heading_relative_deg: 0,
      expected_verification_landmarks: [
        "Tactile Ground Surface Indicators (TGSI)",
        "Overhead Sign: Concourse Level 3 - Gates B1-B14",
        "ISO 7001 PI PF 004 Escalator Incline Symbol"
      ],
      requires_level_change: true,
      level_change_type: "ESCALATOR"
    },
    {
      segment_index: 3,
      from_node: "NODE_ESCALATOR_BANK_B_LANDING_L3",
      to_node: "NODE_CORRIDOR_RESTROOM_HUB_L3",
      distance_steps: 32,
      heading_relative_deg: 90,
      expected_verification_landmarks: [
        "Overhead Sign: Gates B10-B14 Straight",
        "Hudson News Storefront",
        "ISO 7001 PI PF 003 Public Restroom Pictogram"
      ],
      requires_level_change: false,
      level_change_type: "NONE"
    },
    {
      segment_index: 4,
      from_node: "NODE_CORRIDOR_RESTROOM_HUB_L3",
      to_node: "NODE_GATE_B12_PODIUM_L3",
      distance_steps: 42,
      heading_relative_deg: 0,
      expected_verification_landmarks: [
        "High-Contrast Illuminated Gate Sign: Gate B12",
        "Flight Information Display Screen: Gate B12",
        "ISO 7001 PI TF 001 Aircraft Departure Symbol"
      ],
      requires_level_change: false,
      level_change_type: "NONE"
    }
  ]
};

export const VENUE_RAILWAY_STATION_CENTRAL: VenueGraph = {
  venue_id: "RAILWAY_STATION_CENTRAL_TERMINUS",
  floor_level: "Main_Concourse_L1",
  start_anchor_node: {
    node_id: "NODE_TICKET_BARRIERS_CONCOURSE",
    visual_landmark_text: "Ticket Gates A - Platforms 1 to 8",
    expected_icon_type: "TICKET_BARRIER"
  },
  route_path: [
    {
      segment_index: 0,
      from_node: "NODE_TICKET_BARRIERS_CONCOURSE",
      to_node: "NODE_STAIRWELL_PLATFORM_4_HEAD",
      distance_steps: 28,
      heading_relative_deg: 0,
      expected_verification_landmarks: [
        "Overhead Sign: Platforms 3 & 4 Stairs Down",
        "Tactile Corduroy Warning Pavers",
        "ISO 7001 PI PF 006 Stairs Down Pictogram"
      ],
      requires_level_change: false,
      level_change_type: "NONE"
    },
    {
      segment_index: 1,
      from_node: "NODE_STAIRWELL_PLATFORM_4_HEAD",
      to_node: "NODE_PLATFORM_4_SUB_LEVEL",
      distance_steps: 22,
      heading_relative_deg: 0,
      expected_verification_landmarks: [
        "Handrail Braille Plaque: Platform 4",
        "Stair Tread High-Contrast Nosing",
        "Barometric Delta Marker: Sub-Level (-4.1m)"
      ],
      requires_level_change: true,
      level_change_type: "STAIRS"
    },
    {
      segment_index: 2,
      from_node: "NODE_PLATFORM_4_SUB_LEVEL",
      to_node: "NODE_PLATFORM_4_BOARDING_ZONE_A",
      distance_steps: 30,
      heading_relative_deg: 90,
      expected_verification_landmarks: [
        "Overhead Sign: Platform 4 Sector A / Carriages 1-4",
        "Platform Edge Tactile Blister Paving",
        "ISO 7001 PI TF 002 Train Boarding Icon"
      ],
      requires_level_change: false,
      level_change_type: "NONE"
    }
  ]
};

export const VENUE_MALL_WESTFIELD: VenueGraph = {
  venue_id: "MALL_WESTFIELD_GALLERIA",
  floor_level: "Ground_Floor",
  start_anchor_node: {
    node_id: "NODE_MALL_ATRIUM_NORTH",
    visual_landmark_text: "Central Atrium Directory Sign",
    expected_icon_type: "DIRECTORY_KIOSK"
  },
  route_path: [
    {
      segment_index: 0,
      from_node: "NODE_MALL_ATRIUM_NORTH",
      to_node: "NODE_ELEVATOR_LOBBY_CENTRAL",
      distance_steps: 34,
      heading_relative_deg: 90,
      expected_verification_landmarks: [
        "Apple Store Facade",
        "Overhead Sign: Restrooms & Glass Elevators ->",
        "ISO 7001 PI PF 005 Elevator Pictogram"
      ],
      requires_level_change: false,
      level_change_type: "NONE"
    },
    {
      segment_index: 1,
      from_node: "NODE_ELEVATOR_LOBBY_CENTRAL",
      to_node: "NODE_ELEVATOR_EXIT_L2",
      distance_steps: 6,
      heading_relative_deg: 0,
      expected_verification_landmarks: [
        "Elevator Hall Call Button Braille Pad",
        "Floor Chime Indicator L2",
        "ISO 7001 PI PF 005 Accessible Lift Icon"
      ],
      requires_level_change: true,
      level_change_type: "ELEVATOR"
    },
    {
      segment_index: 2,
      from_node: "NODE_ELEVATOR_EXIT_L2",
      to_node: "NODE_RESTROOM_CORRIDOR_L2",
      distance_steps: 20,
      heading_relative_deg: 270,
      expected_verification_landmarks: [
        "Overhead Sign: Restrooms / All-Gender Accessible",
        "Tactile Wall Plaque with Grade 2 Braille",
        "ISO 7001 PI PF 003 Restroom Pictogram"
      ],
      requires_level_change: false,
      level_change_type: "NONE"
    }
  ]
};

