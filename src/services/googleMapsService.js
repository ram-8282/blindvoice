// Google Maps Places API (Nearby Search) client.
//
// The browser can't call https://maps.googleapis.com/maps/api/place/nearbysearch/json directly
// (Google's web-service endpoints send no CORS headers) and this app has no bundler, so
// import.meta.env isn't available. Requests therefore go to the VoxNav backend's
// /api/places/nearby proxy, which reads GOOGLE_MAPS_API_KEY from backend/.env and returns
// places normalized to the Voice Engine's candidate schema:
//   { place_id, name, category, types, lat, lon, address, rating, open_now, source }

let proxyUrl = 'http://localhost:4000';
let statusCache = null;

export class PlacesError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PlacesError';
    this.code = code;
  }
}

export function configureGoogleMaps({ proxyUrl: url } = {}) {
  if (url) proxyUrl = url.replace(/\/$/, '');
  statusCache = null;
}

/** True when the backend has a Google Maps key configured. Never throws. */
export function isGoogleMapsAvailable() {
  if (!statusCache) {
    statusCache = fetch(`${proxyUrl}/api/places/status`, { signal: AbortSignal.timeout(3000) })
      .then(r => (r.ok ? r.json() : { configured: false }))
      .then(s => Boolean(s.configured))
      .catch(() => { statusCache = null; return false; });
  }
  return statusCache;
}

/**
 * Search for places near a point.
 * @param {number} lat
 * @param {number} lng
 * @param {number} [radius=500] meters
 * @param {string} [keyword=""] e.g. "chicken shop", "washroom"
 * @returns {Promise<Array>} places in the Voice Engine candidate format
 */
export async function fetchNearbyPlaces(lat, lng, radius = 500, keyword = '') {
  const qs = new URLSearchParams({ lat: String(lat), lng: String(lng), radius: String(radius) });
  if (keyword) qs.set('keyword', keyword);

  let response;
  try {
    response = await fetch(`${proxyUrl}/api/places/nearby?${qs}`, { signal: AbortSignal.timeout(10000) });
  } catch (err) {
    throw new PlacesError('NETWORK_ERROR', `Could not reach the places proxy: ${err.message}`);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (body.error === 'PLACES_NOT_CONFIGURED') statusCache = Promise.resolve(false);
    throw new PlacesError(body.error || `HTTP_${response.status}`, body.message || 'Places request failed');
  }
  return Array.isArray(body.places) ? body.places : [];
}
