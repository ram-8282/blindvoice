/**
 * Backend Route Processing Engine for Assistive Navigation
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

export function extractLandmarksFromStep(step, nearbyPlaces = []) {
  const landmarks = new Set();
  const html = step.html_instructions || '';

  const cleanText = html.replace(/<[^>]*>/g, ' ');

  const boldMatches = html.match(/<b>(.*?)<\/b>/gi);
  if (boldMatches) {
    boldMatches.forEach(match => {
      const landmarkText = match.replace(/<[^>]*>/g, '').trim();
      if (landmarkText && landmarkText.length > 2 && !landmarkText.toLowerCase().includes('head') && !landmarkText.toLowerCase().includes('turn')) {
        landmarks.add(landmarkText);
      }
    });
  }

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
    const distanceMeters = step.distance ? step.distance.value : 0;
    const distanceInSteps = Math.max(1, Math.round(distanceMeters / stepLengthMeters));
    const milestoneType = classifyManeuverType(step.maneuver, step.html_instructions, isLastStep);
    const expectedLandmarks = extractLandmarksFromStep(step, nearbyPlaces);
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
