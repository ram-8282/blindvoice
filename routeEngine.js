/**
 * Route Processing Engine for Assistive Navigation
 * Converts raw Google Maps Directions API payload into step-counted dead reckoning milestones
 * and visual landmark checkpoints for blind and low-vision users.
 */

/**
 * Classifies Google Maps maneuver string into simplified milestone type
 */
export function classifyManeuverType(maneuver, htmlInstruction, isLastStep) {
  if (isLastStep || (maneuver && maneuver.includes('destination'))) {
    return 'DESTINATION';
  }

  const m = (maneuver || '').toLowerCase();
  const text = (htmlInstruction || '').toLowerCase();

  if (m.includes('left') || text.includes('turn left') || text.includes('slight left')) {
    return 'TURN_LEFT';
  }
  if (m.includes('right') || text.includes('turn right') || text.includes('slight right')) {
    return 'TURN_RIGHT';
  }
  return 'WALK_STRAIGHT';
}

/**
 * Extracts human-readable visual landmarks from HTML instructions or nearby places
 */
export function extractLandmarksFromStep(step, nearbyPlaces = []) {
  const landmarks = new Set();
  const html = step.html_instructions || '';

  // 1. Clean HTML tags to get raw text
  const cleanText = html.replace(/<[^>]*>/g, ' ');

  // 2. Extract bolded text or specific key locations from <b> tags (e.g. <b>Market St</b>, <b>Starbucks</b>)
  const boldMatches = html.match(/<b>(.*?)<\/b>/gi);
  if (boldMatches) {
    boldMatches.forEach(match => {
      const landmarkText = match.replace(/<[^>]*>/g, '').trim();
      if (landmarkText && landmarkText.length > 2 && !landmarkText.toLowerCase().includes('head') && !landmarkText.toLowerCase().includes('turn')) {
        landmarks.add(landmarkText);
      }
    });
  }

  // 3. Extract common landmark keywords from text (e.g. "crosswalk", "metro station", "bus stop", "entrance")
  const landmarkKeywords = [
    { pattern: /crosswalk/i, name: 'Pedestrian Crosswalk' },
    { pattern: /metro|subway|station/i, name: 'Metro Station entrance' },
    { pattern: /bus stop|transit/i, name: 'Bus Stop sign' },
    { pattern: /traffic light|signal/i, name: 'Traffic Signal' },
    { pattern: /elevator|lift/i, name: 'Elevator entrance' },
    { pattern: /starbucks/i, name: 'Starbucks sign' },
    { pattern: /walgreens|cvs|pharmacy/i, name: 'Pharmacy sign' }
  ];

  landmarkKeywords.forEach(({ pattern, name }) => {
    if (pattern.test(cleanText)) {
      landmarks.add(name);
    }
  });

  // 4. Match nearby places to step coordinates (within ~30m radius)
  if (step.end_location && nearbyPlaces.length > 0) {
    const endLat = step.end_location.lat;
    const endLng = step.end_location.lng;

    nearbyPlaces.forEach(place => {
      if (place.lat && place.lon) {
        const dLat = (place.lat - endLat) * 111000;
        const dLon = (place.lon - endLng) * 111000 * Math.cos(endLat * Math.PI / 180);
        const distMeters = Math.sqrt(dLat * dLat + dLon * dLon);
        if (distMeters <= 35) {
          landmarks.add(`${place.name}`);
        }
      }
    });
  }

  return Array.from(landmarks);
}

/**
 * Builds human-friendly step instruction text for dead reckoning
 */
export function buildMilestoneInstruction(type, stepsCount, landmarks) {
  if (type === 'DESTINATION') {
    return `Arrive at your destination in ${stepsCount} steps`;
  }

  let actionText = 'Walk straight';
  if (type === 'TURN_LEFT') actionText = 'Turn left and walk';
  if (type === 'TURN_RIGHT') actionText = 'Turn right and walk';

  let landmarkNote = '';
  if (landmarks && landmarks.length > 0) {
    landmarkNote = ` (Look for ${landmarks[0]})`;
  }

  return `${actionText} for ${stepsCount} steps${landmarkNote}`;
}

/**
 * Main Route Processing Engine
 * 
 * @param {object} directionsPayload - Google Maps Directions API JSON response
 * @param {number} stepLengthMeters - Average user step length in meters (default 0.7m)
 * @param {Array} nearbyPlaces - Optional list of nearby candidate places for landmark tagging
 * @returns {object} Simplified route object matching requested JSON schema
 */
export function processDirectionsRoute(directionsPayload, stepLengthMeters = 0.7, nearbyPlaces = []) {
  if (!directionsPayload || !directionsPayload.routes || directionsPayload.routes.length === 0) {
    return {
      total_steps: 0,
      milestones: []
    };
  }

  const route = directionsPayload.routes[0];
  const leg = route.legs ? route.legs[0] : null;

  if (!leg || !leg.steps || leg.steps.length === 0) {
    return {
      total_steps: 0,
      milestones: []
    };
  }

  const rawSteps = leg.steps;
  const milestones = [];
  let cumulativeSteps = 0;

  rawSteps.forEach((step, index) => {
    const isLastStep = index === rawSteps.length - 1;

    // Rule 2: Convert metric distance into human steps (Distance_meters / Step_length)
    const distanceMeters = step.distance ? step.distance.value : 0;
    const distanceInSteps = Math.max(1, Math.round(distanceMeters / stepLengthMeters));

    // Rule 3: Identify crucial decision points (turns, crosswalks, entrances)
    const milestoneType = classifyManeuverType(step.maneuver, step.html_instructions, isLastStep);

    // Rule 4: Flag expected visual landmarks along segment
    const expectedLandmarks = extractLandmarksFromStep(step, nearbyPlaces);

    // Build concise instruction text
    const instruction = buildMilestoneInstruction(milestoneType, distanceInSteps, expectedLandmarks);

    milestones.push({
      step_index: index,
      type: milestoneType,
      distance_in_steps: distanceInSteps,
      instruction: instruction,
      expected_landmarks: expectedLandmarks
    });

    cumulativeSteps += distanceInSteps;
  });

  return {
    total_steps: cumulativeSteps,
    milestones: milestones
  };
}
