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
    lon: 78.486880,
    address: "Main Concourse, Ground Floor"
  },
  {
    place_id: "place_starbucks_1",
    name: "Starbucks Coffee - Market Street",
    category: "cafe",
    types: ["cafe", "coffee_shop", "food", "store"],
    lat: 17.385310,
    lon: 78.486280,
    address: "555 Market St"
  },
  {
    place_id: "place_starbucks_2",
    name: "Starbucks Coffee - Food Court",
    category: "cafe",
    types: ["cafe", "coffee_shop", "food", "store"],
    lat: 17.384610,
    lon: 78.486980,
    address: "Lower Level Food Court"
  }
];

export const SAMPLE_DIRECTIONS_PAYLOAD = {
  status: "OK",
  routes: [
    {
      summary: "Market St Route",
      legs: [
        {
          distance: { text: "0.2 km", value: 200 },
          duration: { text: "3 mins", value: 180 },
          steps: [
            {
              distance: { text: "25 m", value: 25 },
              html_instructions: "Head <b>northeast</b> on <b>Market St</b> past the <b>Metro Station entrance</b>",
              maneuver: "head-northeast"
            },
            {
              distance: { text: "60 m", value: 60 },
              html_instructions: "Continue straight across the <b>Pedestrian Crosswalk</b>",
              maneuver: "straight"
            },
            {
              distance: { text: "45 m", value: 45 },
              html_instructions: "Turn <b>right</b> onto <b>5th St</b> past the <b>Walgreens Pharmacy</b>",
              maneuver: "turn-right"
            },
            {
              distance: { text: "70 m", value: 70 },
              html_instructions: "Turn <b>left</b> past the <b>Starbucks sign</b>",
              maneuver: "turn-left"
            }
          ]
        }
      ]
    }
  ]
};
