/**
 * Backend Voice Control Engine for Assistive Navigation
 * Designed for blind and low-vision users.
 */

export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const AMENITY_SYNONYMS = {
  washroom: ["washroom", "restroom", "toilet", "bathroom", "lavatory", "wc"],
  cafe: ["coffee", "starbucks", "cafe", "espresso", "latte"],
  gate: ["gate", "boarding gate", "terminal gate", "concourse gate"],
  pharmacy: ["pharmacy", "drugstore", "walgreens", "cvs", "chemist"],
  elevator: ["elevator", "lift", "stairs", "escalator"],
  hospital: ["hospital", "clinic", "emergency", "medical center"]
};

export function extractTargetAmenity(speech) {
  if (!speech || typeof speech !== "string") return "";
  const cleaned = speech.toLowerCase().trim();

  for (const [category, synonyms] of Object.entries(AMENITY_SYNONYMS)) {
    for (const syn of synonyms) {
      if (cleaned.includes(syn)) {
        const brandMatch = cleaned.match(/\b(starbucks|walgreens|cvs|mcdonalds)\b/i);
        if (brandMatch) return brandMatch[0].toLowerCase();
        
        const gateMatch = cleaned.match(/\bgate\s+([a-z0-9]+)\b/i);
        if (gateMatch) return gateMatch[0].toLowerCase();

        return category;
      }
    }
  }

  const stripped = cleaned
    .replace(/^(take me to|where is|find me a|find the|guide me to|navigate to|how do i get to|look for|show me)\s+/i, "")
    .replace(/[?.!]/g, "")
    .trim();

  return stripped || cleaned;
}

function scorePlaceMatch(target, place) {
  if (!target) return 0;
  const targetLower = target.toLowerCase();
  const nameLower = (place.name || "").toLowerCase();
  const categoryLower = (place.category || "").toLowerCase();
  const typesLower = (place.types || []).map(t => t.toLowerCase());

  let score = 0;

  if (nameLower.includes(targetLower)) {
    score += 0.7;
  }
  
  if (categoryLower === targetLower || typesLower.includes(targetLower)) {
    score += 0.4;
  }

  for (const [cat, syns] of Object.entries(AMENITY_SYNONYMS)) {
    if (syns.includes(targetLower)) {
      if (categoryLower === cat || typesLower.includes(cat) || nameLower.includes(cat)) {
        score += 0.4;
      }
    }
  }

  return Math.min(1.0, score);
}

export function processVoiceInput(raw_user_speech, user_coords, candidate_places = [], radiusMeters = 500) {
  const targetEntity = extractTargetAmenity(raw_user_speech);

  if (!targetEntity || targetEntity.length < 2) {
    return {
      intent: "UNKNOWN",
      target_amenity_or_place: targetEntity || "unknown",
      selected_place_id: null,
      confidence: 0.1,
      spoken_response: "I didn't catch that destination. Could you please repeat where you would like to go?"
    };
  }

  const ratedCandidates = candidate_places
    .map(place => {
      const distance = calculateDistanceMeters(user_coords.lat, user_coords.lon, place.lat, place.lon);
      const matchScore = scorePlaceMatch(targetEntity, place);
      return {
        ...place,
        distanceMeters: Math.round(distance),
        matchScore
      };
    })
    .filter(place => place.distanceMeters <= radiusMeters && place.matchScore > 0.3)
    .sort((a, b) => b.matchScore - a.matchScore || a.distanceMeters - b.distanceMeters);

  if (ratedCandidates.length === 0) {
    const outOfRadiusMatches = candidate_places
      .map(place => ({
        ...place,
        distanceMeters: Math.round(calculateDistanceMeters(user_coords.lat, user_coords.lon, place.lat, place.lon)),
        matchScore: scorePlaceMatch(targetEntity, place)
      }))
      .filter(place => place.matchScore > 0.3);

    if (outOfRadiusMatches.length > 0) {
      const closestOut = outOfRadiusMatches[0];
      const distKm = (closestOut.distanceMeters / 1000).toFixed(1);
      return {
        intent: "UNKNOWN",
        target_amenity_or_place: targetEntity,
        selected_place_id: null,
        confidence: 0.25,
        spoken_response: `No matching ${targetEntity} was found within 500 meters. The nearest option, ${closestOut.name}, is ${distKm} kilometers away.`
      };
    }

    return {
      intent: "UNKNOWN",
      target_amenity_or_place: targetEntity,
      selected_place_id: null,
      confidence: 0.2,
      spoken_response: `I couldn't find any ${targetEntity} within 500 meters of your current location.`
    };
  }

  const topCandidate = ratedCandidates[0];

  if (ratedCandidates.length >= 2) {
    const secondCandidate = ratedCandidates[1];
    const scoreDiff = topCandidate.matchScore - secondCandidate.matchScore;
    const distanceDiff = Math.abs(topCandidate.distanceMeters - secondCandidate.distanceMeters);

    if (scoreDiff < 0.2 && distanceDiff < 200) {
      const choice1 = `${topCandidate.name} (${topCandidate.address || topCandidate.floor || `${topCandidate.distanceMeters} meters`})`;
      const choice2 = `${secondCandidate.name} (${secondCandidate.address || secondCandidate.floor || `${secondCandidate.distanceMeters} meters`})`;

      return {
        intent: "CLARIFY",
        target_amenity_or_place: targetEntity,
        selected_place_id: null,
        confidence: 0.65,
        spoken_response: `I found two locations nearby: ${choice1}, or ${choice2}. Which one would you like?`
      };
    }
  }

  const distText = topCandidate.distanceMeters < 50
    ? "just ahead"
    : `${topCandidate.distanceMeters} meters away`;

  return {
    intent: "NAVIGATE",
    target_amenity_or_place: targetEntity,
    selected_place_id: topCandidate.place_id,
    confidence: Number(Math.min(0.98, topCandidate.matchScore + 0.2).toFixed(2)),
    spoken_response: `Navigating to ${topCandidate.name}, located ${distText} on ${topCandidate.floor || topCandidate.address}.`
  };
}
