/**
 * Voice Control Engine for Assistive Navigation
 * Designed for blind and low-vision users.
 */

// Haversine formula to compute distance in meters between two lat/lon coordinates
export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Radius of Earth in meters
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

// Synonyms and category mappings for common amenities
const AMENITY_SYNONYMS = {
  washroom: ["washroom", "restroom", "toilet", "bathroom", "lavatory", "wc"],
  cafe: ["coffee", "starbucks", "cafe", "espresso", "latte"],
  gate: ["gate", "boarding gate", "terminal gate", "concourse gate"],
  pharmacy: ["pharmacy", "drugstore", "walgreens", "cvs", "chemist"],
  elevator: ["elevator", "lift", "stairs", "escalator"],
  hospital: ["hospital", "clinic", "emergency", "medical center"]
};

/**
 * Extracts target entity or category from raw user speech
 */
export function extractTargetAmenity(speech) {
  if (!speech || typeof speech !== "string") return "";
  const cleaned = speech.toLowerCase().trim();

  // Check against known synonym dictionary
  for (const [category, synonyms] of Object.entries(AMENITY_SYNONYMS)) {
    for (const syn of synonyms) {
      if (cleaned.includes(syn)) {
        // Return raw extracted word or standard category if brand/synonym matched
        const brandMatch = cleaned.match(/\b(starbucks|walgreens|cvs|mcdonalds)\b/i);
        if (brandMatch) return brandMatch[0].toLowerCase();
        
        const gateMatch = cleaned.match(/\bgate\s+([a-z0-9]+)\b/i);
        if (gateMatch) return gateMatch[0].toLowerCase();

        return category;
      }
    }
  }

  // Remove common filler phrases so the remainder works as a place-search keyword:
  // "Where can I find chicken shops near me?" -> "chicken shops"
  const stripped = cleaned
    .replace(/[?.!,]/g, "")
    .replace(/^(please\s+)?(take me to|where is|where are|where can i find|find me|find|guide me to|navigate to|how do i get to|look for|show me|i want|i need|are there any|is there|search for)\s+/i, "")
    .replace(/^(the|a|an|some|any)\s+/i, "")
    .replace(/^(nearest|closest|nearby)\s+/i, "")
    .replace(/\s+(near me|nearby|around me|around here|close by|close to me|in this area)$/i, "")
    .trim();

  return stripped || cleaned;
}

/**
 * Calculates a match score (0.0 to 1.0) between a target entity and a candidate place object
 */
function scorePlaceMatch(target, place) {
  if (!target) return 0;
  const targetLower = target.toLowerCase();
  const nameLower = (place.name || "").toLowerCase();
  const categoryLower = (place.category || "").toLowerCase();
  const typesLower = (place.types || []).map(t => t.toLowerCase());

  let score = 0;

  // Exact name match or substring match
  if (nameLower.includes(targetLower)) {
    score += 0.7;
  }
  
  // Category match
  if (categoryLower === targetLower || typesLower.includes(targetLower)) {
    score += 0.4;
  }

  // Check synonym matching
  for (const [cat, syns] of Object.entries(AMENITY_SYNONYMS)) {
    if (syns.includes(targetLower)) {
      if (categoryLower === cat || typesLower.includes(cat) || nameLower.includes(cat)) {
        score += 0.4;
      }
    }
  }

  return Math.min(1.0, score);
}

/**
 * Main Voice Control Engine processing logic
 * 
 * @param {string} raw_user_speech - User spoken audio transcript
 * @param {object} user_coords - { lat: number, lon: number }
 * @param {Array} candidate_places - List of place objects from Google Places API
 * @param {number} radiusMeters - Radius boundary (default 500m per Rule 2)
 * @param {object} [options]
 * @param {boolean} [options.preferNearest=false] - Skip the CLARIFY step and navigate to the
 *   nearest match. Used for live Google Places results, which are already keyword-filtered.
 * @returns {object} JSON structure adhering to specified schema
 */
export function processVoiceInput(raw_user_speech, user_coords, candidate_places = [], radiusMeters = 500, options = {}) {
  const { preferNearest = false } = options;
  // 1. Identify target place or amenity category
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

  // 2. Filter candidates within 500m radius and calculate distance
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
    .sort(preferNearest
      ? (a, b) => a.distanceMeters - b.distanceMeters
      : (a, b) => b.matchScore - a.matchScore || a.distanceMeters - b.distanceMeters);

  // If no candidates found within 500m radius
  if (ratedCandidates.length === 0) {
    // Check if place exists beyond 500m radius to give helpful feedback
    const outOfRadiusMatches = candidate_places
      .map(place => ({
        ...place,
        distanceMeters: Math.round(calculateDistanceMeters(user_coords.lat, user_coords.lon, place.lat, place.lon)),
        matchScore: scorePlaceMatch(targetEntity, place)
      }))
      .filter(place => place.matchScore > 0.3)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

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

  // 3. Handle Disambiguation vs Direct Navigation
  const topCandidate = ratedCandidates[0];

  // If there are multiple candidates with similar high scores and distances (Ambiguity)
  if (!preferNearest && ratedCandidates.length >= 2) {
    const secondCandidate = ratedCandidates[1];
    const scoreDiff = topCandidate.matchScore - secondCandidate.matchScore;
    const distanceDiff = Math.abs(topCandidate.distanceMeters - secondCandidate.distanceMeters);

    // If top two candidates are very close in match score and within similar distance range
    if (scoreDiff < 0.2 && distanceDiff < 200) {
      // RULE #3: Construct concise clarifying question with MAX 2 choices
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

  // Direct Match found!
  const distText = topCandidate.distanceMeters < 50
    ? "just ahead"
    : `${topCandidate.distanceMeters} meters away`;

  return {
    intent: "NAVIGATE",
    target_amenity_or_place: targetEntity,
    selected_place_id: topCandidate.place_id,
    confidence: Number(Math.min(0.98, topCandidate.matchScore + 0.2).toFixed(2)),
    spoken_response: topCandidate.source === 'google_places'
      ? `The nearest ${targetEntity} is ${topCandidate.name}, ${distText}${topCandidate.address ? `, at ${topCandidate.address}` : ''}.`
      : `Navigating to ${topCandidate.name}, located ${distText} on ${topCandidate.floor || topCandidate.address}.`
  };
}
